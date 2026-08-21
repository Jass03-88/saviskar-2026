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
import { getPaymentGateway } from "@/lib/payments";

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

  let body: { paymentOrderId?: string };

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

  if (paymentOrder.status === "paid") {
    return errorResponse(
      "This payment has already been completed.",
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

  // ─── If Gateway Order Already Exists, Reuse It ──────────

  if (paymentOrder.gateway_order_id) {
    const gateway = getPaymentGateway(
      paymentOrder.gateway ?? undefined
    );

    const checkoutConfig =
      gateway.getCheckoutConfig({
        gatewayOrderId:
          paymentOrder.gateway_order_id,
        amount: Number(paymentOrder.amount) * 100,
        currency: paymentOrder.currency ?? "INR",
        payer: {},
        orderReference:
          paymentOrder.order_reference,
      });

    return NextResponse.json(
      {
        success: true,
        gatewayOrderId:
          paymentOrder.gateway_order_id,
        checkoutConfig,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // ─── Look Up Payer Info ─────────────────────────────────

  let payerName = "";
  let payerEmail = "";
  let payerPhone = "";

  if (paymentOrder.payer_participant_id) {
    const {
      data: payer,
      error: payerError,
    } = await supabaseAdmin
      .from("participants")
      .select("name, email, phone")
      .eq(
        "id",
        paymentOrder.payer_participant_id
      )
      .maybeSingle();

    if (payerError) {
      console.error(
        "Payer lookup failed:",
        payerError
      );
    }

    if (payer) {
      payerName = payer.name ?? "";
      payerEmail = payer.email ?? "";
      payerPhone = payer.phone ?? "";
    }
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
