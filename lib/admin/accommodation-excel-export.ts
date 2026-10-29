/**
 * lib/admin/accommodation-excel-export.ts
 *
 * Genuine Multi-Sheet Excel (.xlsx) Workbook Generator for Saviskar 2026 Accommodations.
 * Generates an Excel workbook with three comprehensive worksheets:
 * 1. "Accommodation Master" — 1 row per accommodation booking with complete metadata.
 * 2. "Summary" — Key metrics, payment status, gender, plans, room allocation, and nightly occupancy totals.
 * 3. "Daily Stay List" — Date-by-date stay occupancy for all festival nights (27–31 Oct).
 *
 * Features:
 * - Built using ExcelJS (genuine binary xlsx format).
 * - Freeze header rows and AutoFilters enabled on data sheets.
 * - Formula injection prevention (@, =, +, - escaping).
 * - Proper text '@' format for phone numbers and IDs to preserve leading zeros.
 * - Professional dark slate (#0F172A) header styling with INR currency formatting.
 * - Accurate overnight stay calculations (checkout morning does not count as overnight).
 */

import ExcelJS from "exceljs";
import { getCanonicalStayLabel } from "@/lib/accommodation-dates";
import { sanitizeExcelValue } from "@/lib/admin/excel-export";

export type AccommodationExportRecord = {
  id: string;
  participant_id: string;
  accommodation_plan_id?: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  amount: number | string;
  currency?: string;
  status: string;
  hostel_id?: string | null;
  room_id?: string | null;
  checked_in?: boolean;
  checked_in_at?: string | null;
  checked_out?: boolean;
  checked_out_at?: string | null;
  created_at?: string;
  payment_order_id?: string | null;
  payment_orders?: {
    order_reference?: string | null;
    gateway_payment_id?: string | null;
    status?: string | null;
  } | {
    order_reference?: string | null;
    gateway_payment_id?: string | null;
    status?: string | null;
  }[] | null;
  participants?: {
    participant_id?: string;
    name?: string;
    email?: string;
    phone?: string;
    gender?: string;
    state?: string;
    college?: string | null;
    is_faculty?: boolean;
    faculty_incharges?: Array<{ id: string; registration_group_id?: string | null }> | null;
    participant_events?: Array<{
      id: string;
      team_name?: string | null;
      participant_id?: string;
      participants?: { participant_id?: string; name?: string } | null;
    }> | null;
    participant_event_members?: Array<{
      id: string;
      participant_event_id: string;
      is_team_leader?: boolean;
      participant_events?: {
        id: string;
        team_name?: string | null;
        participant_id?: string;
        participants?: { participant_id?: string; name?: string } | null;
      } | null;
    }> | null;
  } | null;
};

export type HostelRecord = { id: string; name: string; gender_eligibility?: string; is_active?: boolean };
export type FloorRecord = { id: string; hostel_id: string; floor_number: number };
export type RoomRecord = { id: string; hostel_id: string; floor_id?: string; room_number: string; capacity?: number };
export type PlanRecord = { id: string; name: string; slug?: string; price?: number; duration_days?: number };

export type BuildAccommodationWorkbookOptions = {
  accommodations: AccommodationExportRecord[];
  hostels?: HostelRecord[];
  floors?: FloorRecord[];
  rooms?: RoomRecord[];
  plans?: PlanRecord[];
};

export const FESTIVAL_NIGHTS = [
  { date: "2026-10-27", label: "27 Oct 2026", description: "Early Arrival Night (Before Day 1)" },
  { date: "2026-10-28", label: "28 Oct 2026", description: "Festival Day 1 Night" },
  { date: "2026-10-29", label: "29 Oct 2026", description: "Festival Day 2 Night" },
  { date: "2026-10-30", label: "30 Oct 2026", description: "Festival Day 3 Night" },
  { date: "2026-10-31", label: "31 Oct 2026", description: "Extended Stay Night (Checkout 1 Nov)" },
] as const;

