import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/supabase/server";
import { verifyParticipantPayments } from "@/lib/admin/payment-verification";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/payments/verify
 *
 * Dedicated Server-Side Read-Only Payment Verification Endpoint.
 *
 * Security & Financial Invariants:
 * 1. Requires active administrator session (requireAdmin()).
 * 2. Strictly read-only: never modifies payment orders, registrations, accommodations or receipts.
 * 3. Never triggers emails or creates transactions.
 * 4. Deduplicates shared orders across participants.
 * 5. Records a sanitized audit event in admin_audit_logs without leaking secrets or credentials.
 * 6. Uses decimal-safe monetary arithmetic.
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

  // 2. Parse Request
  let body: {
    participantIds?: string[];
    orderIds?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const participantIds = Array.isArray(body.participantIds)
    ? Array.from(new Set(body.participantIds.filter((id) => typeof id === "string" && id.trim().length > 0)))
    : [];

  const orderIds = Array.isArray(body.orderIds)
    ? Array.from(new Set(body.orderIds.filter((id) => typeof id === "string" && id.trim().length > 0)))
    : [];

  if (participantIds.length === 0 && orderIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "No participant or payment order identifiers provided." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // 3. Supabase Admin Client
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

  try {
    // 4. Run Read-Only Verification
    const verification = await verifyParticipantPayments({
      supabaseAdmin,
      participantIds,
      orderIds,
    });

    // 5. Record Sanitized Audit Log (Part E)
    try {
      const sanitizedOutcomes = verification.orders.map((o) => ({
        orderReference: o.orderReference,
        gatewayOrderId: o.gatewayOrderId,
        outcome: o.outcome,
        expectedAmount: o.expectedAmount,
        gatewayAmount: o.gatewayReportedAmount,
        localStatus: o.localOrderStatus,
        gatewayStatus: o.authoritativeGatewayStatus,
      }));

      await supabaseAdmin.from("admin_audit_logs").insert({
        admin_id: auth.user.id,
        action_type: "PAYMENT_VERIFICATION_CHECK",
        target_id: participantIds[0] || null,
        details: {
          admin_email: auth.user.email,
          participant_count: participantIds.length,
          participant_ids: participantIds.slice(0, 50),
          summary: verification.summary,
          orders: sanitizedOutcomes,
          timestamp: verification.summary.verifiedAt,
        },
      });
    } catch (auditErr) {
      console.warn("Failed to write verification audit log:", auditErr);
    }

    return NextResponse.json(verification, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Payment verification service error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Payment verification failed.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
