import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as allocatePost } from "@/app/api/admin/accommodations/allocate/route";
import { POST as reallocatePost } from "@/app/api/admin/accommodations/reallocate/route";
import { POST as autoAllocatePost } from "@/app/api/admin/accommodations/auto-allocate/route";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost");
vi.stubEnv("SUPABASE_SECRET_KEY", "secret");

vi.mock("@/lib/supabase/server", () => ({
  requireAccommodationAdmin: vi.fn().mockResolvedValue({ error: null, admin: { id: "admin1", role: "master", accommodation_access: true } })
}));

let rpcMock = vi.fn();
let fromMock = vi.fn();

vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: () => ({
      from: fromMock,
      rpc: rpcMock
    })
  };
});

describe("Phase 3B - Accommodation Operations & Allocation APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Allocation API", () => {
    it("fails if missing UUIDs", async () => {
      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "123" }) // missing hostelId, roomId
      });
      const res = await allocatePost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("INVALID_INPUT");
    });

    it("succeeds when all params provided and RPC succeeds", async () => {
      rpcMock.mockResolvedValueOnce({ data: { success: true }, error: null });
      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "123", hostelId: "h1", roomId: "r1" })
      });
      const res = await allocatePost(req);
      expect(res.status).toBe(200);
      expect(rpcMock).toHaveBeenCalledWith("allocate_accommodation", {
        p_participant_accommodation_id: "123",
        p_hostel_id: "h1",
        p_room_id: "r1",
        p_reason: null
      });
    });

    it("maps RPC errors correctly (e.g. Capacity exceeded)", async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "Capacity exceeded for room." } });
      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "123", hostelId: "h1", roomId: "r1" })
      });
      const res = await allocatePost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("ROOM_FULL");
    });
    
    it("maps RPC errors correctly (e.g. GENDER_MISMATCH)", async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "GENDER_MISMATCH" } });
      const req = new Request("http://localhost/api/admin/accommodations/allocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "123", hostelId: "h1", roomId: "r1" })
      });
      const res = await allocatePost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("GENDER_MISMATCH");
    });
  });

  describe("Reallocation API", () => {
    it("fails if reason is missing", async () => {
      const req = new Request("http://localhost/api/admin/accommodations/reallocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "123", hostelId: "h1", roomId: "r1", reason: "   " })
      });
      const res = await reallocatePost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toBe("Reason is required for reallocation.");
    });

    it("succeeds with reason", async () => {
      rpcMock.mockResolvedValueOnce({ data: { success: true }, error: null });
      const req = new Request("http://localhost/api/admin/accommodations/reallocate", {
        method: "POST",
        body: JSON.stringify({ participantAccommodationId: "123", hostelId: "h1", roomId: "r1", reason: "Changed preference" })
      });
      const res = await reallocatePost(req);
      expect(res.status).toBe(200);
      expect(rpcMock).toHaveBeenCalledWith("allocate_accommodation", {
        p_participant_accommodation_id: "123",
        p_hostel_id: "h1",
        p_room_id: "r1",
        p_reason: "Changed preference"
      });
    });
  });

  describe("Auto Allocate API", () => {
    it("processes bulk allocation safely", async () => {
      // Mock unallocated
      const mockUnallocated = [
        { id: "pa1", status: "paid", participants: { participant_id: "p1", gender: "male" } },
        { id: "pa2", status: "paid", participants: [{ participant_id: "p2", gender: "female" }] },
        { id: "pa3", status: "paid", participants: { participant_id: "p3", gender: "other" } }
      ];
      
      const mockHostels = [
        { id: "h1", name: "Hostel M", gender_eligibility: "male", is_active: true },
        { id: "h2", name: "Hostel F", gender_eligibility: "female", is_active: true }
      ];
      
      const mockFloors = [
        { id: "f1", hostel_id: "h1", is_active: true },
        { id: "f2", hostel_id: "h2", is_active: true }
      ];
      
      const mockRooms = [
        { id: "r1", hostel_id: "h1", floor_id: "f1", room_number: "101", capacity: 2, is_active: true },
        { id: "r2", hostel_id: "h2", floor_id: "f2", room_number: "201", capacity: 1, is_active: true }
      ];
      
      const mockAllocations = [
        { room_id: "r2", status: "active" } // r2 is full
      ];

      fromMock.mockImplementation((table) => {
        let data: any = [];
        if (table === "participant_accommodations") data = mockUnallocated;
        if (table === "hostels") data = mockHostels;
        if (table === "hostel_floors") data = mockFloors;
        if (table === "hostel_rooms") data = mockRooms;
        if (table === "accommodation_allocations") data = mockAllocations;
        
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (resolve: any) => resolve({ data, error: null })
        };
        return chain;
      });

      rpcMock.mockResolvedValue({ data: null, error: null });

      const req = new Request("http://localhost/api/admin/accommodations/auto-allocate", { method: "POST", body: JSON.stringify({}) });
      const res = await autoAllocatePost(req);
      const json = await res.json();
      
      expect(res.status).toBe(200);
      expect(json.data.allocated).toBe(1); // Only male (pa1) to r1
      expect(json.data.skipped).toBe(2); // pa2 skipped because r2 is full. pa3 skipped because gender 'other'
      expect(json.data.failed).toBe(0);
    });
  });
});
