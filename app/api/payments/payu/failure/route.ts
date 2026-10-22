import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPaymentGateway } from "@/lib/payments";
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
    console.error("PayU failure API: Missing Supabase config.");
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

  if (!gatewayOrderId) {
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
    console.error("Payment order lookup for failure route failed:", lookupError);
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

  // ─── Authenticate Failure Before Mutating Order Status ─────────────
  // A user-supplied txnid MUST NOT be sufficient to mark an order failed.
  // We require either:
  //   1. A cryptographically verified PayU response hash (isSignatureValid === true)
  //   2. Authoritative server-to-server verification with PayU confirming definitive terminal failure
  let isAuthoritativelyFailed = false;

  const isSignatureValid = validateResult.valid && !!validateResult.event;

  if (isSignatureValid && validateResult.event?.status === "failed") {
    isAuthoritativelyFailed = true;
  } else {
    // Hash check was invalid or absent. Query PayU server-to-server to prevent order-ID tampering.
    try {
      const details = await gateway.fetchPaymentDetails(gatewayOrderId);
      const rawLower = (details.rawStatus || "").toLowerCase().trim();
      const unmappedLower = (details.unmappedStatus || "").toLowerCase().trim();

      const isTerminalFailure =
        details.status === "failed" &&
        (
          rawLower === "failure" ||
          rawLower === "failed" ||
          rawLower === "bounced" ||
          rawLower === "usercancelled" ||
          rawLower === "dropped"
        );

      if (isTerminalFailure) {
        isAuthoritativelyFailed = true;
      } else {
        console.warn(
          `[PAYU FAILURE] Unauthenticated failure callback rejected: Gateway reported non-terminal/unresolved status '${details.status}' (raw: '${details.rawStatus}'). Order will NOT be marked failed.`
        );
      }
    } catch (verifyErr) {
      console.error(
        `[PAYU FAILURE] Server-to-server verification failed for unauthenticated failure request (${gatewayOrderId}):`,
        verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
      );
      // Fail closed: Never mark an order failed if we cannot authenticate the failure!
    }
  }

  if (isAuthoritativelyFailed) {
    try {
      await supabaseAdmin.rpc("process_payment_failure", {
        p_gateway_order_id: gatewayOrderId,
      });
    } catch (err) {
      console.error("Error executing process_payment_failure on failure route:", err);
    }
  }

  // The resume token allows review of the transaction and retry
  return NextResponse.redirect(new URL(resumeUrl), 303);
}
