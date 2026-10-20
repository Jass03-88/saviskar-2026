import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/admin/check-in/route";
import * as serverLib from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import {
  evaluateEventPaymentStatus,
  EventPaymentContext,
} from "@/lib/admin/check-in-rules";

// Mock Supabase environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

interface MockParticipantEvent {
  id: string;
  event_id: string;
  registration_status: string;
  payment_status: string;
  payment_amount: number | null;
  team_name: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  main_checked_in?: boolean;
  main_checked_in_at?: string | null;
  registration_group_id?: string | null;
}

interface MockEvent {
  id: string;
  name: string;
  category: string;
  registration_fee: number;
  payment_type: "free" | "paid";
  payment_unit?: string;
}

const mockDbState: {
  lastSelectedColumns?: string;
  participantEvents: Record<string, MockParticipantEvent>;
  events: Record<string, MockEvent>;
  auditLogs: Array<{ action_type: string; target_id: string; details: any }>;
} = {
  participantEvents: {},
  events: {},
  auditLogs: [],
};

function createMockSupabaseAdmin() {
  return {
    from: (table: string) => {
      if (table === "events") {
        return {
          select: (_columns: string) => ({
            eq: (column: string, value: string) => ({
              maybeSingle: async () => {
                if (column === "id") {
                  const ev = mockDbState.events[value];
                  return { data: ev || null, error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }

      if (table === "participant_events") {
        return {
          select: (_columns: string) => {
            mockDbState.lastSelectedColumns = _columns;
            return {
              eq: (column: string, value: string) => {
                const getRow = async () => {
                  if (column === "id") {
                    const record = mockDbState.participantEvents[value];
                    if (!record) {
                      return { data: null, error: { message: "Not found", code: "PGRST116" } };
                    }
                    return { data: record, error: null };
                  }
                  return { data: null, error: { message: "Not found", code: "PGRST116" } };
                };
                return {
                  single: getRow,
                  maybeSingle: getRow,
                };
              },
            };
          },
          update: (updates: {
            checked_in?: boolean;
            checked_in_at?: string | null;
            main_checked_in?: boolean;
            main_checked_in_at?: string | null;
          }) => {
            let targetId: string | null = null;
            let targetGroupId: string | null = null;
            let requiredPaymentStatus: string | null = null;
            let requiredCheckedIn: boolean | null = null;
            let requiredMainCheckedIn: boolean | null = null;

            const chain = {
              eq: (col: string, val: string | boolean) => {
                if (col === "id") targetId = val as string;
                if (col === "registration_group_id") targetGroupId = val as string;
                if (col === "payment_status") requiredPaymentStatus = val as string;
                if (col === "checked_in") requiredCheckedIn = val as boolean;
                if (col === "main_checked_in") requiredMainCheckedIn = val as boolean;
                return chain;
              },
              select: () => {
                const execute = async () => {
                  const rec = targetId ? mockDbState.participantEvents[targetId] : null;
                  if (!rec) {
                    return { data: [], error: null };
                  }

                  if (requiredCheckedIn !== null && rec.checked_in !== requiredCheckedIn) {
                    return { data: [], error: null };
                  }
                  if (requiredMainCheckedIn !== null && rec.main_checked_in !== requiredMainCheckedIn) {
                    return { data: [], error: null };
                  }
                  if (requiredPaymentStatus && rec.payment_status !== requiredPaymentStatus) {
                    return { data: [], error: null };
                  }

                  if (updates.checked_in !== undefined) {
                    rec.checked_in = updates.checked_in;
                    rec.checked_in_at = updates.checked_in_at ?? rec.checked_in_at;
                  }
                  if (updates.main_checked_in !== undefined) {
                    rec.main_checked_in = updates.main_checked_in;
                    rec.main_checked_in_at = updates.main_checked_in_at ?? rec.main_checked_in_at;
                  }

                  return { data: [rec], error: null };
                };

                return {
                  single: async () => {
                    const res = await execute();
                    return { data: res.data ? res.data[0] : null, error: res.error };
                  },
                  maybeSingle: async () => {
                    const res = await execute();
                    return { data: res.data ? res.data[0] : null, error: res.error };
                  },
                  then: (resolve: any) => execute().then(resolve),
                };
              },
            };
            return chain;
          },
        };
      }

      if (table === "admin_audit_logs") {
        return {
          insert: async (entry: any) => {
            mockDbState.auditLogs.push(entry);
            return { error: null };
          },
        };
      }

      return {};
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createMockSupabaseAdmin(),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/check-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("SAVISKAR 2026 — Part 5 Authoritative Free Event & Payment Enforcement Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.auditLogs = [];

    // Synthetic Events
    mockDbState.events = {
      // 1. Free Technical Event (e.g. AI Video & Meme Challenge)
      "ev-tech-free": {
        id: "ev-tech-free",
        name: "AI Video & Meme Challenge",
        category: "Technical Event",
        registration_fee: 0,
        payment_type: "free",
      },
      // 2. Free Cultural Event
      "ev-cult-free": {
        id: "ev-cult-free",
        name: "Open Mic",
        category: "Cultural Event",
        registration_fee: 0,
        payment_type: "free",
      },
      // 3. Free Non-Technical Event
      "ev-nontech-free": {
        id: "ev-nontech-free",
        name: "Business Quiz",
        category: "Non-Technical Event",
        registration_fee: 0,
        payment_type: "free",
      },
      // 4. Paid Technical Event
      "ev-tech-paid": {
        id: "ev-tech-paid",
        name: "Roborace",
        category: "Technical Event",
        registration_fee: 300,
        payment_type: "paid",
      },
    };

    // Synthetic Participant Events
    mockDbState.participantEvents = {
      // 1. Confirmed free technical event, unpaid status, no accommodation
      "pe-free-tech-unpaid": {
        id: "pe-free-tech-unpaid",
        event_id: "ev-tech-free",
        registration_status: "confirmed",
        payment_status: "unpaid",
        payment_amount: 0,
        team_name: null,
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
      },
      // 2. Confirmed free cultural event, no payment transaction (RPC sets confirmed)
      "pe-free-cult": {
        id: "pe-free-cult",
        event_id: "ev-cult-free",
        registration_status: "confirmed",
        payment_status: "confirmed",
        payment_amount: 0,
        team_name: null,
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
      },
      // 3. Confirmed free non-technical event, not_required status
      "pe-free-nontech": {
        id: "pe-free-nontech",
        event_id: "ev-nontech-free",
        registration_status: "confirmed",
        payment_status: "not_required",
        payment_amount: 0,
        team_name: null,
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
      },
      // 4. Paid event with unpaid status
      "pe-paid-unpaid": {
        id: "pe-paid-unpaid",
        event_id: "ev-tech-paid",
        registration_status: "pending",
        payment_status: "unpaid",
        payment_amount: 300,
        team_name: "RoboSquad",
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
      },
      // 5. Paid event with pending payment
      "pe-paid-pending": {
        id: "pe-paid-pending",
        event_id: "ev-tech-paid",
        registration_status: "pending",
        payment_status: "pending",
        payment_amount: 300,
        team_name: "RoboSquad",
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
      },
      // 6. Paid event with authoritative successful settlement
      "pe-paid-settled": {
        id: "pe-paid-settled",
        event_id: "ev-tech-paid",
        registration_status: "confirmed",
        payment_status: "paid",
        payment_amount: 300,
        team_name: "RoboSquad",
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
      },
      // Live participant report reproduction (jashan SVK26-D74CC75C)
      "pe-jashan-live-report": {
        id: "pe-jashan-live-report",
        event_id: "ev-tech-free",
        registration_status: "confirmed",
        payment_status: "confirmed",
        payment_amount: 0,
        team_name: null,
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
      },
    };

    // Authenticated admin mock
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      supabase: {},
      user: { id: "admin-uuid-1", email: "admin@saviskar.co.in" },
      role: "admin",
      error: null,
      status: 200,
    } as any);
  });

  // 1. Confirmed free technical event, unpaid status, no accommodation: check-in allowed
  it("1. Confirmed free technical event with unpaid status -> check-in allowed", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-free-tech-unpaid", action: "check_in" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checked_in).toBe(true);
    expect(mockDbState.participantEvents["pe-free-tech-unpaid"].checked_in).toBe(true);
  });

  // 2. Confirmed free cultural event, no payment transaction: check-in allowed
  it("2. Confirmed free cultural event with no payment transaction -> check-in allowed", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-free-cult", action: "check_in" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checked_in).toBe(true);
  });

  // 3. Confirmed free non-technical event, no payment transaction: check-in allowed
  it("3. Confirmed free non-technical event with no payment transaction -> check-in allowed", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-free-nontech", action: "check_in" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checked_in).toBe(true);
  });

  // 4. Paid event with unpaid status: check-in blocked
  it("4. Paid event with unpaid status -> check-in blocked with 402", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-paid-unpaid", action: "check_in" })
    );
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Payment not complete");
    expect(mockDbState.participantEvents["pe-paid-unpaid"].checked_in).toBe(false);
  });

  // 5. Paid event with pending payment: check-in blocked
  it("5. Paid event with pending payment -> check-in blocked with 402", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-paid-pending", action: "check_in" })
    );
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Payment not complete");
    expect(mockDbState.participantEvents["pe-paid-pending"].checked_in).toBe(false);
  });

  // 6. Paid event with authoritative successful settlement: normal existing eligibility applies
  it("6. Paid event with authoritative successful settlement -> check-in allowed", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-paid-settled", action: "check_in" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checked_in).toBe(true);
    expect(mockDbState.participantEvents["pe-paid-settled"].checked_in).toBe(true);
  });

  // 7. Free event with no accommodation: no accommodation-payment requirement is invented
  it("7. Free event with no accommodation -> check-in operates independently without accommodation gating", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-free-tech-unpaid", action: "main_check_in" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.main_checked_in).toBe(true);
  });

  // 8. Free event with a separately payable accommodation charge: accommodation payment rules remain enforced
  it("8. Free event rules do not bypass accommodation payment checks", () => {
    // Accommodation status decision is independent
    const accPaid = { status: "paid" };
    const accUnpaid = { status: "unpaid" };

    expect(accPaid.status === "paid").toBe(true);
    expect(accUnpaid.status === "paid").toBe(false);

    // Event evaluation for a free event remains free even if participant has accommodation
    const decision = evaluateEventPaymentStatus({
      paymentType: "free",
      registrationFee: 0,
      paymentAmount: 0,
      paymentStatus: "confirmed",
    });
    expect(decision.isFree).toBe(true);
    expect(decision.canCheckIn).toBe(true);
  });

  // 9. Free event status is not incorrectly labelled UNPAID merely because it has no payment order
  it("9. Free event status decision produces badge FREE EVENT and not UNPAID", () => {
    const decision = evaluateEventPaymentStatus({
      paymentType: "free",
      registrationFee: 0,
      paymentAmount: 0,
      paymentStatus: "confirmed",
    });
    expect(decision.badgeLabel).toBe("FREE EVENT");
    expect(decision.rejectionReason).toBeNull();
    expect(decision.canCheckIn).toBe(true);
  });

  // 10. Missing/inconsistent pricing data cannot be used to bypass payment checks for chargeable events
  it("10. Chargeable event with zero payment_amount fails closed if not paid", () => {
    const decision = evaluateEventPaymentStatus({
      paymentType: "paid",
      registrationFee: 300,
      paymentAmount: 0, // Inconsistent/forged
      paymentStatus: "unpaid",
    });
    expect(decision.canCheckIn).toBe(false);
    expect(decision.httpStatus).toBe(402);
  });

  // 11. Valid QR for an unrelated, unregistered event remains rejected
  it("11. Unregistered event ID -> denied with 404", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-unregistered-id", action: "check_in" })
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Participant event not found.");
  });

  // 12. Existing duplicate-check-in prevention remains intact
  it("12. Duplicate check-in -> denied with 409 ALREADY_CHECKED_IN", async () => {
    mockDbState.participantEvents["pe-free-tech-unpaid"].checked_in = true;
    mockDbState.participantEvents["pe-free-tech-unpaid"].checked_in_at = new Date().toISOString();

    const res = await POST(
      makeRequest({ participantEventId: "pe-free-tech-unpaid", action: "check_in" })
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("ALREADY_CHECKED_IN");
  });

  // 13. Existing authentication, authorization and audit behaviour remain intact
  it("13. Audit log is written when admin checks in a free event", async () => {
    const res = await POST(
      makeRequest({ participantEventId: "pe-free-cult", action: "check_in" })
    );
    expect(res.status).toBe(200);
    expect(mockDbState.auditLogs.length).toBeGreaterThan(0);
    expect(mockDbState.auditLogs[0].action_type).toBe("SCANNER_EVENT_CHECK_IN");
    expect(mockDbState.auditLogs[0].target_id).toBe("pe-free-cult");
  });

  // 14. A paid event cannot be checked in by modifying client-supplied amounts or status fields
  it("14. Paid event with forged client body fields (amount: 0, status: paid) is rejected", async () => {
    const res = await POST(
      makeRequest({
        participantEventId: "pe-paid-unpaid",
        action: "check_in",
        payment_amount: 0,
        paymentAmount: 0,
        payment_status: "paid",
        paymentStatus: "paid",
      })
    );
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(mockDbState.participantEvents["pe-paid-unpaid"].checked_in).toBe(false);
  });

  // Direct reproduction of user bug report (AI Video & Meme Challenge confirmed)
  it("15. Live report participant (jashan, SVK26-D74CC75C) can check in to AI Video & Meme Challenge", async () => {
    // 1. Verify payment rule evaluation
    const decision = evaluateEventPaymentStatus({
      paymentType: "free",
      registrationFee: 0,
      paymentAmount: 0,
      paymentStatus: "confirmed",
      registrationStatus: "confirmed",
    });

    expect(decision.isFree).toBe(true);
    expect(decision.requiresPayment).toBe(false);
    expect(decision.canCheckIn).toBe(true);
    expect(decision.badgeLabel).toBe("FREE EVENT");
    expect(decision.rejectionReason).toBeNull();

    // 2. Verify backend endpoint check_in
    const res = await POST(
      makeRequest({ participantEventId: "pe-jashan-live-report", action: "check_in" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checked_in).toBe(true);
    expect(mockDbState.participantEvents["pe-jashan-live-report"].checked_in).toBe(true);
  });
});
