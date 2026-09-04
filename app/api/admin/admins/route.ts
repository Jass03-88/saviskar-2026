import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  requireMasterAdmin,
  isPrimaryMaster,
} from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type AdminRole = "master" | "admin";

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
  adminClient: any,
  targetUserId: string
): Promise<boolean> {
  const configuredUserId = process.env.PRIMARY_ADMIN_USER_ID?.trim();
  if (configuredUserId) {
    return targetUserId === configuredUserId;
  }

  try {
    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(targetUserId);
    if (userError || !userData?.user) {
      return false;
    }
    const configuredEmail = (process.env.PRIMARY_ADMIN_EMAIL?.trim() || "jashan082006@gmail.com").toLowerCase();
    return userData.user.email?.toLowerCase().trim() === configuredEmail;
  } catch {
    return false;
  }
}

async function logAudit(
  adminClient: any,
  adminId: string,
  actionType: string,
  targetId: string,
  details: any
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

/* =========================================================
   GET — List all admins
   MASTER ONLY (Primary Master & Other Masters)
========================================================= */

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

  const adminClient = getAdminClient();

  if (!adminClient) {
    return NextResponse.json(
      {
        error: "Admin management is not configured.",
      },
      { status: 500 }
    );
  }

  const { data: admins, error } = await adminClient
    .from("admins")
    .select("user_id, role, created_at")
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    console.error("Admin list error:", error);

    return NextResponse.json(
      {
        error: "Could not load administrators.",
      },
      { status: 500 }
    );
  }

  const userIds = (admins ?? []).map(
    (admin) => admin.user_id
  );

  const users = new Map<
    string,
    {
      email: string | null;
      created_at: string | null;
      last_sign_in_at: string | null;
    }
  >();

  if (userIds.length > 0) {
    const userLookups = await Promise.all(
      userIds.map((id) =>
        adminClient.auth.admin.getUserById(id).then((res: any) => ({
          id,
          user: res.data?.user || null,
        }))
      )
    );

    for (const lookup of userLookups) {
      if (lookup.user) {
        users.set(lookup.id, {
          email: lookup.user.email ?? null,
          created_at: lookup.user.created_at ?? null,
          last_sign_in_at: lookup.user.last_sign_in_at ?? null,
        });
      }
    }
  }

  const primary = isPrimaryMaster(auth.user);
  const primaryEmail = (process.env.PRIMARY_ADMIN_EMAIL?.trim() || "jashan082006@gmail.com").toLowerCase();
  const configuredUserId = process.env.PRIMARY_ADMIN_USER_ID?.trim();

  const result = (admins ?? []).map((admin) => {
    const email = users.get(admin.user_id)?.email ?? null;
    const isPrimary = configuredUserId
      ? admin.user_id === configuredUserId
      : Boolean(email && email.toLowerCase().trim() === primaryEmail);

    return {
      user_id: admin.user_id,
      role: (admin.role ?? "admin") as AdminRole,
      created_at: admin.created_at,
      email,
      auth_created_at: users.get(admin.user_id)?.created_at ?? null,
      last_sign_in_at: users.get(admin.user_id)?.last_sign_in_at ?? null,
      isPrimary,
    };
  });

  return NextResponse.json(
    {
      admins: result,
      isSuperMaster: primary,
      canManageAdmins: true,
      canCreateMaster: primary,
      canCreateNormal: true,
      canRemoveNormal: true,
      canRemoveMaster: primary,
      canChangeRoles: primary,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

/* =========================================================
   POST — Add administrator
   MASTER ONLY

   PRIMARY MASTER:
   - Can create Normal Admin or Master Admin (unlimited)

   OTHER MASTER:
   - Can create Normal Admin only
   - Attempting to create Master Admin -> 403 Forbidden

   NEW USER:
   - Creates Supabase Auth user
   - Sends invitation email
   - Redirects to /admin/accept-invite

   EXISTING USER:
   - Adds/re-adds admin access
   - Sends password reset/setup email
   - Redirects to /admin/reset-password
========================================================= */

export async function POST(request: Request) {
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
  const rateLimit = checkRateLimit(`admin_add:${auth.user?.id}:${clientIp}`, 30, 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many admin requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  const adminClient = getAdminClient();

  if (!adminClient) {
    return NextResponse.json(
      {
        error: "Admin management is not configured.",
      },
      { status: 500 }
    );
  }

  let body: {
    email?: unknown;
    role?: unknown;
  };

  try {
    body = (await request.json()) as {
      email?: unknown;
      role?: unknown;
    };
  } catch {
    return NextResponse.json(
      {
        error: "Invalid request.",
      },
      { status: 400 }
    );
  }

  const email =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";

  const role =
    body.role === "master"
      ? "master"
      : "admin";

  if (!email) {
    return NextResponse.json(
      {
        error: "Email address is required.",
      },
      { status: 400 }
    );
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return NextResponse.json(
      {
        error: "Enter a valid email address.",
      },
      { status: 400 }
    );
  }

  // Authorization: Only Primary Master can create Master Admins
  const callerIsPrimary = isPrimaryMaster(auth.user);
  if (role === "master" && !callerIsPrimary) {
    return NextResponse.json(
      {
        error: "Only the Primary Master Admin can create Master Admins.",
      },
      { status: 403 }
    );
  }

  // Primary Master protection: cannot re-add or overwrite Primary Master
  const primaryEmail = (process.env.PRIMARY_ADMIN_EMAIL?.trim() || "jashan082006@gmail.com").toLowerCase();
  const configuredUserId = process.env.PRIMARY_ADMIN_USER_ID?.trim();
  if (
    (configuredUserId && auth.user?.id === configuredUserId && auth.user?.email?.toLowerCase() === email) ||
    (!configuredUserId && email === primaryEmail)
  ) {
    return NextResponse.json(
      {
        error: "The Primary Master account already exists and cannot be modified.",
      },
      { status: 400 }
    );
  }

  if (
    auth.user?.email?.toLowerCase() === email
  ) {
    return NextResponse.json(
      {
        error: "You are already an administrator.",
      },
      { status: 400 }
    );
  }

  /* =======================================================
     CHECK EXISTING ADMIN RECORDS
     (No two-master count limit: unlimited masters supported)
  ======================================================= */

  const {
    data: existingAdmins,
    error: existingAdminError,
  } = await adminClient
    .from("admins")
    .select("user_id, role")
    .limit(1000);

  if (existingAdminError) {
    console.error(
      "Existing admin check failed:",
      existingAdminError
    );

    return NextResponse.json(
      {
        error:
          "Could not check existing administrators.",
      },
      { status: 500 }
    );
  }

  /* =======================================================
     CHECK SUPABASE AUTH USERS
  ======================================================= */

  const {
    data: userList,
    error: userListError,
  } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (userListError) {
    console.error(
      "Auth user lookup failed:",
      userListError
    );

    return NextResponse.json(
      {
        error: "Could not check the user account.",
      },
      { status: 500 }
    );
  }

  const existingUser = userList.users.find(
    (user: any) =>
      user.email?.toLowerCase() === email
  );

  /* =======================================================
     EXISTING SUPABASE USER
     
     If already in admins table -> 409 Conflict.
     Otherwise:
     1. Add them back to admins
     2. Send a password reset/setup email
  ======================================================= */

  if (existingUser) {
    const alreadyAdmin =
      (existingAdmins ?? []).find(
        (admin: any) =>
          admin.user_id === existingUser.id
      );

    if (alreadyAdmin) {
      return NextResponse.json(
        {
          error:
            "This user is already an administrator.",
        },
        { status: 409 }
      );
    }

    const { error: insertError } =
      await adminClient
        .from("admins")
        .insert({
          user_id: existingUser.id,
          role,
        });

    if (insertError) {
      console.error(
        "Existing user admin insert failed:",
        insertError
      );

      return NextResponse.json(
        {
          error:
            insertError.code === "23505"
              ? "This user is already an administrator."
              : "Could not add this user as an administrator.",
        },
        { status: insertError.code === "23505" ? 409 : 500 }
      );
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      new URL(request.url).origin;

    const redirectTo =
      `${siteUrl}/admin/reset-password`;

    console.log("========================================");
    console.log("EXISTING ADMIN RE-INVITATION");
    console.log("Email:", email);
    console.log("Role:", role);
    console.log("Password setup redirect:", redirectTo);
    console.log("========================================");

    const { error: resetError } =
      await adminClient.auth.resetPasswordForEmail(
        email,
        {
          redirectTo,
        }
      );

    if (resetError) {
      console.error(
        "Password setup email failed:",
        resetError
      );

      await adminClient
        .from("admins")
        .delete()
        .eq("user_id", existingUser.id);

      return NextResponse.json(
        {
          error:
            resetError.message ??
            "Administrator was added, but the password setup email could not be sent.",
        },
        { status: 500 }
      );
    }

    if (auth.user) {
      await logAudit(
        adminClient,
        auth.user.id,
        "ADD_ADMIN",
        existingUser.id,
        { email, role, type: "existing_user" }
      );
    }

    return NextResponse.json(
      {
        success: true,
        invited: true,
        existingUser: true,
        email,
        role,
        redirectTo,
        message:
          role === "master"
            ? "Existing user added as Master Admin. Password setup email sent."
            : "Existing user added as Normal Admin. Password setup email sent.",
      },
      { status: 201 }
    );
  }

  /* =======================================================
     NEW USER INVITATION
     
     New Auth user:
     - Supabase creates the user and sends invitation
     - User lands on /admin/accept-invite
  ======================================================= */

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    new URL(request.url).origin;

  const redirectTo =
    `${siteUrl}/admin/accept-invite`;

  console.log("========================================");
  console.log("NEW ADMIN INVITATION");
  console.log("Email:", email);
  console.log("Role:", role);
  console.log("Invitation redirect:", redirectTo);
  console.log("========================================");

  const {
    data: inviteData,
    error: inviteError,
  } =
    await adminClient.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo,
        data: {
          saviskar_role: role,
        },
      }
    );

  if (inviteError || !inviteData.user) {
    console.error(
      "Admin invitation failed:",
      inviteError
    );

    return NextResponse.json(
      {
        error:
          inviteError?.message ??
          "Could not send the administrator invitation.",
      },
      { status: 400 }
    );
  }

  /* =======================================================
     CREATE ADMIN RECORD
  ======================================================= */

  const { error: insertError } =
    await adminClient
      .from("admins")
      .insert({
        user_id: inviteData.user.id,
        role,
      });

  if (insertError) {
    console.error(
      "Admin role insert failed:",
      insertError
    );

    // Rollback created auth user
    await adminClient.auth.admin.deleteUser(
      inviteData.user.id
    );

    return NextResponse.json(
      {
        error:
          insertError.code === "23505"
            ? "This user is already an administrator."
            : "Could not create the administrator record.",
      },
      { status: insertError.code === "23505" ? 409 : 500 }
    );
  }

  if (auth.user) {
    await logAudit(
      adminClient,
      auth.user.id,
      "INVITE_ADMIN",
      inviteData.user.id,
      { email, role, type: "new_user" }
    );
  }

  return NextResponse.json(
    {
      success: true,
      invited: true,
      existingUser: false,
      email,
      role,
      redirectTo,
      message:
        role === "master"
          ? "Master Admin invitation sent."
          : "Normal Admin invitation sent.",
    },
    { status: 201 }
  );
}

/* =========================================================
   DELETE — Remove administrator
   MASTER ONLY

   PRIMARY MASTER:
   - Can remove Normal Admins
   - Can remove other Masters
   - Cannot remove self

   OTHER MASTER:
   - Can remove Normal Admins
   - Cannot remove any Master
   - Cannot remove Primary Master

   Target role is determined strictly from the database.
   Auth account is NOT deleted.
========================================================= */

export async function DELETE(request: Request) {
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
  const rateLimit = checkRateLimit(`admin_del:${auth.user?.id}:${clientIp}`, 30, 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many admin requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  const adminClient = getAdminClient();

  if (!adminClient) {
    return NextResponse.json(
      {
        error: "Admin management is not configured.",
      },
      { status: 500 }
    );
  }

  const userId = new URL(request.url)
    .searchParams.get("userId");

  if (!userId) {
    return NextResponse.json(
      {
        error: "User ID is required.",
      },
      { status: 400 }
    );
  }

  if (userId === auth.user?.id) {
    return NextResponse.json(
      {
        error: "You cannot remove yourself.",
      },
      { status: 400 }
    );
  }

  const {
    data: targetAdmin,
    error: targetError,
  } = await adminClient
    .from("admins")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (targetError) {
    console.error(
      "Administrator lookup failed:",
      targetError
    );

    return NextResponse.json(
      {
        error:
          "Could not find the administrator.",
      },
      { status: 500 }
    );
  }

  if (!targetAdmin) {
    return NextResponse.json(
      {
        error: "Administrator not found.",
      },
      { status: 404 }
    );
  }

  // Server-side Primary Master target check
  const isTargetPrimary = await isTargetPrimaryMaster(adminClient, userId);
  if (isTargetPrimary) {
    return NextResponse.json(
      {
        error: "The Primary Master administrator cannot be removed.",
      },
      { status: 403 }
    );
  }

  // Server-side target role verification
  const callerIsPrimary = isPrimaryMaster(auth.user);
  if (targetAdmin.role === "master" && !callerIsPrimary) {
    return NextResponse.json(
      {
        error: "Only the Primary Master Admin can remove Master Admins.",
      },
      { status: 403 }
    );
  }

  const { error: deleteError } =
    await adminClient
      .from("admins")
      .delete()
      .eq("user_id", userId);

  if (deleteError) {
    console.error(
      "Admin removal failed:",
      deleteError
    );

    return NextResponse.json(
      {
        error:
          "Could not remove the administrator.",
      },
      { status: 500 }
    );
  }

  if (auth.user) {
    await logAudit(
      adminClient,
      auth.user.id,
      targetAdmin.role === "master" ? "REMOVE_MASTER_ADMIN" : "REMOVE_ADMIN",
      userId,
      { previous_role: targetAdmin.role }
    );
  }

  return NextResponse.json({
    success: true,
    message:
      "Admin access has been removed. The Auth account remains available for future re-invitation.",
  });
}

/* =========================================================
   PATCH — Promote or demote administrator
   PRIMARY MASTER ONLY
========================================================= */

export async function PATCH(request: Request) {
  const auth = await requireMasterAdmin();

  if (auth.error) {
    return NextResponse.json(
      {
        error: auth.error === "MFA_REQUIRED" ? "Master Admin MFA verification required." : auth.error,
      },
      { status: auth.status }
    );
  }

  // PATCH is strictly restricted to the Primary Master
  if (!isPrimaryMaster(auth.user)) {
    return NextResponse.json(
      {
        error: "Only the Primary Master Admin can promote or demote administrators.",
      },
      { status: 403 }
    );
  }

  const clientIp = getIpFromRequest(request);
  const rateLimit = checkRateLimit(`admin_patch:${auth.user?.id}:${clientIp}`, 30, 60 * 1000);
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

  let body: { userId?: unknown; newRole?: unknown };
  try {
    body = (await request.json()) as { userId?: unknown; newRole?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const newRole = body.newRole === "master" ? "master" : "admin";

  if (!userId) {
    return NextResponse.json({ error: "User ID is required." }, { status: 400 });
  }

  if (userId === auth.user?.id) {
    return NextResponse.json({ error: "You cannot change your own role." }, { status: 400 });
  }

  const { data: targetAdmin, error: targetError } = await adminClient
    .from("admins")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (targetError || !targetAdmin) {
    return NextResponse.json({ error: "Administrator not found." }, { status: 404 });
  }

  // Server-side Primary Master target check
  const isTargetPrimary = await isTargetPrimaryMaster(adminClient, userId);
  if (isTargetPrimary) {
    return NextResponse.json(
      { error: "The Primary Master role cannot be modified." },
      { status: 403 }
    );
  }

  if (targetAdmin.role === newRole) {
    return NextResponse.json({ error: "Administrator already has this role." }, { status: 400 });
  }

  const { error: updateError } = await adminClient
    .from("admins")
    .update({ role: newRole })
    .eq("user_id", userId);

  if (updateError) {
    console.error("Admin role update failed:", updateError);
    return NextResponse.json({ error: "Could not update the administrator role." }, { status: 500 });
  }

  if (auth.user) {
    await logAudit(
      adminClient,
      auth.user.id,
      newRole === "master" ? "PROMOTE_ADMIN" : "DEMOTE_ADMIN",
      userId,
      { previous_role: targetAdmin.role, new_role: newRole }
    );
  }

  return NextResponse.json({
    success: true,
    message: newRole === "master" ? "Administrator promoted to Master Admin." : "Master Admin demoted successfully.",
  });
}