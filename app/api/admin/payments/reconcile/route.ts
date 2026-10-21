import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, requireMasterAdmin } from "@/lib/supabase/server";
import {
  reconcilePaymentOrder,
  retryReconciliationEmail,
} from "@/lib/admin/payment-reconciliation";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/payments/reconcile
 *
 * Dedicated Server-Side Payment Reconciliation & Settlement Endpoint.
 *
 * Security Invariants:
 * 1. Role-Based Financial Authorization:
 *    - "reconcile" action strictly requires Master Admin privileges (requireMasterAdmin).
 *    - "retry_email" action is independently authorized for Administrators (requireAdmin).
 * 2. Independent Server-Side Verification: reloads the authoritative order and re-checks
 *    gateway verification immediately before executing settlement.
 * 3. Never trust client-supplied status or amount: all calculations use database records.
 * 4. Local Simulation Protection: rejects reconciliation when running in local preview mode.
 * 5. Idempotent Settlement: invokes the existing `process_payment_success` database RPC.
 * 6. Audit Trail: records every settlement attempt and outcome in admin_audit_logs.
 * 7. Resilient Email Notification: attempts to send an updated registration/receipt email.
 *    Email failures are recorded without reverting confirmed financial settlement.
 */
export async function POST(request: NextRequest) {
  // 1. Parse Request Body
  let body: {
    action?: "reconcile" | "retry_email";
    paymentOrderId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const action = body.action || "reconcile";

  // 2. Authenticate Session with Appropriate Financial Role
  // Financial settlement mutation requires Master Admin; email retry requires Admin.
  const auth =
    action === "reconcile"
      ? await requireMasterAdmin()
      : await requireAdmin();

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

  const paymentOrderId =
    typeof body.paymentOrderId === "string" ? body.paymentOrderId.trim() : "";

  if (!paymentOrderId) {
    return NextResponse.json(
      { success: false, error: "Missing required paymentOrderId parameter." },
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

  const adminEmail = auth.user.email || "admin@saviskar.internal";

  try {
    if (action === "retry_email") {
      const emailResult = await retryReconciliationEmail({
        supabaseAdmin,
        adminId: auth.user.id,
        adminEmail,
        paymentOrderId,
      });

      return NextResponse.json(
        { success: emailResult.sent, emailResult },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const reconciliationResult = await reconcilePaymentOrder({
      supabaseAdmin,
      adminId: auth.user.id,
      adminEmail,
      paymentOrderId,
    });

    const statusCode = reconciliationResult.success ? 200 : 400;

    return NextResponse.json(reconciliationResult, {
      status: statusCode,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Reconciliation endpoint error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Reconciliation failed.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
