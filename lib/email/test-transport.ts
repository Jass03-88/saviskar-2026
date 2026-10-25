/**
 * SAVISKAR 2026 — LOCAL ISOLATED E2E EMAIL TRANSPORT (Mailpit HTTP/REST)
 * File: lib/email/test-transport.ts
 *
 * Provides a strictly isolated, test-only email transport to local Mailpit
 * (port 54324) for E2E verification when no external Resend key is configured.
 *
 * FAIL-CLOSED SAFETY INVARIANTS:
 * 1. Strictly disabled in production (NODE_ENV === "production" fails).
 * 2. Requires explicit E2E_EMAIL_TRANSPORT === "mailpit".
 * 3. Requires ENABLE_TEST_RECIPIENT_GUARD === "true".
 * 4. Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SITE_URL, and PAYMENT_CALLBACK_BASE_URL
 *    to point strictly to 127.0.0.1 or localhost.
 * 5. Requires recipient to match HARDCODED_PERMITTED_TEST_EMAIL ("jashan.cgcu@gmail.com").
 * 6. Never logs OTP values, sensitive tokens, or personal identifiers.
 */

const HARDCODED_PERMITTED_TEST_EMAIL = "jashan.cgcu@gmail.com";
const DEFAULT_MAILPIT_API_URL = "http://127.0.0.1:54324";

export interface TestEmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  contentId?: string;
}

export interface SendTestEmailParams {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: TestEmailAttachment[];
}

export interface SendTestEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export function isTestEmailTransportActive(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.E2E_EMAIL_TRANSPORT !== "mailpit") return false;
  if (process.env.ENABLE_TEST_RECIPIENT_GUARD !== "true") return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  const callbackUrl = process.env.PAYMENT_CALLBACK_BASE_URL || "";

  // Fail-closed if pointing to remote or production hosts
  const isLocalHost = (urlStr: string) => {
    try {
      const u = new URL(urlStr);
      return u.hostname === "127.0.0.1" || u.hostname === "localhost";
    } catch {
      return false;
    }
  };

  return isLocalHost(supabaseUrl) && isLocalHost(siteUrl) && isLocalHost(callbackUrl);
}

export async function sendViaTestTransport(
  params: SendTestEmailParams
): Promise<SendTestEmailResult> {
  if (!isTestEmailTransportActive()) {
    return {
      success: false,
      error: "Test email transport is not active or environment isolation invariants failed.",
    };
  }

  const normalizedTo = params.to.trim().toLowerCase();
  const configuredEmail = (process.env.APPROVED_TEST_EMAIL || "").trim().toLowerCase();

  if (
    normalizedTo !== HARDCODED_PERMITTED_TEST_EMAIL ||
    configuredEmail !== HARDCODED_PERMITTED_TEST_EMAIL
  ) {
    console.warn(
      `[SAFEGUARD BLOCKED] Test email transport suppressed: destination address does not match authorized tester.`
    );
    return {
      success: false,
      error: "Recipient not permitted under test transport safeguard.",
    };
  }

  // Parse from field into { Email, Name }
  let fromEmail = "noreply@saviskar.co.in";
  let fromName = "Saviskar 2026";
  const match = params.from.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    fromName = match[1].trim();
    fromEmail = match[2].trim();
  } else if (params.from.includes("@")) {
    fromEmail = params.from.trim();
  }

  // Format attachments for Mailpit API: [{ Filename, Content: base64, ContentType, ContentID }]
  const formattedAttachments = (params.attachments || []).map((att) => {
    const base64Content = Buffer.isBuffer(att.content)
      ? att.content.toString("base64")
      : Buffer.from(att.content).toString("base64");
    return {
      Filename: att.filename,
      Content: base64Content,
      ContentType: att.contentType,
      ContentID: att.contentId,
    };
  });

  const mailpitEndpoint = `${process.env.MAILPIT_API_URL || DEFAULT_MAILPIT_API_URL}/api/v1/send`;

  try {
    const response = await fetch(mailpitEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: normalizedTo, Name: fromName }],
        Subject: params.subject,
        HTML: params.html,
        Text: params.text || "",
        ...(formattedAttachments.length > 0 ? { Attachments: formattedAttachments } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "(unreadable)");
      console.error(`[TEST EMAIL TRANSPORT ERROR] Mailpit returned HTTP ${response.status}: ${errText}`);
      return {
        success: false,
        error: `Mailpit API error: HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as { ID?: string };
    console.log(`[TEST EMAIL TRANSPORT] Dispatched message to local Mailpit (Message ID: ${data.ID})`);

    return {
      success: true,
      messageId: data.ID || `mailpit-${Date.now()}`,
    };
  } catch (err) {
    console.error(`[TEST EMAIL TRANSPORT ERROR] Network error connecting to Mailpit: ${err instanceof Error ? err.message : String(err)}`);
    return {
      success: false,
      error: "Failed to connect to local Mailpit service.",
    };
  }
}
