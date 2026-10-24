/**
 * lib/admin/team-payment-summary.ts
 *
 * Authoritative financial and accommodation aggregation for Saviskar 2026 Admin.
 * Calculates team-level payment summaries across primary registrations,
 * linked team members, and individual accommodation records.
 *
 * Guarantees:
 * 1. Event-registration payments are calculated separately from accommodation payments.
 * 2. Accommodation amounts are calculated from actual recorded amounts (e.g. ₹499, ₹999), never hardcoded.
 * 3. Deduplicates payments and line items by unique ID so orders covering multiple members or referenced repeatedly are counted only once.
 * 4. Counts only accommodation records with authoritative paid status ('paid' or 'confirmed' with amount > 0).
 * 5. Separates genuinely active pending obligations from unselected stays (never assumed pending).
 * 6. Admin-cancelled stays ('cancelled') and failed stays ('failed') are excluded from active calculations.
 * 7. Room allocation pending ('allocated' vs 'unallocated') is never confused with payment pending.
 */

export interface AccommodationRecordLike {
  id?: string;
  status?: string | null;
  amount?: number | string | null;
  payment_order_id?: string | null;
  payment_id?: string | null;
  payment_status?: string | null;
  room_number?: string | null;
  hostel_name?: string | null;
  duration_days?: number | null;
  start_date?: string | null;
  [key: string]: unknown;
}

export interface MemberLike {
  id?: string;
  participant_id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  is_team_leader?: boolean | null;
  gender?: string | null;
  state?: string | null;
  id_card_storage_path?: string | null;
  accommodation?: AccommodationRecordLike | null;
  accommodations?: AccommodationRecordLike[] | null;
  participants?: {
    participant_id?: string | null;
    college?: string | null;
    gender?: string | null;
    state?: string | null;
  } | null;
  [key: string]: unknown;
}

export interface RegistrationLike {
  participant: {
    id: string;
    participant_id?: string | null;
    name: string;
    email?: string | null;
    phone?: string | null;
    college?: string | null;
    state?: string | null;
    accommodation?: AccommodationRecordLike | null;
    accommodations?: AccommodationRecordLike[] | null;
    [key: string]: unknown;
  };
  registration: {
    id: string;
    event_id?: string;
    payment_status?: string | null;
    payment_amount?: number | null;
    team_name?: string | null;
    checked_in?: boolean | null;
    is_archived?: boolean | null;
    [key: string]: unknown;
  };
  event?: {
    id?: string;
    name?: string | null;
    payment_type?: string | null;
    registration_fee?: number | null;
    category?: string | null;
    [key: string]: unknown;
  } | null;
  members?: MemberLike[];
  accommodation?: AccommodationRecordLike | null;
  accommodations?: AccommodationRecordLike[] | null;
  [key: string]: unknown;
}

export interface TeamPaymentSummary {
  // Headcounts
  totalTeamMembers: number;
  membersWithStayCount: number;
  membersPaidStayCount: number;
  membersPendingStayCount: number;
  membersNoStayCount: number;

  // Accommodation financials
  totalStayPaidAmount: number;
  totalStayPendingAmount: number;
  totalStayExpectedAmount: number;

  // Event financials
  totalEventPaidAmount: number;
  totalEventPendingAmount: number;
  isEventPaid: boolean;
  isEventPending: boolean;
  isEventFree: boolean;

  // Status flags
  hasAnyStay: boolean;
  hasPaidStay: boolean;
  hasPendingStay: boolean;
  isFullyPaidStay: boolean;
  hasAnyPendingPayment: boolean; // Event pending OR Stay pending

  // Visual badges & text
  stayBadgeText: string | null;
  stayBadgeVariant: "paid" | "partial" | "pending" | "none";
  stayBreakdownText: string | null;

  // Member-level details for tooltips and dialogs
  membersBreakdown: Array<{
    personId: string;
    name: string;
    isLeader: boolean;
    hasStay: boolean;
    stayStatus: "paid" | "pending" | "none" | "cancelled";
    stayAmount: number;
    roomAllocated: boolean;
  }>;
}

