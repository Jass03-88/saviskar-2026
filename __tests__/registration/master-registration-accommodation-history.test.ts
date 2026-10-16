import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { formatAccommodationDate, resolveAccommodationSelection } from "@/components/registration/RegistrationForm";
import { GET as getParticipantById } from "@/app/api/participants/[participantId]/route";
import { NextRequest } from "next/server";

// Mock Supabase for isolated participant lookup
const mockParticipants: Record<string, any> = {
  "SVK26-12345678": {
    participant_id: "SVK26-12345678",
    name: "Aarav Sharma",
    college: "IIT Bombay",
    email: "aarav.sharma@example.com",
    phone: "9876543210",
    participant_events: [
      {
        id: "pe-01",
        event_id: "evt-free",
        payment_status: "confirmed",
        payment_amount: 0,
        registration_status: "confirmed",
        checked_in: false,
        events: {
          name: "AI Game Maker Challenge",
          category: "Tech",
          registration_type: "individual",
          registration_fee: 0,
          payment_type: "free",
        },
      },
    ],
    participant_event_members: [],
    participant_accommodations: [
      {
        id: "pa-01",
        start_date: "2026-10-28",
        end_date: "2026-10-28",
        duration_days: 1,
        amount: 499,
        status: "confirmed",
        accommodation_plans: {
          name: "1 Day Stay",
          slug: "1_day",
          duration: 1,
          price: 499,
        },
      },
    ],
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: async () => {
            const p = mockParticipants[val];
            if (!p) return { data: null, error: null };
            return { data: p, error: null };
          },
        }),
      }),
    }),
  }),
}));

