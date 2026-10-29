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

/**
 * Returns an array of calendar night date strings (YYYY-MM-DD) for a stay interval [startDate, endDate).
 * Consecutive stays meeting at boundary (e.g. checkout Oct 28, checkin Oct 28) do not overlap.
 */
export function getStayNights(startDate?: string | null, endDate?: string | null): string[] {
  if (!startDate || !endDate || startDate >= endDate) return [];
  const nights: string[] = [];
  let current = startDate;
  while (current < endDate) {
    nights.push(current);
    current = addDaysToIso(current, 1);
  }
  return nights;
}

/**
 * Checks whether two stay intervals [startA, endA) and [startB, endB) overlap.
 * Stays that touch at boundary (checkout = checkin) do not overlap.
 */
export function isDateOverlap(
  startA?: string | null,
  endA?: string | null,
  startB?: string | null,
  endB?: string | null
): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && endA > startB;
}

export interface ActiveAllocationRecord {
  room_id: string;
  participant_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  hostel_id?: string | null;
}

export interface RoomDateOccupancyResult {
  peakOccupancy: number;
  isFull: boolean;
  availableBeds: number;
  occupancyPerNight: Record<string, number>;
}

/**
 * Evaluates room capacity for a requested stay interval [targetStartDate, targetEndDate)
 * against active room allocations, counting DISTINCT physical participants per night.
 * Excludes the target participant so multi-order bookings do not count against themselves.
 */
export function calculateRoomDateOccupancy(options: {
  roomId: string;
  roomCapacity: number;
  targetStartDate?: string | null;
  targetEndDate?: string | null;
  excludeParticipantId?: string | null;
  activeAllocations: ActiveAllocationRecord[];
}): RoomDateOccupancyResult {
  const {
    roomId,
    roomCapacity,
    targetStartDate,
    targetEndDate,
    excludeParticipantId,
    activeAllocations,
  } = options;

  const nights = getStayNights(targetStartDate, targetEndDate);
  if (nights.length === 0) {
    return {
      peakOccupancy: 0,
      isFull: false,
      availableBeds: roomCapacity,
      occupancyPerNight: {},
    };
  }

  // Filter allocations for this room and other participants
  const relevantAllocations = activeAllocations.filter((a) => {
    if (a.room_id !== roomId) return false;
    if (excludeParticipantId && a.participant_id && a.participant_id === excludeParticipantId) {
      return false;
    }
    return true;
  });

  const occupancyPerNight: Record<string, number> = {};
  let peakOccupancy = 0;

  for (const night of nights) {
    const distinctParticipants = new Set<string>();
    let anonCounter = 0;

    for (const alloc of relevantAllocations) {
      if (alloc.start_date && alloc.end_date) {
        if (alloc.start_date <= night && alloc.end_date > night) {
          const pKey = alloc.participant_id || `anon_${++anonCounter}`;
          distinctParticipants.add(pKey);
        }
      }
    }

    const nightCount = distinctParticipants.size;
    occupancyPerNight[night] = nightCount;
    if (nightCount > peakOccupancy) {
      peakOccupancy = nightCount;
    }
  }

  const isFull = peakOccupancy >= roomCapacity;
  const availableBeds = Math.max(0, roomCapacity - peakOccupancy);

  return {
    peakOccupancy,
    isFull,
    availableBeds,
    occupancyPerNight,
  };
}

export interface AccommodationFilterableRecord {
  id?: string;
  participant_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  status?: string | null;
  payment_orders?: any;
  participants?: { participant_id?: string | null } | null;
}

export function normalizeAccommodationDate(val?: unknown): string {
  if (!val) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val).trim();
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  return "";
}

export function isRecordActiveStay(acc: AccommodationFilterableRecord): boolean {
  const accStatus = (acc.status || "").toLowerCase();
  const po = Array.isArray(acc.payment_orders) ? acc.payment_orders[0] : acc.payment_orders;
  const poStatus = (po?.status || "").toLowerCase();

  return (
    accStatus !== "cancelled" &&
    accStatus !== "failed" &&
    accStatus !== "refunded" &&
    poStatus !== "cancelled" &&
    poStatus !== "failed" &&
    poStatus !== "refunded"
  );
}

export function buildParticipantActiveStaysMap<T extends AccommodationFilterableRecord>(
  accommodations: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  if (!Array.isArray(accommodations)) return map;

  for (const acc of accommodations) {
    if (!isRecordActiveStay(acc)) continue;

    const pId = (acc.participants?.participant_id || acc.participant_id || "").trim();
    if (!pId) continue;

    const existing = map.get(pId);
    if (existing) {
      existing.push(acc);
    } else {
      map.set(pId, [acc]);
    }
  }
  return map;
}

