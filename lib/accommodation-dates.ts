/**
 * Saviskar 2026 — Accommodation Date Interval Resolver
 *
 * Deterministically computes the exact stay interval [startDate, endDate)
 * and duration in days for any accommodation plan and optional extra days.
 */

export function calculateStayDates(
  planSlug: string,
  selectedDate?: string,
  extraDays?: string
): { startDate: string; endDate: string; durationDays: number } {
  let startDate = "2026-10-28";
  let endDate = "2026-10-30";
  let durationDays = 2;

  if (planSlug === "1_day" || planSlug === "1_day_29") {
    durationDays = 1;
    if (selectedDate === "2026-10-27") {
      startDate = "2026-10-27";
      endDate = "2026-10-28";
    } else if (selectedDate === "2026-10-29") {
      startDate = "2026-10-29";
      endDate = "2026-10-30";
    } else if (selectedDate === "2026-10-30") {
      startDate = "2026-10-30";
      endDate = "2026-10-31";
    } else {
      startDate = "2026-10-28";
      endDate = "2026-10-29";
    }
  } else if (planSlug === "2_days") {
    durationDays = 2;
    startDate = "2026-10-28";
    endDate = "2026-10-30";
  } else if (planSlug === "3_days") {
    durationDays = 3;
    if (selectedDate === "2026-10-27" || extraDays === "before_27") {
      startDate = "2026-10-27";
      endDate = "2026-10-30";
    } else {
      startDate = "2026-10-28";
      endDate = "2026-10-31";
    }
  } else if (planSlug === "4_days") {
    durationDays = 4;
    startDate = "2026-10-27";
    endDate = "2026-10-31";
  }

  return { startDate, endDate, durationDays };
}
