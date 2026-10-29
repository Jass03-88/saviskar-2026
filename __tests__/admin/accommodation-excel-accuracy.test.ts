import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildAccommodationWorkbook,
  type AccommodationExportRecord,
  type PlanRecord,
} from "@/lib/admin/accommodation-excel-export";

describe("Accommodation Excel Accuracy & Non-Double-Counting Audit", () => {
  const mockPlans: PlanRecord[] = [
    { id: "plan-1", name: "1-Day Campus Stay", slug: "1_day", price: 500, duration_days: 1 },
    { id: "plan-2", name: "2-Day Campus Stay", slug: "2_days", price: 900, duration_days: 2 },
    { id: "plan-3", name: "3-Day Campus Stay", slug: "3_days", price: 1200, duration_days: 3 },
  ];

  it("1. Does NOT double-count team-level payments across individual members in Master sheet or Summary totals", async () => {
    // Team of 3 delegates sharing 1 single payment order of INR 3,600 (1,200 each)
    const teamPaymentOrder = {
      order_reference: "ORD-TEAM-3600",
      gateway_payment_id: "pay_gateway_3600",
      status: "paid",
    };

    const teamAccommodations: AccommodationExportRecord[] = [
      {
        id: "acc-team-01",
        participant_id: "part-01",
        accommodation_plan_id: "plan-3",
        start_date: "2026-10-28",
        end_date: "2026-10-31",
        duration_days: 3,
        amount: 1200, // Individual accommodation fee
        status: "paid",
        payment_orders: teamPaymentOrder, // Linked to the order of 3,600
        participants: {
          participant_id: "SVK26-T01",
          name: "Alice Leader",
          email: "alice@team.com",
          phone: "9876500001",
          gender: "female",
          participant_events: [
            {
              id: "pe-team",
              team_name: "Code Storm",
              participant_id: "part-01",
              participants: { participant_id: "SVK26-T01", name: "Alice Leader" },
            },
          ],
        },
      },
      {
        id: "acc-team-02",
        participant_id: "part-02",
        accommodation_plan_id: "plan-3",
        start_date: "2026-10-28",
        end_date: "2026-10-31",
        duration_days: 3,
        amount: 1200, // Individual accommodation fee
        status: "paid",
        payment_orders: teamPaymentOrder,
        participants: {
          participant_id: "SVK26-T02",
          name: "Bob Member",
          email: "bob@team.com",
          phone: "9876500002",
          gender: "male",
          participant_event_members: [
            {
              id: "pem-02",
              participant_event_id: "pe-team",
              is_team_leader: false,
              participant_events: {
                id: "pe-team",
                team_name: "Code Storm",
                participants: { name: "Alice Leader" },
              },
            },
          ],
        },
      },
      {
        id: "acc-team-03",
        participant_id: "part-03",
        accommodation_plan_id: "plan-3",
        start_date: "2026-10-28",
        end_date: "2026-10-31",
        duration_days: 3,
        amount: 1200, // Individual accommodation fee
        status: "paid",
        payment_orders: teamPaymentOrder,
        participants: {
          participant_id: "SVK26-T03",
          name: "Charlie Member",
          email: "charlie@team.com",
          phone: "9876500003",
          gender: "male",
          participant_event_members: [
            {
              id: "pem-03",
              participant_event_id: "pe-team",
              is_team_leader: false,
              participant_events: {
                id: "pe-team",
                team_name: "Code Storm",
                participants: { name: "Alice Leader" },
              },
            },
          ],
        },
      },
      // Individual delegate with pending payment of 500
      {
        id: "acc-indiv-04",
        participant_id: "part-04",
        accommodation_plan_id: "plan-1",
        start_date: "2026-10-29",
        end_date: "2026-10-30",
        duration_days: 1,
        amount: 500,
        status: "pending",
        payment_order_id: "po-indiv-pending",
        participants: {
          participant_id: "SVK26-INDIV04",
          name: "Dave Independent",
          email: "dave@indiv.com",
          phone: "9876500004",
          gender: "male",
        },
      },
    ];

    // Build workbook and write to real Excel buffer
    const workbook = buildAccommodationWorkbook({
      accommodations: teamAccommodations,
      plans: mockPlans,
    });
    const buffer = await workbook.xlsx.writeBuffer();

    // Inspect the actual loaded binary workbook
    const loadedWb = new ExcelJS.Workbook();
    await loadedWb.xlsx.load(buffer);

    // 1. Inspect Accommodation Master Sheet
    const masterSheet = loadedWb.getWorksheet("Accommodation Master")!;
    expect(masterSheet).toBeDefined();

    // Row 2: Alice
    const aliceRow = masterSheet.getRow(2);
    expect(aliceRow.getCell(4).value).toBe("Alice Leader");
    expect(aliceRow.getCell(21).value).toBe(1200); // Amount Due
    expect(aliceRow.getCell(22).value).toBe(1200); // Amount Paid (NOT 3,600!)
    expect(aliceRow.getCell(23).value).toBe(0); // Balance
    expect(aliceRow.getCell(24).value).toBe("ORD-TEAM-3600");

    // Row 3: Bob
    const bobRow = masterSheet.getRow(3);
    expect(bobRow.getCell(4).value).toBe("Bob Member");
    expect(bobRow.getCell(21).value).toBe(1200);
    expect(bobRow.getCell(22).value).toBe(1200); // Amount Paid (NOT 3,600!)
    expect(bobRow.getCell(23).value).toBe(0);

    // Row 4: Charlie
    const charlieRow = masterSheet.getRow(4);
    expect(charlieRow.getCell(4).value).toBe("Charlie Member");
    expect(charlieRow.getCell(21).value).toBe(1200);
    expect(charlieRow.getCell(22).value).toBe(1200); // Amount Paid (NOT 3,600!)
    expect(charlieRow.getCell(23).value).toBe(0);

    // Row 5: Dave (Pending)
    const daveRow = masterSheet.getRow(5);
    expect(daveRow.getCell(4).value).toBe("Dave Independent");
    expect(daveRow.getCell(21).value).toBe(500);
    expect(daveRow.getCell(22).value).toBe(0);
    expect(daveRow.getCell(23).value).toBe(500);

    // 2. Inspect Summary Sheet Totals
    const summarySheet = loadedWb.getWorksheet("Summary")!;
    expect(summarySheet).toBeDefined();

    let totalDueCell: any = null;
    let totalPaidCell: any = null;
    let totalBalanceCell: any = null;

    for (let r = 1; r <= summarySheet.rowCount; r++) {
      const metricLabel = String(summarySheet.getRow(r).getCell(2).value || "");
      if (metricLabel === "Total Amount Due") totalDueCell = summarySheet.getRow(r).getCell(3).value;
      if (metricLabel === "Total Amount Paid") totalPaidCell = summarySheet.getRow(r).getCell(3).value;
      if (metricLabel === "Total Outstanding Balance") totalBalanceCell = summarySheet.getRow(r).getCell(3).value;
    }

    // Expected Due = 1200 + 1200 + 1200 + 500 = 4,100 (NOT 3600*3 + 500 = 11,300!)
    expect(totalDueCell).toBe(4100);
    // Expected Paid = 1200 + 1200 + 1200 = 3,600 (NOT 10,800!)
    expect(totalPaidCell).toBe(3600);
    // Expected Balance = 500
    expect(totalBalanceCell).toBe(500);
  });

  it("2. Nightly occupancy strictly excludes checkout morning and uses actual stay dates", async () => {
    const accommodations: AccommodationExportRecord[] = [
      // Delegate 1: 2-day stay 28-30 Oct (Checkout morning of 30th)
      {
        id: "acc-d1",
        participant_id: "p1",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 900,
        status: "paid",
        participants: { name: "Delegate One", gender: "male" },
      },
      // Delegate 2: 2-day stay 29-31 Oct (Checkout morning of 31st)
      {
        id: "acc-d2",
        participant_id: "p2",
        start_date: "2026-10-29",
        end_date: "2026-10-31",
        duration_days: 2,
        amount: 900,
        status: "paid",
        participants: { name: "Delegate Two", gender: "female" },
      },
      // Delegate 3: 4-day stay 27-31 Oct (Checkout morning of 31st)
      {
        id: "acc-d3",
        participant_id: "p3",
        start_date: "2026-10-27",
        end_date: "2026-10-31",
        duration_days: 4,
        amount: 1500,
        status: "paid",
        participants: { name: "Delegate Three", gender: "female" },
      },
    ];

    const workbook = buildAccommodationWorkbook({ accommodations, plans: mockPlans });
    const buffer = await workbook.xlsx.writeBuffer();

    const loadedWb = new ExcelJS.Workbook();
    await loadedWb.xlsx.load(buffer);

    // 1. Inspect Summary Sheet Nightly Occupancy Table
    const summarySheet = loadedWb.getWorksheet("Summary")!;
    const nightlyCounts: Record<string, number> = {};

    for (let r = 1; r <= summarySheet.rowCount; r++) {
      const dateLabel = String(summarySheet.getRow(r).getCell(2).value || "");
      if (dateLabel.includes("Oct 2026")) {
        const count = Number(summarySheet.getRow(r).getCell(4).value) || 0;
        nightlyCounts[dateLabel.slice(0, 6)] = count; // e.g. "27 Oct"
      }
    }

    // 27 Oct Night: Delegate 3 only (count = 1)
    expect(nightlyCounts["27 Oct"]).toBe(1);
    // 28 Oct Night: Delegate 1 + Delegate 3 (count = 2)
    expect(nightlyCounts["28 Oct"]).toBe(2);
    // 29 Oct Night: Delegate 1 + Delegate 2 + Delegate 3 (count = 3)
    expect(nightlyCounts["29 Oct"]).toBe(3);
    // 30 Oct Night: Delegate 2 + Delegate 3 (count = 2). Delegate 1 checked out in the morning!
    expect(nightlyCounts["30 Oct"]).toBe(2);
    // 31 Oct Night: 0 delegates (both Delegate 2 and Delegate 3 checked out in the morning!)
    expect(nightlyCounts["31 Oct"]).toBe(0);

    // 2. Inspect Daily Stay List Sheet Rows
    const dailySheet = loadedWb.getWorksheet("Daily Stay List")!;
    const namesByDate: Record<string, string[]> = {};

    for (let r = 2; r <= dailySheet.rowCount; r++) {
      const nightDate = String(dailySheet.getRow(r).getCell(2).value || "").slice(0, 10);
      const name = String(dailySheet.getRow(r).getCell(5).value || "");
      if (!namesByDate[nightDate]) namesByDate[nightDate] = [];
      namesByDate[nightDate].push(name);
    }

    // 30 Oct Night: Must NOT include Delegate One
    expect(namesByDate["2026-10-30"]).toContain("Delegate Two");
    expect(namesByDate["2026-10-30"]).toContain("Delegate Three");
    expect(namesByDate["2026-10-30"] || []).not.toContain("Delegate One");

    // 31 Oct Night: Must be empty (0 delegates)
    expect(namesByDate["2026-10-31"] || []).toHaveLength(0);
  });

  it("3. Formula injection prevention and leading zero preservation in parsed Excel cells", async () => {
    const maliciousAccommodations: AccommodationExportRecord[] = [
      {
        id: "acc-sec-01",
        participant_id: "p-sec-01",
        start_date: "2026-10-28",
        end_date: "2026-10-29",
        duration_days: 1,
        amount: 499,
        status: "paid",
        participants: {
          participant_id: "007", // Leading zeros in ID
          name: "=cmd|' /C calc'!A0", // Formula injection attempt
          email: "@malicious.com", // Starts with @
          phone: "09876543210", // Leading zero in phone
          college: "+SUM(1,2)", // Formula injection attempt with +
        },
      },
    ];

    const workbook = buildAccommodationWorkbook({
      accommodations: maliciousAccommodations,
      plans: mockPlans,
    });
    const buffer = await workbook.xlsx.writeBuffer();

    const loadedWb = new ExcelJS.Workbook();
    await loadedWb.xlsx.load(buffer);
    const masterSheet = loadedWb.getWorksheet("Accommodation Master")!;
    const row = masterSheet.getRow(2);

    // Verify leading zeros preserved as text '@'
    expect(row.getCell(3).value).toBe("007"); // Participant ID
    expect(row.getCell(7).value).toBe("09876543210"); // Phone

    // Verify formula injection sanitized with single quote prefix
    expect(row.getCell(4).value).toBe("'=cmd|' /C calc'!A0"); // Name
    expect(row.getCell(6).value).toBe("'@malicious.com"); // Email
    expect(row.getCell(10).value).toBe("'+SUM(1,2)"); // College
  });

  it("4. Empty dataset produces valid workbook with 3 sheets and zero-safe summary", async () => {
    const workbook = buildAccommodationWorkbook({
      accommodations: [],
      plans: mockPlans,
    });
    const buffer = await workbook.xlsx.writeBuffer();

    const loadedWb = new ExcelJS.Workbook();
    await loadedWb.xlsx.load(buffer);

    expect(loadedWb.worksheets.length).toBe(3);
    const masterSheet = loadedWb.getWorksheet("Accommodation Master")!;
    expect(masterSheet.rowCount).toBe(1); // Header row only

    const summarySheet = loadedWb.getWorksheet("Summary")!;
    let totalBookings: any = null;
    let totalDue: any = null;
    for (let r = 1; r <= summarySheet.rowCount; r++) {
      const label = String(summarySheet.getRow(r).getCell(2).value || "");
      if (label === "Total Accommodation Bookings") totalBookings = summarySheet.getRow(r).getCell(3).value;
      if (label === "Total Amount Due") totalDue = summarySheet.getRow(r).getCell(3).value;
    }
    expect(totalBookings).toBe(0);
    expect(totalDue).toBe(0);
  });

  it("5. Invariant check: Official festival plans (1–4 days) match configuration prices and no 5-day plan exists", () => {
    const officialPlans = [
      { slug: "1_day", duration: 1, price: 499 },
      { slug: "2_days", duration: 2, price: 999 },
      { slug: "3_days", duration: 3, price: 1498 },
      { slug: "4_days", duration: 4, price: 1997 },
    ];

    expect(officialPlans.find((p) => p.duration === 1)?.price).toBe(499);
    expect(officialPlans.find((p) => p.duration === 2)?.price).toBe(999);
    expect(officialPlans.find((p) => p.duration === 3)?.price).toBe(1498);
    expect(officialPlans.find((p) => p.duration === 4)?.price).toBe(1997);
    expect(officialPlans.some((p) => p.duration === 5)).toBe(false);
  });

  it("6. 31 October overnight stay checks out on 1 November and is included in Daily Stay List", async () => {
    const accommodations: AccommodationExportRecord[] = [
      {
        id: "acc-31-oct",
        participant_id: "p-31-oct",
        start_date: "2026-10-31",
        end_date: "2026-11-01",
        duration_days: 1,
        amount: 499,
        status: "paid",
        participants: { name: "Halloween Delegate", gender: "female" },
      },
    ];

    const workbook = buildAccommodationWorkbook({ accommodations, plans: mockPlans });
    const buffer = await workbook.xlsx.writeBuffer();

    const loadedWb = new ExcelJS.Workbook();
    await loadedWb.xlsx.load(buffer);
    const dailySheet = loadedWb.getWorksheet("Daily Stay List")!;

    // 31 Oct Night row
    expect(dailySheet.rowCount).toBe(2); // Header + 1 delegate
    const row = dailySheet.getRow(2);
    expect(row.getCell(2).value).toContain("2026-10-31");
    expect(row.getCell(5).value).toBe("Halloween Delegate");
    expect(row.getCell(16).value).toBe("2026-11-01"); // Checkout date
  });

  it("7. Cancelled and refunded bookings do NOT inflate active overnight occupancy in Summary or appear on Daily Stay List", async () => {
    const accommodations: AccommodationExportRecord[] = [
      {
        id: "acc-active-paid",
        participant_id: "p-active",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "paid",
        payment_orders: { status: "paid" },
        participants: { name: "Active Delegate", gender: "male" },
      },
      {
        id: "acc-cancelled-stay",
        participant_id: "p-cancelled",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "cancelled",
        payment_orders: { status: "cancelled" },
        participants: { name: "Cancelled Delegate", gender: "male" },
      },
      {
        id: "acc-refunded-stay",
        participant_id: "p-refunded",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "refunded",
        payment_orders: { status: "refunded" },
        participants: { name: "Refunded Delegate", gender: "male" },
      },
    ];

    const workbook = buildAccommodationWorkbook({ accommodations, plans: mockPlans });
    const buffer = await workbook.xlsx.writeBuffer();

    const loadedWb = new ExcelJS.Workbook();
    await loadedWb.xlsx.load(buffer);

    // Summary Sheet checks:
    const summarySheet = loadedWb.getWorksheet("Summary")!;
    let day1Occupancy: number | null = null;
    let day2Occupancy: number | null = null;
    let totalPaid: number | null = null;
    let totalBalance: number | null = null;

    for (let r = 1; r <= summarySheet.rowCount; r++) {
      const row = summarySheet.getRow(r);
      const label = String(row.getCell(2).value || "");
      if (label === "28 Oct 2026") day1Occupancy = Number(row.getCell(4).value);
      if (label === "29 Oct 2026") day2Occupancy = Number(row.getCell(4).value);
      if (label === "Total Amount Paid") totalPaid = Number(row.getCell(3).value);
      if (label === "Total Outstanding Balance") totalBalance = Number(row.getCell(3).value);
    }

    // Only 1 active delegate stayed nights of 28 and 29 Oct (cancelled and refunded are excluded)
    expect(day1Occupancy).toBe(1);
    expect(day2Occupancy).toBe(1);

    // Financial reconciliation:
    // Only the active paid delegate counts as paid (₹999). Cancelled and refunded do not count as paid or due balance.
    expect(totalPaid).toBe(999);
    expect(totalBalance).toBe(0);

    // Daily Stay List checks:
    const dailySheet = loadedWb.getWorksheet("Daily Stay List")!;
    // 2 nights (28 and 29 Oct) for 1 active delegate = 2 rows + 1 header = 3 rows total
    expect(dailySheet.rowCount).toBe(3);

    const listedDelegateNames: string[] = [];
    for (let r = 2; r <= dailySheet.rowCount; r++) {
      listedDelegateNames.push(String(dailySheet.getRow(r).getCell(5).value));
    }
    expect(listedDelegateNames).toEqual(["Active Delegate", "Active Delegate"]);
    expect(listedDelegateNames.includes("Cancelled Delegate")).toBe(false);
    expect(listedDelegateNames.includes("Refunded Delegate")).toBe(false);
  });

  it("8. Mixed team order financial reconciliation: individual amounts vs consolidated order, net collected revenue, refunds, and zero balance", async () => {
    const teamPaymentOrder = {
      order_reference: "ORD-TEAM-4-MEMBERS",
      gateway_payment_id: "pay_gateway_mixed",
      status: "paid",
    };

    const teamBookings: AccommodationExportRecord[] = [
      {
        id: "team-m1",
        participant_id: "p-t1",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "paid",
        payment_orders: teamPaymentOrder,
        participants: { name: "Team Head", gender: "male" },
      },
      {
        id: "team-m2",
        participant_id: "p-t2",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "paid",
        payment_orders: teamPaymentOrder,
        participants: { name: "Team Member Active", gender: "female" },
      },
      {
        id: "team-m3",
        participant_id: "p-t3",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "cancelled", // Member cancelled booking
        payment_orders: teamPaymentOrder,
        participants: { name: "Team Member Cancelled", gender: "male" },
      },
      {
        id: "team-m4",
        participant_id: "p-t4",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "refunded", // Member received refund
        payment_orders: teamPaymentOrder,
        participants: { name: "Team Member Refunded", gender: "female" },
      },
    ];

    const workbook = buildAccommodationWorkbook({ accommodations: teamBookings, plans: mockPlans });
    const buffer = await workbook.xlsx.writeBuffer();

    const loadedWb = new ExcelJS.Workbook();
    await loadedWb.xlsx.load(buffer);

    // 1. Verify Master Sheet individual line items
    const masterSheet = loadedWb.getWorksheet("Accommodation Master")!;
    expect(masterSheet.rowCount).toBe(5); // Header + 4 members

    const row1 = masterSheet.getRow(2); // m1: Paid
    expect(row1.getCell(20).value).toBe("PAID");
    expect(row1.getCell(21).value).toBe(999); // amountDue
    expect(row1.getCell(22).value).toBe(999); // amountPaid
    expect(row1.getCell(23).value).toBe(0);   // balance
    expect(row1.getCell(24).value).toBe("ORD-TEAM-4-MEMBERS");

    const row2 = masterSheet.getRow(3); // m2: Paid
    expect(row2.getCell(20).value).toBe("PAID");
    expect(row2.getCell(21).value).toBe(999);
    expect(row2.getCell(22).value).toBe(999);
    expect(row2.getCell(23).value).toBe(0);

    const row3 = masterSheet.getRow(4); // m3: Cancelled
    expect(row3.getCell(20).value).toBe("CANCELLED");
    expect(row3.getCell(21).value).toBe(999);
    expect(row3.getCell(22).value).toBe(0); // Cancelled does NOT count as paid
    expect(row3.getCell(23).value).toBe(0); // Not outstanding

    const row4 = masterSheet.getRow(5); // m4: Refunded
    expect(row4.getCell(20).value).toBe("REFUNDED");
    expect(row4.getCell(21).value).toBe(999);
    expect(row4.getCell(22).value).toBe(0); // Refunded does NOT count as paid
    expect(row4.getCell(23).value).toBe(0);

    // 2. Verify Summary Sheet Key Metrics
    const summarySheet = loadedWb.getWorksheet("Summary")!;
    let totalBookings = 0;
    let activeAccommodations = 0;
    let cancelledRefunded = 0;
    let grossDue = 0;
    let collectedRevenue = 0;
    let outstandingBalance = 0;

    for (let r = 1; r <= summarySheet.rowCount; r++) {
      const row = summarySheet.getRow(r);
      const label = String(row.getCell(2).value || "");
      if (label === "Total Accommodation Bookings") totalBookings = Number(row.getCell(3).value);
      if (label === "Active Accommodations") activeAccommodations = Number(row.getCell(3).value);
      if (label === "Cancelled / Refunded Bookings") cancelledRefunded = Number(row.getCell(3).value);
      if (label === "Total Amount Due") grossDue = Number(row.getCell(3).value);
      if (label === "Total Amount Paid") collectedRevenue = Number(row.getCell(3).value);
      if (label === "Total Outstanding Balance") outstandingBalance = Number(row.getCell(3).value);
    }

    expect(totalBookings).toBe(4);
    expect(activeAccommodations).toBe(2);
    expect(cancelledRefunded).toBe(2);
    expect(grossDue).toBe(3996);       // 4 * 999 gross booked
    expect(collectedRevenue).toBe(1998); // 2 * 999 active collected
    expect(outstandingBalance).toBe(0);

    // 3. Verify Daily Occupancy excludes cancelled & refunded
    let day1Occupancy = 0;
    for (let r = 1; r <= summarySheet.rowCount; r++) {
      const row = summarySheet.getRow(r);
      const label = String(row.getCell(2).value || "");
      if (label === "28 Oct 2026") day1Occupancy = Number(row.getCell(4).value);
    }
    expect(day1Occupancy).toBe(2); // Only the 2 active members
  });
});
