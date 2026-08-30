import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireMasterAdmin();

  if (auth.error) {
    return NextResponse.json(
      {
        error:
          auth.error === "MFA_REQUIRED"
            ? "Master Admin MFA verification required."
            : auth.error,
      },
      { status: auth.status }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase not configured." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data: logs, count, error: logsError } = await supabaseAdmin
    .from("admin_audit_logs")
    .select("id, admin_id, action_type, target_id, details, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (logsError) {
    console.error("Failed to fetch audit logs:", logsError);
    return NextResponse.json(
      { error: "Could not load audit logs." },
      { status: 500 }
    );
  }

  // Fetch admin user profiles for enriched log display
  const adminIds = Array.from(new Set((logs ?? []).map((l) => l.admin_id).filter(Boolean)));
  const emailMap = new Map<string, string>();

  if (adminIds.length > 0) {
    const userLookups = await Promise.all(
      adminIds.map((id) =>
        supabaseAdmin.auth.admin.getUserById(id).then((res) => ({
          id,
          email: res.data.user?.email || null,
        }))
      )
    );
    for (const u of userLookups) {
      if (u.email) emailMap.set(u.id, u.email);
    }
  }

  const enrichedLogs = logs?.map((log) => ({
    ...log,
    admin_email: emailMap.get(log.admin_id) || "Unknown Admin",
  }));

  const total = count ?? 0;

  return NextResponse.json({
    logs: enrichedLogs || [],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
