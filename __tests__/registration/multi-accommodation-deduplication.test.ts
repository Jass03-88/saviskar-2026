import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as postRegister } from "@/app/api/register/route";
import { calculateStayDates } from "@/lib/accommodation-dates";
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

// Configure test environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-test.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

let mockRpcCalls: Array<{ name: string; params: any }> = [];

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
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return builder;
    },
    rpc: (name: string, params: any) => {
      mockRpcCalls.push({ name, params });
      return Promise.resolve({
        data: [
          {
            participant_id: "SVK26-ABC12345",
            participant_public_id: "SVK26-ABC12345",
            participant_event_id: "11111111-2222-3333-4444-555555555555",
            event_id: "11111111-1111-4111-a111-111111111111",
            event_name: "Test Competition",
            status: "added",
            payment_order_id: "po-12345",
            payment_amount: 998,
          },
        ],
        error: null,
      });
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

describe("SAVISKAR 2026 — Multi-Stay Accommodation Deduplication & Overlap Suite", () => {
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
      email: "primary@example.com",
    } as any);
  });

  // ─────────────────────────────────────────────────────────────
  // 1. UNIT TESTS: calculateStayDates
  // ─────────────────────────────────────────────────────────────
  describe("1. calculateStayDates Helper Logic", () => {
    it("A. Correctly calculates 1-day stay dates across all 4 festival days", () => {
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

    it("B. Correctly calculates 2-day standard stay (28th–30th)", () => {
      expect(calculateStayDates("2_days")).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-30",
        durationDays: 2,
      });
    });

    it("C. Correctly calculates 3-day early arrival (27th–30th)", () => {
      expect(calculateStayDates("3_days", "2026-10-27", "before_27")).toEqual({
        startDate: "2026-10-27",
        endDate: "2026-10-30",
        durationDays: 3,
      });
    });

    it("D. Correctly calculates 3-day extended stay (28th–31st)", () => {
      expect(calculateStayDates("3_days", "2026-10-30", "after_30")).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-31",
        durationDays: 3,
      });
    });

    it("E. Correctly calculates 4-day full festival stay (27th–31st)", () => {
      expect(calculateStayDates("4_days", "2026-10-27", "both")).toEqual({
        startDate: "2026-10-27",
        endDate: "2026-10-31",
        durationDays: 4,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. ROUTE TESTS: Multi-Stay Accommodation Deduplication
  // ─────────────────────────────────────────────────────────────
  describe("2. Registration Route Accommodation Normalization & RPC Delivery", () => {
    it("A. Submitting two distinct non-overlapping stays for the same email passes BOTH to RPC", async () => {
      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Primary Participant",
          college: "Engineering College",
          email: "primary@example.com",
          phone: "9876543210",
          idCardStoragePath: "primary@example.com/id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: null,
              isTeamHead: false,
              members: [],
            },
          ],
          accommodations: [
            {
              email: "primary@example.com",
              planSlug: "1_day",
              selectedDate: "2026-10-27", // Oct 27 - Oct 28
            },
            {
              email: "primary@example.com",
              planSlug: "1_day",
              selectedDate: "2026-10-30", // Oct 30 - Oct 31
            },
          ],
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(201);

      // Verify that RPC was called with both accommodations
      expect(mockRpcCalls.length).toBe(1);
      const passedAccommodations = mockRpcCalls[0].params.p_accommodations;
      expect(passedAccommodations.length).toBe(2);
      expect(passedAccommodations[0]).toEqual({
        email: "primary@example.com",
        plan_slug: "1_day",
        selected_date: "2026-10-27",
        extra_days: undefined,
      });
      expect(passedAccommodations[1]).toEqual({
        email: "primary@example.com",
        plan_slug: "1_day",
        selected_date: "2026-10-30",
        extra_days: undefined,
      });
    });

    it("B. Submitting consecutive non-overlapping stays for the same email passes BOTH to RPC", async () => {
      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Primary Participant",
          college: "Engineering College",
          email: "primary@example.com",
          phone: "9876543210",
          idCardStoragePath: "primary@example.com/id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: null,
              isTeamHead: false,
              members: [],
            },
          ],
          accommodations: [
            {
              email: "primary@example.com",
              planSlug: "1_day",
              selectedDate: "2026-10-27", // Oct 27 - Oct 28
            },
            {
              email: "primary@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28", // Oct 28 - Oct 30 (Consecutive!)
            },
          ],
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(201);

      expect(mockRpcCalls.length).toBe(1);
      const passedAccommodations = mockRpcCalls[0].params.p_accommodations;
      expect(passedAccommodations.length).toBe(2);
      expect(passedAccommodations[0].selected_date).toBe("2026-10-27");
      expect(passedAccommodations[1].selected_date).toBe("2026-10-28");
    });

    it("C. Duplicate representation of the same teammate and same stay is deduplicated without double charge", async () => {
      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Leader",
          college: "Engineering College",
          email: "primary@example.com",
          phone: "9876543210",
          idCardStoragePath: "primary@example.com/id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: "Team A",
              isTeamHead: true,
              members: [
                {
                  name: "Teammate Bob",
                  email: "bob@example.com",
                  phone: "9876543211",
                  gender: "male",
                  state: "Punjab",
                  idCardStoragePath: "bob/id.jpg",
                },
              ],
            },
          ],
          // Two identical accommodations pushed for Bob (e.g. from multiple team event loops)
          accommodations: [
            {
              email: "bob@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
            {
              email: "bob@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(201);

      // Verify that Bob's duplicate accommodation was deduplicated to exactly 1 entry
      expect(mockRpcCalls.length).toBe(1);
      const passedAccommodations = mockRpcCalls[0].params.p_accommodations;
      expect(passedAccommodations.length).toBe(1);
      expect(passedAccommodations[0].email).toBe("bob@example.com");
      expect(passedAccommodations[0].plan_slug).toBe("2_days");
    });

    it("D. Equivalent stays with differing syntax (2_days + before_27 vs 3_days + 2026-10-27) are deduplicated", async () => {
      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Leader",
          college: "Engineering College",
          email: "primary@example.com",
          phone: "9876543210",
          idCardStoragePath: "primary@example.com/id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: null,
              isTeamHead: false,
              members: [],
            },
          ],
          accommodations: [
            {
              email: "bob@example.com",
              planSlug: "2_days",
              extraDays: "before_27", // Resolves to 3_days (Oct 27 - Oct 30)
            },
            {
              email: "bob@example.com",
              planSlug: "3_days",
              selectedDate: "2026-10-27", // Also resolves to 3_days (Oct 27 - Oct 30)
            },
          ],
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(201);

      expect(mockRpcCalls.length).toBe(1);
      const passedAccommodations = mockRpcCalls[0].params.p_accommodations;
      expect(passedAccommodations.length).toBe(1);
    });

    it("E. Overlapping stays for the same email are REJECTED with 400 before calling RPC", async () => {
      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Primary Participant",
          college: "Engineering College",
          email: "primary@example.com",
          phone: "9876543210",
          idCardStoragePath: "primary@example.com/id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: null,
              isTeamHead: false,
              members: [],
            },
          ],
          accommodations: [
            {
              email: "primary@example.com",
              planSlug: "2_days", // Oct 28 - Oct 30
              selectedDate: "2026-10-28",
            },
            {
              email: "primary@example.com",
              planSlug: "1_day", // Oct 29 - Oct 30 (OVERLAPS ON 29th!)
              selectedDate: "2026-10-29",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("overlap");
      expect(json.error).toContain("primary@example.com");

      // Verify ZERO RPC calls were executed (no payment order created)
      expect(mockRpcCalls.length).toBe(0);
    });

    it("F. Different teammates with distinct emails remain independently accepted", async () => {
      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Leader",
          college: "Engineering College",
          email: "primary@example.com",
          phone: "9876543210",
          idCardStoragePath: "primary@example.com/id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: "Team A",
              isTeamHead: true,
              members: [],
            },
          ],
          accommodations: [
            {
              email: "alice@example.com",
              planSlug: "1_day",
              selectedDate: "2026-10-28",
            },
            {
              email: "bob@example.com",
              planSlug: "1_day",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(201);

      expect(mockRpcCalls.length).toBe(1);
      const passedAccommodations = mockRpcCalls[0].params.p_accommodations;
      expect(passedAccommodations.length).toBe(2);
      expect(passedAccommodations.map((a: any) => a.email)).toEqual([
        "alice@example.com",
        "bob@example.com",
      ]);
    });

    it("G. Accommodation-only registration supports multiple non-overlapping stays", async () => {
      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Returning Delegate",
          college: "Engineering College",
          email: "primary@example.com",
          phone: "9876543210",
          idCardStoragePath: "primary@example.com/id.jpg",
          events: [], // NO EVENTS: Accommodation-only registration!
          accommodations: [
            {
              email: "primary@example.com",
              planSlug: "1_day",
              selectedDate: "2026-10-27",
            },
            {
              email: "primary@example.com",
              planSlug: "1_day",
              selectedDate: "2026-10-30",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(201);

      expect(mockRpcCalls.length).toBe(1);
      const passedAccommodations = mockRpcCalls[0].params.p_accommodations;
      expect(passedAccommodations.length).toBe(2);
    });
  });
});
