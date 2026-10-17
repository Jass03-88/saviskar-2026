/**
 * Saviskar 2026 — Accommodation Date Interval Resolver
 *
 * Deterministically computes the exact stay interval [startDate, endDate)
 * and duration in days for any accommodation plan and optional extra days.
 */

function addDaysToIso(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

export function calculateStayDates(
  planSlug: string,
  selectedDate?: string,
  extraDays?: string
): { startDate: string; endDate: string; durationDays: number } {
  const defaultBaseStartDate = "2026-10-28";

  if (planSlug === "1_day" || planSlug === "1_day_29") {
    const durationDays = 1;
    let startDate = defaultBaseStartDate;
    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      startDate = selectedDate;
    }
    const endDate = addDaysToIso(startDate, durationDays);
    return { startDate, endDate, durationDays };
  }

  if (planSlug === "2_days") {
    const durationDays = 2;
    let startDate = defaultBaseStartDate;
    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      startDate = selectedDate;
    }
    const endDate = addDaysToIso(startDate, durationDays);
    return { startDate, endDate, durationDays };
  }

  if (planSlug === "3_days") {
    const durationDays = 3;
    let startDate = defaultBaseStartDate;
    if (selectedDate === "2026-10-27" || extraDays === "before_27") {
      startDate = "2026-10-27";
    } else if (extraDays === "after_30") {
      startDate = "2026-10-28";
    } else if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      startDate = selectedDate;
    }
    const endDate = addDaysToIso(startDate, durationDays);
    return { startDate, endDate, durationDays };
  }

  if (planSlug === "4_days") {
    const durationDays = 4;
    let startDate = "2026-10-27";
    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      startDate = selectedDate;
    }
    const endDate = addDaysToIso(startDate, durationDays);
    return { startDate, endDate, durationDays };
  }

  const durationDays = 1;
  const startDate = (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) ? selectedDate : defaultBaseStartDate;
  const endDate = addDaysToIso(startDate, durationDays);
  return { startDate, endDate, durationDays };
}