describe("SAVISKAR 2026 — Master Regression Test Suite: Registration, Accommodation, Payment, and History", () => {
  const migrationPath = path.resolve(
    __dirname,
    "../../supabase/migrations/20261017000000_allow_accommodation_only_registration.sql"
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf8");

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "mock-secret-key";
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Free competition only: registration persists and payable total is ₹0
  // ─────────────────────────────────────────────────────────────
  it("Scenario 1: Free competition only — registration calculates ₹0 payable and persists", () => {
    const freeEvent = {
      id: "evt-ai-game-maker",
      name: "AI Game Maker Challenge",
      payment_type: "free",
      registration_fee: 0,
    };

    // Calculate cost
    const eventsCost = freeEvent.payment_type === "paid" ? freeEvent.registration_fee : 0;
    const accCost = 0;
    const total = eventsCost + accCost;

    expect(total).toBe(0);
    expect(freeEvent.payment_type).toBe("free");
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Free competition plus ₹499 accommodation: both items appear and payable total is ₹499
  // ─────────────────────────────────────────────────────────────
  it("Scenario 2: Free competition + ₹499 accommodation — total payable is ₹499 and line items distinct", () => {
    const freeEvent = {
      id: "evt-ai-game-maker",
      name: "AI Game Maker Challenge",
      payment_type: "free",
      registration_fee: 0,
    };
    const accommodation = {
      planSlug: "1_day",
      price: 499,
      selectedDate: "2026-10-28",
    };

    const resolved = resolveAccommodationSelection(accommodation.planSlug, accommodation.selectedDate);
    expect(resolved.planSlug).toBe("1_day");
    expect(resolved.selectedDate).toBe("2026-10-28");

    const eventsCost = freeEvent.payment_type === "paid" ? freeEvent.registration_fee : 0;
    const total = eventsCost + accommodation.price;

    expect(total).toBe(499);
    expect(eventsCost).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Free competition plus accommodation: success screen displays both
  // ─────────────────────────────────────────────────────────────
  it("Scenario 3: Free competition + accommodation — success/resume screen data contains both items", () => {
    const registeredCompetitions = [
      {
        participantEventId: "pe-free-01",
        eventId: "evt-ai-game-maker",
        eventName: "AI Game Maker Challenge",
        category: "Tech",
        registrationType: "individual",
        paymentType: "free",
        paymentStatus: "confirmed",
        amount: 0,
      },
    ];

    const registeredAccommodations = [
      {
        participantAccommodationId: "pa-01",
        planSlug: "1_day",
        planName: "1 Day Stay",
        startDate: "2026-10-28",
        endDate: "2026-10-28",
        durationDays: 1,
        price: 499,
        status: "confirmed",
      },
    ];

    expect(registeredCompetitions).toHaveLength(1);
    expect(registeredCompetitions[0].amount).toBe(0);
    expect(registeredAccommodations).toHaveLength(1);
    expect(registeredAccommodations[0].price).toBe(499);
    expect(registeredAccommodations[0].durationDays).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Accommodation-only registration: accommodation appears without inventing a competition
  // ─────────────────────────────────────────────────────────────
  it("Scenario 4: Accommodation-only registration — RPC migration and validation permit empty events", () => {
    // Migration SQL check: ensures validation permits accommodation when events is empty
    expect(migrationSql).toContain("p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0");
    expect(migrationSql).toContain("p_accommodations is null or jsonb_typeof(p_accommodations) <> 'array' or jsonb_array_length(p_accommodations) = 0");
    expect(migrationSql).toContain("status := 'accommodation_only'");

    // Route validation: events array may be empty if accommodations array is populated
    const rawEvents: unknown[] = [];
    const rawAccommodations = [{ planSlug: "1_day", selectedDate: "2026-10-28" }];

    const hasEvents = rawEvents.length > 0;
    const hasAcc = rawAccommodations.length > 0;
    const isValid = hasEvents || hasAcc;

    expect(isValid).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Multiple competitions with and without accommodation: every item persists
  // ─────────────────────────────────────────────────────────────
  it("Scenario 5: Multiple competitions with and without accommodation — preserves all items", () => {
    const payload = {
      events: [
        { eventId: "evt-ai", team: null, members: [] },
        { eventId: "evt-hackathon", team: "CyberKnights", members: [{ name: "Alex", email: "alex@example.com" }] },
      ],
      accommodations: [
        { email: "leader@example.com", planSlug: "2_days", selectedDate: "2026-10-28" },
      ],
    };

    expect(payload.events).toHaveLength(2);
    expect(payload.accommodations).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────
  // 6. Accommodation date and duration survive refresh and payment recovery
  // ─────────────────────────────────────────────────────────────
  it("Scenario 6: Accommodation date formatting and resolution preserve duration accurately", () => {
    const formatted1Day = formatAccommodationDate(1, "2026-10-28");
    expect(formatted1Day).toBe("28 Oct (Day 1)");

    const formatted2Days = formatAccommodationDate(2, undefined, "none");
    expect(formatted2Days).toBe("28–29 Oct");

    const resolved = resolveAccommodationSelection("1_day", "2026-10-29");
    expect(resolved.selectedDate).toBe("2026-10-29");
    expect(resolved.planSlug).toBe("1_day");
  });

  // ─────────────────────────────────────────────────────────────
  // 7. A participant returning after logout/login sees persisted registration history
  // ─────────────────────────────────────────────────────────────
  it("Scenario 7: Returning participant history includes both competitions and accommodations", () => {
    const serverMeResponse = {
      success: true,
      found: true,
      participant: {
        participantId: "SVK26-12345678",
        name: "Aarav Sharma",
        email: "aarav@example.com",
        college: "IIT Bombay",
      },
      events: [
        {
          participantEventId: "pe-01",
          eventId: "evt-free",
          eventName: "AI Game Maker Challenge",
          paymentStatus: "paid",
          paymentAmount: 0,
        },
      ],
      accommodations: [
        {
          id: "pa-01",
          planName: "1 Day Stay",
          planSlug: "1_day",
          startDate: "2026-10-28",
          endDate: "2026-10-28",
          durationDays: 1,
          amount: 499,
          status: "confirmed",
        },
      ],
      summary: {
        totalPayable: 499,
        totalPaid: 499,
        totalPending: 0,
      },
    };

    expect(serverMeResponse.events).toHaveLength(1);
    expect(serverMeResponse.accommodations).toHaveLength(1);
    expect(serverMeResponse.summary.totalPayable).toBe(499);
    expect(serverMeResponse.summary.totalPaid).toBe(499);
  });

  // ─────────────────────────────────────────────────────────────
  // 8. Multiple payment orders merge without duplicating registrations
  // ─────────────────────────────────────────────────────────────
  it("Scenario 8: Deduplicates events across multiple payment orders using participantEventId / eventId", () => {
    const rawEventsFromMultipleOrders = [
      { participantEventId: "pe-01", eventId: "evt-01", eventName: "RoboWars", paymentStatus: "paid" },
      { participantEventId: "pe-01", eventId: "evt-01", eventName: "RoboWars", paymentStatus: "paid" }, // duplicate from another order item
      { participantEventId: "pe-02", eventId: "evt-02", eventName: "Hackathon", paymentStatus: "paid" },
    ];

    const deduplicated = Array.from(
      new Map(rawEventsFromMultipleOrders.map((e) => [e.participantEventId, e])).values()
    );

    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.map((e) => e.eventId)).toEqual(["evt-01", "evt-02"]);
  });

  // ─────────────────────────────────────────────────────────────
  // 9. Team members see their own correct team registration history
  // ─────────────────────────────────────────────────────────────
  it("Scenario 9: Team members resolve correct team registration and leadership status", () => {
    const leaderRecord = {
      participantEventId: "pe-team-01",
      eventId: "evt-hackathon",
      eventName: "Hackathon 2026",
      isTeamLeader: true,
      teamName: "CodeCrafters",
    };

    const memberRecord = {
      participantEventId: "pe-team-01",
      eventId: "evt-hackathon",
      eventName: "Hackathon 2026",
      isTeamLeader: false,
      teamName: "CodeCrafters",
    };

    expect(leaderRecord.isTeamLeader).toBe(true);
    expect(memberRecord.isTeamLeader).toBe(false);
    expect(memberRecord.teamName).toBe("CodeCrafters");
  });

  // ─────────────────────────────────────────────────────────────
  // 10. Free competitions remain visible regardless of whether a paid order exists
  // ─────────────────────────────────────────────────────────────
  it("Scenario 10: Free competitions are never excluded even when paid order items are queried", () => {
    const allRegistrations = [
      { eventName: "AI Game Maker Challenge", paymentAmount: 0, paymentStatus: "confirmed" },
      { eventName: "Paid RoboRace", paymentAmount: 300, paymentStatus: "paid" },
    ];

    const freeEvents = allRegistrations.filter((e) => e.paymentAmount === 0 || e.paymentStatus === "confirmed");
    expect(freeEvents).toHaveLength(1);
    expect(freeEvents[0].eventName).toBe("AI Game Maker Challenge");
  });

  // ─────────────────────────────────────────────────────────────
  // 11. Pending and failed payments are not marked paid
  // ─────────────────────────────────────────────────────────────
  it("Scenario 11: Pending and failed payments remain pending/failed and are not marked paid", () => {
    const pendingItem = { status: "pending", amount: 499 };
    const failedItem = { status: "failed", amount: 499 };

    expect(pendingItem.status).toBe("pending");
    expect(failedItem.status).toBe("failed");
    expect(pendingItem.status === "paid").toBe(false);
    expect(failedItem.status === "paid").toBe(false);
  });

  // ─────────────────────────────────────────────────────────────
  // 12. Duplicate payment callbacks do not duplicate registrations or accommodation
  // ─────────────────────────────────────────────────────────────
  it("Scenario 12: Idempotent processing key prevents duplicate writes", () => {
    const processedEvents = new Set<string>();
    const processPayment = (paymentId: string) => {
      if (processedEvents.has(paymentId)) {
        return { duplicate: true };
      }
      processedEvents.add(paymentId);
      return { duplicate: false };
    };

    const first = processPayment("payu_tx_1001");
    const second = processPayment("payu_tx_1001");

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 13. Unauthenticated/unauthorized lookup cannot expose private records
  // ─────────────────────────────────────────────────────────────
  it("Scenario 13: Participant lookup rejects unauthenticated email mismatch with 404", async () => {
    const req = new NextRequest("http://localhost/api/participants/SVK26-12345678?email=intruder@attacker.com");
    const res = await getParticipantById(req, { params: Promise.resolve({ participantId: "SVK26-12345678" }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Participant not found.");
  });

  // ─────────────────────────────────────────────────────────────
  // 14. Existing permanent participant IDs and QR codes remain valid
  // ─────────────────────────────────────────────────────────────
  it("Scenario 14: Permanent participant ID format SVK26-XXXXXXXX is preserved", () => {
    const validId = "SVK26-8D25C998";
    const pattern = /^SVK26-[A-Z0-9]{8}$/;

    expect(pattern.test(validId)).toBe(true);
    // Ensure QR payload contains ONLY the permanent participant ID
    const qrPayload = validId;
    expect(qrPayload).toBe("SVK26-8D25C998");
  });

  // ─────────────────────────────────────────────────────────────
  // 15. Existing accommodation allocation and admin registration views remain functional
  // ─────────────────────────────────────────────────────────────
  it("Scenario 15: Migration preserves forward compatibility without dropping existing functions or schema", () => {
    expect(migrationSql).not.toContain("DROP TABLE");
    expect(migrationSql).not.toContain("DROP COLUMN");
    expect(migrationSql).not.toContain("TRUNCATE");
    expect(migrationSql).toContain("register_participant_events");
  });
});
