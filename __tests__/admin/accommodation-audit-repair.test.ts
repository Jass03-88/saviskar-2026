import { describe, it, expect, vi, beforeEach } from "vitest";
import { groupRecordsByParticipant, AccommodationRecord } from "@/lib/admin/accommodation-grouping";
import { calculateRoomDateOccupancy, getStayNights, isDateOverlap } from "@/lib/accommodation-dates";
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

  describe("5. Date-Aware Room Capacity & Overlap Logic", () => {
    it("getStayNights returns exact half-open nights [startDate, endDate)", () => {
      expect(getStayNights("2026-10-27", "2026-10-29")).toEqual(["2026-10-27", "2026-10-28"]);
      expect(getStayNights("2026-10-28", "2026-10-29")).toEqual(["2026-10-28"]);
      expect(getStayNights("2026-10-28", "2026-10-28")).toEqual([]);
      expect(getStayNights("2026-10-29", "2026-10-28")).toEqual([]);
      expect(getStayNights(null, "2026-10-28")).toEqual([]);
    });

    it("isDateOverlap correctly identifies overlapping stays and consecutive check-out/check-in", () => {
      // Overlapping
      expect(isDateOverlap("2026-10-27", "2026-10-29", "2026-10-28", "2026-10-30")).toBe(true);
      expect(isDateOverlap("2026-10-27", "2026-10-30", "2026-10-28", "2026-10-29")).toBe(true);
      // Consecutive (checkout 28, checkin 28) - DO NOT OVERLAP
      expect(isDateOverlap("2026-10-27", "2026-10-28", "2026-10-28", "2026-10-30")).toBe(false);
      expect(isDateOverlap("2026-10-28", "2026-10-30", "2026-10-27", "2026-10-28")).toBe(false);
      // Disjoint non-overlapping
      expect(isDateOverlap("2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30")).toBe(false);
    });

    it("Stay-date reuse: non-overlapping stays in capacity 1 room succeed", () => {
      const activeAllocations = [
        {
          room_id: "room-cap1",
          participant_id: "part-A",
          start_date: "2026-10-27",
          end_date: "2026-10-28",
        },
      ];

      // Participant B requests 29-30 Oct in same room: should be available!
      const resultB = calculateRoomDateOccupancy({
        roomId: "room-cap1",
        roomCapacity: 1,
        targetStartDate: "2026-10-29",
        targetEndDate: "2026-10-30",
        excludeParticipantId: "part-B",
        activeAllocations,
      });

      expect(resultB.isFull).toBe(false);
      expect(resultB.availableBeds).toBe(1);
      expect(resultB.peakOccupancy).toBe(0);
    });

    it("Stay-date reuse: overlapping stay in capacity 1 room is rejected", () => {
      const activeAllocations = [
        {
          room_id: "room-cap1",
          participant_id: "part-A",
          start_date: "2026-10-27",
          end_date: "2026-10-28",
        },
      ];

      // Participant C requests 27-28 Oct (exact overlap): rejected
      const resultC = calculateRoomDateOccupancy({
        roomId: "room-cap1",
        roomCapacity: 1,
        targetStartDate: "2026-10-27",
        targetEndDate: "2026-10-28",
        excludeParticipantId: "part-C",
        activeAllocations,
      });

      expect(resultC.isFull).toBe(true);
      expect(resultC.availableBeds).toBe(0);
      expect(resultC.peakOccupancy).toBe(1);
    });

    it("Stay-date reuse: partial 1-night overlap in capacity 1 room is rejected", () => {
      const activeAllocations = [
        {
          room_id: "room-cap1",
          participant_id: "part-A",
          start_date: "2026-10-27",
          end_date: "2026-10-28",
        },
      ];

      // Participant D requests 27-29 Oct (overlaps night 27): rejected
      const resultD = calculateRoomDateOccupancy({
        roomId: "room-cap1",
        roomCapacity: 1,
        targetStartDate: "2026-10-27",
        targetEndDate: "2026-10-29",
        excludeParticipantId: "part-D",
        activeAllocations,
      });

      expect(resultD.isFull).toBe(true);
      expect(resultD.availableBeds).toBe(0);
      expect(resultD.peakOccupancy).toBe(1);
    });

    it("Consecutive stays at checkout/check-in do not overlap", () => {
      const activeAllocations = [
        {
          room_id: "room-cap1",
          participant_id: "part-A",
          start_date: "2026-10-27",
          end_date: "2026-10-28",
        },
      ];

      // Participant B arrives 28 Oct when A checks out: should succeed!
      const result = calculateRoomDateOccupancy({
        roomId: "room-cap1",
        roomCapacity: 1,
        targetStartDate: "2026-10-28",
        targetEndDate: "2026-10-30",
        excludeParticipantId: "part-B",
        activeAllocations,
      });

      expect(result.isFull).toBe(false);
      expect(result.availableBeds).toBe(1);
      expect(result.peakOccupancy).toBe(0);
    });

    it("Participant deduplication: multi-order bookings for the same participant exclude self", () => {
      const activeAllocations = [
        {
          room_id: "room-cap1",
          participant_id: "part-A",
          start_date: "2026-10-27",
          end_date: "2026-10-28",
        },
      ];

      // Part A has a second booking for 28-30 Oct in the same capacity 1 room:
      // When allocating, part-A must not block part-A
      const resultSelf = calculateRoomDateOccupancy({
        roomId: "room-cap1",
        roomCapacity: 1,
        targetStartDate: "2026-10-28",
        targetEndDate: "2026-10-30",
        excludeParticipantId: "part-A",
        activeAllocations,
      });

      expect(resultSelf.isFull).toBe(false);
      expect(resultSelf.availableBeds).toBe(1);
    });

    it("Participant deduplication: multiple allocations for same participant on same night count as 1 occupant", () => {
      const activeAllocations = [
        {
          room_id: "room-cap2",
          participant_id: "part-A",
          start_date: "2026-10-28",
          end_date: "2026-10-29",
        },
        {
          room_id: "room-cap2",
          participant_id: "part-A", // Duplicate allocation row for same participant
          start_date: "2026-10-28",
          end_date: "2026-10-29",
        },
      ];

      // Room capacity 2 has 2 allocation rows, but only 1 distinct participant.
      // Another participant B should still find 1 bed available on that night!
      const resultB = calculateRoomDateOccupancy({
        roomId: "room-cap2",
        roomCapacity: 2,
        targetStartDate: "2026-10-28",
        targetEndDate: "2026-10-29",
        excludeParticipantId: "part-B",
        activeAllocations,
      });

      expect(resultB.isFull).toBe(false);
      expect(resultB.availableBeds).toBe(1);
      expect(resultB.peakOccupancy).toBe(1);
    });

    it("Capacity 2: allows 2 distinct participants on same night, rejects 3rd", () => {
      const activeAllocations = [
        {
          room_id: "room-cap2",
          participant_id: "part-A",
          start_date: "2026-10-28",
          end_date: "2026-10-30",
        },
        {
          room_id: "room-cap2",
          participant_id: "part-B",
          start_date: "2026-10-28",
          end_date: "2026-10-30",
        },
      ];

      // 3rd participant C on same dates is rejected
      const resultC = calculateRoomDateOccupancy({
        roomId: "room-cap2",
        roomCapacity: 2,
        targetStartDate: "2026-10-28",
        targetEndDate: "2026-10-30",
        excludeParticipantId: "part-C",
        activeAllocations,
      });
      expect(resultC.isFull).toBe(true);
      expect(resultC.availableBeds).toBe(0);

      // Non-overlapping participant D arriving on 30 Oct is allowed
      const resultD = calculateRoomDateOccupancy({
        roomId: "room-cap2",
        roomCapacity: 2,
        targetStartDate: "2026-10-30",
        targetEndDate: "2026-10-31",
        excludeParticipantId: "part-D",
        activeAllocations,
      });
      expect(resultD.isFull).toBe(false);
      expect(resultD.availableBeds).toBe(2);
    });

    it("maps INVALID_BOOKING_DATES RPC error to HTTP 400", async () => {
      mockAuthSupabaseRpc.mockResolvedValue({
        data: null,
        error: { message: "INVALID_BOOKING_DATES: start_date must be before end_date" },
      });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantAccommodationId: "acco-1",
          hostelId: "h-1",
          roomId: "r-1",
        }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_BOOKING_DATES");
    });
  });

  describe("6. Sibling Allocation RPC Enforcement & Reallocation Guardrails", () => {
    function setupSiblingMock(primaryId: string, participantId: string, siblings: any[]) {
      mockSupabaseAdminFrom.mockImplementation((table: string) => {
        if (table === "participant_accommodations") {
          return {
            select: vi.fn().mockImplementation((cols: string) => ({
              eq: vi.fn().mockImplementation((col1: string, val1: string) => {
                if (col1 === "id" && val1 === primaryId) {
                  return {
                    single: vi.fn().mockResolvedValue({
                      data: { participant_id: participantId },
                      error: null,
                    }),
                  };
                }
                if (col1 === "participant_id" && val1 === participantId) {
                  return {
                    eq: vi.fn().mockImplementation((col2: string, val2: string) => {
                      if (col2 === "status" && val2 === "paid") {
                        return {
                          neq: vi.fn().mockImplementation((col3: string, val3: string) => {
                            if (col3 === "id" && val3 === primaryId) {
                              return Promise.resolve({
                                data: siblings,
                                error: null,
                              });
                            }
                            return Promise.resolve({ data: [], error: null });
                          }),
                        };
                      }
                      return Promise.resolve({ data: [], error: null });
                    }),
                  };
                }
                return { single: vi.fn().mockResolvedValue({ data: null, error: null }) };
              }),
            })),
          };
        }
        if (table === "admin_audit_logs") {
          return {
            insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      });
    }

    it("allocates both primary order and unallocated sibling through protected RPC", async () => {
      const primaryId = "acco-prim-1";
      const siblingId = "acco-sib-1";
      const participantId = "part-uuid-1";

      setupSiblingMock(primaryId, participantId, [
        { id: siblingId, start_date: "2026-10-28", end_date: "2026-10-30", status: "paid", room_id: null },
      ]);

      mockAuthSupabaseRpc
        .mockResolvedValueOnce({ data: { success: true, allocation_id: "alloc-1" }, error: null })
        .mockResolvedValueOnce({ data: { success: true, allocation_id: "alloc-2" }, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantAccommodationId: primaryId,
          hostelId: "hostel-1",
          roomId: "room-101",
          reason: "Manual allocation",
        }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify BOTH primary and sibling called the authoritative allocate_accommodation RPC
      expect(mockAuthSupabaseRpc).toHaveBeenCalledTimes(2);
      expect(mockAuthSupabaseRpc).toHaveBeenNthCalledWith(1, "allocate_accommodation", {
        p_participant_accommodation_id: primaryId,
        p_hostel_id: "hostel-1",
        p_room_id: "room-101",
        p_reason: "Manual allocation",
      });
      expect(mockAuthSupabaseRpc).toHaveBeenNthCalledWith(2, "allocate_accommodation", {
        p_participant_accommodation_id: siblingId,
        p_hostel_id: "hostel-1",
        p_room_id: "room-101",
        p_reason: "Manual allocation (Multi-order participant stay allocation)",
      });

      // Verify NO direct inserts were made to accommodation_allocations
      expect(mockSupabaseAdminFrom).not.toHaveBeenCalledWith("accommodation_allocations");

      // Verify response reports sibling success
      expect(json.siblingAllocations).toEqual([
        { id: siblingId, success: true, room_id: "room-101" },
      ]);
      expect(json.partialSuccess).toBeUndefined();
    });

    it("safely handles sibling reallocation when sibling is currently in Room A and primary is assigned to Room B", async () => {
      const primaryId = "acco-prim-2";
      const siblingId = "acco-sib-2";
      const participantId = "part-uuid-2";

      // Sibling currently has an active allocation in room-A!
      setupSiblingMock(primaryId, participantId, [
        { id: siblingId, start_date: "2026-10-28", end_date: "2026-10-30", status: "paid", room_id: "room-A" },
      ]);

      mockAuthSupabaseRpc
        .mockResolvedValueOnce({ data: { success: true, allocation_id: "alloc-prim" }, error: null })
        .mockResolvedValueOnce({ data: { success: true, allocation_id: "alloc-sib-reassigned" }, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantAccommodationId: primaryId,
          hostelId: "hostel-1",
          roomId: "room-B",
        }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(200);

      // Verifies that sibling was passed to allocate_accommodation (which handles deallocating room-A and assigning room-B)
      // rather than performing an unhedged insert into accommodation_allocations that causes duplicate key on idx_accommodation_allocations_active
      expect(mockAuthSupabaseRpc).toHaveBeenNthCalledWith(2, "allocate_accommodation", {
        p_participant_accommodation_id: siblingId,
        p_hostel_id: "hostel-1",
        p_room_id: "room-B",
        p_reason: "Multi-order participant stay allocation",
      });
      expect(mockSupabaseAdminFrom).not.toHaveBeenCalledWith("accommodation_allocations");
    });

    it("accurately communicates partial success and does not claim sibling succeeded when sibling RPC fails", async () => {
      const primaryId = "acco-prim-3";
      const siblingId = "acco-sib-3";
      const participantId = "part-uuid-3";

      setupSiblingMock(primaryId, participantId, [
        { id: siblingId, start_date: "2026-10-29", end_date: "2026-10-31", status: "paid", room_id: null },
      ]);

      // Primary succeeds, sibling fails due to ROOM_FULL on its stay dates
      mockAuthSupabaseRpc
        .mockResolvedValueOnce({ data: { success: true, allocation_id: "alloc-prim" }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "ROOM_FULL: Capacity exceeded" } });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantAccommodationId: primaryId,
          hostelId: "hostel-1",
          roomId: "room-101",
        }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.partialSuccess).toBe(true);
      expect(json.siblingAllocations).toEqual([
        { id: siblingId, success: false, error: "ROOM_FULL: Capacity exceeded" },
      ]);
      expect(json.warning).toContain("sibling booking(s) could not be allocated to this room");
    });

    it("skips calling sibling RPC if sibling is already allocated to the selected room", async () => {
      const primaryId = "acco-prim-4";
      const siblingId = "acco-sib-4";
      const participantId = "part-uuid-4";

      // Sibling already in room-101
      setupSiblingMock(primaryId, participantId, [
        { id: siblingId, start_date: "2026-10-28", end_date: "2026-10-30", status: "paid", room_id: "room-101" },
      ]);

      mockAuthSupabaseRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantAccommodationId: primaryId,
          hostelId: "hostel-1",
          roomId: "room-101",
        }),
      });

      const res = await allocatePost(req);
      expect(res.status).toBe(200);

      // Only called once for primary
      expect(mockAuthSupabaseRpc).toHaveBeenCalledTimes(1);
    });

    it("reallocate route also enforces RPC for siblings without direct table writes", async () => {
      const primaryId = "acco-prim-realloc";
      const siblingId = "acco-sib-realloc";
      const participantId = "part-uuid-realloc";

      setupSiblingMock(primaryId, participantId, [
        { id: siblingId, start_date: "2026-10-28", end_date: "2026-10-30", status: "paid", room_id: "room-old" },
      ]);

      mockAuthSupabaseRpc
        .mockResolvedValueOnce({ data: { success: true }, error: null })
        .mockResolvedValueOnce({ data: { success: true }, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/reallocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantAccommodationId: primaryId,
          hostelId: "hostel-1",
          roomId: "room-new",
          reason: "Participant requested room change",
        }),
      });

      const res = await reallocatePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      expect(mockAuthSupabaseRpc).toHaveBeenCalledTimes(2);
      expect(mockAuthSupabaseRpc).toHaveBeenNthCalledWith(2, "allocate_accommodation", {
        p_participant_accommodation_id: siblingId,
        p_hostel_id: "hostel-1",
        p_room_id: "room-new",
        p_reason: "Participant requested room change (Multi-order participant stay reallocation)",
      });
      expect(mockSupabaseAdminFrom).not.toHaveBeenCalledWith("accommodation_allocations");
    });
  });

  describe("7. Auto-Allocation Strict Missing & Invalid Date Handling", () => {
    const mockHostels = [
      { id: "h1", name: "Hostel Female", gender_eligibility: "female", is_active: true },
    ];
    const mockFloors = [
      { id: "f1", hostel_id: "h1", floor_number: 1, is_active: true },
    ];
    const mockRooms = [
      { id: "r1", hostel_id: "h1", floor_id: "f1", room_number: "101", capacity: 2, is_active: true },
    ];

    function setupAutoAllocateMock(unallocatedList: any[]) {
      mockSupabaseAdminFrom.mockImplementation((table: string) => {
        let data: any = [];
        if (table === "participant_accommodations") data = unallocatedList;
        if (table === "hostels") data = mockHostels;
        if (table === "hostel_floors") data = mockFloors;
        if (table === "hostel_rooms") data = mockRooms;
        if (table === "accommodation_allocations") data = [];

        const chain: any = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          order: () => chain,
          limit: () => chain,
          in: () => chain,
          insert: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: any) => resolve({ data, error: null }),
        };
        return chain;
      });
    }

    it("skips booking with null start_date with MISSING_BOOKING_DATES without calling RPC", async () => {
      const candidates = [
        {
          id: "pa-null-start",
          status: "paid",
          start_date: null,
          end_date: "2026-10-29",
          participants: { participant_id: "p-null-start", gender: "female" },
        },
      ];

      setupAutoAllocateMock(candidates);
      mockAuthSupabaseRpc.mockResolvedValue({ data: null, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/auto-allocate", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await autoAllocatePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.allocated).toBe(0);
      expect(json.data.skipped).toBe(1);
      expect(json.data.results[0]).toEqual({
        participantAccommodationId: "pa-null-start",
        participantId: "p-null-start",
        status: "SKIPPED",
        reason: "MISSING_BOOKING_DATES",
      });

      // Crucial: RPC was NEVER invoked for candidate with missing start_date
      expect(mockAuthSupabaseRpc).not.toHaveBeenCalled();
    });

    it("skips booking with null end_date with MISSING_BOOKING_DATES without calling RPC", async () => {
      const candidates = [
        {
          id: "pa-null-end",
          status: "paid",
          start_date: "2026-10-28",
          end_date: null,
          participants: { participant_id: "p-null-end", gender: "female" },
        },
      ];

      setupAutoAllocateMock(candidates);
      mockAuthSupabaseRpc.mockResolvedValue({ data: null, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/auto-allocate", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await autoAllocatePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.allocated).toBe(0);
      expect(json.data.skipped).toBe(1);
      expect(json.data.results[0].reason).toBe("MISSING_BOOKING_DATES");
      expect(mockAuthSupabaseRpc).not.toHaveBeenCalled();
    });

    it("skips booking with start_date >= end_date with INVALID_BOOKING_DATES without calling RPC", async () => {
      const candidates = [
        {
          id: "pa-0-night",
          status: "paid",
          start_date: "2026-10-28",
          end_date: "2026-10-28", // start == end
          participants: { participant_id: "p-0-night", gender: "female" },
        },
        {
          id: "pa-reversed",
          status: "paid",
          start_date: "2026-10-30",
          end_date: "2026-10-28", // start > end
          participants: { participant_id: "p-reversed", gender: "female" },
        },
      ];

      setupAutoAllocateMock(candidates);
      mockAuthSupabaseRpc.mockResolvedValue({ data: null, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/auto-allocate", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await autoAllocatePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.allocated).toBe(0);
      expect(json.data.skipped).toBe(2);
      expect(json.data.results[0].reason).toBe("INVALID_BOOKING_DATES");
      expect(json.data.results[1].reason).toBe("INVALID_BOOKING_DATES");
      expect(mockAuthSupabaseRpc).not.toHaveBeenCalled();
    });

    it("continues to allocate subsequent valid candidates after skipping missing-date candidate", async () => {
      const candidates = [
        {
          id: "pa-bad-date",
          status: "paid",
          start_date: null,
          end_date: "2026-10-29",
          participants: { participant_id: "p-bad", gender: "female" },
        },
        {
          id: "pa-valid",
          status: "paid",
          start_date: "2026-10-28",
          end_date: "2026-10-30",
          participants: { participant_id: "p-valid", gender: "female" },
        },
      ];

      setupAutoAllocateMock(candidates);
      mockAuthSupabaseRpc.mockResolvedValueOnce({ data: { success: true }, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/auto-allocate", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await autoAllocatePost(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.allocated).toBe(1);
      expect(json.data.skipped).toBe(1);
      expect(json.data.results[0].reason).toBe("MISSING_BOOKING_DATES");
      expect(json.data.results[1].status).toBe("ALLOCATED");

      // RPC was invoked ONLY for the valid candidate, using its actual dates
      expect(mockAuthSupabaseRpc).toHaveBeenCalledTimes(1);
      expect(mockAuthSupabaseRpc).toHaveBeenCalledWith("allocate_accommodation", {
        p_participant_accommodation_id: "pa-valid",
        p_hostel_id: "h1",
        p_room_id: "r1",
        p_reason: "Auto-allocated",
      });
    });
  });
});
