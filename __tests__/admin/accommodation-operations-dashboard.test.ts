import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/accommodations/dashboard/route";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost");
vi.stubEnv("SUPABASE_SECRET_KEY", "secret");

vi.mock("@/lib/supabase/server", () => ({
  requireAccommodationAdmin: vi.fn().mockResolvedValue({ error: null, admin: { id: "admin1", role: "master", accommodation_access: true } })
}));

vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: () => ({
      from: vi.fn((table: string) => {
        let data: any[] = [];
        if (table === "hostels") data = [{ id: "h1", name: "Hostel 1", is_active: true }];
        if (table === "hostel_floors") data = [{ id: "f1", hostel_id: "h1", floor_number: 1, is_active: true }];
        if (table === "hostel_rooms") data = [
          { id: "r1", hostel_id: "h1", floor_id: "f1", room_number: "101", capacity: 2, is_active: true },
          { id: "r2", hostel_id: "h1", floor_id: "f1", room_number: "102", capacity: 1, is_active: true }
        ];
        if (table === "accommodation_plans") data = [{ id: "p1", price: 999 }];
        if (table === "participant_accommodations") data = [
          { id: "pa1", status: "paid", room_id: "r1", checked_in: true, checked_out: false },
          { id: "pa2", status: "paid", room_id: null, checked_in: false, checked_out: false },
          { id: "pa3", status: "paid", room_id: "r1", checked_in: false, checked_out: false }
        ];
        if (table === "accommodation_allocations") data = [
          { hostel_id: "h1", room_id: "r1", status: "active" },
          { hostel_id: "h1", room_id: "r1", status: "active" } // Full room r1
        ];

        const chain = {
          order: () => chain,
          eq: () => chain,
          range: () => chain,
          then: (resolve: any) => resolve({ data, error: null, count: data.length }),
          data,
          error: null,
          count: data.length
        };
        return {
          select: () => chain
        };
      })
    })
  };
});

describe("Phase 3A - Accommodation Operations Dashboard API", () => {
  it("should calculate total, occupied, and available capacity correctly", async () => {
    const req = new Request("http://localhost/api/admin/accommodations/dashboard");
    const res = await GET(req);
    const body = await res.json();
    
    expect(res.status).toBe(200);
    expect(body.stats.totalCapacity).toBe(3); // 2 + 1
    // occupied capacity relies on active allocations (2 active in r1)
    expect(body.stats.occupiedCapacity).toBe(2); 
  });

  it("should calculate occupancy percentage and room statuses properly", async () => {
    const req = new Request("http://localhost/api/admin/accommodations/dashboard");
    const res = await GET(req);
    const body = await res.json();
    
    expect(body.roomOccupancy["r1"]).toBe(2); // Full
    expect(body.roomOccupancy["r2"]).toBeUndefined(); // Available
  });

  it("should correctly count awaiting allocation, paid not checked in, checked in, and checked out", async () => {
    const req = new Request("http://localhost/api/admin/accommodations/dashboard");
    const res = await GET(req);
    const body = await res.json();
    
    expect(body.stats.checkedIn).toBe(1);
    expect(body.stats.checkedOut).toBe(0);
    expect(body.stats.awaitingAllocation).toBe(1); // pa2
    expect(body.stats.allocated).toBe(2); // pa1, pa3
  });
});
