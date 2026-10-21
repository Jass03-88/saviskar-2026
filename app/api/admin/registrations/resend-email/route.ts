import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/supabase/server";
import {
  generateEmailPreviews,
  executeEmailResend,
  EmailTemplateType,
} from "@/lib/admin/email-resend";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/registrations/resend-email
 *
 * Dedicated Admin Route for Previewing and Safe Resending of Registration & Payment Emails.
 *
 * Invariants:
 * 1. Requires active administrator session (requireAdmin()).
 * 2. Re-validates recipient eligibility and payment status server-side.
 * 3. Never permits receipt generation for unpaid orders.
 * 4. Local execution runs in simulation/preview mode without making real Resend network calls.
 * 5. Logs audit record in admin_audit_logs.
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
    action?: "preview" | "send";
    participantIds?: string[];
    templateType?: EmailTemplateType;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request body." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const action = body.action === "send" ? "send" : "preview";
  const templateType = (body.templateType || "registration_summary") as EmailTemplateType;
  const validTypes: EmailTemplateType[] = [
    "registration_summary",
    "payment_receipt",
    "payment_status_update",
  ];

  if (!validTypes.includes(templateType)) {
    return NextResponse.json(
      { success: false, error: "Invalid email template type specified." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const participantIds = Array.isArray(body.participantIds)
    ? Array.from(new Set(body.participantIds.filter((id) => typeof id === "string" && id.trim().length > 0)))
    : [];

  if (participantIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "No participant identifiers provided." },
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
    if (action === "preview") {
      const previewResult = await generateEmailPreviews({
        supabaseAdmin,
        participantIds,
        templateType,
      });

      return NextResponse.json(
        {
          success: true,
          action: "preview",
          ...previewResult,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } else {
      const sendResult = await executeEmailResend({
        supabaseAdmin,
        adminId: auth.user.id,
        adminEmail: auth.user.email || "admin@saviskar.co.in",
        participantIds,
        templateType,
      });

      return NextResponse.json(sendResult, {
        headers: { "Cache-Control": "no-store" },
      });
    }
  } catch (err) {
    console.error("Resend email route exception:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to process email request.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
