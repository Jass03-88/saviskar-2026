/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as checkInPOST } from "@/app/api/admin/accommodations/check-in/route";
import { POST as checkOutPOST } from "@/app/api/admin/accommodations/check-out/route";
import * as serverLib from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

// Mock Supabase environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

interface ParticipantAccommodation {
  id: string;
  participant_id: string;
  status: string;
  hostel_id: string | null;
  room_id: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_out: boolean;
  checked_out_at: string | null;
  start_date: string;
  end_date: string;
  updated_at?: string;
}

interface AllocationRecord {
  id: string;
  participant_accommodation_id: string;
  status: string;
  hostel_id: string;
  room_id: string;
}

interface HostelRecord {
  id: string;
  is_active: boolean;
}

interface HostelRoomRecord {
  id: string;
  is_active: boolean;
  floor_id: string;
  hostel_floors: {
    id: string;
    is_active: boolean;
  };
}

let mockAccommodations: Record<string, ParticipantAccommodation> = {};
let mockAllocations: Record<string, AllocationRecord> = {};
let mockHostels: Record<string, HostelRecord> = {};
let mockRooms: Record<string, HostelRoomRecord> = {};
let mockAuditLogs: Array<{ admin_id: string; action_type: string; target_id: string; details: any }> = [];

let simulateConcurrentCheckInRace = false;
let simulateConcurrentCheckOutRace = false;

