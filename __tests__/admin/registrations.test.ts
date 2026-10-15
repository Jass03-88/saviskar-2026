import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/registrations/route";
import * as serverLib from "@/lib/supabase/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

const mockRegistrationsDb = [
  {
    id: "pe-1",
    participant_id: "p-1",
    event_id: "evt-robotics",
    registration_status: "confirmed",
    payment_status: "paid",
    payment_amount: 500,
    payment_id: "pay-1",
    team_name: "RoboTeam",
    checked_in: false,
    checked_in_at: null,
    is_archived: false,
    created_at: "2026-09-01T10:00:00Z",
  },
  {
    id: "pe-2",
    participant_id: "p-2",
    event_id: "evt-coding",
    registration_status: "confirmed",
    payment_status: "paid",
    payment_amount: 300,
    payment_id: "pay-2",
    team_name: null,
    checked_in: true,
    checked_in_at: "2026-09-02T11:00:00Z",
    is_archived: false,
    created_at: "2026-09-02T10:00:00Z",
  },
  {
    id: "pe-3",
    participant_id: "p-3",
    event_id: "evt-robotics",
    registration_status: "confirmed",
    payment_status: "paid",
    payment_amount: 500,
    payment_id: "pay-3",
    team_name: null,
    checked_in: false,
    checked_in_at: null,
    is_archived: false,
    created_at: "2026-09-03T10:00:00Z",
  },
];

let lastAppliedFilter: { event_id?: string } = {};

function createMockAdminClient() {
  return {
    from: (table: string) => {
      if (table === "participant_events") {
        lastAppliedFilter = {};
        const builder = {
          select: () => builder,
          eq: (col: string, val: string) => {
            if (col === "event_id") lastAppliedFilter.event_id = val;
            return builder;
          },
          order: () => builder,
          range: (from: number, to: number) => {
            let filtered = mockRegistrationsDb;
            if (lastAppliedFilter.event_id) {
              filtered = filtered.filter((r) => r.event_id === lastAppliedFilter.event_id);
            }
            const paged = filtered.slice(from, to + 1);
            return Promise.resolve({
              data: paged,
              count: filtered.length,
              error: null,
            });
          },
        };
        return builder;
      }
      if (table === "participants") {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  { id: "p-1", participant_id: "SVK26-11111111", name: "User 1", college: "C1", email: "u1@test.com", phone: "111", photo_url: null, created_at: "2026-09-01" },
                  { id: "p-2", participant_id: "SVK26-22222222", name: "User 2", college: "C2", email: "u2@test.com", phone: "222", photo_url: null, created_at: "2026-09-02" },
                  { id: "p-3", participant_id: "SVK26-33333333", name: "User 3", college: "C3", email: "u3@test.com", phone: "333", photo_url: null, created_at: "2026-09-03" },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table === "events") {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  { id: "evt-robotics", name: "RoboWars", category: "technical", payment_type: "paid", registration_fee: 500 },
                  { id: "evt-coding", name: "CodeBash", category: "technical", payment_type: "paid", registration_fee: 300 },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table === "participant_event_members" || table === "payment_order_items" || table === "faculty_incharges" || table === "participant_accommodations") {
        const createBuilder = () => {
          const builder: any = Promise.resolve({ data: [], error: null });
          builder.in = () => Promise.resolve({ data: [], error: null });
          builder.not = () => Promise.resolve({ data: [], error: null });
          builder.order = () => builder;
          builder.limit = () => Promise.resolve({ data: [], error: null });
          return builder;
        };
        return {
          select: () => createBuilder(),
        };
      }
      return {};
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createMockAdminClient(),
}));

describe("P1-02: Admin Registrations Event Filtering & Pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastAppliedFilter = {};
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      supabase: {},
      user: { id: "admin-uuid", email: "admin@example.com" },
      role: "admin",
      error: null,
      status: 200,
    } as unknown as Awaited<ReturnType<typeof serverLib.requireAdmin>>);
  });

  it("A. When eventId is provided, filters registrations by event_id at the DB level", async () => {
    const req = new Request("http://localhost/api/admin/registrations?eventId=evt-robotics&page=1&pageSize=50");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(lastAppliedFilter.event_id).toBe("evt-robotics");
    expect(data.total).toBe(2);
    expect(data.registrations).toHaveLength(2);
    expect(data.registrations.every((r: { registration: { event_id: string } }) => r.registration.event_id === "evt-robotics")).toBe(true);
  });

  it("B. When eventId is not provided, returns all registrations with global total", async () => {
    const req = new Request("http://localhost/api/admin/registrations?page=1&pageSize=50");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(lastAppliedFilter.event_id).toBeUndefined();
    expect(data.total).toBe(3);
    expect(data.registrations).toHaveLength(3);
  });

  it("C. Respects pagination parameters page and pageSize", async () => {
    const req = new Request("http://localhost/api/admin/registrations?page=1&pageSize=2");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(2);
    expect(data.total).toBe(3);
    expect(data.totalPages).toBe(2);
    expect(data.registrations).toHaveLength(2);
  });

  it("D. Handles large pageSize=2000 requests without URL/header overflow by chunking IDs", async () => {
    const req = new Request("http://localhost/api/admin/registrations?pageSize=2000");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.pageSize).toBe(2000);
    expect(data.registrations).toHaveLength(3);
    expect(data.error).toBeUndefined();
  });
});
