import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireMasterAdmin, isPrimaryMaster } from "@/lib/supabase/server";
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
  const rateLimit = checkRateLimit(`admin_reset:${auth.user?.id}:${clientIp}`, 10, 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many reset requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  const adminClient = getAdminClient();

  if (!adminClient) {
    return NextResponse.json(
      { error: "Admin management is not configured." },
      { status: 500 }
    );
  }

  let body: { userId?: string };
  try {
    body = (await request.json()) as { userId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const targetUserId = body.userId?.trim();

  if (!targetUserId) {
    return NextResponse.json({ error: "User ID is required." }, { status: 400 });
  }

  // 1. Verify the user is actually an admin
  const { data: adminRecord, error: adminError } = await adminClient
    .from("admins")
    .select("user_id")
    .eq("user_id", targetUserId)
    .single();

  if (adminError || !adminRecord) {
    return NextResponse.json({ error: "Administrator not found." }, { status: 404 });
  }

  // 1.5 Protect Primary Master
  const configuredUserId = process.env.PRIMARY_ADMIN_USER_ID?.trim();
  const isTargetPrimary = configuredUserId ? targetUserId === configuredUserId : false;
  
  if (isTargetPrimary && !isPrimaryMaster(auth.user)) {
    return NextResponse.json(
      { error: "Only the Primary Master Admin can reset the Primary Master password." },
      { status: 403 }
    );
  }

  // 2. Get the user's email from Auth
  const { data: userResp, error: userError } = await adminClient.auth.admin.getUserById(targetUserId);

  if (userError || !userResp?.user?.email) {
    return NextResponse.json({ error: "Could not find user email." }, { status: 404 });
  }

  const email = userResp.user.email;

  // 3. Send the password reset email
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
  const redirectTo = `${siteUrl}/admin/reset-password`;

  const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (resetError) {
    console.error("Password reset email failed:", resetError);
    return NextResponse.json(
      { error: resetError.message ?? "Failed to send password reset email." },
      { status: 500 }
    );
  }

  try {
    if (auth.user) {
      await adminClient.from("admin_audit_logs").insert({
        admin_id: auth.user.id,
        action_type: "RESET_PASSWORD",
        target_id: targetUserId,
        details: { email },
      });
    }
  } catch (err) {
    console.error("Audit log failed:", err);
  }

  return NextResponse.json({
    message: `Password reset email sent to ${email}`,
  });
}
