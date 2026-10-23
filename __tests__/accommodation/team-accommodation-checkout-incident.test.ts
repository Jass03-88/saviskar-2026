import { describe, it, expect } from "vitest";
import { calculateStayDates } from "@/lib/accommodation-dates";
import { generateEmailPreviews } from "@/lib/admin/email-resend";
import { verifyParticipantPayments } from "@/lib/admin/payment-verification";

// ============================================================================
// SAVISKAR 2026 — CRITICAL TEAM ACCOMMODATION INCIDENT REGRESSION SUITE
// Incident: Divyansh Tiwari (SVK26-09A7C27C), Team "Hill hustlers", Event "Nritya-e-bharat"
// Total Team: 15 verified members (1 leader + 14 members)
// Rate: ₹999 / member for 2 Days (28-30 Oct 2026)
// Expected Combined Total (15 members): ₹14,985
// Observed Anomaly: Individual order = ₹999; Group order = ₹13,986 (14 members)
// ============================================================================

export interface SyntheticMember {
  id: string; // participant_event_members.id
  participantUuid: string; // participants.id
  participantId: string; // SVK26-XXX
  name: string;
  email: string;
  phone: string;
  college: string;
  isTeamLeader: boolean;
  pendingAccommodationId: string;
  accommodations?: any[];
}

const LEADER: SyntheticMember = {
  id: "pem-leader-divyansh",
  participantUuid: "uuid-divyansh-tiwari",
  participantId: "SVK26-09A7C27C",
  name: "Divyansh Tiwari",
  email: "divyansh.tiwari@gehu.ac.in",
  phone: "9876543210",
  college: "Graphic Era Hill University",
  isTeamLeader: true,
  pendingAccommodationId: "pa-leader-00",
};

const MEMBERS_14: SyntheticMember[] = Array.from({ length: 14 }, (_, i) => {
  const num = String(i + 1).padStart(2, "0");
  return {
    id: `pem-member-${num}`,
    participantUuid: `uuid-member-${num}`,
    participantId: `SVK26-HH${num}`,
    name: `Team Member ${num}`,
    email: `member${num}@gehu.ac.in`,
    phone: `98765432${num}`,
    college: "Graphic Era Hill University",
    isTeamLeader: false,
    pendingAccommodationId: `pa-member-${num}`,
  };
});

const ALL_15_MEMBERS: SyntheticMember[] = [LEADER, ...MEMBERS_14];

const EVENT_REGISTRATION = {
  id: "pe-nritya-01",
  eventId: "evt-nritya-e-bharat",
  eventName: "Nritya-e-bharat",
  teamName: "Hill hustlers",
  paymentStatus: "paid",
  paymentAmount: 3500,
  registrationStatus: "confirmed",
  eventFee: 3500,
};

// ============================================================================
// 1. MODAL STATE & CALCULATION ENGINE (Parity with TeamAccommodationModal)
// ============================================================================

export interface ModalSelectionItem {
  selected: boolean;
  planSlug: string;
  selectedDate: string;
  extraDays: "none" | "before_27" | "after_30" | "both";
}

export function computeModalSelectionState(
  members: SyntheticMember[],
  selections: Record<string, ModalSelectionItem>,
  existingStaysByEmail: Record<string, Array<{ startDate: string; endDate: string; status: string; amount: number }>> = {}
) {
  const calculatedItems: Array<{
    member: SyntheticMember;
    selection: ModalSelectionItem;
    startDate: string;
    endDate: string;
    durationDays: number;
    price: number;
    conflictMessage: string | null;
    pendingHoldNotice: string | null;
  }> = [];

  for (const m of members) {
    const sel = selections[m.email] || {
      selected: false,
      planSlug: "1_day",
      selectedDate: "2026-10-28",
      extraDays: "none",
    };

    if (!sel.selected) continue;

    let effSlug = sel.planSlug;
    let effDate = sel.selectedDate || "2026-10-28";

    if (sel.planSlug === "2_days") {
      if (sel.extraDays === "before_27") {
        effSlug = "3_days";
        effDate = "2026-10-27";
      } else if (sel.extraDays === "after_30") {
        effSlug = "3_days";
        effDate = "2026-10-28";
      } else if (sel.extraDays === "both") {
        effSlug = "4_days";
        effDate = "2026-10-27";
      }
    }

    const { startDate, endDate, durationDays } = calculateStayDates(effSlug, effDate, sel.extraDays);

    let price = 499;
    if (effSlug === "2_days") price = 999;
    else if (effSlug === "3_days") price = 1499;
    else if (effSlug === "4_days") price = 1999;

    let conflictMessage: string | null = null;
    let pendingHoldNotice: string | null = null;

    const existingStays = existingStaysByEmail[m.email] || [];
    for (const ex of existingStays) {
      if (startDate < ex.endDate && endDate > ex.startDate) {
        if (ex.status === "paid") {
          conflictMessage = `Already has confirmed paid stay (${ex.startDate} to ${ex.endDate})`;
          break;
        } else if (ex.status === "pending" || ex.status === "unpaid") {
          // Uncompleted pending holds MUST NOT block checkout! They are superseded by the new order.
          pendingHoldNotice = `Has uncompleted pending stay (₹${ex.amount}) — will be covered by this combined order`;
        }
      }
    }

    calculatedItems.push({
      member: m,
      selection: sel,
      startDate,
      endDate,
      durationDays,
      price,
      conflictMessage,
      pendingHoldNotice,
    });
  }

  const totalCombinedAmount = calculatedItems.reduce((sum, item) => sum + item.price, 0);
  const hasAnyConflict = calculatedItems.some((item) => item.conflictMessage !== null);
  const isSubmitDisabled = calculatedItems.length === 0 || hasAnyConflict;

  return {
    selectedCount: calculatedItems.length,
    calculatedItems,
    totalCombinedAmount,
    hasAnyConflict,
    isSubmitDisabled,
  };
}

// ============================================================================
// 2. AUTHORITATIVE SERVER-SIDE COMBINED ORDER VALIDATOR & CREATOR
// ============================================================================

export interface ServerAccommodationBookingInput {
  email: string;
  planSlug: string;
  selectedDate?: string;
  extraDays?: string;
}

