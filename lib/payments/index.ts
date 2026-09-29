/**
 * Payment Gateway Factory
 *
 * Resolves the active payment gateway implementation.
 * Defaults to PayU. Set the PAYMENT_GATEWAY env var
 * to switch providers (e.g. "cashfree", "stripe").
 *
 * Usage:
 *   import { getPaymentGateway } from "@/lib/payments";
 *   const gateway = getPaymentGateway();
 *   const order = await gateway.createOrder({ ... });
 */

import type { PaymentGateway } from "./types";
import { PayUGateway } from "./payu";

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
export { PaymentVerificationError } from "./types";

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
  payu: () => new PayUGateway(),
};

// ─────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────

/**
 * Get the active payment gateway instance.
 *
 * @param name  Explicit gateway name. If omitted, reads
 *              from the PAYMENT_GATEWAY env var, defaulting
 *              to "payu".
 */
export function getPaymentGateway(
  name?: string
): PaymentGateway {
  const gatewayName = (
    name ??
    process.env.PAYMENT_GATEWAY ??
    "payu"
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
