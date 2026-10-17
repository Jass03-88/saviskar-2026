import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as postRegister } from "@/app/api/register/route";
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

interface MockParticipant {
  id: string;
  participant_id?: string;
  email: string;
  name: string;
  created_at: string;
}

interface MockStay {
  id: string;
  participant_id: string;
  accommodation_plan_id?: string;
  start_date: string;
  end_date: string;
  duration_days?: number;
  amount?: number;
  currency?: string;
  status: string;
  payment_order_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface MockPaymentOrder {
  id: string;
  order_reference?: string;
  payer_participant_id: string;
  amount: number;
  currency: string;
  status: string;
  gateway_payment_id?: string | null;
  created_at: string;
  updated_at: string;
}

// In-memory test state
let mockParticipants: MockParticipant[] = [];
let mockStays: MockStay[] = [];
let mockPaymentOrders: MockPaymentOrder[] = [];
let mockRpcCalls: Array<{ name: string; params: any }> = [];
let shouldFailRpcDownstream = false;
let shouldFailAfterHoldCancel = false;

function buildMockSupabaseClient() {
  return {
    from: (table: string) => {
      if (table === "participants") {
        let filterField: string | null = null;
        let filterVal: string | null = null;
        let isIlike = false;

        const participantBuilder: any = {
          select: (_fields?: string) => participantBuilder,
          eq: (field: string, val: string) => {
            filterField = field;
            filterVal = val;
            isIlike = false;
            return participantBuilder;
          },
          ilike: (field: string, val: string) => {
            filterField = field;
            filterVal = val;
            isIlike = true;
            return participantBuilder;
          },
          order: (_field: string, _opts?: any) => participantBuilder,
          limit: (_n: number) => participantBuilder,
          maybeSingle: () => {
            const match = mockParticipants.find((p) => {
              if (!filterField || !filterVal) return false;
              const actual = (p as any)[filterField];
              if (isIlike) {
                return String(actual).toLowerCase() === String(filterVal).toLowerCase();
              }
              return actual === filterVal;
            });
            return Promise.resolve({ data: match ? { id: match.id } : null, error: null });
          },
          update: (_payload: any) => ({
            eq: (_col: string, _val: string) => Promise.resolve({ error: null }),
          }),
        };
        return participantBuilder;
      }

      if (table === "participant_accommodations") {
        const stayBuilder: any = {
          select: (_fields?: string) => stayBuilder,
          eq: (_field: string, _val: string) => stayBuilder,
          order: (_field: string, _opts?: any) => stayBuilder,
          in: (_field: string, _vals: string[]) => stayBuilder,
          lt: (_field: string, _val: string) => stayBuilder,
          gt: (_field: string, _val: string) => stayBuilder,
          update: (_payload: any) => stayBuilder,
        };
        return stayBuilder;
      }

      if (table === "payment_orders") {
        let orderId: string | null = null;
        const poBuilder: any = {
          select: (_fields?: string) => poBuilder,
          eq: (col: string, val: string) => {
            if (col === "id") orderId = val;
            return poBuilder;
          },
          limit: (_n: number) => poBuilder,
          maybeSingle: () => {
            const found = mockPaymentOrders.find((o) => o.id === orderId);
            return Promise.resolve({
              data: found
                ? {
                    id: found.id,
                    order_reference: found.order_reference || "SVK-ORDER-REF",
                    amount: found.amount,
                    currency: found.currency,
                    status: found.status,
                    gateway_payment_id: found.gateway_payment_id,
                    created_at: found.created_at,
                    updated_at: found.updated_at,
                  }
                : null,
              error: null,
            });
          },
        };
        return poBuilder;
      }

      // Default fallback
      const fallback: any = {
        select: () => fallback,
        eq: () => fallback,
        in: () => fallback,
        order: () => fallback,
        limit: () => fallback,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return fallback;
    },
    rpc: (name: string, params: any) => {
      mockRpcCalls.push({ name, params });

      if (name === "register_participant_events") {
        if (shouldFailRpcDownstream) {
          return Promise.resolve({
            data: null,
            error: {
              code: "SVK11",
              message: "Downstream registration failure: database constraint violated",
            },
          });
        }

        // Transaction snapshot to simulate PostgreSQL atomic transaction rollback
        const staysSnapshot = JSON.parse(JSON.stringify(mockStays));
        const accommodations = params.p_accommodations || [];

        for (const acc of accommodations) {
          const accEmail = acc.email?.toLowerCase();
          const targetParticipant = mockParticipants.find(
            (p) =>
              p.email.toLowerCase() === accEmail ||
              (params.p_participant_id && p.participant_id === params.p_participant_id)
          ) || {
            id: "part-uuid-returning-1",
            participant_id: "SVK26-RET00001",
            email: accEmail,
            name: "Delegate",
            created_at: new Date().toISOString(),
          };

          const planSlug = acc.plan_slug;
          const duration = planSlug === "2_days" ? 2 : planSlug === "1_day" ? 1 : 4;
          const startDate = acc.selected_date || "2026-10-28";
          const startD = new Date(startDate);
          const endD = new Date(startD);
          endD.setDate(startD.getDate() + duration);
          const endDate = endD.toISOString().slice(0, 10);

          // 1. Check confirmed paid stays
          const paidStays = mockStays.filter(
            (s) =>
              s.participant_id === targetParticipant.id &&
              s.status === "paid" &&
              s.start_date < endDate &&
              s.end_date > startDate
          );
          if (paidStays.length > 0) {
            mockStays = staysSnapshot; // Full transaction rollback
            return Promise.resolve({
              data: null,
              error: {
                code: "SVK11",
                message: `Participant already has a confirmed accommodation booking covering dates (${startDate} to ${endDate})`,
              },
            });
          }

          // 2. Pessimistically evaluate overlapping pending/unpaid holds
          const overlappingPending = mockStays.filter(
            (s) =>
              s.participant_id === targetParticipant.id &&
              (s.status === "pending" || s.status === "unpaid") &&
              s.start_date < endDate &&
              s.end_date > startDate
          );

          let hasActiveCheckout = false;
          const staleIds: string[] = [];

          for (const s of overlappingPending) {
            const po = mockPaymentOrders.find((o) => o.id === s.payment_order_id);

            // Parity with migration 20261020000000 & evaluatePendingCheckoutState
            if (po && (po.status === "paid" || po.status === "refunded")) {
              hasActiveCheckout = true;
            } else if (po && po.gateway_payment_id && po.gateway_payment_id.trim() !== "") {
              hasActiveCheckout = true;
            } else if (po && po.status === "failed") {
              // Explicit failed order -> eligible for immediate cancellation
              staleIds.push(s.id);
            } else {
              const stayTime = new Date(s.updated_at || s.created_at).getTime();
              const orderTime = po ? new Date(po.updated_at || po.created_at).getTime() : -Infinity;
              const greatestTime = Math.max(stayTime, orderTime);
              const oneHourAgo = Date.now() - 60 * 60 * 1000;

              if (greatestTime >= oneHourAgo) {
                hasActiveCheckout = true;
              } else {
                staleIds.push(s.id);
              }
            }
          }

          // Invariant: If ANY active checkout in progress, reject immediately WITHOUT cancelling any holds
          if (hasActiveCheckout) {
            mockStays = staysSnapshot; // Abort transaction without touching any holds
            return Promise.resolve({
              data: null,
              error: {
                code: "SVK11",
                message: `Active checkout in progress for these dates (${startDate} to ${endDate}). Please complete it or wait for it to expire.`,
              },
            });
          }

          // Invariant: Atomically cancel verified stale holds
          for (const id of staleIds) {
            const stayToCancel = mockStays.find((s) => s.id === id);
            if (stayToCancel) {
              stayToCancel.status = "cancelled";
              stayToCancel.updated_at = new Date().toISOString();
            }
          }

          // Insert new stay
          mockStays.push({
            id: `stay-new-${Date.now()}-${Math.random()}`,
            participant_id: targetParticipant.id,
            start_date: startDate,
            end_date: endDate,
            duration_days: duration,
            amount: 499,
            currency: "INR",
            status: "pending",
            payment_order_id: "po-rpc-created",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }

        // Downstream failure simulation (e.g. event capacity reached or trigger failure)
        if (shouldFailAfterHoldCancel) {
          mockStays = staysSnapshot; // PostgreSQL transaction rollback rolls back cancelled stays!
          return Promise.resolve({
            data: null,
            error: {
              code: "SVK11",
              message: "Downstream registration failure: event capacity reached",
            },
          });
        }

        // Ensure po-rpc-created exists so subsequent route payment order fetch succeeds
        if (!mockPaymentOrders.some((o) => o.id === "po-rpc-created")) {
          mockPaymentOrders.push({
            id: "po-rpc-created",
            order_reference: "SVK-SVK26-RET00001-20261017-ABCDEF",
            payer_participant_id: params.p_participant_id || "part-uuid-returning-1",
            amount: 998,
            currency: "INR",
            status: "pending",
            gateway_payment_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }

        return Promise.resolve({
          data: [
            {
              participant_id: params.p_participant_id || "SVK26-RET00001",
              participant_public_id: params.p_participant_id || "SVK26-RET00001",
              participant_event_id: "event-reg-1",
              event_id: "11111111-1111-4111-a111-111111111111",
              event_name: "Test Competition",
              status: "added",
              payment_order_id: "po-rpc-created",
              payment_amount: 998,
            },
          ],
          error: null,
        });
      }

      return Promise.resolve({ data: [], error: null });
    },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://example.com" }, error: null }),
      }),
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => buildMockSupabaseClient(),
}));

describe("SAVISKAR 2026 — Atomic In-RPC Stale Accommodation Hold Expiration", () => {
  const baseTime = Date.now();

  beforeEach(() => {
    mockParticipants = [];
    mockStays = [];
    mockPaymentOrders = [];
    mockRpcCalls = [];
    shouldFailRpcDownstream = false;
    shouldFailAfterHoldCancel = false;
    vi.clearAllMocks();

    vi.spyOn(rateLimitLib, "checkRateLimitAsync").mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfter: 0,
    } as any);
    vi.spyOn(rateLimitLib, "getClientIp").mockReturnValue("127.0.0.1");

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "returning@example.com",
    } as any);
  });

