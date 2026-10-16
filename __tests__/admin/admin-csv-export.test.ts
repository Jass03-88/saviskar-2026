/**
 * __tests__/admin/admin-csv-export.test.ts
 *
 * Regression test suite verifying:
 * 1. Master Admin CSV exports contain complete unmasked emails and phone numbers.
 * 2. Normal Admin CSV exports contain complete unmasked emails and phone numbers.
 * 3. Unauthenticated requests to participant data are rejected (401).
 * 4. Normal Admins cannot access Master Admin-only operations (403).
 * 5. CSV exports do not accidentally contain secrets or sensitive keys.
 * 6. Special character escaping (quotes, commas, newlines) complies with RFC 4180.
 * 7. Team registrations preserve full contact details for the registering participant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateRegistrationsCsv,
  generateEventRegistrationsCsv,
  escapeCsv,
  formatDate,
  REGISTRATION_CSV_HEADERS,
  EVENT_REGISTRATION_CSV_HEADERS,
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
    gender: "male",
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
    gender: "female",
    state: "Delhi",
    id_card_storage_path: null,
    created_at: "2026-10-02T10:00:00Z",
  },
];

const mockEvents = [
  {
    id: "evt-hackathon",
    name: "Vision Hack 2026",
    category: "technical",
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

describe("SAVISKAR 2026 — Admin CSV Contact Details & Access Control", () => {
  const sampleRegistrationItem: CsvRegistrationItem = {
    participant: {
      id: "p-001",
      participant_id: "SVK26-A1B2C3D4",
      name: 'John "The Innovator" Doe',
      college: "CGC, Landran",
      email: "john.doe@gmail.com",
      phone: "9876543210",
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
      status: "paid",
      amount: 1500,
      hostel_name: "Hostel 1",
      room_number: "101",
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Main Dashboard Registrations CSV ─────────────────────────────────

  describe("1. Main Dashboard Registrations CSV Export", () => {
    it("A. Exports complete unmasked emails and phones for all participants", () => {
      const csv = generateRegistrationsCsv([sampleRegistrationItem, sampleIndividualItem]);

      // Check headers
      const lines = csv.split("\r\n");
      expect(lines[0]).toBe(REGISTRATION_CSV_HEADERS.map(escapeCsv).join(","));

      // Verify unmasked email and phone for Item 1
      expect(csv).toContain('"john.doe@gmail.com"');
      expect(csv).toContain('"9876543210"');
      expect(csv).not.toContain("j***@gmail.com");
      expect(csv).not.toContain("98*****10");

      // Verify unmasked email and phone for Item 2
      expect(csv).toContain('"s.connor@cyberdyne.org"');
      expect(csv).toContain('"+91 9123456789"');
      expect(csv).not.toContain("s***@cyberdyne.org");
      expect(csv).not.toContain("91*****89");
    });

    it("B. Correctly escapes values with internal quotes, commas, and special characters", () => {
      const csv = generateRegistrationsCsv([sampleRegistrationItem]);

      // Internal quotes in 'John "The Innovator" Doe' must become 'John ""The Innovator"" Doe'
      expect(csv).toContain('"John ""The Innovator"" Doe"');
      // College with comma must be quoted
      expect(csv).toContain('"CGC, Landran"');
    });

    it("C. Preserves team names and maps them correctly", () => {
      const csv = generateRegistrationsCsv([sampleRegistrationItem, sampleIndividualItem]);

      expect(csv).toContain('"Cyber Warriors"');
      expect(csv).toContain('"Individual"');
    });

    it("D. Handles null/empty phone gracefully without emitting 'null' string", () => {
      const itemWithNoPhone: CsvRegistrationItem = {
        ...sampleIndividualItem,
        participant: {
          ...sampleIndividualItem.participant,
          phone: null,
        },
      };

      const csv = generateRegistrationsCsv([itemWithNoPhone]);
      // Phone column should be empty quoted string ""
      const line = csv.split("\r\n")[1];
      const columns = line.split(",").map((c) => c.replace(/^"|"$/g, ""));
      const phoneIndex = REGISTRATION_CSV_HEADERS.indexOf("Phone");
      expect(columns[phoneIndex]).toBe("");
      expect(columns[phoneIndex]).not.toBe("null");
      expect(columns[phoneIndex]).not.toBe("******");
    });
  });

  // ─── 2. Event-Specific Registrations CSV ─────────────────────────────────

  describe("2. Event-Specific Registrations CSV Export", () => {
    it("A. Exports complete unmasked emails and phones in event CSV format", () => {
      const csv = generateEventRegistrationsCsv([sampleRegistrationItem, sampleIndividualItem]);

      const lines = csv.split("\r\n");
      expect(lines[0]).toBe(EVENT_REGISTRATION_CSV_HEADERS.join(","));

      expect(csv).toContain('"john.doe@gmail.com"');
      expect(csv).toContain('"9876543210"');
      expect(csv).toContain('"s.connor@cyberdyne.org"');
      expect(csv).toContain('"+91 9123456789"');

      // No masked patterns
      expect(csv).not.toContain("***");
    });

    it("B. Preserves existing event CSV columns and structure", () => {
      expect(EVENT_REGISTRATION_CSV_HEADERS).toEqual([
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
      ]);
    });
  });

  // ─── 3. Authorization & Role-Based Access Controls ───────────────────────

  describe("3. Security & Access Control Boundaries", () => {
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
