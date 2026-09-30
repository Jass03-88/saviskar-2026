import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
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

function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number.";
  }
  return null;
}

export async function POST(request: Request) {
  const clientIp = getIpFromRequest(request);
  const rateLimit = checkRateLimit(`self_update_pw:${clientIp}`, 10, 60 * 1000);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  // 1. Extract Bearer token
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid authorization session." },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return NextResponse.json(
      { error: "Session token is required." },
      { status: 401 }
    );
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: "Authentication system is not configured." },
      { status: 500 }
    );
  }

  // 2. Validate token with Supabase Auth
  const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json(
      { error: "Your password reset session is invalid or has expired. Please request a new link." },
      { status: 401 }
    );
  }

  // 3. Verify user is in admins table
  const { data: adminRecord, error: adminError } = await adminClient
    .from("admins")
    .select("user_id, role")
    .eq("user_id", user.id)
    .single();

  if (adminError || !adminRecord) {
    return NextResponse.json(
      { error: "This account is not authorized for administrator access." },
      { status: 403 }
    );
  }

  // 4. Validate password complexity
  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const newPassword = body.password;
  if (!newPassword || typeof newPassword !== "string") {
    return NextResponse.json({ error: "New password is required." }, { status: 400 });
  }

  const validationError = validatePassword(newPassword);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // 5. Update user password in Supabase Auth
  const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });

  if (updateError) {
    console.error("Failed to update password:", updateError);
    return NextResponse.json(
      { error: updateError.message || "Failed to update password." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Password updated successfully.",
  });
}
