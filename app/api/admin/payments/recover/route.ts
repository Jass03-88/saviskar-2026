import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/supabase/server";
import { createPaymentResumeToken } from "@/lib/payments/resume-token";
import {
  getCanonicalPaymentBaseUrl,
  STABLE_PRODUCTION_ORIGIN,
} from "@/lib/payments/canonical-url";
import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";

export const dynamic = "force-dynamic";

/**
 * Authenticated Admin Payment Recovery Route
 *
 * Provides a secure, administrative-only method to:
 * 1. Look up an existing PAID order by paymentOrderId or participantId.
 * 2. Issue a fresh 24-hour signed payment resume link pointing to the canonical origin.
 * 3. Optionally trigger receipt/confirmation email re-dispatch idempotently.
 *
 * Security Invariants:
 * - Requires active admin authentication via requireAdmin().
 * - Rejects any public access without valid admin session cookies.
 * - Only operates on orders with status = 'paid' (does not mutate payment state).
 * - Never leaks payment or participant credentials publicly.
 */
export async function POST(request: NextRequest) {
  // 1. Authenticate Admin Session
  const auth = await requireAdmin();

  if (auth.error) {
    return NextResponse.json(
      {
        success: false,
        error:
          auth.error === "MFA_REQUIRED"
            ? "Master Admin MFA verification required."
            : auth.error,
      },
      {
        status: auth.status,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  // 2. Parse and Validate Request Payload
  let body: {
    paymentOrderId?: string;
    participantId?: string;
    resendEmail?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const paymentOrderId =
    typeof body.paymentOrderId === "string" ? body.paymentOrderId.trim() : "";
  const participantId =
    typeof body.participantId === "string"
      ? body.participantId.trim().toUpperCase()
      : "";
  const resendEmail = body.resendEmail === true;

  if (!paymentOrderId && !participantId) {
    return NextResponse.json(
      {
        success: false,
        error: "Either paymentOrderId or participantId must be provided.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // 3. Initialize Supabase Admin Client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return NextResponse.json(
      { success: false, error: "Database service is not configured." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // 4. Resolve Payment Order and Participant Records
  let orderData: {
    id: string;
    status: string;
    order_reference: string;
    amount: number;
    currency: string;
    payer_participant_id: string;
    receipt_email_sent_at: string | null;
  } | null = null;

  let participantData: {
    id: string;
    participant_id: string;
    name: string;
    email: string;
  } | null = null;

  if (paymentOrderId) {
    const { data: order, error: orderError } = await supabaseAdmin
      .from("payment_orders")
      .select("id, status, order_reference, amount, currency, payer_participant_id, receipt_email_sent_at")
      .eq("id", paymentOrderId)
      .maybeSingle();

    if (orderError || !order) {
      return NextResponse.json(
        { success: false, error: "Payment order not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    orderData = order;

    const { data: participant, error: pError } = await supabaseAdmin
      .from("participants")
      .select("id, participant_id, name, email")
      .eq("id", order.payer_participant_id)
      .maybeSingle();

    if (pError || !participant) {
      return NextResponse.json(
        { success: false, error: "Associated participant record not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    participantData = participant;
  } else if (participantId) {
    const { data: participant, error: pError } = await supabaseAdmin
      .from("participants")
      .select("id, participant_id, name, email")
      .eq("participant_id", participantId)
      .maybeSingle();

    if (pError || !participant) {
      return NextResponse.json(
        { success: false, error: "Participant not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    participantData = participant;

    const { data: order, error: orderError } = await supabaseAdmin
      .from("payment_orders")
      .select("id, status, order_reference, amount, currency, payer_participant_id, receipt_email_sent_at")
      .eq("payer_participant_id", participant.id)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (orderError || !order) {
      return NextResponse.json(
        {
          success: false,
          error: "No paid payment order found for this participant.",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    orderData = order;
  }

  if (!orderData || !participantData) {
    return NextResponse.json(
      { success: false, error: "Order or participant record could not be resolved." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  // 5. Invariant: Order Must Be Confirmed Paid
  if (orderData.status !== "paid") {
    return NextResponse.json(
      {
        success: false,
        error: `Payment order is not paid (current status: ${orderData.status}). Recovery is only for confirmed paid orders.`,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // 6. Generate Fresh Signed Resume Token and URL
  const canonicalResult = getCanonicalPaymentBaseUrl(request);
  const baseUrl = canonicalResult.success
    ? canonicalResult.origin
    : STABLE_PRODUCTION_ORIGIN;

  const resumeToken = createPaymentResumeToken({
    paymentOrderId: orderData.id,
    participantId: participantData.participant_id,
    payerParticipantUuid: participantData.id,
  });

  const resumeUrl = `${baseUrl.replace(/\/+$/, "")}/payment/resume?token=${encodeURIComponent(resumeToken)}`;

  // 7. Optional Confirmation Email Re-dispatch
  let emailDispatched = false;
  if (resendEmail) {
    if (orderData.receipt_email_sent_at) {
      await supabaseAdmin
        .from("payment_orders")
        .update({
          receipt_email_sent_at: null,
          receipt_email_claim_id: null,
          receipt_email_claimed_at: null,
        })
        .eq("id", orderData.id);
    }
    await ensurePaymentConfirmationSent(orderData.id);
    emailDispatched = true;
  }

  return NextResponse.json(
    {
      success: true,
      paymentOrderId: orderData.id,
      orderReference: orderData.order_reference,
      participantId: participantData.participant_id,
      participantName: participantData.name,
      participantEmail: participantData.email,
      resumeToken,
      resumeUrl,
      emailDispatched,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
