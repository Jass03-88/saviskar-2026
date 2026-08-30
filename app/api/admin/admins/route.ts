import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireMasterAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminRole = "master" | "admin";

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
   MASTER ONLY
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
        adminClient.auth.admin.getUserById(id).then((res) => ({
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

  const result = (admins ?? []).map((admin) => ({
    user_id: admin.user_id,
    role: (admin.role ?? "admin") as AdminRole,
    created_at: admin.created_at,
    email:
      users.get(admin.user_id)?.email ?? null,
    auth_created_at:
      users.get(admin.user_id)?.created_at ?? null,
    last_sign_in_at:
      users.get(admin.user_id)?.last_sign_in_at ??
      null,
  }));

  return NextResponse.json(
    {
      admins: result,
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

   NEW USER:
   - Creates Supabase Auth user
   - Sends invitation email
   - Redirects to /admin/invite

   EXISTING USER:
   - Adds/re-adds Normal Admin access
   - Sends password reset/setup email
   - Redirects to /admin/invite

   This means deleting a Normal Admin from the admin
   table does NOT prevent inviting them again.
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

  if (
    auth.user?.email?.toLowerCase() === email
  ) {
    return NextResponse.json(
      {
        error: "You are already a Master Admin.",
      },
      { status: 400 }
    );
  }

  /* =======================================================
     CHECK EXISTING ADMIN RECORDS
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

  if (role === "master") {
    const masterCount = (existingAdmins ?? []).filter((a) => a.role === "master").length;
    if (masterCount >= 2) {
      return NextResponse.json(
        {
          error: "The maximum limit of 2 Master Admins has been reached.",
        },
        { status: 403 }
      );
    }
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
    (user) =>
      user.email?.toLowerCase() === email
  );

  /* =======================================================
     EXISTING SUPABASE USER
     
     IMPORTANT:
     This includes users who were previously Normal Admins
     but were removed from the admins table.

     We:
     1. Add them back to admins
     2. Send a password reset/setup email
  ======================================================= */

  if (existingUser) {
    const alreadyAdmin =
      (existingAdmins ?? []).find(
        (admin) =>
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

    /* -----------------------------------------------------
       Add the existing Auth user back as an administrator
    ----------------------------------------------------- */

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
            "Could not add this user as an administrator.",
        },
        { status: 500 }
      );
    }

    /* -----------------------------------------------------
       Send password setup/reset email

       This is necessary because Supabase will not send
       another invitation to an Auth user that already exists.
    ----------------------------------------------------- */

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      new URL(request.url).origin;

    const redirectTo =
      `${siteUrl}/admin/reset-password`;

    console.log(
      "========================================"
    );
    console.log(
      "EXISTING ADMIN RE-INVITATION"
    );
    console.log(
      "Email:",
      email
    );
    console.log(
      "Role:",
      role
    );
    console.log(
      "Password setup redirect:",
      redirectTo
    );
    console.log(
      "========================================"
    );

    const {
      error: resetError,
    } =
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

      /*
       * Roll back the admin record because the user
       * was not successfully notified.
       */

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
     - Supabase creates the user
     - Supabase sends invitation
     - User lands on /admin/invite
  ======================================================= */

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    new URL(request.url).origin;

  const redirectTo =
    `${siteUrl}/admin/reset-password`;

  console.log(
    "========================================"
  );
  console.log(
    "NEW ADMIN INVITATION"
  );
  console.log(
    "Email:",
    email
  );
  console.log(
    "Role:",
    role
  );
  console.log(
    "Invitation redirect:",
    redirectTo
  );
  console.log(
    "========================================"
  );

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

    /*
     * If database insert fails, remove the newly-created
     * Supabase Auth user so we don't leave an orphaned account.
     */

    await adminClient.auth.admin.deleteUser(
      inviteData.user.id
    );

    return NextResponse.json(
      {
        error:
          "Could not create the administrator record.",
      },
      { status: 500 }
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

   IMPORTANT:
   This removes the user's Saviskar admin access.

   It intentionally DOES NOT delete the Supabase Auth user.

   Therefore the same email can later be added again and
   receive a password setup/reset email.
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

  if (targetAdmin.role === "master") {
    return NextResponse.json(
      {
        error:
          "Master Admins cannot be removed from this control panel.",
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

  return NextResponse.json({
    success: true,
    message:
      "Normal Admin access has been removed. The Auth account remains available for future re-invitation.",
  });
}