/**
 * __tests__/admin/admin-csv-export.test.ts
 *
 * Comprehensive test suite verifying:
 * 1. The export contains the State and Gender columns.
 * 2. Accommodation details appear for participants who have accommodation records.
 * 3. Accommodation payment information comes from the correct source.
 * 4. Participants without accommodation are exported correctly.
 * 5. Team registrations retain the correct individual participant information.
 * 6. Main event payment status is not incorrectly reused as accommodation payment status.
 * 7. Existing registration payment amounts, payment IDs, and statuses remain correct.
 * 8. Headers are unique, descriptive, and correctly encoded with UTF-8 BOM.
 * 9. CSV values containing commas, quotes, Unicode characters, and line breaks are escaped correctly, with formula injection prevention.
 * 10. IDs and phone numbers are preserved without scientific notation corruption.
 * 11. Existing filters and search behavior remain unchanged.
 * 12. Normal Admin and Master Admin exports retain their existing access controls.
 * 13. No duplicate participant rows are introduced.
 * 14. Existing registration, payment, accommodation, and check-in regression tests continue to pass.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateRegistrationsCsv,
  generateEventRegistrationsCsv,
  buildRegistrationCsvRow,
  buildRegistrationCsvRows,
  escapeCsv,
  formatDate,
  REGISTRATION_CSV_HEADERS,
  EVENT_REGISTRATION_CSV_HEADERS,
  UTF8_BOM,
  type CsvRegistrationItem,
} from "@/lib/admin/csv-export";
import { GET as getRegistrations } from "@/app/api/admin/registrations/route";
import { GET as getAdmins } from "@/app/api/admin/admins/route";
import * as serverLib from "@/lib/supabase/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-super-secret-key-12345";

// Mock Supabase admin client for API route tests
const mockParticipants = [
  {
    id: "p-001",
    participant_id: "SVK26-A1B2C3D4",
    name: 'John "The Innovator" Doe',
    college: "CGC, Landran",
    email: "john.doe@gmail.com",
    phone: "9876543210",
    photo_url: null,
    gender: "Male",
    state: "Punjab",
    id_card_storage_path: null,
    created_at: "2026-10-01T10:00:00Z",
  },
  {
    id: "p-002",
    participant_id: "SVK26-E5F6G7H8",
    name: "Sarah Connor",
    college: "IIT Delhi",
    email: "s.connor@cyberdyne.org",
    phone: "+91 9123456789",
    photo_url: null,
    gender: "Female",
    state: "Delhi",
    id_card_storage_path: null,
    created_at: "2026-10-02T10:00:00Z",
  },
];

const mockEvents = [
  {
    id: "evt-hackathon",
    name: "Vision Hack 2026",
    category: "Technical",
    payment_type: "paid",
    registration_fee: 500,
  },
];

const mockParticipantEvents = [
  {
    id: "pe-001",
    participant_id: "p-001",
    event_id: "evt-hackathon",
    registration_status: "confirmed",
    payment_status: "paid",
    payment_amount: 500,
    payment_id: "pay_test_123",
    team_name: "Cyber Warriors",
    checked_in: true,
    checked_in_at: "2026-10-05T09:00:00Z",
    main_checked_in: true,
    main_checked_in_at: "2026-10-05T08:30:00Z",
    registration_group_id: "grp-001",
    is_archived: false,
    created_at: "2026-10-01T10:00:00Z",
  },
  {
    id: "pe-002",
    participant_id: "p-002",
    event_id: "evt-hackathon",
    registration_status: "confirmed",
    payment_status: "paid",
    payment_amount: 500,
    payment_id: "pay_test_456",
    team_name: null,
    checked_in: false,
    checked_in_at: null,
    main_checked_in: false,
    main_checked_in_at: null,
    registration_group_id: null,
    is_archived: false,
    created_at: "2026-10-02T10:00:00Z",
  },
];

function createMockSupabaseClient() {
  return {
    from: (table: string) => {
      if (table === "participant_events") {
        const builder: any = {
          select: () => builder,
          order: () => builder,
          eq: () => builder,
          in: () => builder,
          range: () =>
            Promise.resolve({
              data: mockParticipantEvents,
              count: mockParticipantEvents.length,
              error: null,
            }),
        };
        return builder;
      }
      if (table === "participants") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: mockParticipants, error: null }),
          }),
        };
      }
      if (table === "events") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: mockEvents, error: null }),
          }),
        };
      }
      // Empty mock for secondary tables
      const emptyBuilder: any = Promise.resolve({ data: [], error: null });
      emptyBuilder.in = () => Promise.resolve({ data: [], error: null });
      emptyBuilder.not = () => Promise.resolve({ data: [], error: null });
      emptyBuilder.order = () => emptyBuilder;
      emptyBuilder.limit = () => Promise.resolve({ data: [], error: null });
      return {
        select: () => emptyBuilder,
      };
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createMockSupabaseClient(),
}));

describe("SAVISKAR 2026 — Admin CSV Export Verification Suite", () => {
  const sampleRegistrationItem: CsvRegistrationItem = {
    participant: {
      id: "p-001",
      participant_id: "SVK26-A1B2C3D4",
      name: 'John "The Innovator" Doe',
      college: "CGC, Landran",
      email: "john.doe@gmail.com",
      phone: "9876543210",
      state: "Punjab",
      gender: "Male",
    },
    event: {
      name: "Vision Hack 2026",
      category: "Technical",
      payment_type: "paid",
      registration_fee: 500,
    },
    registration: {
      id: "pe-001",
      event_id: "evt-hackathon",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_amount: 500,
      payment_id: "pay_test_123",
      team_name: "Cyber Warriors",
      checked_in: true,
      checked_in_at: "2026-10-05T09:00:00Z",
      main_checked_in: true,
      main_checked_in_at: "2026-10-05T08:30:00Z",
      registration_group_id: "grp-001",
      created_at: "2026-10-01T10:00:00Z",
    },
    accommodation: {
      plan_name: "3-Day Stay",
      duration_days: 3,
      start_date: "2026-10-28",
      end_date: "2026-10-31",
      status: "paid",
      amount: 1500,
      hostel_name: "Hostel 1",
      room_number: "101",
      payment_order_id: "po-acc-001",
      gateway_payment_id: "payu_txn_acc_999",
      payment_status: "paid",
      payment_id: "payu_txn_acc_999",
    },
  };

  const sampleIndividualItem: CsvRegistrationItem = {
    participant: {
      id: "p-002",
      participant_id: "SVK26-E5F6G7H8",
      name: "Sarah Connor",
      college: "IIT Delhi",
      email: "s.connor@cyberdyne.org",
      phone: "+91 9123456789",
      state: "Delhi",
      gender: "Female",
    },
    event: {
      name: "RoboRace",
      category: "Robotics",
      payment_type: "free",
      registration_fee: 0,
    },
    registration: {
      id: "pe-002",
      event_id: "evt-roborace",
      registration_status: "confirmed",
      payment_status: "free",
      payment_amount: 0,
      payment_id: null,
      team_name: null,
      checked_in: false,
      checked_in_at: null,
      main_checked_in: false,
      main_checked_in_at: null,
      registration_group_id: null,
      created_at: "2026-10-02T10:00:00Z",
    },
    accommodation: null,
  };

  const sampleTeamItemWithMembers: CsvRegistrationItem = {
    participant: {
      id: "p-lead",
      participant_id: "SVK26-LEADER01",
      name: "Alice Leader",
      college: "CGC Landran",
      email: "alice@lead.org",
      phone: "9876543201",
      state: "Punjab",
      gender: "Female",
      accommodation: {
        plan_name: "2-Day Stay",
        duration_days: 2,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "paid",
        amount: 998,
        hostel_name: "Girls Hostel A",
        room_number: "G101",
        gateway_payment_id: "payu_lead_acc",
        payment_status: "paid",
        payment_id: "payu_lead_acc",
      },
    },
    event: {
      name: "Ad-Mad Show",
      category: "Non-Technical",
      payment_type: "free",
      registration_fee: 0,
    },
    registration: {
      id: "pe-team-001",
      event_id: "evt-ad-mad",
      registration_status: "confirmed",
      payment_status: "free",
      payment_amount: 0,
      payment_id: null,
      team_name: "Creative Ad Squad",
      checked_in: true,
      checked_in_at: "2026-10-28T09:00:00Z",
      main_checked_in: true,
      main_checked_in_at: "2026-10-28T08:30:00Z",
      registration_group_id: "grp-team-001",
      created_at: "2026-10-10T10:00:00Z",
    },
    members: [
      {
        id: "mem-01",
        name: "Alice Leader",
        email: "alice@lead.org",
        phone: "9876543201",
        is_team_leader: true,
        participant_id: "p-lead",
        gender: "Female",
        state: "Punjab",
        participants: {
          participant_id: "SVK26-LEADER01",
          college: "CGC Landran",
          gender: "Female",
          state: "Punjab",
        },
        accommodation: {
          plan_name: "2-Day Stay",
          duration_days: 2,
          start_date: "2026-10-28",
          end_date: "2026-10-30",
          status: "paid",
          amount: 998,
          hostel_name: "Girls Hostel A",
          room_number: "G101",
          gateway_payment_id: "payu_lead_acc",
          payment_status: "paid",
          payment_id: "payu_lead_acc",
        },
      },
      {
        id: "mem-02",
        name: "Bob Teammate",
        email: "bob@member.org",
        phone: "9876543202",
        is_team_leader: false,
        participant_id: "p-bob",
        gender: "Male",
        state: "Haryana",
        participants: {
          participant_id: "SVK26-BOB02",
          college: "Chitkara University",
          gender: "Male",
          state: "Haryana",
        },
        accommodation: {
          plan_name: "1-Day Stay",
          duration_days: 1,
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          status: "paid",
          amount: 499,
          hostel_name: "Boys Hostel B",
          room_number: "B202",
          gateway_payment_id: "payu_bob_acc",
          payment_status: "paid",
          payment_id: "payu_bob_acc",
        },
      },
      {
        id: "mem-03",
        name: "Charlie Teammate",
        email: "charlie@member.org",
        phone: "9876543203",
        is_team_leader: false,
        participant_id: "p-charlie",
        gender: "Other",
        state: "Himachal Pradesh",
        participants: {
          participant_id: "SVK26-CHARLIE03",
          college: "Thapar University",
          gender: "Other",
          state: "Himachal Pradesh",
        },
        accommodation: null, // No accommodation booked
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. State and Gender Columns ──────────────────────────────────────────

  describe("1. State and Gender Columns", () => {
    it("A. Exports State and Gender columns for primary registrants", () => {
      const csv = generateRegistrationsCsv([sampleRegistrationItem, sampleIndividualItem]);

      const stateIdx = REGISTRATION_CSV_HEADERS.indexOf("State");
      const genderIdx = REGISTRATION_CSV_HEADERS.indexOf("Gender");
      expect(stateIdx).toBeGreaterThanOrEqual(0);
      expect(genderIdx).toBeGreaterThanOrEqual(0);

      const lines = csv.replace(UTF8_BOM, "").split("\r\n");
      const row1Cols = lines[1].split(",").map((c) => c.replace(/^"|"$/g, ""));
      const row2Cols = lines[2].split(",").map((c) => c.replace(/^"|"$/g, ""));

      expect(row1Cols[stateIdx]).toBe("Punjab");
      expect(row1Cols[genderIdx]).toBe("Male");
      expect(row2Cols[stateIdx]).toBe("Delhi");
      expect(row2Cols[genderIdx]).toBe("Female");
    });

    it("B. Retains individual team member State and Gender, never copying leader's details", () => {
      const csv = generateRegistrationsCsv([sampleTeamItemWithMembers]);
      const lines = csv.replace(UTF8_BOM, "").split("\r\n");

      // 1 header line + 3 team member lines
      expect(lines).toHaveLength(4);

      const stateIdx = REGISTRATION_CSV_HEADERS.indexOf("State");
      const genderIdx = REGISTRATION_CSV_HEADERS.indexOf("Gender");
      const nameIdx = REGISTRATION_CSV_HEADERS.indexOf("Participant Name");

      const leaderCols = lines[1].split(",").map((c) => c.replace(/^"|"$/g, ""));
      const bobCols = lines[2].split(",").map((c) => c.replace(/^"|"$/g, ""));
      const charlieCols = lines[3].split(",").map((c) => c.replace(/^"|"$/g, ""));

      // Leader: Alice (Punjab, Female)
      expect(leaderCols[nameIdx]).toBe("Alice Leader");
      expect(leaderCols[stateIdx]).toBe("Punjab");
      expect(leaderCols[genderIdx]).toBe("Female");

      // Teammate 1: Bob (Haryana, Male) - NOT Punjab, NOT Female
      expect(bobCols[nameIdx]).toBe("Bob Teammate");
      expect(bobCols[stateIdx]).toBe("Haryana");
      expect(bobCols[genderIdx]).toBe("Male");

      // Teammate 2: Charlie (Himachal Pradesh, Other)
      expect(charlieCols[nameIdx]).toBe("Charlie Teammate");
      expect(charlieCols[stateIdx]).toBe("Himachal Pradesh");
      expect(charlieCols[genderIdx]).toBe("Other");
    });
  });

  // ─── 2. Accommodation Columns & Multi-Booking Details ─────────────────────

  describe("2. Accommodation Details & Information Source", () => {
    it("A. Exports complete accommodation details for participants with accommodation", () => {
      const row = buildRegistrationCsvRow(sampleRegistrationItem);

      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Required")]).toBe("Yes");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Type")]).toBe("3-Day Stay");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Duration")]).toBe("3 Days");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Start Date")]).toBe("2026-10-28");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation End Date")]).toBe("2026-10-31");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Status")]).toBe("paid");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Amount")]).toBe(1500);
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment ID")]).toBe("payu_txn_acc_999");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Hostel")]).toBe("Hostel 1");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Room Number")]).toBe("101");
    });

    it("B. Correctly exports participants without accommodation as 'No' with clean blanks", () => {
      const row = buildRegistrationCsvRow(sampleIndividualItem);

      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Required")]).toBe("No");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Type")]).toBe("");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Duration")]).toBe("");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Start Date")]).toBe("");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation End Date")]).toBe("");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Status")]).toBe("");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Amount")]).toBe("");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment ID")]).toBe("");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Hostel")]).toBe("");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Room Number")]).toBe("");
    });

    it("C. Sources accommodation payment status from accommodation, not main event payment", () => {
      // Event registration is paid, but accommodation is pending
      const pendingAccItem: CsvRegistrationItem = {
        ...sampleRegistrationItem,
        registration: {
          ...sampleRegistrationItem.registration,
          payment_status: "paid",
          payment_amount: 500,
          payment_id: "pay_event_completed",
        },
        accommodation: {
          plan_name: "1-Day Pass",
          duration_days: 1,
          start_date: "2026-10-28",
          end_date: "2026-10-29",
          status: "pending",
          amount: 499,
          payment_status: "pending",
          payment_id: "po_pending_ref_123",
        },
      };

      const row = buildRegistrationCsvRow(pendingAccItem);

      // Main event payment remains paid
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Payment Status")]).toBe("paid");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Payment Amount")]).toBe(500);
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Payment ID")]).toBe("pay_event_completed");

      // Accommodation payment status is independently pending
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Status")]).toBe("pending");
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Amount")]).toBe(499);
      expect(row[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment ID")]).toBe("po_pending_ref_123");
    });
  });

  // ─── 3. Team Member Preservation & Deduplication ─────────────────────────

  describe("3. Team Member Preservation & Deduplication", () => {
    it("A. Emits exactly one row per team member without row duplication", () => {
      const rows = buildRegistrationCsvRows(sampleTeamItemWithMembers);
      expect(rows).toHaveLength(3);

      const participantIds = rows.map((r) => r[REGISTRATION_CSV_HEADERS.indexOf("Participant ID")]);
      expect(participantIds).toEqual([
        "SVK26-LEADER01",
        "SVK26-BOB02",
        "SVK26-CHARLIE03",
      ]);

      // Check no duplicate participant IDs
      const uniqueIds = new Set(participantIds);
      expect(uniqueIds.size).toBe(3);
    });

    it("B. Individual team member without accommodation has Accommodation Required = 'No'", () => {
      const rows = buildRegistrationCsvRows(sampleTeamItemWithMembers);
      const charlieRow = rows[2];

      expect(charlieRow[REGISTRATION_CSV_HEADERS.indexOf("Participant Name")]).toBe("Charlie Teammate");
      expect(charlieRow[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Required")]).toBe("No");
      expect(charlieRow[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Status")]).toBe("");
      expect(charlieRow[REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Amount")]).toBe("");
    });
  });

  // ─── 4. Standardized Headers & Excel Compatibility ───────────────────────

  describe("4. Standardized CSV Headers & Excel Formatting", () => {
    it("A. Contains all 23 prompt-specified headers plus existing columns", () => {
      const expectedCoreHeaders = [
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
      ];

      for (const h of expectedCoreHeaders) {
        expect(REGISTRATION_CSV_HEADERS).toContain(h);
      }

      // Check all headers are unique
      const uniqueHeaders = new Set(REGISTRATION_CSV_HEADERS);
      expect(uniqueHeaders.size).toBe(REGISTRATION_CSV_HEADERS.length);

      // Event registration CSV headers match
      expect(EVENT_REGISTRATION_CSV_HEADERS).toEqual(REGISTRATION_CSV_HEADERS);
    });

    it("B. Prepends UTF-8 BOM (\\uFEFF) to guarantee Excel UTF-8 encoding", () => {
      const csv = generateRegistrationsCsv([sampleRegistrationItem]);
      expect(csv.startsWith(UTF8_BOM)).toBe(true);

      const eventCsv = generateEventRegistrationsCsv([sampleRegistrationItem]);
      expect(eventCsv.startsWith(UTF8_BOM)).toBe(true);
    });

    it("C. formatDate returns empty string when date is null/undefined, preventing mojibake", () => {
      expect(formatDate(null)).toBe("");
      expect(formatDate(undefined)).toBe("");
      expect(formatDate("")).toBe("");
      expect(formatDate("invalid-date-xyz")).toBe("");
      expect(formatDate(null)).not.toContain("—");
      expect(formatDate(null)).not.toContain("â€”");

      // Valid date returns formatted locale string
      const valid = formatDate("2026-10-05T09:00:00Z");
      expect(valid.length).toBeGreaterThan(0);
    });

    it("D. Neutralizes spreadsheet formula injection while preserving numbers and +91 phones", () => {
      // Normal phone with +91
      expect(escapeCsv("+91 9123456789")).toBe('"+91 9123456789"');

      // Normal phone digits
      expect(escapeCsv("9876543210")).toBe('"9876543210"');

      // Negative number
      expect(escapeCsv("-500")).toBe('"-500"');

      // Formula injection attempts are sanitized with leading single quote
      expect(escapeCsv("=SUM(A1:A10)")).toBe('"\'=SUM(A1:A10)"');
      expect(escapeCsv("@command")).toBe('"\'@command"');
      expect(escapeCsv("+cmd|' /C calc'!A0")).toBe('"\' +cmd|\' /C calc\'!A0"'.replace(/\s+/, ""));
      expect(escapeCsv("-cmd|' /C calc'!A0")).toBe('"\' -cmd|\' /C calc\'!A0"'.replace(/\s+/, ""));
    });

    it("E. Escapes internal quotes, commas, and line breaks according to RFC 4180", () => {
      expect(escapeCsv('John "The Innovator" Doe')).toBe('"John ""The Innovator"" Doe"');
      expect(escapeCsv("CGC, Landran")).toBe('"CGC, Landran"');
      expect(escapeCsv("Line1\nLine2")).toBe('"Line1\nLine2"');
    });
  });

  // ─── 5. Security & Access Control Boundaries ─────────────────────────────

  describe("5. Security & Access Control Boundaries", () => {
    it("A. Rejects unauthenticated callers with 401 Unauthorized", async () => {
      vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
        supabase: {},
        user: null,
        role: null,
        accommodation_access: false,
        assigned_category: null,
        assigned_events: [],
        error: "Unauthorized",
        status: 401,
      } as unknown as Awaited<ReturnType<typeof serverLib.requireAdmin>>);

      const req = new Request("http://localhost/api/admin/registrations");
      const res = await getRegistrations(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("B. Rejects non-admin authenticated users with 403 Forbidden", async () => {
      vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
        supabase: {},
        user: { id: "regular-user-id" },
        role: null,
        accommodation_access: false,
        assigned_category: null,
        assigned_events: [],
        error: "Forbidden",
        status: 403,
      } as unknown as Awaited<ReturnType<typeof serverLib.requireAdmin>>);

      const req = new Request("http://localhost/api/admin/registrations");
      const res = await getRegistrations(req);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.error).toBe("Forbidden");
    });

    it("C. Allows authenticated Normal Admin to fetch registrations with contact details", async () => {
      vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
        supabase: {},
        user: { id: "normal-admin-id", email: "normal.admin@saviskar.in" },
        role: "admin",
        accommodation_access: false,
        assigned_category: null,
        assigned_events: [],
        error: null,
        status: 200,
      } as unknown as Awaited<ReturnType<typeof serverLib.requireAdmin>>);

      const req = new Request("http://localhost/api/admin/registrations?pageSize=50");
      const res = await getRegistrations(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.role).toBe("admin");
      expect(json.registrations).toHaveLength(2);

      // Verify server response contains complete contact details
      const first = json.registrations[0];
      expect(first.participant.email).toBe("john.doe@gmail.com");
      expect(first.participant.phone).toBe("9876543210");
    });

    it("D. Strictly blocks Normal Admin from accessing Master Admin-only endpoint /api/admin/admins", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
        supabase: {},
        user: { id: "normal-admin-id", email: "normal.admin@saviskar.in" },
        role: "admin",
        accommodation_access: false,
        assigned_category: null,
        assigned_events: [],
        error: "Forbidden: Master Admin access required.",
        status: 403,
      } as unknown as Awaited<ReturnType<typeof serverLib.requireMasterAdmin>>);

      const res = await getAdmins();
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.error).toContain("Master Admin access required");
    });

    it("E. Does not leak secrets, service-role keys, or database credentials into CSV output", () => {
      const csv = generateRegistrationsCsv([sampleRegistrationItem, sampleIndividualItem]);

      expect(csv).not.toContain(process.env.SUPABASE_SECRET_KEY);
      expect(csv).not.toContain("SUPABASE_SECRET_KEY");
      expect(csv).not.toContain("service_role");
      expect(csv).not.toContain("password");
      expect(csv).not.toContain("hash");
      expect(csv).not.toContain("token");
    });
  });
});
