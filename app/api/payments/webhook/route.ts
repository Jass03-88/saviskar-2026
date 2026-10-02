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

    // ─── Database-Enforced Idempotency Claim ─────────────────
    const { data: eventClaim, error: claimError } = await supabaseAdmin
      .from("processed_payment_events")
      .insert({
        order_id: paymentOrder.id,
        payment_id: event.gatewayPaymentId,
        event_type: "payment.captured",
      })
      .select("id")
      .maybeSingle();

    // Explicitly check for Postgres error code 23505 (unique_violation)
    const isDuplicate =
      claimError?.code === "23505" ||
      (!claimError && !eventClaim);

    if (claimError && !isDuplicate) {
      console.error("Webhook DB error claiming payment event:", claimError);
      return new Response("Database error recording payment claim", { status: 500 });
    }

    if (isDuplicate) {
      console.log(
        `[WEBHOOK IDEMPOTENCY] Event already processed for payment ${event.gatewayPaymentId}. Skipping duplicate execution.`
      );
      return new Response("OK", { status: 200 });
    }

    // Update payment_orders
    await supabaseAdmin
      .from("payment_orders")
      .update({
        status: "paid",
        gateway_payment_id:
          event.gatewayPaymentId,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", paymentOrder.id);

    // Get linked participant_events
    const { data: orderItems } =
      await supabaseAdmin
        .from("payment_order_items")
        .select(
          "participant_event_id, participant_id"
        )
        .eq(
          "payment_order_id",
          paymentOrder.id
        );

    const participantEventIds = (
      orderItems ?? []
    )
      .map(
        (item: { participant_event_id?: string | null }) =>
          item.participant_event_id
      )
      .filter(Boolean);

    // Update participant_events
    if (participantEventIds.length > 0) {
      await supabaseAdmin
        .from("participant_events")
        .update({
          payment_status: "paid",
          payment_id:
            event.gatewayPaymentId,
          updated_at:
            new Date().toISOString(),
        })
        .in("id", participantEventIds);
    }

    // Update linked participant_accommodations
    await supabaseAdmin
      .from("participant_accommodations")
      .update({
        status: "paid",
        updated_at:
          new Date().toISOString(),
      })
      .eq("payment_order_id", paymentOrder.id);

    // Create payment record (idempotent check)
    if (
      paymentOrder.payer_participant_id
    ) {
      // Check if payment already exists
      const { data: existingPayment } =
        await supabaseAdmin
          .from("payments")
          .select("id")
          .eq(
            "gateway_payment_id",
            event.gatewayPaymentId
          )
          .maybeSingle();

      if (!existingPayment) {
        await supabaseAdmin
          .from("payments")
          .insert({
            participant_id:
              paymentOrder.payer_participant_id,
            participant_event_id:
              participantEventIds[0] ??
              null,
            amount: Number(
              paymentOrder.amount
            ),
            status: "paid",
            gateway: gateway.name,
            gateway_payment_id:
              event.gatewayPaymentId,
            gateway_order_id:
              event.gatewayOrderId,
          });
      }
    }

    console.log(
      "Webhook: payment marked as paid:",
      {
        paymentOrderId: paymentOrder.id,
        gatewayPaymentId:
          event.gatewayPaymentId,
      }
    );

    // ─── Trigger Idempotent Post-Payment Logic ─────────────
    await ensurePaymentConfirmationSent(paymentOrder.id);
  } else if (event.status === "failed") {
    await supabaseAdmin
      .from("payment_orders")
      .update({
        status: "failed",
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", paymentOrder.id);

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