function createMockSupabaseClient() {
  return {
    from: (table: string) => {
      if (table === "participant_accommodations") {
        return {
          select: (_columns: string) => {
            const filters: Record<string, any> = {};
            const chain = {
              eq: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              maybeSingle: async () => {
                if (filters.id) {
                  const rec = mockAccommodations[filters.id];
                  return { data: rec ? { ...rec } : null, error: null };
                }
                return { data: null, error: null };
              },
              single: async () => {
                if (filters.id) {
                  const rec = mockAccommodations[filters.id];
                  if (!rec) return { data: null, error: { message: "Not found" } };
                  return { data: { ...rec }, error: null };
                }
                return { data: null, error: { message: "Not found" } };
              },
            };
            return chain;
          },
          update: (updates: Partial<ParticipantAccommodation>) => {
            const eqFilters: Record<string, any> = {};
            const chain = {
              eq: (col: string, val: any) => {
                eqFilters[col] = val;
                return chain;
              },
              select: (_cols?: string) => {
                const execute = async () => {
                  const targetId = eqFilters.id;
                  const rec = mockAccommodations[targetId];
                  if (!rec) return { data: [], error: null };

                  // Test concurrency flag simulation
                  if (simulateConcurrentCheckInRace && updates.checked_in) {
                    rec.checked_in = true;
                    rec.checked_in_at = new Date().toISOString();
                    return { data: [], error: null }; // 0 rows updated by this call
                  }
                  if (simulateConcurrentCheckOutRace && updates.checked_out) {
                    rec.checked_out = true;
                    rec.checked_out_at = new Date().toISOString();
                    return { data: [], error: null }; // 0 rows updated by this call
                  }

                  // Verify atomic preconditions
                  if (eqFilters.checked_in !== undefined && rec.checked_in !== eqFilters.checked_in) {
                    return { data: [], error: null };
                  }
                  if (eqFilters.checked_out !== undefined && rec.checked_out !== eqFilters.checked_out) {
                    return { data: [], error: null };
                  }
                  if (eqFilters.status !== undefined && rec.status !== eqFilters.status) {
                    return { data: [], error: null };
                  }

                  Object.assign(rec, updates);
                  return { data: [{ ...rec }], error: null };
                };
                return {
                  then: (resolve: any) => execute().then(resolve),
                };
              },
            };
            return chain;
          },
        };
      }

      if (table === "accommodation_allocations") {
        return {
          select: (_cols: string) => {
            const filters: Record<string, any> = {};
            const chain = {
              eq: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              maybeSingle: async () => {
                const accId = filters.participant_accommodation_id;
                const status = filters.status;
                const found = Object.values(mockAllocations).find(
                  (a) => a.participant_accommodation_id === accId && (!status || a.status === status)
                );
                return { data: found ? { ...found } : null, error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === "hostels") {
        return {
          select: (_cols: string) => {
            const filters: Record<string, any> = {};
            const chain = {
              eq: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              maybeSingle: async () => {
                const h = mockHostels[filters.id];
                return { data: h ? { ...h } : null, error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === "hostel_rooms") {
        return {
          select: (_cols: string) => {
            const filters: Record<string, any> = {};
            const chain = {
              eq: (col: string, val: any) => {
                filters[col] = val;
                return chain;
              },
              maybeSingle: async () => {
                const r = mockRooms[filters.id];
                return { data: r ? { ...r } : null, error: null };
              },
            };
            return chain;
          },
        };
      }

      if (table === "festival_config") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  accommodation_start_date: "2026-10-28",
                  accommodation_end_date: "2026-10-30",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "admin_audit_logs") {
        return {
          insert: async (entry: any) => {
            mockAuditLogs.push(entry);
            return { data: entry, error: null };
          },
        };
      }

      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createMockSupabaseClient(),
}));

function makeRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("SAVISKAR 2026 — Phase 2D Accommodation Check-In & Check-Out Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simulateConcurrentCheckInRace = false;
    simulateConcurrentCheckOutRace = false;
    mockAuditLogs = [];

    // Reset default DB state
    mockHostels = {
      "hostel-active": { id: "hostel-active", is_active: true },
      "hostel-inactive": { id: "hostel-inactive", is_active: false },
    };

    mockRooms = {
      "room-active": {
        id: "room-active",
        is_active: true,
        floor_id: "floor-active",
        hostel_floors: { id: "floor-active", is_active: true },
      },
      "room-inactive": {
        id: "room-inactive",
        is_active: false,
        floor_id: "floor-active",
        hostel_floors: { id: "floor-active", is_active: true },
      },
      "room-inactive-floor": {
        id: "room-inactive-floor",
        is_active: true,
        floor_id: "floor-inactive",
        hostel_floors: { id: "floor-inactive", is_active: false },
      },
    };

    mockAccommodations = {
      "acc-valid": {
        id: "acc-valid",
        participant_id: "p-01",
        status: "paid",
        hostel_id: "hostel-active",
        room_id: "room-active",
        checked_in: false,
        checked_in_at: null,
        checked_out: false,
        checked_out_at: null,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
      "acc-unpaid": {
        id: "acc-unpaid",
        participant_id: "p-02",
        status: "pending",
        hostel_id: "hostel-active",
        room_id: "room-active",
        checked_in: false,
        checked_in_at: null,
        checked_out: false,
        checked_out_at: null,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
      "acc-unallocated": {
        id: "acc-unallocated",
        participant_id: "p-03",
        status: "paid",
        hostel_id: null,
        room_id: null,
        checked_in: false,
        checked_in_at: null,
        checked_out: false,
        checked_out_at: null,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
      "acc-inactive-hostel": {
        id: "acc-inactive-hostel",
        participant_id: "p-04",
        status: "paid",
        hostel_id: "hostel-inactive",
        room_id: "room-active",
        checked_in: false,
        checked_in_at: null,
        checked_out: false,
        checked_out_at: null,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
      "acc-inactive-floor": {
        id: "acc-inactive-floor",
        participant_id: "p-05",
        status: "paid",
        hostel_id: "hostel-active",
        room_id: "room-inactive-floor",
        checked_in: false,
        checked_in_at: null,
        checked_out: false,
        checked_out_at: null,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
      "acc-inactive-room": {
        id: "acc-inactive-room",
        participant_id: "p-06",
        status: "paid",
        hostel_id: "hostel-active",
        room_id: "room-inactive",
        checked_in: false,
        checked_in_at: null,
        checked_out: false,
        checked_out_at: null,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
      "acc-already-checked-in": {
        id: "acc-already-checked-in",
        participant_id: "p-07",
        status: "paid",
        hostel_id: "hostel-active",
        room_id: "room-active",
        checked_in: true,
        checked_in_at: "2026-10-28T09:00:00.000Z",
        checked_out: false,
        checked_out_at: null,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
      "acc-already-checked-out": {
        id: "acc-already-checked-out",
        participant_id: "p-08",
        status: "paid",
        hostel_id: "hostel-active",
        room_id: "room-active",
        checked_in: true,
        checked_in_at: "2026-10-28T09:00:00.000Z",
        checked_out: true,
        checked_out_at: "2026-10-30T10:00:00.000Z",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
    };

    mockAllocations = {
      "alloc-valid": {
        id: "alloc-valid",
        participant_accommodation_id: "acc-valid",
        status: "active",
        hostel_id: "hostel-active",
        room_id: "room-active",
      },
      "alloc-unpaid": {
        id: "alloc-unpaid",
        participant_accommodation_id: "acc-unpaid",
        status: "active",
        hostel_id: "hostel-active",
        room_id: "room-active",
      },
      "alloc-inactive-hostel": {
        id: "alloc-inactive-hostel",
        participant_accommodation_id: "acc-inactive-hostel",
        status: "active",
        hostel_id: "hostel-inactive",
        room_id: "room-active",
      },
      "alloc-inactive-floor": {
        id: "alloc-inactive-floor",
        participant_accommodation_id: "acc-inactive-floor",
        status: "active",
        hostel_id: "hostel-active",
        room_id: "room-inactive-floor",
      },
      "alloc-inactive-room": {
        id: "alloc-inactive-room",
        participant_accommodation_id: "acc-inactive-room",
        status: "active",
        hostel_id: "hostel-active",
        room_id: "room-inactive",
      },
      "alloc-already-checked-in": {
        id: "alloc-already-checked-in",
        participant_accommodation_id: "acc-already-checked-in",
        status: "active",
        hostel_id: "hostel-active",
        room_id: "room-active",
      },
      "alloc-already-checked-out": {
        id: "alloc-already-checked-out",
        participant_accommodation_id: "acc-already-checked-out",
        status: "active",
        hostel_id: "hostel-active",
        room_id: "room-active",
      },
    };

    // Default auth: Authenticated admin with accommodation_access = true
    vi.spyOn(serverLib, "requireAccommodationAdmin").mockResolvedValue({
      supabase: {} as any,
      user: { id: "admin-master-id", email: "jashan082006@gmail.com" } as any,
      role: "master",
      accommodation_access: true,
      error: null,
      status: 200,
    });
  });

  // 1. Paid + allocated participant can check in
  it("1. Paid + allocated participant can check in", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-valid",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.checked_in).toBe(true);
    expect(data.data.checked_in_at).toBeTruthy();
    expect(mockAccommodations["acc-valid"].checked_in).toBe(true);
    expect(mockAuditLogs.some((l) => l.action_type === "ACCOMMODATION_CHECK_IN")).toBe(true);
  });

  // 2. Unpaid participant cannot check in
  it("2. Unpaid participant cannot check in", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-unpaid",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("UNPAID");
    expect(mockAccommodations["acc-unpaid"].checked_in).toBe(false);
  });

  // 3. Paid but unallocated participant cannot check in
  it("3. Paid but unallocated participant cannot check in", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-unallocated",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("UNALLOCATED");
    expect(mockAccommodations["acc-unallocated"].checked_in).toBe(false);
  });

  // 4. Inactive hostel prevents check-in
  it("4. Inactive hostel prevents check-in", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-inactive-hostel",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("HOSTEL_INACTIVE");
    expect(mockAccommodations["acc-inactive-hostel"].checked_in).toBe(false);
  });

  // 5. Inactive floor prevents check-in
  it("5. Inactive floor prevents check-in", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-inactive-floor",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("FLOOR_INACTIVE");
    expect(mockAccommodations["acc-inactive-floor"].checked_in).toBe(false);
  });

  // 6. Inactive room prevents check-in
  it("6. Inactive room prevents check-in", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-inactive-room",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("ROOM_INACTIVE");
    expect(mockAccommodations["acc-inactive-room"].checked_in).toBe(false);
  });

  // 7. Already checked-in participant cannot check in twice
  it("7. Already checked-in participant cannot check in twice", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-already-checked-in",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("ALREADY_CHECKED_IN");
  });

  // 8. Participant can check out after check-in
  it("8. Participant can check out after check-in", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-out", {
      participantAccommodationId: "acc-already-checked-in",
    });
    const res = await checkOutPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.checked_out).toBe(true);
    expect(data.data.checked_out_at).toBeTruthy();
    expect(mockAccommodations["acc-already-checked-in"].checked_out).toBe(true);
    expect(mockAuditLogs.some((l) => l.action_type === "ACCOMMODATION_CHECK_OUT")).toBe(true);
  });

  // 9. Participant cannot check out before check-in
  it("9. Participant cannot check out before check-in", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-out", {
      participantAccommodationId: "acc-valid", // checked_in = false
    });
    const res = await checkOutPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("NOT_CHECKED_IN");
    expect(mockAccommodations["acc-valid"].checked_out).toBe(false);
  });

  // 10. Already checked-out participant cannot check out twice
  it("10. Already checked-out participant cannot check out twice", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-out", {
      participantAccommodationId: "acc-already-checked-out",
    });
    const res = await checkOutPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("ALREADY_CHECKED_OUT");
  });

  // 11. Normal admin without accommodation_access receives 403
  it("11. Normal admin without accommodation_access receives 403", async () => {
    vi.spyOn(serverLib, "requireAccommodationAdmin").mockResolvedValue({
      supabase: {} as any,
      user: { id: "admin-normal-id", email: "jashan.cgcu@gmail.com" } as any,
      role: "admin",
      accommodation_access: false,
      error: "Accommodation access required",
      status: 403,
    });

    const checkInRes = await checkInPOST(
      makeRequest("http://localhost/api/admin/accommodations/check-in", {
        participantAccommodationId: "acc-valid",
      })
    );
    expect(checkInRes.status).toBe(403);

    const checkOutRes = await checkOutPOST(
      makeRequest("http://localhost/api/admin/accommodations/check-out", {
        participantAccommodationId: "acc-already-checked-in",
      })
    );
    expect(checkOutRes.status).toBe(403);
  });

  // 12. Unauthenticated receives 401
  it("12. Unauthenticated receives 401", async () => {
    vi.spyOn(serverLib, "requireAccommodationAdmin").mockResolvedValue({
      supabase: {} as any,
      user: null as any,
      role: null as any,
      accommodation_access: false,
      error: "Unauthorized",
      status: 401,
    });

    const checkInRes = await checkInPOST(
      makeRequest("http://localhost/api/admin/accommodations/check-in", {
        participantAccommodationId: "acc-valid",
      })
    );
    expect(checkInRes.status).toBe(401);

    const checkOutRes = await checkOutPOST(
      makeRequest("http://localhost/api/admin/accommodations/check-out", {
        participantAccommodationId: "acc-already-checked-in",
      })
    );
    expect(checkOutRes.status).toBe(401);
  });

  // 13. Event check-in remains independent
  it("13. Event check-in remains independent", async () => {
    // Check-in and check-out routes only query accommodation tables, never participant_events
    const checkInSrc = fs.readFileSync(
      path.join(process.cwd(), "app", "api", "admin", "accommodations", "check-in", "route.ts"),
      "utf-8"
    );
    const checkOutSrc = fs.readFileSync(
      path.join(process.cwd(), "app", "api", "admin", "accommodations", "check-out", "route.ts"),
      "utf-8"
    );

    expect(checkInSrc).not.toContain('from("participant_events")');
    expect(checkOutSrc).not.toContain('from("participant_events")');
    expect(checkInSrc).not.toContain("participantEventId");
    expect(checkOutSrc).not.toContain("participantEventId");
  });

  // 14. Main registration check-in remains independent
  it("14. Main registration check-in remains independent", async () => {
    // Check-in and check-out routes never update participants.checked_in
    const checkInSrc = fs.readFileSync(
      path.join(process.cwd(), "app", "api", "admin", "accommodations", "check-in", "route.ts"),
      "utf-8"
    );
    const checkOutSrc = fs.readFileSync(
      path.join(process.cwd(), "app", "api", "admin", "accommodations", "check-out", "route.ts"),
      "utf-8"
    );

    expect(checkInSrc).not.toContain('from("participants").update');
    expect(checkOutSrc).not.toContain('from("participants").update');
  });

  // 15. Check-in does not modify allocation
  it("15. Check-in does not modify allocation", async () => {
    const allocBefore = { ...mockAllocations["alloc-valid"] };
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-valid",
    });
    await checkInPOST(req);
    const allocAfter = mockAllocations["alloc-valid"];
    expect(allocAfter.status).toBe("active");
    expect(allocAfter.hostel_id).toBe(allocBefore.hostel_id);
    expect(allocAfter.room_id).toBe(allocBefore.room_id);
  });

  // 16. Checkout does not modify allocation
  it("16. Checkout does not modify allocation", async () => {
    const allocBefore = { ...mockAllocations["alloc-already-checked-in"] };
    const req = makeRequest("http://localhost/api/admin/accommodations/check-out", {
      participantAccommodationId: "acc-already-checked-in",
    });
    await checkOutPOST(req);
    const allocAfter = mockAllocations["alloc-already-checked-in"];
    expect(allocAfter.status).toBe("active");
    expect(allocAfter.hostel_id).toBe(allocBefore.hostel_id);
    expect(allocAfter.room_id).toBe(allocBefore.room_id);
  });

  // 17. Check-in sets checked_in_at
  it("17. Check-in sets checked_in_at timestamp", async () => {
    const beforeTime = Date.now() - 1000;
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-valid",
    });
    const res = await checkInPOST(req);
    const data = await res.json();
    expect(data.data.checked_in_at).toBeTruthy();
    const checkInTime = new Date(data.data.checked_in_at).getTime();
    expect(checkInTime).toBeGreaterThanOrEqual(beforeTime);
  });

  // 18. Checkout sets checked_out_at
  it("18. Checkout sets checked_out_at timestamp", async () => {
    const beforeTime = Date.now() - 1000;
    const req = makeRequest("http://localhost/api/admin/accommodations/check-out", {
      participantAccommodationId: "acc-already-checked-in",
    });
    const res = await checkOutPOST(req);
    const data = await res.json();
    expect(data.data.checked_out_at).toBeTruthy();
    const checkOutTime = new Date(data.data.checked_out_at).getTime();
    expect(checkOutTime).toBeGreaterThanOrEqual(beforeTime);
  });

  // 19. Concurrent check-in is safe
  it("19. Concurrent check-in is safe and returns safe conflict status", async () => {
    simulateConcurrentCheckInRace = true;
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-valid",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(["ALREADY_CHECKED_IN", "CONCURRENT_CONFLICT"]).toContain(data.error.code);
  });

  // 20. Concurrent checkout is safe
  it("20. Concurrent checkout is safe and returns safe conflict status", async () => {
    simulateConcurrentCheckOutRace = true;
    const req = makeRequest("http://localhost/api/admin/accommodations/check-out", {
      participantAccommodationId: "acc-already-checked-in",
    });
    const res = await checkOutPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(["ALREADY_CHECKED_OUT", "CONCURRENT_CONFLICT"]).toContain(data.error.code);
  });

  // 21. Client cannot spoof paid status
  it("21. Client cannot spoof paid status via payload", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-unpaid",
      status: "paid", // Attempt to spoof
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("UNPAID");
  });

  // 22. Client cannot spoof allocation status
  it("22. Client cannot spoof allocation status via payload", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-unallocated",
      hostel_id: "hostel-active",
      room_id: "room-active", // Attempt to spoof
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("UNALLOCATED");
  });

  // 23. Client cannot spoof admin role
  it("23. Client cannot spoof admin role or permissions via request headers/body", async () => {
    vi.spyOn(serverLib, "requireAccommodationAdmin").mockResolvedValue({
      supabase: {} as any,
      user: { id: "unauthorized-id", email: "user@example.com" } as any,
      role: "admin",
      accommodation_access: false,
      error: "Accommodation access required",
      status: 403,
    });

    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "acc-valid",
      role: "master",
      accommodation_access: true,
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(403);
  });

  // 24. Participant accommodation ID must be valid
  it("24. Participant accommodation ID must be valid (empty/whitespace rejected)", async () => {
    const emptyReq = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "   ",
    });
    const emptyRes = await checkInPOST(emptyReq);
    expect(emptyRes.status).toBe(400);
    const emptyData = await emptyRes.json();
    expect(emptyData.error.code).toBe("INVALID_INPUT");

    const missingReq = makeRequest("http://localhost/api/admin/accommodations/check-in", {});
    const missingRes = await checkInPOST(missingReq);
    expect(missingRes.status).toBe(400);
    const missingData = await missingRes.json();
    expect(missingData.error.code).toBe("INVALID_INPUT");
  });

  // 25. Invalid accommodation ID returns safe error
  it("25. Invalid accommodation ID returns safe 404 error", async () => {
    const req = makeRequest("http://localhost/api/admin/accommodations/check-in", {
      participantAccommodationId: "non-existent-acc-id",
    });
    const res = await checkInPOST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("NOT_FOUND");
  });

  // Scanner Protection Invariant Check
  it("Scanner Protection: Scanner files remain untouched and independent", () => {
    // Confirm existing scanner files exist
    const scannerPaths = [
      path.join(process.cwd(), "app", "admin", "scanner", "page.tsx"),
      path.join(process.cwd(), "app", "api", "admin", "check-in", "route.ts"),
    ];

    for (const p of scannerPaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8");
        // Ensure no accommodation mutations were injected into the main check-in scanner
        expect(content).not.toContain("participant_accommodations");
      }
    }
  });
});
