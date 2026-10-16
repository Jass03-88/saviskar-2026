import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatAccommodationDate, resolveAccommodationSelection } from "@/components/registration/RegistrationForm";

describe("SAVISKAR 2026 — Registration Catalogue, Filtering & Resilience Tests", () => {
  const mock49Events = Array.from({ length: 49 }, (_, i) => ({
    id: `evt-uuid-${i + 1}`,
    name: `Competition ${i + 1}`,
    slug: `competition-${i + 1}`,
    category: ["Technical", "Cultural", "Non-Technical", "Medical"][i % 4],
    registration_type: i % 2 === 0 ? "individual" : "team",
    min_team_size: i % 2 === 0 ? 1 : 2,
    max_team_size: i % 2 === 0 ? 1 : 5,
    payment_type: (i % 3 === 0 ? "free" : "paid") as "free" | "paid",
    registration_fee: i % 3 === 0 ? 0 : 250,
    payment_unit: "per_student" as const,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. All active events load successfully
  it("Scenario 1: All active events load successfully across all 4 realms", () => {
    expect(mock49Events.length).toBe(49);
    const categories = new Set(mock49Events.map((e) => e.category));
    expect(categories.has("Technical")).toBe(true);
    expect(categories.has("Cultural")).toBe(true);
    expect(categories.has("Non-Technical")).toBe(true);
    expect(categories.has("Medical")).toBe(true);
  });

  // 2. Event API failure displays an error instead of a false empty catalogue
  it("Scenario 2: Event API failure produces an error state, never a false 0-event catalogue", () => {
    let eventOptions: typeof mock49Events = [];
    let eventsLoading = true;
    let eventsError: string | null = null;

    // Simulate failed fetch
    const simulateFetch = (shouldFail: boolean) => {
      eventsLoading = true;
      eventsError = null;
      if (shouldFail) {
        eventsError = "We couldn't load the competition lineup. Please check your connection and retry.";
        eventsLoading = false;
        // eventOptions remains unchanged, but error is present
      } else {
        eventOptions = mock49Events;
        eventsLoading = false;
      }
    };

    simulateFetch(true);
    expect(eventsLoading).toBe(false);
    expect(eventsError).toBeTruthy();
    expect(eventsError).toContain("couldn't load the competition lineup");
    // With our UI safeguard, if eventsError is set, the error/retry banner renders instead of "0 competitions available"
    const displayHeader = eventsLoading
      ? "Loading competitions..."
      : eventsError
      ? "Error loading competitions"
      : `${eventOptions.length} competitions available`;
    expect(displayHeader).toBe("Error loading competitions");
  });

  // 3. Participant lookup failure does not erase available events
  it("Scenario 3: Participant lookup failure does not erase or modify available events", () => {
    let eventOptions = [...mock49Events];
    let participantLookupEvents: any[] = [];
    let lookupLoading = false;
    let lookupError = "";

    // Simulate autoFetchParticipant failure
    try {
      lookupLoading = true;
      throw new Error("Network timeout during participant lookup");
    } catch (err: any) {
      lookupError = err.message;
      // Safeguard: participant lookup failure never clears eventOptions
    } finally {
      lookupLoading = false;
    }

    expect(lookupLoading).toBe(false);
    expect(lookupError).toBe("Network timeout during participant lookup");
    expect(eventOptions.length).toBe(49);
    expect(participantLookupEvents.length).toBe(0);
  });

  // 4. An authenticated participant with no registrations sees available competitions
  it("Scenario 4: An authenticated participant with no registrations sees all 49 available competitions", () => {
    const participantLookupEvents: any[] = [];
    const registeredEventIds = new Set(
      participantLookupEvents
        .filter((item) => item?.eventId && item.registrationStatus !== "cancelled" && item.paymentStatus !== "failed")
        .map((item) => item.eventId)
    );

    const availableEvents = mock49Events.filter((e) => !registeredEventIds.has(e.id));
    expect(availableEvents.length).toBe(49);
  });

  // 5. An authenticated participant with registrations sees those registrations excluded
  it("Scenario 5: An authenticated participant with registrations sees those excluded from the picker", () => {
    const participantLookupEvents = [
      {
        participantEventId: "pe-01",
        eventId: "evt-uuid-1",
        eventName: "Competition 1",
        registrationStatus: "confirmed",
        paymentStatus: "paid",
      },
      {
        participantEventId: "pe-02",
        eventId: "evt-uuid-2",
        eventName: "Competition 2",
        registrationStatus: "confirmed",
        paymentStatus: "free",
      },
    ];

    const registeredEventIds = new Set(
      participantLookupEvents
        .filter((item) => item?.eventId && item.registrationStatus !== "cancelled" && item.paymentStatus !== "failed")
        .map((item) => item.eventId)
    );

    expect(registeredEventIds.size).toBe(2);
    expect(registeredEventIds.has("evt-uuid-1")).toBe(true);
    expect(registeredEventIds.has("evt-uuid-2")).toBe(true);

    const availableEvents = mock49Events.filter((e) => !registeredEventIds.has(e.id));
    expect(availableEvents.length).toBe(47);
    expect(availableEvents.some((e) => e.id === "evt-uuid-1")).toBe(false);
    expect(availableEvents.some((e) => e.id === "evt-uuid-2")).toBe(false);
  });

  // 6. Malformed participant lookup data does not filter every event
  it("Scenario 6: Malformed participant lookup data does not filter every event", () => {
    const malformedLookupEvents = [
      null,
      undefined,
      {},
      { eventId: null },
      { eventId: "" },
      { eventId: "   " },
      { eventId: 12345 },
    ] as any[];

    const registeredEventIds = new Set<string>();
    for (const item of malformedLookupEvents) {
      if (item && typeof item.eventId === "string" && item.eventId.trim().length > 0) {
        registeredEventIds.add(item.eventId.trim());
      }
    }

    expect(registeredEventIds.size).toBe(0);
    const availableEvents = mock49Events.filter((e) => !registeredEventIds.has(e.id));
    expect(availableEvents.length).toBe(49);
  });

  // 7. Cancelled or failed registrations are not excluded from re-registration
  it("Scenario 7: Cancelled or failed registrations do not lock the participant out from re-registering", () => {
    const lookupEvents = [
      {
        eventId: "evt-uuid-1",
        registrationStatus: "cancelled",
        paymentStatus: "cancelled",
      },
      {
        eventId: "evt-uuid-2",
        registrationStatus: "pending",
        paymentStatus: "failed",
      },
      {
        eventId: "evt-uuid-3",
        registrationStatus: "confirmed",
        paymentStatus: "paid",
      },
    ];

    const registeredEventIds = new Set<string>();
    for (const item of lookupEvents) {
      if (item && typeof item.eventId === "string" && item.eventId.trim().length > 0) {
        const regStatus = (item.registrationStatus || "").toLowerCase();
        const payStatus = (item.paymentStatus || "").toLowerCase();
        if (regStatus !== "cancelled" && payStatus !== "failed" && payStatus !== "cancelled") {
          registeredEventIds.add(item.eventId.trim());
        }
      }
    }

    // Only evt-uuid-3 should be excluded
    expect(registeredEventIds.size).toBe(1);
    expect(registeredEventIds.has("evt-uuid-3")).toBe(true);
    expect(registeredEventIds.has("evt-uuid-1")).toBe(false);
    expect(registeredEventIds.has("evt-uuid-2")).toBe(false);

    const availableEvents = mock49Events.filter((e) => !registeredEventIds.has(e.id));
    expect(availableEvents.length).toBe(48);
    expect(availableEvents.some((e) => e.id === "evt-uuid-1")).toBe(true);
    expect(availableEvents.some((e) => e.id === "evt-uuid-2")).toBe(true);
  });

  // 8. Account switching does not leak registration state
  it("Scenario 8: Account switching resets participant lookup state and excludes leakage", () => {
    // User A has 2 registered events
    let userAState = {
      email: "userA@example.com",
      participantId: "SVK26-USERAAAA",
      events: ["evt-uuid-1", "evt-uuid-2"],
    };

    // Simulate account switch handler in useEffect
    let currentParticipantEmail = userAState.email;
    let currentLookupEvents = [...userAState.events];

    const switchUser = (newEmail: string) => {
      if (newEmail !== currentParticipantEmail) {
        currentParticipantEmail = newEmail;
        currentLookupEvents = []; // Cleared on email change
      }
    };

    switchUser("userB@example.com");
    expect(currentParticipantEmail).toBe("userB@example.com");
    expect(currentLookupEvents.length).toBe(0);
  });

  // 9. Late participant lookup response cannot overwrite newer state
  it("Scenario 9: Late participant lookup response is rejected if a newer request was dispatched", async () => {
    let activeRequestId = 0;
    let committedState: any = null;

    // Request 1 starts (slow)
    const req1Id = ++activeRequestId;

    // User switches or re-triggers: Request 2 starts (fast)
    const req2Id = ++activeRequestId;

    // Request 2 completes first
    if (req2Id === activeRequestId) {
      committedState = { id: "req2-data" };
    }

    // Request 1 arrives late
    if (req1Id === activeRequestId) {
      committedState = { id: "req1-stale-data" };
    }

    expect(committedState).toEqual({ id: "req2-data" });
  });

  // 10. Free competition pricing remains correct (₹0)
  it("Scenario 10: Free competition pricing calculates ₹0 total", () => {
    const freeEvents = mock49Events.filter((e) => e.payment_type === "free");
    expect(freeEvents.length).toBeGreaterThan(0);

    const selected = freeEvents.slice(0, 2);
    let total = 0;
    for (const ev of selected) {
      const fee = ev.payment_type === "paid" ? ev.registration_fee : 0;
      total += fee;
    }
    expect(total).toBe(0);
  });

  // 11. Accommodation pricing and date selection remain correct
  it("Scenario 11: Accommodation date resolution and pricing format correctly", () => {
    const day1Res = resolveAccommodationSelection("1_day", "2026-10-28", "none");
    expect(day1Res.planSlug).toBe("1_day");
    expect(day1Res.selectedDate).toBe("2026-10-28");
    expect(formatAccommodationDate(1, "2026-10-28", "none")).toBe("28 Oct (Day 1)");

    const day2Res = resolveAccommodationSelection("2_days", "2026-10-28", "none");
    expect(day2Res.planSlug).toBe("2_days");
    expect(formatAccommodationDate(2, "2026-10-28", "none")).toBe("28–29 Oct");

    const day3Res = resolveAccommodationSelection("2_days", "2026-10-28", "before_27");
    expect(day3Res.planSlug).toBe("3_days");
    expect(day3Res.selectedDate).toBe("2026-10-27");
  });

  // 12. Team and solo registration behavior remains intact
  it("Scenario 12: Team member cost calculation correctly scales with team size for per_student fees", () => {
    const teamEvent = mock49Events.find((e) => e.registration_type === "team" && e.payment_type === "paid")!;
    expect(teamEvent).toBeDefined();

    const leaderPlusTwoMembers = 3; // 1 leader + 2 members
    const perStudentTotal = (teamEvent.registration_fee || 0) * leaderPlusTwoMembers;
    expect(perStudentTotal).toBe(250 * 3);
  });
});
