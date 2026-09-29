/**
 * POST /api/payments/create
 *
 * Creates a payment gateway order from an existing payment_orders row.
 *
 * Request body:
 *   { paymentOrderId: string }
 *
 * Response:
 *   {
 *     success: true,
 *     gatewayOrderId: string,
 *     checkoutConfig: { gateway, options }
 *   }
 *
 * This route:
 *   1. Validates the payment_orders row exists and is pending
 *   2. Looks up payer info from participants
 *   3. Creates a gateway order via the payment abstraction
 *   4. Stores the gateway_order_id + gateway name back on payment_orders
 *   5. Returns checkout config to the frontend
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { captureException } from "@/lib/monitoring/error-reporter";
import { getPaymentGateway } from "@/lib/payments";
import { getRegistrationSession } from "@/lib/auth/session";
import { verifyPaymentResumeToken } from "@/lib/payments/resume-token";
import { getCanonicalPaymentBaseUrl } from "@/lib/payments/canonical-url";

function errorResponse(
  message: string,
  status: number
) {
  return NextResponse.json(
    { success: false, error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function POST(
  request: NextRequest
) {
  // ─── Supabase Admin ─────────────────────────────────────

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error(
      "Payment create API: Missing Supabase config."
    );
    return errorResponse(
      "Payment service is not configured.",
      500
    );
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

  // ─── Parse Request ──────────────────────────────────────

  let body: { paymentOrderId?: string; resumeToken?: string };

  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "Invalid request body.",
      400
    );
  }

  const paymentOrderId =
    typeof body.paymentOrderId === "string"
      ? body.paymentOrderId.trim()
      : "";

  if (!paymentOrderId) {
    return errorResponse(
      "Payment order ID is required.",
      400
    );
  }

  // ─── Token Input Conflict Hardening ─────────────────────
  const headerToken =
    request.headers.get("x-payment-resume-token")?.trim() || "";
  const bodyToken =
    typeof body.resumeToken === "string"
      ? body.resumeToken.trim()
      : "";

  if (headerToken && bodyToken && headerToken !== bodyToken) {
    return errorResponse(
      "Mismatched payment resume tokens provided.",
      400
    );
  }

  const resumeToken = headerToken || bodyToken;

  // ─── Look Up Payment Order ──────────────────────────────

  const {
    data: paymentOrder,
    error: lookupError,
  } = await supabaseAdmin
    .from("payment_orders")
    .select(
      `
      id,
      order_reference,
      payer_participant_id,
      amount,
      currency,
      gateway,
      gateway_order_id,
      status
    `
    )
    .eq("id", paymentOrderId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      "Payment order lookup failed:",
      lookupError
    );
    return errorResponse(
      "Could not find the payment order.",
      500
    );
  }

  if (!paymentOrder) {
    return errorResponse(
      "Payment order not found.",
      404
    );
  }

  if (paymentOrder.status !== "pending") {
    return errorResponse(
      paymentOrder.status === "paid"
        ? "This payment has already been completed."
        : `Payment order is ${paymentOrder.status}.`,
      400
    );
  }

  if (
    Number(paymentOrder.amount) <= 0
  ) {
    return errorResponse(
      "Payment order has no amount.",
      400
    );
  }

  // ─── Look Up Payer Info ─────────────────────────────────

  if (!paymentOrder.payer_participant_id) {
    return errorResponse(
      "Payment order is missing payer information.",
      400
    );
  }

  const {
    data: payer,
    error: payerError,
  } = await supabaseAdmin
    .from("participants")
    .select("id, participant_id, name, email, phone")
    .eq(
      "id",
      paymentOrder.payer_participant_id
    )
    .maybeSingle();

  if (payerError || !payer) {
    console.error(
      "Payer lookup failed:",
      payerError
    );
    return errorResponse(
      "Payer information not found.",
      404
    );
  }

  // ─── Verify Internal Linked Items Consistency ───────────

  const { data: orderItems, error: itemsError } = await supabaseAdmin
    .from("payment_order_items")
    .select("id, participant_id, participant_event_id, amount")
    .eq("payment_order_id", paymentOrder.id);

  if (itemsError || !orderItems || orderItems.length === 0) {
    return errorResponse(
      "Payment order has no linked items.",
      400
    );
  }

  const itemsMismatch = orderItems.some(
    (item) => item.participant_id !== paymentOrder.payer_participant_id
  );

  if (itemsMismatch) {
    return errorResponse(
      "Payment order items are inconsistent.",
      403
    );
  }

  // ─── Authorization Boundary (Session or Resume Token) ───

  const session = await getRegistrationSession();
  let isAuthorized = false;

  // Option A: Active Registration Session
  if (session.authenticated && session.email) {
    if (
      payer.email &&
      session.email.toLowerCase() === payer.email.trim().toLowerCase()
    ) {
      isAuthorized = true;
    }
  }

  // Option B: Signed Payment Resume Token
  if (!isAuthorized && resumeToken) {
    const tokenResult = verifyPaymentResumeToken(resumeToken);
    if (tokenResult.valid && tokenResult.payload) {
      const payload = tokenResult.payload;
      if (
        payload.paymentOrderId === paymentOrder.id &&
        payload.payerParticipantUuid === paymentOrder.payer_participant_id &&
        payload.participantId === payer.participant_id
      ) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    if (!session.authenticated && !resumeToken) {
      return errorResponse(
        "Payment authorization required.",
        401
      );
    }
    return errorResponse(
      "Unauthorized access to this payment order.",
      403
    );
  }

  const payerName = payer.name ?? "";
  const payerEmail = payer.email ?? "";
  const payerPhone = payer.phone ?? "";

  const baseUrlResult = getCanonicalPaymentBaseUrl(request);
  if (!baseUrlResult.success) {
    console.error(baseUrlResult.internalLog);
    return errorResponse(baseUrlResult.error, 500);
  }
  const resolvedBaseUrl = baseUrlResult.origin;

  // ─── If Gateway Order Already Exists, Reuse It ──────────

  if (paymentOrder.gateway_order_id) {
    const gateway = getPaymentGateway(
      paymentOrder.gateway ?? undefined
    );

    // ─── STUCK/ALREADY-CAPTURED TRANSACTION RECOVERY ────────
    let isAlreadyPaid = false;
    let fetchedGatewayPaymentId = "";
    try {
      const details = await gateway.fetchPaymentDetails(paymentOrder.gateway_order_id);
      if (details.status === "paid") {
        isAlreadyPaid = true;
        fetchedGatewayPaymentId = details.gatewayPaymentId;
      }
    } catch (err) {
      console.error("PayU Verify Payment failed, timed out, or transaction not found. Failing closed:", err instanceof Error ? err.message : String(err));
      return errorResponse(
        "Unable to verify current payment status with the gateway. Please try again later.",
        502
      );
    }

    if (isAlreadyPaid) {
      console.log("Transaction already captured on gateway. Recovering stuck transaction.", {
        paymentOrderId: paymentOrder.id,
        gatewayOrderId: paymentOrder.gateway_order_id
      });

      const { data: eventClaim, error: claimError } = await supabaseAdmin
        .from("processed_payment_events")
        .insert({
          order_id: paymentOrder.id,
          payment_id: fetchedGatewayPaymentId,
          event_type: "payment.captured.recovery",
        })
        .select("id")
        .maybeSingle();

      const isDuplicate = claimError?.code === "23505" || (!claimError && !eventClaim);

      if (!isDuplicate) {
        await supabaseAdmin
          .from("payment_orders")
          .update({
            status: "paid",
            gateway_payment_id: fetchedGatewayPaymentId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", paymentOrder.id);

        const { data: orderItems } = await supabaseAdmin
          .from("payment_order_items")
          .select("participant_event_id, participant_id")
          .eq("payment_order_id", paymentOrder.id);

        const participantEventIds = (orderItems ?? [])
          .map((item) => item.participant_event_id)
          .filter(Boolean) as string[];

        if (participantEventIds.length > 0) {
          await supabaseAdmin
            .from("participant_events")
            .update({
              payment_status: "paid",
              payment_id: fetchedGatewayPaymentId,
              updated_at: new Date().toISOString(),
            })
            .in("id", participantEventIds);
        }

        if (paymentOrder.payer_participant_id) {
          await supabaseAdmin
            .from("payments")
            .insert({
              participant_id: paymentOrder.payer_participant_id,
              participant_event_id: participantEventIds[0] ?? null,
              amount: Number(paymentOrder.amount),
              status: "paid",
              gateway: gateway.name,
              gateway_payment_id: fetchedGatewayPaymentId,
              gateway_order_id: paymentOrder.gateway_order_id,
            });
        }

        const { ensurePaymentConfirmationSent } = await import("@/lib/payments/post-payment");
        await ensurePaymentConfirmationSent(paymentOrder.id);
      }

      return NextResponse.json(
        {
          success: true,
          gatewayOrderId: paymentOrder.gateway_order_id,
          alreadyPaid: true,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // If it's not paid, we cannot safely reuse the txnid (PayU rejects reused txnids that were attempted).
    // The DB schema does not safely support multiple gateway attempts per payment_order without overwriting history.
    console.warn("Existing payment order is not paid (status: pending/failed). Database schema does not support multiple gateway order IDs per payment_order safely without overwriting history. Rejecting reuse.");
    return errorResponse(
      "This payment session has already been initiated. If you did not complete the payment, please cancel this registration and create a new one to try again.",
      400
    );
  }

  // ─── Create Gateway Order ──────────────────────────────

  const gateway = getPaymentGateway();

  let gatewayResult;

  try {
    gatewayResult = await gateway.createOrder({
      orderReference:
        paymentOrder.order_reference,
      amountInSmallestUnit:
        Number(paymentOrder.amount) * 100,
      currency:
        paymentOrder.currency ?? "INR",
      payer: {
        name: payerName,
        email: payerEmail,
        phone: payerPhone,
      },
    });
  } catch (err) {
    captureException(err, {
      route: "/api/payments/create",
      orderId: paymentOrder.id,
      extra: { paymentOrderId: paymentOrder.id },
    });
    console.error(
      "Gateway order creation failed:",
      err
    );
    return errorResponse(
      "Could not create payment order with the payment gateway.",
      500
    );
  }

  // ─── Update Payment Order With Gateway Info ─────────────

  const { error: updateError } =
    await supabaseAdmin
      .from("payment_orders")
      .update({
        gateway: gateway.name,
        gateway_order_id:
          gatewayResult.gatewayOrderId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentOrderId);

  if (updateError) {
    console.error(
      "Failed to update payment order with gateway info:",
      updateError
    );
    // Non-fatal: the gateway order exists, frontend can still proceed
  }

  // ─── Build Checkout Config ─────────────────────────────

  const checkoutConfig =
    gateway.getCheckoutConfig({
      gatewayOrderId:
        gatewayResult.gatewayOrderId,
      amount:
        Number(paymentOrder.amount) * 100,
      currency:
        paymentOrder.currency ?? "INR",
      payer: {
        name: payerName,
        email: payerEmail,
        phone: payerPhone,
      },
      orderReference:
        paymentOrder.order_reference,
      baseUrl: resolvedBaseUrl,
    });

  console.log(
    "Gateway order created:",
    {
      paymentOrderId,
      gatewayOrderId:
        gatewayResult.gatewayOrderId,
      gateway: gateway.name,
      amount: paymentOrder.amount,
    }
  );

  return NextResponse.json(
    {
      success: true,
      gatewayOrderId:
        gatewayResult.gatewayOrderId,
      checkoutConfig,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
