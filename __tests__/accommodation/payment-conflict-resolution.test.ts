import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as resumePayment } from "@/app/api/payments/resume/route";
import { GET as getConflicts } from "@/app/api/admin/accommodations/conflicts/route";
import { GET as getAdminLogs } from "@/app/api/admin/logs/route";
import { createPaymentResumeToken } from "@/lib/payments/resume-token";

// In-memory mock DB fixtures
let mockOrder: Record<string, any> | null = null;
let mockPayer: Record<string, any> | null = null;
let mockOrderItems: Record<string, any>[] = [];
let mockAuditLogs: Record<string, any>[] = [];
let mockParticipants: Record<string, any>[] = [];
let mockAccommodations: Record<string, any>[] = [];
let mockAdminAuth: Record<string, any> = { error: null, role: "master", accommodation_access: true, user: { id: "admin-uuid-1" } };

vi.mock("@/lib/supabase/server", () => ({
  requireAdmin: vi.fn(() => Promise.resolve(mockAdminAuth)),
  requireMasterAdmin: vi.fn(() => Promise.resolve(mockAdminAuth.role === "master" ? mockAdminAuth : { error: "Forbidden", status: 403 })),
  requireAccommodationAdmin: vi.fn(() => Promise.resolve(mockAdminAuth.accommodation_access ? mockAdminAuth : { error: "Forbidden", status: 403 })),
}));

function makeThenableChain(overrideFn?: () => Promise<{ data: any; error: any; count?: number }>): any {
  const defaultResolve = () => (overrideFn ? overrideFn() : Promise.resolve({ data: null, error: null }));
  const chain: any = {
    then: (onFulfilled: any) => defaultResolve().then(onFulfilled),
    catch: () => chain,
    finally: () => chain,
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    filter: () => chain,
    limit: () => chain,
    order: () => chain,
    range: () => chain,
    maybeSingle: defaultResolve,
    single: defaultResolve,
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        getUserById: vi.fn(() => Promise.resolve({ data: { user: { email: "admin@saviskar.in" } } })),
      },
    },
    from: (table: string) => {
      if (table === "payment_orders") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockOrder, error: null }),
            }),
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: mockOrder ? [mockOrder] : [],
                error: null,
              }),
          }),
        };
      }
      if (table === "participants") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockPayer, error: null }),
            }),
            in: () =>
              Promise.resolve({
                data: mockParticipants,
                error: null,
              }),
          }),
        };
      }
      if (table === "payment_order_items") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: mockOrderItems, error: null }),
          }),
        };
      }
      if (table === "participant_accommodations") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => Promise.resolve({ data: mockAccommodations, error: null }),
            }),
            in: () => Promise.resolve({ data: mockAccommodations, error: null }),
          }),
        };
      }
      if (table === "participant_events") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === "admin_audit_logs") {
        return {
          select: (_cols: string, opts?: { count?: string }) => ({
            eq: (_col: string, val: string) => ({
              filter: () => ({
                limit: () =>
                  Promise.resolve({
                    data: mockAuditLogs.filter((l) => l.action_type === val),
                    error: null,
                  }),
              }),
              order: () => ({
                range: () =>
                  Promise.resolve({
                    data: mockAuditLogs.filter((l) => l.action_type === val),
                    count: mockAuditLogs.filter((l) => l.action_type === val).length,
                    error: null,
                  }),
              }),
            }),
            order: () => ({
              range: () =>
                Promise.resolve({
                  data: mockAuditLogs,
                  count: mockAuditLogs.length,
                  error: null,
                }),
            }),
          }),
        };
      }
      return {
        select: () => makeThenableChain(),
      };
    },
  }),
}));