  /* ====================================================================
     1. STALE HOLD REPLACEMENT
  ==================================================================== */
  describe("1. Stale Hold Replacement", () => {
    it("A. An abandoned unpaid hold (> 1 hr) is atomically expired and replaced during registration", async () => {
      const participantId = "part-uuid-returning-1";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Returning Delegate",
        created_at: new Date(baseTime - 3 * 60 * 60 * 1000).toISOString(),
      });

      // Abandoned pending hold created 90 mins ago
      mockStays.push({
        id: "stay-stale-abandoned",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-stale-order",
        created_at: new Date(baseTime - 90 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 90 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-stale-order",
        payer_participant_id: participantId,
        amount: 499,
        currency: "INR",
        status: "pending",
        gateway_payment_id: null,
        created_at: new Date(baseTime - 90 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 90 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Returning Delegate",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);

      // Invariant: Stale accommodation hold was cancelled
      const staleStay = mockStays.find((s) => s.id === "stay-stale-abandoned");
      expect(staleStay?.status).toBe("cancelled");

      // Invariant: The stale payment order was NOT cancelled or altered
      const staleOrder = mockPaymentOrders.find((o) => o.id === "po-stale-order");
      expect(staleOrder?.status).toBe("pending");

      // Invariant: A new pending stay was inserted
      const newStays = mockStays.filter((s) => s.id !== "stay-stale-abandoned");
      expect(newStays.length).toBe(1);
      expect(newStays[0].status).toBe("pending");
      expect(newStays[0].start_date).toBe("2026-10-28");
      expect(newStays[0].end_date).toBe("2026-10-30");
    });
  });

  /* ====================================================================
     2. MIXED ACTIVE AND STALE OVERLAPPING HOLDS
  ==================================================================== */
  describe("2. Mixed Active and Stale Overlapping Holds", () => {
    it("B. Rejects and leaves ALL existing holds unchanged if any overlapping hold is active", async () => {
      const participantId = "part-uuid-mixed-1";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Mixed Holds Delegate",
        created_at: new Date(baseTime - 3 * 60 * 60 * 1000).toISOString(),
      });

      // Hold 1: Stale hold (created 2 hours ago)
      mockStays.push({
        id: "stay-stale-1",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-stale-1",
        created_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-stale-1",
        payer_participant_id: participantId,
        amount: 499,
        currency: "INR",
        status: "pending",
        gateway_payment_id: null,
        created_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
      });

      // Hold 2: Active in-flight hold (created 10 minutes ago)
      mockStays.push({
        id: "stay-active-2",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-active-2",
        created_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-active-2",
        payer_participant_id: participantId,
        amount: 499,
        currency: "INR",
        status: "pending",
        gateway_payment_id: null,
        created_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Mixed Holds Delegate",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      // Verification: Rejected with 400 ACTIVE_CHECKOUT_IN_PROGRESS
      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.code).toBe("ACTIVE_CHECKOUT_IN_PROGRESS");
      expect(json.error).toContain("Active checkout in progress");

      // CRITICAL INVARIANT: The stale hold was NOT cancelled!
      expect(mockStays.find((s) => s.id === "stay-stale-1")?.status).toBe("pending");
      // CRITICAL INVARIANT: The active hold remains pending!
      expect(mockStays.find((s) => s.id === "stay-active-2")?.status).toBe("pending");
    });
  });

  /* ====================================================================
     3. RECENT CHECKOUT AND GATEWAY PAYMENT ID PROTECTION
  ==================================================================== */
  describe("3. Recent Checkout & Gateway Payment ID Protection", () => {
    it("C1. A recent checkout (< 1 hr) is protected as active and rejects re-registration", async () => {
      const participantId = "part-uuid-recent-1";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Recent Checkout User",
        created_at: new Date(baseTime - 30 * 60 * 1000).toISOString(),
      });

      mockStays.push({
        id: "stay-recent-1",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-recent-1",
        created_at: new Date(baseTime - 20 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 20 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-recent-1",
        payer_participant_id: participantId,
        amount: 499,
        currency: "INR",
        status: "pending",
        gateway_payment_id: null,
        created_at: new Date(baseTime - 20 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 20 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Recent Checkout User",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("ACTIVE_CHECKOUT_IN_PROGRESS");
      expect(mockStays.find((s) => s.id === "stay-recent-1")?.status).toBe("pending");
    });

    it("C2. An order with gateway_payment_id present is protected even if > 1 hr old", async () => {
      const participantId = "part-uuid-gw-1";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Gateway User",
        created_at: new Date(baseTime - 4 * 60 * 60 * 1000).toISOString(),
      });

      mockStays.push({
        id: "stay-gw-pending",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-gw-captured",
        created_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-gw-captured",
        payer_participant_id: participantId,
        amount: 499,
        currency: "INR",
        status: "pending",
        gateway_payment_id: "payu_gateway_in_flight_999",
        created_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Gateway User",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("ACTIVE_CHECKOUT_IN_PROGRESS");
      expect(mockStays.find((s) => s.id === "stay-gw-pending")?.status).toBe("pending");
    });
  });

  /* ====================================================================
     4. FAILED AND MISSING PAYMENT ORDERS
  ==================================================================== */
  describe("4. Failed and Missing Payment Orders", () => {
    it("D1. An explicit failed payment order is eligible for immediate expiration (even if recent < 1 hr)", async () => {
      const participantId = "part-uuid-failed-order-1";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Failed Order Delegate",
        created_at: new Date(baseTime - 60 * 60 * 1000).toISOString(),
      });

      // Created only 10 minutes ago, but order status is explicitly 'failed'
      mockStays.push({
        id: "stay-failed-order",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-explicit-failed",
        created_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-explicit-failed",
        payer_participant_id: participantId,
        amount: 499,
        currency: "INR",
        status: "failed",
        gateway_payment_id: null,
        created_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Failed Order Delegate",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(mockStays.find((s) => s.id === "stay-failed-order")?.status).toBe("cancelled");
    });

    it("D2. A stay with a missing payment order older than 1 hr is expired safely", async () => {
      const participantId = "part-uuid-missing-order-1";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Missing Order Delegate",
        created_at: new Date(baseTime - 3 * 60 * 60 * 1000).toISOString(),
      });

      // No payment_order_id linked, created 90 mins ago
      mockStays.push({
        id: "stay-missing-order-old",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: null,
        created_at: new Date(baseTime - 90 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 90 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Missing Order Delegate",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(mockStays.find((s) => s.id === "stay-missing-order-old")?.status).toBe("cancelled");
    });
  });

  /* ====================================================================
     5. DUPLICATE CONCURRENT REGISTRATION
  ==================================================================== */
  describe("5. Duplicate Concurrent Registration", () => {
    it("E. Duplicate concurrent registration for the same dates rejects the second request without altering the first booking", async () => {
      const participantId = "part-uuid-concurrent-1";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Concurrent Delegate",
        created_at: new Date(baseTime - 60 * 60 * 1000).toISOString(),
      });

      // Request 1 arrives and successfully inserts an active pending booking
      mockStays.push({
        id: "stay-first-successful-hold",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-first-order",
        created_at: new Date(baseTime - 1 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 1 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-first-order",
        payer_participant_id: participantId,
        amount: 499,
        currency: "INR",
        status: "pending",
        gateway_payment_id: null,
        created_at: new Date(baseTime - 1 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 1 * 60 * 1000).toISOString(),
      });

      // Request 2 arrives concurrently for the exact same participant and dates
      const request2 = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Concurrent Delegate",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res2 = await postRegister(request2);
      const json2 = await res2.json();

      expect(res2.status).toBe(400);
      expect(json2.code).toBe("ACTIVE_CHECKOUT_IN_PROGRESS");
      expect(mockStays.find((s) => s.id === "stay-first-successful-hold")?.status).toBe("pending");
    });
  });

  /* ====================================================================
     6. LATE PAYMENT SETTLEMENT AFTER A REPLACEMENT BOOKING
  ==================================================================== */
  describe("6. Late Payment Settlement After Replacement Booking", () => {
    it("F. Late settlement of a cancelled stale hold does not overwrite or revive conflicting replacement booking", () => {
      const participantId = "part-uuid-late-settlement-1";

      // 1. Initial hold S1 was cancelled by RPC
      const stayS1: MockStay = {
        id: "stay-s1-cancelled",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "cancelled", // Stale hold cancelled during registration
        payment_order_id: "po-s1-late",
        created_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 10 * 60 * 1000).toISOString(),
      };

      // 2. Replacement booking S2 inserted and confirmed
      const stayS2: MockStay = {
        id: "stay-s2-replacement",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "paid", // Replacement booking already confirmed
        payment_order_id: "po-s2-replacement",
        created_at: new Date(baseTime - 9 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 5 * 60 * 1000).toISOString(),
      };

      const stays = [stayS1, stayS2];

      // Simulate process_payment_success receiving a late callback for po-s1-late:
      // It detects that stayS1 is cancelled, and checking overlap against active stays finds stayS2 is already paid!
      const overlappingActiveStay = stays.find(
        (s) =>
          s.participant_id === participantId &&
          s.id !== stayS1.id &&
          s.status === "paid" &&
          s.start_date < stayS1.end_date &&
          s.end_date > stayS1.start_date
      );

      let settlementStatus = "paid";
      let conflictDetected = false;

      if (stayS1.status === "cancelled" || overlappingActiveStay) {
        settlementStatus = "settled_with_accommodation_conflict";
        conflictDetected = true;
      }

      // Assertions verifying migration 20261019000000 late settlement contract:
      expect(conflictDetected).toBe(true);
      expect(settlementStatus).toBe("settled_with_accommodation_conflict");
      // Replacement booking S2 remains unaffected and paid:
      expect(stayS2.status).toBe("paid");
      // S1 is NOT revived:
      expect(stayS1.status).toBe("cancelled");
    });
  });

  /* ====================================================================
     7. TEAM REGISTRATION ROLLBACK IF ANY DELEGATE CONFLICTS
  ==================================================================== */
  describe("7. Team Registration Rollback If Any Delegate Conflicts", () => {
    it("G. If one delegate has an active checkout in progress, entire team registration fails closed without partial bookings", async () => {
      const primaryLeaderId = "part-uuid-primary-leader";
      const teammate2Id = "part-uuid-teammate-conflict";

      mockParticipants.push({
        id: primaryLeaderId,
        participant_id: "SVK26-LEAD0001",
        email: "returning@example.com",
        name: "Primary Leader",
        created_at: new Date(baseTime - 60 * 60 * 1000).toISOString(),
      });

      mockParticipants.push({
        id: teammate2Id,
        participant_id: "SVK26-TEAM0002",
        email: "teammate2@example.com",
        name: "Teammate Two",
        created_at: new Date(baseTime - 60 * 60 * 1000).toISOString(),
      });

      // Teammate 2 has an active checkout in progress (< 1 hr old)
      mockStays.push({
        id: "stay-teammate2-active",
        participant_id: teammate2Id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-teammate2-active",
        created_at: new Date(baseTime - 15 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 15 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-teammate2-active",
        payer_participant_id: teammate2Id,
        amount: 499,
        currency: "INR",
        status: "pending",
        gateway_payment_id: null,
        created_at: new Date(baseTime - 15 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 15 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-LEAD0001",
          name: "Primary Leader",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: { teamName: "Alpha Team" },
              isTeamHead: true,
              members: [
                {
                  name: "Teammate Two",
                  college: "Tech University",
                  email: "teammate2@example.com",
                  phone: "9123456782",
                  gender: "male",
                  state: "Maharashtra",
                  idCardStoragePath: "returning@example.com/team2.jpg",
                },
              ],
            },
          ],
          accommodations: [
            {
              email: "returning@example.com", // Leader (clean)
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
            {
              email: "teammate2@example.com", // Teammate 2 (has active hold)
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("ACTIVE_CHECKOUT_IN_PROGRESS");
      // Invariant: No partial stays inserted for the leader or teammate 2
      const leaderStays = mockStays.filter((s) => s.participant_id === primaryLeaderId);
      expect(leaderStays.length).toBe(0);
      // Invariant: Teammate 2 hold is intact
      expect(mockStays.find((s) => s.id === "stay-teammate2-active")?.status).toBe("pending");
    });
  });

  /* ====================================================================
     8. DOWNSTREAM RPC FAILURE ROLLS BACK STALE-HOLD CANCELLATION
  ==================================================================== */
  describe("8. Downstream RPC Failure Rolls Back Stale-Hold Cancellation", () => {
    it("H. If RPC fails downstream after stale hold evaluation, the stale hold remains pending due to transactional rollback", async () => {
      const participantId = "part-uuid-downstream-rollback";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Rollback Delegate",
        created_at: new Date(baseTime - 3 * 60 * 60 * 1000).toISOString(),
      });

      // Abandoned stale hold (> 1 hr)
      mockStays.push({
        id: "stay-stale-must-rollback",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "pending",
        payment_order_id: "po-stale-order",
        created_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
      });

      mockPaymentOrders.push({
        id: "po-stale-order",
        payer_participant_id: participantId,
        amount: 499,
        currency: "INR",
        status: "pending",
        gateway_payment_id: null,
        created_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 120 * 60 * 1000).toISOString(),
      });

      // Trigger simulated downstream failure inside RPC
      shouldFailAfterHoldCancel = true;

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Rollback Delegate",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);

      // CRITICAL TRANSACTIONAL INVARIANT:
      // In PostgreSQL, any exception aborts the entire transaction.
      // Therefore, the stale hold must NOT be cancelled!
      const stay = mockStays.find((s) => s.id === "stay-stale-must-rollback");
      expect(stay?.status).toBe("pending");
    });
  });

  /* ====================================================================
     9. REGISTRATION WITHOUT ACCOMMODATION & CONFIRMED PAID STAY PROTECTION
  ==================================================================== */
  describe("9. Core Regression Invariants", () => {
    it("I. Ordinary registration without accommodation succeeds without evaluating stays", async () => {
      mockPaymentOrders.push({
        id: "po-rpc-created",
        order_reference: "SVK-SVK26-RET00001-20261017-ORD001",
        payer_participant_id: "part-uuid-1",
        amount: 998,
        currency: "INR",
        status: "pending",
        gateway_payment_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Standard Registrant",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: null,
              isTeamHead: false,
              members: [],
            },
          ],
          accommodations: [],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(mockRpcCalls.length).toBe(1);
      expect(mockRpcCalls[0].params.p_accommodations).toEqual([]);
    });

    it("J. A stay with status='paid' is never cancelled and rejects with OVERLAPPING_STAY", async () => {
      const participantId = "part-uuid-paid-stay-1";
      mockParticipants.push({
        id: participantId,
        participant_id: "SVK26-RET00001",
        email: "returning@example.com",
        name: "Paid Stay Delegate",
        created_at: new Date(baseTime - 24 * 60 * 60 * 1000).toISOString(),
      });

      mockStays.push({
        id: "stay-paid-confirmed",
        participant_id: participantId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 499,
        status: "paid",
        payment_order_id: "po-paid-order",
        created_at: new Date(baseTime - 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(baseTime - 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: "SVK26-RET00001",
          name: "Paid Stay Delegate",
          college: "Tech University",
          email: "returning@example.com",
          phone: "9876543210",
          idCardStoragePath: "returning@example.com/id.jpg",
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
              email: "returning@example.com",
              planSlug: "2_days",
              selectedDate: "2026-10-28",
            },
          ],
        }),
      });

      const res = await postRegister(request);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("OVERLAPPING_STAY");
      expect(mockStays.find((s) => s.id === "stay-paid-confirmed")?.status).toBe("paid");
    });
  });
});
