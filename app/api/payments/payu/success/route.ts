import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { captureException } from "@/lib/monitoring/error-reporter";
import { getPaymentGateway } from "@/lib/payments";
import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";
import { generatePaymentResumeUrl } from "@/lib/payments/resume-token";
import { WebhookEvent } from "@/lib/payments/types";

export async function POST(request: NextRequest) {
  // ─── Supabase Admin ─────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("PayU success API: Missing Supabase config.");
    return NextResponse.redirect(new URL("/register?error=server-config", request.url), 303);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // ─── Parse Request ──────────────────────────────────────
  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch {
    return NextResponse.redirect(new URL("/register?error=invalid-request", request.url), 303);
  }

  const gateway = getPaymentGateway("payu");

  // Validate the webhook / response hash
  const validateResult = gateway.validateWebhook({ body: bodyText, signature: "" });

  if (!validateResult.valid || !validateResult.event) {
    console.error("PayU signature verification failed:", validateResult.error);
    return NextResponse.redirect(new URL("/register?error=signature-invalid", request.url), 303);
  }

  const event: WebhookEvent = validateResult.event;
  const gatewayOrderId = event.gatewayOrderId; // txnid
  const gatewayPaymentId = event.gatewayPaymentId; // mihpayid

  if (!gatewayOrderId) {
    return NextResponse.redirect(new URL("/register?error=missing-order-id", request.url), 303);
  }

  // ─── Look Up Payment Order ──────────────────────────────
  const { data: paymentOrder, error: lookupError } = await supabaseAdmin
    .from("payment_orders")
    .select(`
      id,
      order_reference,
      payer_participant_id,
      amount,
      currency,
      gateway,
      gateway_order_id,
      status
    `)
    .eq("gateway_order_id", gatewayOrderId)
    .maybeSingle();

  if (lookupError || !paymentOrder) {
    console.error("Payment order lookup for verification failed:", lookupError);
    return NextResponse.redirect(new URL("/register?error=order-not-found", request.url), 303);
  }

  const paymentOrderId = paymentOrder.id;

  // Find participant IDs for generating the resume token
  let participantPublicId = "";
  const payerParticipantUuid = paymentOrder.payer_participant_id ?? "";

  if (payerParticipantUuid) {
    const { data: payer } = await supabaseAdmin
      .from("participants")
      .select("participant_id")
      .eq("id", payerParticipantUuid)
      .maybeSingle();
    participantPublicId = payer?.participant_id ?? "";
  }

  const resumeUrl = generatePaymentResumeUrl({
    paymentOrderId,
    participantId: participantPublicId,
    payerParticipantUuid,
    baseUrl: process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin,
  });

  // ─── Idempotency: Already Paid ──────────────────────────
  if (paymentOrder.status === "paid") {
    return NextResponse.redirect(new URL(resumeUrl), 303);
  }

  // ─── P0-2: Server-Side Payment Verification ───────────
  try {
    const fetchedPayment = await gateway.fetchPaymentDetails(gatewayOrderId); // PayU Verify Payment API uses txnid (gatewayOrderId)

    if (fetchedPayment.status !== "paid") {
      console.error("Server-side verification: payment not paid", {
        paymentOrderId,
        status: fetchedPayment.status,
      });
      const redirectUrl = new URL(resumeUrl);
      redirectUrl.searchParams.set("error", "payment-not-paid");
      return NextResponse.redirect(redirectUrl, 303);
    }

    const expectedAmountPaise = Number(paymentOrder.amount) * 100;
    if (fetchedPayment.amount !== expectedAmountPaise) {
      console.error("Server-side verification: amount mismatch", {
        paymentOrderId,
        expectedPaise: expectedAmountPaise,
        actualPaise: fetchedPayment.amount,
      });
      const redirectUrl = new URL(resumeUrl);
      redirectUrl.searchParams.set("error", "amount-mismatch");
      return NextResponse.redirect(redirectUrl, 303);
    }
  } catch (err) {
    captureException(err, {
      route: "/api/payments/payu/success",
      orderId: paymentOrderId,
      paymentId: gatewayPaymentId,
      extra: { paymentOrderId, gatewayPaymentId },
    });
    console.error("Server-side payment verification failed (fail-closed):", err instanceof Error ? err.message : String(err));
    const redirectUrl = new URL(resumeUrl);
    redirectUrl.searchParams.set("error", "verification-failed");
    return NextResponse.redirect(redirectUrl, 303);
  }

  // ─── Database-Enforced Idempotency Claim ─────────────────
  const { data: eventClaim, error: claimError } = await supabaseAdmin
    .from("processed_payment_events")
    .insert({
      order_id: paymentOrderId,
      payment_id: gatewayPaymentId,
      event_type: "payment.captured",
    })
    .select("id")
    .maybeSingle();

  const isDuplicate = claimError?.code === "23505" || (!claimError && !eventClaim);

  if (claimError && !isDuplicate) {
    console.error("Database error claiming payment event:", claimError);
    const redirectUrl = new URL(resumeUrl);
    redirectUrl.searchParams.set("error", "database-error");
    return NextResponse.redirect(redirectUrl, 303);
  }

  if (isDuplicate) {
    return NextResponse.redirect(new URL(resumeUrl), 303);
  }

  // ─── Mark Payment Order as Paid ─────────────────────────
  const { error: updateOrderError } = await supabaseAdmin
    .from("payment_orders")
    .update({
      status: "paid",
      gateway_payment_id: gatewayPaymentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentOrderId);

  if (updateOrderError) {
    console.error("Failed to update payment_orders status:", updateOrderError);
    const redirectUrl = new URL(resumeUrl);
    redirectUrl.searchParams.set("error", "database-error");
    return NextResponse.redirect(redirectUrl, 303);
  }

  // ─── Update Linked participant_events ───────────────────
  const { data: orderItems } = await supabaseAdmin
    .from("payment_order_items")
    .select("participant_event_id, participant_id")
    .eq("payment_order_id", paymentOrderId);

  const participantEventIds = (orderItems ?? [])
    .map((item) => item.participant_event_id)
    .filter(Boolean) as string[];

  if (participantEventIds.length > 0) {
    await supabaseAdmin
      .from("participant_events")
      .update({
        payment_status: "paid",
        payment_id: gatewayPaymentId,
        updated_at: new Date().toISOString(),
      })
      .in("id", participantEventIds);
  }

  // ─── Create Payment Record ─────────────────────────────
  if (payerParticipantUuid) {
    await supabaseAdmin
      .from("payments")
      .insert({
        participant_id: payerParticipantUuid,
        participant_event_id: participantEventIds[0] ?? null,
        amount: Number(paymentOrder.amount),
        status: "paid",
        gateway: gateway.name,
        gateway_payment_id: gatewayPaymentId,
        gateway_order_id: gatewayOrderId,
      });
  }

  // ─── Trigger Idempotent Post-Payment Logic ─────────────
  await ensurePaymentConfirmationSent(paymentOrderId);

  return NextResponse.redirect(new URL(resumeUrl), 303);
}
