import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as postRegister } from "@/app/api/register/route";
import { calculateStayDates } from "@/lib/accommodation-dates";
import { evaluatePendingCheckoutState, isCheckoutEligibleForExpiration } from "@/lib/accommodation-expiration";
import { NextRequest } from "next/server";
import * as authSessionLib from "@/lib/auth/session";
import * as rateLimitLib from "@/lib/rate-limit";

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return {
    ...mod,
    after: vi.fn(() => {}),
  };
});

// Configure test environment variables (isolated mock, NEVER production writes)
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://isolated-mock-test.supabase.co";
process.env.SUPABASE_SECRET_KEY = "mock-secret-key";

let mockRpcCalls: Array<{ name: string; params: any }> = [];
let mockRpcReturn: { data: any; error: any } = {
  data: [
    {
      participant_id: "SVK26-ABC12345",
      participant_public_id: "SVK26-ABC12345",
      participant_event_id: "11111111-2222-3333-4444-555555555555",
      event_id: "11111111-1111-4111-a111-111111111111",
      event_name: "Code Genesis",
      status: "added",
      payment_order_id: "po-12345",
      payment_amount: 0,
    },
  ],
  error: null,
};

function createMockSupabaseClient() {
  return {
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        update: () => builder,
        insert: () => builder,
        maybeSingle: () => Promise.resolve({ data: { id: "p-uuid-1", participant_id: "SVK26-ABC12345" }, error: null }),
        single: () => Promise.resolve({ data: { id: "p-uuid-1", participant_id: "SVK26-ABC12345" }, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return builder;
    },
    rpc: (name: string, params: any) => {
      mockRpcCalls.push({ name, params });
      return Promise.resolve(mockRpcReturn);
    },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://example.com" }, error: null }),
      }),
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createMockSupabaseClient(),
}));

function createJsonPostRequest(url: string, body: any): NextRequest {
  return new NextRequest(new URL(url, "https://saviskar.co.in"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "vitest-test-agent",
    },
    body: JSON.stringify(body),
  });
}

