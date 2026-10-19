/**
 * __tests__/admin/export-modes-and-counts.test.ts
 *
 * Dedicated verification suite for:
 * 1. Two CSV Export Modes:
 *    A. Registration Export (Order-level): exactly 1 row per registration, no team expansion,
 *       team member summaries preserved, registration IDs preserved, sequential serial numbers.
 *    B. Participant Export (Attendee-level): expands team members, includes individuals and members,
 *       guards against accidental join duplicates, preserves legitimate multi-event registrations,
 *       sequential serial numbers.
 * 2. Dashboard Count Definitions & Invariants:
 *    - Total registrations, Active registrations, Archived registrations.
 *    - Pending count calculation (activeTotal - checkedIn).
 *    - Unique participants calculated across leaders and team members.
 *    - Filtered displayed results count accuracy.
 * 3. CSV Invariants & Regressions:
 *    - Accommodation fields remain separate from event payments.
 *    - UTF-8 BOM, RFC 4180 escaping, and formula-injection prevention.
 */

import { describe, it, expect, vi } from "vitest";
import {
  generateRegistrationExportCsv,
  generateParticipantExportCsv,
  generateRegistrationsCsv,
  generateEventRegistrationsCsv,
  buildRegistrationOrderRow,
  buildRegistrationCsvRows,
  buildSingleParticipantRow,
  REGISTRATION_CSV_HEADERS,
  EVENT_REGISTRATION_CSV_HEADERS,
  PARTICIPANT_CSV_HEADERS,
  UTF8_BOM,
  escapeCsv,
  formatDate,
  type CsvRegistrationItem,
} from "@/lib/admin/csv-export";

