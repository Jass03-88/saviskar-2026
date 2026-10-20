/**
 * lib/admin/excel-export.ts
 *
 * Four-Sheet Excel (.xlsx) Workbook Generator for Saviskar 2026 Admin Exports.
 * Generates single Excel workbooks containing exactly four worksheets:
 * 1. All Registrations / All Participants (complete dataset)
 * 2. Technical
 * 3. Non-Technical
 * 4. Cultural
 *
 * Features:
 * - Freeze header row and enable AutoFilters on each sheet.
 * - Formula injection prevention for untrusted text.
 * - Explicit '@' text formatting for phone numbers and IDs to preserve leading zeros.
 * - Authoritative category classification and multi-event filtering.
 * - Sequential serial numbers per worksheet starting at 1.
 */

import ExcelJS from "exceljs";
import {
  REGISTRATION_CSV_HEADERS,
  buildRegistrationOrderRow,
  buildRegistrationCsvRows,
  type CsvRegistrationItem,
} from "./csv-export";

export type ExportCategory = "technical" | "non-technical" | "cultural";

export const EXPORT_SHEET_NAMES = {
  REGISTRATIONS: {
    ALL: "All Registrations",
    TECHNICAL: "Technical",
    NON_TECHNICAL: "Non-Technical",
    CULTURAL: "Cultural",
  },
  PARTICIPANTS: {
    ALL: "All Participants",
    TECHNICAL: "Technical",
    NON_TECHNICAL: "Non-Technical",
    CULTURAL: "Cultural",
  },
} as const;

/**
 * Normalizes event category strings to standard categories:
 * - "technical"
 * - "non-technical"
 * - "cultural"
 * Returns null for unmatched or missing categories.
 */
export function normalizeEventCategory(category: unknown): ExportCategory | null {
  if (!category || typeof category !== "string") return null;
  const cleaned = category.trim().toLowerCase().replace(/\s+/g, "-");
  if (cleaned === "technical") return "technical";
  if (cleaned === "cultural") return "cultural";
  if (cleaned === "non-technical" || cleaned === "nontechnical") return "non-technical";
  return null;
}

/**
 * Extracts all distinct normalized categories from an item.
 * Inspects both `item.event?.category` and `(item as any).events`.
 */
export function getItemCategories(item: CsvRegistrationItem): Set<ExportCategory> {
  const set = new Set<ExportCategory>();
  const primary = normalizeEventCategory(item.event?.category);
  if (primary) set.add(primary);

  const anyEvents = (item as unknown as { events?: Array<{ category?: string | null }> }).events;
  if (Array.isArray(anyEvents)) {
    for (const ev of anyEvents) {
      const cat = normalizeEventCategory(ev?.category);
      if (cat) set.add(cat);
    }
  }
  return set;
}

/**
 * Filters registration items for a specific category.
 * If an item is a multi-event registration spanning multiple categories,
 * it is included on each relevant category worksheet, with its event summary
 * scoped to that category.
 * Deduplicates by registration ID / participant event key.
 */
export function filterItemsByCategory(
  items: CsvRegistrationItem[],
  targetCategory: ExportCategory
): CsvRegistrationItem[] {
  const result: CsvRegistrationItem[] = [];
  const seenKeys = new Set<string>();

  for (const item of items) {
    const categories = getItemCategories(item);
    if (!categories.has(targetCategory)) {
      continue;
    }

    const key =
      item.registration.id ||
      `${item.participant.participant_id}-${item.registration.event_id}`;

    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    const anyEvents = (item as unknown as {
      events?: Array<{ category?: string | null; name?: string | null; id?: string }>;
    }).events;

    if (Array.isArray(anyEvents) && anyEvents.length > 0) {
      const matchingEvents = anyEvents.filter(
        (ev) => normalizeEventCategory(ev?.category) === targetCategory
      );
      const primaryMatches = normalizeEventCategory(item.event?.category) === targetCategory;
      const scopedEvent = primaryMatches ? item.event : matchingEvents[0] || item.event;

      result.push({
        ...item,
        event: scopedEvent,
        events: matchingEvents,
      });
    } else {
      result.push(item);
    }
  }

  return result;
}

