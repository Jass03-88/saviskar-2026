import { describe, it, expect } from "vitest";
import { calculateStayDates } from "@/lib/accommodation-dates";

/**
 * Pure helper reproducing the exact half-open interval overlap logic
 * enforced by PostgreSQL exclusion constraint daterange(start_date, end_date, '[)')
 * and application pre-check: [newStart, newEnd) overlaps [existingStart, existingEnd)
 * iff (newStart < existingEnd && newEnd > existingStart).
 */
function doesOverlap(
  stayA: { startDate: string; endDate: string },
  stayB: { startDate: string; endDate: string }
): boolean {
  return stayA.startDate < stayB.endDate && stayA.endDate > stayB.startDate;
}

/**
 * Simulates the RPC date calculation from migration 20261020000000:
 *   v_acc_base_start_date := '2026-10-28';
 *   if selected_date matches YYYY-MM-DD then v_acc_start_date := selected_date;
 *   v_acc_end_date := v_acc_start_date + duration;
 */
function simulateRpcDateCalculation(
  planDuration: number,
  submittedSelectedDate?: string
): { startDate: string; endDate: string } {
  const baseStart = "2026-10-28";
  const startDate =
    submittedSelectedDate && /^\d{4}-\d{2}-\d{2}$/.test(submittedSelectedDate)
      ? submittedSelectedDate
      : baseStart;

  const [y, m, d] = startDate.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + planDuration));
  const endDate = end.toISOString().slice(0, 10);

  return { startDate, endDate };
}

