/**
 * Payment Gateway Factory
 *
 * Resolves the active payment gateway implementation.
 * Defaults to Razorpay. Set the PAYMENT_GATEWAY env var
 * to switch providers (e.g. "cashfree", "stripe").
 *
 * Usage:
 *   import { getPaymentGateway } from "@/lib/payments";
 *   const gateway = getPaymentGateway();
 *   const order = await gateway.createOrder({ ... });
 */

import type { PaymentGateway } from "./types";
import { RazorpayGateway } from "./razorpay";

// Re-export all types for convenience
export type {
  PaymentGateway,
  PaymentStatus,
  CreateOrderParams,
  CreateOrderResult,
  FetchedPaymentDetails,
  VerifyPaymentParams,
  VerifyPaymentResult,
  CheckoutConfig,
  WebhookEvent,
  WebhookValidationResult,
} from "./types";

export {
  createPaymentResumeToken,
  verifyPaymentResumeToken,
  generatePaymentResumeUrl,
  getSiteBaseUrl,
} from "./resume-token";
export type { PaymentResumeTokenPayload } from "./resume-token";

// ─────────────────────────────────────────────────────────────────
// Gateway Registry
// ─────────────────────────────────────────────────────────────────

const gateways: Record<
  string,
  () => PaymentGateway
> = {
  razorpay: () => new RazorpayGateway(),

  // Future gateways:
  // cashfree: () => new CashfreeGateway(),
  // stripe:   () => new StripeGateway(),
};

// ─────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────

/**
 * Get the active payment gateway instance.
 *
 * @param name  Explicit gateway name. If omitted, reads
 *              from the PAYMENT_GATEWAY env var, defaulting
 *              to "razorpay".
 */
export function getPaymentGateway(
  name?: string
): PaymentGateway {
  const gatewayName = (
    name ??
    process.env.PAYMENT_GATEWAY ??
    "razorpay"
  ).toLowerCase();

  const factory = gateways[gatewayName];

  if (!factory) {
    throw new Error(
      `Unknown payment gateway: "${gatewayName}". ` +
        `Available: ${Object.keys(gateways).join(", ")}`
    );
  }

  return factory();
}
