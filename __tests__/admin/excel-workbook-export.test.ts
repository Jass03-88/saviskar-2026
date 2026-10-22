/**
 * __tests__/admin/excel-workbook-export.test.ts
 *
 * Comprehensive verification suite for Saviskar 2026 Four-Sheet Excel Export:
 * 1. Valid XLSX workbook generation for Registration and Participant exports.
 * 2. Exactly four worksheets with correct names and order:
 *    - Registrations: All Registrations, Technical, Non-Technical, Cultural
 *    - Participants: All Participants, Technical, Non-Technical, Cultural
 * 3. Complete dataset preservation on 'All' sheets (including hospitality/accommodation records).
 * 4. Authoritative event category classification (Technical, Non-Technical, Cultural).
 * 5. Multi-event registrations spanning categories and single-category scoping.
 * 6. Empty category sheet presence with headers.
 * 7. Row semantics: Order-level (1 row per team) vs Attendee-level (expanded members).
 * 8. Sequential serial numbers per worksheet starting at 1.
 * 9. Formula injection protection and explicit text cell formatting.
 * 10. Separation of accommodation and event payment fields.
 */

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildRegistrationsWorkbook,
  buildParticipantsWorkbook,
  normalizeEventCategory,
  filterItemsByCategory,
  getItemCategories,
  sanitizeExcelValue,
  EXPORT_SHEET_NAMES,
} from "@/lib/admin/excel-export";
import {
  REGISTRATION_CSV_HEADERS,
  type CsvRegistrationItem,
} from "@/lib/admin/csv-export";

