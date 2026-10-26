import { Resend } from "resend";
import {
  isHybridDevelopmentModeActive,
  isSyntheticTestEmail,
} from "@/lib/broadcast/supabase-admin";

export const DEFAULT_CAMPAIGN_SENDER =
  "Saviskar Updates <broadcast@updates.saviskar.co.in>";
export const PROHIBITED_DOMAINS = ["amadhav.com", "onboarding@resend.dev"];

// Strict RFC display name + email regex: e.g. "Name <email@domain.com>"
const SENDER_FORMAT_REGEX =
  /^[\w\s.-]+<[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}>$/;

// Conservative raw attachment threshold (18 MB) to prevent provider payload rejections
export const RAW_ATTACHMENT_THRESHOLD_BYTES = 18 * 1024 * 1024; // 18 MB

export interface CampaignSenderResult {
  success: boolean;
  from?: string;
  error?: string;
}

/**
 * Validates and retrieves the configured campaign sender address from RESEND_CAMPAIGN_FROM_EMAIL.
 * Strictly isolates campaigns from the transactional sender (RESEND_FROM_EMAIL).
 * In production: fails closed if missing, invalid, or using prohibited domains.
 */
export function getCampaignEmailSender(): CampaignSenderResult {
  const configured = process.env.RESEND_CAMPAIGN_FROM_EMAIL?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!configured) {
    if (isProd) {
      return {
        success: false,
        error:
          "RESEND_CAMPAIGN_FROM_EMAIL is not configured in production. Campaign dispatch aborted to protect transactional reputation.",
      };
    }
    return {
      success: true,
      from: DEFAULT_CAMPAIGN_SENDER,
    };
  }

  const lower = configured.toLowerCase();
  for (const domain of PROHIBITED_DOMAINS) {
    if (lower.includes(domain)) {
      return {
        success: false,
        error: `Prohibited domain '${domain}' detected in RESEND_CAMPAIGN_FROM_EMAIL. Dispatch aborted.`,
      };
    }
  }

  if (!SENDER_FORMAT_REGEX.test(configured)) {
    if (isProd) {
      return {
        success: false,
        error:
          "RESEND_CAMPAIGN_FROM_EMAIL does not match the required 'Display Name <email@domain>' RFC format.",
      };
    }
    return {
      success: true,
      from: DEFAULT_CAMPAIGN_SENDER,
    };
  }

  return {
    success: true,
    from: configured,
  };
}

export interface EmailAttachment {
  filename: string;
  content: Buffer; // Raw PDF bytes
}

export interface SendCampaignEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  idempotencyKey?: string;
  testMode?: boolean;
}

export interface SendCampaignEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  isRetryable?: boolean;
}

export interface MockCampaignDispatch {
  toDomain: string;
  recipientRedacted: string;
  subject: string;
  attachmentCount: number;
  messageId: string;
  idempotencyKey?: string;
  timestamp: string;
}

const mockCampaignDispatches: MockCampaignDispatch[] = [];

export function getMockCampaignDispatches(): MockCampaignDispatch[] {
  return [...mockCampaignDispatches];
}

export function clearMockCampaignDispatches(): void {
  mockCampaignDispatches.length = 0;
}

/**
 * Dispatches an email via the Resend API with idempotency key and attachments.
 */
