import { NextRequest, NextResponse } from "next/server";
import { verifyOtp } from "@/lib/auth/otp";
import {
  setRegistrationSessionCookie,
  getSessionSecret,
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_EXP_MS,
} from "@/lib/auth/session";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_PATTERN = /^\d{6}$/;

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const rateLimit = await checkRateLimitAsync(`auth:verify:ip:${clientIp}`, 20, 600 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many verification attempts from this network. Please wait a moment." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(rateLimit.retryAfter),
          },
        }
      );
    }
    const body = await req.json().catch(() => null);

    if (!body || typeof body.email !== "string" || typeof body.otp !== "string") {
      return NextResponse.json(
        { success: false, error: "Email and 6-digit verification code are required." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const email = body.email.trim().toLowerCase();
    const otp = body.otp.trim();

    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { success: false, error: "Please enter a valid email address." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!OTP_PATTERN.test(otp)) {
      return NextResponse.json(
        { success: false, error: "Verification code must be exactly 6 numeric digits." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Access Gate: reject OTP verification if participant registration is locked
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

    // Pre-flight check: ensure session signing infrastructure is operational
    // before verifying or consuming the participant's OTP.
    try {
      getSessionSecret();
    } catch (secretErr) {
      console.error("[VERIFY OTP FATAL] Session signing infrastructure unavailable:", secretErr);
      return NextResponse.json(
        {
          success: false,
          error: "Authentication service is temporarily unavailable. Please try again later.",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const result = await verifyOtp(email, otp);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Invalid or expired verification code.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Establish secure HTTP-only session cookie
    const token = await setRegistrationSessionCookie(email);

    const response = NextResponse.json(
      {
        success: true,
        email,
        message: "Email verification successful.",
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );

    // Explicitly attach to response headers for multi-runtime compatibility
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(DEFAULT_SESSION_EXP_MS / 1000),
    });

    return response;
  } catch (err) {
    console.error("[VERIFY OTP ERROR]", err);
    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred during verification. Please try again.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
