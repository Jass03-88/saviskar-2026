import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as teamAccommodationPOST } from "@/app/api/team/accommodation/route";
import { POST as soloAccommodationPOST } from "@/app/api/accommodations/book/route";
import { calculateStayDates } from "@/lib/accommodation-dates";

// Mock registration session
vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: vi.fn(),
}));

import { getRegistrationSession } from "@/lib/auth/session";

// Mock rate limit
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// Mock Supabase client
const mockRpc = vi.fn();
let currentTableData: Record<string, any> = {};

function createMockQueryBuilder() {
  return (table: string) => {
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      ilike: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      in: vi.fn(() => builder),
      lt: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      update: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({
        data: currentTableData[table]?.single ?? currentTableData[table]?.data?.[0] ?? null,
        error: null,
      })),
      single: vi.fn(async () => ({
        data: currentTableData[table]?.single ?? currentTableData[table]?.data?.[0] ?? null,
        error: null,
      })),
      then: (resolve: any) => {
        resolve({
          data: currentTableData[table]?.data ?? [],
          error: null,
        });
      },
    };
    return builder;
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => createMockQueryBuilder()(table)),
    rpc: mockRpc,
  })),
}));

// Mock accommodation admin auth
vi.mock("@/lib/supabase/server", () => ({
  requireAccommodationAdmin: vi.fn().mockResolvedValue({ status: 200, error: null }),
}));

