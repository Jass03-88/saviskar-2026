import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/analytics/route";
import * as serverLib from "@/lib/supabase/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

const mockEventsDb = [
  {
    id: "evt-1",
    name: "Robo Race",
    category: "technical",
    registration_type: "team",
    registration_fee: 500,
    registration_limit: 50,
    active: true,
  },
  {
    id: "evt-2",
    name: "Canvas Art",
    category: "cultural",
    registration_type: "individual",
    registration_fee: 200,
    registration_limit: 100,
    active: true,
  },
];

const mockParticipantsDb = [
  {
    id: "p-1",
    participant_id: "SVK-1",
    name: "Alice",
    college: "CGC Landran",
    gender: "female",
    state: "Punjab",
    created_at: "2026-10-01T10:00:00Z",
  },
  {
    id: "p-2",
    participant_id: "SVK-2",
    name: "Bob",
    college: "Thapar University",
    gender: "male",
    state: "Haryana",
    created_at: "2026-10-02T10:00:00Z",
  },
  {
    id: "p-3",
    participant_id: "SVK-3",
    name: "Charlie",
    college: "CGC Landran",
    gender: "male",
    state: "Punjab",
    created_at: "2026-10-03T10:00:00Z",
  },
];

const mockParticipantEventsDb = [
  {
    id: "pe-1",
    participant_id: "p-1",
    event_id: "evt-1",
    registration_status: "confirmed",
    payment_status: "paid",
    payment_amount: 500,
    team_name: "Alpha",
    checked_in: true,
    main_checked_in: false,
    created_at: "2026-10-01T11:00:00Z",
  },
  {
    id: "pe-2",
    participant_id: "p-2",
    event_id: "evt-2",
    registration_status: "confirmed",
    payment_status: "paid",
    payment_amount: 200,
    team_name: null,
    checked_in: false,
    main_checked_in: false,
    created_at: "2026-10-02T11:00:00Z",
  },
  {
    id: "pe-3",
    participant_id: "p-3",
    event_id: "evt-1",
    registration_status: "confirmed",
    payment_status: "pending",
    payment_amount: 500,
    team_name: "Beta",
    checked_in: false,
    main_checked_in: false,
    created_at: "2026-10-03T11:00:00Z",
  },
];

function createMockAdminClient() {
  return {
    from: (table: string) => {
      if (table === "events") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: mockEventsDb, error: null }),
          }),
        };
      }
      if (table === "participant_events") {
        return {
          select: () => ({
            neq: (_field: string, _val: any) => ({
              in: (_inField: string, ids: string[]) =>
                Promise.resolve({
                  data: mockParticipantEventsDb.filter((pe) => ids.includes(pe.event_id)),
                  error: null,
                }),
              then: (resolve: any) =>
                resolve({ data: mockParticipantEventsDb, error: null }),
            }),
          }),
        };
      }
      if (table === "participants") {
        return {
          select: () => ({
            in: (_field: string, ids: string[]) =>
              Promise.resolve({
                data: mockParticipantsDb.filter((p) => ids.includes(p.id)),
                error: null,
              }),
            then: (resolve: any) =>
              resolve({ data: mockParticipantsDb, error: null }),
          }),
        };
      }
      if (table === "participant_accommodations") {
        return {
          select: () => ({
            neq: () =>
              Promise.resolve({
                data: [
                  {
                    id: "acc-1",
                    participant_id: "p-1",
                    status: "paid",
                    amount: 499,
                    start_date: "2026-10-28",
                    end_date: "2026-10-29",
                    checked_in: true,
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
      };
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createMockAdminClient(),
}));

describe("GET /api/admin/analytics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
      error: "Unauthorized",
      status: 401,
      user: null,
      role: null,
      accommodation_access: false,
      assigned_category: null,
      assigned_events: [],
    } as any);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns full analytics INCLUDING revenue for master admin", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
      error: null,
      status: 200,
      user: { id: "master-user-id", email: "master@saviskar.co.in" },
      role: "master",
      accommodation_access: true,
      assigned_category: null,
      assigned_events: [],
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.isMaster).toBe(true);
    expect(body.role).toBe("master");

    // Overview Stats
    expect(body.overview.totalParticipants).toBe(3);
    expect(body.overview.totalRegistrations).toBe(3);
    expect(body.overview.totalTeams).toBe(2);

    // Revenue must be present and populated for master admin
    expect(body.overview.revenue).not.toBeNull();
    expect(body.overview.revenue.totalExpected).toBeGreaterThan(0);
    expect(body.overview.revenue.totalPaid).toBeGreaterThan(0);
    expect(body.overview.revenue.events.paid).toBe(700); // 500 + 200
    expect(body.overview.revenue.accommodations.paid).toBe(499);

    // State-wise breakdown
    expect(body.stateWise.length).toBeGreaterThan(0);
    const punjab = body.stateWise.find((s: any) => s.state === "Punjab");
    expect(punjab).toBeDefined();
    expect(punjab.participantCount).toBe(2);

    // Event-wise breakdown includes revenue for master
    expect(body.eventWise[0]).toHaveProperty("revenue");

    // Accommodations include revenue for master
    expect(body.accommodations).toHaveProperty("paidRevenue");
  });

  it("strictly HIDES and excludes all revenue stats for normal admins", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
      error: null,
      status: 200,
      user: { id: "admin-user-id", email: "admin@saviskar.co.in" },
      role: "admin",
      accommodation_access: false,
      assigned_category: null,
      assigned_events: [],
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.isMaster).toBe(false);
    expect(body.role).toBe("admin");

    // Overview Metrics available
    expect(body.overview.totalParticipants).toBe(3);
    expect(body.overview.totalRegistrations).toBe(3);

    // REVENUE MUST BE STRICTLY NULL FOR NORMAL ADMIN
    expect(body.overview.revenue).toBeNull();

    // Event-wise items must NOT expose revenue property
    for (const ev of body.eventWise) {
      expect(ev.revenue).toBeUndefined();
    }

    // State-wise breakdown is available
    expect(body.stateWise.length).toBeGreaterThan(0);
  });
});
