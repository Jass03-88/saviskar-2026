/**
 * Gateway-Agnostic Payment Types
 *
 * These interfaces define the contract that every payment gateway
 * implementation must satisfy. The registration system and API routes
 * interact exclusively with these types — never with provider-specific
 * APIs directly.
 *
 * To add a new gateway (e.g. Cashfree, Stripe), implement the
 * PaymentGateway interface and register it in lib/payments/index.ts.
 */

// ─────────────────────────────────────────────────────────────────
// Payment Status
// ─────────────────────────────────────────────────────────────────

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

// ─────────────────────────────────────────────────────────────────
// Create Order
// ─────────────────────────────────────────────────────────────────

export type CreateOrderParams = {
  /** Internal payment order reference (e.g. SVK-SVK26-ABCD1234-...) */
  orderReference: string;

  /** Amount in smallest currency unit (paise for INR). */
  amountInSmallestUnit: number;

  /** ISO 4217 currency code. */
  currency: string;

  /** Payer information for prefill. */
  payer: {
    name?: string;
    email?: string;
    phone?: string;
  };

  /** Optional notes/metadata to attach to the gateway order. */
  notes?: Record<string, string>;
};

export type CreateOrderResult = {
  /** Gateway-specific order ID (e.g. order_XXXXX for Razorpay). */
  gatewayOrderId: string;

  /** Current order status from the gateway. */
  status: string;
};

// ─────────────────────────────────────────────────────────────────
// Verify Payment
// ─────────────────────────────────────────────────────────────────

export type VerifyPaymentParams = {
  /** Gateway order ID. */
  gatewayOrderId: string;

  /** Gateway payment ID (returned after successful checkout). */
  gatewayPaymentId: string;

  /** Signature from the gateway for server-side verification. */
  gatewaySignature: string;
};

export type VerifyPaymentResult = {
  /** Whether the signature verification passed. */
  verified: boolean;

  /** Gateway payment ID (echoed back for convenience). */
  gatewayPaymentId: string;
};

// ─────────────────────────────────────────────────────────────────
// Checkout Config (browser-side)
// ─────────────────────────────────────────────────────────────────

export type CheckoutConfig = {
  /** Gateway name (for the frontend to know which SDK to load). */
  gateway: string;

  /** Gateway-specific configuration for the checkout overlay/redirect. */
  options: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────

export type WebhookEvent = {
  /** Parsed event type (e.g. "payment.captured", "payment.failed"). */
  eventType: string;

  /** Gateway order ID extracted from the webhook payload. */
  gatewayOrderId: string;

  /** Gateway payment ID extracted from the webhook payload. */
  gatewayPaymentId: string;

  /** Resolved payment status. */
  status: PaymentStatus;

  /** Full raw payload (for logging). */
  rawPayload: unknown;
};

export type WebhookValidationResult = {
  /** Whether the webhook signature is valid. */
  valid: boolean;

  /** Parsed event (only present when valid). */
  event?: WebhookEvent;

  /** Error message (only present when invalid). */
  error?: string;
};

// ─────────────────────────────────────────────────────────────────
// Gateway Interface
// ─────────────────────────────────────────────────────────────────

export interface PaymentGateway {
  /** Human-readable gateway name (e.g. "razorpay", "cashfree"). */
  readonly name: string;

  /** Create an order on the gateway. */
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;

  /** Verify a payment using the gateway's signature mechanism. */
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;

  /**
   * Build the checkout configuration that the frontend needs
   * to open the gateway's checkout overlay/redirect.
   */
  getCheckoutConfig(params: {
    gatewayOrderId: string;
    amount: number;
    currency: string;
    payer: CreateOrderParams["payer"];
    orderReference: string;
  }): CheckoutConfig;

  /**
   * Validate and parse an incoming webhook request.
   * Returns the parsed event if signature is valid.
   */
  validateWebhook(params: {
    body: string;
    signature: string;
  }): WebhookValidationResult;
}