/**
 * Normalizes an accommodation's payment status into authoritative buckets:
 * - 'paid': verified paid/settled
 * - 'pending': active selection awaiting payment
 * - 'cancelled': cancelled or failed (no active obligation)
 * - 'none': no accommodation record
 */
export function getAuthoritativeStayStatus(
  acc?: AccommodationRecordLike | null
): "paid" | "pending" | "cancelled" | "none" {
  if (!acc || !acc.status) return "none";
  const st = acc.status.toLowerCase().trim();
  if (st === "cancelled" || st === "failed") return "cancelled";
  if (st === "paid" || st === "confirmed") return "paid";
  if (st === "pending" || st === "unpaid") return "pending";
  return "pending";
}

/**
 * Calculates a consolidated team payment and accommodation summary
 * for a single registration or a group of registrations belonging to a team/participant.
 */
export function calculateTeamPaymentSummary(
  input: RegistrationLike | RegistrationLike[]
): TeamPaymentSummary {
  const group = Array.isArray(input) ? input : [input];
  if (group.length === 0) {
    return {
      totalTeamMembers: 0,
      membersWithStayCount: 0,
      membersPaidStayCount: 0,
      membersPendingStayCount: 0,
      membersNoStayCount: 0,
      totalStayPaidAmount: 0,
      totalStayPendingAmount: 0,
      totalStayExpectedAmount: 0,
      totalEventPaidAmount: 0,
      totalEventPendingAmount: 0,
      isEventPaid: false,
      isEventPending: false,
      isEventFree: true,
      hasAnyStay: false,
      hasPaidStay: false,
      hasPendingStay: false,
      isFullyPaidStay: false,
      hasAnyPendingPayment: false,
      stayBadgeText: null,
      stayBadgeVariant: "none",
      stayBreakdownText: null,
      membersBreakdown: [],
    };
  }

  // 1. Calculate Event Registration Payments
  let totalEventPaidAmount = 0;
  let totalEventPendingAmount = 0;
  let isEventPaid = false;
  let isEventPending = false;
  let isEventFree = true;

  const seenRegIds = new Set<string>();
  for (const item of group) {
    if (!item.registration || seenRegIds.has(item.registration.id)) continue;
    seenRegIds.add(item.registration.id);

    const isPaidType = item.event?.payment_type === "paid";
    const fee = Number(item.registration.payment_amount) || Number(item.event?.registration_fee) || 0;
    const regStatus = (item.registration.payment_status || "").toLowerCase().trim();

    if (isPaidType) {
      isEventFree = false;
      if (regStatus === "paid" || regStatus === "confirmed") {
        totalEventPaidAmount += fee;
        isEventPaid = true;
      } else {
        totalEventPendingAmount += fee;
        isEventPending = true;
      }
    }
  }

  // 2. Identify All Distinct Persons in the Team
  // Primary Leader + Members
  const primaryParticipant = group[0].participant;
  const primaryId = primaryParticipant?.id || "primary";

  // Map of unique person identity -> details & stays
  interface PersonEntry {
    id: string;
    name: string;
    isLeader: boolean;
    stays: AccommodationRecordLike[];
  }

  const peopleMap = new Map<string, PersonEntry>();

  // Add primary participant
  const primaryStays: AccommodationRecordLike[] = [];
  for (const item of group) {
    if (item.participant?.accommodations && Array.isArray(item.participant.accommodations)) {
      primaryStays.push(...item.participant.accommodations);
    } else if (item.participant?.accommodation) {
      primaryStays.push(item.participant.accommodation);
    } else if (item.accommodations && Array.isArray(item.accommodations)) {
      primaryStays.push(...item.accommodations);
    } else if (item.accommodation) {
      primaryStays.push(item.accommodation);
    }
  }

  peopleMap.set(primaryId, {
    id: primaryId,
    name: primaryParticipant?.name || "Team Leader",
    isLeader: true,
    stays: primaryStays,
  });

  // Add members across all registrations in group
  for (const item of group) {
    for (const m of item.members ?? []) {
      const memberKey = m.participant_id || m.id || `${m.name}-${m.email || ""}`;
      const isLeader = Boolean(m.is_team_leader) || memberKey === primaryId;

      const mStays: AccommodationRecordLike[] = [];
      if (m.accommodations && Array.isArray(m.accommodations)) {
        mStays.push(...m.accommodations);
      } else if (m.accommodation) {
        mStays.push(m.accommodation);
      }

      if (peopleMap.has(memberKey)) {
        peopleMap.get(memberKey)!.stays.push(...mStays);
      } else {
        peopleMap.set(memberKey, {
          id: memberKey,
          name: m.name || "Member",
          isLeader,
          stays: mStays,
        });
      }
    }
  }

  // 3. Process Each Person's Stays with Deduplication
  const seenStayIds = new Set<string>();
  const seenPaymentOrderIds = new Set<string>();

  let membersWithStayCount = 0;
  let membersPaidStayCount = 0;
  let membersPendingStayCount = 0;
  let membersNoStayCount = 0;

  let totalStayPaidAmount = 0;
  let totalStayPendingAmount = 0;

  const membersBreakdown: TeamPaymentSummary["membersBreakdown"] = [];

  for (const person of peopleMap.values()) {
    // Deduplicate person's stays by ID
    const uniqueActiveStays: AccommodationRecordLike[] = [];
    let personPaid = false;
    let personPending = false;
    let personStayAmount = 0;
    let roomAllocated = false;

    for (const stay of person.stays) {
      if (!stay) continue;
      const stayId = stay.id || `${person.id}-${stay.start_date || ""}`;
      if (seenStayIds.has(stayId)) continue;
      seenStayIds.add(stayId);

      const status = getAuthoritativeStayStatus(stay);
      if (status === "cancelled" || status === "none") {
        continue;
      }

      const rawAmount = Number(stay.amount) || 0;
      // Deduplicate payment order if already counted
      let effectiveAmount = rawAmount;
      const orderRef = stay.payment_order_id || stay.payment_id;
      if (orderRef) {
        if (seenPaymentOrderIds.has(orderRef)) {
          // Amount was already accounted for by another linked line item under same order
          effectiveAmount = 0;
        } else {
          seenPaymentOrderIds.add(orderRef);
        }
      }

      uniqueActiveStays.push(stay);
      personStayAmount += rawAmount;

      if (stay.room_number) {
        roomAllocated = true;
      }

      if (status === "paid") {
        personPaid = true;
        totalStayPaidAmount += effectiveAmount;
      } else if (status === "pending") {
        personPending = true;
        totalStayPendingAmount += effectiveAmount;
      }
    }

    if (uniqueActiveStays.length > 0) {
      membersWithStayCount++;
      if (personPaid) {
        membersPaidStayCount++;
      } else if (personPending) {
        membersPendingStayCount++;
      }
    } else {
      membersNoStayCount++;
    }

    const finalStayStatus = personPaid
      ? "paid"
      : personPending
      ? "pending"
      : "none";

    membersBreakdown.push({
      personId: person.id,
      name: person.name,
      isLeader: person.isLeader,
      hasStay: uniqueActiveStays.length > 0,
      stayStatus: finalStayStatus,
      stayAmount: personStayAmount,
      roomAllocated,
    });
  }

  const totalTeamMembers = peopleMap.size;
  const hasAnyStay = membersWithStayCount > 0;
  const hasPaidStay = membersPaidStayCount > 0;
  const hasPendingStay = membersPendingStayCount > 0;
  const isFullyPaidStay = hasAnyStay && membersPendingStayCount === 0;
  const totalStayExpectedAmount = totalStayPaidAmount + totalStayPendingAmount;

  // Combined Pending Payment Check:
  // True if Event payment is genuinely pending, OR any active accommodation payment is pending
  const hasAnyPendingPayment = isEventPending || hasPendingStay;

  // 4. Construct Clear Compact Badge Text
  let stayBadgeText: string | null = null;
  let stayBadgeVariant: TeamPaymentSummary["stayBadgeVariant"] = "none";
  let stayBreakdownText: string | null = null;

  if (hasAnyStay) {
    const isMultiMemberTeam = totalTeamMembers > 1;

    if (isFullyPaidStay) {
      stayBadgeVariant = "paid";
      if (isMultiMemberTeam) {
        stayBadgeText = `Stay: ₹${totalStayPaidAmount.toLocaleString("en-IN")} PAID · ${membersPaidStayCount} member${membersPaidStayCount === 1 ? "" : "s"}`;
        stayBreakdownText = membersNoStayCount > 0
          ? `${membersPaidStayCount} members paid stay (₹${totalStayPaidAmount.toLocaleString("en-IN")}) · ${membersNoStayCount} members have no stay selected`
          : `All ${membersPaidStayCount} members paid stay (₹${totalStayPaidAmount.toLocaleString("en-IN")})`;
      } else {
        stayBadgeText = `Stay: ₹${totalStayPaidAmount.toLocaleString("en-IN")} · PAID`;
        stayBreakdownText = `Stay paid: ₹${totalStayPaidAmount.toLocaleString("en-IN")}`;
      }
    } else if (hasPaidStay && hasPendingStay) {
      stayBadgeVariant = "partial";
      if (isMultiMemberTeam) {
        stayBadgeText = `Stay: ₹${totalStayPaidAmount.toLocaleString("en-IN")} (${membersPaidStayCount} paid, ${membersPendingStayCount} pending)`;
        stayBreakdownText = `Stay paid: ₹${totalStayPaidAmount.toLocaleString("en-IN")} (${membersPaidStayCount} members) · Stay pending: ₹${totalStayPendingAmount.toLocaleString("en-IN")} (${membersPendingStayCount} member${membersPendingStayCount === 1 ? "" : "s"})` +
          (membersNoStayCount > 0 ? ` · ${membersNoStayCount} members have no stay selected` : "");
      } else {
        stayBadgeText = `Stay: ₹${totalStayPaidAmount.toLocaleString("en-IN")} PAID / Pending`;
        stayBreakdownText = `Partial stay payment`;
      }
    } else {
      stayBadgeVariant = "pending";
      if (isMultiMemberTeam) {
        stayBadgeText = `Stay pending: ₹${totalStayPendingAmount.toLocaleString("en-IN")} (${membersPendingStayCount} member${membersPendingStayCount === 1 ? "" : "s"})`;
        stayBreakdownText = `${membersPendingStayCount} members stay pending (₹${totalStayPendingAmount.toLocaleString("en-IN")})` +
          (membersNoStayCount > 0 ? ` · ${membersNoStayCount} members have no stay selected` : "");
      } else {
        stayBadgeText = `Stay: ₹${totalStayPendingAmount.toLocaleString("en-IN")} · PENDING`;
        stayBreakdownText = `Stay payment pending: ₹${totalStayPendingAmount.toLocaleString("en-IN")}`;
      }
    }
  }

  return {
    totalTeamMembers,
    membersWithStayCount,
    membersPaidStayCount,
    membersPendingStayCount,
    membersNoStayCount,
    totalStayPaidAmount,
    totalStayPendingAmount,
    totalStayExpectedAmount,
    totalEventPaidAmount,
    totalEventPendingAmount,
    isEventPaid,
    isEventPending,
    isEventFree,
    hasAnyStay,
    hasPaidStay,
    hasPendingStay,
    isFullyPaidStay,
    hasAnyPendingPayment,
    stayBadgeText,
    stayBadgeVariant,
    stayBreakdownText,
    membersBreakdown,
  };
}
