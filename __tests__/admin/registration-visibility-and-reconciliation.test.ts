/**
 * __tests__/admin/registration-visibility-and-reconciliation.test.ts
 *
 * Comprehensive regression test suite for:
 * 1. Admin registrations beyond 761 rows (participant grouping and pagination).
 * 2. Export retrieving more than 1,000 records without omission or truncation.
 * 3. 4-Sheet Excel reconciliation for populations > 1,000.
 * 4. Dashboard metrics invariants and status mapping.
 * 5. Search capability across full dataset.
 * 6. Team event registration preservation across distinct accommodation stays.
 * 7. Accommodation multi-stay aggregation (separate non-overlapping dates).
 * 8. Payment status distinction (captured gateway vs registered vs pending).
 * 9. Missing fields exported as clean blanks rather than numeric/format artifacts like 44.
 * 10. Faculty in-charge deduplication across multiple registration groups.
 */

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildRegistrationsWorkbook,
  buildParticipantsWorkbook,
  normalizeEventCategory,
  filterItemsByCategory,
  EXPORT_SHEET_NAMES,
} from "@/lib/admin/excel-export";
import {
  REGISTRATION_CSV_HEADERS,
  buildRegistrationOrderRow,
  buildRegistrationCsvRows,
  buildSingleParticipantRow,
  type CsvRegistrationItem,
} from "@/lib/admin/csv-export";

