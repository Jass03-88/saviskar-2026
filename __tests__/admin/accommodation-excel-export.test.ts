import { describe, it, expect } from "vitest";
import {
  buildAccommodationWorkbook,
  getStayNights,
  getLastOvernightDate,
  resolveDelegateTeamInfo,
  resolvePaymentInfo,
  MASTER_SHEET_HEADERS,
  DAILY_STAY_HEADERS,
  type AccommodationExportRecord,
  type HostelRecord,
  type FloorRecord,
  type RoomRecord,
  type PlanRecord,
} from "@/lib/admin/accommodation-excel-export";

describe("Accommodation Excel Export Generator", () => {
  const mockPlans: PlanRecord[] = [
    { id: "plan-1", name: "1-Day Campus Stay", slug: "1_day", price: 500, duration_days: 1 },
    { id: "plan-2", name: "2-Day Campus Stay", slug: "2_days", price: 900, duration_days: 2 },
    { id: "plan-3", name: "3-Day Campus Stay", slug: "3_days", price: 1200, duration_days: 3 },
  ];

  const mockHostels: HostelRecord[] = [
    { id: "hostel-1", name: "Boys Hostel A", gender_eligibility: "male", is_active: true },
    { id: "hostel-2", name: "Girls Hostel B", gender_eligibility: "female", is_active: true },
  ];

  const mockFloors: FloorRecord[] = [
    { id: "floor-1", hostel_id: "hostel-1", floor_number: 1 },
    { id: "floor-2", hostel_id: "hostel-2", floor_number: 2 },
  ];

  const mockRooms: RoomRecord[] = [
    { id: "room-101", hostel_id: "hostel-1", floor_id: "floor-1", room_number: "101", capacity: 3 },
    { id: "room-201", hostel_id: "hostel-2", floor_id: "floor-2", room_number: "201", capacity: 2 },
  ];

  const mockAccommodations: AccommodationExportRecord[] = [
    {
      id: "acc-001",
      participant_id: "part-001",
      accommodation_plan_id: "plan-3",
      start_date: "2026-10-28",
      end_date: "2026-10-31",
      duration_days: 3,
      amount: 1200,
      currency: "INR",
      status: "paid",
      hostel_id: "hostel-1",
      room_id: "room-101",
      checked_in: true,
      checked_in_at: "2026-10-28T10:00:00Z",
      checked_out: false,
      created_at: "2026-10-25T12:00:00Z",
      payment_orders: {
        order_reference: "ORD-SVK26-1001",
        gateway_payment_id: "pay_xyz_12345",
        status: "paid",
      },
      participants: {
        participant_id: "SVK26-PART01",
        name: "Rahul Sharma",
        email: "rahul@example.com",
        phone: "+919876543210",
        gender: "male",
        state: "Punjab",
        college: "CGC Landran",
        is_faculty: false,
        participant_events: [
          {
            id: "pe-001",
            team_name: "Code Warriors",
            participant_id: "part-001",
            participants: { participant_id: "SVK26-PART01", name: "Rahul Sharma" },
          },
        ],
      },
    },
    {
      id: "acc-002",
      participant_id: "part-002",
      accommodation_plan_id: "plan-2",
      start_date: "2026-10-28",
      end_date: "2026-10-30",
      duration_days: 2,
      amount: 900,
      currency: "INR",
      status: "paid",
      hostel_id: "hostel-2",
      room_id: "room-201",
      checked_in: false,
      created_at: "2026-10-26T08:00:00Z",
      payment_orders: {
        order_reference: "ORD-SVK26-1002",
        gateway_payment_id: "pay_abc_67890",
        status: "paid",
      },
      participants: {
        participant_id: "SVK26-PART02",
        name: "Priya Patel",
        email: "priya@example.com",
        phone: "09876543211", // Leading zero test
        gender: "female",
        state: "Gujarat",
        college: "Gujarat University",
        is_faculty: false,
        participant_event_members: [
          {
            id: "pem-001",
            participant_event_id: "pe-001",
            is_team_leader: false,
            participant_events: {
              id: "pe-001",
              team_name: "Code Warriors",
              participant_id: "part-001",
              participants: { participant_id: "SVK26-PART01", name: "Rahul Sharma" },
            },
          },
        ],
      },
    },
    {
      id: "acc-003",
      participant_id: "part-003",
      accommodation_plan_id: "plan-1",
      start_date: "2026-10-29",
      end_date: "2026-10-30",
      duration_days: 1,
      amount: 500,
      currency: "INR",
      status: "pending",
      hostel_id: null,
      room_id: null,
      checked_in: false,
      created_at: "2026-10-27T09:00:00Z",
      payment_order_id: "po-pending-003",
      participants: {
        participant_id: "SVK26-PART03",
        name: "=Dr. Amit Verma", // Formula injection test
        email: "amit@example.com",
        phone: "+919988776655",
        gender: "male",
        state: "Delhi",
        college: "Delhi University",
        is_faculty: true,
      },
    },
  ];

  it("1. Generates a valid 3-sheet workbook with exact sheet names", () => {
    const workbook = buildAccommodationWorkbook({
      accommodations: mockAccommodations,
      hostels: mockHostels,
      floors: mockFloors,
      rooms: mockRooms,
      plans: mockPlans,
    });

    expect(workbook.worksheets.length).toBe(3);
    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toEqual(["Accommodation Master", "Summary", "Daily Stay List"]);
  });

  it("2. Accommodation Master sheet row grain is exactly 1 row per booking with 33 columns", () => {
    const workbook = buildAccommodationWorkbook({
      accommodations: mockAccommodations,
      hostels: mockHostels,
      floors: mockFloors,
      rooms: mockRooms,
      plans: mockPlans,
    });

    const masterSheet = workbook.getWorksheet("Accommodation Master")!;
    expect(masterSheet).toBeDefined();

    // 1 header row + 3 data rows
    expect(masterSheet.rowCount).toBe(4);
    expect(MASTER_SHEET_HEADERS.length).toBe(33);

    // Verify row 2 (Rahul Sharma, Team Head of Code Warriors)
    const row2 = masterSheet.getRow(2);
    expect(row2.getCell(1).value).toBe(1); // Sr. No.
    expect(row2.getCell(2).value).toBe("acc-001"); // Booking ID
    expect(row2.getCell(3).value).toBe("SVK26-PART01"); // Participant ID
    expect(row2.getCell(4).value).toBe("Rahul Sharma"); // Name
    expect(row2.getCell(5).value).toBe("Participant"); // Type
    expect(row2.getCell(11).value).toBe("Code Warriors"); // Team Name
    expect(row2.getCell(12).value).toBe("Team Head"); // Team Role
    expect(row2.getCell(13).value).toBe("Rahul Sharma"); // Team Leader Name
    expect(row2.getCell(14).value).toBe("3-Day Campus Stay"); // Plan Name
    expect(row2.getCell(15).value).toBe(3); // Duration Days
    expect(row2.getCell(16).value).toBe("2026-10-28"); // Start Date
    expect(row2.getCell(17).value).toBe("2026-10-30"); // Last Overnight Date
    expect(row2.getCell(18).value).toBe("2026-10-31"); // Checkout Date
    expect(row2.getCell(20).value).toBe("PAID"); // Payment Status
    expect(row2.getCell(21).value).toBe(1200); // Amount Due
    expect(row2.getCell(22).value).toBe(1200); // Amount Paid
    expect(row2.getCell(23).value).toBe(0); // Outstanding Balance
    expect(row2.getCell(24).value).toBe("ORD-SVK26-1001"); // Payment Order Ref
    expect(row2.getCell(25).value).toBe("pay_xyz_12345"); // Gateway Payment ID
    expect(row2.getCell(26).value).toBe("Allocated"); // Allocation Status
    expect(row2.getCell(27).value).toBe("Boys Hostel A"); // Hostel Name
    expect(row2.getCell(29).value).toBe("101"); // Room Number
    expect(row2.getCell(30).value).toBe("Checked In"); // Check-in Status

    // Verify row 3 (Priya Patel, Team Member)
    const row3 = masterSheet.getRow(3);
    expect(row3.getCell(1).value).toBe(2);
    expect(row3.getCell(11).value).toBe("Code Warriors");
    expect(row3.getCell(12).value).toBe("Team Member");
    expect(row3.getCell(13).value).toBe("Rahul Sharma"); // Resolved leader
    expect(row3.getCell(17).value).toBe("2026-10-29"); // Last overnight of 28-30 Oct stay is 29 Oct

    // Verify row 4 (Faculty Dr. Amit Verma, Pending payment)
    const row4 = masterSheet.getRow(4);
    expect(row4.getCell(5).value).toBe("Faculty");
    expect(row4.getCell(12).value).toBe("Faculty");
    expect(row4.getCell(20).value).toBe("PENDING");
    expect(row4.getCell(21).value).toBe(500); // Amount Due
    expect(row4.getCell(22).value).toBe(0); // Amount Paid
    expect(row4.getCell(23).value).toBe(500); // Balance
    expect(row4.getCell(26).value).toBe("Awaiting Allocation");
  });

  it("3. Correctly handles overnight stays vs checkout dates (checkout morning does not count as overnight)", () => {
    // 2-day stay starting 2026-10-28 checkout 2026-10-30
    const nights = getStayNights("2026-10-28", "2026-10-30");
    expect(nights).toEqual(["2026-10-28", "2026-10-29"]);
    expect(nights).not.toContain("2026-10-30"); // Checkout morning is NOT an overnight night

    const lastNight = getLastOvernightDate("2026-10-28", "2026-10-30");
    expect(lastNight).toBe("2026-10-29");

    // 4-day stay starting 2026-10-28 checkout 2026-11-01
    const fourDayNights = getStayNights("2026-10-28", "2026-11-01");
    expect(fourDayNights).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(fourDayNights).not.toContain("2026-11-01");
  });

  it("4. Daily Stay List sheet includes delegates on their overnight nights and excludes them on checkout morning", () => {
    const workbook = buildAccommodationWorkbook({
      accommodations: mockAccommodations,
      hostels: mockHostels,
      floors: mockFloors,
      rooms: mockRooms,
      plans: mockPlans,
    });

    const dailySheet = workbook.getWorksheet("Daily Stay List")!;
    expect(dailySheet).toBeDefined();

    // Verify row headers
    expect(DAILY_STAY_HEADERS.length).toBe(16);

    // Collect all rows by night date
    const rowsByNight: Record<string, string[]> = {};
    for (let r = 2; r <= dailySheet.rowCount; r++) {
      const nightStr = String(dailySheet.getRow(r).getCell(2).value || "");
      const partName = String(dailySheet.getRow(r).getCell(5).value || "");
      const dateKey = nightStr.slice(0, 10);
      if (!rowsByNight[dateKey]) rowsByNight[dateKey] = [];
      rowsByNight[dateKey].push(partName);
    }

    // On 28 Oct Night: Rahul (28-31) and Priya (28-30) are staying
    expect(rowsByNight["2026-10-28"]).toContain("Rahul Sharma");
    expect(rowsByNight["2026-10-28"]).toContain("Priya Patel");
    expect(rowsByNight["2026-10-28"] || []).not.toContain("'=Dr. Amit Verma"); // Starts 29 Oct

    // On 29 Oct Night: Rahul (28-31), Priya (28-30), and Amit (29-30) are staying
    expect(rowsByNight["2026-10-29"]).toContain("Rahul Sharma");
    expect(rowsByNight["2026-10-29"]).toContain("Priya Patel");
    expect(rowsByNight["2026-10-29"]).toContain("'=Dr. Amit Verma");

    // On 30 Oct Night:
    // Rahul (28-31) stays
    // Priya (28-30) checked out morning of 30th -> DOES NOT STAY
    // Amit (29-30) checked out morning of 30th -> DOES NOT STAY
    expect(rowsByNight["2026-10-30"]).toContain("Rahul Sharma");
    expect(rowsByNight["2026-10-30"] || []).not.toContain("Priya Patel");
    expect(rowsByNight["2026-10-30"] || []).not.toContain("'=Dr. Amit Verma");
  });

  it("5. Summary sheet aggregates totals, metrics, gender, and payment correctly", () => {
    const workbook = buildAccommodationWorkbook({
      accommodations: mockAccommodations,
      hostels: mockHostels,
      floors: mockFloors,
      rooms: mockRooms,
      plans: mockPlans,
    });

    const summarySheet = workbook.getWorksheet("Summary")!;
    expect(summarySheet).toBeDefined();

    // Verify key titles and presence of sections
    let foundTotalBookings = false;
    let foundPaymentStatus = false;
    let foundGender = false;
    let foundNightly = false;

    for (let r = 1; r <= summarySheet.rowCount; r++) {
      const val = String(summarySheet.getRow(r).getCell(2).value || "");
      if (val === "Total Accommodation Bookings") {
        foundTotalBookings = true;
        expect(summarySheet.getRow(r).getCell(3).value).toBe(3);
      }
      if (val === "PAYMENT STATUS BREAKDOWN") foundPaymentStatus = true;
      if (val === "GENDER DISTRIBUTION") foundGender = true;
      if (val === "NIGHTLY OVERNIGHT OCCUPANCY (27–31 OCT)") foundNightly = true;
    }

    expect(foundTotalBookings).toBe(true);
    expect(foundPaymentStatus).toBe(true);
    expect(foundGender).toBe(true);
    expect(foundNightly).toBe(true);
  });

  it("6. Sanitizes formula injection characters (=, @, +, -) in untrusted text fields", () => {
    const workbook = buildAccommodationWorkbook({
      accommodations: mockAccommodations,
      hostels: mockHostels,
      floors: mockFloors,
      rooms: mockRooms,
      plans: mockPlans,
    });

    const masterSheet = workbook.getWorksheet("Accommodation Master")!;
    // Participant 3 name was "=Dr. Amit Verma"
    const part3Name = masterSheet.getRow(4).getCell(4).value;
    expect(part3Name).toBe("'=Dr. Amit Verma"); // Escaped with leading single quote
  });
});
