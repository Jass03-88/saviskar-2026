import { NextRequest, NextResponse } from "next/server";
import { requestOtp } from "@/lib/auth/otp";
import { getSessionSecret } from "@/lib/auth/session";
import { getClientIp } from "@/lib/rate-limit";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body.email !== "string") {
      return NextResponse.json(
        { success: false, error: "Please enter a valid email address." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const email = body.email.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid email address." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Access Gate: reject OTP issuance if participant registration is locked
    const { getSiteAccess } = await import("@/lib/config/site-access");
    const siteAccess = await getSiteAccess({ bypassCache: true });
    if (!siteAccess.REGISTRATIONS_ENABLED || !siteAccess.REGISTRATION_ENABLED) {
      return NextResponse.json(
        {
          success: false,
          error: "Participant registration is temporarily paused by administration. Please check back shortly.",
          code: "REGISTRATION_LOCKED",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Pre-flight session infrastructure verification:
    // Do not issue an OTP to the user if the server cannot verify it or sign a session.
    try {
      getSessionSecret();
    } catch (secretErr) {
      console.error("[REQUEST OTP FATAL] Session signing infrastructure unavailable:", secretErr);
      return NextResponse.json(
        {
          success: false,
          error: "Authentication service is temporarily unavailable. Please try again later.",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const clientIp = getClientIp(req);
    const result = await requestOtp(email, clientIp);

    if (!result.success) {
      const status = result.retryAfter ? 429 : 400;
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (result.retryAfter) {
        headers["Retry-After"] = String(result.retryAfter);
      }

      return NextResponse.json(
        {
          success: false,
          error: result.error || "Unable to send verification code.",
          retryAfter: result.retryAfter,
        },
        { status, headers }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "A 6-digit verification code has been sent to your email.",
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    console.error("[REQUEST OTP ERROR]", err);
    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred while sending the verification code.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