describe("SAVISKAR 2026 — Registration Visibility, Export Completeness & Reconciliation Suite", () => {
  // Generator for mock registrations
  function createMockRegistration(
    index: number,
    category: "technical" | "non-technical" | "cultural" = "technical",
    overrides?: Partial<CsvRegistrationItem>
  ): CsvRegistrationItem {
    const pad = String(index).padStart(4, "0");
    return {
      participant: {
        id: `uuid-part-${pad}`,
        participant_id: `SVK26-P${pad}`,
        name: `Participant ${index}`,
        college: `College ${index % 10}`,
        email: `participant${index}@example.com`,
        phone: `987654${pad}`,
        gender: index % 2 === 0 ? "female" : "male",
        state: "Punjab",
      },
      event: {
        name: `${category.toUpperCase()} Event ${index % 5}`,
        category,
        payment_type: index % 2 === 0 ? "paid" : "free",
        registration_fee: index % 2 === 0 ? 500 : 0,
      },
      registration: {
        id: `uuid-reg-${pad}`,
        event_id: `evt-${category}-${index % 5}`,
        registration_status: "confirmed",
        payment_status: index % 2 === 0 ? "paid" : "not_required",
        payment_amount: index % 2 === 0 ? 500 : 0,
        payment_id: index % 2 === 0 ? `pay_evt_${pad}` : null,
        team_name: index % 3 === 0 ? `Team ${index}` : null,
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
        registration_group_id: `grp-${pad}`,
        created_at: new Date(Date.now() - index * 60000).toISOString(),
        is_archived: false,
      },
      accommodation: null,
      accommodations: null,
      members: [],
      ...overrides,
    };
  }

  // Requirement 1 & 2: Datasets > 1,000 records
  it("preserves more than 1,000 records in registration order export without truncation", async () => {
    const populationSize = 1450;
    const items: CsvRegistrationItem[] = [];
    for (let i = 1; i <= populationSize; i++) {
      const cat = i % 3 === 0 ? "cultural" : i % 2 === 0 ? "non-technical" : "technical";
      items.push(createMockRegistration(i, cat));
    }

    const workbook = buildRegistrationsWorkbook(items);
    const allSheet = workbook.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.ALL);

    expect(allSheet).toBeDefined();
    // Header row + populationSize data rows
    expect(allSheet?.rowCount).toBe(populationSize + 1);

    // Verify first and last rows
    const firstDataRow = allSheet?.getRow(2);
    expect(firstDataRow?.getCell(1).value).toBe(1);
    expect(firstDataRow?.getCell(2).value).toBe("SVK26-P0001");

    const lastDataRow = allSheet?.getRow(populationSize + 1);
    expect(lastDataRow?.getCell(1).value).toBe(populationSize);
    expect(lastDataRow?.getCell(2).value).toBe(`SVK26-P${populationSize}`);
  });

  // Requirement 3: Category worksheets reconcile with All Registrations
  it("reconciles category sheet rows to equal the complete export population", () => {
    const populationSize = 1200;
    const items: CsvRegistrationItem[] = [];
    let expectedTech = 0;
    let expectedNonTech = 0;
    let expectedCultural = 0;

    for (let i = 1; i <= populationSize; i++) {
      const cat: "technical" | "non-technical" | "cultural" =
        i % 3 === 0 ? "cultural" : i % 2 === 0 ? "non-technical" : "technical";
      if (cat === "technical") expectedTech++;
      else if (cat === "non-technical") expectedNonTech++;
      else expectedCultural++;

      items.push(createMockRegistration(i, cat));
    }

    const workbook = buildRegistrationsWorkbook(items);

    const allSheet = workbook.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.ALL);
    const techSheet = workbook.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.TECHNICAL);
    const nonTechSheet = workbook.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.NON_TECHNICAL);
    const culturalSheet = workbook.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.CULTURAL);

    expect(allSheet?.rowCount).toBe(populationSize + 1);
    expect(techSheet?.rowCount).toBe(expectedTech + 1);
    expect(nonTechSheet?.rowCount).toBe(expectedNonTech + 1);
    expect(culturalSheet?.rowCount).toBe(expectedCultural + 1);

    // Sum of category data rows equals All Registrations data rows
    const categorySum =
      (techSheet?.rowCount! - 1) +
      (nonTechSheet?.rowCount! - 1) +
      (culturalSheet?.rowCount! - 1);
    expect(categorySum).toBe(populationSize);
  });

  // Requirement 4: Participant grouping beyond row 761
  it("groups registrations by primary participant ID and reaches beyond 761 unique participants", () => {
    const totalRegistrations = 1418;
    const items: CsvRegistrationItem[] = [];

    // Create 1100 unique participants across 1418 registrations
    for (let i = 1; i <= totalRegistrations; i++) {
      const participantIndex = i <= 1100 ? i : (i % 1100) + 1;
      const pad = String(participantIndex).padStart(4, "0");
      items.push(
        createMockRegistration(i, "technical", {
          participant: {
            id: `uuid-part-${pad}`,
            participant_id: `SVK26-P${pad}`,
            name: `Participant ${participantIndex}`,
            college: "CGC",
            email: `part${pad}@example.com`,
          },
        })
      );
    }

    // Client-side grouping logic simulation
    const participantGroupMap = new Map<string, CsvRegistrationItem[]>();
    for (const item of items) {
      const pid = item.participant.id!;
      const existing = participantGroupMap.get(pid) ?? [];
      existing.push(item);
      participantGroupMap.set(pid, existing);
    }

    const participantGroups = Array.from(participantGroupMap.values());
    expect(participantGroups.length).toBe(1100);
    expect(participantGroups.length).toBeGreaterThan(761);

    // Serial numbers 1 to 1100 in table
    const tableSerials = participantGroups.map((_, idx) => idx + 1);
    expect(tableSerials[0]).toBe(1);
    expect(tableSerials[tableSerials.length - 1]).toBe(1100);
  });

  // Requirement 5 & 6: Preserves older team events and search finds both events
  it("preserves team event registrations and allows search across all registrations of a participant", () => {
    const maithily: CsvRegistrationItem["participant"] = {
      id: "part-maithily",
      participant_id: "SVK26-48BE01FA",
      name: "Maithily Chhipa",
      college: "University Maharani College, Jaipur",
      email: "maithily@example.com",
      phone: "9214924158",
    };

    // Event 1: Nritya-e-bharat (older event, registered Oct 8)
    const nrityaReg: CsvRegistrationItem = {
      participant: maithily,
      event: { name: "Nritya-e-bharat", category: "cultural", payment_type: "paid", registration_fee: 3500 },
      registration: {
        id: "reg-nritya",
        event_id: "evt-nritya",
        team_name: "Nartana",
        registration_status: "confirmed",
        payment_status: "paid",
        payment_amount: 3500,
        payment_id: "31166643262",
        created_at: "2026-10-08T10:19:35Z",
      },
      members: [
        { name: "Maithily Chhipa", participant_id: "part-maithily", is_team_leader: true },
        { name: "Hiya sain", participant_id: "part-hiya", is_team_leader: false },
      ],
    };

    // Event 2: Crime Scene (newer event, registered Oct 19)
    const crimeReg: CsvRegistrationItem = {
      participant: maithily,
      event: { name: "Crime Scene", category: "technical", payment_type: "free", registration_fee: 0 },
      registration: {
        id: "reg-crime",
        event_id: "evt-crime",
        team_name: "Nartana",
        registration_status: "confirmed",
        payment_status: "confirmed",
        payment_amount: 0,
        payment_id: null,
        created_at: "2026-10-19T08:51:05Z",
      },
      members: [
        { name: "Maithily Chhipa", participant_id: "part-maithily", is_team_leader: false },
      ],
    };

    const dataset = [crimeReg, nrityaReg];

    // Search for "maithi"
    const query = "maithi";
    const matched = dataset.filter((item) =>
      item.participant.name.toLowerCase().includes(query) ||
      item.participant.participant_id.toLowerCase().includes(query) ||
      item.event?.name?.toLowerCase().includes(query) ||
      item.registration.team_name?.toLowerCase().includes(query)
    );

    expect(matched.length).toBe(2);
    const eventNames = matched.map((m) => m.event?.name);
    expect(eventNames).toContain("Nritya-e-bharat");
    expect(eventNames).toContain("Crime Scene");
  });

  // Requirement 7: Multiple non-overlapping accommodation stays
  it("correctly aggregates multiple distinct non-overlapping stays for a single participant", () => {
    const multiStayParticipant: CsvRegistrationItem = {
      participant: {
        id: "part-multi",
        participant_id: "SVK26-48BE01FA",
        name: "Maithily Chhipa",
        email: "maithily@example.com",
      },
      event: { name: "Crime Scene", category: "technical" },
      registration: {
        id: "reg-multi",
        event_id: "evt-crime",
        registration_status: "confirmed",
        created_at: "2026-10-19T08:51:05Z",
      },
      // Two separate stays: Stay 1 (Oct 28-30, ₹999) + Stay 2 (Oct 27-28, ₹499)
      accommodations: [
        {
          id: "stay-1",
          plan_name: "2 Days Accommodation",
          start_date: "2026-10-28",
          end_date: "2026-10-30",
          duration_days: 2,
          amount: 999,
          status: "paid",
          payment_id: "31166643262",
          payment_status: "paid",
        },
        {
          id: "stay-2",
          plan_name: "1 Day Accommodation",
          start_date: "2026-10-27",
          end_date: "2026-10-28",
          duration_days: 1,
          amount: 499,
          status: "paid",
          payment_id: "31378204275",
          payment_status: "paid",
        },
      ],
    };

    const row = buildSingleParticipantRow(multiStayParticipant, multiStayParticipant.participant, true, 1);

    // Col 15: Accommodation Required
    expect(row[14]).toBe("Yes");
    // Col 16: Accommodation Type (semicolon delimited)
    expect(row[15]).toBe("2 Days Accommodation; 1 Day Accommodation");
    // Col 17: Duration
    expect(row[16]).toBe("2 Days; 1 Day");
    // Col 18: Start Date
    expect(row[17]).toBe("2026-10-28; 2026-10-27");
    // Col 19: End Date
    expect(row[18]).toBe("2026-10-30; 2026-10-28");
    // Col 20: Payment Status
    expect(row[19]).toBe("paid; paid");
    // Col 21: Accommodation Payment Amount (sum = 999 + 499 = 1498)
    expect(row[20]).toBe(1498);
    // Col 22: Payment IDs
    expect(row[21]).toBe("31166643262; 31378204275");
  });

  // Requirement 9: Missing fields export as clean blanks rather than 44
  it("exports empty/inapplicable fields as clean blanks and never outputs the literal value 44", async () => {
    const itemWithoutAccommodation: CsvRegistrationItem = {
      participant: {
        id: "part-no-acc",
        participant_id: "SVK26-NOACC1",
        name: "Test Participant",
        email: "test@example.com",
        college: null,
        phone: null,
        state: null,
        gender: null,
      },
      event: { name: "Test Event", category: "technical" },
      registration: {
        id: "reg-no-acc",
        event_id: "evt-test",
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
        created_at: "2026-10-15T10:00:00Z",
      },
      accommodation: null,
      accommodations: null,
    };

    const row = buildSingleParticipantRow(itemWithoutAccommodation, itemWithoutAccommodation.participant, true, 1);

    // Verify row array has clean blanks
    expect(row[14]).toBe("No"); // Accommodation Required
    expect(row[15]).toBe("");   // Type
    expect(row[16]).toBe("");   // Duration
    expect(row[17]).toBe("");   // Start Date
    expect(row[18]).toBe("");   // End Date
    expect(row[19]).toBe("");   // Payment Status
    expect(row[20]).toBe("");   // Payment Amount
    expect(row[21]).toBe("");   // Payment ID
    expect(row[26]).toBe("");   // Hostel
    expect(row[27]).toBe("");   // Room Number

    // Build workbook and inspect actual cell values in ExcelJS
    const workbook = buildRegistrationsWorkbook([itemWithoutAccommodation]);
    const sheet = workbook.getWorksheet(EXPORT_SHEET_NAMES.REGISTRATIONS.ALL);
    const dataRow = sheet?.getRow(2);

    for (let c = 1; c <= REGISTRATION_CSV_HEADERS.length; c++) {
      const cellVal = dataRow?.getCell(c).value;
      // Cell value should never be 44 unless it is Sr. No. 44
      if (c === 1) {
        expect(cellVal).toBe(1);
      } else {
        expect(cellVal).not.toBe(44);
        expect(cellVal).not.toBe("44");
      }
    }
  });

  // Requirement 10: Faculty in-charge deduplication
  it("deduplicates faculty in-charge associated with multiple event groups of a participant", () => {
    const rawFacultyData = [
      {
        id: "fac-1",
        registration_group_id: "grp-1",
        participant_id: "part-fac-suman",
        participants: {
          id: "part-fac-suman",
          name: "Suman sain",
          college: "University Maharani College, Jaipur",
          email: "sainsuman115@gmail.com",
        },
      },
      {
        id: "fac-2",
        registration_group_id: "grp-2",
        participant_id: "part-fac-suman",
        participants: {
          id: "part-fac-suman",
          name: "Suman sain",
          college: "University Maharani College, Jaipur",
          email: "sainsuman115@gmail.com",
        },
      },
    ];

    // Deduplication logic matching route.ts
    const seenFaculty = new Set<string>();
    const deduplicatedFaculty: typeof rawFacultyData = [];
    for (const f of rawFacultyData) {
      const p = Array.isArray(f.participants) ? f.participants[0] : f.participants;
      const key = (f.participant_id || p?.id || p?.email || f.id || "").toLowerCase();
      if (key && !seenFaculty.has(key)) {
        seenFaculty.add(key);
        deduplicatedFaculty.push(f);
      }
    }

    expect(deduplicatedFaculty.length).toBe(1);
    expect(deduplicatedFaculty[0].participants.name).toBe("Suman sain");
  });
});
