import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  requireAdmin,
  requirePrimaryMasterAdmin,
  isPrimaryMaster,
} from "@/lib/supabase/server";
import {
  getSiteAccess,
  getSiteAccessState,
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

    const currentState = await getSiteAccessState({ bypassCache: true });
    const currentLocks = currentState.locks;
    const updatedLocks: SiteAccessConfig = { ...currentLocks };
    let accommodationLockedAt = currentState.accommodationLockTimestamp;
    let registrationLockedAt = currentState.registrationLockTimestamp;

    if (body.key && typeof body.enabled === "boolean") {
      const validKey = body.key as SitePageKey;
      if (!(validKey in DEFAULT_SITE_ACCESS)) {
        return NextResponse.json(
          { error: `Invalid page lock key: '${body.key}'` },
          { status: 400 }
        );
      }
      updatedLocks[validKey] = body.enabled;

      if (validKey === "ACCOMMODATION_ENABLED") {
        if (!body.enabled) {
          // Lock transition: if previously unlocked or missing timestamp, record fresh timestamp
          if (currentLocks.ACCOMMODATION_ENABLED !== false || !accommodationLockedAt) {
            accommodationLockedAt = new Date().toISOString();
          }
        } else {
          // Unlock transition: clear timestamp
          accommodationLockedAt = null;
        }
      }

      if (validKey === "REGISTRATIONS_ENABLED" || validKey === "REGISTRATION_ENABLED") {
        updatedLocks.REGISTRATIONS_ENABLED = body.enabled;
        updatedLocks.REGISTRATION_ENABLED = body.enabled;

        if (!body.enabled) {
          if (
            (currentLocks.REGISTRATIONS_ENABLED !== false && currentLocks.REGISTRATION_ENABLED !== false) ||
            !registrationLockedAt
          ) {
            registrationLockedAt = new Date().toISOString();
          }
        } else {
          registrationLockedAt = null;
        }
      }
    } else if (body.locks && typeof body.locks === "object") {
      for (const [k, v] of Object.entries(body.locks)) {
        if (k in DEFAULT_SITE_ACCESS && typeof v === "boolean") {
          updatedLocks[k as SitePageKey] = v;
        }
      }

      if (typeof body.locks.ACCOMMODATION_ENABLED === "boolean") {
        if (!body.locks.ACCOMMODATION_ENABLED) {
          if (currentLocks.ACCOMMODATION_ENABLED !== false || !accommodationLockedAt) {
            accommodationLockedAt = new Date().toISOString();
          }
        } else {
          accommodationLockedAt = null;
        }
      }

      const regVal = body.locks.REGISTRATION_ENABLED ?? body.locks.REGISTRATIONS_ENABLED;
      if (typeof regVal === "boolean") {
        updatedLocks.REGISTRATIONS_ENABLED = regVal;
        updatedLocks.REGISTRATION_ENABLED = regVal;
        if (!regVal) {
          if (
            (currentLocks.REGISTRATIONS_ENABLED !== false && currentLocks.REGISTRATION_ENABLED !== false) ||
            !registrationLockedAt
          ) {
            registrationLockedAt = new Date().toISOString();
          }
        } else {
          registrationLockedAt = null;
        }
      }
    } else {
      return NextResponse.json(
        { error: "Provide either { key, enabled } or { locks: { ... } }." },
        { status: 400 }
      );
    }

    const auditDetails = {
      locks: updatedLocks,
      lock_timestamps: {
        ACCOMMODATION_ENABLED: accommodationLockedAt,
        REGISTRATION_ENABLED: registrationLockedAt,
        REGISTRATIONS_ENABLED: registrationLockedAt,
      },
      accommodation_locked_at: accommodationLockedAt,
      registration_locked_at: registrationLockedAt,
      changed_key: body.key || "multiple",
      changed_value: typeof body.enabled === "boolean" ? body.enabled : undefined,
      updated_by: auth.user.email,
      updated_at: new Date().toISOString(),
    };

    // Database-level Synchronization:
    // Execute atomic RPC with exclusive advisory lock to eliminate races with booking creation.
    // Fail closed: Never bypass the synchronization boundary with a direct insert, and never report
    // success unless the atomic RPC successfully commits.
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("update_site_page_locks", {
      p_admin_id: auth.user.id,
      p_target_id: SITE_ACCESS_AUDIT_TARGET_ID,
      p_details: auditDetails,
    });

    if (rpcError || !rpcResult?.success) {
      console.error("Failed to persist site page lock via atomic RPC:", rpcError);
      const isMissingRpc =
        rpcError?.code === "PGRST202" ||
        rpcError?.code === "42883" ||
        rpcError?.message?.includes("does not exist");

      return NextResponse.json(
        {
          error: isMissingRpc
            ? "Atomic site page lock service is unavailable. Please verify database migrations."
            : "Failed to persist site lock configuration.",
        },
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