/**
 * Computes the overnight stay nights for an accommodation booking.
 * Note: A delegate staying [2026-10-28, 2026-10-30) stays nights of 28 and 29 Oct.
 * On 30 Oct morning, the delegate checks out and does NOT stay overnight.
 */
export function getStayNights(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate) return [];
  const nights: string[] = [];

  const [sYear, sMonth, sDay] = startDate.split("-").map(Number);
  const [eYear, eMonth, eDay] = endDate.split("-").map(Number);
  if (!sYear || !sMonth || !sDay || !eYear || !eMonth || !eDay) return [];

  const current = new Date(Date.UTC(sYear, sMonth - 1, sDay));
  const end = new Date(Date.UTC(eYear, eMonth - 1, eDay));

  while (current < end) {
    nights.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return nights;
}

/**
 * Computes the last overnight date for an accommodation booking.
 * Returns the night date immediately preceding check-out date.
 */
export function getLastOvernightDate(startDate: string, endDate: string): string {
  const nights = getStayNights(startDate, endDate);
  if (nights.length > 0) {
    return nights[nights.length - 1];
  }
  return startDate || "";
}

/**
 * Resolves team name, team role, and team leader name for an accommodation delegate.
 */
export function resolveDelegateTeamInfo(p?: AccommodationExportRecord["participants"]): {
  teamName: string;
  teamRole: string;
  teamLeaderName: string;
  isFaculty: boolean;
} {
  if (!p) {
    return { teamName: "", teamRole: "Individual", teamLeaderName: "", isFaculty: false };
  }

  const isFaculty = Boolean(
    p.is_faculty || (p.faculty_incharges && p.faculty_incharges.length > 0)
  );

  if (isFaculty) {
    return { teamName: "", teamRole: "Faculty", teamLeaderName: "", isFaculty: true };
  }

  // Check if participant is leader of a team event
  if (p.participant_events && p.participant_events.length > 0) {
    const pe = p.participant_events.find((e) => Boolean(e.team_name)) || p.participant_events[0];
    if (pe?.team_name) {
      return {
        teamName: pe.team_name,
        teamRole: "Team Head",
        teamLeaderName: p.name || "",
        isFaculty: false,
      };
    }
  }

  // Check if participant is a member of a team event
  if (p.participant_event_members && p.participant_event_members.length > 0) {
    const pem = p.participant_event_members[0];
    const pe = pem.participant_events;
    const leaderName = pe?.participants?.name || "";
    const teamName = pe?.team_name || "";
    const teamRole = pem.is_team_leader ? "Team Head" : "Team Member";
    return {
      teamName,
      teamRole,
      teamLeaderName: leaderName,
      isFaculty: false,
    };
  }

  return { teamName: "", teamRole: "Individual", teamLeaderName: "", isFaculty: false };
}

/**
 * Resolves payment order details from an accommodation record.
 * Handles paid, refunded, cancelled, and pending financial statuses accurately.
 */
