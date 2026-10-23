import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  requireAdmin,
  requirePrimaryMasterAdmin,
  isPrimaryMaster,
} from "@/lib/supabase/server";
import {
  getSiteAccess,
  clearSiteAccessCache,
  DEFAULT_SITE_ACCESS,
  SITE_PAGE_DEFINITIONS,
  SITE_ACCESS_AUDIT_TARGET_ID,
  type SitePageKey,
  type SiteAccessConfig,
} from "@/lib/config/site-access";

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

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();

    if (auth.error) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status }
      );
    }

    const currentAccess = await getSiteAccess();
    const isPrimary = isPrimaryMaster(auth.user);

    return NextResponse.json(
      {
        success: true,
        siteAccess: currentAccess,
        isPrimary,
        definitions: SITE_PAGE_DEFINITIONS,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("GET /api/admin/site-access error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requirePrimaryMasterAdmin();

    if (auth.error) {
      return NextResponse.json(
        {
          error:
            auth.status === 403
              ? "Access denied. Only Primary Master Admins have authorization to lock or unlock site pages."
              : auth.error,
        },
        { status: auth.status }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Database configuration is missing." },
        { status: 500 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      key?: string;
      enabled?: boolean;
      locks?: Partial<SiteAccessConfig>;
    };

    const currentLocks = await getSiteAccess();
    const updatedLocks: SiteAccessConfig = { ...currentLocks };

    if (body.key && typeof body.enabled === "boolean") {
      const validKey = body.key as SitePageKey;
      if (!(validKey in DEFAULT_SITE_ACCESS)) {
        return NextResponse.json(
          { error: `Invalid page lock key: '${body.key}'` },
          { status: 400 }
        );
      }
      updatedLocks[validKey] = body.enabled;
    } else if (body.locks && typeof body.locks === "object") {
      for (const [k, v] of Object.entries(body.locks)) {
        if (k in DEFAULT_SITE_ACCESS && typeof v === "boolean") {
          updatedLocks[k as SitePageKey] = v;
        }
      }
    } else {
      return NextResponse.json(
        { error: "Provide either { key, enabled } or { locks: { ... } }." },
        { status: 400 }
      );
    }

    // Persist to admin_audit_logs with designated target UUID
    const { error: insertError } = await supabaseAdmin
      .from("admin_audit_logs")
      .insert({
        admin_id: auth.user.id,
        action_type: "SITE_PAGE_LOCKS_UPDATE",
        target_id: SITE_ACCESS_AUDIT_TARGET_ID,
        details: {
          locks: updatedLocks,
          changed_key: body.key || "multiple",
          changed_value: typeof body.enabled === "boolean" ? body.enabled : undefined,
          updated_by: auth.user.email,
          updated_at: new Date().toISOString(),
        },
      });

    if (insertError) {
      console.error("Failed to persist site page lock in audit log:", insertError);
      return NextResponse.json(
        { error: "Failed to persist site lock configuration." },
        { status: 500 }
      );
    }

    clearSiteAccessCache();

    return NextResponse.json(
      {
        success: true,
        siteAccess: updatedLocks,
        message: body.key
          ? `${SITE_PAGE_DEFINITIONS[body.key as SitePageKey]?.name || body.key} has been ${body.enabled ? "unlocked" : "locked"}.`
          : "Site page locks updated successfully.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("PATCH /api/admin/site-access error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error." },
      { status: 500 }
    );
  }
}
