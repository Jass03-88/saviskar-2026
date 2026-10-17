/**
 * Saviskar 2026 - Registration OTP Email Dispatcher
 *
 * Sends a single-use 6-digit verification code using Resend SDK.
 * Server-only; credentials are never exposed to the client.
 */

import { Resend } from "resend";
import { getEmailSender } from "@/lib/email-sender";

/**
 * RECIPIENT SAFEGUARD POLICY:
 * 1. Production Mode (Default): When ENABLE_TEST_RECIPIENT_GUARD is not "true",
 *    OTP verification emails are delivered to the requesting user's email.
 *    A generic development variable (like APPROVED_TEST_EMAIL alone) will NOT activate
 *    test mode in production.
 * 2. Testing Mode: When ENABLE_TEST_RECIPIENT_GUARD="true" (or in non-production when
 *    APPROVED_TEST_EMAIL is provided), OTP delivery is fail-closed and strictly
 *    restricted to the hardcoded approved test address.
 */
const HARDCODED_PERMITTED_TEST_EMAIL = "jashan.cgcu@gmail.com";

export function isTestRecipientGuardActive(): boolean {
  if (process.env.ENABLE_TEST_RECIPIENT_GUARD === "true") {
    return true;
  }
  // In production, require the explicit ENABLE_TEST_RECIPIENT_GUARD="true" flag;
  // a generic/stray variable must never accidentally trigger test mode in production.
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return !!process.env.APPROVED_TEST_EMAIL;
}

export type SendOtpEmailResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export async function sendOtpEmail(
  toEmail: string,
  otp: string
): Promise<SendOtpEmailResult> {
  const normalizedToEmail = toEmail.trim().toLowerCase();
  const guardActive = isTestRecipientGuardActive();

  if (guardActive) {
    const configuredTestEmail = process.env.APPROVED_TEST_EMAIL?.trim().toLowerCase();
    if (
      configuredTestEmail !== HARDCODED_PERMITTED_TEST_EMAIL ||
      normalizedToEmail !== HARDCODED_PERMITTED_TEST_EMAIL
    ) {
      console.warn(
        "[SAFEGUARD BLOCKED] Outbound OTP email suppressed: recipient does not match authorized staging test address."
      );
      return {
        success: false,
        error: "Verification code delivery suppressed: test recipient safeguard is active.",
      };
    }
  }

  const senderResult = getEmailSender();
  if (!senderResult.success) {
    console.error(senderResult.internalLog);
    return {
      success: false,
      error: senderResult.error,
    };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      console.error("[AUTH OTP ERROR] RESEND_API_KEY is not configured in production.");
      return {
        success: false,
        error: "Authentication service is temporarily unavailable. Please try again later.",
      };
    }
    console.warn(
      `[AUTH OTP] RESEND_API_KEY is not configured. Simulating email dispatch to ${toEmail}.`
    );
    // In local dev/testing without key, resolve cleanly
    return {
      success: true,
      messageId: `simulated-${Date.now()}`,
    };
  }

  const resend = new Resend(apiKey);
  const fromEmail = senderResult.from;

  const subject = "Your Saviskar 2026 verification code";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #050508; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #050508; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background: linear-gradient(180deg, rgba(24, 24, 32, 0.95) 0%, rgba(12, 12, 18, 0.98) 100%); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 24px; padding: 40px 32px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 40px rgba(168, 85, 247, 0.15);">
          <!-- Header Branding -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <div style="display: inline-block; padding: 6px 14px; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 9999px; font-family: monospace; font-size: 11px; font-weight: 700; color: #c084fc; letter-spacing: 0.2em; text-transform: uppercase;">
                SAVISKAR 2026 // AEVORIAN REVERIE
              </div>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td align="center" style="padding-bottom: 12px;">
              <h1 style="margin: 0; font-size: 26px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">
                Claim Your Pass
              </h1>
            </td>
          </tr>

          <!-- Subtext -->
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                Use the single-use 6-digit verification code below to access the Saviskar 2026 registration portal.
              </p>
            </td>
          </tr>

          <!-- OTP Code Box -->
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <div style="display: inline-block; background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 16px; padding: 18px 36px; box-shadow: 0 0 25px rgba(168, 85, 247, 0.2);">
                <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 34px; font-weight: 700; color: #ffffff; letter-spacing: 0.28em; display: inline-block; padding-left: 0.28em;">
                  ${otp}
                </span>
              </div>
            </td>
          </tr>

          <!-- Expiry Notice -->
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <p style="margin: 0; font-size: 12px; color: #71717a;">
                This code expires in <strong style="color: #c084fc;">10 minutes</strong> and can only be used once.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding-bottom: 24px;">
              <hr style="border: none; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 0;">
            </td>
          </tr>

          <!-- Footer Security Disclaimer -->
          <tr>
            <td align="center">
              <p style="margin: 0; font-size: 11px; line-height: 1.5; color: #52525b;">
                If you did not request this verification code, you can safely ignore this email.
                Never share your verification code with anyone.
              </p>
              <p style="margin: 8px 0 0 0; font-size: 11px; color: #3f3f46;">
                CGC University, Mohali • Student Advisory Council (SAC)
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    if (guardActive) {
      if (
        (process.env.APPROVED_TEST_EMAIL || "").trim().toLowerCase() !== HARDCODED_PERMITTED_TEST_EMAIL ||
        normalizedToEmail !== HARDCODED_PERMITTED_TEST_EMAIL
      ) {
        console.warn("[SAFEGUARD BLOCKED] Outbound OTP send aborted immediately before Resend SDK call.");
        return {
          success: false,
          error: "Verification code delivery suppressed: test recipient safeguard is active.",
        };
      }
    }

    const destinationEmail = guardActive ? HARDCODED_PERMITTED_TEST_EMAIL : normalizedToEmail;
    console.log(`[AUTH OTP] Dispatching verification code to recipient: ${destinationEmail}`);
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [destinationEmail],
      subject,
      html,
    });

    if (error) {
      console.error("[AUTH OTP] Resend dispatch error:", error);
      return {
        success: false,
        error: "Unable to send verification code. Please try again later.",
      };
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : "Unknown email dispatch failure.";
    console.error("[AUTH OTP] Unexpected send exception:", errorMsg);
    return {
      success: false,
      error: "Unable to send verification code. Please try again later.",
    };
  }
}