export function resolvePaymentInfo(acc: AccommodationExportRecord): {
  amountDue: number;
  amountPaid: number;
  balance: number;
  paymentOrderRef: string;
  gatewayPaymentId: string;
  effectiveStatus: string;
} {
  const po = Array.isArray(acc.payment_orders) ? acc.payment_orders[0] : acc.payment_orders;
  const poStatus = po?.status ? String(po.status).toLowerCase() : "";
  const accStatus = acc.status ? String(acc.status).toLowerCase() : "";

  const isRefunded = accStatus === "refunded" || poStatus === "refunded";
  const isCancelled = accStatus === "cancelled" || poStatus === "cancelled";
  const isFailed = accStatus === "failed" || poStatus === "failed";
  const isPartiallyPaid = accStatus === "partially_paid" || poStatus === "partially_paid";
  const isPaid =
    (accStatus === "paid" || poStatus === "paid" || poStatus === "completed") &&
    !isRefunded &&
    !isCancelled;

  let effectiveStatus = "PENDING";
  if (isRefunded) {
    effectiveStatus = "REFUNDED";
  } else if (isCancelled) {
    effectiveStatus = "CANCELLED";
  } else if (isFailed) {
    effectiveStatus = "FAILED";
  } else if (isPaid) {
    effectiveStatus = "PAID";
  } else if (isPartiallyPaid) {
    effectiveStatus = "PARTIALLY_PAID";
  } else if (accStatus === "unpaid") {
    effectiveStatus = "UNPAID";
  } else if (accStatus === "pending" || poStatus === "pending" || poStatus === "initiated") {
    effectiveStatus = "PENDING";
  } else if (accStatus) {
    effectiveStatus = accStatus.toUpperCase();
  }

  const amountDue = Number(acc.amount) || 0;
  // If settled and active, amountPaid = amountDue. If refunded or cancelled, amountPaid = 0.
  const amountPaid = isPaid ? amountDue : 0;
  // If paid, refunded, or cancelled, there is no outstanding collection balance.
  const balance = isPaid || isRefunded || isCancelled ? 0 : amountDue;

  const paymentOrderRef = po?.order_reference || acc.payment_order_id || "";
  const gatewayPaymentId = po?.gateway_payment_id || "";

  return { amountDue, amountPaid, balance, paymentOrderRef, gatewayPaymentId, effectiveStatus };
}

/**
 * Checks whether an accommodation booking is active.
 * Excludes cancelled, failed, and refunded bookings from active occupancy.
 */
export function isActiveAccommodation(acc: AccommodationExportRecord): boolean {
  const po = Array.isArray(acc.payment_orders) ? acc.payment_orders[0] : acc.payment_orders;
  const poStatus = po?.status ? String(po.status).toLowerCase() : "";
  const accStatus = acc.status ? String(acc.status).toLowerCase() : "";

  if (accStatus === "cancelled" || poStatus === "cancelled") return false;
  if (accStatus === "failed" || poStatus === "failed") return false;
  if (accStatus === "refunded" || poStatus === "refunded") return false;
  return true;
}

export const MASTER_SHEET_HEADERS = [
  "Sr. No.",
  "Booking ID",
  "Participant ID",
  "Participant Name",
  "Type",
  "Email",
  "Phone",
  "Gender",
  "State",
  "College",
  "Team Name",
  "Team Role",
  "Team Leader Name",
  "Plan Name",
  "Duration (Days)",
  "Stay Start Date",
  "Last Overnight Date",
  "Checkout Date",
  "Stay Label",
  "Payment Status",
  "Amount Due (INR)",
  "Amount Paid (INR)",
  "Outstanding Balance (INR)",
  "Payment Order Ref",
  "Gateway Payment ID",
  "Allocation Status",
  "Hostel",
  "Floor",
  "Room",
  "Check-in Status",
  "Checked In At",
  "Checked Out At",
  "Created At",
] as const;

/**
 * Builds the Accommodation Master worksheet (Sheet 1).
 * Exactly 1 row per participant accommodation booking.
 */