describe("SAVISKAR 2026 — Critical Registration Investigation & Regression Suite", () => {
  const authenticatedEmail = "lead@example.com";

  beforeEach(() => {
    mockRpcCalls = [];
    vi.clearAllMocks();

    vi.spyOn(rateLimitLib, "checkRateLimitAsync").mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfter: 0,
    } as any);
    vi.spyOn(rateLimitLib, "getClientIp").mockReturnValue("127.0.0.1");

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: authenticatedEmail,
    } as any);

    mockRpcReturn = {
      data: [
        {
          participant_id: "SVK26-ABC12345",
          participant_public_id: "SVK26-ABC12345",
          participant_event_id: "11111111-2222-3333-4444-555555555555",
          event_id: "11111111-1111-4111-a111-111111111111",
          event_name: "Test Event",
          status: "added",
          payment_order_id: null,
          payment_amount: 0,
        },
      ],
      error: null,
    };
  });

  // =========================================================================
  // 1. INDIVIDUAL REGISTRATION (TECHNICAL & CULTURAL)
  // =========================================================================
  describe("1. Individual Registrations (Technical & Cultural)", () => {
    it("A. Individual + technical event, no accommodation -> succeeds", async () => {
      const payload = {
        name: "Alice Sharma",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "GNDU Amritsar",
        gender: "female",
        state: "Punjab",
        idCardStoragePath: `${authenticatedEmail}/id-alice.jpg`,
        events: [
          {
            eventId: "11111111-1111-4111-a111-111111111111",
            team: null,
            isTeamHead: false,
            members: [],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect([200, 201]).toContain(res.status);
      expect(json.success).toBe(true);
      expect(json.participantId).toBe("SVK26-ABC12345");
      expect(mockRpcCalls.length).toBe(1);
      expect(mockRpcCalls[0].params.p_college).toBe("GNDU Amritsar");
      expect(mockRpcCalls[0].params.p_events[0].members).toEqual([]);
    });

    it("B. Individual + cultural event, no accommodation -> succeeds", async () => {
      const payload = {
        name: "Bob Singh",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "Punjab University",
        gender: "male",
        state: "Punjab",
        idCardStoragePath: `${authenticatedEmail}/id-bob.jpg`,
        events: [
          {
            eventId: "22222222-2222-4222-a222-222222222222", // Solo Singing (Cultural)
            team: null,
            isTeamHead: false,
            members: [],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect([200, 201]).toContain(res.status);
      expect(json.success).toBe(true);
      expect(mockRpcCalls.length).toBe(1);
      expect(mockRpcCalls[0].params.p_email).toBe(authenticatedEmail);
    });
  });

  // =========================================================================
  // 2. TEAM REGISTRATION & MEMBER COLLEGE RESILIENCE
  // =========================================================================
  describe("2. Team Registration & Member College Parity", () => {
    it("A. Team + technical event -> defaults member college to leader college (prevents 23502)", async () => {
      const payload = {
        name: "Lead Dev",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "IIT Ropar",
        gender: "male",
        state: "Punjab",
        idCardStoragePath: `${authenticatedEmail}/lead-id.jpg`,
        events: [
          {
            eventId: "33333333-3333-4333-a333-333333333333", // Hackathon (Technical)
            team: "Binary Beasts",
            isTeamHead: true,
            members: [
              {
                name: "Teammate One",
                email: "teammate1@example.com",
                phone: "9876543211",
                gender: "female",
                state: "Punjab",
                idCardStoragePath: `${authenticatedEmail}/t1-id.jpg`,
                // Note: member.college omitted by UI!
              },
            ],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect([200, 201]).toContain(res.status);
      expect(json.success).toBe(true);

      const rpcParam = mockRpcCalls[0].params;
      const sentMember = rpcParam.p_events[0].members[0];

      // Verifies the fix: college is NEVER empty/null when sent to DB RPC!
      expect(sentMember.college).toBe("IIT Ropar");
      // Verifies key parity: both camelCase and snake_case provided!
      expect(sentMember.idCardStoragePath).toBe(`${authenticatedEmail}/t1-id.jpg`);
      expect(sentMember.id_card_storage_path).toBe(`${authenticatedEmail}/t1-id.jpg`);
      expect(rpcParam.p_events[0].isTeamHead).toBe(true);
      expect(rpcParam.p_events[0].is_team_head).toBe(true);
    });

    it("B. Team + cultural event -> registers all members consistently", async () => {
      const payload = {
        name: "Cultural Head",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "Thapar University",
        gender: "female",
        state: "Punjab",
        idCardStoragePath: `${authenticatedEmail}/head-id.jpg`,
        events: [
          {
            eventId: "44444444-4444-4444-a444-444444444444", // Group Dance (Cultural)
            team: "Rhythm Squad",
            isTeamHead: true,
            members: [
              {
                name: "Dancer One",
                email: "dancer1@example.com",
                phone: "9876543212",
                gender: "female",
                state: "Punjab",
              },
              {
                name: "Dancer Two",
                email: "dancer2@example.com",
                phone: "9876543213",
                gender: "male",
                state: "Punjab",
              },
            ],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect([200, 201]).toContain(res.status);
      expect(json.success).toBe(true);

      const rpcMembers = mockRpcCalls[0].params.p_events[0].members;
      expect(rpcMembers.length).toBe(2);
      expect(rpcMembers[0].college).toBe("Thapar University");
      expect(rpcMembers[1].college).toBe("Thapar University");
    });

    it("C. Team selecting multiple valid events -> preserves event and member associations", async () => {
      const payload = {
        name: "Multi Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "CGC Landran",
        gender: "male",
        state: "Punjab",
        idCardStoragePath: `${authenticatedEmail}/lead.jpg`,
        events: [
          {
            eventId: "33333333-3333-4333-a333-333333333333", // Tech
            team: "Team Tech",
            isTeamHead: true,
            members: [
              { name: "Dev A", email: "deva@example.com", phone: "9876543211", gender: "male", state: "Punjab" },
            ],
          },
          {
            eventId: "44444444-4444-4444-a444-444444444444", // Cultural
            team: "Team Dance",
            isTeamHead: true,
            members: [
              { name: "Dev A", email: "deva@example.com", phone: "9876543211", gender: "male", state: "Punjab" },
            ],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect([200, 201]).toContain(res.status);
      expect(json.success).toBe(true);
      expect(mockRpcCalls[0].params.p_events.length).toBe(2);
    });
  });

  // =========================================================================
  // 3. TEAM MEMBER VALIDATION FAILURES (PRE-RPC REJECTION)
  // =========================================================================
  describe("3. Team Member Pre-RPC Validation", () => {
    it("A. Rejects team member missing name before calling RPC", async () => {
      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [
          {
            eventId: "33333333-3333-4333-a333-333333333333",
            team: "Team A",
            isTeamHead: true,
            members: [
              { name: "  ", email: "valid@example.com", phone: "9876543211" },
            ],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toBe("Team member name is required.");
      expect(json.code).toBe("VALIDATION_ERROR");
      expect(mockRpcCalls.length).toBe(0); // RPC was NOT called!
    });

    it("B. Rejects invalid team member email address", async () => {
      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [
          {
            eventId: "33333333-3333-4333-a333-333333333333",
            team: "Team A",
            isTeamHead: true,
            members: [
              { name: "Teammate", email: "not-an-email", phone: "9876543211" },
            ],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("VALIDATION_ERROR");
      expect(mockRpcCalls.length).toBe(0);
    });

    it("C. Rejects if team leader enters own email as a team member", async () => {
      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [
          {
            eventId: "33333333-3333-4333-a333-333333333333",
            team: "Team A",
            isTeamHead: true,
            members: [
              { name: "Self", email: authenticatedEmail, phone: "9876543211" },
            ],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("You cannot add yourself as a team member");
      expect(mockRpcCalls.length).toBe(0);
    });

    it("D. Rejects duplicate emails among team members", async () => {
      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [
          {
            eventId: "33333333-3333-4333-a333-333333333333",
            team: "Team A",
            isTeamHead: true,
            members: [
              { name: "Teammate 1", email: "dup@example.com", phone: "9876543211" },
              { name: "Teammate 2", email: "dup@example.com", phone: "9876543212" },
            ],
          },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("Duplicate team member email address");
      expect(mockRpcCalls.length).toBe(0);
    });
  });

  // =========================================================================
  // 4. POSTGRES CONSTRAINT ERROR MAPPING (23505 & 23502)
  // =========================================================================
  describe("4. PostgreSQL Constraint Error Mapping", () => {
    it("A. Maps Postgres 23505 unique violation to actionable 400 error (not generic 500)", async () => {
      mockRpcReturn = {
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "participant_events_unique_event"',
          details: "Key (participant_id, event_id)=(uuid1, uuid2) already exists.",
        },
      };

      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [{ eventId: "33333333-3333-4333-a333-333333333333", team: null, members: [] }],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.code).toBe("DUPLICATE_REGISTRATION");
      expect(json.error).toContain("already registered");
    });

    it("B. Maps Postgres 23502 not-null violation to actionable 400 error (not generic 500)", async () => {
      mockRpcReturn = {
        data: null,
        error: {
          code: "23502",
          message: 'null value in column "college" of relation "participants" violates not-null constraint',
          details: "Failing row contains null college.",
        },
      };

      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [{ eventId: "33333333-3333-4333-a333-333333333333", team: null, members: [] }],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.code).toBe("MISSING_REQUIRED_FIELD");
      expect(json.error).toContain("required registration field was missing");
    });

    it("C. Handles unexpected DB error with safe 500 and internal error code", async () => {
      mockRpcReturn = {
        data: null,
        error: {
          code: "XX000",
          message: "unexpected internal database anomaly",
          details: "raw internal details",
        },
      };

      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [{ eventId: "33333333-3333-4333-a333-333333333333", team: null, members: [] }],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.code).toBe("INTERNAL_ERROR");
      expect(json.error).toBe("We couldn't save your registration. Please try again.");
    });

    it("D. Does not misclassify unrelated 23505 unique error (e.g. order reference collision) as duplicate registration", async () => {
      mockRpcReturn = {
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "payment_orders_order_reference_key"',
          details: "Key (order_reference)=(SVK-ORD-123) already exists.",
        },
      };

      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [{ eventId: "33333333-3333-4333-a333-333333333333", team: null, members: [] }],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      // Unrelated unique constraint must not be blamed on user event duplicates!
      expect(res.status).toBe(500);
      expect(json.code).toBe("INTERNAL_ERROR");
    });

    it("E. Does not misclassify unrelated 23502 not-null error as missing participant field", async () => {
      mockRpcReturn = {
        data: null,
        error: {
          code: "23502",
          message: 'null value in column "system_audit_id" of relation "audit_logs" violates not-null constraint',
          details: "Internal audit trigger failure.",
        },
      };

      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [{ eventId: "33333333-3333-4333-a333-333333333333", team: null, members: [] }],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      // Unrelated not-null constraint must not falsely blame user registration fields!
      expect(res.status).toBe(500);
      expect(json.code).toBe("INTERNAL_ERROR");
    });
  });

  // =========================================================================
  // 5. ACCOMMODATION DATE RESOLVER (calculateStayDates) RESILIENCE
  // =========================================================================
  describe("5. Accommodation calculateStayDates Normalization", () => {
    it("A. Normalizes 3_days without extraDays when selectedDate is 2026-10-30 to base festival start", () => {
      // Known edge case: raw call without extraDays: "after_30" must NOT calculate 2026-10-30 to 2026-11-02!
      const dates = calculateStayDates("3_days", "2026-10-30");
      expect(dates).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-31",
        durationDays: 3,
      });
    });

    it("B. Correctly resolves 3_days with before_27 early arrival", () => {
      const dates = calculateStayDates("3_days", "2026-10-27", "before_27");
      expect(dates).toEqual({
        startDate: "2026-10-27",
        endDate: "2026-10-30",
        durationDays: 3,
      });
    });

    it("C. Correctly resolves 4_days full festival stay", () => {
      const dates = calculateStayDates("4_days");
      expect(dates).toEqual({
        startDate: "2026-10-27",
        endDate: "2026-10-31",
        durationDays: 4,
      });
    });

    it("D. Correctly resolves 1_day stays for each valid festival day", () => {
      expect(calculateStayDates("1_day", "2026-10-27")).toEqual({
        startDate: "2026-10-27",
        endDate: "2026-10-28",
        durationDays: 1,
      });
      expect(calculateStayDates("1_day", "2026-10-28")).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-29",
        durationDays: 1,
      });
      expect(calculateStayDates("1_day", "2026-10-29")).toEqual({
        startDate: "2026-10-29",
        endDate: "2026-10-30",
        durationDays: 1,
      });
      expect(calculateStayDates("1_day", "2026-10-30")).toEqual({
        startDate: "2026-10-30",
        endDate: "2026-10-31",
        durationDays: 1,
      });
    });

    it("E. Correctly resolves 2_days standard festival stay", () => {
      expect(calculateStayDates("2_days")).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-30",
        durationDays: 2,
      });
    });

    it("F. Verifies adjacent non-overlapping half-open intervals [2026-10-27, 2026-10-28) and [2026-10-28, 2026-10-30)", () => {
      const stay1 = calculateStayDates("1_day", "2026-10-27");
      const stay2 = calculateStayDates("2_days", "2026-10-28");

      // In half-open semantics [start, end), stay1 ends on 2026-10-28 and stay2 begins on 2026-10-28
      expect(stay1.endDate).toBe(stay2.startDate);
      // Half-open non-overlap invariant: !(stay1.startDate < stay2.endDate && stay1.endDate > stay2.startDate)
      const overlaps = stay1.startDate < stay2.endDate && stay1.endDate > stay2.startDate;
      expect(overlaps).toBe(false);
    });
  });

  // =========================================================================
  // 6. ACTIVE CHECKOUT AND STALE HOLD EXPIRATION INVARIANTS
  // =========================================================================
  describe("6. Active Checkout & Stale Hold Expiration Invariants", () => {
    it("A. Formats SVK11 Active Checkout error with clear actionable feedback", async () => {
      mockRpcReturn = {
        data: null,
        error: {
          code: "SVK11",
          message: "Active checkout in progress for these dates (2026-10-28 to 2026-10-30). Please complete it or wait for it to expire.",
        },
      };

      const payload = {
        name: "Lead",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "College",
        events: [{ eventId: "33333333-3333-4333-a333-333333333333", team: null, members: [] }],
        accommodations: [{ email: authenticatedEmail, planSlug: "2_days", selectedDate: "2026-10-28" }],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.code).toBe("ACTIVE_CHECKOUT_IN_PROGRESS");
      expect(json.error).toBe(
        "Active checkout in progress for these dates (2026-10-28 to 2026-10-30). Please complete it or wait for it to expire."
      );
    });

    it("B. Never expires a pending checkout within the 1-hour active window", () => {
      const now = Date.now();
      const recentStay = {
        id: "stay-1",
        status: "pending",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        created_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 minutes ago
        updated_at: new Date(now - 10 * 60 * 1000).toISOString(),
      };
      const recentOrder = {
        id: "order-1",
        status: "pending",
        created_at: new Date(now - 10 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 10 * 60 * 1000).toISOString(),
      };

      const state = evaluatePendingCheckoutState(recentStay, recentOrder, now);
      expect(state).toBe("ACTIVE_IN_FLIGHT");
      expect(isCheckoutEligibleForExpiration(recentStay, recentOrder, now)).toBe(false);
    });

    it("C. Safely identifies abandoned unpaid checkouts older than 1 hour as expirable", () => {
      const now = Date.now();
      const staleStay = {
        id: "stay-2",
        status: "pending",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        created_at: new Date(now - 90 * 60 * 1000).toISOString(), // 90 minutes ago
        updated_at: new Date(now - 90 * 60 * 1000).toISOString(),
      };
      const staleOrder = {
        id: "order-2",
        status: "pending",
        created_at: new Date(now - 90 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 90 * 60 * 1000).toISOString(),
      };

      const state = evaluatePendingCheckoutState(staleStay, staleOrder, now);
      expect(state).toBe("EXPIRED_UNPAID");
      expect(isCheckoutEligibleForExpiration(staleStay, staleOrder, now)).toBe(true);
    });

    it("D. Never expires a confirmed paid booking even if older than 1 hour", () => {
      const now = Date.now();
      const paidStay = {
        id: "stay-paid",
        status: "paid",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        created_at: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      };
      const state = evaluatePendingCheckoutState(paidStay, null, now);
      expect(state).toBe("CONFIRMED_PAID");
      expect(isCheckoutEligibleForExpiration(paidStay, null, now)).toBe(false);
    });

    it("E. Team registration with accommodation passes both delegates and stays cleanly", async () => {
      const payload = {
        name: "Team Leader",
        email: authenticatedEmail,
        phone: "9876543210",
        college: "Punjab Engineering College",
        gender: "male",
        state: "Chandigarh",
        idCardStoragePath: `${authenticatedEmail}/lead.jpg`,
        events: [
          {
            eventId: "33333333-3333-4333-a333-333333333333",
            team: "PEC Innovators",
            isTeamHead: true,
            members: [
              { name: "Teammate One", email: "pec1@example.com", phone: "9876543211", gender: "male", state: "Chandigarh" },
            ],
          },
        ],
        accommodations: [
          { email: authenticatedEmail, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: "pec1@example.com", planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      };

      const req = createJsonPostRequest("/api/register", payload);
      const res = await postRegister(req);
      const json = await res.json();

      expect([200, 201]).toContain(res.status);
      expect(json.success).toBe(true);
      expect(mockRpcCalls[0].params.p_accommodations.length).toBe(2);
      expect(mockRpcCalls[0].params.p_accommodations[0].email).toBe(authenticatedEmail);
      expect(mockRpcCalls[0].params.p_accommodations[1].email).toBe("pec1@example.com");
    });
  });
});
