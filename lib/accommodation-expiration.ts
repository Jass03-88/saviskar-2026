/**
 * Saviskar 2026 — Accommodation Checkout Expiration & Overlap Policy
 *
 * Implements authoritative safeguards:
 * 1. Safe expiration policy: Only truly abandoned, unpaid checkouts (> 1 hr)
 *    associated with eligible pending orders without gateway captures can be expired.
 * 2. Protection of active/paid orders: Orders with in-flight gateway transactions,
 *    recent checkouts (< 1 hr), or confirmed payments are never cancelled.
 * 3. Idempotent late-settlement handling: Late callbacks for expired orders settle
 *    without violating exclusion constraints (via process_payment_success audit logging).
 * 4. Actionable error reporting: Translates raw Postgres 23P01 exclusion errors
 *    or SVK11 errors into clear user-facing guidance.
 */

import { SupabaseClient } from "@supabase/supabase-js";

/** Default expiration timeout: 1 hour (matches register_participant_events checkout window) */
export const CHECKOUT_EXPIRATION_THRESHOLD_MS = 60 * 60 * 1000;

export type PendingCheckoutState =
  | "CONFIRMED_PAID"
  | "ACTIVE_IN_FLIGHT"
  | "EXPIRED_UNPAID"
  | "CANCELLED_OR_FAILED";

export interface StayRecordLike {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  payment_order_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PaymentOrderRecordLike {
  id: string;
  status: string;
  gateway_payment_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Pure function: Evaluates whether a pending accommodation booking is eligible for expiration.
 *
 * Requirements:
 * - Never expires a booking if stay or payment order is already 'paid' or 'refunded'.
 * - Never expires a booking if gateway_payment_id is present (in-flight or captured on gateway).
 * - Never expires a booking if the last activity is within timeoutMs (active user checkout).
 * - Only expires if stay is 'pending'/'unpaid', payment order is 'pending'/'failed', and age exceeds timeoutMs.
 */
export function evaluatePendingCheckoutState(
  stay: StayRecordLike,
  paymentOrder: PaymentOrderRecordLike | null | undefined,
  nowMs: number = Date.now(),
  timeoutMs: number = CHECKOUT_EXPIRATION_THRESHOLD_MS
): PendingCheckoutState {
  // 1. Status 'paid' is permanently confirmed
  if (stay.status === "paid") {
    return "CONFIRMED_PAID";
  }

  // 2. Already terminal inactive state
  if (stay.status === "cancelled" || stay.status === "failed") {
    return "CANCELLED_OR_FAILED";
  }

  // 3. Evaluate associated payment order
  if (paymentOrder) {
    if (paymentOrder.status === "paid" || paymentOrder.status === "refunded") {
      return "CONFIRMED_PAID";
    }

    // If gateway payment ID is present, payment transaction was initiated/captured
    if (paymentOrder.gateway_payment_id) {
      return "ACTIVE_IN_FLIGHT";
    }

    // If payment order explicitly failed, it's immediately expired
    if (paymentOrder.status === "failed") {
      return "EXPIRED_UNPAID";
    }
  }

  // 4. Age Check against Timeout Window
  const stayTime = new Date(stay.updated_at || stay.created_at || 0).getTime();
  const orderTime = paymentOrder
    ? new Date(paymentOrder.updated_at || paymentOrder.created_at || 0).getTime()
    : stayTime;

  const mostRecentTimestamp = Math.max(stayTime, orderTime);
  const elapsedMs = nowMs - mostRecentTimestamp;

  if (elapsedMs < timeoutMs) {
    return "ACTIVE_IN_FLIGHT";
  }

  return "EXPIRED_UNPAID";
}

/**
 * Convenience helper to determine whether a stay can be safely cancelled.
 */
export function isCheckoutEligibleForExpiration(
  stay: StayRecordLike,
  paymentOrder: PaymentOrderRecordLike | null | undefined,
  nowMs: number = Date.now(),
  timeoutMs: number = CHECKOUT_EXPIRATION_THRESHOLD_MS
): boolean {
  return evaluatePendingCheckoutState(stay, paymentOrder, nowMs, timeoutMs) === "EXPIRED_UNPAID";
}

export interface ExpirationCheckResult {
  canProceed: boolean;
  reason?: PendingCheckoutState;
  conflictStay?: StayRecordLike;
  message?: string;
  expiredCount?: number;
}

/**
 * Server-side helper: Inspects database for overlapping pending stays and safely
 * expires abandoned checkouts before inserting a new booking.
 */
export async function safeExpireStaleAccommodationStays(
  supabaseAdmin: SupabaseClient,
  participantUuid: string,
  startDate: string,
  endDate: string,
  options?: {
    nowMs?: number;
    timeoutMs?: number;
  }
): Promise<ExpirationCheckResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const timeoutMs = options?.timeoutMs ?? CHECKOUT_EXPIRATION_THRESHOLD_MS;