export function matchesAccommodationDateFilter(
  acc: AccommodationFilterableRecord,
  filterDate: string,
  participantActiveRecords?: AccommodationFilterableRecord[]
): boolean {
  if (!filterDate || filterDate === "all") return true;

  const normStart = normalizeAccommodationDate(acc.start_date);
  const normEnd = normalizeAccommodationDate(acc.end_date);

  const computedDays =
    normStart && normEnd
      ? Math.max(1, Math.round((new Date(normEnd).getTime() - new Date(normStart).getTime()) / (1000 * 60 * 60 * 24)))
      : 1;
  const duration = acc.duration_days && acc.duration_days > 0 ? acc.duration_days : computedDays;

  // Filter other active records for this participant (excluding current record itself)
  const otherActive = (participantActiveRecords || []).filter((r) => {
    if (acc.id && r.id) return r.id !== acc.id;
    return r !== acc;
  });

  // A contiguous extension following this booking:
  // Starts on the morning of this booking's checkout date (normEnd)
  const hasFollowingExtension = otherActive.some((r) => {
    const rStart = normalizeAccommodationDate(r.start_date);
    const rEnd = normalizeAccommodationDate(r.end_date);
    return rStart === normEnd && rEnd > normEnd;
  });

  // A contiguous stay preceding this booking:
  // Checks out on this booking's start date (normStart)
  const hasPrecedingStay = otherActive.some((r) => {
    const rEnd = normalizeAccommodationDate(r.end_date);
    return rEnd === normStart;
  });

  if (filterDate === "28") {
    // 28 Oct Only (Day 1):
    // Must start on 2026-10-28 and checkout morning of 2026-10-29.
    // Bookings checking out on 30 Oct or later (e.g. normEnd === "2026-10-30" or "2026-10-31") must NEVER appear.
    // Also, if participant booked a contiguous extension starting 2026-10-29, the actual stay extends past 29 Oct,
    // so it is NOT a "28 Oct Only" stay.
    // However, separate independent stays (e.g. 31 Oct to 1 Nov) do NOT extend the 28 Oct stay.
    return (
      normStart === "2026-10-28" &&
      normEnd === "2026-10-29" &&
      duration === 1 &&
      !hasFollowingExtension &&
      !hasPrecedingStay
    );
  }

  if (filterDate === "27") {
    return (
      normStart === "2026-10-27" &&
      normEnd === "2026-10-28" &&
      duration === 1 &&
      !hasFollowingExtension &&
      !hasPrecedingStay
    );
  }

  if (filterDate === "29") {
    return (
      normStart === "2026-10-29" &&
      normEnd === "2026-10-30" &&
      duration === 1 &&
      !hasFollowingExtension &&
      !hasPrecedingStay
    );
  }

  if (filterDate === "30") {
    return (
      normStart === "2026-10-30" &&
      normEnd === "2026-10-31" &&
      duration === 1 &&
      !hasFollowingExtension &&
      !hasPrecedingStay
    );
  }

  if (filterDate === "31") {
    return (
      normStart === "2026-10-31" &&
      normEnd === "2026-11-01" &&
      duration === 1 &&
      !hasFollowingExtension &&
      !hasPrecedingStay
    );
  }

  if (filterDate === "2_days") {
    const isSingle2Day = normStart === "2026-10-28" && normEnd === "2026-10-30" && duration === 2;
    const isContiguous2Day =
      normStart === "2026-10-28" &&
      normEnd === "2026-10-29" &&
      otherActive.some(
        (r) =>
          normalizeAccommodationDate(r.start_date) === "2026-10-29" &&
          normalizeAccommodationDate(r.end_date) === "2026-10-30"
      );
    return isSingle2Day || isContiguous2Day;
  }

  if (filterDate === "2_days_30") {
    return normStart === "2026-10-30" && normEnd === "2026-11-01" && (duration === 2 || !acc.duration_days);
  }

  if (filterDate === "3_days_27") {
    return normStart === "2026-10-27" && normEnd === "2026-10-30" && (duration === 3 || !acc.duration_days);
  }

  if (filterDate === "3_days_30") {
    return normStart === "2026-10-28" && normEnd === "2026-10-31" && (duration === 3 || !acc.duration_days);
  }

  if (filterDate === "3_days_29") {
    return normStart === "2026-10-29" && normEnd === "2026-11-01" && (duration === 3 || !acc.duration_days);
  }

  if (filterDate === "4_days") {
    return normStart === "2026-10-27" && normEnd === "2026-10-31" && (duration === 4 || !acc.duration_days);
  }

  if (filterDate === "4_days_28") {
    return normStart === "2026-10-28" && normEnd === "2026-11-01" && (duration === 4 || !acc.duration_days);
  }

  if (filterDate === "both" || filterDate === "multi") {
    return Boolean(duration >= 2 || hasFollowingExtension || hasPrecedingStay || (normEnd && normStart && computedDays >= 2));
  }

  return true;
}
