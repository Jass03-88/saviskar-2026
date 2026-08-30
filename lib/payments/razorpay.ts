/**
 * Razorpay Payment Gateway Implementation
 *
 * Uses Razorpay's REST API directly via fetch (no SDK dependency).
 * The checkout overlay uses their CDN script loaded dynamically
 * on the client side.
 *
 * Environment variables required:
 *   RAZORPAY_KEY_ID          — API Key ID (also exposed as NEXT_PUBLIC_)
 *   RAZORPAY_KEY_SECRET      — API Key Secret (server-only)
 *   RAZORPAY_WEBHOOK_SECRET  — Webhook signing secret (server-only)
 */

import { createHmac, timingSafeEqual } from "crypto";

import type {
  PaymentGateway,
  CreateOrderParams,
  CreateOrderResult,
  FetchedPaymentDetails,
  VerifyPaymentParams,
  VerifyPaymentResult,
  CheckoutConfig,
  WebhookValidationResult,
  PaymentStatus,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Timing-safe string comparison for HMAC signatures.
 *
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 * Handles differing buffer lengths safely (returns false
 * instead of throwing RangeError).
 *
 * Note: For fixed-length HMAC-SHA256 hex digests (64 chars),
 * the length check does not leak useful information.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function getKeyId(): string {
  const key = process.env.RAZORPAY_KEY_ID;
  if (!key) {
    throw new Error(
      "RAZORPAY_KEY_ID is not set in environment variables."
    );
  }
  return key;
}

function getKeySecret(): string {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw new Error(
      "RAZORPAY_KEY_SECRET is not set in environment variables."
    );
  }
  return secret;
}

function getWebhookSecret(): string {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "RAZORPAY_WEBHOOK_SECRET is not set in environment variables."
    );
  }
  return secret;
}

