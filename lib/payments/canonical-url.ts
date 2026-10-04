/**
 * Saviskar 2026 - Canonical Payment URL Resolver & Validator
 *
 * Single source of truth for payment gateway callback base URLs and
 * post-payment success/failure redirect destinations.
 *
 * Security & Reliability Invariants:
 * 1. Production must strictly use a validated HTTPS canonical origin.
 * 2. Ephemeral tunnels (e.g. *.trycloudflare.com, *.ngrok.io, *.loca.lt) and localhost
 *    are STRICTLY PROHIBITED in production to prevent attendees from being redirected
 *    to dead endpoints.
 * 3. /api/payments/create, /api/payments/payu/success, and /api/payments/payu/failure
 *    share the identical origin resolution logic.
 * 4. Local development preserves dynamic tunnel and localhost support.
 */

import { NextRequest } from "next/server";

export const STABLE_PRODUCTION_ORIGIN = "https://saviskar.co.in";

export const ALLOWED_PRODUCTION_ORIGINS = [
  "https://saviskar.co.in",
  "https://saviskar-2026.vercel.app",
  "https://saviskar-26.vercel.app",
];

const PROHIBITED_PROD_HOSTNAMES = [
  "trycloudflare.com",
  "ngrok.io",
  "ngrok.app",
  "ngrok-free.app",
  "loca.lt",
  "localhost",
  "127.0.0.1",
  ".local",
];

export type CanonicalPaymentUrlResult =
  | { success: true; origin: string }
  | { success: false; error: string; internalLog: string };

/**
 * Resolves and validates the canonical base origin for payment callbacks and resume redirects.
 */
export function getCanonicalPaymentBaseUrl(req?: NextRequest): CanonicalPaymentUrlResult {
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";

  // Non-production (development & test) resolution:
  if (!isProduction) {
    if (req) {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      const proto =
        req.headers.get("x-forwarded-proto") ||
        (req.nextUrl?.protocol ? req.nextUrl.protocol.replace(":", "") : "http");

      if (host) {
        return { success: true, origin: `${proto}://${host}`.replace(/\/+$/, "") };
      }
      if (req.nextUrl?.origin) {
        return { success: true, origin: req.nextUrl.origin.replace(/\/+$/, "") };
      }
    }

    const rawDev =
      process.env.PAYMENT_CALLBACK_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim();

    if (rawDev) {
      return { success: true, origin: rawDev.replace(/\/+$/, "") };
    }

    return { success: true, origin: "http://localhost:3000" };
  }

  // Production resolution:
  // Source of truth: PAYMENT_CALLBACK_BASE_URL, fallback: NEXT_PUBLIC_SITE_URL, ultimate default: STABLE_PRODUCTION_ORIGIN
  const configured =
    process.env.PAYMENT_CALLBACK_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!configured) {
    // Safe default to known stable deployed domain if neither variable is set
    return {
      success: true,
      origin: STABLE_PRODUCTION_ORIGIN,
    };
  }

  const raw = configured.trim();

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    console.warn(`[PAYMENT URL WARN] Malformed production payment base URL: "${raw}". Falling back to "${STABLE_PRODUCTION_ORIGIN}".`);
    return { success: true, origin: STABLE_PRODUCTION_ORIGIN };
  }

  // Require HTTPS protocol
  if (parsed.protocol !== "https:") {
    console.warn(`[PAYMENT URL WARN] Production payment base URL must use HTTPS. Received: "${raw}". Falling back to "${STABLE_PRODUCTION_ORIGIN}".`);
    return { success: true, origin: STABLE_PRODUCTION_ORIGIN };
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    console.warn(`[PAYMENT URL WARN] Production payment base URL cannot contain credentials: "${raw}". Falling back to "${STABLE_PRODUCTION_ORIGIN}".`);
    return { success: true, origin: STABLE_PRODUCTION_ORIGIN };
  }

  // Reject pathnames (must be a true origin)
  if (parsed.pathname && parsed.pathname !== "/") {
    console.warn(`[PAYMENT URL WARN] Production payment base URL cannot contain paths: "${raw}". Falling back to "${STABLE_PRODUCTION_ORIGIN}".`);
    return { success: true, origin: STABLE_PRODUCTION_ORIGIN };
  }

  // Reject query parameters
  if (parsed.search) {
    console.warn(`[PAYMENT URL WARN] Production payment base URL cannot contain query parameters: "${raw}". Falling back to "${STABLE_PRODUCTION_ORIGIN}".`);
    return { success: true, origin: STABLE_PRODUCTION_ORIGIN };
  }

  // Reject fragments/hash
  if (parsed.hash) {
    console.warn(`[PAYMENT URL WARN] Production payment base URL cannot contain fragments: "${raw}". Falling back to "${STABLE_PRODUCTION_ORIGIN}".`);
    return { success: true, origin: STABLE_PRODUCTION_ORIGIN };
  }

  // Reject prohibited tunnel hostnames and localhost
  const hostname = parsed.hostname.toLowerCase();
  const isProhibited = PROHIBITED_PROD_HOSTNAMES.some(
    (bad) => hostname.endsWith(bad) || hostname.includes(bad)
  );

  if (isProhibited) {
    console.warn(`[PAYMENT URL WARN] Prohibited ephemeral tunnel or localhost domain detected in production: "${raw}". Falling back to "${STABLE_PRODUCTION_ORIGIN}".`);
    return { success: true, origin: STABLE_PRODUCTION_ORIGIN };
  }

  // Ensure origin strictly matches one of the allowed production origins
  if (!ALLOWED_PRODUCTION_ORIGINS.includes(parsed.origin)) {
    console.warn(`[PAYMENT URL WARN] Non-canonical production origin: "${parsed.origin}". Configured origin must match one of the allowed origins. Falling back to canonical origin.`);
    return { success: true, origin: STABLE_PRODUCTION_ORIGIN };
  }

  return {
    success: true,
    origin: parsed.origin,
  };
}
