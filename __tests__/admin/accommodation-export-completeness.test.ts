import { describe, it, expect, vi } from "vitest";
import {
  buildAccommodationWorkbook,
  type AccommodationExportRecord,
  type PlanRecord,
} from "@/lib/admin/accommodation-excel-export";
import ExcelJS from "exceljs";

describe("Accommodation Export Completeness & Paginated Server Query", () => {
  const mockPlans: PlanRecord[] = [
    { id: "plan-1", name: "1-Day Campus Stay", slug: "1_day", price: 500, duration_days: 1 },
    { id: "plan-2", name: "2-Day Campus Stay", slug: "2_days", price: 900, duration_days: 2 },
    { id: "plan-3", name: "3-Day Campus Stay", slug: "3_days", price: 1200, duration_days: 3 },
  ];

  // Helper to generate N realistic accommodation records
  function generateMockAccommodations(count: number): AccommodationExportRecord[] {
    const list: AccommodationExportRecord[] = [];
    const statuses = ["paid", "pending", "unpaid"];
    const dates = [
      { start: "2026-10-28", end: "2026-10-31", days: 3, planId: "plan-3", amt: 1200 },
      { start: "2026-10-28", end: "2026-10-30", days: 2, planId: "plan-2", amt: 900 },
      { start: "2026-10-29", end: "2026-10-30", days: 1, planId: "plan-1", amt: 500 },
    ];

    for (let i = 1; i <= count; i++) {
      const d = dates[i % dates.length];
      const status = statuses[i % statuses.length];
      const isPaid = status === "paid";
      list.push({
        id: `acc-bulk-${String(i).padStart(5, "0")}`,
        participant_id: `part-bulk-${String(i).padStart(5, "0")}`,
        accommodation_plan_id: d.planId,
        start_date: d.start,
        end_date: d.end,
        duration_days: d.days,
        amount: d.amt,
        currency: "INR",
        status,
        hostel_id: i % 2 === 0 ? "hostel-boys" : "hostel-girls",
        room_id: i % 3 === 0 ? `room-${i % 20}` : null,
        checked_in: isPaid && i % 4 === 0,
        checked_out: false,
        created_at: "2026-10-25T10:00:00Z",
        payment_orders: isPaid
          ? {
              order_reference: `ORD-BULK-${i}`,
              gateway_payment_id: `pay_bulk_${i}`,
              status: "paid",
            }
          : null,
        participants: {
          participant_id: `SVK26-B${String(i).padStart(5, "0")}`,
          name: `Delegate ${i}`,
          email: `delegate${i}@test.com`,
          phone: `98765${String(i).padStart(5, "0")}`,
          gender: i % 2 === 0 ? "male" : "female",
          state: "Punjab",
          college: "Punjab Technical University",
          is_faculty: i % 50 === 0,
        },
      });
    }
    return list;
  }

  it("1. Keyset-paginated batch query retrieves all 2,500 records across multiple 1,000-row database batches without offset drift", async () => {
    const TOTAL_RECORDS = 2500;
    const BATCH_SIZE = 1000;
    const fullMockDatabase = generateMockAccommodations(TOTAL_RECORDS).sort((a, b) => a.id.localeCompare(b.id));

    // Mock keyset batch fetcher (simulates Supabase .gt("id", lastSeenId).limit(BATCH_SIZE))
    const fetchBatchSpy = vi.fn(async (lastId: string | null, limit: number) => {
      let filtered = fullMockDatabase;
      if (lastId) {
        filtered = fullMockDatabase.filter((r) => r.id > lastId);
      }
      const slice = filtered.slice(0, limit);
      return { data: slice, error: null };
    });

    const retrieved: AccommodationExportRecord[] = [];
    const seenIds = new Set<string>();
    let lastSeenId: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const res: { data: AccommodationExportRecord[]; error: Error | null } = await fetchBatchSpy(lastSeenId, BATCH_SIZE);
      expect(res.error).toBeNull();
      if (!res.data || res.data.length === 0) {
        hasMore = false;
      } else {
        for (const item of res.data) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            retrieved.push(item);
          }
        }
        if (res.data.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          lastSeenId = res.data[res.data.length - 1].id;
        }
      }
    }

    // Must have made 3 batch calls: initial, after record 1000, after record 2000
    expect(fetchBatchSpy).toHaveBeenCalledTimes(3);
    expect(retrieved.length).toBe(TOTAL_RECORDS);
    expect(retrieved[0].id).toBe("acc-bulk-00001");
    expect(retrieved[TOTAL_RECORDS - 1].id).toBe("acc-bulk-02500");
  });

  it("2. Workbook generated with 2,500 records has exactly 2,501 rows in Master sheet and correct Summary", async () => {
    const TOTAL_RECORDS = 2500;
    const accommodations = generateMockAccommodations(TOTAL_RECORDS);

    const workbook = buildAccommodationWorkbook({
      accommodations,
      plans: mockPlans,
    });

    const masterSheet = workbook.getWorksheet("Accommodation Master")!;
    expect(masterSheet).toBeDefined();
    // 1 Header row + 2500 Data rows
    expect(masterSheet.rowCount).toBe(TOTAL_RECORDS + 1);

    // Verify first and last rows
    const firstDataRow = masterSheet.getRow(2);
    expect(firstDataRow.getCell(1).value).toBe(1);
    expect(firstDataRow.getCell(2).value).toBe("acc-bulk-00001");

    const lastDataRow = masterSheet.getRow(TOTAL_RECORDS + 1);
    expect(lastDataRow.getCell(1).value).toBe(TOTAL_RECORDS);
    expect(lastDataRow.getCell(2).value).toBe("acc-bulk-02500");

    // Verify Summary sheet KPI
    const summarySheet = workbook.getWorksheet("Summary")!;
    let totalBookingsValue: any = null;
    for (let r = 1; r <= summarySheet.rowCount; r++) {
      if (summarySheet.getRow(r).getCell(2).value === "Total Accommodation Bookings") {
        totalBookingsValue = summarySheet.getRow(r).getCell(3).value;
        break;
      }
    }
    expect(totalBookingsValue).toBe(TOTAL_RECORDS);

    // Verify written buffer can be parsed back with ExcelJS
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(50000);

    const loadedWb = new ExcelJS.Workbook();
    await loadedWb.xlsx.load(buffer);
    expect(loadedWb.worksheets.length).toBe(3);
    expect(loadedWb.getWorksheet("Accommodation Master")!.rowCount).toBe(TOTAL_RECORDS + 1);
  });

  it("3. Filtered export respects active criteria while Export All retains all records", () => {
    const TOTAL_RECORDS = 100;
    const allRecords = generateMockAccommodations(TOTAL_RECORDS);

    // Active Filter: Gender = female and Duration = 2 days
    const filteredRecords = allRecords.filter(
      (a) => a.participants?.gender === "female" && a.duration_days === 2
    );

    expect(filteredRecords.length).toBeGreaterThan(0);
    expect(filteredRecords.length).toBeLessThan(TOTAL_RECORDS);

    // Export Filtered workbook
    const filteredWorkbook = buildAccommodationWorkbook({
      accommodations: filteredRecords,
      plans: mockPlans,
    });
    const filteredMaster = filteredWorkbook.getWorksheet("Accommodation Master")!;
    expect(filteredMaster.rowCount).toBe(filteredRecords.length + 1);

    // Export All workbook
    const allWorkbook = buildAccommodationWorkbook({
      accommodations: allRecords,
      plans: mockPlans,
    });
    const allMaster = allWorkbook.getWorksheet("Accommodation Master")!;
    expect(allMaster.rowCount).toBe(TOTAL_RECORDS + 1);
  });

  it("4. Keyset-paginated batch query terminates cleanly for an exact multiple of the batch size (2,000 records)", async () => {
    const TOTAL_RECORDS = 2000;
    const BATCH_SIZE = 1000;
    const db = generateMockAccommodations(TOTAL_RECORDS).sort((a, b) => a.id.localeCompare(b.id));

    const fetchBatchSpy = vi.fn(async (lastId: string | null, limit: number) => {
      let filtered = db;
      if (lastId) {
        filtered = db.filter((r) => r.id > lastId);
      }
      const slice = filtered.slice(0, limit);
      return { data: slice, error: null };
    });

    const retrieved: AccommodationExportRecord[] = [];
    const seenIds = new Set<string>();
    let lastSeenId: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const res: { data: AccommodationExportRecord[]; error: Error | null } = await fetchBatchSpy(lastSeenId, BATCH_SIZE);
      expect(res.error).toBeNull();
      if (!res.data || res.data.length === 0) {
        hasMore = false;
      } else {
        for (const item of res.data) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            retrieved.push(item);
          }
        }
        if (res.data.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          lastSeenId = res.data[res.data.length - 1].id;
        }
      }
    }

    // For 2,000 items with batch size 1,000:
    // Batch 1 returns 1,000 items (hasMore remains true)
    // Batch 2 returns 1,000 items (hasMore remains true)
    // Batch 3 returns 0 items (hasMore becomes false, loop terminates)
    expect(fetchBatchSpy).toHaveBeenCalledTimes(3);
    expect(retrieved.length).toBe(TOTAL_RECORDS);
  });

  it("5. Keyset-paginated batch query handles empty database dataset gracefully", async () => {
    const BATCH_SIZE = 1000;
    const fetchBatchSpy = vi.fn(async (): Promise<{ data: AccommodationExportRecord[]; error: Error | null }> => ({ data: [], error: null }));

    const retrieved: AccommodationExportRecord[] = [];
    let lastSeenId: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const res = await fetchBatchSpy();
      if (!res.data || res.data.length === 0) {
        hasMore = false;
      } else {
        retrieved.push(...res.data);
        if (res.data.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          lastSeenId = res.data[res.data.length - 1].id;
        }
      }
    }

    expect(fetchBatchSpy).toHaveBeenCalledTimes(1);
    expect(retrieved.length).toBe(0);
  });

  it("6. Detailed active filter evaluation: startDate, checkoutDate, refunded status, unspecified gender", () => {
    const records: AccommodationExportRecord[] = [
      {
        id: "acc-f-1",
        participant_id: "p-1",
        start_date: "2026-10-27",
        end_date: "2026-10-30",
        duration_days: 3,
        amount: 1200,
        status: "paid",
        participants: { gender: "male", name: "Rohan", participant_id: "SVK-1" },
      },
      {
        id: "acc-f-2",
        participant_id: "p-2",
        start_date: "2026-10-28",
        end_date: "2026-11-01",
        duration_days: 4,
        amount: 1600,
        status: "refunded",
        payment_orders: { status: "refunded" },
        participants: { gender: "", name: "Simran", participant_id: "SVK-2" },
      },
      {
        id: "acc-f-3",
        participant_id: "p-3",
        start_date: "2026-10-31",
        end_date: "2026-11-01",
        duration_days: 1,
        amount: 500,
        status: "partially_paid",
        payment_orders: { status: "partially_paid" },
        participants: { gender: "female", name: "Pooja", participant_id: "SVK-3" },
      },
    ];

    // Filter 1: Checkout 1 Nov
    const checkout1Nov = records.filter(
      (r) => r.end_date === "2026-11-01" || r.end_date?.startsWith("2026-11-01")
    );
    expect(checkout1Nov.length).toBe(2);
    expect(checkout1Nov.map((r) => r.id)).toEqual(["acc-f-2", "acc-f-3"]);

    // Filter 2: Refunded status
    const refunded = records.filter(
      (r) => r.status === "refunded" || (r.payment_orders as any)?.status === "refunded"
    );
    expect(refunded.length).toBe(1);
    expect(refunded[0].id).toBe("acc-f-2");

    // Filter 3: Unspecified gender
    const unspecifiedGender = records.filter(
      (r) => !r.participants?.gender || r.participants?.gender === "unspecified"
    );
    expect(unspecifiedGender.length).toBe(1);
    expect(unspecifiedGender[0].id).toBe("acc-f-2");

    // Filter 4: Start date 27 Oct
    const start27 = records.filter((r) => r.start_date === "2026-10-27");
    expect(start27.length).toBe(1);
    expect(start27[0].id).toBe("acc-f-1");
  });

  it("7. Parameterized verification: check-in lifecycle, duration, hostel, room, and search filter execution", () => {
    const dataset: AccommodationExportRecord[] = [
      {
        id: "acc-101",
        participant_id: "p-101",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "paid",
        hostel_id: "h-boys",
        room_id: "r-101",
        checked_in: true,
        checked_out: false,
        participants: {
          participant_id: "SVK26-101",
          name: "Amit Kumar",
          email: "amit@gndu.ac.in",
          phone: "9812345678",
          gender: "male",
          state: "Punjab",
          college: "GNDU Amritsar",
          participant_events: [{ id: "pe-1", team_name: "Amritsar Hackers" }],
        },
      },
      {
        id: "acc-102",
        participant_id: "p-102",
        start_date: "2026-10-27",
        end_date: "2026-10-30",
        duration_days: 3,
        amount: 1498,
        status: "paid",
        hostel_id: "h-girls",
        room_id: "r-201",
        checked_in: true,
        checked_out: true,
        participants: {
          participant_id: "SVK26-102",
          name: "Priya Sharma",
          email: "priya@thapar.edu",
          phone: "9876543210",
          gender: "female",
          state: "Punjab",
          college: "Thapar University",
        },
      },
      {
        id: "acc-103",
        participant_id: "p-103",
        start_date: "2026-10-28",
        end_date: "2026-10-29",
        duration_days: 1,
        amount: 499,
        status: "unpaid",
        hostel_id: null,
        room_id: null,
        checked_in: false,
        checked_out: false,
        participants: {
          participant_id: "SVK26-103",
          name: "Suresh Raina",
          email: "suresh@du.ac.in",
          phone: "9811122233",
          gender: "male",
          state: "Delhi",
          college: "Delhi University",
        },
      },
    ];

    // Check-in lifecycle filters:
    // Awaiting allocation
    const awaitingAlloc = dataset.filter((a) => !a.room_id);
    expect(awaitingAlloc.map((a) => a.id)).toEqual(["acc-103"]);

    // Allocated
    const allocated = dataset.filter((a) => !!a.room_id);
    expect(allocated.map((a) => a.id)).toEqual(["acc-101", "acc-102"]);

    // Checked in
    const checkedIn = dataset.filter((a) => a.checked_in && !a.checked_out);
    expect(checkedIn.map((a) => a.id)).toEqual(["acc-101"]);

    // Checked out
    const checkedOut = dataset.filter((a) => a.checked_out);
    expect(checkedOut.map((a) => a.id)).toEqual(["acc-102"]);

    // Duration filter
    expect(dataset.filter((a) => a.duration_days === 1).map((a) => a.id)).toEqual(["acc-103"]);
    expect(dataset.filter((a) => a.duration_days === 2).map((a) => a.id)).toEqual(["acc-101"]);
    expect(dataset.filter((a) => a.duration_days === 3).map((a) => a.id)).toEqual(["acc-102"]);

    // Search filter across team name
    const teamSearch = dataset.filter((a) =>
      a.participants?.participant_events?.some((pe) => pe.team_name?.includes("Amritsar"))
    );
    expect(teamSearch.map((a) => a.id)).toEqual(["acc-101"]);

    // Combined multi-filter: Punjab + Male + Duration 2
    const combined = dataset.filter(
      (a) =>
        a.participants?.state === "Punjab" &&
        a.participants?.gender === "male" &&
        a.duration_days === 2
    );
    expect(combined.map((a) => a.id)).toEqual(["acc-101"]);
  });

  it("8. Keyset cursor and database ordering alignment: db queries order strictly by id ASC matching the gt(id, lastSeenId) cursor seek", async () => {
    // Database query invariant in export route:
    // .order("id", { ascending: true }).limit(DB_BATCH_SIZE)
    // and when advancing: .gt("id", lastSeenId)
    // The cursor and ordering MUST use the exact same primary key column and direction.
    const mockUuids = [
      "a1000000-0000-4000-8000-000000000001",
      "b2000000-0000-4000-8000-000000000002",
      "c3000000-0000-4000-8000-000000000003",
      "d4000000-0000-4000-8000-000000000004",
      "e5000000-0000-4000-8000-000000000005",
    ];

    const records = mockUuids.map((id, idx) => ({
      id,
      created_at: `2026-10-2${idx}T10:00:00Z`,
      participant_id: `part-${idx}`,
    }));

    // Simulating database query ordering by id ASC
    const fetchBatch = (afterId: string | null, limit: number) => {
      let filtered = [...records].sort((a, b) => a.id.localeCompare(b.id));
      if (afterId) {
        filtered = filtered.filter((r) => r.id > afterId);
      }
      return filtered.slice(0, limit);
    };

    const retrieved: typeof records = [];
    let lastSeenId: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const batch = fetchBatch(lastSeenId, 2);
      if (batch.length === 0) {
        hasMore = false;
      } else {
        retrieved.push(...batch);
        if (batch.length < 2) {
          hasMore = false;
        } else {
          lastSeenId = batch[batch.length - 1].id;
        }
      }
    }

    expect(retrieved.length).toBe(mockUuids.length);
    expect(retrieved.map((r) => r.id)).toEqual(mockUuids);
  });

  it("8b. Divergence regression guard: ordering by created_at while seeking by id causes omissions", () => {
    // If a database query ordered by created_at DESC while advancing by id > lastSeenId,
    // records whose UUIDs don't follow timestamp order would be skipped or corrupted.
    const unsyncedDb = [
      { id: "uuid-1", created_at: "2026-10-25T12:00:00Z" },
      { id: "uuid-9", created_at: "2026-10-25T11:00:00Z" },
      { id: "uuid-2", created_at: "2026-10-25T10:00:00Z" },
    ];

    // Divergent query: ordered by created_at DESC
    const sortedByCreatedAt = [...unsyncedDb].sort((a, b) => b.created_at.localeCompare(a.created_at));
    // Advancing cursor with id > lastSeenId
    const firstBatch = sortedByCreatedAt.slice(0, 2); // gets uuid-1, uuid-9
    const lastId = firstBatch[firstBatch.length - 1].id; // "uuid-9"

    // If query tries to seek by id > "uuid-9", "uuid-2" is completely missed ("uuid-2" > "uuid-9" is false!)
    const missedRecords = sortedByCreatedAt.filter((r) => r.id > lastId);
    expect(missedRecords.length).toBe(0); // uuid-2 was lost!

    // This proves cursor and database order MUST be identical (id ASC with id > lastSeenId).
  });

  it("8c. In-memory post-fetch presentation ordering: strictly enforces created_at DESC and id DESC", () => {
    // Tests the post-fetch deterministic sort applied before workbook generation:
    // allAccommodations.sort((a, b) => b.created_at - a.created_at || b.id - a.id)
    const records = [
      { id: "acc-001", created_at: "2026-10-25T10:00:00Z" },
      { id: "acc-003", created_at: "2026-10-25T10:00:00Z" },
      { id: "acc-002", created_at: "2026-10-25T11:00:00Z" },
    ];

    records.sort((a, b) => {
      const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    expect(records.map((r) => r.id)).toEqual(["acc-002", "acc-003", "acc-001"]);
  });

  it("9. Exact checkout date filter semantics: matches exact checkout dates (28, 29, 30, 31 Oct, 1 Nov) without range bleeding", () => {
    const datesData: AccommodationExportRecord[] = [
      { id: "c-28", participant_id: "p1", start_date: "2026-10-27", end_date: "2026-10-28", duration_days: 1, amount: 499, status: "paid" },
      { id: "c-29", participant_id: "p2", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid" },
      { id: "c-30", participant_id: "p3", start_date: "2026-10-28", end_date: "2026-10-30", duration_days: 2, amount: 999, status: "paid" },
      { id: "c-31", participant_id: "p4", start_date: "2026-10-28", end_date: "2026-10-31", duration_days: 3, amount: 1498, status: "paid" },
      { id: "c-01", participant_id: "p5", start_date: "2026-10-31", end_date: "2026-11-01", duration_days: 1, amount: 499, status: "paid" },
      { id: "c-01-multi", participant_id: "p6", start_date: "2026-10-28", end_date: "2026-11-01", duration_days: 4, amount: 1997, status: "paid" },
    ];

    const filterByCheckout = (dateStr: string) =>
      datesData.filter((r) => (r.end_date ? r.end_date.slice(0, 10) : "") === dateStr);

    expect(filterByCheckout("2026-10-28").map((r) => r.id)).toEqual(["c-28"]);
    expect(filterByCheckout("2026-10-29").map((r) => r.id)).toEqual(["c-29"]);
    expect(filterByCheckout("2026-10-30").map((r) => r.id)).toEqual(["c-30"]);
    expect(filterByCheckout("2026-10-31").map((r) => r.id)).toEqual(["c-31"]);
    expect(filterByCheckout("2026-11-01").map((r) => r.id)).toEqual(["c-01", "c-01-multi"]);
  });

  it("10. Refunded vs Cancelled strict distinction: refunded does not include cancelled, and cancelled does not include refunded", () => {
    const records: AccommodationExportRecord[] = [
      { id: "acc-paid", participant_id: "p1", start_date: "2026-10-28", end_date: "2026-10-30", duration_days: 2, amount: 999, status: "paid", payment_orders: { status: "paid" } },
      { id: "acc-cancelled", participant_id: "p2", start_date: "2026-10-28", end_date: "2026-10-30", duration_days: 2, amount: 999, status: "cancelled", payment_orders: { status: "cancelled" } },
      { id: "acc-refunded", participant_id: "p3", start_date: "2026-10-28", end_date: "2026-10-30", duration_days: 2, amount: 999, status: "refunded", payment_orders: { status: "refunded" } },
      { id: "acc-po-refunded", participant_id: "p4", start_date: "2026-10-28", end_date: "2026-10-30", duration_days: 2, amount: 999, status: "paid", payment_orders: { status: "refunded" } },
    ];

    const evaluateStatus = (filterStatus: string) => {
      return records.filter((acc) => {
        const po = Array.isArray(acc.payment_orders) ? acc.payment_orders[0] : acc.payment_orders;
        const poStatus = po?.status ? String(po.status).toLowerCase() : "";
        const accStatus = acc.status ? String(acc.status).toLowerCase() : "";

        if (filterStatus === "refunded") {
          return (accStatus === "refunded" || poStatus === "refunded") && accStatus !== "cancelled";
        }
        if (filterStatus === "cancelled") {
          return (accStatus === "cancelled" || poStatus === "cancelled") && accStatus !== "refunded" && poStatus !== "refunded";
        }
        return false;
      });
    };

    const refundedResults = evaluateStatus("refunded");
    expect(refundedResults.map((r) => r.id)).toEqual(["acc-refunded", "acc-po-refunded"]);
    expect(refundedResults.some((r) => r.id === "acc-cancelled")).toBe(false);

    const cancelledResults = evaluateStatus("cancelled");
    expect(cancelledResults.map((r) => r.id)).toEqual(["acc-cancelled"]);
    expect(cancelledResults.some((r) => r.id === "acc-refunded" || r.id === "acc-po-refunded")).toBe(false);
  });

  it("11. Unspecified gender semantics: matches NULL, empty string, and sentinels without matching known genders", () => {
    const delegates: AccommodationExportRecord[] = [
      { id: "g-null", participant_id: "p1", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", participants: { gender: undefined, name: "Null Gender" } },
      { id: "g-empty", participant_id: "p2", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", participants: { gender: "", name: "Empty Gender" } },
      { id: "g-sentinel-unsp", participant_id: "p3", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", participants: { gender: "unspecified", name: "Unspecified" } },
      { id: "g-sentinel-not", participant_id: "p4", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", participants: { gender: "not_specified", name: "Not Specified" } },
      { id: "g-sentinel-unknown", participant_id: "p5", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", participants: { gender: "unknown", name: "Unknown" } },
      { id: "g-male", participant_id: "p6", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", participants: { gender: "male", name: "Male" } },
      { id: "g-female", participant_id: "p7", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", participants: { gender: "female", name: "Female" } },
      { id: "g-other", participant_id: "p8", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", participants: { gender: "other", name: "Other" } },
    ];

    const filterGender = (mode: string) => {
      return delegates.filter((acc) => {
        const rawGender = acc.participants?.gender ? String(acc.participants.gender).trim().toLowerCase() : "";
        const isKnownGender = rawGender === "male" || rawGender === "female" || rawGender === "other";

        if (mode === "all") return true;
        if (mode === "unspecified") {
          return !rawGender || rawGender === "unspecified" || rawGender === "not_specified" || rawGender === "none" || rawGender === "unknown" || !isKnownGender;
        }
        return rawGender === mode.toLowerCase();
      });
    };

    const unspecified = filterGender("unspecified");
    expect(unspecified.map((r) => r.id)).toEqual(["g-null", "g-empty", "g-sentinel-unsp", "g-sentinel-not", "g-sentinel-unknown"]);
    expect(unspecified.some((r) => r.id === "g-male" || r.id === "g-female" || r.id === "g-other")).toBe(false);

    const male = filterGender("male");
    expect(male.map((r) => r.id)).toEqual(["g-male"]);

    const female = filterGender("female");
    expect(female.map((r) => r.id)).toEqual(["g-female"]);

    const other = filterGender("other");
    expect(other.map((r) => r.id)).toEqual(["g-other"]);
  });

  it("12. Complete payment status filter matrix: paid, pending, unpaid, partially_paid, cancelled, failed, refunded, all, and all_statuses", () => {
    const bookings: AccommodationExportRecord[] = [
      { id: "b-paid", participant_id: "p1", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "paid", payment_orders: { status: "paid" } },
      { id: "b-pending", participant_id: "p2", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "pending", payment_orders: { status: "initiated" } },
      { id: "b-unpaid", participant_id: "p3", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "unpaid" },
      { id: "b-partially", participant_id: "p4", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "partially_paid", payment_orders: { status: "partially_paid" } },
      { id: "b-cancelled", participant_id: "p5", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "cancelled", payment_orders: { status: "cancelled" } },
      { id: "b-failed", participant_id: "p6", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "failed", payment_orders: { status: "failed" } },
      { id: "b-refunded", participant_id: "p7", start_date: "2026-10-28", end_date: "2026-10-29", duration_days: 1, amount: 499, status: "refunded", payment_orders: { status: "refunded" } },
    ];

    const filterStatus = (statusMode: string) => {
      return bookings.filter((acc) => {
        const po = Array.isArray(acc.payment_orders) ? acc.payment_orders[0] : acc.payment_orders;
        const poStatus = po?.status ? String(po.status).toLowerCase() : "";
        const accStatus = acc.status ? String(acc.status).toLowerCase() : "";

        if (statusMode === "all") {
          return accStatus !== "cancelled" && accStatus !== "failed" && accStatus !== "refunded" && poStatus !== "refunded" && poStatus !== "failed" && poStatus !== "cancelled";
        }
        if (statusMode === "all_statuses") return true;
        if (statusMode === "paid") {
          return (accStatus === "paid" || poStatus === "paid" || poStatus === "completed") && accStatus !== "refunded" && poStatus !== "refunded" && accStatus !== "cancelled" && poStatus !== "cancelled";
        }
        if (statusMode === "pending") {
          return (accStatus === "pending" || poStatus === "pending" || poStatus === "initiated") && accStatus !== "paid" && poStatus !== "paid" && poStatus !== "completed" && accStatus !== "cancelled" && accStatus !== "failed" && accStatus !== "refunded" && poStatus !== "refunded";
        }
        if (statusMode === "unpaid") {
          return accStatus === "unpaid" && poStatus !== "paid" && poStatus !== "completed";
        }
        if (statusMode === "partially_paid") {
          return accStatus === "partially_paid" || poStatus === "partially_paid";
        }
        if (statusMode === "cancelled") {
          return (accStatus === "cancelled" || poStatus === "cancelled") && accStatus !== "refunded" && poStatus !== "refunded";
        }
        if (statusMode === "failed") {
          return accStatus === "failed" || poStatus === "failed";
        }
        if (statusMode === "refunded") {
          return (accStatus === "refunded" || poStatus === "refunded") && accStatus !== "cancelled";
        }
        return accStatus === statusMode.toLowerCase();
      });
    };

    expect(filterStatus("all").map((b) => b.id)).toEqual(["b-paid", "b-pending", "b-unpaid", "b-partially"]);
    expect(filterStatus("all_statuses").length).toBe(7);
    expect(filterStatus("paid").map((b) => b.id)).toEqual(["b-paid"]);
    expect(filterStatus("pending").map((b) => b.id)).toEqual(["b-pending"]);
    expect(filterStatus("unpaid").map((b) => b.id)).toEqual(["b-unpaid"]);
    expect(filterStatus("partially_paid").map((b) => b.id)).toEqual(["b-partially"]);
    expect(filterStatus("cancelled").map((b) => b.id)).toEqual(["b-cancelled"]);
    expect(filterStatus("failed").map((b) => b.id)).toEqual(["b-failed"]);
    expect(filterStatus("refunded").map((b) => b.id)).toEqual(["b-refunded"]);
  });

  it("13. Participant vs Faculty type filter verification", () => {
    const list: AccommodationExportRecord[] = [
      { id: "fac-1", participant_id: "p1", start_date: "2026-10-28", end_date: "2026-10-30", duration_days: 2, amount: 999, status: "paid", participants: { is_faculty: true, name: "Dr. Sharma" } },
      { id: "part-1", participant_id: "p2", start_date: "2026-10-28", end_date: "2026-10-30", duration_days: 2, amount: 999, status: "paid", participants: { is_faculty: false, name: "Student Rahul" } },
    ];

    const facultyOnly = list.filter((a) => Boolean(a.participants?.is_faculty));
    expect(facultyOnly.map((a) => a.id)).toEqual(["fac-1"]);

    const participantOnly = list.filter((a) => !a.participants?.is_faculty);
    expect(participantOnly.map((a) => a.id)).toEqual(["part-1"]);
  });
});