export function addMasterWorksheet(
  workbook: ExcelJS.Workbook,
  options: BuildAccommodationWorkbookOptions
): ExcelJS.Worksheet {
  const { accommodations, hostels = [], floors = [], rooms = [], plans = [] } = options;

  const worksheet = workbook.addWorksheet("Accommodation Master", {
    views: [{ state: "frozen", xSplit: 0, ySplit: 1, activeCell: "A2" }],
  });

  // Header Row
  const headerRow = worksheet.addRow([...MASTER_SHEET_HEADERS]);
  headerRow.height = 25;
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

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: MASTER_SHEET_HEADERS.length },
  };

  const hostelMap = new Map(hostels.map((h) => [h.id, h]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const floorMap = new Map(floors.map((f) => [f.id, f]));
  const planMap = new Map(plans.map((p) => [p.id, p]));

  let srNo = 1;
  for (const acc of accommodations) {
    const p = acc.participants;
    const plan = acc.accommodation_plan_id ? planMap.get(acc.accommodation_plan_id) : undefined;
    const hostel = acc.hostel_id ? hostelMap.get(acc.hostel_id) : undefined;
    const room = acc.room_id ? roomMap.get(acc.room_id) : undefined;
    const floor = room?.floor_id ? floorMap.get(room.floor_id) : undefined;

    const teamInfo = resolveDelegateTeamInfo(p);
    const paymentInfo = resolvePaymentInfo(acc);
    const stayLabel = getCanonicalStayLabel(acc.start_date, acc.duration_days);
    const lastOvernight = getLastOvernightDate(acc.start_date, acc.end_date);

    const allocStatus = acc.room_id ? "Allocated" : "Awaiting Allocation";
    const checkInStatus = acc.checked_out
      ? "Checked Out"
      : acc.checked_in
      ? "Checked In"
      : "Not Checked In";

    const rowData: (string | number)[] = [
      srNo++,
      acc.id || "",
      p?.participant_id || "",
      p?.name || "",
      teamInfo.isFaculty ? "Faculty" : "Participant",
      p?.email || "",
      p?.phone || "",
      p?.gender || "",
      p?.state || "",
      p?.college || "",
      teamInfo.teamName,
      teamInfo.teamRole,
      teamInfo.teamLeaderName,
      plan?.name || "Campus Stay",
      acc.duration_days || 1,
      acc.start_date || "",
      lastOvernight,
      acc.end_date || "",
      stayLabel,
      paymentInfo.effectiveStatus,
      paymentInfo.amountDue,
      paymentInfo.amountPaid,
      paymentInfo.balance,
      paymentInfo.paymentOrderRef,
      paymentInfo.gatewayPaymentId,
      allocStatus,
      hostel?.name || "",
      floor ? floor.floor_number : "",
      room?.room_number || "",
      checkInStatus,
      acc.checked_in_at ? new Date(acc.checked_in_at).toLocaleString("en-IN") : "",
      acc.checked_out_at ? new Date(acc.checked_out_at).toLocaleString("en-IN") : "",
      acc.created_at ? new Date(acc.created_at).toLocaleString("en-IN") : "",
    ];

    const row = worksheet.addRow([]);
    rowData.forEach((rawVal, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      const header = MASTER_SHEET_HEADERS[colIdx];

      if (rawVal === null || rawVal === undefined) {
        cell.value = "";
        cell.numFmt = "@";
        return;
      }

      if (
        header === "Amount Due (INR)" ||
        header === "Amount Paid (INR)" ||
        header === "Outstanding Balance (INR)"
      ) {
        cell.value = Number(rawVal) || 0;
        cell.numFmt = '"₹"#,##0.00';
        cell.alignment = { vertical: "middle", horizontal: "right" };
      } else if (header === "Sr. No." || header === "Duration (Days)" || header === "Floor") {
        cell.value = typeof rawVal === "number" ? rawVal : Number(rawVal) || 0;
        cell.numFmt = "#,##0";
        cell.alignment = { vertical: "middle", horizontal: "right" };
      } else {
        cell.value = sanitizeExcelValue(rawVal);
        cell.numFmt = "@";
        cell.alignment = { vertical: "middle", horizontal: "left" };
      }
    });

    row.height = 20;
  }

  // Auto-fit column widths
  worksheet.columns.forEach((column, colIdx) => {
    const header = MASTER_SHEET_HEADERS[colIdx] || "";
    let maxLen = header.length;
    const sampleLimit = Math.min(worksheet.rowCount, 100);
    for (let r = 2; r <= sampleLimit; r++) {
      const val = worksheet.getRow(r).getCell(colIdx + 1).value;
      if (val !== null && val !== undefined) {
        const len = String(val).length;
        if (len > maxLen) maxLen = len;
      }
    }
    column.width = Math.min(Math.max(maxLen + 4, 12), 40);
  });

  return worksheet;
}

/**
 * Builds the Summary worksheet (Sheet 2).
 * Formatted summary cards and aggregated reporting tables.
 */
export function addSummaryWorksheet(
  workbook: ExcelJS.Workbook,
  options: BuildAccommodationWorkbookOptions
): ExcelJS.Worksheet {
  const { accommodations, plans = [] } = options;

  const worksheet = workbook.addWorksheet("Summary", {
    views: [{ state: "normal" }],
  });

  worksheet.columns = [
    { width: 4 },
    { width: 34 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
  ];

  // Helper for Section Titles
  const addSectionHeader = (title: string, startRow: number) => {
    const row = worksheet.getRow(startRow);
    const cell = row.getCell(2);
    cell.value = title;
    cell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" }, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    worksheet.mergeCells(startRow, 2, startRow, 5);
    row.height = 26;
  };

  // Helper for Table Headers
  const addTableHeader = (headers: string[], rowNum: number) => {
    const row = worksheet.getRow(rowNum);
    headers.forEach((h, idx) => {
      const cell = row.getCell(idx + 2);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" }, name: "Calibri" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
      cell.alignment = { vertical: "middle", horizontal: idx === 0 ? "left" : "right" };
    });
    row.height = 22;
  };

  // 1. Report Title
  const titleRow = worksheet.getRow(2);
  const titleCell = titleRow.getCell(2);
  titleCell.value = "SAVISKAR 2026 — ACCOMMODATION SUMMARY REPORT";
  titleCell.font = { bold: true, size: 14, color: { argb: "FF0F172A" }, name: "Calibri" };
  worksheet.mergeCells(2, 2, 2, 5);
  titleRow.height = 28;

  const subRow = worksheet.getRow(3);
  const subCell = subRow.getCell(2);
  subCell.value = `Generated: ${new Date().toLocaleString("en-IN")} • Official Saviskar 2026 Housing Operations`;
  subCell.font = { italic: true, size: 9, color: { argb: "FF64748B" }, name: "Calibri" };
  worksheet.mergeCells(3, 2, 3, 5);

  let curRow = 5;

  // 2. High-Level Metrics
  addSectionHeader("KEY HOUSING METRICS", curRow++);
  addTableHeader(["Metric", "Count / Value", "", ""], curRow++);

  const totalBookings = accommodations.length;
  const uniqueParticipants = new Set(
    accommodations.map((a) => a.participants?.participant_id || a.participant_id).filter(Boolean)
  ).size;

  let totalAmountDue = 0;
  let totalAmountPaid = 0;
  let totalBalance = 0;

  for (const acc of accommodations) {
    const pInfo = resolvePaymentInfo(acc);
    totalAmountDue += pInfo.amountDue;
    totalAmountPaid += pInfo.amountPaid;
    totalBalance += pInfo.balance;
  }

  const activeBookings = accommodations.filter(isActiveAccommodation).length;
  const cancelledRefundedBookings = totalBookings - activeBookings;

  const kpis: Array<[string, number, string]> = [
    ["Total Accommodation Bookings", totalBookings, "#,##0"],
    ["Active Accommodations", activeBookings, "#,##0"],
    ["Cancelled / Refunded Bookings", cancelledRefundedBookings, "#,##0"],
    ["Unique Participants Accommodated", uniqueParticipants, "#,##0"],
    ["Total Amount Due", totalAmountDue, '"₹"#,##0.00'],
    ["Total Amount Paid", totalAmountPaid, '"₹"#,##0.00'],
    ["Total Outstanding Balance", totalBalance, '"₹"#,##0.00'],
  ];

  kpis.forEach(([label, val, fmt]) => {
    const r = worksheet.getRow(curRow++);
    const c1 = r.getCell(2);
    c1.value = label;
    c1.font = { size: 10, name: "Calibri" };
    const c2 = r.getCell(3);
    c2.value = val;
    c2.numFmt = fmt;
    c2.font = { bold: true, size: 10, name: "Calibri" };
    c2.alignment = { horizontal: "right" };
    worksheet.mergeCells(r.number, 3, r.number, 5);
    r.height = 20;
  });

  curRow++;

  // 3. Payment Status Breakdown
  addSectionHeader("PAYMENT STATUS BREAKDOWN", curRow++);
  addTableHeader(["Status", "Bookings", "Total Amount (INR)", "Share of Bookings"], curRow++);

  const statusMap = new Map<string, { count: number; amount: number }>();
  for (const acc of accommodations) {
    const pInfo = resolvePaymentInfo(acc);
    const status = pInfo.effectiveStatus.toLowerCase();
    const curr = statusMap.get(status) || { count: 0, amount: 0 };
    curr.count += 1;
    curr.amount += pInfo.amountDue;
    statusMap.set(status, curr);
  }

  ["paid", "pending", "unpaid", "partially_paid", "cancelled", "failed", "refunded"].forEach((st) => {
    const data = statusMap.get(st) || { count: 0, amount: 0 };
    const r = worksheet.getRow(curRow++);
    r.getCell(2).value = st.replace(/_/g, " ").toUpperCase();
    r.getCell(2).font = { bold: true, size: 10, name: "Calibri" };
    r.getCell(3).value = data.count;
    r.getCell(3).numFmt = "#,##0";
    r.getCell(3).alignment = { horizontal: "right" };
    r.getCell(4).value = data.amount;
    r.getCell(4).numFmt = '"₹"#,##0.00';
    r.getCell(4).alignment = { horizontal: "right" };
    r.getCell(5).value = totalBookings > 0 ? data.count / totalBookings : 0;
    r.getCell(5).numFmt = "0.0%";
    r.getCell(5).alignment = { horizontal: "right" };
    r.height = 20;
  });

  curRow++;

  // 4. Gender Distribution
  addSectionHeader("GENDER DISTRIBUTION", curRow++);
  addTableHeader(["Gender", "Bookings", "Unique Participants", "Share"], curRow++);

  const genderBookings = new Map<string, number>();
  const genderParticipants = new Map<string, Set<string>>();

  for (const acc of accommodations) {
    const g = (acc.participants?.gender || "Not Specified").toLowerCase();
    const norm = g.startsWith("m") ? "Male" : g.startsWith("f") ? "Female" : "Other / Unspecified";
    genderBookings.set(norm, (genderBookings.get(norm) || 0) + 1);

    if (!genderParticipants.has(norm)) genderParticipants.set(norm, new Set());
    const pid = acc.participants?.participant_id || acc.participant_id;
    if (pid) genderParticipants.get(norm)!.add(pid);
  }

  ["Male", "Female", "Other / Unspecified"].forEach((g) => {
    const count = genderBookings.get(g) || 0;
    const unique = genderParticipants.get(g)?.size || 0;
    const r = worksheet.getRow(curRow++);
    r.getCell(2).value = g;
    r.getCell(2).font = { bold: true, size: 10, name: "Calibri" };
    r.getCell(3).value = count;
    r.getCell(3).numFmt = "#,##0";
    r.getCell(3).alignment = { horizontal: "right" };
    r.getCell(4).value = unique;
    r.getCell(4).numFmt = "#,##0";
    r.getCell(4).alignment = { horizontal: "right" };
    r.getCell(5).value = totalBookings > 0 ? count / totalBookings : 0;
    r.getCell(5).numFmt = "0.0%";
    r.getCell(5).alignment = { horizontal: "right" };
    r.height = 20;
  });

  curRow++;

  // 5. Plan Breakdown
  addSectionHeader("ACCOMMODATION PLAN BREAKDOWN", curRow++);
  addTableHeader(["Plan Name", "Bookings", "Total Amount (INR)", "Avg Duration"], curRow++);

  const planMap = new Map(plans.map((p) => [p.id, p.name]));
  const planAgg = new Map<string, { count: number; amount: number; totalDays: number }>();

  for (const acc of accommodations) {
    const pName = (acc.accommodation_plan_id && planMap.get(acc.accommodation_plan_id)) || "Campus Stay";
    const cur = planAgg.get(pName) || { count: 0, amount: 0, totalDays: 0 };
    cur.count += 1;
    cur.amount += Number(acc.amount) || 0;
    cur.totalDays += acc.duration_days || 1;
    planAgg.set(pName, cur);
  }

  planAgg.forEach((agg, pName) => {
    const r = worksheet.getRow(curRow++);
    r.getCell(2).value = pName;
    r.getCell(2).font = { bold: true, size: 10, name: "Calibri" };
    r.getCell(3).value = agg.count;
    r.getCell(3).numFmt = "#,##0";
    r.getCell(3).alignment = { horizontal: "right" };
    r.getCell(4).value = agg.amount;
    r.getCell(4).numFmt = '"₹"#,##0.00';
    r.getCell(4).alignment = { horizontal: "right" };
    r.getCell(5).value = agg.count > 0 ? `${(agg.totalDays / agg.count).toFixed(1)} Days` : "1 Day";
    r.getCell(5).alignment = { horizontal: "right" };
    r.height = 20;
  });

  curRow++;

  // 6. Nightly Occupancy Breakdown (Canonical Festival Nights)
  addSectionHeader("NIGHTLY OVERNIGHT OCCUPANCY (27–31 OCT)", curRow++);
  addTableHeader(["Night Date", "Festival Occasion", "Overnight Delegates", "Notes"], curRow++);

  for (const night of FESTIVAL_NIGHTS) {
    let nightCount = 0;
    for (const acc of accommodations) {
      if (!isActiveAccommodation(acc)) continue;
      if (!acc.start_date || !acc.end_date) continue;
      // Stays overnight on night.date if startDate <= night.date < endDate
      if (acc.start_date <= night.date && night.date < acc.end_date) {
        nightCount++;
      }
    }

    const r = worksheet.getRow(curRow++);
    r.getCell(2).value = night.label;
    r.getCell(2).font = { bold: true, size: 10, name: "Calibri" };
    r.getCell(3).value = night.description;
    r.getCell(4).value = nightCount;
    r.getCell(4).numFmt = "#,##0";
    r.getCell(4).font = { bold: true, size: 10, name: "Calibri" };
    r.getCell(4).alignment = { horizontal: "right" };
    r.getCell(5).value = night.date === "2026-10-31" ? "Checkout morning 1 Nov" : "Standard festival night";
    r.height = 20;
  }

  return worksheet;
}

export const DAILY_STAY_HEADERS = [
  "Sr. No.",
  "Night Date",
  "Booking ID",
  "Participant ID",
  "Participant Name",
  "Gender",
  "Plan Name",
  "Stay Label",
  "Hostel",
  "Floor",
  "Room",
  "Payment Status",
  "Check-in Status",
  "Phone",
  "College",
  "Checkout Date",
] as const;

/**
 * Builds the Daily Stay List worksheet (Sheet 3).
 * Detailed delegate listing for each overnight night across the festival.
 */
export function addDailyStayWorksheet(
  workbook: ExcelJS.Workbook,
  options: BuildAccommodationWorkbookOptions
): ExcelJS.Worksheet {
  const { accommodations, hostels = [], floors = [], rooms = [], plans = [] } = options;

  const worksheet = workbook.addWorksheet("Daily Stay List", {
    views: [{ state: "frozen", xSplit: 0, ySplit: 1, activeCell: "A2" }],
  });

  const headerRow = worksheet.addRow([...DAILY_STAY_HEADERS]);
  headerRow.height = 25;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F172A" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF334155" } },
    };
  });

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: DAILY_STAY_HEADERS.length },
  };

  const hostelMap = new Map(hostels.map((h) => [h.id, h]));
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const floorMap = new Map(floors.map((f) => [f.id, f]));
  const planMap = new Map(plans.map((p) => [p.id, p]));

  let srNo = 1;

  for (const night of FESTIVAL_NIGHTS) {
    for (const acc of accommodations) {
      if (!isActiveAccommodation(acc)) continue;
      if (!acc.start_date || !acc.end_date) continue;
      // Stays overnight on night.date if startDate <= night.date < endDate
      if (acc.start_date <= night.date && night.date < acc.end_date) {
        const p = acc.participants;
        const plan = acc.accommodation_plan_id ? planMap.get(acc.accommodation_plan_id) : undefined;
        const hostel = acc.hostel_id ? hostelMap.get(acc.hostel_id) : undefined;
        const room = acc.room_id ? roomMap.get(acc.room_id) : undefined;
        const floor = room?.floor_id ? floorMap.get(room.floor_id) : undefined;

        const stayLabel = getCanonicalStayLabel(acc.start_date, acc.duration_days);
        const checkInStatus = acc.checked_out
          ? "Checked Out"
          : acc.checked_in
          ? "Checked In"
          : "Not Checked In";

        const rowData: (string | number)[] = [
          srNo++,
          `${night.date} — ${night.label} (${night.description})`,
          acc.id || "",
          p?.participant_id || "",
          p?.name || "",
          p?.gender || "",
          plan?.name || "Campus Stay",
          stayLabel,
          hostel?.name || "",
          floor ? floor.floor_number : "",
          room?.room_number || "",
          (acc.status || "pending").toUpperCase(),
          checkInStatus,
          p?.phone || "",
          p?.college || "",
          acc.end_date || "",
        ];

        const row = worksheet.addRow([]);
        rowData.forEach((rawVal, colIdx) => {
          const cell = row.getCell(colIdx + 1);
          const header = DAILY_STAY_HEADERS[colIdx];

          if (rawVal === null || rawVal === undefined) {
            cell.value = "";
            cell.numFmt = "@";
            return;
          }

          if (header === "Sr. No." || header === "Floor") {
            cell.value = typeof rawVal === "number" ? rawVal : Number(rawVal) || 0;
            cell.numFmt = "#,##0";
            cell.alignment = { vertical: "middle", horizontal: "right" };
          } else {
            cell.value = sanitizeExcelValue(rawVal);
            cell.numFmt = "@";
            cell.alignment = { vertical: "middle", horizontal: "left" };
          }
        });

        row.height = 20;
      }
    }
  }

  // Auto-fit column widths
  worksheet.columns.forEach((column, colIdx) => {
    const header = DAILY_STAY_HEADERS[colIdx] || "";
    let maxLen = header.length;
    const sampleLimit = Math.min(worksheet.rowCount, 100);
    for (let r = 2; r <= sampleLimit; r++) {
      const val = worksheet.getRow(r).getCell(colIdx + 1).value;
      if (val !== null && val !== undefined) {
        const len = String(val).length;
        if (len > maxLen) maxLen = len;
      }
    }
    column.width = Math.min(Math.max(maxLen + 4, 12), 40);
  });

  return worksheet;
}

/**
 * Builds the complete 3-sheet Accommodation Excel Workbook.
 */
export function buildAccommodationWorkbook(
  options: BuildAccommodationWorkbookOptions
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Saviskar 2026 Admin";
  workbook.created = new Date();

  // 1. Accommodation Master
  addMasterWorksheet(workbook, options);

  // 2. Summary
  addSummaryWorksheet(workbook, options);

  // 3. Daily Stay List
  addDailyStayWorksheet(workbook, options);

  return workbook;
}

/**
 * Browser-side download trigger for the accommodation Excel workbook.
 */
export async function downloadAccommodationExcelWorkbook(
  workbook: ExcelJS.Workbook,
  filename: string = `saviskar-accommodations-${new Date().toISOString().slice(0, 10)}.xlsx`
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
 * Complete export execution helper.
 */
export async function exportAccommodationXlsx(
  options: BuildAccommodationWorkbookOptions,
  filename?: string
): Promise<void> {
  const workbook = buildAccommodationWorkbook(options);
  await downloadAccommodationExcelWorkbook(workbook, filename);
}
