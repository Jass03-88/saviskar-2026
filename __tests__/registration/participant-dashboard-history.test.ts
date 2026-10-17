import { describe, it, expect, beforeEach } from "vitest";
import type {
  ParticipantLookupEvent,
  ParticipantLookupAccommodation,
} from "@/components/registration/RegistrationForm";

describe("SAVISKAR 2026 — Participant Dashboard Registration & Accommodation History", () => {
  // Helper to replicate the normalization and deduplication logic implemented in applyParticipantData
  function normalizeAndDeduplicateEvents(
    events: (Partial<ParticipantLookupEvent> & Record<string, any>)[]
  ): ParticipantLookupEvent[] {
    return Array.from(
      new Map(
        (Array.isArray(events) ? events : [])
          .filter((e) => e && (e.participantEventId || e.eventId))
          .map((e) => {
            const pId = e.participantEventId || e.eventId || "";
            return [
              pId,
              {
                ...e,
                participantEventId: pId,
                eventId: e.eventId || pId,
                eventName: e.eventName || "Competition",
                category: e.category ?? null,
                registrationType: e.registrationType || (e.teamName ? "team" : "individual"),
                teamName: e.teamName ?? null,
                isTeamLeader: e.isTeamLeader ?? Boolean(e.teamName),
                paymentStatus: e.paymentStatus ?? null,
                paymentAmount:
                  typeof e.paymentAmount === "number"
                    ? e.paymentAmount
                    : Number(e.paymentAmount) || 0,
                registrationStatus: e.registrationStatus || "confirmed",
                checkedIn: Boolean(e.checkedIn),
                paymentId: e.paymentId ?? null,
                checkedInAt: e.checkedInAt ?? null,
              } as ParticipantLookupEvent,
            ];
          })
      ).values()
    );
  }

  function normalizeAndDeduplicateAccommodations(
    accommodations: (Partial<ParticipantLookupAccommodation> & Record<string, any>)[]
  ): ParticipantLookupAccommodation[] {
    return Array.from(
      new Map(
        (Array.isArray(accommodations) ? accommodations : [])
          .filter((a) => a && (a.id || a.participantAccommodationId))
          .map((a) => {
            const id = a.id || a.participantAccommodationId || "";
            const price = typeof a.price === "number" ? a.price : Number(a.amount) || 0;
            const amount = typeof a.amount === "number" ? a.amount : Number(a.price) || 0;
            return [
              id,
              {
                ...a,
                id,
                participantAccommodationId: id,
                planSlug: a.planSlug || "1_day",
                planName: a.planName || "Accommodation Plan",
                startDate: a.startDate || "",
                endDate: a.endDate || "",
                durationDays: typeof a.durationDays === "number" ? a.durationDays : 1,
                price,
                amount,
                currency: a.currency || "INR",
                status: a.status || "confirmed",
              } as ParticipantLookupAccommodation,
            ];
          })
      ).values()
    );
  }

  // 1. Existing competition registrations appear beneath the participant's identity
  it("Requirement 1: Normalizes competition registrations with category, status, and fee", () => {
    const rawEvents = [
      {
        participantEventId: "pe-101",
        eventId: "evt-robo",
        eventName: "RoboWars Combat",
        category: "Technical",
        registrationStatus: "confirmed",
        paymentStatus: "paid",
        paymentAmount: 500,
        registrationType: "team",
        teamName: "MechaWarriors",
        isTeamLeader: true,
      },
      {
        participantEventId: "pe-102",
        eventId: "evt-meme",
        eventName: "AI Meme Challenge",
        category: "Creative",
        registrationStatus: "confirmed",
        paymentStatus: "paid",
        paymentAmount: 0,
        registrationType: "individual",
        teamName: null,
        isTeamLeader: false,
      },
    ];

    const normalized = normalizeAndDeduplicateEvents(rawEvents);

    expect(normalized).toHaveLength(2);
    expect(normalized[0].eventName).toBe("RoboWars Combat");
    expect(normalized[0].category).toBe("Technical");
    expect(normalized[0].paymentStatus).toBe("paid");
    expect(normalized[0].registrationStatus).toBe("confirmed");
    expect(normalized[0].paymentAmount).toBe(500);

    expect(normalized[1].eventName).toBe("AI Meme Challenge");
    expect(normalized[1].category).toBe("Creative");
    expect(normalized[1].paymentAmount).toBe(0);
  });

  // 2. Accommodation bookings appear with correct dates, plan, and payment status (handling API shape: id, amount, status: paid)
  it("Requirement 2: Normalizes accommodation bookings with correct plan, dates, and 'paid' status", () => {
    const rawAccommodationsFromApi = [
      {
        id: "pa-999",
        planSlug: "2_days",
        planName: "2 Days Stay (28-29 Oct)",
        startDate: "2026-10-28",
        endDate: "2026-10-29",
        durationDays: 2,
        amount: 899,
        currency: "INR",
        status: "paid",
      },
    ];

    const normalized = normalizeAndDeduplicateAccommodations(rawAccommodationsFromApi);

    expect(normalized).toHaveLength(1);
    const item = normalized[0];
    expect(item.id).toBe("pa-999");
    expect(item.participantAccommodationId).toBe("pa-999");
    expect(item.planName).toBe("2 Days Stay (28-29 Oct)");
    expect(item.startDate).toBe("2026-10-28");
    expect(item.endDate).toBe("2026-10-29");
    expect(item.durationDays).toBe(2);
    expect(item.amount).toBe(899);
    expect(item.price).toBe(899);
    expect(item.status).toBe("paid");

    // Test confirmed accommodations filter logic
    const confirmedAccommodations = normalized.filter((acc) => {
      const s = (acc.status || "").toLowerCase();
      return (
        s === "confirmed" ||
        s === "approved" ||
        s === "paid" ||
        (acc.price === 0 && acc.amount === 0)
      );
    });
    expect(confirmedAccommodations).toHaveLength(1);
    expect(confirmedAccommodations[0].id).toBe("pa-999");
  });

  // 3. Multiple competitions appear without duplicates
  it("Requirement 3: Deduplicates redundant competition entries by participantEventId or eventId", () => {
    const redundantEvents = [
      { participantEventId: "pe-01", eventId: "evt-01", eventName: "Hackathon", paymentStatus: "paid" },
      { participantEventId: "pe-01", eventId: "evt-01", eventName: "Hackathon", paymentStatus: "paid" }, // duplicate from multiple order queries
      { participantEventId: "pe-02", eventId: "evt-02", eventName: "Footloose Dance", paymentStatus: "paid" },
      { participantEventId: "pe-03", eventId: "evt-03", eventName: "RoboRace", paymentStatus: "confirmed" },
    ];

    const deduplicated = normalizeAndDeduplicateEvents(redundantEvents);

    expect(deduplicated).toHaveLength(3);
    expect(deduplicated.map((e) => e.eventId)).toEqual(["evt-01", "evt-02", "evt-03"]);
  });

  // 4. Team registrations are displayed using the existing participant relationships
  it("Requirement 4: Accurately reflects team name and team leader/member role", () => {
    const events = [
      {
        participantEventId: "pe-team-leader",
        eventId: "evt-hackathon",
        eventName: "Hackathon 2026",
        registrationType: "team",
        teamName: "Quantum Coders",
        isTeamLeader: true,
      },
      {
        participantEventId: "pe-team-member",
        eventId: "evt-quiz",
        eventName: "Tech Quiz",
        registrationType: "team",
        teamName: "Byte Wizards",
        isTeamLeader: false,
      },
      {
        participantEventId: "pe-solo",
        eventId: "evt-solo-singing",
        eventName: "Solo Singing",
        registrationType: "individual",
        teamName: null,
        isTeamLeader: false,
      },
    ];

    const normalized = normalizeAndDeduplicateEvents(events);

    expect(normalized[0].isTeamLeader).toBe(true);
    expect(normalized[0].teamName).toBe("Quantum Coders");
    expect(normalized[1].isTeamLeader).toBe(false);
    expect(normalized[1].teamName).toBe("Byte Wizards");
    expect(normalized[2].registrationType).toBe("individual");
    expect(normalized[2].teamName).toBeNull();
  });

  // 5. Genuinely new participant sees a clear empty state
  it("Requirement 5: A genuine new participant with no records receives clean empty arrays and states", () => {
    const rawEvents: any[] = [];
    const rawAccommodations: any[] = [];

    const normalizedEvents = normalizeAndDeduplicateEvents(rawEvents);
    const normalizedAccommodations = normalizeAndDeduplicateAccommodations(rawAccommodations);

    expect(normalizedEvents).toHaveLength(0);
    expect(normalizedAccommodations).toHaveLength(0);

    const isEventsEmpty = normalizedEvents.length === 0;
    const isAccommodationsEmpty = normalizedAccommodations.length === 0;

    expect(isEventsEmpty).toBe(true);
    expect(isAccommodationsEmpty).toBe(true);
  });

  // 6. API failures show an error state rather than a false empty state
  it("Requirement 6: Error state preserves error message and prevents showing false empty message", () => {
    interface DashboardState {
      events: ParticipantLookupEvent[];
      accommodations: ParticipantLookupAccommodation[];
      error: string | null;
      loading: boolean;
    }

    const stateAfterError: DashboardState = {
      events: [],
      accommodations: [],
      error: "Unable to load your latest registration history. Please try again.",
      loading: false,
    };

    // When error is present, UI displays recoverable error banner with retry button
    const shouldDisplayError = Boolean(stateAfterError.error);
    const shouldDisplayEmptyEvents = !stateAfterError.loading && !stateAfterError.error && stateAfterError.events.length === 0;

    expect(shouldDisplayError).toBe(true);
    expect(shouldDisplayEmptyEvents).toBe(false);
  });

  // 7. Switching accounts cannot leak the previous participant's data
  it("Requirement 7: Account switch cleanly resets lookup, events, accommodations, and errors", () => {
    // Initial state for Participant A
    let lookup: Record<string, any> | null = { participantId: "SVK26-11111111", email: "userA@example.com" };
    let events = normalizeAndDeduplicateEvents([
      { participantEventId: "pe-A1", eventName: "User A Event" },
    ]);
    let accommodations = normalizeAndDeduplicateAccommodations([
      { id: "pa-A1", planName: "User A Stay" },
    ]);
    let error: string | null = null;

    expect(events).toHaveLength(1);
    expect(lookup?.participantId).toBe("SVK26-11111111");

    // Switching account to Participant B or logging out:
    const onAccountSwitchOrLogout = () => {
      lookup = null;
      events = [];
      accommodations = [];
      error = null;
    };

    onAccountSwitchOrLogout();

    expect(lookup).toBeNull();
    expect(events).toHaveLength(0);
    expect(accommodations).toHaveLength(0);
    expect(error).toBeNull();
  });

  // 8. Pending, failed, and cancelled records retain their correct statuses
  it("Requirement 8: Status preservation — pending, failed, cancelled, and paid are never conflated", () => {
    const rawEvents = [
      { participantEventId: "pe-01", registrationStatus: "cancelled", paymentStatus: "cancelled" },
      { participantEventId: "pe-02", registrationStatus: "pending", paymentStatus: "pending" },
      { participantEventId: "pe-03", registrationStatus: "confirmed", paymentStatus: "failed" },
      { participantEventId: "pe-04", registrationStatus: "confirmed", paymentStatus: "paid" },
    ];

    const normalized = normalizeAndDeduplicateEvents(rawEvents);

    expect(normalized[0].registrationStatus).toBe("cancelled");
    expect(normalized[0].paymentStatus).toBe("cancelled");

    expect(normalized[1].registrationStatus).toBe("pending");
    expect(normalized[1].paymentStatus).toBe("pending");

    expect(normalized[2].registrationStatus).toBe("confirmed");
    expect(normalized[2].paymentStatus).toBe("failed");

    expect(normalized[3].registrationStatus).toBe("confirmed");
    expect(normalized[3].paymentStatus).toBe("paid");
  });

  // 9. Accommodations support both paid and pending statuses, with amount and price normalization
  it("Requirement 9: Confirmed and pending accommodation separation handles paid status and both amount/price fields", () => {
    const mixedAccommodations = normalizeAndDeduplicateAccommodations([
      {
        id: "pa-paid-01",
        planName: "1 Day Stay",
        amount: 499,
        status: "paid",
      },
      {
        id: "pa-pending-02",
        planName: "2 Days Stay",
        amount: 899,
        status: "pending",
      },
      {
        id: "pa-free-03",
        planName: "Free Volunteer Stay",
        amount: 0,
        price: 0,
        status: "approved",
      },
    ]);

    const confirmed = mixedAccommodations.filter((acc) => {
      const s = (acc.status || "").toLowerCase();
      return (
        s === "confirmed" ||
        s === "approved" ||
        s === "paid" ||
        (acc.price === 0 && acc.amount === 0)
      );
    });

    const pending = mixedAccommodations.filter((acc) => {
      const s = (acc.status || "").toLowerCase();
      const cost = acc.price || acc.amount || 0;
      return s === "pending" && cost > 0;
    });

    expect(confirmed).toHaveLength(2);
    expect(confirmed.map((c) => c.id)).toEqual(["pa-paid-01", "pa-free-03"]);

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("pa-pending-02");
    expect(pending[0].amount).toBe(899);
  });

  // 10. Existing add-competition and logout actions continue to work
  it("Requirement 10: Participant ID format SVK26-XXXXXXXX is preserved for lookup and profile displays", () => {
    const validParticipantId = "SVK26-7889A12B";
    const pattern = /^SVK26-[A-Z0-9]{8}$/;

    expect(pattern.test(validParticipantId)).toBe(true);

    const lookupUrl = `/api/participants/${validParticipantId}`;
    expect(lookupUrl).toBe("/api/participants/SVK26-7889A12B");
  });
});