describe("Saviskar 2026 — Accommodation Date Calculation & Parity Fix", () => {
  // Requirement 7.1
  describe("1. Two-day plan date calculation", () => {
    it("calculates [2026-10-29, 2026-10-31) for two-day plan starting October 29", () => {
      const result = calculateStayDates("2_days", "2026-10-29");
      expect(result).toEqual({
        startDate: "2026-10-29",
        endDate: "2026-10-31",
        durationDays: 2,
      });
    });

    it("preserves default [2026-10-28, 2026-10-30) when no custom date is passed", () => {
      const result = calculateStayDates("2_days");
      expect(result).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-30",
        durationDays: 2,
      });
    });

    it("preserves default [2026-10-28, 2026-10-30) when explicitly passed 2026-10-28", () => {
      const result = calculateStayDates("2_days", "2026-10-28");
      expect(result).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-30",
        durationDays: 2,
      });
    });
  });

  // Requirement 7.2
  describe("2. Genuine overlap detection with existing stay [2026-10-30, 2026-10-31)", () => {
    it("detects genuine conflict when two-day pass starting Oct 29 meets existing Oct 30-31 stay", () => {
      const newBooking = calculateStayDates("2_days", "2026-10-29"); // [2026-10-29, 2026-10-31)
      const existingStay = {
        startDate: "2026-10-30",
        endDate: "2026-10-31",
      };

      // Both cover the night of October 30 -> MUST be detected as overlap
      expect(doesOverlap(newBooking, existingStay)).toBe(true);
    });

    it("detects overlap when new stay completely contains the existing stay", () => {
      const newBooking = calculateStayDates("3_days", "2026-10-28"); // [2026-10-28, 2026-10-31)
      const existingStay = {
        startDate: "2026-10-29",
        endDate: "2026-10-30",
      };

      expect(doesOverlap(newBooking, existingStay)).toBe(true);
    });
  });

  // Requirement 7.3
  describe("3. Non-overlapping prior stay [2026-10-27, 2026-10-28)", () => {
    it("does not overlap with new interval [2026-10-29, 2026-10-31)", () => {
      const newBooking = calculateStayDates("2_days", "2026-10-29"); // [2026-10-29, 2026-10-31)
      const priorStay = {
        startDate: "2026-10-27",
        endDate: "2026-10-28",
      };

      expect(doesOverlap(newBooking, priorStay)).toBe(false);
    });
  });

  // Requirement 7.4
  describe("4. Adjacent stays validity", () => {
    it("permits back-to-back adjacent stays where checkout equals next checkin", () => {
      // Stay A: 27th Oct checkout 28th Oct
      const stayA = calculateStayDates("1_day", "2026-10-27"); // [2026-10-27, 2026-10-28)
      // Stay B: 28th Oct checkout 30th Oct
      const stayB = calculateStayDates("2_days", "2026-10-28"); // [2026-10-28, 2026-10-30)

      expect(stayA.endDate).toBe(stayB.startDate);
      expect(doesOverlap(stayA, stayB)).toBe(false);
    });

    it("permits adjacent stays for [2026-10-28, 2026-10-29) and [2026-10-29, 2026-10-31)", () => {
      const stay1 = calculateStayDates("1_day", "2026-10-28"); // [2026-10-28, 2026-10-29)
      const stay2 = calculateStayDates("2_days", "2026-10-29"); // [2026-10-29, 2026-10-31)

      expect(stay1.endDate).toBe(stay2.startDate);
      expect(doesOverlap(stay1, stay2)).toBe(false);
    });

    it("permits adjacent stays for [2026-10-28, 2026-10-30) and [2026-10-30, 2026-10-31)", () => {
      const standard2Days = calculateStayDates("2_days", "2026-10-28"); // [2026-10-28, 2026-10-30)
      const lastDay1 = calculateStayDates("1_day", "2026-10-30"); // [2026-10-30, 2026-10-31)

      expect(standard2Days.endDate).toBe(lastDay1.startDate);
      expect(doesOverlap(standard2Days, lastDay1)).toBe(false);
    });
  });

  // Requirement 7.5
  describe("5. Plan switching and stale date isolation", () => {
    it("switching from 1_day (stale Oct 30) to 2_days resets to 2026-10-28", () => {
      // User initially was on 1_day with 30th selected
      let currentSelection = {
        planSlug: "1_day",
        selectedDate: "2026-10-30",
        extraDays: "none" as const,
      };

      // Switching plan action in UI
      const onPlanChange = (newPlan: string) => {
        currentSelection = {
          planSlug: newPlan,
          selectedDate: newPlan === "4_days" ? "2026-10-27" : "2026-10-28",
          extraDays: "none",
        };
      };

      onPlanChange("2_days");

      expect(currentSelection.selectedDate).toBe("2026-10-28");
      expect(currentSelection.planSlug).toBe("2_days");

      const stay = calculateStayDates(currentSelection.planSlug, currentSelection.selectedDate);
      expect(stay).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-30",
        durationDays: 2,
      });
    });

    it("switching to 4_days resets to 2026-10-27 festival start", () => {
      let currentSelection = {
        planSlug: "1_day",
        selectedDate: "2026-10-29",
        extraDays: "none" as const,
      };

      const onPlanChange = (newPlan: string) => {
        currentSelection = {
          planSlug: newPlan,
          selectedDate: newPlan === "4_days" ? "2026-10-27" : "2026-10-28",
          extraDays: "none",
        };
      };

      onPlanChange("4_days");

      expect(currentSelection.selectedDate).toBe("2026-10-27");
      const stay = calculateStayDates(currentSelection.planSlug, currentSelection.selectedDate);
      expect(stay).toEqual({
        startDate: "2026-10-27",
        endDate: "2026-10-31",
        durationDays: 4,
      });
    });

    it("changing extraDays on 2_days properly updates canonical start date", () => {
      const getStayForExtra = (extraDays: "none" | "before_27" | "after_30" | "both") => {
        let effSlug = "2_days";
        let effDate = "2026-10-28";
        if (extraDays === "before_27") {
          effSlug = "3_days";
          effDate = "2026-10-27";
        } else if (extraDays === "after_30") {
          effSlug = "3_days";
          effDate = "2026-10-28";
        } else if (extraDays === "both") {
          effSlug = "4_days";
          effDate = "2026-10-27";
        }
        return calculateStayDates(effSlug, effDate, extraDays);
      };

      expect(getStayForExtra("none")).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-30",
        durationDays: 2,
      });
      expect(getStayForExtra("before_27")).toEqual({
        startDate: "2026-10-27",
        endDate: "2026-10-30",
        durationDays: 3,
      });
      expect(getStayForExtra("after_30")).toEqual({
        startDate: "2026-10-28",
        endDate: "2026-10-31",
        durationDays: 3,
      });
      expect(getStayForExtra("both")).toEqual({
        startDate: "2026-10-27",
        endDate: "2026-10-31",
        durationDays: 4,
      });
    });
  });

  // Requirement 7.6
  describe("6. UI, API, and RPC contract agreement", () => {
    const testMatrix = [
      {
        description: "1-day pass on Oct 27",
        planSlug: "1_day",
        selectedDate: "2026-10-27",
        duration: 1,
      },
      {
        description: "1-day pass on Oct 28",
        planSlug: "1_day",
        selectedDate: "2026-10-28",
        duration: 1,
      },
      {
        description: "1-day pass on Oct 29",
        planSlug: "1_day",
        selectedDate: "2026-10-29",
        duration: 1,
      },
      {
        description: "1-day pass on Oct 30",
        planSlug: "1_day",
        selectedDate: "2026-10-30",
        duration: 1,
      },
      {
        description: "2-day standard pass (default Oct 28)",
        planSlug: "2_days",
        selectedDate: "2026-10-28",
        duration: 2,
      },
      {
        description: "2-day custom pass starting Oct 29",
        planSlug: "2_days",
        selectedDate: "2026-10-29",
        duration: 2,
      },
      {
        description: "3-day early pass starting Oct 27",
        planSlug: "3_days",
        selectedDate: "2026-10-27",
        duration: 3,
      },
      {
        description: "3-day late checkout pass starting Oct 28",
        planSlug: "3_days",
        selectedDate: "2026-10-28",
        duration: 3,
      },
      {
        description: "4-day full festival pass starting Oct 27",
        planSlug: "4_days",
        selectedDate: "2026-10-27",
        duration: 4,
      },
    ];

    it.each(testMatrix)(
      "UI, API, and RPC calculate the exact same interval for $description",
      ({ planSlug, selectedDate, duration }) => {
        // UI calculation
        const uiResult = calculateStayDates(planSlug, selectedDate);

        // API submitted payload passes uiResult.startDate as selected_date
        const submittedDateToRpc = uiResult.startDate;

        // RPC calculation: v_acc_start_date + duration
        const rpcResult = simulateRpcDateCalculation(duration, submittedDateToRpc);

        // All three contracts MUST strictly agree
        expect(uiResult.startDate).toBe(selectedDate);
        expect(uiResult.startDate).toBe(rpcResult.startDate);
        expect(uiResult.endDate).toBe(rpcResult.endDate);
        expect(uiResult.durationDays).toBe(duration);
      }
    );
  });
});
