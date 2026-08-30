/**
 * Secure Payment Resume Token Generator & Verifier
 *
 * Provides stateless, cryptographically signed tokens (HMAC-SHA256)
 * for email "Complete Payment" deep links.
 *
 * Security guarantees:
 *   - Signed with PAYMENT_RESUME_TOKEN_SECRET (or SUPABASE_SECRET_KEY fallback)
 *   - Timing-safe HMAC verification via crypto.timingSafeEqual
 *   - 24-hour default expiration
 *   - Unforgeable linkage between payment_order_id and participant_id
 *   - Stateless: zero database clutter
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export type PaymentResumeTokenPayload = {
  /** Internal UUID of the payment_orders record */
  paymentOrderId: string;

  /** Public Participant ID (e.g. SVK26-FFE51470) */
  participantId: string;

  /** Internal UUID of the participant (payer_participant_id) */
  payerParticipantUuid: string;

  /** Issued-at timestamp in milliseconds */
  iat: number;

  /** Expiration timestamp in milliseconds */
  exp: number;

  /** Cryptographic random nonce */
  nonce: string;
};

const DEFAULT_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Retrieves the secret used for signing and verifying resume tokens.
 * Server-only; never exposed to the client.
 */
function getTokenSecret(): string {
  const secret =
    process.env.PAYMENT_RESUME_TOKEN_SECRET?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();

  if (!secret) {
    throw new Error(
      "PAYMENT_RESUME_TOKEN_SECRET (or SUPABASE_SECRET_KEY) is not configured."
    );
  }
  return secret;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Creates a cryptographically signed, stateless payment resume token.
 */
export function createPaymentResumeToken(params: {
  paymentOrderId: string;
  participantId: string;
  payerParticipantUuid: string;
  expiresInMs?: number;
  secretOverride?: string;
}): string {
  const secret = params.secretOverride ?? getTokenSecret();
  const now = Date.now();
  const exp = now + (params.expiresInMs ?? DEFAULT_EXPIRATION_MS);
  const nonce = randomBytes(16).toString("hex");

  const payload: PaymentResumeTokenPayload = {
    paymentOrderId: params.paymentOrderId.trim(),
    participantId: params.participantId.trim(),
    payerParticipantUuid: params.payerParticipantUuid.trim(),
    iat: now,
    exp,
    nonce,
  };

  const payloadString = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadString);

  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies a payment resume token.
 * Returns valid = true and the parsed payload on success,
 * or valid = false and a safe error message on failure.
 */
export function verifyPaymentResumeToken(
  token: string,
  secretOverride?: string
): {
  valid: boolean;
  payload?: PaymentResumeTokenPayload;
  error?: string;
} {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Invalid payment link format." };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed payment link." };
  }

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) {
    return { valid: false, error: "Malformed payment link." };
  }

  let secret: string;
  try {
    secret = secretOverride ?? getTokenSecret();
  } catch {
    return { valid: false, error: "Payment service is not configured." };
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  // Timing-safe comparison of signatures
  const sigBuf = Buffer.from(signature, "utf-8");
  const expSigBuf = Buffer.from(expectedSignature, "utf-8");

  if (
    sigBuf.length !== expSigBuf.length ||
    !timingSafeEqual(sigBuf, expSigBuf)
  ) {
    return {
      valid: false,
      error: "This payment link is invalid or has expired.",
    };
  }

  let payload: PaymentResumeTokenPayload;
  try {
    const jsonString = base64UrlDecode(encodedPayload);
    payload = JSON.parse(jsonString);
  } catch {
    return {
      valid: false,
      error: "This payment link is invalid or has expired.",
    };
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !payload.paymentOrderId ||
    !payload.participantId ||
    !payload.payerParticipantUuid ||
    typeof payload.exp !== "number"
  ) {
    return {
      valid: false,
      error: "This payment link is invalid or has expired.",
    };
  }

  if (Date.now() > payload.exp) {
    return {
      valid: false,
      error: "This payment link is invalid or has expired.",
    };
  }

  return { valid: true, payload };
}

/**
 * Resolves the application base URL for email links.
 */
export function getSiteBaseUrl(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) {
    return siteUrl.replace(/\/+$/, "");
  }
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/\/+$/, "")}`;
  }
  return "http://localhost:3000";
}

/**
 * Generates the full payment resume URL for inclusion in email notifications.
 */
export function generatePaymentResumeUrl(params: {
  paymentOrderId: string;
  participantId: string;
  payerParticipantUuid: string;
  baseUrl?: string;
  expiresInMs?: number;
  secretOverride?: string;
}): string {
  const token = createPaymentResumeToken({
    paymentOrderId: params.paymentOrderId,
    participantId: params.participantId,
    payerParticipantUuid: params.payerParticipantUuid,
    expiresInMs: params.expiresInMs,
    secretOverride: params.secretOverride,
  });

  const base = (params.baseUrl || getSiteBaseUrl()).replace(/\/+$/, "");
  return `${base}/payment/resume?token=${encodeURIComponent(token)}`;
}
