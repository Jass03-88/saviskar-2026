/**
 * POST /api/payments/webhook
 *
 * PayU webhook handler for backup payment verification.
 *
 * PayU sends webhooks (server-to-server) for events like:
 *   - payment success
 *   - payment failure
 *
 * This handler:
 *   1. Validates the webhook signature (reverse hash)
 *   2. Parses the event
 *   3. Updates payment_orders, participant_events, and payments
 *   4. Is fully idempotent (safe to receive duplicate events)
 *
 * Setup in PayU Dashboard:
 *   URL: https://your-domain.com/api/payments/webhook
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPaymentGateway } from "@/lib/payments";
import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";

export async function POST(
  request: NextRequest
) {
  // ─── Read Raw Body + Signature ──────────────────────────

  const rawBody = await request.text();
  const signature = request.headers.get("x-payu-signature") ?? "";

  if (!rawBody) {
    return new Response("Missing body.", { status: 400 });
  }

  // ─── Validate Webhook ──────────────────────────────────

  const gateway = getPaymentGateway();

  const validation =
    gateway.validateWebhook({
      body: rawBody,
      signature,
    });

  if (
    !validation.valid ||
    !validation.event
  ) {
    console.error(
      "Webhook validation failed:",
      validation.error
    );
    return new Response(
      validation.error ?? "Invalid webhook.",
      { status: 400 }
    );
  }

  const event = validation.event;

  console.log("Webhook received:", {
    eventType: event.eventType,
    gatewayOrderId: event.gatewayOrderId,
    gatewayPaymentId:
      event.gatewayPaymentId,
    status: event.status,
  });

  // ─── Supabase Admin ─────────────────────────────────────

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error(
      "Webhook handler: Missing Supabase config."
    );
    // Return 200 so PayU doesn't retry
    return new Response("OK", {
      status: 200,
    });
  }

  const supabaseAdmin = createClient(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  // ─── Find Payment Order by Gateway Order ID ────────────

  if (!event.gatewayOrderId) {
    console.error(
      "Webhook event missing gateway order ID."
    );
    return new Response("OK", {
      status: 200,
    });
  }

  if (!event.gatewayPaymentId) {
    console.error(
      "Webhook event missing gateway payment ID."
    );
    return new Response("Missing payment ID.", {
      status: 400,
    });
  }

  const {
    data: paymentOrder,
    error: lookupError,
  } = await supabaseAdmin
    .from("payment_orders")
    .select(
      "id, status, payer_participant_id, amount, currency, gateway_order_id"
    )
    .eq(
      "gateway_order_id",
      event.gatewayOrderId
    )
    .maybeSingle();

  if (lookupError) {
    console.error(
      "Webhook: payment order lookup failed:",
      lookupError
    );
    return new Response("OK", {
      status: 200,
    });
  }

  if (!paymentOrder) {
    console.error(
      "Webhook: payment order not found for gateway_order_id:",
      event.gatewayOrderId
    );
    return new Response("OK", {
      status: 200,
    });
  }

  // ─── Idempotency: Already in final state ───────────────

  if (
    paymentOrder.status === "paid" ||
    paymentOrder.status === "refunded"
  ) {
    console.log(
      "Webhook: payment order already in final state:",
      paymentOrder.status
    );
    return new Response("OK", {
      status: 200,
    });
  }

  if (paymentOrder.status !== "pending") {
    console.warn(
      "Webhook: payment order is not pending:",
      paymentOrder.status
    );
    return new Response("OK", {
      status: 200,
    });
  }

  // ─── Handle Event ──────────────────────────────────────

  if (event.status === "paid") {
    // ─── Defense-In-Depth: Amount & Currency Verification ───
    const expectedAmountPaise = Math.round(Number(paymentOrder.amount) * 100);
    const expectedCurrency = (paymentOrder.currency || "INR").toUpperCase();

    let capturedAmount = event.amount;
    let capturedCurrency = event.currency;

    // If webhook payload lacks trustworthy amount/currency, fetch server-side from PayU
    if (typeof capturedAmount !== "number" || !capturedCurrency) {
      try {
        const fetched = await gateway.fetchPaymentDetails(event.gatewayOrderId);
        capturedAmount = fetched.amount;
        capturedCurrency = fetched.currency;

        if (fetched.gatewayOrderId !== event.gatewayOrderId) {
          console.error("Webhook: PayU order ID mismatch:", {
            expected: event.gatewayOrderId,
            actual: fetched.gatewayOrderId,
          });
          return new Response("Order mismatch.", { status: 400 });
        }

        if (fetched.status !== "paid") {
          console.error("Webhook: Payment status is not paid:", fetched.status);
          return new Response("Payment not paid.", { status: 400 });
        }
      } catch (err) {
        console.error("Webhook: Server-side payment lookup failed:", err);
        return new Response("Could not verify payment details.", { status: 502 });
      }
    }

    if (capturedAmount !== expectedAmountPaise) {
      console.error("Webhook: Amount mismatch! Payment rejected.", {
        expectedAmountPaise,
        capturedAmount,
        paymentOrderId: paymentOrder.id,
      });
      return new Response("Amount mismatch.", { status: 400 });
    }

    if (capturedCurrency.toUpperCase() !== expectedCurrency) {
      console.error("Webhook: Currency mismatch! Payment rejected.", {
        expectedCurrency,
        capturedCurrency,
        paymentOrderId: paymentOrder.id,
      });
      return new Response("Currency mismatch.", { status: 400 });
    }

    // ─── Execute Atomic Settlement RPC ────────────────────────
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("process_payment_success", {
      p_gateway_order_id: event.gatewayOrderId,
      p_gateway_payment_id: event.gatewayPaymentId,
      p_amount_paise: capturedAmount,
      p_currency: capturedCurrency || "INR",
      p_gateway_name: gateway.name,
    });

    if (rpcError) {
      console.error("Webhook DB error executing settlement RPC:", rpcError);

      // Capability Gate: Fail closed if RPC is missing or unavailable
      if (
        rpcError.code === "PGRST202" || 
        rpcError.code === "42883" || 
        (rpcError.message && rpcError.message.includes("does not exist"))
      ) {
        console.warn("Capability Gate: Atomic settlement RPC not available. Failing closed to allow PayU retry.");
        return new Response("Service temporarily unavailable during upgrade", { status: 503 });
      }

      return new Response("Database error recording payment", { status: 500 });
    }

    if (rpcData && !rpcData.success) {
      console.error("Webhook settlement RPC failed:", rpcData.error);
      return new Response(rpcData.error || "Settlement failed", { status: 400 });
    }

    if (rpcData?.action === "already_processed" || rpcData?.action === "already_paid" || rpcData?.action === "already_refunded") {
      console.log(`[WEBHOOK IDEMPOTENCY] Event already processed for payment ${event.gatewayPaymentId}. Skipping duplicate execution.`);
      return new Response("OK", { status: 200 });
    }

    console.log(
      "Webhook: payment atomic settlement complete:",
      {
        paymentOrderId: paymentOrder.id,
        gatewayPaymentId: event.gatewayPaymentId,
        action: rpcData?.action,
      }
    );

    // ─── Trigger Idempotent Post-Payment Logic ─────────────
    await ensurePaymentConfirmationSent(paymentOrder.id);
  } else if (event.status === "failed") {
    const { error: failureRpcError } = await supabaseAdmin.rpc("process_payment_failure", {
      p_gateway_order_id: event.gatewayOrderId
    });

    if (failureRpcError) {
      console.error("Webhook DB error executing failure RPC:", failureRpcError);
      
      if (
        failureRpcError.code === "PGRST202" || 
        failureRpcError.code === "42883" || 
        (failureRpcError.message && failureRpcError.message.includes("does not exist"))
      ) {
        console.warn("Capability Gate: Atomic failure RPC not available. Failing closed.");
        return new Response("Service temporarily unavailable during upgrade", { status: 503 });
      }

      return new Response("Database error", { status: 500 });
    }

    console.log(
      "Webhook: payment marked as failed:",
      {
        paymentOrderId: paymentOrder.id,
      }
    );
  }

  // Always return 200 so PayU doesn't retry
  return new Response("OK", {
    status: 200,
  });
}