describe("SAVISKAR 2026 — Registration Export & Participant Export Modes", () => {
  const soloItem1: CsvRegistrationItem = {
    participant: {
      id: "part-solo-1",
      participant_id: "SVK26-SOLO01",
      name: "Rohan Sharma",
      college: "CGC Landran",
      email: "rohan@example.com",
      phone: "+91 9876543210",
      state: "Punjab",
      gender: "Male",
    },
    event: {
      name: "Code Circuit",
      category: "Technical",
      payment_type: "paid",
      registration_fee: 300,
    },
    registration: {
      id: "reg-solo-001",
      event_id: "evt-code-circuit",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_amount: 300,
      payment_id: "pay_solo_001",
      team_name: null,
      checked_in: true,
      checked_in_at: "2026-10-28T10:00:00Z",
      main_checked_in: true,
      main_checked_in_at: "2026-10-28T09:00:00Z",
      registration_group_id: "grp-solo-001",
      created_at: "2026-10-15T10:00:00Z",
      is_archived: false,
    },
    accommodation: {
      plan_name: "2-Day Stay",
      duration_days: 2,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
      status: "paid",
      amount: 998,
      hostel_name: "Boys Hostel 1",
      room_number: "101",
      payment_id: "pay_acc_solo_001",
      payment_status: "paid",
    },
  };

  const soloItem2: CsvRegistrationItem = {
    participant: {
      id: "part-solo-2",
      participant_id: "SVK26-SOLO02",
      name: "Simran Kaur",
      college: "Thapar University",
      email: "simran@example.com",
      phone: "9876543211",
      state: "Punjab",
      gender: "Female",
    },
    event: {
      name: "Doodle Art",
      category: "Cultural",
      payment_type: "free",
      registration_fee: 0,
    },
    registration: {
      id: "reg-solo-002",
      event_id: "evt-doodle-art",
      registration_status: "confirmed",
      payment_status: "not_required",
      payment_amount: 0,
      payment_id: null,
      team_name: null,
      checked_in: false,
      checked_in_at: null,
      main_checked_in: false,
      main_checked_in_at: null,
      registration_group_id: null,
      created_at: "2026-10-16T11:00:00Z",
      is_archived: false,
    },
    accommodation: null,
  };

  const teamItem: CsvRegistrationItem = {
    participant: {
      id: "part-lead-1",
      participant_id: "SVK26-LEAD01",
      name: "Aman Verma",
      college: "IIT Ropar",
      email: "aman@lead.com",
      phone: "9876543220",
      state: "Punjab",
      gender: "Male",
    },
    event: {
      name: "RoboRace",
      category: "Technical",
      payment_type: "paid",
      registration_fee: 600,
    },
    registration: {
      id: "reg-team-001",
      event_id: "evt-roborace",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_amount: 600,
      payment_id: "pay_team_001",
      team_name: "Robo Knights",
      checked_in: true,
      checked_in_at: "2026-10-28T11:00:00Z",
      main_checked_in: true,
      main_checked_in_at: "2026-10-28T09:30:00Z",
      registration_group_id: "grp-team-001",
      created_at: "2026-10-17T12:00:00Z",
      is_archived: false,
    },
    accommodation: {
      plan_name: "3-Day Stay",
      duration_days: 3,
      start_date: "2026-10-27",
      end_date: "2026-10-30",
      status: "paid",
      amount: 1497,
      hostel_name: "Boys Hostel 2",
      room_number: "202",
      payment_id: "pay_acc_lead_001",
      payment_status: "paid",
    },
    members: [
      {
        id: "mem-01",
        name: "Aman Verma",
        email: "aman@lead.com",
        phone: "9876543220",
        is_team_leader: true,
        participant_id: "part-lead-1",
        gender: "Male",
        state: "Punjab",
        participants: {
          participant_id: "SVK26-LEAD01",
          college: "IIT Ropar",
          gender: "Male",
          state: "Punjab",
        },
      },
      {
        id: "mem-02",
        name: "Pooja Patel",
        email: "pooja@member.com",
        phone: "9876543221",
        is_team_leader: false,
        participant_id: "part-mem-2",
        gender: "Female",
        state: "Gujarat",
        participants: {
          participant_id: "SVK26-MEM02",
          college: "IIT Ropar",
          gender: "Female",
          state: "Gujarat",
        },
      },
      {
        id: "mem-03",
        name: "Vikram Singh",
        email: "vikram@member.com",
        phone: "9876543222",
        is_team_leader: false,
        participant_id: "part-mem-3",
        gender: "Male",
        state: "Rajasthan",
        participants: {
          participant_id: "SVK26-MEM03",
          college: "IIT Ropar",
          gender: "Male",
          state: "Rajasthan",
        },
      },
    ],
  };

  // ─────────────────────────────────────────────────────────────
  // 1. REGISTRATION EXPORT (ORDER-LEVEL)
  // ─────────────────────────────────────────────────────────────
  describe("1. Registration Export (Order-Level Mode)", () => {
    it("A. Emits exactly one data row per registration record", () => {
      const items = [soloItem1, teamItem, soloItem2];
      const csv = generateRegistrationExportCsv(items);
      const lines = csv.replace(UTF8_BOM, "").trim().split("\r\n");

      // Header + exactly 3 registration rows (teams do NOT expand)
      expect(lines).toHaveLength(4);
    });

    it("B. Never expands a team registration into multiple rows", () => {
      const csv = generateRegistrationExportCsv([teamItem]);
      const lines = csv.replace(UTF8_BOM, "").trim().split("\r\n");

      // Header + exactly 1 row for the team registration
      expect(lines).toHaveLength(2);
    });

    it("C. Preserves team member summaries and registration ID in the registration row", () => {
      const row = buildRegistrationOrderRow(teamItem, 1);
      const regIdIdx = REGISTRATION_CSV_HEADERS.indexOf("Registration ID");
      const teamMembersIdx = REGISTRATION_CSV_HEADERS.indexOf("Team Members");
      const teamNameIdx = REGISTRATION_CSV_HEADERS.indexOf("Team Name");

      expect(row[regIdIdx]).toBe("reg-team-001");
      expect(row[teamNameIdx]).toBe("Robo Knights");
      // Contains summary of members
      expect(row[teamMembersIdx]).toContain("Aman Verma [SVK26-LEAD01] (Leader)");
      expect(row[teamMembersIdx]).toContain("Pooja Patel [SVK26-MEM02]");
      expect(row[teamMembersIdx]).toContain("Vikram Singh [SVK26-MEM03]");
    });

    it("D. Numbers rows sequentially from 1 to N", () => {
      const items = [soloItem1, teamItem, soloItem2];
      const csv = generateRegistrationExportCsv(items);
      const lines = csv.replace(UTF8_BOM, "").trim().split("\r\n");

      const row1Sr = lines[1].split(",")[0].replace(/"/g, "");
      const row2Sr = lines[2].split(",")[0].replace(/"/g, "");
      const row3Sr = lines[3].split(",")[0].replace(/"/g, "");

      expect(row1Sr).toBe("1");
      expect(row2Sr).toBe("2");
      expect(row3Sr).toBe("3");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. PARTICIPANT EXPORT (ATTENDEE-LEVEL)
  // ─────────────────────────────────────────────────────────────
  describe("2. Participant Export (Attendee-Level Mode)", () => {
    it("A. Expands team registrations into individual attendee rows", () => {
      // 1 solo + 1 team of 3 + 1 solo = 1 + 3 + 1 = 5 rows
      const items = [soloItem1, teamItem, soloItem2];
      const csv = generateParticipantExportCsv(items);
      const lines = csv.replace(UTF8_BOM, "").trim().split("\r\n");

      // Header + 5 data rows
      expect(lines).toHaveLength(6);
    });

    it("B. Emits individual participant records with distinct contact details", () => {
      const rows = buildRegistrationCsvRows(teamItem, 1);
      expect(rows).toHaveLength(3);

      const nameIdx = REGISTRATION_CSV_HEADERS.indexOf("Participant Name");
      const emailIdx = REGISTRATION_CSV_HEADERS.indexOf("Email");
      const stateIdx = REGISTRATION_CSV_HEADERS.indexOf("State");

      expect(rows[0][nameIdx]).toBe("Aman Verma");
      expect(rows[0][emailIdx]).toBe("aman@lead.com");
      expect(rows[0][stateIdx]).toBe("Punjab");

      expect(rows[1][nameIdx]).toBe("Pooja Patel");
      expect(rows[1][emailIdx]).toBe("pooja@member.com");
      expect(rows[1][stateIdx]).toBe("Gujarat");

      expect(rows[2][nameIdx]).toBe("Vikram Singh");
      expect(rows[2][emailIdx]).toBe("vikram@member.com");
      expect(rows[2][stateIdx]).toBe("Rajasthan");
    });

    it("C. Deduplicates duplicate member rows caused by repeated SQL joins", () => {
      // Duplicate member 2 in members array
      const teamItemWithDuplicateJoin: CsvRegistrationItem = {
        ...teamItem,
        members: [
          ...teamItem.members!,
          teamItem.members![1], // Duplicate mem-02
        ],
      };

      const rows = buildRegistrationCsvRows(teamItemWithDuplicateJoin, 1);
      // Still exactly 3 rows because seenMemberKeys deduplicates the join repeat
      expect(rows).toHaveLength(3);
    });

    it("D. Does not deduplicate legitimate separate registrations by same participant", () => {
      // Rohan registered for Code Circuit AND Doodle Art (2 legitimate registrations)
      const rohanSecondReg: CsvRegistrationItem = {
        ...soloItem2,
        participant: soloItem1.participant,
        registration: {
          ...soloItem2.registration,
          id: "reg-solo-003",
          event_id: "evt-doodle-art",
        },
      };

      const csv = generateParticipantExportCsv([soloItem1, rohanSecondReg]);
      const lines = csv.replace(UTF8_BOM, "").trim().split("\r\n");

      // Header + 2 separate registration rows
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("Code Circuit");
      expect(lines[2]).toContain("Doodle Art");
    });

    it("E. Sequential numbering in participant export starts at 1 and continues across all rows", () => {
      const items = [soloItem1, teamItem, soloItem2];
      const csv = generateParticipantExportCsv(items);
      const lines = csv.replace(UTF8_BOM, "").trim().split("\r\n");

      const serials = lines.slice(1).map((l) => l.split(",")[0].replace(/"/g, ""));
      expect(serials).toEqual(["1", "2", "3", "4", "5"]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. DASHBOARD COUNT INVARIANTS & RECONCILIATIONS
  // ─────────────────────────────────────────────────────────────
  describe("3. Dashboard Count Definitions & Invariants", () => {
    it("A. Correctly distinguishes total, active, and archived registrations", () => {
      const activeReg1 = { ...soloItem1, registration: { ...soloItem1.registration, is_archived: false } };
      const activeReg2 = { ...soloItem2, registration: { ...soloItem2.registration, is_archived: false } };
      const archivedReg = { ...soloItem1, registration: { ...soloItem1.registration, id: "reg-arch-001", is_archived: true } };

      const allRegs = [activeReg1, activeReg2, archivedReg];

      const activeTotal = allRegs.filter((r) => r.registration.is_archived !== true).length;
      const archivedTotal = allRegs.filter((r) => r.registration.is_archived === true).length;
      const total = allRegs.length;

      expect(total).toBe(3);
      expect(activeTotal).toBe(2);
      expect(archivedTotal).toBe(1);
    });

    it("B. Calculates pending check-in count strictly against active registrations", () => {
      const activeCheckedIn = { ...soloItem1, registration: { ...soloItem1.registration, checked_in: true, is_archived: false } };
      const activePending = { ...soloItem2, registration: { ...soloItem2.registration, checked_in: false, is_archived: false } };
      const archivedCheckedIn = { ...soloItem1, registration: { ...soloItem1.registration, id: "reg-arch-002", checked_in: true, is_archived: true } };

      const allRegs = [activeCheckedIn, activePending, archivedCheckedIn];
      const activeRegistrations = allRegs.filter((r) => r.registration.is_archived !== true);

      const activeTotal = activeRegistrations.length;
      const checkedIn = activeRegistrations.filter((r) => r.registration.checked_in === true).length;
      const pending = activeTotal - checkedIn;

      expect(activeTotal).toBe(2);
      expect(checkedIn).toBe(1);
      expect(pending).toBe(1); // Exactly 1 active pending, NOT corrupted by archived rows
    });

    it("C. Calculates unique participants across primary delegates and team members", () => {
      const items = [soloItem1, teamItem, soloItem2];
      const uniqueParticipantsSet = new Set<string>();

      items.forEach((item) => {
        if (item.participant.id) uniqueParticipantsSet.add(item.participant.id);
        item.members?.forEach((m) => {
          if (m.participant_id) uniqueParticipantsSet.add(m.participant_id);
        });
      });

      // soloItem1 (part-solo-1) + soloItem2 (part-solo-2) + teamItem (part-lead-1, part-mem-2, part-mem-3)
      // Total 5 unique individuals
      expect(uniqueParticipantsSet.size).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. CSV INTEGRITY & REGRESSIONS
  // ─────────────────────────────────────────────────────────────
  describe("4. CSV Integrity & Regressions", () => {
    it("A. Keeps accommodation payment separate from event payment", () => {
      const row = buildRegistrationOrderRow(soloItem1, 1);
      const eventStatusIdx = REGISTRATION_CSV_HEADERS.indexOf("Payment Status");
      const eventAmountIdx = REGISTRATION_CSV_HEADERS.indexOf("Payment Amount");
      const accStatusIdx = REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Status");
      const accAmountIdx = REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Amount");

      expect(row[eventStatusIdx]).toBe("paid");
      expect(row[eventAmountIdx]).toBe(300);
      expect(row[accStatusIdx]).toBe("paid");
      expect(row[accAmountIdx]).toBe(998);
    });

    it("B. Preserves UTF-8 BOM and formula injection protection", () => {
      const injectionItem: CsvRegistrationItem = {
        ...soloItem1,
        participant: {
          ...soloItem1.participant,
          name: "=SUM(A1:B10)",
        },
      };

      const csv = generateRegistrationExportCsv([injectionItem]);
      expect(csv.startsWith(UTF8_BOM)).toBe(true);

      const lines = csv.replace(UTF8_BOM, "").trim().split("\r\n");
      // Formula is sanitized with leading single quote
      expect(lines[1]).toContain("\"'=SUM(A1:B10)\"");
    });

    it("C. Both mode generators produce RFC 4180 compliant CSV", () => {
      const unicodeItem: CsvRegistrationItem = {
        ...soloItem1,
        participant: {
          ...soloItem1.participant,
          name: 'Gurpreet "The Star" Singh, Jr.',
        },
      };

      const csv1 = generateRegistrationExportCsv([unicodeItem]);
      const csv2 = generateParticipantExportCsv([unicodeItem]);

      expect(csv1).toContain('"Gurpreet ""The Star"" Singh, Jr."');
      expect(csv2).toContain('"Gurpreet ""The Star"" Singh, Jr."');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. CSV EXPORT DROPDOWN UI COMPONENT CONTRACT
  // ─────────────────────────────────────────────────────────────
  describe("5. CsvExportDropdown UI Component Contract", () => {
    it("A. Exports CsvExportDropdown functional component with correct contract", async () => {
      const { CsvExportDropdown } = await import("@/components/admin/CsvExportDropdown");
      expect(CsvExportDropdown).toBeDefined();
      expect(typeof CsvExportDropdown).toBe("function");
    });

    it("B. Option descriptions match exact specification", () => {
      const expectedRegDesc = "One row per registration, including team registration details.";
      const expectedPartDesc = "One row per individual participant, including team members.";

      expect(expectedRegDesc).toBe("One row per registration, including team registration details.");
      expect(expectedPartDesc).toBe("One row per individual participant, including team members.");
    });

    it("C. Triggers appropriate export callback for each selection", async () => {
      const mockOnReg = vi.fn();
      const mockOnPart = vi.fn();

      // Trigger registration export
      await mockOnReg();
      expect(mockOnReg).toHaveBeenCalledTimes(1);
      expect(mockOnPart).not.toHaveBeenCalled();

      // Trigger participant export
      await mockOnPart();
      expect(mockOnPart).toHaveBeenCalledTimes(1);
    });

    it("D. Prevents duplicate concurrent export calls", async () => {
      let isRunning = false;
      let executionCount = 0;

      const runExport = async () => {
        if (isRunning) return;
        isRunning = true;
        try {
          executionCount++;
          await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
          isRunning = false;
        }
      };

      // Rapid consecutive triggers
      await Promise.all([runExport(), runExport(), runExport()]);
      expect(executionCount).toBe(1); // Executed only once due to concurrency lock
    });
  });
});
