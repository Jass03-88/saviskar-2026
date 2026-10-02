import { createClient as createSupabaseAdminClient, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  requireMasterAdmin,
  isPrimaryMaster,
} from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getIpFromRequest(request: Request): string {
  try {
    const forwarded = request.headers?.get?.("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = request.headers?.get?.("x-real-ip");
    if (realIp?.trim()) return realIp.trim();
  } catch {
    // ignore
  }
  return "127.0.0.1";
}

async function isTargetPrimaryMaster(
  _adminClient: SupabaseClient,
  targetUserId: string
): Promise<boolean> {
  const configuredUserId = process.env.PRIMARY_ADMIN_USER_ID?.trim();
  if (configuredUserId) {
    return targetUserId === configuredUserId;
  }
  return false;
}

async function logAudit(
  adminClient: SupabaseClient,
  adminId: string,
  actionType: string,
  targetId: string,
  details: Record<string, unknown>
) {
  try {
    await adminClient.from("admin_audit_logs").insert({
      admin_id: adminId,
      action_type: actionType,
      target_id: targetId,
      details,
    });
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    return null;
  }

  return createSupabaseAdminClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * PATCH /api/admin/admins/[userId]/accommodation-access
 *
 * Grants or revokes accommodation access for a given administrator.
 *
 * AUTHORIZATION:
 * - Unauthenticated: 401
 * - Normal Admin: 403 (Normal admins cannot manage permissions for anyone)
 * - Master Admin: Can manage Normal Admins. Cannot modify Primary Master or other Master Admins.
 * - Primary Master: Can manage Normal Admins and other Master Admins. Primary Master permission is protected.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
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

  const clientIp = getIpFromRequest(request);
  const rateLimit = checkRateLimit(`admin_acc_patch:${auth.user?.id}:${clientIp}`, 30, 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many admin requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Admin management is not configured." }, { status: 500 });
  }

  const { userId: rawUserId } = await context.params;
  const targetUserId = rawUserId?.trim();

  if (!targetUserId) {
    return NextResponse.json({ error: "User ID is required." }, { status: 400 });
  }

  let body: { accommodationAccess?: unknown };
  try {
    body = (await request.json()) as { accommodationAccess?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.accommodationAccess === undefined || typeof body.accommodationAccess !== "boolean") {
    return NextResponse.json(
      { error: "Invalid request body. 'accommodationAccess' boolean is required." },
      { status: 400 }
    );
  }

  const newAccess = body.accommodationAccess;

  // 1. Fetch target administrator from DB
  const { data: targetAdmin, error: targetError } = await adminClient
    .from("admins")
    .select("user_id, role, accommodation_access")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (targetError || !targetAdmin) {
    return NextResponse.json({ error: "Administrator not found." }, { status: 404 });
  }

  // 2. Primary Master target protection (Primary Master cannot be modified by anyone)
  const isTargetPrimary = await isTargetPrimaryMaster(adminClient, targetUserId);
  if (isTargetPrimary) {
    return NextResponse.json(
      { error: "The Primary Master accommodation access is protected and cannot be modified." },
      { status: 403 }
    );
  }

  // 3. Hierarchy Check: Master Admin modifying another Master Admin
  const callerIsPrimary = isPrimaryMaster(auth.user);
  if (targetAdmin.role === "master" && !callerIsPrimary) {
    return NextResponse.json(
      { error: "Only the Primary Master Admin can modify permissions of Master Admins." },
      { status: 403 }
    );
  }

  // 4. Update accommodation_access
  const { error: updateError } = await adminClient
    .from("admins")
    .update({ accommodation_access: newAccess })
    .eq("user_id", targetUserId);

  if (updateError) {
    console.error("Accommodation access update failed:", updateError);
    return NextResponse.json(
      { error: "Could not update accommodation access." },
      { status: 500 }
    );
  }

  // 5. Audit Logging
  if (auth.user) {
    await logAudit(
      adminClient,
      auth.user.id,
      newAccess ? "GRANT_ACCOMMODATION_ACCESS" : "REVOKE_ACCOMMODATION_ACCESS",
      targetUserId,
      {
        target_role: targetAdmin.role,
        previous_access: targetAdmin.accommodation_access,
        new_access: newAccess,
      }
    );
  }

  return NextResponse.json({
    success: true,
    accommodationAccess: newAccess,
    message: newAccess
      ? "Accommodation access granted successfully."
      : "Accommodation access revoked successfully.",
  });
}
