import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../../app/api/admin/accommodations/activity/route";
import * as serverSupabase from "../../lib/supabase/server";

const mockAuditLogs = [
  {
    id: "audit-1",
    admin_id: "admin-1",
    action_type: "ACCOMMODATION_CHECK_IN",
    target_id: "pa-1",
    created_at: "2026-10-02T10:00:00.000Z",
    details: { bulk_operation: false }
  },
  {
    id: "audit-2",
    admin_id: "admin-2",
    action_type: "ACCOMMODATION_CHECK_IN",
    target_id: "pa-2",
    created_at: "2026-10-02T10:05:00.000Z",
    details: { bulk_operation: true }
  }
];

const mockAllocations = [
  {
    id: "alloc-1",
    participant_accommodation_id: "pa-1",
    status: "active",
    reason: "Auto-allocated",
    allocated_by: "admin-1",
    created_at: "2026-10-02T09:00:00.000Z",
    participant_accommodations: [{ participants: [{ participant_id: "S-100", name: "Alice" }] }],
    hostels: [{ name: "Hostel A" }],
    hostel_rooms: [{ room_number: "101", hostel_floors: [{ floor_number: 1 }] }]
  },
  {
    id: "alloc-2",
    participant_accommodation_id: "pa-1",
    status: "reassigned",
    reason: "Moved",
    allocated_by: "admin-1",
    created_at: "2026-10-02T08:00:00.000Z",
    participant_accommodations: [{ participants: [{ participant_id: "S-100", name: "Alice" }] }],
    hostels: [{ name: "Hostel A" }],
    hostel_rooms: [{ room_number: "100", hostel_floors: [{ floor_number: 1 }] }]
  }
];

const mockParticipantsData = [
  {
    id: "pa-1",
    participants: [{ participant_id: "S-100", name: "Alice" }],
    hostels: [{ name: "Hostel A" }],
    hostel_rooms: [{ room_number: "101", hostel_floors: [{ floor_number: 1 }] }]
  },
  {
    id: "pa-2",
    participants: [{ participant_id: "S-101", name: "Bob" }],
    hostels: [{ name: "Hostel B" }],
    hostel_rooms: [{ room_number: "202", hostel_floors: [{ floor_number: 2 }] }]
  }
];

const mockAdmins = [
  { id: "admin-1", email: "master@example.com" },
  { id: "admin-2", email: "admin@example.com" }
];

vi.mock("../../lib/supabase/server", () => ({
  requireAccommodationAdmin: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => {
  const chainable = (data: any, error = null) => {
    const obj: any = {
      select: () => obj,
      eq: () => obj,
      or: () => obj,
      in: () => obj,
      limit: () => obj,
      range: () => obj,
      order: () => obj,
      data,
      error
    };
    obj.then = (resolve: any) => resolve({ data, error });
    return obj;
  };

  return {
    createClient: () => ({
      from: (table: string) => {
        if (table === "accommodation_allocations") return chainable(mockAllocations);
        if (table === "admin_audit_logs") return chainable(mockAuditLogs);
        if (table === "participant_accommodations") return chainable(mockParticipantsData);
        return chainable([]);
      },
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({ data: { users: mockAdmins } })
        }
      }
    })
  };
});