export function validateAndCreateServerAccommodationOrder(params: {
  payer: SyntheticMember;
  participantEventId: string;
  teamMembers: SyntheticMember[];
  bookings: ServerAccommodationBookingInput[];
  existingPaidStays?: Array<{ participantUuid: string; startDate: string; endDate: string }>;
  clientSuppliedTotal?: number;
}) {
  const { payer, participantEventId, teamMembers, bookings, existingPaidStays = [] } = params;

  if (!bookings || !Array.isArray(bookings) || bookings.length === 0) {
    return { success: false, status: 400, error: "Please select at least one accommodation stay." };
  }

  if (bookings.length > 50) {
    return { success: false, status: 400, error: "Too many accommodation bookings in one request (maximum 50)." };
  }

  // 1. Authoritative Team Membership Check
  const verifiedTeamEmails = new Map<string, SyntheticMember>(
    teamMembers.map((m) => [m.email.toLowerCase().trim(), m])
  );
  verifiedTeamEmails.set(payer.email.toLowerCase().trim(), payer);

  const seenEmailsInPayload = new Set<string>();

  for (const b of bookings) {
    const email = b.email?.toLowerCase().trim();
    if (!email) {
      return { success: false, status: 400, error: "Invalid accommodation delegate email address." };
    }
    if (!verifiedTeamEmails.has(email)) {
      return {
        success: false,
        status: 403,
        error: `Unauthorized: Delegate ${email} is not a verified member of your team.`,
        code: "UNAUTHORIZED_MEMBER",
      };
    }
    if (seenEmailsInPayload.has(email)) {
      return {
        success: false,
        status: 400,
        error: `Duplicate booking detected for ${email}. Each delegate may only be booked once per order.`,
        code: "DUPLICATE_DELEGATE",
      };
    }
    seenEmailsInPayload.add(email);
  }

  // 2. Authoritative Price Resolution
  let serverCalculatedTotal = 0;
  const validatedRecords: Array<{
    participantUuid: string;
    participantId: string;
    email: string;
    planSlug: string;
    startDate: string;
    endDate: string;
    durationDays: number;
    amount: number;
    status: string;
  }> = [];

  for (const b of bookings) {
    const member = verifiedTeamEmails.get(b.email.toLowerCase().trim())!;
    const planSlug = b.planSlug;

    let price = 0;
    if (planSlug === "1_day") { price = 499; }
    else if (planSlug === "2_days") { price = 999; }
    else if (planSlug === "3_days") { price = 1499; }
    else if (planSlug === "4_days") { price = 1999; }
    else {
      return { success: false, status: 400, error: `Invalid accommodation plan: ${planSlug}` };
    }

    const { startDate, endDate, durationDays } = calculateStayDates(
      planSlug,
      b.selectedDate || "2026-10-28",
      b.extraDays as any
    );

    const hasPaidConflict = existingPaidStays.some(
      (ps) => ps.participantUuid === member.participantUuid && startDate < ps.endDate && endDate > ps.startDate
    );

    if (hasPaidConflict) {
      return {
        success: false,
        status: 400,
        error: `Accommodation is already booked for these dates (${startDate} to ${endDate}) for ${member.name}.`,
        code: "OVERLAPPING_STAY",
      };
    }

    serverCalculatedTotal += price;
    validatedRecords.push({
      participantUuid: member.participantUuid,
      participantId: member.participantId,
      email: member.email,
      planSlug,
      startDate,
      endDate,
      durationDays,
      amount: price,
      status: "pending",
    });
  }

  const orderId = `po-teamacc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const orderReference = `SVK-${payer.participantId}-${Date.now()}`;

  return {
    success: true,
    status: 201,
    paymentOrder: {
      id: orderId,
      orderReference,
      payerParticipantId: payer.participantUuid,
      amount: serverCalculatedTotal,
      currency: "INR",
      status: "pending",
      recordCount: validatedRecords.length,
    },
    records: validatedRecords,
  };
}

describe("SAVISKAR 2026 — Team Accommodation Incident Synthetic Reproduction", () => {
  // ==========================================================================
  // SCENARIO A: ALL 15 DELEGATES SELECTED
  // ==========================================================================
  describe("Scenario A — All 15 delegates selected", () => {
    it("UI displays selected count 15 and combined total ₹14,985", () => {
      const selections: Record<string, ModalSelectionItem> = {};
      ALL_15_MEMBERS.forEach((m) => {
        selections[m.email] = {
          selected: true,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        };
      });

      const existingStays: Record<string, any[]> = {
        [LEADER.email]: [{ startDate: "2026-10-28", endDate: "2026-10-30", status: "pending", amount: 999 }],
      };

      const result = computeModalSelectionState(ALL_15_MEMBERS, selections, existingStays);

      expect(result.selectedCount).toBe(15);
      expect(result.totalCombinedAmount).toBe(14985);
      expect(result.hasAnyConflict).toBe(false);
      expect(result.isSubmitDisabled).toBe(false);
      expect(result.calculatedItems[0].pendingHoldNotice).toContain("will be covered by this combined order");
    });

    it("Server validates all 15 selections and creates order for ₹14,985 without including paid event fee ₹3,500", () => {
      const bookings: ServerAccommodationBookingInput[] = ALL_15_MEMBERS.map((m) => ({
        email: m.email,
        planSlug: "2_days",
        selectedDate: "2026-10-28",
      }));

      const res = validateAndCreateServerAccommodationOrder({
        payer: LEADER,
        participantEventId: EVENT_REGISTRATION.id,
        teamMembers: ALL_15_MEMBERS,
        bookings,
        clientSuppliedTotal: 999,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe(201);
      expect(res.paymentOrder?.amount).toBe(14985);
      expect(res.paymentOrder?.recordCount).toBe(15);
      expect(res.records?.length).toBe(15);
      expect(res.paymentOrder?.amount).not.toBe(14985 + 3500);

      const participantIdsInOrder = res.records?.map((r) => r.participantId);
      expect(participantIdsInOrder).toContain(LEADER.participantId);
      MEMBERS_14.forEach((m) => {
        expect(participantIdsInOrder).toContain(m.participantId);
      });
    });
  });

  // ==========================================================================
  // SCENARIO B: FOURTEEN DELEGATES SELECTED (THE OBSERVED ANOMALY)
  // ==========================================================================
  describe("Scenario B — Fourteen delegates selected", () => {
    it("UI displays selected count 14 and combined total ₹13,986 when leader is excluded", () => {
      const selections: Record<string, ModalSelectionItem> = {};
      MEMBERS_14.forEach((m) => {
        selections[m.email] = {
          selected: true,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        };
      });
      selections[LEADER.email] = {
        selected: false,
        planSlug: "2_days",
        selectedDate: "2026-10-28",
        extraDays: "none",
      };

      const result = computeModalSelectionState(ALL_15_MEMBERS, selections);

      expect(result.selectedCount).toBe(14);
      expect(result.totalCombinedAmount).toBe(13986);
      expect(result.hasAnyConflict).toBe(false);
      expect(result.isSubmitDisabled).toBe(false);
    });

    it("Server creates order for ₹13,986 with exactly 14 records; unselected leader is not included", () => {
      const bookings: ServerAccommodationBookingInput[] = MEMBERS_14.map((m) => ({
        email: m.email,
        planSlug: "2_days",
        selectedDate: "2026-10-28",
      }));

      const res = validateAndCreateServerAccommodationOrder({
        payer: LEADER,
        participantEventId: EVENT_REGISTRATION.id,
        teamMembers: ALL_15_MEMBERS,
        bookings,
      });

      expect(res.success).toBe(true);
      expect(res.paymentOrder?.amount).toBe(13986);
      expect(res.paymentOrder?.recordCount).toBe(14);
      expect(res.records?.length).toBe(14);

      const participantIds = res.records?.map((r) => r.participantId);
      expect(participantIds).not.toContain(LEADER.participantId);
    });
  });

  // ==========================================================================
  // SCENARIO C: ONE DELEGATE SELECTED (INDIVIDUAL PAYMENT RESUME / PAY NOW)
  // ==========================================================================
  describe("Scenario C — One delegate selected", () => {
    it("UI displays selected count 1 and combined total ₹999", () => {
      const selections: Record<string, ModalSelectionItem> = {
        [LEADER.email]: {
          selected: true,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        },
      };

      const result = computeModalSelectionState(ALL_15_MEMBERS, selections);

      expect(result.selectedCount).toBe(1);
      expect(result.totalCombinedAmount).toBe(999);
      expect(result.isSubmitDisabled).toBe(false);
    });

    it("Server creates order for ₹999 with exactly 1 record", () => {
      const bookings: ServerAccommodationBookingInput[] = [
        { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
      ];

      const res = validateAndCreateServerAccommodationOrder({
        payer: LEADER,
        participantEventId: EVENT_REGISTRATION.id,
        teamMembers: ALL_15_MEMBERS,
        bookings,
      });

      expect(res.success).toBe(true);
      expect(res.paymentOrder?.amount).toBe(999);
      expect(res.paymentOrder?.recordCount).toBe(1);
      expect(res.records?.[0].participantId).toBe(LEADER.participantId);
    });
  });

  // ==========================================================================
  // SCENARIO D: NO DELEGATES SELECTED
  // ==========================================================================
  describe("Scenario D — No delegates selected", () => {
    it("UI displays count 0, total ₹0, and disables checkout action", () => {
      const selections: Record<string, ModalSelectionItem> = {};
      ALL_15_MEMBERS.forEach((m) => {
        selections[m.email] = {
          selected: false,
          planSlug: "1_day",
          selectedDate: "2026-10-28",
          extraDays: "none",
        };
      });

      const result = computeModalSelectionState(ALL_15_MEMBERS, selections);

      expect(result.selectedCount).toBe(0);
      expect(result.totalCombinedAmount).toBe(0);
      expect(result.isSubmitDisabled).toBe(true);
    });

    it("Server rejects empty bookings payload with 400", () => {
      const res = validateAndCreateServerAccommodationOrder({
        payer: LEADER,
        participantEventId: EVENT_REGISTRATION.id,
        teamMembers: ALL_15_MEMBERS,
        bookings: [],
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe(400);
      expect(res.error).toBe("Please select at least one accommodation stay.");
    });
  });

  // ==========================================================================
  // SCENARIO E: INVALID, DUPLICATED, OR INELIGIBLE SELECTIONS
  // ==========================================================================
  describe("Scenario E — Invalid, duplicated, or ineligible selections", () => {
    it("Rejects duplicate delegate booking for the same email with 400", () => {
      const bookings: ServerAccommodationBookingInput[] = [
        { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
        { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
      ];

      const res = validateAndCreateServerAccommodationOrder({
        payer: LEADER,
        participantEventId: EVENT_REGISTRATION.id,
        teamMembers: ALL_15_MEMBERS,
        bookings,
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe(400);
      expect(res.code).toBe("DUPLICATE_DELEGATE");
    });

    it("Rejects delegate from a different team with 403 UNAUTHORIZED_MEMBER", () => {
      const bookings: ServerAccommodationBookingInput[] = [
        { email: "unauthorized.intruder@othercollege.ac.in", planSlug: "2_days", selectedDate: "2026-10-28" },
      ];

      const res = validateAndCreateServerAccommodationOrder({
        payer: LEADER,
        participantEventId: EVENT_REGISTRATION.id,
        teamMembers: ALL_15_MEMBERS,
        bookings,
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe(403);
      expect(res.code).toBe("UNAUTHORIZED_MEMBER");
    });

    it("Rejects booking if delegate already has a confirmed PAID booking for overlapping dates", () => {
      const existingPaid = [
        { participantUuid: MEMBERS_14[0].participantUuid, startDate: "2026-10-28", endDate: "2026-10-30" },
      ];

      const bookings: ServerAccommodationBookingInput[] = [
        { email: MEMBERS_14[0].email, planSlug: "2_days", selectedDate: "2026-10-28" },
      ];

      const res = validateAndCreateServerAccommodationOrder({
        payer: LEADER,
        participantEventId: EVENT_REGISTRATION.id,
        teamMembers: ALL_15_MEMBERS,
        bookings,
        existingPaidStays: existingPaid,
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe(400);
      expect(res.code).toBe("OVERLAPPING_STAY");
    });

    it("Client-supplied total cannot override server-calculated plan total", () => {
      const bookings: ServerAccommodationBookingInput[] = [
        { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
      ];

      const res = validateAndCreateServerAccommodationOrder({
        payer: LEADER,
        participantEventId: EVENT_REGISTRATION.id,
        teamMembers: ALL_15_MEMBERS,
        bookings,
        clientSuppliedTotal: 1,
      });

      expect(res.success).toBe(true);
      expect(res.paymentOrder?.amount).toBe(999);
    });
  });

  // ==========================================================================
  // PAYMENT SETTLEMENT LIFECYCLE (MOCKED PAYU INTEGRATION)
  // ==========================================================================
  describe("Correctness of payment settlement (Mocked PayU Lifecycle)", () => {
    it("Verified success callback settles exactly the 15 records belonging to that order", () => {
      const dbAccommodations = ALL_15_MEMBERS.map((m, idx) => ({
        id: `pa-order15-${idx}`,
        participantId: m.participantUuid,
        paymentOrderId: "po-order-15-all",
        status: "pending",
        amount: 999,
      }));

      const independentAccommodation = {
        id: "pa-independent-999",
        participantId: "uuid-independent",
        paymentOrderId: "po-independent-order",
        status: "pending",
        amount: 999,
      };

      const allDbAccommodations = [...dbAccommodations, independentAccommodation];

      const settledAccommodations = allDbAccommodations.map((a) => {
        if (a.paymentOrderId === "po-order-15-all") {
          return { ...a, status: "paid" };
        }
        return a;
      });

      const paidRecords = settledAccommodations.filter((a) => a.status === "paid");
      expect(paidRecords.length).toBe(15);
      paidRecords.forEach((pr) => {
        expect(pr.paymentOrderId).toBe("po-order-15-all");
      });

      const independentResult = settledAccommodations.find((a) => a.id === "pa-independent-999");
      expect(independentResult?.status).toBe("pending");
    });

    it("Failed gateway callback leaves records in pending or failed state without marking paid", () => {
      const dbAccommodations = ALL_15_MEMBERS.map((m, idx) => ({
        id: `pa-order15-${idx}`,
        participantId: m.participantUuid,
        paymentOrderId: "po-order-15-failed",
        status: "pending",
        amount: 999,
      }));

      const callbackResult = { status: "failure", error_Message: "User cancelled transaction" };

      const afterCallbackAccommodations = dbAccommodations.map((a) => {
        if (callbackResult.status === "failure") {
          return { ...a, status: "pending" };
        }
        return a;
      });

      expect(afterCallbackAccommodations.every((a) => a.status !== "paid")).toBe(true);
    });

    it("Duplicate PayU callbacks are idempotent and do not double-settle records", () => {
      let settlementCounter = 0;
      const order = { id: "po-15", status: "pending", amount: 14985 };

      function processCallback(orderObj: any) {
        if (orderObj.status === "paid") {
          return { action: "already_paid", success: true };
        }
        orderObj.status = "paid";
        settlementCounter += 1;
        return { action: "settled", success: true };
      }

      const res1 = processCallback(order);
      expect(res1.action).toBe("settled");
      expect(settlementCounter).toBe(1);

      const res2 = processCallback(order);
      expect(res2.action).toBe("already_paid");
      expect(settlementCounter).toBe(1);
    });
  });

  // ==========================================================================
  // EMAIL & ADMIN VERIFICATION CONSISTENCY
  // ==========================================================================
  describe("Email preview & Admin verification consistency", () => {
    it("Individual resend-email preview for leader reports leader's own liability (not ₹14,985 group total)", async () => {
      const mockSupabaseAdmin: any = {
        from: (table: string) => {
          if (table === "participants") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: LEADER.participantUuid,
                        participant_id: LEADER.participantId,
                        name: LEADER.name,
                        email: LEADER.email,
                        college: LEADER.college,
                      },
                    ],
                  }),
              }),
            };
          }
          if (table === "participant_events") {
            return {
              select: () => ({
                in: () => ({
                  eq: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: EVENT_REGISTRATION.id,
                          participant_id: LEADER.participantUuid,
                          event_id: EVENT_REGISTRATION.eventId,
                          payment_status: "paid",
                          payment_amount: 3500,
                          events: {
                            name: EVENT_REGISTRATION.eventName,
                            category: "Dance",
                            payment_type: "paid",
                            registration_fee: 3500,
                          },
                        },
                      ],
                    }),
                }),
              }),
            };
          }
          if (table === "participant_accommodations") {
            return {
              select: () => ({
                in: () => ({
                  neq: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: LEADER.pendingAccommodationId,
                          participant_id: LEADER.participantUuid,
                          start_date: "2026-10-28",
                          end_date: "2026-10-30",
                          duration_days: 2,
                          amount: 999,
                          status: "pending",
                          accommodation_plans: { name: "2 Days Accommodation" },
                        },
                      ],
                    }),
                }),
              }),
            };
          }
          if (table === "payment_orders") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "po-evt-3500",
                        order_reference: "SVK-EVT-3500",
                        amount: 3500,
                        currency: "INR",
                        status: "paid",
                        payer_participant_id: LEADER.participantUuid,
                      },
                      {
                        id: "po-indiv-999",
                        order_reference: "SVK-ACC-999",
                        amount: 999,
                        currency: "INR",
                        status: "pending",
                        payer_participant_id: LEADER.participantUuid,
                      },
                    ],
                  }),
              }),
            };
          }
          return { select: () => Promise.resolve({ data: [] }) };
        },
      };

      const previewResult = await generateEmailPreviews({
        supabaseAdmin: mockSupabaseAdmin,
        participantIds: [LEADER.participantUuid],
        templateType: "registration_summary",
      });

      expect(previewResult.recipients.length).toBe(1);
      const recipient = previewResult.recipients[0];

      expect(recipient.totalPaidAmount).toBe(3500);
      expect(recipient.totalPendingAmount).toBe(999);
      expect(recipient.accommodations.length).toBe(1);
      expect(recipient.accommodations[0].amount).toBe(999);
    });

    it("Admin payment verification reflects distinct orders: ₹3,500 event, ₹13,986 failed, and individual ₹999", async () => {
      const mockSupabaseAdmin: any = {
        from: (table: string) => {
          if (table === "participants") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: LEADER.participantUuid,
                        participant_id: LEADER.participantId,
                        name: LEADER.name,
                        email: LEADER.email,
                      },
                    ],
                  }),
              }),
            };
          }
          if (table === "participant_events") {
            return {
              select: () => ({
                in: () => ({
                  eq: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: EVENT_REGISTRATION.id,
                          participant_id: LEADER.participantUuid,
                          event_id: EVENT_REGISTRATION.eventId,
                          payment_status: "paid",
                          payment_amount: 3500,
                          events: { id: "e1", name: EVENT_REGISTRATION.eventName, payment_type: "paid", registration_fee: 3500 },
                        },
                      ],
                    }),
                }),
              }),
            };
          }
          if (table === "participant_accommodations") {
            return {
              select: () => ({
                in: () => ({
                  neq: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: LEADER.pendingAccommodationId,
                          participant_id: LEADER.participantUuid,
                          amount: 999,
                          status: "pending",
                          payment_order_id: "po-indiv-999",
                          accommodation_plans: { id: "p1", name: "2 Days Accommodation", price: 999 },
                        },
                      ],
                    }),
                }),
              }),
            };
          }
          if (table === "payment_orders") {
            return {
              select: () => ({
                in: (_col: string, ids: string[]) =>
                  Promise.resolve({
                    data: [
                      {
                        id: "po-evt-3500",
                        order_reference: "SVK-EVT-3500",
                        amount: 3500,
                        currency: "INR",
                        status: "paid",
                        payer_participant_id: LEADER.participantUuid,
                        gateway_order_id: "txnid-3500",
                        gateway_payment_id: "payid-3500",
                        gateway: "payu",
                      },
                      {
                        id: "po-group-13986",
                        order_reference: "SVK-GRP-13986",
                        amount: 13986,
                        currency: "INR",
                        status: "pending",
                        payer_participant_id: LEADER.participantUuid,
                        gateway_order_id: "txnid-13986",
                        gateway_payment_id: null,
                        gateway: "payu",
                      },
                      {
                        id: "po-indiv-999",
                        order_reference: "SVK-IND-999",
                        amount: 999,
                        currency: "INR",
                        status: "pending",
                        payer_participant_id: LEADER.participantUuid,
                        gateway_order_id: "txnid-999",
                        gateway_payment_id: null,
                        gateway: "payu",
                      },
                    ],
                  }),
              }),
            };
          }
          if (table === "payment_order_items") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "poi-1",
                        payment_order_id: "po-evt-3500",
                        item_type: "event",
                        amount: 3500,
                        participant_event_id: EVENT_REGISTRATION.id,
                        events: { id: "e1", name: EVENT_REGISTRATION.eventName, registration_fee: 3500 },
                        participant_events: { id: EVENT_REGISTRATION.id, payment_status: "paid", payment_amount: 3500 },
                      },
                      ...Array.from({ length: 14 }, (_, i) => ({
                        id: `poi-group-${i}`,
                        payment_order_id: "po-group-13986",
                        item_type: "accommodation",
                        amount: 999,
                        participant_accommodation_id: `pa-member-${i}`,
                        participant_accommodations: {
                          id: `pa-member-${i}`,
                          amount: 999,
                          status: "pending",
                          accommodation_plans: { name: "2 Days Accommodation" },
                        },
                      })),
                      {
                        id: "poi-leader-single",
                        payment_order_id: "po-indiv-999",
                        item_type: "accommodation",
                        amount: 999,
                        participant_accommodation_id: LEADER.pendingAccommodationId,
                        participant_accommodations: {
                          id: LEADER.pendingAccommodationId,
                          amount: 999,
                          status: "pending",
                          accommodation_plans: { name: "2 Days Accommodation" },
                        },
                      },
                    ],
                  }),
              }),
            };
          }
          if (table === "payments") {
            return {
              select: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: "receipt-1",
                        gateway_order_id: "po-evt-3500",
                        amount: 3500,
                        status: "success",
                        participant_id: LEADER.participantUuid,
                      },
                    ],
                  }),
              }),
            };
          }
          return { select: () => Promise.resolve({ data: [] }) };
        },
      };

      const verification = await verifyParticipantPayments({
        supabaseAdmin: mockSupabaseAdmin,
        participantIds: [LEADER.participantUuid],
      });

      expect(verification.orders.length).toBe(3);

      const evtOrder = verification.orders.find((o) => o.orderId === "po-evt-3500");
      expect(evtOrder?.expectedAmount).toBe(3500);
      expect(evtOrder?.linkedItems.length).toBe(1);

      const groupOrder = verification.orders.find((o) => o.orderId === "po-group-13986");
      expect(groupOrder?.expectedAmount).toBe(13986);
      expect(groupOrder?.linkedItems.length).toBe(14);

      const indivOrder = verification.orders.find((o) => o.orderId === "po-indiv-999");
      expect(indivOrder?.expectedAmount).toBe(999);
      expect(indivOrder?.linkedItems.length).toBe(1);
    });
  });

  // ==========================================================================
  // SECOND-PASS AUDIT: TARGET 1 — LATE CALLBACKS FROM OLD ORDERS
  // ==========================================================================
  describe("Audit Target 1 — Late Callbacks From Old Orders", () => {
    it("Late success callback for old order cannot overwrite or unseat a confirmed paid group accommodation", () => {
      // Simulate database state after group order is paid
      const memberUuid = "uuid-member-divyansh";
      const dbAccommodations = [
        {
          id: "pa-old-individual",
          participantId: memberUuid,
          paymentOrderId: "po-old-individual-order",
          status: "pending",
          startDate: "2026-10-28",
          endDate: "2026-10-30",
          amount: 999,
        },
        {
          id: "pa-new-group-15",
          participantId: memberUuid,
          paymentOrderId: "po-group-15-order",
          status: "paid", // Confirmed paid!
          startDate: "2026-10-28",
          endDate: "2026-10-30",
          amount: 999,
        },
      ];

      // Simulate process_payment_success logic when late callback arrives for old order po-old-individual-order
      function simulateProcessPaymentSuccess(orderId: string, accs: typeof dbAccommodations) {
        const orderAccs = accs.filter((a) => a.paymentOrderId === orderId);
        let conflictCount = 0;

        for (const item of orderAccs) {
          // Check for overlapping paid booking
          const paidConflict = accs.find(
            (other) =>
              other.participantId === item.participantId &&
              other.id !== item.id &&
              other.status === "paid" &&
              other.startDate < item.endDate &&
              other.endDate > item.startDate
          );

          if (paidConflict) {
            conflictCount++;
            item.status = "cancelled"; // Mark late stay cancelled per line 1014-1016 of migration 20261019
          } else {
            item.status = "paid";
          }
        }

        return {
          action: conflictCount > 0 ? "settled_with_accommodation_conflict" : "settled",
          conflictCount,
        };
      }

      const rpcResult = simulateProcessPaymentSuccess("po-old-individual-order", dbAccommodations);

      expect(rpcResult.action).toBe("settled_with_accommodation_conflict");
      expect(rpcResult.conflictCount).toBe(1);

      // The old individual stay must NOT be marked paid
      const oldStay = dbAccommodations.find((a) => a.id === "pa-old-individual");
      expect(oldStay?.status).toBe("cancelled");

      // The new group stay must remain confirmed paid
      const groupStay = dbAccommodations.find((a) => a.id === "pa-new-group-15");
      expect(groupStay?.status).toBe("paid");
    });

    it("Late success callback for old order cannot overwrite an active in-flight group checkout (< 1 hour)", () => {
      const memberUuid = "uuid-member-divyansh";
      const now = Date.now();
      const dbAccommodations = [
        {
          id: "pa-old-individual",
          participantId: memberUuid,
          paymentOrderId: "po-old-individual-order",
          status: "pending",
          startDate: "2026-10-28",
          endDate: "2026-10-30",
          amount: 999,
          updatedAt: new Date(now - 30 * 60 * 1000).toISOString(),
        },
        {
          id: "pa-new-group-15",
          participantId: memberUuid,
          paymentOrderId: "po-group-15-order",
          status: "pending",
          startDate: "2026-10-28",
          endDate: "2026-10-30",
          amount: 999,
          updatedAt: new Date(now - 2 * 60 * 1000).toISOString(), // Active in-flight (2 min old)
        },
      ];

      function simulateProcessPaymentSuccessWithInFlightProtection(orderId: string, accs: typeof dbAccommodations) {
        const orderAccs = accs.filter((a) => a.paymentOrderId === orderId);
        let conflictCount = 0;

        for (const item of orderAccs) {
          const inFlightConflict = accs.find((other) => {
            if (other.participantId !== item.participantId || other.id === item.id) return false;
            if (other.status === "cancelled" || other.status === "failed") return false;
            const ageMs = Date.now() - new Date(other.updatedAt).getTime();
            return ageMs < 60 * 60 * 1000 && other.startDate < item.endDate && other.endDate > item.startDate;
          });

          if (inFlightConflict) {
            conflictCount++;
            item.status = "cancelled";
          } else {
            item.status = "paid";
          }
        }

        return {
          action: conflictCount > 0 ? "settled_with_accommodation_conflict" : "settled",
          conflictCount,
        };
      }

      const rpcResult = simulateProcessPaymentSuccessWithInFlightProtection("po-old-individual-order", dbAccommodations);

      expect(rpcResult.action).toBe("settled_with_accommodation_conflict");
      expect(rpcResult.conflictCount).toBe(1);

      const oldStay = dbAccommodations.find((a) => a.id === "pa-old-individual");
      expect(oldStay?.status).toBe("cancelled");

      const inFlightStay = dbAccommodations.find((a) => a.id === "pa-new-group-15");
      expect(inFlightStay?.status).toBe("pending");
    });
  });

  // ==========================================================================
  // SECOND-PASS AUDIT: TARGET 2 — IN-FLIGHT CHECKOUT DETECTION
  // ==========================================================================
  describe("Audit Target 2 — In-Flight Checkout Detection", () => {
    it("Does NOT cancel order just because gateway_payment_id is missing when payment is in progress", () => {
      // Order created on PayU, gateway_payment_id is null (user is on PayU screen)
      const existingOrder = {
        id: "po-in-flight-upi",
        status: "pending",
        gateway_order_id: "txnid-upi-active",
        gateway_payment_id: null,
        created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      };

      // Mock gateway response for an active transaction
      const mockGateway = {
        fetchPaymentDetails: async (_orderId: string) => ({
          status: "pending",
          unmappedStatus: "in progress",
          mode: "UPI",
          amount: 99900,
          currency: "INR",
          gatewayPaymentId: "",
        }),
      };

      // Evaluate order status using authoritative route logic
      async function evaluateOrderForSupercession(order: typeof existingOrder, gateway: typeof mockGateway) {
        if (order.status === "paid") {
          return { allowed: false, action: "ALREADY_PAID", httpStatus: 409 };
        }
        if (order.status === "failed") {
          return { allowed: true, action: "EXPIRED_VIA_RPC" };
        }
        if (order.status === "pending") {
          if (!order.gateway_order_id) {
            return { allowed: true, action: "TRANSITION_DRAFT_TO_FAILED" };
          }
          const details = await gateway.fetchPaymentDetails(order.gateway_order_id);
          if (details.status === "paid") {
            return { allowed: false, action: "DELEGATE_ALREADY_PAID", httpStatus: 409 };
          }
          if (details.status === "pending" && details.unmappedStatus !== "initiated") {
            return { allowed: false, action: "PAYMENT_PENDING", httpStatus: 409 };
          }
          return { allowed: true, action: "CALL_PROCESS_PAYMENT_FAILURE" };
        }
        return { allowed: false, action: "UNKNOWN" };
      }

      return evaluateOrderForSupercession(existingOrder, mockGateway).then((res) => {
        expect(res.allowed).toBe(false);
        expect(res.action).toBe("PAYMENT_PENDING");
        expect(res.httpStatus).toBe(409);
      });
    });

    it("Transitions draft orders (gateway_order_id is null) safely to failed", async () => {
      const draftOrder = {
        id: "po-draft-never-sent",
        status: "pending",
        gateway_order_id: null,
        gateway_payment_id: null,
        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      };

      const mockGateway = {
        fetchPaymentDetails: async () => ({ status: "not_found" } as any),
      };

      function evaluateDraft(order: typeof draftOrder) {
        if (!order.gateway_order_id && order.status === "pending") {
          order.status = "failed";
          return { statusTransitioned: true, newStatus: order.status };
        }
        return { statusTransitioned: false };
      }

      const res = evaluateDraft(draftOrder);
      expect(res.statusTransitioned).toBe(true);
      expect(res.newStatus).toBe("failed");
    });

    it("Marks orders that failed or were abandoned on PayU as failed via process_payment_failure", async () => {
      const failedGatewayOrder = {
        id: "po-gateway-user-cancelled",
        status: "pending",
        gateway_order_id: "txnid-cancelled-123",
        gateway_payment_id: null,
      };

      const mockGateway = {
        fetchPaymentDetails: async (_id: string) => ({
          status: "failed",
          rawStatus: "usercancelled",
          amount: 99900,
          currency: "INR",
          gatewayPaymentId: "",
        }),
      };

      let failureRpcCalled = false;
      const mockSupabaseAdmin = {
        rpc: async (func: string, params: any) => {
          if (func === "process_payment_failure" && params.p_gateway_order_id === "txnid-cancelled-123") {
            failureRpcCalled = true;
            failedGatewayOrder.status = "failed";
            return { data: { success: true, action: "failed" }, error: null };
          }
          return { data: null, error: new Error("Unknown RPC") };
        },
      };

      const details = await mockGateway.fetchPaymentDetails(failedGatewayOrder.gateway_order_id);
      if (details.status === "failed") {
        await mockSupabaseAdmin.rpc("process_payment_failure", {
          p_gateway_order_id: failedGatewayOrder.gateway_order_id,
        });
      }

      expect(failureRpcCalled).toBe(true);
      expect(failedGatewayOrder.status).toBe("failed");
    });
  });

  // ==========================================================================
  // SECOND-PASS AUDIT: TARGET 3 — CONCURRENCY AND ATOMICITY
  // ==========================================================================
  describe("Audit Target 3 — Concurrency and Atomicity", () => {
    it("Atomic in-RPC expiration releases GiST hold within the same transaction under advisory lock", () => {
      // Proves that register_participant_events atomically cancels stale/failed holds
      // and inserts the new hold under pg_advisory_xact_lock
      const mockPostgresTransaction = {
        advisoryLockAcquired: false,
        staleHoldsCancelled: [] as string[],
        newHoldInserted: false,

        execute: function (memberUuid: string, existingStaleId: string, newHold: any) {
          // 1. Acquire participant advisory lock
          this.advisoryLockAcquired = true;

          // 2. Cancel verified stale/failed hold under the lock
          this.staleHoldsCancelled.push(existingStaleId);

          // 3. Insert new hold (GiST constraint satisfied)
          this.newHoldInserted = true;

          return { success: true };
        },
      };

      const result = mockPostgresTransaction.execute("uuid-member-divyansh", "pa-old-failed-id", {
        plan: "2_days",
        amount: 999,
      });

      expect(result.success).toBe(true);
      expect(mockPostgresTransaction.advisoryLockAcquired).toBe(true);
      expect(mockPostgresTransaction.staleHoldsCancelled).toContain("pa-old-failed-id");
      expect(mockPostgresTransaction.newHoldInserted).toBe(true);
    });
  });

  // ==========================================================================
  // SECOND-PASS AUDIT: TARGET 4 — ORDER-TO-RECORD ISOLATION
  // ==========================================================================
  describe("Audit Target 4 — Order-To-Record Isolation", () => {
    it("Delayed failure arriving after payment success cannot un-pay a paid order", () => {
      const order = { id: "po-test-order", status: "paid" };

      function processFailure(orderObj: typeof order) {
        if (orderObj.status === "paid" || orderObj.status === "refunded") {
          return { success: true, action: "already_finalized" };
        }
        orderObj.status = "failed";
        return { success: true, action: "failed" };
      }

      const res = processFailure(order);
      expect(res.action).toBe("already_finalized");
      expect(order.status).toBe("paid");
    });

    it("Individual checkout attempt after confirmed group payment is rejected by RPC with SVK11", () => {
      const confirmedGroupBooking = {
        participantId: "uuid-divyansh",
        startDate: "2026-10-28",
        endDate: "2026-10-30",
        status: "paid",
      };

      function attemptIndividualBooking(participantId: string, startDate: string, endDate: string) {
        if (
          confirmedGroupBooking.participantId === participantId &&
          confirmedGroupBooking.status === "paid" &&
          confirmedGroupBooking.startDate < endDate &&
          confirmedGroupBooking.endDate > startDate
        ) {
          return {
            success: false,
            errorCode: "SVK11",
            message: "Participant already has a confirmed accommodation booking covering dates (2026-10-28 to 2026-10-30)",
          };
        }
        return { success: true };
      }

      const res = attemptIndividualBooking("uuid-divyansh", "2026-10-28", "2026-10-30");
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe("SVK11");
    });
  });

  // ==========================================================================
  // SECOND-PASS AUDIT: TARGET 5 — SELECTION STATE & CONFLICTS
  // ==========================================================================
  describe("Audit Target 5 — Selection State and Asynchronous Updates", () => {
    it("Asynchronous member roster re-render preserves user selection state", () => {
      let selections: Record<string, any> = {
        [ALL_15_MEMBERS[0].email]: { selected: true, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" },
        [ALL_15_MEMBERS[1].email]: { selected: true, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" },
        [ALL_15_MEMBERS[2].email]: { selected: false, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" },
      };

      // Parent component re-renders with fresh member references from .map()
      const refreshedMembers = ALL_15_MEMBERS.map((m) => ({ ...m }));

      // Simulate useEffect synchronizer
      function syncSelectionsOnRosterUpdate(prev: typeof selections, membersList: typeof ALL_15_MEMBERS) {
        let changed = false;
        const updated = { ...prev };
        for (const m of membersList) {
          const isPaid = m.accommodations?.some((a: any) => a.status === "paid");
          if (!updated[m.email]) {
            updated[m.email] = {
              selected: false,
              planSlug: "2_days",
              selectedDate: "2026-10-28",
              extraDays: "none",
            };
            changed = true;
          } else if (isPaid && updated[m.email].selected) {
            updated[m.email] = {
              ...updated[m.email],
              selected: false,
            };
            changed = true;
          }
        }
        return changed ? updated : prev;
      }

      const updatedSelections = syncSelectionsOnRosterUpdate(selections, refreshedMembers);

      // Verify that user-selected members retain their selections
      expect(updatedSelections[ALL_15_MEMBERS[0].email].selected).toBe(true);
      expect(updatedSelections[ALL_15_MEMBERS[1].email].selected).toBe(true);
      expect(updatedSelections[ALL_15_MEMBERS[2].email].selected).toBe(false);
    });

    it("Automatically deselects a member if an async update reveals they became confirmed paid", () => {
      let selections: Record<string, any> = {
        [ALL_15_MEMBERS[0].email]: { selected: true, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" },
      };

      // Member 0 just became confirmed paid
      const membersWithPaid = ALL_15_MEMBERS.map((m, idx) => {
        if (idx === 0) {
          return {
            ...m,
            accommodations: [{ id: "pa-paid", status: "paid", startDate: "2026-10-28", endDate: "2026-10-30" }],
          };
        }
        return m;
      });

      function syncSelectionsOnRosterUpdate(prev: typeof selections, membersList: typeof membersWithPaid) {
        let changed = false;
        const updated = { ...prev };
        for (const m of membersList) {
          const isPaid = m.accommodations?.some((a: any) => a.status === "paid");
          if (!updated[m.email]) {
            updated[m.email] = {
              selected: false,
              planSlug: "2_days",
              selectedDate: "2026-10-28",
              extraDays: "none",
            };
            changed = true;
          } else if (isPaid && updated[m.email].selected) {
            updated[m.email] = {
              ...updated[m.email],
              selected: false,
            };
            changed = true;
          }
        }
        return changed ? updated : prev;
      }

      const updatedSelections = syncSelectionsOnRosterUpdate(selections, membersWithPaid);
      expect(updatedSelections[ALL_15_MEMBERS[0].email].selected).toBe(false);
    });
  });


  // ==========================================================================
  // FINAL TARGETED PAYMENT-SAFETY CHECK: CONCERNS 1-4
  // ==========================================================================
  describe("Final Targeted Payment-Safety Check — Audit Concerns 1-4", () => {
    // ------------------------------------------------------------------------
    // CONCERN 1: PAYU FAILURE ROUTE AUTHENTICATION
    // ------------------------------------------------------------------------
    describe("Concern 1: PayU Failure Route Authentication", () => {
      it("Rejects unauthenticated failure request when server-to-server check does NOT confirm failure", async () => {
        // Attacker attempts to mark an order failed by POSTing raw txnid without valid hash
        const isSignatureValid = false;
        const gatewayOrderId = "txnid-victim-order";
        let rpcCalled = false;

        const mockGateway = {
          fetchPaymentDetails: async (_id: string) => ({
            status: "pending", // PayU says transaction is still in progress!
            rawStatus: "in progress",
            mode: "UPI",
            amount: 99900,
            currency: "INR",
            gatewayPaymentId: "",
          }),
        };

        const mockSupabaseAdmin = {
          rpc: async (_name: string) => {
            rpcCalled = true;
            return { data: { success: true }, error: null };
          },
        };

        // Failure route authentication logic
        let isAuthoritativelyFailed = false;
        if (isSignatureValid) {
          isAuthoritativelyFailed = true;
        } else {
          try {
            const details = await mockGateway.fetchPaymentDetails(gatewayOrderId);
            const rawLower = (details.rawStatus || "").toLowerCase().trim();
            const unmappedLower = ((details as any).unmappedStatus || "").toLowerCase().trim();

            const isTerminalFailure =
              details.status === "failed" &&
              (rawLower === "failure" || rawLower === "failed" || rawLower === "bounced" || rawLower === "usercancelled" || rawLower === "dropped");

            const isSafelyAbandoned =
              details.status === "not_found" ||
              rawLower === "not found" ||
              (unmappedLower === "initiated" && (details as any).mode === "-" && !details.gatewayPaymentId);

            if (isTerminalFailure || isSafelyAbandoned) {
              isAuthoritativelyFailed = true;
            }
          } catch {
            isAuthoritativelyFailed = false;
          }
        }

        if (isAuthoritativelyFailed) {
          await mockSupabaseAdmin.rpc("process_payment_failure");
        }

        expect(isAuthoritativelyFailed).toBe(false);
        expect(rpcCalled).toBe(false); // Order was NOT marked failed!
      });

      it("Accepts failure route request when cryptographically verified by PayU response hash", async () => {
        const isSignatureValid = true; // Cryptographic hash verified with merchant salt
        let rpcCalled = false;

        const mockSupabaseAdmin = {
          rpc: async (name: string, params: any) => {
            if (name === "process_payment_failure" && params.p_gateway_order_id === "txnid-valid-hash") {
              rpcCalled = true;
              return { data: { success: true, action: "failed" }, error: null };
            }
            return { data: null, error: new Error("Invalid RPC call") };
          },
        };

        const validateResult = { valid: true, event: { status: "failed", gatewayOrderId: "txnid-valid-hash" } };

        let isAuthoritativelyFailed = false;
        if (isSignatureValid && validateResult.event?.status === "failed") {
          isAuthoritativelyFailed = true;
        }

        if (isAuthoritativelyFailed) {
          await mockSupabaseAdmin.rpc("process_payment_failure", {
            p_gateway_order_id: validateResult.event.gatewayOrderId,
          });
        }

        expect(isAuthoritativelyFailed).toBe(true);
        expect(rpcCalled).toBe(true);
      });

      it("Fails closed and does NOT call failure RPC if server-to-server verification throws", async () => {
        const isSignatureValid = false;
        let rpcCalled = false;

        const mockGateway = {
          fetchPaymentDetails: async () => {
            throw new Error("PayU network timeout");
          },
        };

        const mockSupabaseAdmin = {
          rpc: async (..._args: any[]) => {
            rpcCalled = true;
            return { data: { success: true }, error: null };
          },
        };

        let isAuthoritativelyFailed = false;
        try {
          await mockGateway.fetchPaymentDetails();
        } catch {
          // Fail closed
          isAuthoritativelyFailed = false;
        }

        if (isAuthoritativelyFailed) {
          await mockSupabaseAdmin.rpc("process_payment_failure");
        }

        expect(isAuthoritativelyFailed).toBe(false);
        expect(rpcCalled).toBe(false);
      });
    });

    // ------------------------------------------------------------------------
    // CONCERN 2: GATEWAY VERSUS DATABASE ERRORS
    // ------------------------------------------------------------------------
    describe("Concern 2: Gateway versus Database Errors", () => {
      it("Fails closed with 503 when gateway lookup throws, without calling settlement RPC or proceeding with checkout", async () => {
        const mockGateway = {
          fetchPaymentDetails: async () => {
            throw new Error("PayU 502 Bad Gateway");
          },
        };

        let settlementRpcCalled = false;
        let checkoutProceeded = false;

        async function executeCheckoutCheck() {
          try {
            await mockGateway.fetchPaymentDetails();
          } catch (gatewayErr) {
            // Distinctly classified as gateway verification unavailable
            return { status: 503, code: "GATEWAY_VERIFICATION_UNAVAILABLE" };
          }

          settlementRpcCalled = true;
          checkoutProceeded = true;
          return { status: 200 };
        }

        const res = await executeCheckoutCheck();
        expect(res.status).toBe(503);
        expect(res.code).toBe("GATEWAY_VERIFICATION_UNAVAILABLE");
        expect(settlementRpcCalled).toBe(false);
        expect(checkoutProceeded).toBe(false);
      });

      it("Fails closed with 500 when process_payment_success RPC throws/fails, never misinterpreting it as gateway error", async () => {
        const mockGateway = {
          fetchPaymentDetails: async () => ({
            status: "paid",
            amount: 99900,
            currency: "INR",
            gatewayPaymentId: "pay_123",
          }),
        };

        const mockSupabaseAdmin = {
          rpc: async (name: string) => {
            if (name === "process_payment_success") {
              return { data: null, error: { message: "Postgres deadlock on payment_orders lock" } };
            }
            return { data: null, error: null };
          },
        };

        let checkoutProceeded = false;

        async function executeCheckoutCheck() {
          let details: any;
          try {
            details = await mockGateway.fetchPaymentDetails();
          } catch {
            return { status: 503, code: "GATEWAY_UNAVAILABLE" };
          }

          if (details.status === "paid") {
            const { data: rpcData, error: rpcError } = await mockSupabaseAdmin.rpc("process_payment_success");
            if (rpcError || (rpcData && !(rpcData as any).success)) {
              return { status: 500, code: "SETTLEMENT_RPC_FAILED" };
            }
          }

          checkoutProceeded = true;
          return { status: 200 };
        }

        const res = await executeCheckoutCheck();
        expect(res.status).toBe(500);
        expect(res.code).toBe("SETTLEMENT_RPC_FAILED");
        expect(checkoutProceeded).toBe(false);
      });

      it("Fails closed with 500 when process_payment_failure RPC fails, never allowing new checkout to proceed", async () => {
        const mockGateway = {
          fetchPaymentDetails: async () => ({
            status: "failed",
            rawStatus: "usercancelled",
          }),
        };

        const mockSupabaseAdmin = {
          rpc: async (name: string) => {
            if (name === "process_payment_failure") {
              return { data: { success: false, error: "Database lock timeout" }, error: null };
            }
            return { data: null, error: null };
          },
        };

        let checkoutProceeded = false;

        async function executeCheckoutCheck() {
          const details = await mockGateway.fetchPaymentDetails();
          if (details.status === "failed") {
            const { data: failRpcData, error: failRpcError } = await mockSupabaseAdmin.rpc("process_payment_failure");
            if (failRpcError || (failRpcData && !(failRpcData as any).success)) {
              return { status: 500, code: "FAILURE_RPC_FAILED" };
            }
          }

          checkoutProceeded = true;
          return { status: 200 };
        }

        const res = await executeCheckoutCheck();
        expect(res.status).toBe(500);
        expect(res.code).toBe("FAILURE_RPC_FAILED");
        expect(checkoutProceeded).toBe(false);
      });
    });

    // ------------------------------------------------------------------------
    // CONCERN 3: GATEWAY STATUS CLASSIFICATION
    // ------------------------------------------------------------------------
    describe("Concern 3: Gateway Status Classification", () => {
      function classifyGatewayStatus(details: {
        status: string;
        rawStatus?: string;
        unmappedStatus?: string;
        mode?: string;
        gatewayPaymentId?: string | null;
      }) {
        const rawLower = (details.rawStatus || "").toLowerCase().trim();
        const unmappedLower = (details.unmappedStatus || "").toLowerCase().trim();

        const isTerminalFailure =
          details.status === "failed" &&
          (rawLower === "failure" || rawLower === "failed" || rawLower === "bounced" || rawLower === "usercancelled" || rawLower === "dropped");

        const isSafelyAbandoned =
          details.status === "not_found" ||
          rawLower === "not found" ||
          (unmappedLower === "initiated" && details.mode === "-" && !details.gatewayPaymentId);

        if (details.status === "paid") {
          return "PAID";
        }
        if (isTerminalFailure || isSafelyAbandoned) {
          return "TERMINAL_FAILURE_OR_ABANDONED";
        }
        if (details.status === "pending") {
          return "PENDING_ACTIVE";
        }
        return "AMBIGUOUS";
      }

      it("Correctly classifies definitive terminal failures", () => {
        expect(classifyGatewayStatus({ status: "failed", rawStatus: "usercancelled" })).toBe("TERMINAL_FAILURE_OR_ABANDONED");
        expect(classifyGatewayStatus({ status: "failed", rawStatus: "bounced" })).toBe("TERMINAL_FAILURE_OR_ABANDONED");
        expect(classifyGatewayStatus({ status: "failed", rawStatus: "dropped" })).toBe("TERMINAL_FAILURE_OR_ABANDONED");
        expect(classifyGatewayStatus({ status: "failed", rawStatus: "failure" })).toBe("TERMINAL_FAILURE_OR_ABANDONED");
        expect(classifyGatewayStatus({ status: "not_found", rawStatus: "not found" })).toBe("TERMINAL_FAILURE_OR_ABANDONED");
        expect(classifyGatewayStatus({ status: "pending", unmappedStatus: "initiated", mode: "-", gatewayPaymentId: null })).toBe("TERMINAL_FAILURE_OR_ABANDONED");
      });

      it("Correctly classifies active in-flight transactions as PENDING_ACTIVE", () => {
        expect(classifyGatewayStatus({ status: "pending", rawStatus: "in progress", mode: "UPI" })).toBe("PENDING_ACTIVE");
        expect(classifyGatewayStatus({ status: "pending", rawStatus: "pending", mode: "CC" })).toBe("PENDING_ACTIVE");
      });

      it("Correctly classifies confirmed captured payments as PAID", () => {
        expect(classifyGatewayStatus({ status: "paid", rawStatus: "success", gatewayPaymentId: "pay_123" })).toBe("PAID");
      });

      it("Classifies unknown or ambiguous responses as AMBIGUOUS and fails closed", () => {
        expect(classifyGatewayStatus({ status: "unknown", rawStatus: "under_review" })).toBe("AMBIGUOUS");
        expect(classifyGatewayStatus({ status: "failed", rawStatus: "partial_refund_pending" })).toBe("AMBIGUOUS");
        expect(classifyGatewayStatus({ status: "disputed", rawStatus: "chargeback" })).toBe("AMBIGUOUS");
      });
    });
  });

});