describe("Phase 3: Accommodation Payment-Conflict Handling Safely", () => {
  const ORDER_ID = "po-1111-2222-3333-4444";
  const PAYER_UUID = "payer-uuid-1234";
  const PARTICIPANT_ID = "SVK26-A1B2C3D4";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYMENT_RESUME_TOKEN_SECRET = "test-token-secret-32-chars-long-123456";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret-key-32-chars-long-123456";
    mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "admin-uuid-1" } };
    mockPayer = {
      id: PAYER_UUID,
      participant_id: PARTICIPANT_ID,
      name: "Rohan Verma",
      college: "Thapar Institute",
      email: "rohan@example.com",
      phone: "9876543210",
    };
    mockOrder = {
      id: ORDER_ID,
      order_reference: "SVK-ORD-9999",
      payer_participant_id: PAYER_UUID,
      amount: 600,
      currency: "INR",
      status: "paid",
      created_at: new Date().toISOString(),
    };
    mockOrderItems = [];
    mockAuditLogs = [];
    mockParticipants = [mockPayer];
    mockAccommodations = [];
  });

  describe("1. Participant-Facing Payment-Conflict Notice (/api/payments/resume)", () => {
    it("normal paid accommodation booking does not display a conflict warning", async () => {
      // Normal paid accommodation
      mockOrderItems = [
        {
          id: "item-acc-1",
          amount: 600,
          item_type: "accommodation",
          participant_accommodation_id: "acc-uuid-1",
          participant_accommodations: {
            id: "acc-uuid-1",
            status: "paid",
            start_date: "2026-10-28",
            end_date: "2026-10-29",
            accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
          },
        },
      ];
      mockAccommodations = [
        {
          id: "acc-uuid-1",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          duration_days: 1,
          amount: 600,
          currency: "INR",
          status: "paid",
          accommodation_plans: { id: "plan-1", name: "1-Day Accommodation", slug: "1-day", duration: 1, price: 600 },
        },
      ];
      mockAuditLogs = [];

      const token = createPaymentResumeToken({
        paymentOrderId: ORDER_ID,
        participantId: PARTICIPANT_ID,
        payerParticipantUuid: PAYER_UUID,
      });

      const req = new NextRequest(`http://localhost/api/payments/resume?token=${encodeURIComponent(token)}`);
      const res = await resumePayment(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe("paid");
      expect(json.accommodationConflict).toBe(false);
      expect(json.accommodationConflictNotice).toBeNull();
      expect(json.registeredAccommodations.length).toBe(1);
    });

    it("confirmed paid order with verified accommodation conflict displays warning and notice", async () => {
      // Conflict scenario: Order is paid, but accommodation item has status 'cancelled'
      // and admin_audit_logs contains ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT
      mockOrderItems = [
        {
          id: "item-acc-1",
          amount: 600,
          item_type: "accommodation",
          participant_accommodation_id: "acc-uuid-conflict",
          participant_accommodations: {
            id: "acc-uuid-conflict",
            status: "cancelled",
            start_date: "2026-10-28",
            end_date: "2026-10-29",
            accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
          },
        },
      ];
      mockAccommodations = []; // Cancelled accommodation excluded from registeredAccommodations
      mockAuditLogs = [
        {
          id: "log-conflict-1",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-conflict",
          details: {
            participant_id: PAYER_UUID,
            payment_order_id: ORDER_ID,
            amount: 600,
            start_date: "2026-10-28",
            end_date: "2026-10-29",
            reason: "Late payment captured on gateway, but stay dates are already occupied.",
          },
          created_at: new Date().toISOString(),
        },
      ];

      const token = createPaymentResumeToken({
        paymentOrderId: ORDER_ID,
        participantId: PARTICIPANT_ID,
        payerParticipantUuid: PAYER_UUID,
      });

      const req = new NextRequest(`http://localhost/api/payments/resume?token=${encodeURIComponent(token)}`);
      const res = await resumePayment(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe("paid");
      expect(json.accommodationConflict).toBe(true);
      expect(json.accommodationConflictNotice).toBeDefined();
      expect(json.accommodationConflictNotice.headline).toBe("Accommodation Booking Unavailable");
      expect(json.accommodationConflictNotice.message).toContain("could not be confirmed");
      expect(json.accommodationConflictNotice.supportEmail).toBe("support@saviskar.co.in");
      expect(json.accommodationConflictNotice.supportPhone).toBeNull();
      expect(json.accommodationConflictNotice.message).toContain("support@saviskar.co.in");
      expect(json.accommodationConflictNotice.message).toContain(PARTICIPANT_ID);
      expect(json.accommodationConflictNotice.message).toContain("SVK-ORD-9999");
      expect(JSON.stringify(json)).not.toContain("98765 43210");
      expect(JSON.stringify(json)).not.toContain("support@saviskar.in");
      expect(json.accommodationConflictNotice.affectedStay).toEqual({
        planName: "1-Day Accommodation",
        startDate: "2026-10-28",
        endDate: "2026-10-29",
        amount: 600,
      });
    });

    it("an ordinary cancellation without conflict log is not incorrectly classified as a settlement conflict", async () => {
      // Order was paid, but accommodation item was cancelled manually without an overlap conflict log
      mockOrderItems = [
        {
          id: "item-acc-1",
          amount: 600,
          item_type: "accommodation",
          participant_accommodation_id: "acc-uuid-cancelled",
          participant_accommodations: {
            id: "acc-uuid-cancelled",
            status: "cancelled",
            start_date: "2026-10-28",
            end_date: "2026-10-29",
            accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
          },
        },
      ];
      mockAccommodations = [];
      mockAuditLogs = []; // NO conflict log exists

      const token = createPaymentResumeToken({
        paymentOrderId: ORDER_ID,
        participantId: PARTICIPANT_ID,
        payerParticipantUuid: PAYER_UUID,
      });

      const req = new NextRequest(`http://localhost/api/payments/resume?token=${encodeURIComponent(token)}`);
      const res = await resumePayment(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.accommodationConflict).toBe(false);
      expect(json.accommodationConflictNotice).toBeNull();
    });

    it("an empty accommodation array alone does not establish a conflict for event-only registrations", async () => {
      // Event-only order (no accommodation item)
      mockOrderItems = [
        {
          id: "item-event-1",
          amount: 150,
          item_type: "event",
          event_id: "event-1",
          events: { id: "event-1", name: "Roborace", category: "Technical", registration_type: "individual" },
        },
      ];
      mockAccommodations = [];
      mockAuditLogs = [];

      const token = createPaymentResumeToken({
        paymentOrderId: ORDER_ID,
        participantId: PARTICIPANT_ID,
        payerParticipantUuid: PAYER_UUID,
      });

      const req = new NextRequest(`http://localhost/api/payments/resume?token=${encodeURIComponent(token)}`);
      const res = await resumePayment(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.accommodationConflict).toBe(false);
      expect(json.accommodationConflictNotice).toBeNull();
      expect(json.registeredAccommodations.length).toBe(0);
    });

    it("existing resume responses remain backwards-compatible", async () => {
      const token = createPaymentResumeToken({
        paymentOrderId: ORDER_ID,
        participantId: PARTICIPANT_ID,
        payerParticipantUuid: PAYER_UUID,
      });

      const req = new NextRequest(`http://localhost/api/payments/resume?token=${encodeURIComponent(token)}`);
      const res = await resumePayment(req);
      const json = await res.json();

      expect(json).toHaveProperty("success");
      expect(json).toHaveProperty("status");
      expect(json).toHaveProperty("paymentOrderId");
      expect(json).toHaveProperty("orderReference");
      expect(json).toHaveProperty("amount");
      expect(json).toHaveProperty("currency");
      expect(json).toHaveProperty("participant");
      expect(json).toHaveProperty("items");
      expect(json).toHaveProperty("registeredCompetitions");
      expect(json).toHaveProperty("registeredAccommodations");
    });
  });

  describe("2. Dedicated Admin Conflict Endpoint (/api/admin/accommodations/conflicts)", () => {
    it("unauthenticated request is rejected with HTTP 401", async () => {
      mockAdminAuth = { error: "Unauthorized", status: 401 };

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it("unauthorized admin without accommodation access is rejected with HTTP 403", async () => {
      mockAdminAuth = { error: null, role: "admin", accommodation_access: false, user: { id: "scoped-admin" } };

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("Accommodation access required");
    });

    it("authorized admin receives sanitized conflict list with participant, order, and dates", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-uuid-101",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-101",
          details: {
            participant_id: PAYER_UUID,
            payment_order_id: ORDER_ID,
            amount: 600,
            start_date: "2026-10-28",
            end_date: "2026-10-29",
            reason: "Late payment conflict with existing active booking.",
          },
          created_at: new Date().toISOString(),
        },
      ];
      mockAccommodations = [
        {
          id: "acc-uuid-101",
          status: "cancelled",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          duration_days: 1,
          amount: 600,
          accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.conflicts.length).toBe(1);

      const conflict = json.conflicts[0];
      expect(conflict.id).toBe("log-uuid-101");
      expect(conflict.resolutionStatus).toBe("REQUIRES_MANUAL_VERIFICATION");
      expect(conflict.resolutionNotes).toContain("Payment captured on gateway");
      expect(conflict.participant.participantId).toBe(PARTICIPANT_ID);
      expect(conflict.participant.name).toBe("Rohan Verma");
      expect(conflict.participant.phone).toBe("9876543210");
      expect(conflict.paymentOrder.orderReference).toBe("SVK-ORD-9999");
      expect(conflict.paymentOrder.amount).toBe(600);
      expect(conflict.accommodation.planName).toBe("1-Day Accommodation");
      expect(conflict.accommodation.startDate).toBe("2026-10-28");
      expect(conflict.accommodation.endDate).toBe("2026-10-29");
    });

    it("cancelled original accommodation row does not automatically prove an alternative allocation", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-uuid-103",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-103",
          details: { participant_id: PAYER_UUID, payment_order_id: ORDER_ID, amount: 600 },
          created_at: new Date().toISOString(),
        },
      ];
      // Participant has only the cancelled row
      mockAccommodations = [
        {
          id: "acc-uuid-103",
          participant_id: PAYER_UUID,
          status: "cancelled",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          duration_days: 1,
          amount: 600,
          accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      const json = await res.json();
      expect(json.conflicts[0].resolutionStatus).toBe("REQUIRES_MANUAL_VERIFICATION");
      expect(json.conflicts[0].separateStay).toBeNull();
    });

    it("payment-order status marked refunded alone does not prove a gateway refund occurred", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockOrder!.status = "refunded";
      mockAuditLogs = [
        {
          id: "log-uuid-104",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-104",
          details: { participant_id: PAYER_UUID, payment_order_id: ORDER_ID, amount: 600 },
          created_at: new Date().toISOString(),
        },
      ];
      mockAccommodations = [
        {
          id: "acc-uuid-104",
          participant_id: PAYER_UUID,
          status: "cancelled",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          duration_days: 1,
          amount: 600,
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      const json = await res.json();
      // Must NOT claim "REFUNDED" as established fact; requires manual verification on PayU dashboard
      expect(json.conflicts[0].resolutionStatus).toBe("REQUIRES_MANUAL_VERIFICATION");
      expect(json.conflicts[0].resolutionNotes).toContain("Gateway refund must be independently verified on the PayU Merchant Dashboard");
    });

    it("separate paid stay with room assigned does not automatically resolve conflict and remains REQUIRES_MANUAL_VERIFICATION", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-uuid-105",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-conflicted",
          details: { participant_id: PAYER_UUID, payment_order_id: ORDER_ID, amount: 600 },
          created_at: new Date().toISOString(),
        },
      ];
      mockAccommodations = [
        // Original conflicted stay
        {
          id: "acc-uuid-conflicted",
          participant_id: PAYER_UUID,
          status: "cancelled",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          duration_days: 1,
          amount: 600,
        },
        // Separate confirmed stay with room allocated
        {
          id: "acc-uuid-separate-confirmed",
          participant_id: PAYER_UUID,
          status: "paid",
          start_date: "2026-10-29",
          end_date: "2026-10-30",
          duration_days: 1,
          amount: 600,
          hostel_id: "hostel-1",
          room_id: "room-204",
          hostels: { name: "Shivalik Hostel" },
          hostel_rooms: { room_number: "204" },
          accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      const json = await res.json();

      expect(json.conflicts[0].resolutionStatus).toBe("REQUIRES_MANUAL_VERIFICATION");
      expect(json.conflicts[0].separateStay).toBeDefined();
      expect(json.conflicts[0].separateStay.roomNumber).toBe("204");
      expect(json.conflicts[0].separateStay.hostelName).toBe("Shivalik Hostel");
      expect(json.conflicts[0].resolutionNotes).toContain("Another accommodation booking exists for this participant");
      expect(json.conflicts[0].resolutionNotes).toContain("Staff must verify the dates and determine whether this conflict requires an alternative stay or a refund");
    });

    it("a participant's unrelated historical paid stay does not resolve a newer conflict", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-uuid-hist",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-new-conflict",
          details: {
            participant_id: PAYER_UUID,
            payment_order_id: ORDER_ID,
            amount: 600,
            start_date: "2026-10-29",
            end_date: "2026-10-30",
          },
          created_at: new Date().toISOString(),
        },
      ];
      mockAccommodations = [
        // New conflicted stay (Day 2)
        {
          id: "acc-uuid-new-conflict",
          participant_id: PAYER_UUID,
          status: "cancelled",
          start_date: "2026-10-29",
          end_date: "2026-10-30",
          duration_days: 1,
          amount: 600,
        },
        // Historical earlier stay (Day 1) that was confirmed and assigned earlier
        {
          id: "acc-uuid-historical-paid",
          participant_id: PAYER_UUID,
          status: "paid",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          duration_days: 1,
          amount: 600,
          hostel_id: "hostel-historical",
          room_id: "room-101",
          hostels: { name: "Aravali Hostel" },
          hostel_rooms: { room_number: "101" },
          accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      const json = await res.json();

      expect(json.conflicts[0].resolutionStatus).toBe("REQUIRES_MANUAL_VERIFICATION");
      expect(json.conflicts[0].resolutionNotes).not.toContain("SEPARATE_STAY_ALLOCATED");
      expect(json.conflicts[0].resolutionNotes).toContain("Another accommodation booking exists for this participant");
    });

    it("a separate paid stay with a room assigned but unrelated dates does not resolve the conflict", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-uuid-unrelated-dates",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-conflict-dates",
          details: {
            participant_id: PAYER_UUID,
            payment_order_id: ORDER_ID,
            amount: 600,
            start_date: "2026-10-30",
            end_date: "2026-10-31",
          },
          created_at: new Date().toISOString(),
        },
      ];
      mockAccommodations = [
        // Conflicted stay is for Oct 30 - Oct 31
        {
          id: "acc-uuid-conflict-dates",
          participant_id: PAYER_UUID,
          status: "cancelled",
          start_date: "2026-10-30",
          end_date: "2026-10-31",
          duration_days: 1,
          amount: 600,
        },
        // Separate stay is completely unrelated dates (Oct 28 - Oct 29)
        {
          id: "acc-uuid-early-dates",
          participant_id: PAYER_UUID,
          status: "paid",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          duration_days: 1,
          amount: 600,
          hostel_id: "hostel-early",
          room_id: "room-305",
          hostels: { name: "Vindhya Hostel" },
          hostel_rooms: { room_number: "305" },
          accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      const json = await res.json();

      expect(json.conflicts[0].resolutionStatus).toBe("REQUIRES_MANUAL_VERIFICATION");
      expect(json.conflicts[0].resolutionStatus).not.toBe("SEPARATE_STAY_ALLOCATED");
      expect(json.conflicts[0].resolutionNotes).toContain("Another accommodation booking exists for this participant");
    });

    it("supplemental alternative-stay information is returned without changing the resolution status", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-uuid-supp",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-conflict-supp",
          details: { participant_id: PAYER_UUID, payment_order_id: ORDER_ID, amount: 600 },
          created_at: new Date().toISOString(),
        },
      ];
      mockAccommodations = [
        {
          id: "acc-uuid-conflict-supp",
          participant_id: PAYER_UUID,
          status: "cancelled",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          duration_days: 1,
          amount: 600,
        },
        {
          id: "acc-uuid-supp-stay",
          participant_id: PAYER_UUID,
          status: "paid",
          start_date: "2026-10-29",
          end_date: "2026-10-30",
          duration_days: 1,
          amount: 600,
          hostel_id: "hostel-supp",
          room_id: "room-402",
          hostels: { name: "Nilgiri Hostel" },
          hostel_rooms: { room_number: "402" },
          accommodation_plans: { name: "1-Day Accommodation", slug: "1-day", duration: 1 },
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      const json = await res.json();

      const conflict = json.conflicts[0];
      // Resolution status is ALWAYS REQUIRES_MANUAL_VERIFICATION
      expect(conflict.resolutionStatus).toBe("REQUIRES_MANUAL_VERIFICATION");
      // But supplemental stay info is safely provided for the admin
      expect(conflict.separateStay).toEqual({
        id: "acc-uuid-supp-stay",
        planName: "1-Day Accommodation",
        startDate: "2026-10-29",
        endDate: "2026-10-30",
        status: "paid",
        roomNumber: "402",
        hostelName: "Nilgiri Hostel",
      });
    });

    it("every conflict without an authoritative resolution record remains REQUIRES_MANUAL_VERIFICATION across all states", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-1",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-1",
          details: { participant_id: PAYER_UUID, payment_order_id: ORDER_ID, amount: 600 },
          created_at: new Date().toISOString(),
        },
        {
          id: "log-2",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-2",
          details: { participant_id: PAYER_UUID, payment_order_id: ORDER_ID, amount: 600 },
          created_at: new Date().toISOString(),
        },
      ];
      mockAccommodations = [
        { id: "acc-1", participant_id: PAYER_UUID, status: "cancelled", start_date: "2026-10-28", end_date: "2026-10-29" },
        { id: "acc-2", participant_id: PAYER_UUID, status: "cancelled", start_date: "2026-10-29", end_date: "2026-10-30" },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      const json = await res.json();

      expect(json.conflicts.length).toBe(2);
      expect(json.conflicts.every((c: any) => c.resolutionStatus === "REQUIRES_MANUAL_VERIFICATION")).toBe(true);
    });

    it("admin conflict results do not expose sensitive gateway secrets or salts", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-uuid-102",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-uuid-102",
          details: {
            participant_id: PAYER_UUID,
            payment_order_id: ORDER_ID,
            amount: 600,
            start_date: "2026-10-28",
            end_date: "2026-10-29",
            gateway_payment_id: "payu_txn_12345",
            secret_salt: "SUPER_SECRET_SALT_DO_NOT_EXPOSE",
          },
          created_at: new Date().toISOString(),
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      const json = await res.json();

      const rawString = JSON.stringify(json);
      expect(rawString).not.toContain("SUPER_SECRET_SALT_DO_NOT_EXPOSE");
      expect(rawString).not.toContain("secret_salt");
    });

    it("missing or malformed audit data is handled safely without throwing 500 error", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-malformed",
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: null,
          details: null, // Malformed null details
          created_at: new Date().toISOString(),
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/accommodations/conflicts");
      const res = await getConflicts(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.conflicts.length).toBe(1);
      expect(json.conflicts[0].participant.name).toBe("Unknown Participant");
    });
  });

  describe("3. Audit Logs Integration (/api/admin/logs)", () => {
    it("returns descriptive System author for conflict logs without admin_id", async () => {
      mockAdminAuth = { error: null, role: "master", accommodation_access: true, user: { id: "master-admin" } };
      mockAuditLogs = [
        {
          id: "log-sys-1",
          admin_id: null,
          action_type: "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT",
          target_id: "acc-123",
          details: { reason: "Overlap conflict" },
          created_at: new Date().toISOString(),
        },
      ];

      const req = new NextRequest("http://localhost/api/admin/logs?action_type=ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT");
      const res = await getAdminLogs(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.logs.length).toBe(1);
      expect(json.logs[0].admin_email).toBe("System (Payment Settlement Conflict)");
    });
  });
});