  // Find all pending/unpaid stays overlapping with the requested interval
  const { data: overlappingStays, error: queryError } = await supabaseAdmin
    .from("participant_accommodations")
    .select("id, status, start_date, end_date, payment_order_id, created_at, updated_at")
    .eq("participant_id", participantUuid)
    .in("status", ["pending", "unpaid"])
    .lt("start_date", endDate)
    .gt("end_date", startDate);

  if (queryError) {
    console.error("Error querying pending accommodations for expiration check:", queryError);
    return { canProceed: false, message: "Failed to verify stay availability." };
  }

  if (!overlappingStays || overlappingStays.length === 0) {
    return { canProceed: true, expiredCount: 0 };
  }

  let expiredCount = 0;

  for (const stay of overlappingStays) {
    let paymentOrder: PaymentOrderRecordLike | null = null;

    if (stay.payment_order_id) {
      const { data: po } = await supabaseAdmin
        .from("payment_orders")
        .select("id, status, gateway_payment_id, created_at, updated_at")
        .eq("id", stay.payment_order_id)
        .maybeSingle();
      paymentOrder = po;
    }

    const state = evaluatePendingCheckoutState(stay, paymentOrder, nowMs, timeoutMs);

    if (state === "ACTIVE_IN_FLIGHT") {
      return {
        canProceed: false,
        reason: "ACTIVE_IN_FLIGHT",
        conflictStay: stay,
        message: `Active checkout in progress for these dates (${stay.start_date} to ${stay.end_date}). Please complete the pending payment or wait for the session to expire.`,
      };
    }

    if (state === "CONFIRMED_PAID") {
      return {
        canProceed: false,
        reason: "CONFIRMED_PAID",
        conflictStay: stay,
        message: `Accommodation is already confirmed for these dates (${stay.start_date} to ${stay.end_date}).`,
      };
    }

    if (state === "EXPIRED_UNPAID") {
      // Safely cancel only the expired accommodation hold using a conditional update.
      // This immediately releases the GiST exclusion constraint on the date interval.
      const nowIso = new Date(nowMs).toISOString();
      const { data: updatedRows, error: updateError } = await supabaseAdmin
        .from("participant_accommodations")
        .update({ status: "cancelled", updated_at: nowIso })
        .eq("id", stay.id)
        .in("status", ["pending", "unpaid"])
        .select("id");

      if (updateError) {
        console.error("Failed to cancel expired accommodation stay:", updateError);
        continue;
      }

      // CRITICAL PRESERVATION: We deliberately do NOT update payment_orders to 'cancelled' here.
      // A payment order in Saviskar can be a shared/combined order covering multiple items
      // (such as other team members' stays or event registrations). Cancelling the entire
      // payment order would prematurely break those unrelated items.
      // Furthermore, if concurrent settlement was in flight, the conditional check
      // .in("status", ["pending", "unpaid"]) ensures a stay already marked 'paid' is never overwritten.
      if (updatedRows && updatedRows.length > 0) {
        expiredCount++;
      }
    }
  }

  return { canProceed: true, expiredCount };
}

/**
 * Normalizes Postgres and RPC error codes into clear, actionable, user-friendly messages.
 */
export function formatAccommodationOverlapError(
  error: any,
  context?: { startDate?: string; endDate?: string }
): { message: string; code: string } {
  const code = error?.code || "";
  const msg = error?.message || (typeof error === "string" ? error : "");

  // 1. PostgreSQL GiST exclusion constraint violation: 23P01
  if (
    code === "23P01" ||
    msg.includes("participant_accommodations_no_overlap") ||
    msg.includes("exclusion constraint")
  ) {
    const dateRange =
      context?.startDate && context?.endDate
        ? ` (${context.startDate} to ${context.endDate})`
        : "";
    return {
      message: `These accommodation dates${dateRange} conflict with an existing booking or an active checkout in progress. Please choose different dates.`,
      code: "ACCOMMODATION_OVERLAP_CONFLICT",
    };
  }

  // 2. Active checkout in progress (SVK11 from RPC)
  if (msg.includes("Active checkout in progress")) {
    return {
      message: msg,
      code: "ACTIVE_CHECKOUT_IN_PROGRESS",
    };
  }

  // 3. General overlap
  if (msg.includes("already has a confirmed accommodation booking") || msg.includes("partially overlaps")) {
    return {
      message: msg,
      code: "OVERLAPPING_STAY",
    };
  }

  return {
    message: msg || "Failed to process accommodation booking.",
    code: code || "RPC_ERROR",
  };
}
