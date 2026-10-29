import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { captureException } from "@/lib/monitoring/error-reporter";
import { getPaymentGateway } from "@/lib/payments";
import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";
import { generatePaymentResumeUrl } from "@/lib/payments/resume-token";
import { getCanonicalPaymentBaseUrl, STABLE_PRODUCTION_ORIGIN } from "@/lib/payments/canonical-url";
import { WebhookEvent } from "@/lib/payments/types";

export async function POST(request: NextRequest) {
  // ─── Resolve Canonical Redirect Base Origin ─────────────
  const baseUrlResult = getCanonicalPaymentBaseUrl(request);
  if (!baseUrlResult.success) {
    console.error(baseUrlResult.internalLog);
  }
  const redirectBase = baseUrlResult.success ? baseUrlResult.origin : STABLE_PRODUCTION_ORIGIN;

  // ─── Supabase Admin ─────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("PayU success API: Missing Supabase config.");
    return NextResponse.redirect(new URL("/register?error=server-config", redirectBase), 303);
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
    return NextResponse.redirect(new URL("/register?error=invalid-request", redirectBase), 303);
  }

  const gateway = getPaymentGateway("payu");

  // Validate the webhook / response hash
  const validateResult = gateway.validateWebhook({ body: bodyText, signature: "" });
  const rawParams = new URLSearchParams(bodyText);

  const gatewayOrderId = validateResult.event?.gatewayOrderId || rawParams.get("txnid")?.trim() || "";
  let gatewayPaymentId = validateResult.event?.gatewayPaymentId || rawParams.get("mihpayid")?.trim() || "";
  const isSignatureValid = validateResult.valid && !!validateResult.event;

  if (!gatewayOrderId) {
    console.error("PayU success API: Missing gatewayOrderId (txnid).");
    return NextResponse.redirect(new URL("/register?error=missing-order-id", redirectBase), 303);
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
    console.error("Payment order lookup for verification failed:", lookupError, { gatewayOrderId });
    return NextResponse.redirect(new URL("/register?error=order-not-found", redirectBase), 303);
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
    baseUrl: redirectBase,
  });

  // ─── Idempotency: Already Paid ──────────────────────────
  if (paymentOrder.status === "paid") {
    // Ensure confirmation email & receipt invoice are delivered even if settled by webhook moments before
    await ensurePaymentConfirmationSent(paymentOrderId);
    return NextResponse.redirect(new URL(resumeUrl), 303);
  }

  // If browser form POST hash failed, log and rely on authoritative server-to-server verification:
  if (!isSignatureValid) {
    console.warn(
      `[PAYU SUCCESS] Response hash check did not match (${validateResult.error}); performing authoritative server-to-server verification via verify_payment for ${gatewayOrderId}...`
    );
  }

  let verifiedAmountPaise = Number(paymentOrder.amount) * 100;
  let verifiedCurrency = paymentOrder.currency || "INR";

  // ─── P0-2: Server-Side Payment Verification ───────────
  try {
    const fetchedPayment = await gateway.fetchPaymentDetails(gatewayOrderId); // PayU Verify Payment API uses txnid (gatewayOrderId)
    
    verifiedAmountPaise = fetchedPayment.amount;
    verifiedCurrency = fetchedPayment.currency || verifiedCurrency;

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

    if (!gatewayPaymentId && fetchedPayment.gatewayPaymentId) {
      gatewayPaymentId = fetchedPayment.gatewayPaymentId;
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
    redirectUrl.searchParams.set("error", !isSignatureValid ? "signature-invalid" : "verification-failed");
    return NextResponse.redirect(redirectUrl, 303);
  }

  // ─── Execute Atomic Settlement RPC ────────────────────────
  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("process_payment_success", {
    p_gateway_order_id: gatewayOrderId,
    p_gateway_payment_id: gatewayPaymentId,
    p_amount_paise: verifiedAmountPaise,
    p_currency: verifiedCurrency,
    p_gateway_name: gateway.name,
  });

  if (rpcError) {
    console.error("Database error executing payment settlement RPC:", rpcError);
    const redirectUrl = new URL(resumeUrl);

    // Capability Gate: Fail gracefully if RPC is missing
    if (
      rpcError.code === "PGRST202" || 
      rpcError.code === "42883" || 
      (rpcError.message && rpcError.message.includes("does not exist"))
    ) {
      console.warn("Capability Gate: Atomic settlement RPC not available. Redirecting to retryable state.");
      redirectUrl.searchParams.set("error", "system-upgrade");
      return NextResponse.redirect(redirectUrl, 303);
    }

    redirectUrl.searchParams.set("error", "database-error");
    return NextResponse.redirect(redirectUrl, 303);
  }

  if (rpcData && !rpcData.success) {
    console.error("Payment settlement RPC failed:", rpcData.error);
    const redirectUrl = new URL(resumeUrl);
    redirectUrl.searchParams.set("error", "settlement-failed");
    return NextResponse.redirect(redirectUrl, 303);
  }

  // Handle idempotent returns & conflicts
  if (rpcData?.action === "already_paid" || rpcData?.action === "already_processed" || rpcData?.action === "already_refunded") {
    console.log(`[PAYU SUCCESS] Order ${gatewayOrderId} was already settled. Proceeding to resume URL.`);
  } else if (rpcData?.action === "settled_with_accommodation_conflict") {
    console.warn(`[PAYU SUCCESS] Order ${gatewayOrderId} settled with accommodation date conflict (${rpcData.conflicts_count} conflict(s)). Preserved audit trail and flagged for admin reconciliation.`);
  } else {
    console.log(`[PAYU SUCCESS] Order ${gatewayOrderId} settled successfully.`);
  }

  // ─── Trigger Idempotent Post-Payment Logic ─────────────
  await ensurePaymentConfirmationSent(paymentOrderId);

  return NextResponse.redirect(new URL(resumeUrl), 303);
}
