import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/supabase/server";
import {
  getPaymentAuditScope,
  verifyParticipantPayments,
  generateSanitizedDiagnosticReport,
} from "@/lib/admin/payment-verification";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/payments/audit
 *
 * Preflight Audit Scope Discovery.
 * Discovers candidate anomaly, retry-chain, and unresolved payment orders
 * across the database and returns counts so administrators can confirm scope.
 */
export async function GET() {
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
    const scope = await getPaymentAuditScope(supabaseAdmin);
    return NextResponse.json(
      {
        success: true,
        scope,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Payment audit scope discovery error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to load audit scope.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

/**
 * POST /api/admin/payments/audit
 *
 * Bounded Proactive Payment Audit Execution.
 * Executes server-side read-only verification across a bounded batch (max 50)
 * of candidate orders, generates sanitized markdown diagnostics, and records audit logs.
 */
export async function POST(request: NextRequest) {
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

  let body: {
    scopeFilter?: "all_anomalous" | "pending_and_failed" | "accommodations" | "unsettled_receipts" | "specific_orders";
    orderIds?: string[];
    limit?: number;
    offset?: number;
  } = {};

  try {
    body = await request.json();
  } catch {
    // Empty body is acceptable, uses default audit scope
    body = {};
  }

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
    const scope = await getPaymentAuditScope(supabaseAdmin);
    const requestedLimit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 25;
    const boundedLimit = Math.min(requestedLimit, 50); // Hard rate-limit bound: max 50 orders per batch
    const offset = typeof body.offset === "number" && body.offset >= 0 ? body.offset : 0;

    let targetOrderIds: string[] = [];

    if (Array.isArray(body.orderIds) && body.orderIds.length > 0) {
      targetOrderIds = body.orderIds
        .filter((id) => typeof id === "string" && id.trim().length > 0)
        .slice(0, boundedLimit);
    } else {
      targetOrderIds = scope.candidateOrderIds.slice(offset, offset + boundedLimit);
    }

    if (targetOrderIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          message: "No candidate payment orders required auditing.",
          scope,
          orders: [],
          summary: {
            totalParticipants: 0,
            totalOrders: 0,
            matchedPaid: 0,
            gatewayPaidLocalPending: 0,
            amountMismatch: 0,
            pendingUnverified: 0,
            otherMismatches: 0,
            verifiedAt: new Date().toISOString(),
            isLocalPreview: scope.isLocalPreview,
            environment: scope.environment,
          },
          diagnosticReportMarkdown: "# SAVISKAR 2026 — PAYMENT AUDIT REPORT\n\nNo candidate orders matched the selected audit filter.",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Run read-only verification on the bounded batch
    const verification = await verifyParticipantPayments({
      supabaseAdmin,
      orderIds: targetOrderIds,
    });

    // Generate sanitized diagnostic report
    const diagnosticReportMarkdown = generateSanitizedDiagnosticReport(verification);

    // Record audit event in admin_audit_logs
    try {
      await supabaseAdmin.from("admin_audit_logs").insert({
        admin_id: auth.user.id,
        action_type: "PAYMENT_RECONCILIATION_AUDIT_RUN",
        target_id: targetOrderIds[0] || null,
        details: {
          admin_email: auth.user.email,
          scope_filter: body.scopeFilter || "all_anomalous",
          batch_size: targetOrderIds.length,
          total_candidates: scope.totalCandidateOrders,
          summary: verification.summary,
          timestamp: verification.summary.verifiedAt,
        },
      });
    } catch (auditErr) {
      console.warn("Failed to write audit log for payment audit run:", auditErr);
    }

    return NextResponse.json(
      {
        success: true,
        scope,
        summary: verification.summary,
        orders: verification.orders,
        unlinkedItems: verification.unlinkedItems,
        findings: verification.findings,
        diagnosticReportMarkdown,
        batchInfo: {
          limit: boundedLimit,
          offset,
          auditedCount: targetOrderIds.length,
          totalCandidateOrders: scope.totalCandidateOrders,
          hasMore: offset + boundedLimit < scope.totalCandidateOrders,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Payment audit execution error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Payment audit execution failed.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
