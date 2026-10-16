/**
 * lib/admin/csv-export.ts
 *
 * Server/client-agnostic CSV serialization helpers for Saviskar 2026 Admin exports.
 * Generates unmasked, RFC-4180 compliant CSV strings containing complete participant
 * contact details (email and phone) for authorized administrative exports.
 */

export type CsvParticipant = {
  id?: string;
  participant_id: string;
  name: string;
  college?: string | null;
  email: string;
  phone?: string | null;
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
  accommodation?: {
    plan_name?: string | null;
    status?: string | null;
    amount?: number | null;
    hostel_name?: string | null;
    room_number?: string | null;
    [key: string]: unknown;
  } | null;
  members?: Array<{
    name: string;
    email?: string | null;
    phone?: string | null;
    is_team_leader?: boolean | null;
    participants?: {
      participant_id?: string | null;
      college?: string | null;
    } | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export function escapeCsv(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* =========================================================
   1. MAIN DASHBOARD REGISTRATIONS CSV
========================================================= */

export const REGISTRATION_CSV_HEADERS: string[] = [
  "Participant ID",
  "Name",
  "College",
  "Email",
  "Phone",
  "Event",
  "Category",
  "Team",
  "Registration Status",
  "Payment Status",
  "Payment Amount",
  "Payment ID",
  "Main Checked In",
  "Main Checked In At",
  "Event Checked In",
  "Event Checked In At",
  "Accommodation Plan",
  "Accommodation Status",
  "Accommodation Amount",
  "Hostel",
  "Room Number",
  "Registration Group ID",
  "Registered At",
];

export function buildRegistrationCsvRow(item: CsvRegistrationItem): (string | number)[] {
  return [
    item.participant.participant_id,
    item.participant.name,
    item.participant.college ?? "",
    item.participant.email ?? "",
    item.participant.phone ?? "",
    item.event?.name ?? item.registration.event_id,
    item.event?.category ?? "",
    item.registration.team_name ?? "Individual",
    item.registration.registration_status ?? "",
    item.registration.payment_status ?? "",
    item.registration.payment_amount ?? 0,
    item.registration.payment_id ?? "",
    item.registration.main_checked_in ? "Yes" : "No",
    formatDate(item.registration.main_checked_in_at),
    item.registration.checked_in ? "Yes" : "No",
    formatDate(item.registration.checked_in_at),
    item.accommodation?.plan_name ?? "None",
    item.accommodation?.status ?? "None",
    item.accommodation?.amount ?? 0,
    item.accommodation?.hostel_name ?? "Unassigned",
    item.accommodation?.room_number ?? "Unassigned",
    (item.registration as Record<string, unknown>).registration_group_id as string ?? "",
    formatDate(item.registration.created_at),
  ];
}

export function generateRegistrationsCsv(items: CsvRegistrationItem[]): string {
  const rows = [
    REGISTRATION_CSV_HEADERS,
    ...items.map(buildRegistrationCsvRow),
  ];

  return rows
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");
}

/* =========================================================
   2. EVENT-SPECIFIC REGISTRATIONS CSV
========================================================= */

export const EVENT_REGISTRATION_CSV_HEADERS: string[] = [
  "Participant ID",
  "Name",
  "Event",
  "College",
  "Email",
  "Phone",
  "Team",
  "Registration Group ID",
  "Registration Status",
  "Payment Status",
  "Payment Amount",
  "Payment ID",
  "Event Checked In",
  "Event Checked In At",
  "Main Checked In",
  "Main Checked In At",
  "Registered At",
];

export function buildEventRegistrationCsvRow(item: CsvRegistrationItem): string[] {
  return [
    escapeCsv(item.participant.participant_id),
    escapeCsv(item.participant.name),
    escapeCsv(item.event?.name ?? item.registration.event_id),
    escapeCsv(item.participant.college ?? ""),
    escapeCsv(item.participant.email ?? ""),
    escapeCsv(item.participant.phone ?? ""),
    escapeCsv(item.registration.team_name ?? "Individual"),
    escapeCsv(item.registration.registration_group_id ?? ""),
    escapeCsv(item.registration.registration_status ?? ""),
    escapeCsv(item.registration.payment_status ?? ""),
    escapeCsv(item.registration.payment_amount ?? 0),
    escapeCsv(item.registration.payment_id ?? ""),
    escapeCsv(item.registration.checked_in ? "Yes" : "No"),
    escapeCsv(
      item.registration.checked_in_at
        ? formatDate(item.registration.checked_in_at)
        : ""
    ),
    escapeCsv(item.registration.main_checked_in ? "Yes" : "No"),
    escapeCsv(
      item.registration.main_checked_in_at
        ? formatDate(item.registration.main_checked_in_at)
        : ""
    ),
    escapeCsv(formatDate(item.registration.created_at)),
  ];
}

export function generateEventRegistrationsCsv(items: CsvRegistrationItem[]): string {
  const rows = [
    EVENT_REGISTRATION_CSV_HEADERS,
    ...items.map(buildEventRegistrationCsvRow),
  ];

  return rows.map((row) => row.join(",")).join("\r\n");
}