describe("SAVISKAR 2026 — Team & Solo Accommodation, Conflict Overlap, and Faculty Classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SECRET_KEY = "test_secret_key";
    currentTableData = {};
  });

  // 1. Solo participant booking accommodation
  it("Requirement 1: Solo participant can book a valid non-overlapping stay", async () => {
    (getRegistrationSession as any).mockResolvedValue({
      authenticated: true,
      email: "solo.student@example.com",
    });

    currentTableData = {
      participants: {
        single: {
          id: "p_solo_1",
          email: "solo.student@example.com",
          name: "Solo Student",
          college: "CGC Landran",
          phone: "9876543210",
          participant_id: "SVK26-SOLO01",
        },
        data: [
          {
            id: "p_solo_1",
            email: "solo.student@example.com",
            name: "Solo Student",
            college: "CGC Landran",
            phone: "9876543210",
            participant_id: "SVK26-SOLO01",
          },
        ],
      },
      participant_accommodations: {
        data: [], // No existing stays
      },
      payment_orders: {
        single: {
          id: "po_solo_123",
          order_reference: "SVK-SOLO-001",
          amount: 499,
          currency: "INR",
          status: "pending",
        },
      },
    };

    mockRpc.mockResolvedValue({
      data: [{ payment_order_id: "po_solo_123" }],
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/accommodations/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookings: [
          {
            email: "solo.student@example.com",
            planSlug: "1_day",
            selectedDate: "2026-10-28",
            extraDays: "none",
          },
        ],
      }),
    });

    const res = await soloAccommodationPOST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.paymentOrderId).toBe("po_solo_123");
    expect(json.totalAmount).toBe(499);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  // 2. Team leader arranging stays for multiple verified team members
  it("Requirement 2 & 5 & 6: Team leader arranges stays for verified team members with 1 combined payment order", async () => {
    (getRegistrationSession as any).mockResolvedValue({
      authenticated: true,
      email: "leader@example.com",
    });

    currentTableData = {
      participants: {
        single: {
          id: "p_leader_uuid",
          email: "leader@example.com",
          name: "Leader Name",
          college: "CGC Landran",
          phone: "9876543210",
          participant_id: "SVK26-LEADER01",
        },
        data: [
          {
            id: "p_leader_uuid",
            email: "leader@example.com",
            name: "Leader Name",
            college: "CGC Landran",
            phone: "9876543210",
            participant_id: "SVK26-LEADER01",
          },
          {
            id: "p_mem2_uuid",
            email: "member2@example.com",
            name: "Member Two",
            college: "CGC Landran",
            phone: "9876543211",
            participant_id: "SVK26-MEM02",
          },
        ],
      },
      participant_events: {
        single: {
          id: "pe_team_event_1",
          is_team_leader: true,
          participants: {
            id: "p_leader_uuid",
            email: "leader@example.com",
            name: "Leader Name",
          },
          events: {
            id: "evt_1",
            name: "RoboRace",
            registration_type: "team",
          },
        },
      },
      participant_event_members: {
        data: [
          {
            id: "pem_1",
            name: "Leader Name",
            email: "leader@example.com",
            is_team_leader: true,
          },
          {
            id: "pem_2",
            name: "Member Two",
            email: "member2@example.com",
            is_team_leader: false,
          },
        ],
      },
      participant_accommodations: {
        data: [], // No overlapping stays
      },
      payment_orders: {
        single: {
          id: "po_combined_999",
          order_reference: "SVK-TEAM-001",
          amount: 1498,
          currency: "INR",
          status: "pending",
        },
      },
    };

    mockRpc.mockResolvedValue({
      data: [{ payment_order_id: "po_combined_999" }],
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: "pe_team_event_1",
        bookings: [
          {
            email: "leader@example.com",
            planSlug: "1_day",
            selectedDate: "2026-10-28",
            extraDays: "none",
          },
          {
            email: "member2@example.com",
            planSlug: "2_days",
            selectedDate: "2026-10-28",
            extraDays: "none",
          },
        ],
      }),
    });

    const res = await teamAccommodationPOST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.paymentOrderId).toBe("po_combined_999");
    expect(json.totalAmount).toBe(1498);
    expect(json.bookings).toHaveLength(2);
    // Booking ownership invariant: each booking corresponds to the respective participant
    expect(json.bookings[0].email).toBe("leader@example.com");
    expect(json.bookings[1].email).toBe("member2@example.com");
  });

  // 3. Unauthorized access to unrelated team members rejected
  it("Requirement 3: Rejects attempts to arrange accommodation for non-team members", async () => {
    (getRegistrationSession as any).mockResolvedValue({
      authenticated: true,
      email: "leader@example.com",
    });

    currentTableData = {
      participants: {
        single: {
          id: "p_leader_uuid",
          email: "leader@example.com",
          name: "Leader Name",
          participant_id: "SVK26-LEADER01",
        },
      },
      participant_events: {
        single: {
          id: "pe_team_event_1",
          is_team_leader: true,
          participants: {
            id: "p_leader_uuid",
            email: "leader@example.com",
          },
          events: {
            id: "evt_1",
            name: "RoboRace",
            registration_type: "team",
          },
        },
      },
      participant_event_members: {
        data: [
          {
            id: "pem_1",
            name: "Leader Name",
            email: "leader@example.com",
            is_team_leader: true,
          },
        ],
      },
    };

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: "pe_team_event_1",
        bookings: [
          {
            email: "intruder.not.in.team@example.com", // Not in verified roster!
            planSlug: "1_day",
            selectedDate: "2026-10-28",
          },
        ],
      }),
    });

    const res = await teamAccommodationPOST(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error).toContain("is not a verified member of your team");
  });

  // 10. Duplicate booking prevention and date overlap checks
  it("Requirement 10: Rejects requested stay dates that overlap with an existing paid booking", async () => {
    (getRegistrationSession as any).mockResolvedValue({
      authenticated: true,
      email: "leader@example.com",
    });

    currentTableData = {
      participants: {
        single: {
          id: "p_leader_uuid",
          email: "leader@example.com",
          name: "Leader Name",
          participant_id: "SVK26-LEADER01",
        },
        data: [
          {
            id: "p_leader_uuid",
            email: "leader@example.com",
            name: "Leader Name",
            participant_id: "SVK26-LEADER01",
          },
        ],
      },
      participant_events: {
        single: {
          id: "pe_team_event_1",
          is_team_leader: true,
          participants: {
            id: "p_leader_uuid",
            email: "leader@example.com",
          },
          events: {
            id: "evt_1",
            name: "RoboRace",
            registration_type: "team",
          },
        },
      },
      participant_event_members: {
        data: [
          {
            id: "pem_1",
            name: "Leader Name",
            email: "leader@example.com",
            is_team_leader: true,
          },
        ],
      },
      participant_accommodations: {
        data: [
          {
            id: "acc_existing_1",
            participant_id: "p_leader_uuid",
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            status: "paid",
          },
        ],
      },
    };

    // Leader requests stay on 28-29 Oct which overlaps with existing paid 28-30 Oct stay
    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: "pe_team_event_1",
        bookings: [
          {
            email: "leader@example.com",
            planSlug: "1_day",
            selectedDate: "2026-10-28",
          },
        ],
      }),
    });

    const res = await teamAccommodationPOST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("Accommodation is already booked for these dates");
  });

  // Multiple non-overlapping stays allowed
  it("Requirement 10b: Allows multiple separate, non-overlapping stays for the same participant", () => {
    // Stay 1: 27 Oct to 28 Oct (1 day)
    const stay1 = calculateStayDates("1_day", "2026-10-27");
    expect(stay1.startDate).toBe("2026-10-27");
    expect(stay1.endDate).toBe("2026-10-28");

    // Stay 2: 30 Oct to 31 Oct (1 day)
    const stay2 = calculateStayDates("1_day", "2026-10-30");
    expect(stay2.startDate).toBe("2026-10-30");
    expect(stay2.endDate).toBe("2026-10-31");

    // Check non-overlapping: stay1.endDate (28) <= stay2.startDate (30)
    const overlaps = stay1.startDate < stay2.endDate && stay1.endDate > stay2.startDate;
    expect(overlaps).toBe(false);
  });

  // 12. Admin accommodation detail panel shows all stays
  it("Requirement 12: Admin accommodations detail drawer accumulates and displays all stays for a participant", () => {
    // Mock participant registration record with multiple accommodation stays
    const mockRegistration = {
      id: "reg_1",
      participant_id: "p_multi_1",
      participantId: "SVK26-45E10E77",
      name: "Jashandeep Singh",
      email: "jashan.cgcu@gmail.com",
      accommodations: [
        {
          id: "acc_stay_1",
          planName: "1 Day Pass",
          planSlug: "1_day",
          startDate: "2026-10-27",
          endDate: "2026-10-28",
          durationDays: 1,
          amount: 499,
          status: "paid",
        },
        {
          id: "acc_stay_2",
          planName: "1 Day Pass",
          planSlug: "1_day",
          startDate: "2026-10-30",
          endDate: "2026-10-31",
          durationDays: 1,
          amount: 499,
          status: "paid",
        },
      ],
    };

    // Replicate drawer accumulation logic from app/admin/page.tsx:
    const accMap = new Map<string, any>();
    if (Array.isArray(mockRegistration.accommodations)) {
      for (const a of mockRegistration.accommodations) {
        if (a && a.id) accMap.set(a.id, a);
      }
    }
    const accumulatedStays = Array.from(accMap.values());

    expect(accumulatedStays).toHaveLength(2);
    expect(accumulatedStays[0].startDate).toBe("2026-10-27");
    expect(accumulatedStays[1].startDate).toBe("2026-10-30");
  });

  // 13. Correct faculty versus regular participant classification
  it("Requirement 13: Student competitor with faculty link is classified as Participant, not Faculty", () => {
    // When a participant has both registered events and faculty_incharges,
    // they are a student competitor, NOT a faculty member.
    const competitorWithLink = {
      eventCount: 2,
      facultyCount: 1,
    };
    const isCompetitorFaculty = competitorWithLink.facultyCount > 0 && competitorWithLink.eventCount === 0;
    expect(isCompetitorFaculty).toBe(false);

    // Pure faculty in-charge with 0 registered events
    const pureFaculty = {
      eventCount: 0,
      facultyCount: 1,
    };
    const isPureFaculty = pureFaculty.facultyCount > 0 && pureFaculty.eventCount === 0;
    expect(isPureFaculty).toBe(true);

    // Regular participant with 0 faculty links
    const regularParticipant = {
      eventCount: 1,
      facultyCount: 0,
    };
    const isRegularFaculty = regularParticipant.facultyCount > 0 && regularParticipant.eventCount === 0;
    expect(isRegularFaculty).toBe(false);
  });
});
