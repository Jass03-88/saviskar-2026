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
    } else if (selectedDate === "2026-10-29") {
      startDate = "2026-10-29";
    } else {
      // In Saviskar 2026, standard 3-day festival plan spans:
      // - Oct 27 to Oct 30 (early arrival before 28th)
      // - Oct 28 to Oct 31 (standard festival + late departure after 30th)
      startDate = "2026-10-28";
    }
    const endDate = addDaysToIso(startDate, durationDays);
    return { startDate, endDate, durationDays };
  }

  if (planSlug === "4_days") {
    const durationDays = 4;
    let startDate = "2026-10-27";
    if (selectedDate === "2026-10-28") {
      // 4-day extended festival plan: Oct 28 to Nov 01 (checkout Nov 1 morning)
      startDate = "2026-10-28";
    }
    const endDate = addDaysToIso(startDate, durationDays);
    return { startDate, endDate, durationDays };
  }

  const durationDays = 1;
  const startDate = (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) ? selectedDate : defaultBaseStartDate;
  const endDate = addDaysToIso(startDate, durationDays);
  return { startDate, endDate, durationDays };
}

/**
 * Authoritative stay label formatter for Saviskar 2026 accommodations.
 * Guarantees unified display across Registration, Admin, Scanner, and Exports.
 */
export function getCanonicalStayLabel(startDate?: string | null, durationDays?: number | null): string {
  if (!startDate) return "Unknown";
  const duration = durationDays ?? 1;

  if (duration === 1) {
    if (startDate.includes("27")) return "27 Oct (Day Before)";
    if (startDate.includes("29")) return "29 Oct (Day 2)";
    if (startDate.includes("30")) return "30 Oct (Day After)";
    if (startDate.includes("31")) return "31 Oct (Day 4 • Checkout 1 Nov)";
    return "28 Oct (Day 1)";
  }

  if (duration === 2) {
    if (startDate.includes("30")) return "30–31 Oct (2 Days • Checkout 1 Nov)";
    return "28–29 Oct (2 Days)";
  }

  if (duration === 3) {
    if (startDate.includes("27")) return "27–29 Oct (3 Days • Day Before)";
    if (startDate.includes("29")) return "29–31 Oct (3 Days • Checkout 1 Nov)";
    return "28–30 Oct (3 Days • Day After)";
  }

  if (duration === 4) {
    if (startDate.includes("28")) return "28–31 Oct (4 Days • Checkout 1 Nov)";
    return "27–30 Oct (4 Days • Full Stay)";
  }

  return `${startDate} (${duration} Days)`;
}

/**
 * Validates whether the given start date is supported for the specified accommodation plan.
 */
export function isValidAccommodationDate(planSlug: string, startDate?: string | null): boolean {
  if (!startDate) return false;
  switch (planSlug) {
    case "1_day":
    case "1_day_29":
      return ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"].includes(startDate);
    case "2_days":
      return ["2026-10-28", "2026-10-30"].includes(startDate);
    case "3_days":
      return ["2026-10-27", "2026-10-28", "2026-10-29"].includes(startDate);
    case "4_days":
      return ["2026-10-27", "2026-10-28"].includes(startDate);
    default:
      return false;
  }
}