function basicAuth(): string {
  const keyId = getKeyId();
  const keySecret = getKeySecret();
  return Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

// ─────────────────────────────────────────────────────────────────
// Razorpay Gateway
// ─────────────────────────────────────────────────────────────────

export class RazorpayGateway implements PaymentGateway {
  readonly name = "razorpay" as const;

  /**
   * Create an order on Razorpay.
   *
   * Razorpay Orders API:
   * POST https://api.razorpay.com/v1/orders
   */
  async createOrder(
    params: CreateOrderParams
  ): Promise<CreateOrderResult> {
    const response = await fetch(
      "https://api.razorpay.com/v1/orders",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basicAuth()}`,
        },
        body: JSON.stringify({
          amount: params.amountInSmallestUnit,
          currency: params.currency,
          receipt: params.orderReference.slice(0, 40),
          notes: {
            order_reference: params.orderReference,
            payer_email: params.payer.email ?? "",
            payer_name: params.payer.name ?? "",
            ...params.notes,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        "Razorpay createOrder failed:",
        response.status,
        errorBody
      );
      throw new Error(
        `Razorpay order creation failed (${response.status}).`
      );
    }

    const data = (await response.json()) as {
      id: string;
      status: string;
    };

    return {
      gatewayOrderId: data.id,
      status: data.status,
    };
  }

  /**
   * Verify a Razorpay payment signature.
   *
   * Razorpay signs the string:
   *   razorpay_order_id + "|" + razorpay_payment_id
   * with the API key secret using HMAC-SHA256.
   */
  async verifyPayment(
    params: VerifyPaymentParams
  ): Promise<VerifyPaymentResult> {
    const expectedSignature = createHmac(
      "sha256",
      getKeySecret()
    )
      .update(
        `${params.gatewayOrderId}|${params.gatewayPaymentId}`
      )
      .digest("hex");

    const verified = safeCompare(
      expectedSignature,
      params.gatewaySignature
    );

    return {
      verified,
      gatewayPaymentId: params.gatewayPaymentId,
    };
  }

  /**
   * Build the configuration the frontend needs to open
   * the Razorpay checkout overlay.
   *
   * The frontend loads:
   *   https://checkout.razorpay.com/v1/checkout.js
   * and calls:
   *   new window.Razorpay(options).open()
   */
  getCheckoutConfig(params: {
    gatewayOrderId: string;
    amount: number;
    currency: string;
    payer: CreateOrderParams["payer"];
    orderReference: string;
  }): CheckoutConfig {
    return {
      gateway: this.name,
      options: {
        key: getKeyId(),
        amount: params.amount,
        currency: params.currency,
        name: "Saviskar 2026",
        description: `Registration: ${params.orderReference}`,
        order_id: params.gatewayOrderId,
        prefill: {
          name: params.payer.name ?? "",
          email: params.payer.email ?? "",
          contact: params.payer.phone ?? "",
        },
        theme: {
          color: "#000000",
        },
        notes: {
          order_reference: params.orderReference,
        },
      },
    };
  }

  /**
   * Validate an incoming Razorpay webhook.
   *
   * Razorpay signs the raw POST body with the webhook secret
   * using HMAC-SHA256 and sends it in the X-Razorpay-Signature header.
   */
  validateWebhook(params: {
    body: string;
    signature: string;
  }): WebhookValidationResult {
    let webhookSecret: string;
    try {
      webhookSecret = getWebhookSecret();
    } catch {
      return {
        valid: false,
        error: "Webhook secret is not configured.",
      };
    }

    const expectedSignature = createHmac(
      "sha256",
      webhookSecret
    )
      .update(params.body)
      .digest("hex");

    if (!safeCompare(expectedSignature, params.signature)) {
      return {
        valid: false,
        error: "Invalid webhook signature.",
      };
    }

    // Parse the payload
    let payload: any;
    try {
      payload = JSON.parse(params.body);
    } catch {
      return {
        valid: false,
        error: "Invalid webhook JSON body.",
      };
    }

    const eventType: string =
      payload?.event ?? "";

    const paymentEntity =
      payload?.payload?.payment?.entity;

    if (!paymentEntity) {
      return {
        valid: false,
        error:
          "Webhook payload missing payment entity.",
      };
    }

    const gatewayOrderId: string =
      paymentEntity.order_id ?? "";

    const gatewayPaymentId: string =
      paymentEntity.id ?? "";

    let status: PaymentStatus = "pending";

    if (eventType === "payment.captured") {
      status = "paid";
    } else if (eventType === "payment.failed") {
      status = "failed";
    }

    return {
      valid: true,
      event: {
        eventType,
        gatewayOrderId,
        gatewayPaymentId,
        status,
        rawPayload: payload,
      },
    };
  }

  /**
   * Fetch payment details from Razorpay for server-side verification.
   *
   * FAIL-CLOSED: Any error (timeout, network, 4xx/5xx, malformed
   * response, missing fields) causes this method to throw, which
   * the caller must treat as verification failure.
   *
   * Razorpay Payments API:
   * GET https://api.razorpay.com/v1/payments/:id
   */
  async fetchPaymentDetails(
    gatewayPaymentId: string
  ): Promise<FetchedPaymentDetails> {
    if (!gatewayPaymentId) {
      throw new Error(
        "fetchPaymentDetails: gatewayPaymentId is required."
      );
    }

    let response: Response;

    try {
      response = await fetch(
        `https://api.razorpay.com/v1/payments/${encodeURIComponent(gatewayPaymentId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${basicAuth()}`,
          },
          signal: AbortSignal.timeout(10_000),
        }
      );
    } catch (err) {
      // Network error, DNS failure, timeout — fail closed
      throw new Error(
        `fetchPaymentDetails: Network/timeout error fetching payment ${gatewayPaymentId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      // 4xx/5xx — fail closed
      const errorBody = await response.text().catch(() => "(unreadable)");
      throw new Error(
        `fetchPaymentDetails: Razorpay returned ${response.status} for payment ${gatewayPaymentId}: ${errorBody}`
      );
    }

    let data: Record<string, unknown>;

    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error(
        `fetchPaymentDetails: Malformed JSON response for payment ${gatewayPaymentId}.`
      );
    }

    // Validate required fields — fail closed on missing data
    const id = data.id;
    const orderId = data.order_id;
    const status = data.status;
    const amount = data.amount;
    const currency = data.currency;

    if (
      typeof id !== "string" ||
      typeof orderId !== "string" ||
      typeof status !== "string" ||
      typeof amount !== "number" ||
      typeof currency !== "string"
    ) {
      throw new Error(
        `fetchPaymentDetails: Missing or invalid fields in Razorpay response for payment ${gatewayPaymentId}. ` +
        `Got: id=${typeof id}, order_id=${typeof orderId}, status=${typeof status}, amount=${typeof amount}, currency=${typeof currency}`
      );
    }

    return {
      gatewayPaymentId: id,
      gatewayOrderId: orderId,
      status,
      amount,
      currency,
    };
  }
}
