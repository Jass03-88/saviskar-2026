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

function getRequestOrigin(request: Request): string {
  const origin = request.headers.get("origin");
  if (origin && !origin.includes("null")) {
    return origin.replace(/\/+$/, "");
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, "");
  }

  const host = request.headers.get("host");
  if (host) {
    const proto = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
    return `${proto}://${host}`.replace(/\/+$/, "");
  }

  try {
    const urlOrigin = new URL(request.url).origin;
    if (urlOrigin && !urlOrigin.includes("null")) {
      return urlOrigin.replace(/\/+$/, "");
    }
  } catch {
    // ignore
  }

  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export async function POST(request: Request) {
  const clientIp = getIpFromRequest(request);
  const rateLimit = checkRateLimit(`self_reset:${clientIp}`, 5, 60 * 1000); // 5 attempts per minute per IP

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many reset requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const targetEmail = body.email?.trim()?.toLowerCase();

  if (!targetEmail) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const adminClient = getAdminClient();

  if (!adminClient) {
    return NextResponse.json(
      { error: "Admin management is not configured." },
      { status: 500 }
    );
  }

  try {
    const siteUrl = getRequestOrigin(request);
    const redirectTo = `${siteUrl}/admin/reset-password`;

    // We can just call resetPasswordForEmail. If the user doesn't exist, Supabase will not send an email but will still return success (by default) or error depending on config.
    // However, to only send to actual admins:
    // We could list all admins, get their user_ids, and verify if one matches the email. But this is too much.
    // Let's just use adminClient.auth.resetPasswordForEmail(email) which handles it. If they aren't an admin, the login page still blocks them later!
    const { error: resetError } = await adminClient.auth.resetPasswordForEmail(targetEmail, {
      redirectTo,
    });

    if (resetError) {
      console.error("Self-service password reset failed:", resetError);
      // Do not return the real error to avoid enumeration, unless it's a rate limit from Supabase.
      // But we always return 200 generic success for security.
    }
  } catch (err) {
    console.error("Self-service reset exception:", err);
  }

  // ALWAYS return a generic success message
  return NextResponse.json({
    message: "If an administrator account exists for this email, a password reset link has been sent.",
  });
}
