/**
 * POST /api/payments/webhook
 *
 * Razorpay webhook handler for backup payment verification.
 *
 * Razorpay sends webhooks for events like:
 *   - payment.captured
 *   - payment.failed
 *
 * This handler:
 *   1. Validates the webhook signature
 *   2. Parses the event
 *   3. Updates payment_orders, participant_events, and payments
 *   4. Is fully idempotent (safe to receive duplicate events)
 *
 * Setup in Razorpay Dashboard:
 *   URL: https://your-domain.com/api/payments/webhook
 *   Events: payment.captured, payment.failed
 *   Secret: set as RAZORPAY_WEBHOOK_SECRET in .env.local
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPaymentGateway } from "@/lib/payments";

export async function POST(
  request: NextRequest
) {
  // ─── Read Raw Body + Signature ──────────────────────────

  const rawBody = await request.text();
  const signature =
    request.headers.get(
      "x-razorpay-signature"
    ) ?? "";

  if (!rawBody || !signature) {
    return new Response(
      "Missing body or signature.",
      { status: 400 }
    );
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
    // Return 200 so Razorpay doesn't retry
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

  const {
    data: paymentOrder,
    error: lookupError,
  } = await supabaseAdmin
    .from("payment_orders")
    .select(
      "id, status, payer_participant_id, amount"
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

  // ─── Handle Event ──────────────────────────────────────

  if (event.status === "paid") {
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
        (item: any) =>
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

  // Always return 200 so Razorpay doesn't retry
  return new Response("OK", {
    status: 200,
  });
}
