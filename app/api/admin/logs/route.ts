import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
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

export async function GET() {
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

  const { data: logs, error: logsError } = await supabaseAdmin
    .from("admin_audit_logs")
    .select("id, admin_id, action_type, target_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (logsError) {
    console.error("Failed to fetch audit logs:", logsError);
    return NextResponse.json(
      { error: "Could not load audit logs." },
      { status: 500 }
    );
  }

  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
  const emailMap = new Map(usersData?.users.map(u => [u.id, u.email]) || []);

  const enrichedLogs = logs?.map(log => ({
    ...log,
    admin_email: emailMap.get(log.admin_id) || "Unknown Admin",
  }));

  return NextResponse.json({ logs: enrichedLogs || [] });
}