describe("SAVISKAR 2026 — Four-Sheet Excel Workbook Export Architecture", () => {
  // Test Fixtures
  const techSolo: CsvRegistrationItem = {
    participant: {
      id: "part-tech-1",
      participant_id: "SVK26-TECH01",
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
      id: "reg-tech-001",
      event_id: "evt-code-circuit",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_amount: 300,
      payment_id: "pay_tech_001",
      team_name: null,
      checked_in: true,
      checked_in_at: "2026-10-28T10:00:00Z",
      main_checked_in: true,
      main_checked_in_at: "2026-10-28T09:00:00Z",
      registration_group_id: "grp-tech-001",
      created_at: "2026-10-15T10:00:00Z",
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
      payment_id: "pay_acc_tech_001",
      payment_status: "paid",
    },
  };

  const culturalSolo: CsvRegistrationItem = {
    participant: {
      id: "part-cult-1",
      participant_id: "SVK26-CULT01",
      name: "Simran Kaur",
      college: "Thapar University",
      email: "simran@example.com",
      phone: "09876543211", // Test leading zero preservation
      state: "Punjab (ਪੰਜਾਬ)", // Test Unicode
      gender: "Female",
    },
    event: {
      name: "Doodle Art",
      category: "Cultural",
      payment_type: "free",
      registration_fee: 0,
    },
    registration: {
      id: "reg-cult-001",
      event_id: "evt-doodle-art",
      registration_status: "confirmed",
      payment_status: "free",
      payment_amount: 0,
      payment_id: null,
      team_name: null,
      checked_in: false,
      checked_in_at: null,
      main_checked_in: false,
      main_checked_in_at: null,
      registration_group_id: "grp-cult-001",
      created_at: "2026-10-16T11:00:00Z",
    },
  };

  const nonTechTeam: CsvRegistrationItem = {
    participant: {
      id: "part-nt-lead",
      participant_id: "SVK26-NT01",
      name: "Aman Verma",
      college: "IIT Ropar",
      email: "aman@example.com",
      phone: "+91 9876543212",
      state: "Chandigarh",
      gender: "Male",
    },
    event: {
      name: "Business Pitch",
      category: "Non-Technical",
      payment_type: "paid",
      registration_fee: 500,
    },
    registration: {
      id: "reg-nt-001",
      event_id: "evt-biz-pitch",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_amount: 500,
      payment_id: "pay_biz_001",
      team_name: "Innovators",
      checked_in: true,
      checked_in_at: "2026-10-28T10:15:00Z",
      main_checked_in: true,
      main_checked_in_at: "2026-10-28T09:15:00Z",
      registration_group_id: "grp-nt-001",
      created_at: "2026-10-17T12:00:00Z",
    },
    members: [
      {
        id: "mem-nt-1",
        participant_id: "part-nt-lead",
        name: "Aman Verma",
        email: "aman@example.com",
        phone: "+91 9876543212",
        is_team_leader: true,
        gender: "Male",
        state: "Chandigarh",
        participants: {
          participant_id: "SVK26-NT01",
          college: "IIT Ropar",
          gender: "Male",
          state: "Chandigarh",
        },
      },
      {
        id: "mem-nt-2",
        participant_id: "part-nt-mem2",
        name: "Pooja Patel",
        email: "pooja@example.com",
        phone: "+91 9876543213",
        is_team_leader: false,
        gender: "Female",
        state: "Gujarat",
        participants: {
          participant_id: "SVK26-NT02",
          college: "IIT Ropar",
          gender: "Female",
          state: "Gujarat",
        },
      },
    ],
  };

  const hospitalityOnly: CsvRegistrationItem = {
    participant: {
      id: "part-hosp-1",
      participant_id: "SVK26-HOSP01",
      name: "Karan Singh",
      college: "Panjab University",
      email: "karan@example.com",
      phone: "+91 9876543214",
      state: "Punjab",
      gender: "Male",
    },
    event: null, // No event, hospitality only
    registration: {
      id: "reg-hosp-001",
      event_id: "",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_amount: 0,
      payment_id: null,
      team_name: null,
      checked_in: false,
      checked_in_at: null,
      main_checked_in: false,
      main_checked_in_at: null,
      registration_group_id: "grp-hosp-001",
      created_at: "2026-10-18T14:00:00Z",
    },
    accommodation: {
      plan_name: "1-Day Stay",
      duration_days: 1,
      start_date: "2026-10-28",
      end_date: "2026-10-29",
      status: "paid",
      amount: 499,
      hostel_name: "Boys Hostel 2",
      room_number: "205",
      payment_id: "pay_acc_hosp_001",
      payment_status: "paid",
    },
  };

  const multiEventItem: CsvRegistrationItem = {
    participant: {
      id: "part-multi-1",
      participant_id: "SVK26-MULTI01",
      name: "Meera Nair",
      college: "NIT Jalandhar",
      email: "meera@example.com",
      phone: "+91 9876543215",
      state: "Kerala",
      gender: "Female",
    },
    event: {
      name: "Robo Race",
      category: "Technical",
      payment_type: "paid",
      registration_fee: 400,
    },
    registration: {
      id: "reg-multi-001",
      event_id: "evt-robo-race",
      registration_status: "confirmed",
      payment_status: "paid",
      payment_amount: 700,
      payment_id: "pay_multi_001",
      team_name: null,
      checked_in: false,
      checked_in_at: null,
      main_checked_in: false,
      main_checked_in_at: null,
      registration_group_id: "grp-multi-001",
      created_at: "2026-10-19T15:00:00Z",
    },
    // Multi-event registration spanning Technical and Cultural
    events: [
      { id: "evt-robo-race", name: "Robo Race", category: "Technical" },
      { id: "evt-dance-solo", name: "Dance Solo", category: "Cultural" },
    ],
  } as unknown as CsvRegistrationItem;

  const formulaItem: CsvRegistrationItem = {
    participant: {
      id: "part-form-1",
      participant_id: "SVK26-FORM01",
      name: "=cmd|' /C calc'!A0", // Malicious formula attempt
      college: "@SUM(1,2)", // Formula attempt with @
      email: "attacker@example.com",
      phone: "+91 9876543299", // Valid phone number with +
      state: "-Dangerous", // Formula attempt with -
      gender: "Other",
    },
    event: {
      name: "Web Dev Sprint",
      category: "Technical",
      payment_type: "free",
      registration_fee: 0,
    },
    registration: {
      id: "reg-form-001",
      event_id: "evt-web-dev",
      registration_status: "confirmed",
      payment_status: "free",
      payment_amount: 0,
      payment_id: null,
      team_name: "+TeamFormula",
      checked_in: false,
      checked_in_at: null,
      main_checked_in: false,
      main_checked_in_at: null,
      registration_group_id: "grp-form-001",
      created_at: "2026-10-19T16:00:00Z",
    },
  };

  const sampleDataset = [
    techSolo,
    culturalSolo,
    nonTechTeam,
    hospitalityOnly,
    multiEventItem,
    formulaItem,
  ];

  // ─────────────────────────────────────────────────────────────
  // 1. WORKBOOK STRUCTURE & WORKSHEET NAMES
  // ─────────────────────────────────────────────────────────────
  describe("1. Workbook Structure & Worksheets", () => {
    it("buildRegistrationsWorkbook produces a valid Excel workbook with exactly 4 worksheets in exact order", () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      expect(wb).toBeInstanceOf(ExcelJS.Workbook);
      expect(wb.worksheets.length).toBe(4);

      const names = wb.worksheets.map((s) => s.name);
      expect(names).toEqual([
        EXPORT_SHEET_NAMES.REGISTRATIONS.ALL,
        EXPORT_SHEET_NAMES.REGISTRATIONS.TECHNICAL,
        EXPORT_SHEET_NAMES.REGISTRATIONS.NON_TECHNICAL,
        EXPORT_SHEET_NAMES.REGISTRATIONS.CULTURAL,
      ]);

      // Verify all sheet names <= 31 characters
      names.forEach((name) => expect(name.length).toBeLessThanOrEqual(31));
    });

    it("buildParticipantsWorkbook produces a valid Excel workbook with exactly 4 worksheets in exact order", () => {
      const wb = buildParticipantsWorkbook(sampleDataset);
      expect(wb).toBeInstanceOf(ExcelJS.Workbook);
      expect(wb.worksheets.length).toBe(4);

      const names = wb.worksheets.map((s) => s.name);
      expect(names).toEqual([
        EXPORT_SHEET_NAMES.PARTICIPANTS.ALL,
        EXPORT_SHEET_NAMES.PARTICIPANTS.TECHNICAL,
        EXPORT_SHEET_NAMES.PARTICIPANTS.NON_TECHNICAL,
        EXPORT_SHEET_NAMES.PARTICIPANTS.CULTURAL,
      ]);

      names.forEach((name) => expect(name.length).toBeLessThanOrEqual(31));
    });

    it("each worksheet has the complete REGISTRATION_CSV_HEADERS in Row 1", () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      for (const sheet of wb.worksheets) {
        const row1Values = sheet.getRow(1).values as string[];
        // ExcelJS row.values is 1-indexed (index 0 is undefined or empty)
        const headers = row1Values.slice(1);
        expect(headers).toEqual(REGISTRATION_CSV_HEADERS);
      }
    });

    it("freezes the header row (ySplit: 1) and enables AutoFilter on each worksheet", () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      for (const sheet of wb.worksheets) {
        expect(sheet.views?.[0]?.state).toBe("frozen");
        expect((sheet.views?.[0] as any)?.ySplit).toBe(1);
        expect(sheet.autoFilter).toBeDefined();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. CATEGORY CLASSIFICATION & NORMALIZATION
  // ─────────────────────────────────────────────────────────────
  describe("2. Category Classification & Normalization", () => {
    it("normalizes known equivalent representations correctly", () => {
      expect(normalizeEventCategory("Technical")).toBe("technical");
      expect(normalizeEventCategory("technical")).toBe("technical");
      expect(normalizeEventCategory("  TECHNICAL  ")).toBe("technical");

      expect(normalizeEventCategory("Cultural")).toBe("cultural");
      expect(normalizeEventCategory("cultural")).toBe("cultural");

      expect(normalizeEventCategory("Non-Technical")).toBe("non-technical");
      expect(normalizeEventCategory("Non Technical")).toBe("non-technical");
      expect(normalizeEventCategory("nontechnical")).toBe("non-technical");
      expect(normalizeEventCategory("Non-technical")).toBe("non-technical");

      expect(normalizeEventCategory("")).toBeNull();
      expect(normalizeEventCategory(null)).toBeNull();
      expect(normalizeEventCategory(undefined)).toBeNull();
      expect(normalizeEventCategory("Hospitality")).toBeNull();
    });

    it("correctly identifies multi-event categories across primary and events array", () => {
      const singleCats = getItemCategories(techSolo);
      expect(singleCats).toEqual(new Set(["technical"]));

      const multiCats = getItemCategories(multiEventItem);
      expect(multiCats).toEqual(new Set(["technical", "cultural"]));
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. DATASET FILTERING & ALL-SHEET COMPLETENESS
  // ─────────────────────────────────────────────────────────────
  describe("3. Dataset Filtering & Category Integrity", () => {
    it("All Registrations worksheet contains the complete dataset (including hospitality)", () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      const allSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.ALL)!;

      // 1 header row + 6 data rows = 7 total rows
      expect(allSheet.rowCount).toBe(sampleDataset.length + 1);

      // Verify hospitality item is preserved
      let foundHosp = false;
      allSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && row.getCell(2).value === "SVK26-HOSP01") {
          foundHosp = true;
        }
      });
      expect(foundHosp).toBe(true);
    });

    it("Technical worksheet contains only technical records", () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      const techSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.TECHNICAL)!;

      // In sampleDataset: techSolo, multiEventItem (has technical), formulaItem (web dev sprint) = 3 records
      expect(techSheet.rowCount).toBe(3 + 1); // 3 data + 1 header

      // Verify serial numbers restart from 1, 2, 3
      expect(techSheet.getRow(2).getCell(1).value).toBe(1);
      expect(techSheet.getRow(3).getCell(1).value).toBe(2);
      expect(techSheet.getRow(4).getCell(1).value).toBe(3);
    });

    it("Non-Technical worksheet contains only non-technical records", () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      const nonTechSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.NON_TECHNICAL)!;

      // In sampleDataset: nonTechTeam = 1 record
      expect(nonTechSheet.rowCount).toBe(1 + 1);
      expect(nonTechSheet.getRow(2).getCell(1).value).toBe(1);
      expect(nonTechSheet.getRow(2).getCell(2).value).toBe("SVK26-NT01");
    });

    it("Cultural worksheet contains only cultural records", () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      const cultSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.CULTURAL)!;

      // In sampleDataset: culturalSolo, multiEventItem (has cultural) = 2 records
      expect(cultSheet.rowCount).toBe(2 + 1);
      expect(cultSheet.getRow(2).getCell(1).value).toBe(1);
      expect(cultSheet.getRow(3).getCell(1).value).toBe(2);
    });

    it("Empty category sheet is present and retains complete headers when no records match", () => {
      // Dataset with only Technical records
      const techOnlyDataset = [techSolo];
      const wb = buildRegistrationsWorkbook(techOnlyDataset);

      const nonTechSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.NON_TECHNICAL)!;
      const culturalSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.CULTURAL)!;

      expect(nonTechSheet).toBeDefined();
      expect(culturalSheet).toBeDefined();

      // Exactly 1 row (the header row)
      expect(nonTechSheet.rowCount).toBe(1);
      expect(culturalSheet.rowCount).toBe(1);

      // Header row values preserved
      const nonTechHeaders = Array.isArray(nonTechSheet.getRow(1).values)
        ? (nonTechSheet.getRow(1).values as string[]).slice(1)
        : [];
      const cultHeaders = Array.isArray(culturalSheet.getRow(1).values)
        ? (culturalSheet.getRow(1).values as string[]).slice(1)
        : [];
      expect(nonTechHeaders).toEqual(REGISTRATION_CSV_HEADERS);
      expect(cultHeaders).toEqual(REGISTRATION_CSV_HEADERS);
    });

    it("Multi-event registration spanning categories appears on both sheets without duplicate rows within either", () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      const techSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.TECHNICAL)!;
      const cultSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.CULTURAL)!;

      let techMatches = 0;
      techSheet.eachRow((row, r) => {
        if (r > 1 && row.getCell(2).value === "SVK26-MULTI01") techMatches++;
      });

      let cultMatches = 0;
      cultSheet.eachRow((row, r) => {
        if (r > 1 && row.getCell(2).value === "SVK26-MULTI01") cultMatches++;
      });

      // Appears exactly once in each relevant sheet
      expect(techMatches).toBe(1);
      expect(cultMatches).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. REGISTRATION VS PARTICIPANT ROW SEMANTICS
  // ─────────────────────────────────────────────────────────────
  describe("4. Registration vs Participant Row Semantics", () => {
    it("Registration workbook preserves exactly 1 row per team registration (no member row explosion)", () => {
      const teamOnly = [nonTechTeam];
      const wb = buildRegistrationsWorkbook(teamOnly);
      const allSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.ALL)!;

      // 1 data row + 1 header = 2
      expect(allSheet.rowCount).toBe(2);

      const teamRow = allSheet.getRow(2);
      expect(teamRow.getCell(26).value).toBe("Innovators"); // Team Name column
      expect(teamRow.getCell(34).value).toContain("Aman Verma"); // Team Members summary column
      expect(teamRow.getCell(34).value).toContain("Pooja Patel");
    });

    it("Participant workbook expands team members into individual rows with sequential serials", () => {
      const teamOnly = [nonTechTeam];
      const wb = buildParticipantsWorkbook(teamOnly);
      const allSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.PARTICIPANTS.ALL)!;

      // 2 members = 2 data rows + 1 header = 3
      expect(allSheet.rowCount).toBe(3);

      const row1 = allSheet.getRow(2);
      const row2 = allSheet.getRow(3);

      // Sequential serials
      expect(row1.getCell(1).value).toBe(1);
      expect(row2.getCell(1).value).toBe(2);

      // Leader row
      expect(row1.getCell(2).value).toBe("SVK26-NT01");
      expect(row1.getCell(3).value).toBe("Aman Verma");

      // Member row
      expect(row2.getCell(2).value).toBe("SVK26-NT02");
      expect(row2.getCell(3).value).toBe("Pooja Patel");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. SECURITY: FORMULA INJECTION & LEADING ZERO PRESERVATION
  // ─────────────────────────────────────────────────────────────
  describe("5. Security & Formatting Integrity", () => {
    it("sanitizes untrusted text starting with '=', '@', '+', '-' to prevent Excel formula execution", () => {
      expect(sanitizeExcelValue("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
      expect(sanitizeExcelValue("@SUM(1,2)")).toBe("'@SUM(1,2)");
      expect(sanitizeExcelValue("-Dangerous")).toBe("'-Dangerous");

      // Valid phone numbers starting with + are preserved with leading apostrophe if text
      expect(sanitizeExcelValue("+919876543210")).toBe("+919876543210"); // + followed by digit is allowed
      expect(sanitizeExcelValue("+TeamName")).toBe("'+TeamName"); // + followed by non-digit is escaped
    });

    it("safely writes formula strings as escaped text cells in the Excel sheet", () => {
      const wb = buildRegistrationsWorkbook([formulaItem]);
      const allSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.ALL)!;

      const formulaRow = allSheet.getRow(2);
      const participantNameCell = formulaRow.getCell(3);
      const collegeCell = formulaRow.getCell(25);
      const stateCell = formulaRow.getCell(6);

      // All written with leading apostrophe
      expect(participantNameCell.value).toBe("'=cmd|' /C calc'!A0");
      expect(collegeCell.value).toBe("'@SUM(1,2)");
      expect(stateCell.value).toBe("'-Dangerous");
    });

    it("preserves leading zeros on phone numbers and PINs via explicit '@' text cell format", () => {
      const wb = buildRegistrationsWorkbook([culturalSolo]);
      const allSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.ALL)!;

      const row = allSheet.getRow(2);
      const phoneCell = row.getCell(5); // Phone column

      expect(phoneCell.value).toBe("09876543211");
      expect(phoneCell.numFmt).toBe("@");
    });

    it("preserves Unicode characters in names and Indian states", () => {
      const wb = buildRegistrationsWorkbook([culturalSolo]);
      const allSheet = wb.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.ALL)!;

      const stateCell = allSheet.getRow(2).getCell(6); // State column
      expect(stateCell.value).toBe("Punjab (ਪੰਜਾਬ)");
    });

    it("writes binary XLSX buffer capable of parsing back cleanly", async () => {
      const wb = buildRegistrationsWorkbook(sampleDataset);
      const buffer = await wb.xlsx.writeBuffer();

      expect(buffer).toBeDefined();
      expect(buffer.byteLength).toBeGreaterThan(1000);

      // Verify that ExcelJS can read the written buffer back
      const readWb = new ExcelJS.Workbook();
      await readWb.xlsx.load(buffer as any);

      expect(readWb.worksheets.length).toBe(4);
      expect(readWb.worksheets.map((s) => s.name)).toEqual([
        "All Registrations",
        "Technical",
        "Non-Technical",
        "Cultural",
      ]);
    });
  });
});
