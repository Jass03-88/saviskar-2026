import { describe, it, expect } from "vitest";
import {
  calculateStayDates,
  getCanonicalStayLabel,
  isValidAccommodationDate,
} from "@/lib/accommodation-dates";
import {
  formatAccommodationDate,
  resolveAccommodationSelection,
} from "@/components/registration/RegistrationForm";

describe("Saviskar 2026 — Accommodation Extension Through 31 October", () => {
  describe("1. All 12 Canonical Date & Duration Combinations", () => {
    const requiredCases = [
      {
        package: "1 day (27 Oct)",
        slug: "1_day",
        startDate: "2026-10-27",
        expectedCheckout: "2026-10-28",
        duration: 1,
        expectedPrice: 499,
        expectedLabel: "27 Oct (Day Before)",
      },
      {
        package: "1 day (28 Oct)",
        slug: "1_day",
        startDate: "2026-10-28",
        expectedCheckout: "2026-10-29",
        duration: 1,
        expectedPrice: 499,
        expectedLabel: "28 Oct (Day 1)",
      },
      {
        package: "1 day (29 Oct)",
        slug: "1_day",
        startDate: "2026-10-29",
        expectedCheckout: "2026-10-30",
        duration: 1,
        expectedPrice: 499,
        expectedLabel: "29 Oct (Day 2)",
      },
      {
        package: "1 day (30 Oct)",
        slug: "1_day",
        startDate: "2026-10-30",
        expectedCheckout: "2026-10-31",
        duration: 1,
        expectedPrice: 499,
        expectedLabel: "30 Oct (Day After)",
      },
      {
        package: "1 day (31 Oct - NEW)",
        slug: "1_day",
        startDate: "2026-10-31",
        expectedCheckout: "2026-11-01",
        duration: 1,
        expectedPrice: 499,
        expectedLabel: "31 Oct (Day 4 • Checkout 1 Nov)",
      },
      {
        package: "2 days (28-29 Oct)",
        slug: "2_days",
        startDate: "2026-10-28",
        expectedCheckout: "2026-10-30",
        duration: 2,
        expectedPrice: 999,
        expectedLabel: "28–29 Oct (2 Days)",
      },
      {
        package: "2 days (30-31 Oct - NEW)",
        slug: "2_days",
        startDate: "2026-10-30",
        expectedCheckout: "2026-11-01",
        duration: 2,
        expectedPrice: 999,
        expectedLabel: "30–31 Oct (2 Days • Checkout 1 Nov)",
      },
      {
        package: "3 days (27-29 Oct)",
        slug: "3_days",
        startDate: "2026-10-27",
        expectedCheckout: "2026-10-30",
        duration: 3,
        expectedPrice: 1498,
        expectedLabel: "27–29 Oct (3 Days • Day Before)",
      },
      {
        package: "3 days (28-30 Oct)",
        slug: "3_days",
        startDate: "2026-10-28",
        expectedCheckout: "2026-10-31",
        duration: 3,
        expectedPrice: 1498,
        expectedLabel: "28–30 Oct (3 Days • Day After)",
      },
      {
        package: "3 days (29-31 Oct - NEW)",
        slug: "3_days",
        startDate: "2026-10-29",
        expectedCheckout: "2026-11-01",
        duration: 3,
        expectedPrice: 1498,
        expectedLabel: "29–31 Oct (3 Days • Checkout 1 Nov)",
      },
      {
        package: "4 days (27-30 Oct)",
        slug: "4_days",
        startDate: "2026-10-27",
        expectedCheckout: "2026-10-31",
        duration: 4,
        expectedPrice: 1997,
        expectedLabel: "27–30 Oct (4 Days • Full Stay)",
      },
      {
        package: "4 days (28-31 Oct - NEW)",
        slug: "4_days",
        startDate: "2026-10-28",
        expectedCheckout: "2026-11-01",
        duration: 4,
        expectedPrice: 1997,
        expectedLabel: "28–31 Oct (4 Days • Checkout 1 Nov)",
      },
    ];

    it.each(requiredCases)(
      "correctly calculates $package with checkout on $expectedCheckout",
      ({ slug, startDate, expectedCheckout, duration, expectedLabel }) => {
        const stay = calculateStayDates(slug, startDate);
        expect(stay.startDate).toBe(startDate);
        expect(stay.endDate).toBe(expectedCheckout);
        expect(stay.durationDays).toBe(duration);

        // Check canonical stay label helper
        const label = getCanonicalStayLabel(startDate, duration);
        expect(label).toBe(expectedLabel);

        // Check date validity validator
        expect(isValidAccommodationDate(slug, startDate)).toBe(true);
      }
    );
  });

  describe("2. Validation Rejection of Unsupported Date Combinations", () => {
    it("rejects unsupported dates for 1_day plan", () => {
      expect(isValidAccommodationDate("1_day", "2026-10-26")).toBe(false);
      expect(isValidAccommodationDate("1_day", "2026-11-01")).toBe(false);
      expect(isValidAccommodationDate("1_day", "invalid-date")).toBe(false);
    });

    it("rejects unsupported dates for 2_days plan (only 28 and 30 Oct supported)", () => {
      expect(isValidAccommodationDate("2_days", "2026-10-27")).toBe(false);
      expect(isValidAccommodationDate("2_days", "2026-10-29")).toBe(false);
      expect(isValidAccommodationDate("2_days", "2026-10-31")).toBe(false);
    });

    it("rejects unsupported dates for 3_days plan (only 27, 28, and 29 Oct supported)", () => {
      expect(isValidAccommodationDate("3_days", "2026-10-26")).toBe(false);
      expect(isValidAccommodationDate("3_days", "2026-10-30")).toBe(false);
      expect(isValidAccommodationDate("3_days", "2026-10-31")).toBe(false);
    });

    it("rejects unsupported dates for 4_days plan (only 27 and 28 Oct supported)", () => {
      expect(isValidAccommodationDate("4_days", "2026-10-26")).toBe(false);
      expect(isValidAccommodationDate("4_days", "2026-10-29")).toBe(false);
      expect(isValidAccommodationDate("4_days", "2026-10-30")).toBe(false);
      expect(isValidAccommodationDate("4_days", "2026-10-31")).toBe(false);
    });

    it("rejects unknown plan slugs", () => {
      expect(isValidAccommodationDate("5_days", "2026-10-27")).toBe(false);
      expect(isValidAccommodationDate("unknown_plan", "2026-10-28")).toBe(false);
    });
  });

  describe("3. Frontend formatAccommodationDate & resolveAccommodationSelection", () => {
    it("formats 1-day 31 Oct selection correctly", () => {
      expect(formatAccommodationDate(1, "2026-10-31")).toBe("31 Oct (Day 4)");
    });

    it("formats 2-day 30 Oct selection correctly", () => {
      expect(formatAccommodationDate(2, "2026-10-30")).toBe("30–31 Oct");
    });

    it("formats 3-day 29 Oct selection correctly", () => {
      expect(formatAccommodationDate(3, "2026-10-29")).toBe("29–31 Oct (3 Days)");
    });

    it("formats 4-day 28 Oct selection correctly", () => {
      expect(formatAccommodationDate(4, "2026-10-28")).toBe("28–31 Oct (4 Days)");
    });

    it("resolves 1-day with 31 Oct selection", () => {
      expect(resolveAccommodationSelection("1_day", "2026-10-31")).toEqual({
        planSlug: "1_day",
        selectedDate: "2026-10-31",
        extraDays: "none",
      });
    });

    it("resolves 2-days with 30 Oct selection", () => {
      expect(resolveAccommodationSelection("2_days", "2026-10-30")).toEqual({
        planSlug: "2_days",
        selectedDate: "2026-10-30",
        extraDays: "none",
      });
    });

    it("resolves 3-days with 29 Oct selection", () => {
      expect(resolveAccommodationSelection("3_days", "2026-10-29")).toEqual({
        planSlug: "3_days",
        selectedDate: "2026-10-29",
        extraDays: "none",
      });
    });

    it("resolves 4-days with 28 Oct selection", () => {
      expect(resolveAccommodationSelection("4_days", "2026-10-28")).toEqual({
        planSlug: "4_days",
        selectedDate: "2026-10-28",
        extraDays: "none",
      });
    });
  });

  describe("4. Non-overlapping Adjacent Stays vs Conflicting Overlaps", () => {
    function doesOverlap(
      stayA: { startDate: string; endDate: string },
      stayB: { startDate: string; endDate: string }
    ): boolean {
      return stayA.startDate < stayB.endDate && stayA.endDate > stayB.startDate;
    }

    it("permits 2-day stay (28-30 Oct) and subsequent 2-day stay (30 Oct - 1 Nov) adjacent without conflict", () => {
      const stay1 = calculateStayDates("2_days", "2026-10-28"); // [2026-10-28, 2026-10-30)
      const stay2 = calculateStayDates("2_days", "2026-10-30"); // [2026-10-30, 2026-11-01)

      expect(stay1.endDate).toBe(stay2.startDate);
      expect(doesOverlap(stay1, stay2)).toBe(false);
    });

    it("permits 3-day stay (27-30 Oct) and 1-day stay (31 Oct - 1 Nov) without conflict", () => {
      const stay3Day = calculateStayDates("3_days", "2026-10-27"); // [2026-10-27, 2026-10-30)
      const stay1Day = calculateStayDates("1_day", "2026-10-31"); // [2026-10-31, 2026-11-01)

      expect(doesOverlap(stay3Day, stay1Day)).toBe(false);
    });

    it("detects genuine conflict when 4-day stay (28 Oct - 1 Nov) meets existing 1-day stay on 31 Oct", () => {
      const stay4Day = calculateStayDates("4_days", "2026-10-28"); // [2026-10-28, 2026-11-01)
      const stay1Day = calculateStayDates("1_day", "2026-10-31"); // [2026-10-31, 2026-11-01)

      expect(doesOverlap(stay4Day, stay1Day)).toBe(true);
    });
  });
});