/**
 * Escapes potential spreadsheet formula injection while preserving
 * numbers and valid phone numbers like +91...
 */
export function sanitizeExcelValue(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  let str = String(value);

  // Prevent formula execution if string begins with =, @, or tab/return
  if (/^[=@\t\r]/.test(str)) {
    str = "'" + str;
  } else if (/^[+-][^0-9]/.test(str)) {
    str = "'" + str;
  }
  return str;
}

/**
 * Adds a styled worksheet with headers, frozen top row, and autofilters.
 */
function addWorksheetWithData(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  headers: string[],
  rowsData: (string | number)[][]
): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 0, ySplit: 1, activeCell: "A2" }],
  });

  // Header Row
  const headerRow = worksheet.addRow(headers);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F172A" }, // Dark slate
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF334155" } },
    };
  });

  // Enable AutoFilter on header row
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  // Data Rows
  for (const rowData of rowsData) {
    const row = worksheet.addRow([]);
    rowData.forEach((rawVal, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      const header = headers[colIdx];

      if (rawVal === null || rawVal === undefined) {
        cell.value = "";
        cell.numFmt = "@";
        return;
      }

      // Format numeric amounts and serial numbers
      if (
        (header === "Sr. No." ||
          header === "Payment Amount" ||
          header === "Accommodation Payment Amount") &&
        typeof rawVal === "number"
      ) {
        cell.value = rawVal;
        cell.numFmt = header === "Sr. No." ? "#,##0" : "#,##0.00";
        cell.alignment = { vertical: "middle", horizontal: "right" };
      } else {
        // Text cells
        const sanitized = sanitizeExcelValue(rawVal);
        cell.value = sanitized;
        cell.numFmt = "@"; // Text format preserves leading zeros in phone numbers and IDs
        cell.alignment = { vertical: "middle", horizontal: "left" };
      }
    });
    row.height = 20;
  }

  // Column Widths
  worksheet.columns.forEach((column, colIdx) => {
    const header = headers[colIdx] || "";
    let maxLen = header.length;

    // Sample first 100 rows for auto width
    const sampleLimit = Math.min(worksheet.rowCount, 100);
    for (let r = 2; r <= sampleLimit; r++) {
      const cellValue = worksheet.getRow(r).getCell(colIdx + 1).value;
      if (cellValue !== null && cellValue !== undefined) {
        const len = String(cellValue).length;
        if (len > maxLen) maxLen = len;
      }
    }

    column.width = Math.min(Math.max(maxLen + 4, 12), 40);
  });

  return worksheet;
}

/**
 * Builds the 4-sheet Registration-Level Excel Workbook.
 * Worksheets:
 * 1. "All Registrations"
 * 2. "Technical"
 * 3. "Non-Technical"
 * 4. "Cultural"
 */