describe("Operational Activity & Audit API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://test";
    process.env.SUPABASE_SECRET_KEY = "test-key";
  });

  it("1. Rejects unauthenticated requests", async () => {
    vi.mocked(serverSupabase.requireAccommodationAdmin).mockResolvedValue({ error: "UNAUTHORIZED", status: 401 } as any);
    const req = new Request("http://localhost/api/admin/accommodations/activity");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("2. Returns merged and sorted activity logs (history preservation)", async () => {
    vi.mocked(serverSupabase.requireAccommodationAdmin).mockResolvedValue({ user: { id: "admin-1" } } as any);
    const req = new Request("http://localhost/api/admin/accommodations/activity?pageSize=10");
    const res = await GET(req);
    const data = await res.json();
    
    expect(data.success).toBe(true);
    // 2 audit logs + 2 allocations = 4 total activities
    expect(data.data.totalCount).toBe(4);
    expect(data.data.activities).toHaveLength(4);
    
    // Check sorting (most recent first)
    const timestamps = data.data.activities.map((a: any) => new Date(a.timestamp).getTime());
    expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
    expect(timestamps[1]).toBeGreaterThanOrEqual(timestamps[2]);
    expect(timestamps[2]).toBeGreaterThanOrEqual(timestamps[3]);
    
    // Check mapping
    const checkIn = data.data.activities.find((a: any) => a.action === "CHECK_IN" && a.participant_id === "S-100");
    expect(checkIn).toBeDefined();
    expect(checkIn.bulk_operation).toBe(false);
    expect(checkIn.admin_email).toBe("master@example.com");

    const realloc = data.data.activities.find((a: any) => a.action === "REALLOCATION");
    expect(realloc).toBeDefined();
    expect(realloc.bulk_operation).toBe(false);
    
    const bulkCheckIn = data.data.activities.find((a: any) => a.bulk_operation === true);
    expect(bulkCheckIn.action).toBe("CHECK_IN");
    expect(bulkCheckIn.participant_name).toBe("Bob");
  });

  it("3. Supports pagination", async () => {
    vi.mocked(serverSupabase.requireAccommodationAdmin).mockResolvedValue({ user: { id: "admin-1" } } as any);
    const req = new Request("http://localhost/api/admin/accommodations/activity?page=2&pageSize=2");
    const res = await GET(req);
    const data = await res.json();
    
    expect(data.success).toBe(true);
    expect(data.data.totalCount).toBe(4);
    expect(data.data.activities).toHaveLength(2); // Page 2 has the last 2 items
    expect(data.data.page).toBe(2);
  });

  it("4. Filters by action type (ALLOCATION)", async () => {
    vi.mocked(serverSupabase.requireAccommodationAdmin).mockResolvedValue({ user: { id: "admin-1" } } as any);
    const req = new Request("http://localhost/api/admin/accommodations/activity?action=ALLOCATION");
    const res = await GET(req);
    const data = await res.json();
    
    expect(data.success).toBe(true);
    const hasOnlyAlloc = data.data.activities.every((a: any) => a.action === "ALLOCATION");
    expect(hasOnlyAlloc).toBe(true);
    expect(data.data.activities).toHaveLength(1);
  });

  it("5. Filters by bulk operation", async () => {
    vi.mocked(serverSupabase.requireAccommodationAdmin).mockResolvedValue({ user: { id: "admin-1" } } as any);
    const req = new Request("http://localhost/api/admin/accommodations/activity?bulk=true");
    const res = await GET(req);
    const data = await res.json();
    
    expect(data.success).toBe(true);
    expect(data.data.activities).toHaveLength(1);
    expect(data.data.activities[0].bulk_operation).toBe(true);
    expect(data.data.activities[0].action).toBe("CHECK_IN");
  });

  it("6. Filters by participant ID (search)", async () => {
    vi.mocked(serverSupabase.requireAccommodationAdmin).mockResolvedValue({ user: { id: "admin-1" } } as any);
    const req = new Request("http://localhost/api/admin/accommodations/activity?participant=bob");
    const res = await GET(req);
    const data = await res.json();
    
    expect(data.success).toBe(true);
    expect(data.data.activities).toHaveLength(1);
    expect(data.data.activities[0].participant_name).toBe("Bob");
  });
  
  it("7. Filters by individual operation", async () => {
    vi.mocked(serverSupabase.requireAccommodationAdmin).mockResolvedValue({ user: { id: "admin-1" } } as any);
    const req = new Request("http://localhost/api/admin/accommodations/activity?bulk=false");
    const res = await GET(req);
    const data = await res.json();
    
    expect(data.success).toBe(true);
    const hasOnlyIndividual = data.data.activities.every((a: any) => a.bulk_operation === false);
    expect(hasOnlyIndividual).toBe(true);
    expect(data.data.activities).toHaveLength(3);
  });
});
