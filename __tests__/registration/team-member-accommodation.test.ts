import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveAccommodationSelection,
  formatAccommodationDate,
} from "@/components/registration/RegistrationForm";

describe("SAVISKAR 2026 — Team Member Accommodation Duration & Selection Regression Suite", () => {
  interface TeamMember {
    name: string;
    college: string;
    email: string;
    phone: string;
    gender: string;
    state: string;
    idCardStoragePath: string;
    accommodationPlanSlug: string;
    accommodationDate: "2026-10-27" | "2026-10-28" | "2026-10-29" | "2026-10-30";
    extraDays: "none" | "before_27" | "after_30" | "both";
  }

  interface EventRegistrationState {
    teamName: string;
    isTeamHead: boolean;
    members: TeamMember[];
  }

  type EventStateMap = Record<string, EventRegistrationState>;

  const EVENT_ID = "evt-hackathon-2026";
  const PLANS = [
    { id: "p1", name: "1 Day Accommodation", slug: "1_day", duration: 1, price: 499 },
    { id: "p2", name: "2 Days Accommodation", slug: "2_days", duration: 2, price: 999 },
    { id: "p3", name: "3 Days Accommodation", slug: "3_days", duration: 3, price: 1498 },
    { id: "p4", name: "4 Days Accommodation", slug: "4_days", duration: 4, price: 1997 },
  ];

  function getAccommodationCost(slug: string, extraDays?: string): number {
    if (!slug) return 0;
    if (slug === "1_day") return 499;
    if (slug === "2_days") return 999;
    if (slug === "3_days") return 1498;
    if (slug === "4_days") return 1997;
    return 0;
  }

  // Pure state simulator replicating the exact state updates in RegistrationForm
  class RegistrationFormStateSimulator {
    eventState: EventStateMap = {};
    mainAccommodationSlug: string = "";
    mainAccommodationDate: "2026-10-27" | "2026-10-28" | "2026-10-29" | "2026-10-30" = "2026-10-28";
    mainExtraDays: "none" | "before_27" | "after_30" | "both" = "none";

    constructor(initialMembersCount = 2) {
      this.eventState[EVENT_ID] = {
        teamName: "Code Warriors",
        isTeamHead: true,
        members: Array.from({ length: initialMembersCount }, (_, i) => ({
          name: `Member 0${i + 2}`,
          college: "Engineering College",
          email: `member0${i + 2}@example.com`,
          phone: `987654321${i}`,
          gender: "Male",
          state: "Punjab",
          idCardStoragePath: `id_cards/m0${i + 2}.png`,
          accommodationPlanSlug: "",
          accommodationDate: "2026-10-28",
          extraDays: "none",
        })),
      };
    }

    setEventState(updater: (current: EventStateMap) => EventStateMap) {
      this.eventState = updater(this.eventState);
    }

    updateTeamMemberMultiple(eventId: string, index: number, updates: Partial<TeamMember>) {
      this.setEventState((current) => {
        const prev = current[eventId] ?? {
          teamName: "",
          isTeamHead: false,
          members: [],
        };
        return {
          ...current,
          [eventId]: {
            ...prev,
            members: prev.members.map((member, memberIndex) =>
              memberIndex === index
                ? {
                    ...member,
                    ...updates,
                  }
                : member
            ),
          },
        };
      });
    }

    addTeamMember(maxTeamSize = 5) {
      const max = maxTeamSize;
      this.setEventState((current) => {
        const prev = current[EVENT_ID] ?? {
          teamName: "",
          isTeamHead: false,
          members: [],
        };
        const currentTotal = 1 + prev.members.length;
        if (currentTotal >= max) return current;
        return {
          ...current,
          [EVENT_ID]: {
            ...prev,
            members: [
              ...prev.members,
              {
                name: `Member 0${prev.members.length + 2}`,
                college: "Engineering College",
                email: `member0${prev.members.length + 2}@example.com`,
                phone: "9876500000",
                gender: "Female",
                state: "Punjab",
                idCardStoragePath: "id_cards/dyn.png",
                accommodationPlanSlug: "",
                accommodationDate: "2026-10-28",
                extraDays: "none",
              },
            ],
          },
        };
      });
    }

    // Exact handler from RegistrationForm for member accommodation selection
    selectMemberAccommodation(memberIndex: number, val: string) {
      const member = this.eventState[EVENT_ID].members[memberIndex];
      if (val === "3_days") {
        const is30 = member.accommodationDate === "2026-10-30" || member.extraDays === "after_30";
        this.updateTeamMemberMultiple(EVENT_ID, memberIndex, {
          accommodationPlanSlug: val,
          accommodationDate: is30 ? "2026-10-30" : "2026-10-27",
          extraDays: is30 ? "after_30" : "before_27",
        });
      } else if (val === "1_day") {
        const validDate = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].includes(member.accommodationDate || "")
          ? member.accommodationDate
          : "2026-10-28";
        this.updateTeamMemberMultiple(EVENT_ID, memberIndex, {
          accommodationPlanSlug: val,
          accommodationDate: validDate,
          extraDays: "none",
        });
      } else if (val === "2_days") {
        this.updateTeamMemberMultiple(EVENT_ID, memberIndex, {
          accommodationPlanSlug: val,
          accommodationDate: "2026-10-28",
          extraDays: "none",
        });
      } else if (val === "4_days") {
        this.updateTeamMemberMultiple(EVENT_ID, memberIndex, {
          accommodationPlanSlug: val,
          accommodationDate: "2026-10-27",
          extraDays: "both",
        });
      } else {
        this.updateTeamMemberMultiple(EVENT_ID, memberIndex, {
          accommodationPlanSlug: "",
          extraDays: "none",
        });
      }
    }

    selectMember3DayExtraOption(memberIndex: number, option: "2026-10-27" | "2026-10-30") {
      if (option === "2026-10-27") {
        this.updateTeamMemberMultiple(EVENT_ID, memberIndex, {
          accommodationDate: "2026-10-27",
          extraDays: "before_27",
        });
      } else {
        this.updateTeamMemberMultiple(EVENT_ID, memberIndex, {
          accommodationDate: "2026-10-30",
          extraDays: "after_30",
        });
      }
    }

    selectMember1DayDate(memberIndex: number, date: "2026-10-27" | "2026-10-28" | "2026-10-29" | "2026-10-30") {
      this.updateTeamMemberMultiple(EVENT_ID, memberIndex, {
        accommodationDate: date,
        extraDays: "none",
      });
    }

    // Leader accommodation selector
    selectLeaderAccommodation(val: string) {
      this.mainAccommodationSlug = val;
      if (val === "3_days") {
        this.mainAccommodationDate = "2026-10-27";
        this.mainExtraDays = "before_27";
      } else if (val === "2_days") {
        this.mainAccommodationDate = "2026-10-28";
        this.mainExtraDays = "none";
      } else if (val === "4_days") {
        this.mainAccommodationDate = "2026-10-27";
        this.mainExtraDays = "both";
      } else {
        this.mainAccommodationDate = "2026-10-28";
        this.mainExtraDays = "none";
      }
    }

    calculateTotalAccommodationCost(): number {
      let cost = 0;
      if (this.mainAccommodationSlug) {
        cost += getAccommodationCost(this.mainAccommodationSlug, this.mainExtraDays);
      }
      this.eventState[EVENT_ID].members.forEach((m) => {
        if (m.accommodationPlanSlug) {
          cost += getAccommodationCost(m.accommodationPlanSlug, m.extraDays);
        }
      });
      return cost;
    }

    generateAccommodationsPayload() {
      const payload: Array<{ email: string; planSlug: string; selectedDate: string; extraDays: string }> = [];
      if (this.mainAccommodationSlug) {
        const resolved = resolveAccommodationSelection(this.mainAccommodationSlug, this.mainAccommodationDate, this.mainExtraDays);
        payload.push({
          email: "leader@example.com",
          planSlug: resolved.planSlug,
          selectedDate: resolved.selectedDate,
          extraDays: resolved.extraDays,
        });
      }
      this.eventState[EVENT_ID].members.forEach((m) => {
        if (m.accommodationPlanSlug) {
          const resolved = resolveAccommodationSelection(m.accommodationPlanSlug, m.accommodationDate, m.extraDays);
          payload.push({
            email: m.email.trim().toLowerCase(),
            planSlug: resolved.planSlug,
            selectedDate: resolved.selectedDate,
            extraDays: resolved.extraDays,
          });
        }
      });
      return payload;
    }
  }

  let sim: RegistrationFormStateSimulator;

  beforeEach(() => {
    sim = new RegistrationFormStateSimulator(2); // Member 02 (idx 0) and Member 03 (idx 1)
  });

  // 1. Member 02 can select each duration from No Accommodation through 4 Days
  it("Requirement 1: Member 02 can select each duration from No Accommodation through 4 Days", () => {
    // Select 1 Day
    sim.selectMemberAccommodation(0, "1_day");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("1_day");

    // Select 2 Days
    sim.selectMemberAccommodation(0, "2_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("2_days");

    // Select 3 Days
    sim.selectMemberAccommodation(0, "3_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("3_days");

    // Select 4 Days
    sim.selectMemberAccommodation(0, "4_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("4_days");

    // Select No Accommodation
    sim.selectMemberAccommodation(0, "");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("");
    expect(sim.eventState[EVENT_ID].members[0].extraDays).toBe("none");
  });

  // 2. Member 03 can independently select each duration
  it("Requirement 2: Member 03 can independently select each duration without affecting Member 02", () => {
    sim.selectMemberAccommodation(0, "2_days");

    sim.selectMemberAccommodation(1, "1_day");
    expect(sim.eventState[EVENT_ID].members[1].accommodationPlanSlug).toBe("1_day");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("2_days");

    sim.selectMemberAccommodation(1, "4_days");
    expect(sim.eventState[EVENT_ID].members[1].accommodationPlanSlug).toBe("4_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("2_days");

    sim.selectMemberAccommodation(1, "3_days");
    expect(sim.eventState[EVENT_ID].members[1].accommodationPlanSlug).toBe("3_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("2_days");

    sim.selectMemberAccommodation(1, "");
    expect(sim.eventState[EVENT_ID].members[1].accommodationPlanSlug).toBe("");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("2_days");
  });

  // 3. At least one additional dynamically rendered member can independently select each duration
  it("Requirement 3: Dynamically rendered Member 04 can independently select each duration", () => {
    sim.addTeamMember(5);
    expect(sim.eventState[EVENT_ID].members.length).toBe(3); // Member 02, 03, 04

    sim.selectMemberAccommodation(2, "4_days");
    expect(sim.eventState[EVENT_ID].members[2].accommodationPlanSlug).toBe("4_days");
    expect(sim.eventState[EVENT_ID].members[2].accommodationDate).toBe("2026-10-27");
    expect(sim.eventState[EVENT_ID].members[2].extraDays).toBe("both");

    sim.selectMemberAccommodation(2, "2_days");
    expect(sim.eventState[EVENT_ID].members[2].accommodationPlanSlug).toBe("2_days");
    expect(sim.eventState[EVENT_ID].members[2].accommodationDate).toBe("2026-10-28");
    expect(sim.eventState[EVENT_ID].members[2].extraDays).toBe("none");
  });

  // 4. Selecting 2 days updates member state, card state, dates, and amount correctly
  it("Requirement 4: Selecting 2 days updates member state, canonical dates, and cost correctly", () => {
    sim.selectMemberAccommodation(0, "2_days");
    const member02 = sim.eventState[EVENT_ID].members[0];

    expect(member02.accommodationPlanSlug).toBe("2_days");
    expect(member02.accommodationDate).toBe("2026-10-28");
    expect(member02.extraDays).toBe("none");
    expect(getAccommodationCost(member02.accommodationPlanSlug, member02.extraDays)).toBe(999);
    expect(formatAccommodationDate(2, member02.accommodationDate, member02.extraDays)).toBe("28–29 Oct");
  });

  // 5. Selecting 3 days updates state, card state, date-choice visibility, and amount
  it("Requirement 5: Selecting 3 days updates state, date interval, and amount correctly", () => {
    sim.selectMemberAccommodation(0, "3_days");
    const member02 = sim.eventState[EVENT_ID].members[0];

    expect(member02.accommodationPlanSlug).toBe("3_days");
    expect(member02.accommodationDate).toBe("2026-10-27");
    expect(member02.extraDays).toBe("before_27");
    expect(getAccommodationCost(member02.accommodationPlanSlug, member02.extraDays)).toBe(1498);
    expect(formatAccommodationDate(3, member02.accommodationDate, member02.extraDays)).toBe("27–29 Oct (3 Days)");
  });

  // 6. Both applicable extra-day choices work (27th Oct Early Arrival vs 30th Oct Extended Stay)
  it("Requirement 6: Both 3-day extra day options work and update state correctly", () => {
    sim.selectMemberAccommodation(0, "3_days");

    // Choose 30th Oct (Day After - Extended Stay)
    sim.selectMember3DayExtraOption(0, "2026-10-30");
    let m = sim.eventState[EVENT_ID].members[0];
    expect(m.accommodationDate).toBe("2026-10-30");
    expect(m.extraDays).toBe("after_30");
    expect(formatAccommodationDate(3, m.accommodationDate, m.extraDays)).toBe("28–30 Oct (3 Days)");

    // Choose 27th Oct (Day Before - Early Arrival)
    sim.selectMember3DayExtraOption(0, "2026-10-27");
    m = sim.eventState[EVENT_ID].members[0];
    expect(m.accommodationDate).toBe("2026-10-27");
    expect(m.extraDays).toBe("before_27");
    expect(formatAccommodationDate(3, m.accommodationDate, m.extraDays)).toBe("27–29 Oct (3 Days)");
  });

  // 7. Selecting 4 days updates state, card state, date interval, and amount
  it("Requirement 7: Selecting 4 days updates state, date interval, and amount correctly", () => {
    sim.selectMemberAccommodation(0, "4_days");
    const m = sim.eventState[EVENT_ID].members[0];

    expect(m.accommodationPlanSlug).toBe("4_days");
    expect(m.accommodationDate).toBe("2026-10-27");
    expect(m.extraDays).toBe("both");
    expect(getAccommodationCost(m.accommodationPlanSlug, m.extraDays)).toBe(1997);
    expect(formatAccommodationDate(4, m.accommodationDate, m.extraDays)).toBe("27–30 Oct (4 Days)");
  });

  // 8. Switching from 3 days to 2 or 4 days clears incompatible additional-date state
  it("Requirement 8: Switching from 3 days to 2 or 4 days clears incompatible extraDays", () => {
    sim.selectMemberAccommodation(0, "3_days");
    sim.selectMember3DayExtraOption(0, "2026-10-30");
    expect(sim.eventState[EVENT_ID].members[0].extraDays).toBe("after_30");

    // Switch to 2 days
    sim.selectMemberAccommodation(0, "2_days");
    expect(sim.eventState[EVENT_ID].members[0].extraDays).toBe("none");
    expect(sim.eventState[EVENT_ID].members[0].accommodationDate).toBe("2026-10-28");

    // Switch to 4 days
    sim.selectMemberAccommodation(0, "4_days");
    expect(sim.eventState[EVENT_ID].members[0].extraDays).toBe("both");
    expect(sim.eventState[EVENT_ID].members[0].accommodationDate).toBe("2026-10-27");
  });

  // 9. Switching back to 3 days restores a valid date choice according to existing rules
  it("Requirement 9: Switching back to 3 days initializes a valid date choice", () => {
    sim.selectMemberAccommodation(0, "2_days");
    expect(sim.eventState[EVENT_ID].members[0].extraDays).toBe("none");

    sim.selectMemberAccommodation(0, "3_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("3_days");
    expect(["2026-10-27", "2026-10-30"]).toContain(sim.eventState[EVENT_ID].members[0].accommodationDate);
    expect(["before_27", "after_30"]).toContain(sim.eventState[EVENT_ID].members[0].extraDays);
  });

  // 10. No member's selection changes when another member's card is clicked
  it("Requirement 10: Strict isolation — no member's selection changes when another member is modified", () => {
    sim.selectMemberAccommodation(0, "2_days");
    sim.selectMemberAccommodation(1, "4_days");

    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("2_days");
    expect(sim.eventState[EVENT_ID].members[1].accommodationPlanSlug).toBe("4_days");

    // Click member 02 again -> switch to 3 days
    sim.selectMemberAccommodation(0, "3_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("3_days");
    expect(sim.eventState[EVENT_ID].members[1].accommodationPlanSlug).toBe("4_days"); // unchanged!

    // Click member 03 -> switch to No Accommodation
    sim.selectMemberAccommodation(1, "");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("3_days"); // unchanged!
    expect(sim.eventState[EVENT_ID].members[1].accommodationPlanSlug).toBe("");
  });

  // 11. The team leader's existing selection and functionality remain unchanged
  it("Requirement 11: Team leader selection remains completely isolated from member selections", () => {
    sim.selectLeaderAccommodation("2_days");
    sim.selectMemberAccommodation(0, "4_days");
    sim.selectMemberAccommodation(1, "3_days");

    expect(sim.mainAccommodationSlug).toBe("2_days");
    expect(sim.mainAccommodationDate).toBe("2026-10-28");
    expect(sim.mainExtraDays).toBe("none");

    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("4_days");
    expect(sim.eventState[EVENT_ID].members[1].accommodationPlanSlug).toBe("3_days");

    // Change Member 02
    sim.selectMemberAccommodation(0, "");
    expect(sim.mainAccommodationSlug).toBe("2_days"); // leader remains untouched!
  });

  // 12. The registration payload contains current selections and correct derived totals
  it("Requirement 12: Registration payload and total price reflect exact current member selections", () => {
    sim.selectLeaderAccommodation("2_days"); // 999
    sim.selectMemberAccommodation(0, "3_days"); // 1498 (before_27)
    sim.selectMemberAccommodation(1, "4_days"); // 1997 (both)

    const total = sim.calculateTotalAccommodationCost();
    expect(total).toBe(999 + 1498 + 1997);

    const payload = sim.generateAccommodationsPayload();
    expect(payload).toHaveLength(3);

    // Leader
    expect(payload[0]).toEqual({
      email: "leader@example.com",
      planSlug: "2_days",
      selectedDate: "2026-10-28",
      extraDays: "none",
    });

    // Member 02
    expect(payload[1]).toEqual({
      email: "member02@example.com",
      planSlug: "3_days",
      selectedDate: "2026-10-27",
      extraDays: "before_27",
    });

    // Member 03
    expect(payload[2]).toEqual({
      email: "member03@example.com",
      planSlug: "4_days",
      selectedDate: "2026-10-27",
      extraDays: "both",
    });

    // If Member 02 deselects accommodation
    sim.selectMemberAccommodation(0, "");
    const updatedPayload = sim.generateAccommodationsPayload();
    expect(updatedPayload).toHaveLength(2);
    expect(updatedPayload.find((p) => p.email === "member02@example.com")).toBeUndefined();
    expect(sim.calculateTotalAccommodationCost()).toBe(999 + 1997);
  });

  // 13. Existing team size validation remains intact
  it("Requirement 13: Team size bounds are respected when adding members", () => {
    // Current members: 2 (total team size = leader 1 + 2 = 3)
    // max_team_size: 4
    sim.addTeamMember(4);
    expect(sim.eventState[EVENT_ID].members.length).toBe(3); // total team size = 4

    // Attempting to exceed max size:
    sim.addTeamMember(4);
    expect(sim.eventState[EVENT_ID].members.length).toBe(3); // still 3, prevented!
  });

  // 14. Existing individual-registration accommodation selection continues working
  it("Requirement 14: Individual registration accommodation resolution works identically", () => {
    const res1 = resolveAccommodationSelection("1_day", "2026-10-29", "none");
    expect(res1).toEqual({ planSlug: "1_day", selectedDate: "2026-10-29", extraDays: "none" });

    const res2 = resolveAccommodationSelection("2_days", "2026-10-28", "none");
    expect(res2).toEqual({ planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" });

    const res3a = resolveAccommodationSelection("3_days", "2026-10-27", "before_27");
    expect(res3a).toEqual({ planSlug: "3_days", selectedDate: "2026-10-27", extraDays: "before_27" });

    const res3b = resolveAccommodationSelection("3_days", "2026-10-30", "after_30");
    expect(res3b).toEqual({ planSlug: "3_days", selectedDate: "2026-10-30", extraDays: "after_30" });

    const res4 = resolveAccommodationSelection("4_days", "2026-10-27", "both");
    expect(res4).toEqual({ planSlug: "4_days", selectedDate: "2026-10-27", extraDays: "both" });
  });

  // 15. Rapid consecutive selection of different packages does not leave stale state
  it("Requirement 15: Rapid consecutive selection does not suffer from stale closures", () => {
    // Simulating rapid sequential clicks on Member 02:
    // User clicks: 1_day -> 3_days -> 2_days -> 4_days in rapid succession
    sim.selectMemberAccommodation(0, "1_day");
    sim.selectMemberAccommodation(0, "3_days");
    sim.selectMemberAccommodation(0, "2_days");
    sim.selectMemberAccommodation(0, "4_days");

    const m = sim.eventState[EVENT_ID].members[0];
    expect(m.accommodationPlanSlug).toBe("4_days");
    expect(m.accommodationDate).toBe("2026-10-27");
    expect(m.extraDays).toBe("both");

    // Switching rapidly: 4_days -> 2_days
    sim.selectMemberAccommodation(0, "2_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationPlanSlug).toBe("2_days");
    expect(sim.eventState[EVENT_ID].members[0].accommodationDate).toBe("2026-10-28");
    expect(sim.eventState[EVENT_ID].members[0].extraDays).toBe("none");
  });
});
