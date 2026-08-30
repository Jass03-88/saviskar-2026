/**
 * POST /api/payments/verify
 *
 * Server-side payment verification after the user completes
 * the gateway checkout (e.g. Razorpay overlay).
 *
 * Request body:
 *   {
 *     paymentOrderId: string,        // our internal payment_orders.id
 *     razorpay_payment_id: string,
 *     razorpay_order_id: string,
 *     razorpay_signature: string
 *   }
 *
 * This route:
 *   1. Looks up the payment_orders row
 *   2. Verifies the gateway signature (HMAC-SHA256)
 *   3. Updates payment_orders.status → 'paid'
 *   4. Updates all linked participant_events.payment_status → 'paid'
 *   5. Creates a row in the payments table
 *   6. Returns { verified: true, participantId }
 *
 * Security: Payment is NEVER marked paid by the frontend alone.
 * This server-side verification is the only path to status = 'paid'.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPaymentGateway } from "@/lib/payments";
import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";

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
      "Payment verify API: Missing Supabase config."
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

  let body: {
    paymentOrderId?: string;
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  };

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

  const gatewayPaymentId =
    typeof body.razorpay_payment_id === "string"
      ? body.razorpay_payment_id.trim()
      : "";

  const gatewayOrderId =
    typeof body.razorpay_order_id === "string"
      ? body.razorpay_order_id.trim()
      : "";

  const gatewaySignature =
    typeof body.razorpay_signature === "string"
      ? body.razorpay_signature.trim()
      : "";

  if (
    !paymentOrderId ||
    !gatewayPaymentId ||
    !gatewayOrderId ||
    !gatewaySignature
  ) {
    return errorResponse(
      "Missing required payment verification fields.",
      400
    );
  }

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
      "Payment order lookup for verification failed:",
      lookupError
    );
    return errorResponse(
      "Could not verify the payment.",
      500
    );
  }

  if (!paymentOrder) {
    return errorResponse(
      "Payment order not found.",
      404
    );
  }

  // ─── Idempotency: Already Paid ──────────────────────────

  if (paymentOrder.status === "paid") {
    // Look up the participant ID for the response
    let participantPublicId = "";
    if (paymentOrder.payer_participant_id) {
      const { data: payer } =
        await supabaseAdmin
          .from("participants")
          .select("participant_id")
          .eq(
            "id",
            paymentOrder.payer_participant_id
          )
          .maybeSingle();
      participantPublicId =
        payer?.participant_id ?? "";
    }

    return NextResponse.json(
      {
        success: true,
        verified: true,
        alreadyPaid: true,
        participantId: participantPublicId,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // ─── P0-1: Bind Gateway Order to DB Record ─────────────

  if (paymentOrder.gateway_order_id !== gatewayOrderId) {
    console.error(
      "Payment order binding mismatch:",
      {
        paymentOrderId,
        expected: paymentOrder.gateway_order_id,
        received: gatewayOrderId,
      }
    );
    return errorResponse(
      "Payment order mismatch: the supplied gateway order does not belong to this payment.",
      409
    );
  }

  // ─── Verify Gateway Signature ──────────────────────────

  const gateway = getPaymentGateway(
    paymentOrder.gateway ?? undefined
  );

  const verifyResult =
    await gateway.verifyPayment({
      gatewayOrderId,
      gatewayPaymentId,
      gatewaySignature,
    });

  if (!verifyResult.verified) {
    console.error(
      "Payment signature verification failed:",
      {
        paymentOrderId,
        gatewayOrderId,
        gatewayPaymentId,
      }
    );
    return errorResponse(
      "Payment verification failed. The payment signature is invalid.",
      400
    );
  }

  // ─── P0-2: Server-Side Payment Verification ───────────
  //
  // After signature passes, verify the payment directly
  // with Razorpay. FAIL CLOSED: if Razorpay is unreachable
  // or returns an error, the payment is NOT marked paid.

  try {
    const fetchedPayment =
      await gateway.fetchPaymentDetails(
        gatewayPaymentId
      );

    // Verify payment belongs to the expected gateway order
    if (
      fetchedPayment.gatewayOrderId !==
      gatewayOrderId
    ) {
      console.error(
        "Server-side verification: payment order mismatch",
        {
          paymentOrderId,
          expectedOrder: gatewayOrderId,
          actualOrder:
            fetchedPayment.gatewayOrderId,
        }
      );
      return errorResponse(
        "Payment verification failed: payment does not belong to the expected order.",
        400
      );
    }

    // Verify payment is captured (not merely authorized)
    if (fetchedPayment.status !== "captured") {
      console.error(
        "Server-side verification: payment not captured",
        {
          paymentOrderId,
          gatewayPaymentId,
          status: fetchedPayment.status,
        }
      );
      return errorResponse(
        "Payment verification failed: payment has not been captured.",
        400
      );
    }

    // Verify amount matches (DB stores in major units, Razorpay uses paise)
    const expectedAmountPaise =
      Number(paymentOrder.amount) * 100;

    if (
      fetchedPayment.amount !==
      expectedAmountPaise
    ) {
      console.error(
        "Server-side verification: amount mismatch",
        {
          paymentOrderId,
          expectedPaise: expectedAmountPaise,
          actualPaise: fetchedPayment.amount,
        }
      );
      return errorResponse(
        "Payment verification failed: payment amount does not match.",
        400
      );
    }

    // Verify currency
    const expectedCurrency =
      (
        paymentOrder.currency ?? "INR"
      ).toUpperCase();

    if (
      fetchedPayment.currency.toUpperCase() !==
      expectedCurrency
    ) {
      console.error(
        "Server-side verification: currency mismatch",
        {
          paymentOrderId,
          expected: expectedCurrency,
          actual: fetchedPayment.currency,
        }
      );
      return errorResponse(
        "Payment verification failed: currency mismatch.",
        400
      );
    }
  } catch (err) {
    // FAIL CLOSED: any error from fetchPaymentDetails
    // means we cannot verify — do NOT mark paid.
    console.error(
      "Server-side payment verification failed (fail-closed):",
      err instanceof Error
        ? err.message
        : String(err),
      { paymentOrderId, gatewayPaymentId }
    );
    return errorResponse(
      "Payment verification failed: could not confirm payment with the payment gateway.",
      502
    );
  }

  // ─── Mark Payment Order as Paid ─────────────────────────

  const { error: updateOrderError } =
    await supabaseAdmin
      .from("payment_orders")
      .update({
        status: "paid",
        gateway_payment_id: gatewayPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentOrderId);

  if (updateOrderError) {
    console.error(
      "Failed to update payment_orders status:",
      updateOrderError
    );
    return errorResponse(
      "Payment was verified but could not be recorded. Please contact support.",
      500
    );
  }

  // ─── Update Linked participant_events ───────────────────

  // Get all payment_order_items for this order
  const {
    data: orderItems,
    error: itemsError,
  } = await supabaseAdmin
    .from("payment_order_items")
    .select(
      "participant_event_id, participant_id"
    )
    .eq("payment_order_id", paymentOrderId);

  if (itemsError) {
    console.error(
      "Failed to look up payment order items:",
      itemsError
    );
  }

  const participantEventIds = (
    orderItems ?? []
  )
    .map(
      (item: any) =>
        item.participant_event_id
    )
    .filter(Boolean);

  if (participantEventIds.length > 0) {
    const {
      error: updateEventsError,
    } = await supabaseAdmin
      .from("participant_events")
      .update({
        payment_status: "paid",
        payment_id: gatewayPaymentId,
        updated_at: new Date().toISOString(),
      })
      .in("id", participantEventIds);

    if (updateEventsError) {
      console.error(
        "Failed to update participant_events payment status:",
        updateEventsError
      );
    }
  }

  // ─── Create Payment Record ─────────────────────────────

  if (paymentOrder.payer_participant_id) {
    const { error: paymentInsertError } =
      await supabaseAdmin
        .from("payments")
        .insert({
          participant_id:
            paymentOrder.payer_participant_id,
          participant_event_id:
            participantEventIds[0] ?? null,
          amount: Number(
            paymentOrder.amount
          ),
          status: "paid",
          gateway: gateway.name,
          gateway_payment_id:
            gatewayPaymentId,
          gateway_order_id: gatewayOrderId,
        });

    if (paymentInsertError) {
      console.error(
        "Failed to insert payment record:",
        paymentInsertError
      );
      // Non-fatal: the order is already marked paid
    }
  }

  // ─── Look Up Participant ID for Response ───────────────

  let participantPublicId = "";

  if (paymentOrder.payer_participant_id) {
    const { data: payer } =
      await supabaseAdmin
        .from("participants")
        .select("participant_id")
        .eq(
          "id",
          paymentOrder.payer_participant_id
        )
        .maybeSingle();

    participantPublicId =
      payer?.participant_id ?? "";
  }

  console.log("Payment verified:", {
    paymentOrderId,
    gatewayPaymentId,
    gateway: gateway.name,
    amount: paymentOrder.amount,
    participantEventIds,
  });

  // ─── Trigger Idempotent Post-Payment Logic ─────────────
  // (PDF receipt + email)
  await ensurePaymentConfirmationSent(paymentOrderId);

  return NextResponse.json(
    {
      success: true,
      verified: true,
      participantId: participantPublicId,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