export async function sendCampaignEmail(
  options: SendCampaignEmailOptions
): Promise<SendCampaignEmailResult> {
  const senderCheck = getCampaignEmailSender();
  if (!senderCheck.success || !senderCheck.from) {
    return {
      success: false,
      error: senderCheck.error || "Campaign sender configuration invalid.",
      errorCode: "INVALID_SENDER_CONFIG",
      isRetryable: false,
    };
  }

  // Hybrid Development Mode guard: strictly forbid non-@saviskar.test deliveries at the transport layer
  if (isHybridDevelopmentModeActive() && !isSyntheticTestEmail(options.to)) {
    return {
      success: false,
      error: `Hybrid development mode only permits mock dispatch to '@saviskar.test' recipients. Dispatch to '${options.to.split("@")[1] || "unknown"}' is strictly blocked.`,
      errorCode: "UNAPPROVED_HYBRID_RECIPIENT_DOMAIN",
      isRetryable: false,
    };
  }

  const isCloudOrProd =
    process.env.NODE_ENV === "production" ||
    Boolean(
      process.env.VERCEL ||
      process.env.NETLIFY ||
      process.env.FLY_APP_NAME ||
      process.env.RENDER
    );

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const isPlaceholderKey = !apiKey || apiKey === "<resend-api-key-required>";

  if (isCloudOrProd) {
    if (isPlaceholderKey) {
      return {
        success: false,
        error: "Valid RESEND_API_KEY is required in production / cloud environments.",
        errorCode: "MISSING_API_KEY",
        isRetryable: false,
      };
    }
  } else {
    // Local development or test runner: safe isolated mock transport
    const useMockTransport =
      isHybridDevelopmentModeActive() ||
      process.env.E2E_EMAIL_TRANSPORT === "mock" ||
      process.env.E2E_EMAIL_TRANSPORT === "mailpit" ||
      isPlaceholderKey;

    if (useMockTransport) {
      const atIndex = options.to.indexOf("@");
      const domain = atIndex > -1 ? options.to.slice(atIndex + 1) : "unknown";
      // Privacy safeguard: only unredacted if explicitly in reserved .test domain
      const recipientRedacted = options.to.toLowerCase().endsWith("@saviskar.test")
        ? options.to
        : `[REDACTED]@${domain}`;

      const messageId = `mock_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      mockCampaignDispatches.push({
        toDomain: domain,
        recipientRedacted,
        subject: options.subject,
        attachmentCount: options.attachments?.length || 0,
        messageId,
        idempotencyKey: options.idempotencyKey,
        timestamp: new Date().toISOString(),
      });

      console.log(
        `[CAMPAIGN MOCK TRANSPORT] Dispatched to ${recipientRedacted} via ${senderCheck.from}: "${options.subject}" (${options.attachments?.length || 0} attachments) [id: ${messageId}]`
      );

      return {
        success: true,
        messageId,
      };
    }
  }

  const resend = new Resend(apiKey);

  try {
    const formattedAttachments = options.attachments?.map((att) => ({
      filename: att.filename,
      content: att.content,
    }));

    // Pass official idempotencyKey option to Resend SDK
    const resendOptions: Parameters<typeof resend.emails.send>[0] = {
      from: senderCheck.from,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]+>/g, " ").trim(),
      attachments: formattedAttachments && formattedAttachments.length > 0 ? formattedAttachments : undefined,
    };

    // If options allows custom headers or options:
    const sendResult = await resend.emails.send(resendOptions, {
      idempotencyKey: options.idempotencyKey,
    } as any);

    if (sendResult.error) {
      const errName = sendResult.error.name;
      const errMsg = sendResult.error.message;
      const isRetryable =
        errName === "rate_limit_exceeded" ||
        errName === "internal_server_error" ||
        errMsg.toLowerCase().includes("timeout");

      return {
        success: false,
        error: `${errName}: ${errMsg}`,
        errorCode: errName,
        isRetryable,
      };
    }

    return {
      success: true,
      messageId: sendResult.data?.id,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    return {
      success: false,
      error: msg,
      errorCode: "DISPATCH_EXCEPTION",
      isRetryable: true,
    };
  }
}

/**
 * Splits a list of attachments into multi-part buckets if total raw size exceeds threshold.
 */
export function chunkAttachments(
  attachments: EmailAttachment[],
  maxSizeBytes = RAW_ATTACHMENT_THRESHOLD_BYTES
): EmailAttachment[][] {
  if (attachments.length <= 1) {
    return [attachments];
  }

  const parts: EmailAttachment[][] = [];
  let currentPart: EmailAttachment[] = [];
  let currentBytes = 0;

  for (const att of attachments) {
    const attSize = att.content.length;

    if (currentPart.length > 0 && currentBytes + attSize > maxSizeBytes) {
      parts.push(currentPart);
      currentPart = [att];
      currentBytes = attSize;
    } else {
      currentPart.push(att);
      currentBytes += attSize;
    }
  }

  if (currentPart.length > 0) {
    parts.push(currentPart);
  }

  return parts;
}
