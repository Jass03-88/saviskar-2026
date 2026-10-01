import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/admin/check-in/route";
import * as serverLib from "@/lib/supabase/server";
import { NextRequest } from "next/server";

// Mock Supabase environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

const mockDbState: {
  lastSelectedColumns?: string;
  participantEvents: Record<
    string,
    {
      id: string;
      payment_status: string;
      payment_amount: number | null;
      checked_in: boolean;
      checked_in_at: string | null;
    }
  >;
} = {
  participantEvents: {},
};

function createMockSupabaseAdmin() {
  return {
    from: (table: string) => {
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
                      return { data: null, error: { message: "Not found" } };
                    }
                    return { data: record, error: null };
                  }
                  return { data: null, error: { message: "Not found" } };
                };
                return {
                  single: getRow,
                  maybeSingle: getRow,
                };
              },
            };
          },
          update: (updates: { checked_in: boolean; checked_in_at: string | null }) => {
            let targetId: string | null = null;
            let requiredPaymentStatus: string | null = null;
            let requiredCheckedIn: boolean | null = null;

            const chain = {
              eq: (col: string, val: string | boolean) => {
                if (col === "id") targetId = val as string;
                if (col === "payment_status") requiredPaymentStatus = val as string;
                if (col === "checked_in") requiredCheckedIn = val as boolean;
                return chain;
              },
              select: () => {
                const execute = async () => {
                  if (!targetId || !mockDbState.participantEvents[targetId]) {
                    return { data: null, error: { message: "Not found" } };
                  }
                  const rec = mockDbState.participantEvents[targetId];
                  if (requiredCheckedIn !== null && rec.checked_in !== requiredCheckedIn) {
                    return { data: [], error: null }; // Condition failed, 0 rows updated
                  }
                  if (requiredPaymentStatus && rec.payment_status !== requiredPaymentStatus) {
                    return { data: [], error: null }; // Condition failed, 0 rows updated
                  }
                  rec.checked_in = updates.checked_in ?? rec.checked_in;
                  rec.checked_in_at = updates.checked_in_at ?? rec.checked_in_at;
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

describe("P0-02: Check-In API Payment Gate Enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.participantEvents = {
      // Free event (amount = 0, status = not_required)
      "pe-free": {
        id: "pe-free",
        payment_status: "not_required",
        payment_amount: 0,
        checked_in: false,
        checked_in_at: null,
      },
      // Paid event with completed payment (amount = 200, status = paid)
      "pe-paid-ok": {
        id: "pe-paid-ok",
        payment_status: "paid",
        payment_amount: 200,
        checked_in: false,
        checked_in_at: null,
      },
      // Paid event with pending payment (amount = 200, status = pending)
      "pe-paid-pending": {
        id: "pe-paid-pending",
        payment_status: "pending",
        payment_amount: 200,
        checked_in: false,
        checked_in_at: null,
      },
      // Paid event with failed payment (amount = 200, status = failed)
      "pe-paid-failed": {
        id: "pe-paid-failed",
        payment_status: "failed",
        payment_amount: 200,
        checked_in: false,
        checked_in_at: null,
      },
      // Paid event with missing / refunded payment (amount = 200, status = refunded)
      "pe-paid-refunded": {
        id: "pe-paid-refunded",
        payment_status: "refunded",
        payment_amount: 200,
        checked_in: false,
        checked_in_at: null,
      },
      // Inconsistent payment: null payment_amount
      "pe-null-amount": {
        id: "pe-null-amount",
        payment_status: "paid",
        payment_amount: null,
        checked_in: false,
        checked_in_at: null,
      },
      // Inconsistent payment: not_required with positive amount
      "pe-inconsistent-free": {
        id: "pe-inconsistent-free",
        payment_status: "not_required",
        payment_amount: 200,
        checked_in: false,
        checked_in_at: null,
      },
      // Inconsistent payment: pending with amount 0
      "pe-inconsistent-pending": {
        id: "pe-inconsistent-pending",
        payment_status: "pending",
        payment_amount: 0,
        checked_in: false,
        checked_in_at: null,
      },
    };

    type AdminAuthResult = Awaited<ReturnType<typeof serverLib.requireAdmin>>;

    // Default: Authenticated Admin
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      supabase: {},
      user: { id: "admin-uuid", email: "admin@example.com" },
      role: "admin",
      error: null,
      status: 200,
    } as unknown as AdminAuthResult);
  });

  it("A. Free event -> check-in allowed", async () => {
    const res = await POST(makeRequest({ participantEventId: "pe-free", action: "check_in" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checked_in).toBe(true);
    expect(mockDbState.participantEvents["pe-free"].checked_in).toBe(true);
  });

  it("B. Paid event + paid status -> check-in allowed", async () => {
    const res = await POST(makeRequest({ participantEventId: "pe-paid-ok", action: "check_in" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checked_in).toBe(true);
    expect(mockDbState.participantEvents["pe-paid-ok"].checked_in).toBe(true);
  });

  it("C. Paid event + pending status -> denied with 402 Payment Required", async () => {
    const res = await POST(makeRequest({ participantEventId: "pe-paid-pending", action: "check_in" }));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Payment not complete");
    expect(data.paymentStatus).toBe("pending");
    expect(mockDbState.participantEvents["pe-paid-pending"].checked_in).toBe(false);
  });

  it("D. Paid event + failed status -> denied with 402 Payment Required", async () => {
    const res = await POST(makeRequest({ participantEventId: "pe-paid-failed", action: "check_in" }));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Payment not complete");
    expect(data.paymentStatus).toBe("failed");
    expect(mockDbState.participantEvents["pe-paid-failed"].checked_in).toBe(false);
  });

  it("E. Paid event + refunded status -> denied with 402 Payment Required", async () => {
    const res = await POST(makeRequest({ participantEventId: "pe-paid-refunded", action: "check_in" }));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Payment not complete");
    expect(data.paymentStatus).toBe("refunded");
    expect(mockDbState.participantEvents["pe-paid-refunded"].checked_in).toBe(false);
  });

  it("F. Invalid participantEventId -> denied safely with 404", async () => {
    const res = await POST(makeRequest({ participantEventId: "nonexistent-id", action: "check_in" }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Participant event not found.");
  });

  it("G. Already checked-in -> denied with 409 ALREADY_CHECKED_IN", async () => {
    const checkedInAt = new Date().toISOString();
    mockDbState.participantEvents["pe-paid-ok"].checked_in = true;
    mockDbState.participantEvents["pe-paid-ok"].checked_in_at = checkedInAt;

    const res = await POST(makeRequest({ participantEventId: "pe-paid-ok", action: "check_in" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("ALREADY_CHECKED_IN");
    expect(data.checked_in_at).toBe(checkedInAt);
  });

  it("H. Check-out action works regardless of payment gate", async () => {
    mockDbState.participantEvents["pe-paid-ok"].checked_in = true;

    const res = await POST(makeRequest({ participantEventId: "pe-paid-ok", action: "check_out" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checked_in).toBe(false);
    expect(data.checked_in_at).toBe(null);
  });

  it("I. Forged client payment status in body cannot bypass server gate", async () => {
    // Attempting to send { payment_status: 'paid' } in body for a pending event
    const res = await POST(
      makeRequest({
        participantEventId: "pe-paid-pending",
        action: "check_in",
        payment_status: "paid",
        paymentStatus: "paid",
      })
    );
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.paymentStatus).toBe("pending");
  });

  it("J. Unauthorized user -> denied with 401", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
      supabase: {},
      user: null,
      role: null,
      error: "Unauthorized",
      status: 401,
    } as unknown as Awaited<ReturnType<typeof serverLib.requireAdmin>>);

    const res = await POST(makeRequest({ participantEventId: "pe-paid-ok", action: "check_in" }));
    expect(res.status).toBe(401);
  });

  it("K. Check-in query selects participant_events.payment_amount directly without joining events", async () => {
    await POST(makeRequest({ participantEventId: "pe-paid-ok", action: "check_in" }));
    // The main select is id, payment_status, payment_amount, team_name, event_id, participant_id, registration_group_id
    expect(mockDbState.lastSelectedColumns).toContain("payment_amount");
    expect(mockDbState.lastSelectedColumns).not.toContain("events");
  });

  it("L. Inconsistent payment state: null payment_amount -> fail closed with 400", async () => {
    const res = await POST(makeRequest({ participantEventId: "pe-null-amount", action: "check_in" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Inconsistent payment record: invalid amount.");
    expect(mockDbState.participantEvents["pe-null-amount"].checked_in).toBe(false);
  });

  it("M. Inconsistent payment state: positive amount with not_required status -> fail closed with 400", async () => {
    const res = await POST(makeRequest({ participantEventId: "pe-inconsistent-free", action: "check_in" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Inconsistent payment record.");
    expect(mockDbState.participantEvents["pe-inconsistent-free"].checked_in).toBe(false);
  });

  it("N. Inconsistent payment state: pending with zero amount -> denied with 402", async () => {
    const res = await POST(makeRequest({ participantEventId: "pe-inconsistent-pending", action: "check_in" }));
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe("Payment not complete");
    expect(data.paymentStatus).toBe("pending");
    expect(mockDbState.participantEvents["pe-inconsistent-pending"].checked_in).toBe(false);
  });

  it("O. Forged client payment_amount: 0 in body cannot bypass payment gate", async () => {
    const res = await POST(
      makeRequest({
        participantEventId: "pe-paid-pending",
        action: "check_in",
        payment_amount: 0,
        paymentAmount: 0,
      })
    );
    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.paymentStatus).toBe("pending");
    expect(mockDbState.participantEvents["pe-paid-pending"].checked_in).toBe(false);
  });
});