export function buildRegistrationsWorkbook(items: CsvRegistrationItem[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Saviskar 2026 Admin";
  workbook.created = new Date();

  // 1. All Registrations
  const allRows: (string | number)[][] = [];
  let allSerial = 1;
  for (const item of items) {
    allRows.push(buildRegistrationOrderRow(item, allSerial++));
  }
  addWorksheetWithData(
    workbook,
    EXPORT_SHEET_NAMES.REGISTRATIONS.ALL,
    REGISTRATION_CSV_HEADERS,
    allRows
  );

  // 2. Technical
  const techItems = filterItemsByCategory(items, "technical");
  const techRows: (string | number)[][] = [];
  let techSerial = 1;
  for (const item of techItems) {
    techRows.push(buildRegistrationOrderRow(item, techSerial++));
  }
  addWorksheetWithData(
    workbook,
    EXPORT_SHEET_NAMES.REGISTRATIONS.TECHNICAL,
    REGISTRATION_CSV_HEADERS,
    techRows
  );

  // 3. Non-Technical
  const nonTechItems = filterItemsByCategory(items, "non-technical");
  const nonTechRows: (string | number)[][] = [];
  let nonTechSerial = 1;
  for (const item of nonTechItems) {
    nonTechRows.push(buildRegistrationOrderRow(item, nonTechSerial++));
  }
  addWorksheetWithData(
    workbook,
    EXPORT_SHEET_NAMES.REGISTRATIONS.NON_TECHNICAL,
    REGISTRATION_CSV_HEADERS,
    nonTechRows
  );

  // 4. Cultural
  const culturalItems = filterItemsByCategory(items, "cultural");
  const culturalRows: (string | number)[][] = [];
  let culturalSerial = 1;
  for (const item of culturalItems) {
    culturalRows.push(buildRegistrationOrderRow(item, culturalSerial++));
  }
  addWorksheetWithData(
    workbook,
    EXPORT_SHEET_NAMES.REGISTRATIONS.CULTURAL,
    REGISTRATION_CSV_HEADERS,
    culturalRows
  );

  return workbook;
}

/**
 * Builds the 4-sheet Participant-Level Excel Workbook.
 * Worksheets:
 * 1. "All Participants"
 * 2. "Technical"
 * 3. "Non-Technical"
 * 4. "Cultural"
 */
export function buildParticipantsWorkbook(items: CsvRegistrationItem[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Saviskar 2026 Admin";
  workbook.created = new Date();

  // 1. All Participants
  const allRows: (string | number)[][] = [];
  let allSerial = 1;
  for (const item of items) {
    const itemRows = buildRegistrationCsvRows(item, allSerial);
    allRows.push(...itemRows);
    allSerial += itemRows.length;
  }
  addWorksheetWithData(
    workbook,
    EXPORT_SHEET_NAMES.PARTICIPANTS.ALL,
    REGISTRATION_CSV_HEADERS,
    allRows
  );

  // 2. Technical
  const techItems = filterItemsByCategory(items, "technical");
  const techRows: (string | number)[][] = [];
  let techSerial = 1;
  for (const item of techItems) {
    const itemRows = buildRegistrationCsvRows(item, techSerial);
    techRows.push(...itemRows);
    techSerial += itemRows.length;
  }
  addWorksheetWithData(
    workbook,
    EXPORT_SHEET_NAMES.PARTICIPANTS.TECHNICAL,
    REGISTRATION_CSV_HEADERS,
    techRows
  );

  // 3. Non-Technical
  const nonTechItems = filterItemsByCategory(items, "non-technical");
  const nonTechRows: (string | number)[][] = [];
  let nonTechSerial = 1;
  for (const item of nonTechItems) {
    const itemRows = buildRegistrationCsvRows(item, nonTechSerial);
    nonTechRows.push(...itemRows);
    nonTechSerial += itemRows.length;
  }
  addWorksheetWithData(
    workbook,
    EXPORT_SHEET_NAMES.PARTICIPANTS.NON_TECHNICAL,
    REGISTRATION_CSV_HEADERS,
    nonTechRows
  );

  // 4. Cultural
  const culturalItems = filterItemsByCategory(items, "cultural");
  const culturalRows: (string | number)[][] = [];
  let culturalSerial = 1;
  for (const item of culturalItems) {
    const itemRows = buildRegistrationCsvRows(item, culturalSerial);
    culturalRows.push(...itemRows);
    culturalSerial += itemRows.length;
  }
  addWorksheetWithData(
    workbook,
    EXPORT_SHEET_NAMES.PARTICIPANTS.CULTURAL,
    REGISTRATION_CSV_HEADERS,
    culturalRows
  );

  return workbook;
}

/**
 * Downloads an Excel workbook as a single file in the browser.
 */
export async function downloadExcelWorkbook(
  workbook: ExcelJS.Workbook,
  filename: string
): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates and triggers download for the four-sheet Registrations Excel workbook.
 */
export async function exportRegistrationXlsx(
  items: CsvRegistrationItem[],
  filename: string = "saviskar-registrations-2026.xlsx"
): Promise<void> {
  const workbook = buildRegistrationsWorkbook(items);
  await downloadExcelWorkbook(workbook, filename);
}

/**
 * Generates and triggers download for the four-sheet Participants Excel workbook.
 */
export async function exportParticipantXlsx(
  items: CsvRegistrationItem[],
  filename: string = "saviskar-participants-attendees-2026.xlsx"
): Promise<void> {
  const workbook = buildParticipantsWorkbook(items);
  await downloadExcelWorkbook(workbook, filename);
}
