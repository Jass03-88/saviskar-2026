/**
 * lib/admin/csv-export.ts
 *
 * Server/client-agnostic CSV serialization helpers for Saviskar 2026 Admin exports.
 * Generates unmasked, RFC-4180 compliant CSV strings containing complete participant
 * contact details (email and phone), state, gender, and individual accommodation details
 * for authorized administrative exports. Prepend UTF-8 BOM (\uFEFF) for Microsoft Excel.
 */

export type CsvParticipant = {
  id?: string;
  participant_id: string;
  name: string;
  college?: string | null;
  email: string;
  phone?: string | null;
  gender?: string | null;
  state?: string | null;
  accommodation?: CsvAccommodationDetail | null;
  accommodations?: CsvAccommodationDetail[] | null;
  [key: string]: unknown;
};

export type CsvAccommodationDetail = {
  id?: string;
  plan_name?: string | null;
  duration_days?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  hostel_name?: string | null;
  room_number?: string | null;
  payment_order_id?: string | null;
  payment_order_reference?: string | null;
  gateway_payment_id?: string | null;
  payment_status?: string | null;
  payment_id?: string | null;
  [key: string]: unknown;
};

export type CsvRegistrationItem = {
  participant: CsvParticipant;
  event?: {
    name?: string | null;
    category?: string | null;
    payment_type?: string | null;
    registration_fee?: number | null;
    [key: string]: unknown;
  } | null;
  registration: {
    id?: string;
    event_id: string;
    registration_status?: string | null;
    payment_status?: string | null;
    payment_amount?: number | null;
    payment_id?: string | null;
    team_name?: string | null;
    checked_in?: boolean | null;
    checked_in_at?: string | null;
    main_checked_in?: boolean | null;
    main_checked_in_at?: string | null;
    registration_group_id?: string | null;
    created_at?: string | null;
    [key: string]: unknown;
  };
  accommodation?: CsvAccommodationDetail | null;
  accommodations?: CsvAccommodationDetail[] | null;
  members?: Array<{
    id?: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    is_team_leader?: boolean | null;
    participant_id?: string | null;
    gender?: string | null;
    state?: string | null;
    participants?: {
      participant_id?: string | null;
      college?: string | null;
      gender?: string | null;
      state?: string | null;
      [key: string]: unknown;
    } | null;
    accommodation?: CsvAccommodationDetail | null;
    accommodations?: CsvAccommodationDetail[] | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export const UTF8_BOM = "\uFEFF";

export function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let str = String(value);

  // Prevent spreadsheet formula injection while preserving negative numbers and phone numbers like +91...
  if (/^[=@\t\r]/.test(str)) {
    str = "'" + str;
  } else if (/^[+-][^0-9]/.test(str)) {
    str = "'" + str;
  }

  return `"${str.replace(/"/g, '""')}"`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* =========================================================
   1. MAIN DASHBOARD REGISTRATIONS CSV HEADERS
========================================================= */

export const REGISTRATION_CSV_HEADERS: string[] = [
  "Sr. No.",
  "Participant ID",
  "Participant Name",
  "Email",
  "Phone",
  "State",
  "Gender",
  "Event Name",
  "Category",
  "Team Type",
  "Registration Status",
  "Payment Status",
  "Payment Amount",
  "Payment ID",
  "Accommodation Required",
  "Accommodation Type",
  "Accommodation Duration",
  "Accommodation Start Date",
  "Accommodation End Date",
  "Accommodation Payment Status",
  "Accommodation Payment Amount",
  "Accommodation Payment ID",
  "Checked In",
  "Check-in Time",
  "College",
  "Team Name",
  "Hostel",
  "Room Number",
  "Main Checked In",
  "Main Checked In At",
  "Registration Group ID",
  "Registered At",
  "Registration ID",
  "Team Members",
];

/* =========================================================
   2. EVENT-SPECIFIC & PARTICIPANT CSV HEADERS
========================================================= */

export const EVENT_REGISTRATION_CSV_HEADERS: string[] = [
  ...REGISTRATION_CSV_HEADERS,
];

export const PARTICIPANT_CSV_HEADERS: string[] = [
  ...REGISTRATION_CSV_HEADERS,
];

/* =========================================================
   ROW BUILDERS
========================================================= */

export function buildSingleParticipantRow(
  item: CsvRegistrationItem,
  participant: CsvParticipant,
  isLeaderOrIndividual: boolean,
  serialNumber: number | string = 1
): (string | number)[] {
  const isPrimary =
    isLeaderOrIndividual ||
    participant === item.participant ||
    (!participant.id ||
      participant.id === item.participant.id ||
      participant.participant_id === item.participant.participant_id);

  const accList = (
    (participant.accommodations && participant.accommodations.length > 0)
      ? participant.accommodations
      : participant.accommodation
        ? [participant.accommodation]
        : (isPrimary && item.accommodations && item.accommodations.length > 0)
          ? item.accommodations
          : (isPrimary && item.accommodation)
            ? [item.accommodation]
            : []
  ) as CsvAccommodationDetail[];

  const hasAcc = accList.length > 0;

  const accRequired = hasAcc ? "Yes" : "No";

  const accType = hasAcc
    ? accList
        .map((a) => a.plan_name || (a.duration_days ? `${a.duration_days}-Day Accommodation` : "Accommodation"))
        .join("; ")
    : "";

  const accDuration = hasAcc
    ? accList
        .map((a) => (typeof a.duration_days === "number" ? `${a.duration_days} Day${a.duration_days > 1 ? "s" : ""}` : ""))
        .filter(Boolean)
        .join("; ")
    : "";

  const accStartDate = hasAcc
    ? accList.map((a) => a.start_date || "").filter(Boolean).join("; ")
    : "";

  const accEndDate = hasAcc
    ? accList.map((a) => a.end_date || "").filter(Boolean).join("; ")
    : "";

  const accPaymentStatus = hasAcc
    ? accList.map((a) => a.payment_status || a.status || "unpaid").join("; ")
    : "";

  const accPaymentAmount = hasAcc
    ? accList.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)
    : "";

  const accPaymentId = hasAcc
    ? accList
        .map((a) => a.payment_id || a.gateway_payment_id || a.payment_order_reference || a.payment_order_id || "")
        .filter(Boolean)
        .join("; ")
    : "";

  const accHostel = hasAcc
    ? accList.map((a) => a.hostel_name || "Unassigned").join("; ")
    : "";

  const accRoom = hasAcc
    ? accList.map((a) => a.room_number || "Unassigned").join("; ")
    : "";

  const teamType = item.registration.team_name ? "Team" : "Individual";
  const teamName = item.registration.team_name ?? "";

  const teamMembersSummary =
    item.members && item.members.length > 0
      ? item.members
          .map((m) => {
            const leaderTag = m.is_team_leader ? " (Leader)" : "";
            const pubId = m.participants?.participant_id || m.participant_id;
            const idTag = pubId ? ` [${pubId}]` : "";
            return `${m.name}${idTag}${leaderTag}`;
          })
          .join("; ")
      : "";

  return [
    serialNumber,
    participant.participant_id ?? "",
    participant.name ?? "",
    participant.email ?? "",
    participant.phone ?? "",
    participant.state ?? "",
    participant.gender ?? "",
    item.event?.name ?? item.registration.event_id ?? "",
    item.event?.category ?? "",
    teamType,
    item.registration.registration_status ?? "",
    item.registration.payment_status ?? "",
    item.registration.payment_amount ?? 0,
    item.registration.payment_id ?? "",
    accRequired,
    accType,
    accDuration,
    accStartDate,
    accEndDate,
    accPaymentStatus,
    accPaymentAmount,
    accPaymentId,
    item.registration.checked_in ? "Yes" : "No",
    formatDate(item.registration.checked_in_at),
    participant.college ?? "",
    teamName,
    accHostel,
    accRoom,
    item.registration.main_checked_in ? "Yes" : "No",
    formatDate(item.registration.main_checked_in_at),
    (item.registration as Record<string, unknown>).registration_group_id as string ?? "",
    formatDate(item.registration.created_at),
    item.registration.id ?? "",
    teamMembersSummary,
  ];
}

export function buildRegistrationCsvRows(
  item: CsvRegistrationItem,
  startingSerial: number = 1
): (string | number)[][] {
  let serial = startingSerial;
  if (item.members && item.members.length > 0) {
    const hasExplicitLeaderInMembers = item.members.some(
      (m) =>
        m.is_team_leader === true ||
        (m.participant_id && m.participant_id === item.participant.id) ||
        (m.participants?.participant_id &&
          m.participants.participant_id === item.participant.participant_id)
    );

    const rows: (string | number)[][] = [];

    // If the registering participant (team leader) is not in item.members, emit them first
    if (!hasExplicitLeaderInMembers) {
      rows.push(buildSingleParticipantRow(item, item.participant, true, serial++));
    }

    // Guard against accidental duplicate rows caused by joins or repeated member mappings
    const seenMemberKeys = new Set<string>();

    for (const member of item.members) {
      const memberKey = member.id || member.participant_id || `${member.name}-${member.email}`;
      if (seenMemberKeys.has(memberKey)) {
        continue;
      }
      seenMemberKeys.add(memberKey);

      const isLeader = Boolean(
        member.is_team_leader === true ||
        (member.participant_id && member.participant_id === item.participant.id) ||
        (member.participants?.participant_id &&
          member.participants.participant_id === item.participant.participant_id)
      );

      const memberParticipant: CsvParticipant = isLeader
        ? {
            ...item.participant,
            id: member.participant_id || item.participant.id,
            participant_id:
              member.participants?.participant_id || item.participant.participant_id,
            name: member.name || item.participant.name,
            email: member.email || item.participant.email,
            phone: member.phone || item.participant.phone,
            college: member.participants?.college || item.participant.college,
            gender: member.gender || member.participants?.gender || item.participant.gender || null,
            state: member.state || member.participants?.state || item.participant.state || null,
            accommodation: member.accommodation || item.participant.accommodation || item.accommodation,
            accommodations:
              (member.accommodations && member.accommodations.length > 0)
                ? member.accommodations
                : (item.participant.accommodations && item.participant.accommodations.length > 0)
                  ? item.participant.accommodations
                  : item.accommodations,
          }
        : {
            id: member.participant_id || member.id,
            participant_id:
              member.participants?.participant_id || member.participant_id || "",
            name: member.name,
            email: member.email || "",
            phone: member.phone || "",
            college: member.participants?.college || item.participant.college || "",
            gender: member.gender || member.participants?.gender || null,
            state: member.state || member.participants?.state || null,
            accommodation: member.accommodation ?? null,
            accommodations: member.accommodations ?? null,
          };

      rows.push(buildSingleParticipantRow(item, memberParticipant, isLeader, serial++));
    }

    return rows;
  }

  // Individual registration or team without member records
  return [buildSingleParticipantRow(item, item.participant, true, serial)];
}

/**
 * Builds a single CSV row representing an entire registration record (order-level).
 * Team registrations do NOT expand into multiple rows.
 */
export function buildRegistrationOrderRow(
  item: CsvRegistrationItem,
  serialNumber: number | string = 1
): (string | number)[] {
  return buildSingleParticipantRow(item, item.participant, true, serialNumber);
}

export function buildRegistrationCsvRow(item: CsvRegistrationItem, serialNumber: number | string = 1): (string | number)[] {
  return buildSingleParticipantRow(item, item.participant, true, serialNumber);
}

export function buildEventRegistrationCsvRow(item: CsvRegistrationItem, serialNumber: number | string = 1): (string | number)[] {
  return buildSingleParticipantRow(item, item.participant, true, serialNumber);
}

/**
 * REGISTRATION EXPORT: One CSV row per registration record (order-level).
 * Exactly items.length data rows. Teams remain on 1 row with member details preserved.
 */
export function generateRegistrationExportCsv(items: CsvRegistrationItem[]): string {
  const allRows: (string | number)[][] = [];
  let currentSerial = 1;
  for (const item of items) {
    allRows.push(buildRegistrationOrderRow(item, currentSerial++));
  }

  const rows = [
    REGISTRATION_CSV_HEADERS,
    ...allRows,
  ];

  return (
    UTF8_BOM +
    rows
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n")
  );
}

/**
 * PARTICIPANT EXPORT: One CSV row per individual participant-event registration.
 * Expands team registrations into individual rows for all members and leaders.
 */
export function generateParticipantExportCsv(items: CsvRegistrationItem[]): string {
  const allRows: (string | number)[][] = [];
  let currentSerial = 1;
  for (const item of items) {
    const itemRows = buildRegistrationCsvRows(item, currentSerial);
    allRows.push(...itemRows);
    currentSerial += itemRows.length;
  }

  const rows = [
    REGISTRATION_CSV_HEADERS,
    ...allRows,
  ];

  return (
    UTF8_BOM +
    rows
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n")
  );
}

/**
 * Unified registration CSV generator supporting both modes.
 * Default is "participant" to maintain 100% backward compatibility with existing tests.
 */
export function generateRegistrationsCsv(
  items: CsvRegistrationItem[],
  mode: "registration" | "participant" = "participant"
): string {
  return mode === "registration"
    ? generateRegistrationExportCsv(items)
    : generateParticipantExportCsv(items);
}

/**
 * Unified event registration CSV generator supporting both modes.
 * Default is "participant" to maintain 100% backward compatibility with existing tests.
 */
export function generateEventRegistrationsCsv(
  items: CsvRegistrationItem[],
  mode: "registration" | "participant" = "participant"
): string {
  return mode === "registration"
    ? generateRegistrationExportCsv(items)
    : generateParticipantExportCsv(items);
}

export {
  exportRegistrationXlsx,
  exportParticipantXlsx,
  buildRegistrationsWorkbook,
  buildParticipantsWorkbook,
  normalizeEventCategory,
  EXPORT_SHEET_NAMES,
  downloadExcelWorkbook,
} from "./excel-export";
