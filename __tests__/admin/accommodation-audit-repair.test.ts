import { describe, it, expect, vi, beforeEach } from "vitest";
import { groupRecordsByParticipant, AccommodationRecord } from "@/lib/admin/accommodation-grouping";
import { POST as allocatePost } from "@/app/api/admin/accommodations/allocate/route";
import { POST as reallocatePost } from "@/app/api/admin/accommodations/reallocate/route";
import { POST as autoAllocatePost } from "@/app/api/admin/accommodations/auto-allocate/route";
import { DELETE as deleteHostel } from "@/app/api/admin/accommodations/hostels/route";
import { DELETE as deleteRoom } from "@/app/api/admin/accommodations/rooms/route";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost");
vi.stubEnv("SUPABASE_SECRET_KEY", "secret-test-key");

const mockAuthAdmin = vi.fn();
const mockAuthSupabaseRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  requireAccommodationAdmin: () => mockAuthAdmin(),
}));

const mockSupabaseAdminRpc = vi.fn();
const mockSupabaseAdminFrom = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: mockSupabaseAdminRpc,
    from: mockSupabaseAdminFrom,
  }),
}));

describe("Accommodation Audit & Repair Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthAdmin.mockResolvedValue({
      error: null,
      status: 200,
      user: { id: "admin-uuid-1", email: "admin@saviskar.co.in" },
      supabase: {
        rpc: mockAuthSupabaseRpc,
      },
    });
  });

  describe("1. Participant Deduplication & Multi-Order Grouping", () => {
    const maithilyOrder1: AccommodationRecord = {
      id: "acco-uuid-1",
      participant_id: "part-uuid-1",
      accommodation_plan_id: "plan-1day",
      start_date: "2026-10-27",
      end_date: "2026-10-28",
      duration_days: 1,
      amount: 400,
      currency: "INR",
      status: "paid",
      hostel_id: null,
      room_id: null,
      checked_in: false,
      checked_in_at: null,
      checked_out: false,
      checked_out_at: null,
      created_at: "2026-10-25T10:00:00Z",
      participants: {
        participant_id: "SVK26-48BE01FA",
        name: "Maithily Chhipa",
        email: "maithilychhipa@gmail.com",
        phone: "9876543210",
        gender: "female",
        state: "Rajasthan",
        is_faculty: false,
      },
    };

    const maithilyOrder2: AccommodationRecord = {
      id: "acco-uuid-2",
      participant_id: "part-uuid-1",
      accommodation_plan_id: "plan-2days",
      start_date: "2026-10-28",
      end_date: "2026-10-30",
      duration_days: 2,
      amount: 800,
      currency: "INR",
      status: "paid",
      hostel_id: null,
      room_id: null,
      checked_in: false,
      checked_in_at: null,
      checked_out: false,
      checked_out_at: null,
      created_at: "2026-10-25T11:00:00Z",
      participants: {
        participant_id: "SVK26-48BE01FA",
        name: "Maithily Chhipa",
        email: "maithilychhipa@gmail.com",
        phone: "9876543210",
        gender: "female",
        state: "Rajasthan",
        is_faculty: false,
      },
    };

    const otherParticipant: AccommodationRecord = {
      id: "acco-uuid-3",
      participant_id: "part-uuid-2",
      accommodation_plan_id: "plan-1day",
      start_date: "2026-10-28",
      end_date: "2026-10-29",
      duration_days: 1,
      amount: 400,
      currency: "INR",
      status: "paid",
      hostel_id: "hostel-1",
      room_id: "room-1",
      checked_in: false,
      checked_in_at: null,
      checked_out: false,
      checked_out_at: null,
      created_at: "2026-10-25T12:00:00Z",
      participants: {
        participant_id: "SVK26-OTHER001",
        name: "Other Participant",
        email: "other@example.com",
        phone: "9876543211",
        gender: "male",
        state: "Punjab",
        is_faculty: false,
      },
    };

    it("consolidates multi-order participant into a single entry without losing records", () => {
      const records = [maithilyOrder1, maithilyOrder2, otherParticipant];
      const grouped = groupRecordsByParticipant(records);

      expect(grouped).toHaveLength(2);

      const maithilyEntry = grouped.find((g) => g.participantCode === "SVK26-48BE01FA");
      expect(maithilyEntry).toBeDefined();
      expect(maithilyEntry?.records).toHaveLength(2);
      expect(maithilyEntry?.name).toBe("Maithily Chhipa");
      expect(maithilyEntry?.hasPaid).toBe(true);
      expect(maithilyEntry?.isAllocated).toBe(false);
      expect(maithilyEntry?.isPartiallyAllocated).toBe(false);

      const otherEntry = grouped.find((g) => g.participantCode === "SVK26-OTHER001");
      expect(otherEntry).toBeDefined();
      expect(otherEntry?.records).toHaveLength(1);
      expect(otherEntry?.isAllocated).toBe(true);
    });

    it("accurately reports partial allocation when only 1 of 2 orders is allocated", () => {
      const order1Allocated = { ...maithilyOrder1, room_id: "room-101", hostel_id: "hostel-1" };
      const records = [order1Allocated, maithilyOrder2];
      const grouped = groupRecordsByParticipant(records);

      const maithilyEntry = grouped[0];
      expect(maithilyEntry.isAllocated).toBe(false);
      expect(maithilyEntry.isPartiallyAllocated).toBe(true);
      expect(maithilyEntry.assignedRoomId).toBe("room-101");
    });

    it("accurately reports full allocation when all orders are allocated to the same room", () => {
      const order1Allocated = { ...maithilyOrder1, room_id: "room-101", hostel_id: "hostel-1" };
      const order2Allocated = { ...maithilyOrder2, room_id: "room-101", hostel_id: "hostel-1" };
      const records = [order1Allocated, order2Allocated];
      const grouped = groupRecordsByParticipant(records);

      const maithilyEntry = grouped[0];
      expect(maithilyEntry.isAllocated).toBe(true);
      expect(maithilyEntry.isPartiallyAllocated).toBe(false);
      expect(maithilyEntry.assignedRoomId).toBe("room-101");
    });
  });

  describe("2. Authentication & Authorization Context in RPC Calls", () => {
    it("returns 401 when unauthenticated", async () => {
      mockAuthAdmin.mockResolvedValueOnce({
        error: "Unauthorized",
        status: 401,
        user: null,
        supabase: null,
      });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "acco-1", hostelId: "h-1", roomId: "r-1" }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("returns 403 when user lacks accommodation_access", async () => {
      mockAuthAdmin.mockResolvedValueOnce({
        error: "Forbidden",
        status: 403,
        user: { id: "admin-uuid-2" },
        supabase: null,
      });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "acco-1", hostelId: "h-1", roomId: "r-1" }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("calls RPC using auth.supabase (authenticated admin client) instead of headless admin", async () => {
      mockAuthSupabaseRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "acco-1", hostelId: "h-1", roomId: "r-1" }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(200);
      // Crucial: auth.supabase.rpc must have been invoked so auth.uid() is populated in Postgres
      expect(mockAuthSupabaseRpc).toHaveBeenCalledWith("allocate_accommodation", {
        p_participant_accommodation_id: "acco-1",
        p_hostel_id: "h-1",
        p_room_id: "r-1",
        p_reason: null,
      });
      // Headless supabaseAdmin.rpc should not be called when auth.supabase is available
      expect(mockSupabaseAdminRpc).not.toHaveBeenCalled();
    });

    it("correctly maps ROOM_FULL RPC error to HTTP 400 with code ROOM_FULL", async () => {
      mockAuthSupabaseRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "Room capacity exceeded" },
      });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "acco-1", hostelId: "h-1", roomId: "r-1" }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("ROOM_FULL");
    });
  });

  describe("3. Administrative CRUD & Referential Integrity", () => {
    it("hostel deletion blocks when floors exist", async () => {
      mockSupabaseAdminFrom.mockImplementation((table: string) => {
        if (table === "hostel_floors") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [{ id: "floor-1" }], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const req = new Request("http://localhost/api/admin/accommodations/hostels?id=hostel-1", {
        method: "DELETE",
      });

      const res = await deleteHostel(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("floors");
    });

    it("hostel deletion blocks when active allocations exist", async () => {
      mockSupabaseAdminFrom.mockImplementation((table: string) => {
        if (table === "hostel_floors" || table === "hostel_rooms") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "accommodation_allocations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [{ id: "alloc-1" }], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const req = new Request("http://localhost/api/admin/accommodations/hostels?id=hostel-1", {
        method: "DELETE",
      });

      const res = await deleteHostel(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("active participant allocations");
    });

    it("room deletion blocks when active allocations exist", async () => {
      mockSupabaseAdminFrom.mockImplementation((table: string) => {
        if (table === "accommodation_allocations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [{ id: "alloc-1" }], error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const req = new Request("http://localhost/api/admin/accommodations/rooms?id=room-1", {
        method: "DELETE",
      });

      const res = await deleteRoom(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("active participant allocations");
    });

    it("room deletion succeeds when clean and writes audit log", async () => {
      const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });

      mockSupabaseAdminFrom.mockImplementation((table: string) => {
        if (table === "accommodation_allocations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "participant_accommodations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === "hostel_rooms") {
          return {
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [{ id: "room-1" }], error: null }),
          };
        }
        if (table === "admin_audit_logs") {
          return {
            insert: mockInsert,
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      });

      const req = new Request("http://localhost/api/admin/accommodations/rooms?id=room-1", {
        method: "DELETE",
      });

      const res = await deleteRoom(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "DELETE_ACCOMMODATION_ROOM",
          target_id: "room-1",
        })
      );
    });
  });
});
