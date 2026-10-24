/**
 * __tests__/admin/registration-group-counts.test.ts
 *
 * Targeted regression tests covering:
 * 1. Multiple event registrations grouped under one primary participant.
 * 2. Accurate group count versus individual event-registration count.
 * 3. Complete registration-ID coverage with no omissions or duplicates.
 * 4. Multiple events and secondary team members within a group.
 * 5. Search and filters preserving the correct underlying event registrations.
 * 6. Registration-level export completeness beyond 1,000 records.
 * 7. Dynamic count wording for both unfiltered and filtered states.
 * 8. Regression case representing the observed 1,085 vs 1,469 discrepancy
 *    without hardcoding values as permanent application constants.
 */

import { describe, it, expect } from "vitest";
import {
  type CsvRegistrationItem,
} from "@/lib/admin/csv-export";
import { buildRegistrationsWorkbook } from "@/lib/admin/excel-export";

// Helper replicating the grouping logic from app/admin/page.tsx
function groupRegistrationsByParticipant<
  T extends {
    participant: { id?: string | null };
    registration: { id?: string | null };
  }
>(items: T[]): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const id = item.participant.id ?? "unknown";
    const existing = map.get(id) ?? [];
    existing.push(item);
    map.set(id, existing);
  }
  return Array.from(map.values());
}

// Strongly-typed fixture factory for complete CsvRegistrationItem records
function createMockRegistrationItem(overrides: {
  participantId?: string;
  pId?: string;
  name?: string;
  email?: string;
  college?: string;
  eventId?: string;
  eventName?: string;
  category?: string;
  registrationId?: string;
  teamName?: string | null;
  paymentStatus?: string;
  members?: CsvRegistrationItem["members"];
}): CsvRegistrationItem {
  const pId = overrides.pId ?? overrides.participantId ?? "p-default";
  return {
    participant: {
      id: pId,
      participant_id: overrides.participantId ?? `SVK26-${pId.toUpperCase()}`,
      name: overrides.name ?? "Test User",
      email: overrides.email ?? `${pId}@example.com`,
      college: overrides.college ?? "CGC University",
    },
    event: {
      name: overrides.eventName ?? "Test Event",
      category: overrides.category ?? "Technical",
      payment_type: "free",
      registration_fee: 0,
    },
    registration: {
      id: overrides.registrationId ?? `reg-${pId}-1`,
      event_id: overrides.eventId ?? "evt-default",
      registration_status: "confirmed",
      payment_status: overrides.paymentStatus ?? "free",
      team_name: overrides.teamName ?? null,
    },
    members: overrides.members ?? [],
  };
}

// Helper replicating the dynamic count summary logic
function formatCountSummary(
  groupCount: number,
  filteredRegistrationsCount: number,
  activeTotal: number,
  activeGroupsTotal: number
): { summary: string; filteredNote: string | null } {
  const summary = `Showing ${groupCount.toLocaleString()} primary participant groups representing ${filteredRegistrationsCount.toLocaleString()} of ${activeTotal.toLocaleString()} active event registrations`;
  const isFiltered = filteredRegistrationsCount !== activeTotal;
  const filteredNote = isFiltered
    ? `(${(activeTotal - filteredRegistrationsCount).toLocaleString()} registrations / ${(activeGroupsTotal - groupCount).toLocaleString()} groups filtered out)`
    : null;
  return { summary, filteredNote };
}

describe("SAVISKAR 2026 — Registrations Table Grouping & Count Integrity", () => {
  // Test 1: Multiple event registrations grouped under one primary participant
  it("groups multiple event registrations under the same primary participant into a single table group", () => {
    const items: CsvRegistrationItem[] = [
      createMockRegistrationItem({
        pId: "p-01",
        participantId: "SVK26-P001",
        name: "Alice Sharma",
        email: "alice@example.com",
        eventName: "Hackathon",
        category: "Technical",
        registrationId: "reg-01",
        eventId: "evt-01",
      }),
      createMockRegistrationItem({
        pId: "p-01",
        participantId: "SVK26-P001",
        name: "Alice Sharma",
        email: "alice@example.com",
        eventName: "RoboRace",
        category: "Technical",
        registrationId: "reg-02",
        eventId: "evt-02",
      }),
      createMockRegistrationItem({
        pId: "p-02",
        participantId: "SVK26-P002",
        name: "Bob Verma",
        email: "bob@example.com",
        eventName: "Dance Battle",
        category: "Cultural",
        registrationId: "reg-03",
        eventId: "evt-03",
      }),
    ];

    const groups = groupRegistrationsByParticipant(items);

    expect(groups.length).toBe(2);
    expect(groups[0].length).toBe(2);
    expect(groups[0][0].participant.id).toBe("p-01");
    expect(groups[0][0].registration.id).toBe("reg-01");
    expect(groups[0][1].registration.id).toBe("reg-02");
    expect(groups[1].length).toBe(1);
    expect(groups[1][0].registration.id).toBe("reg-03");
  });

  // Test 2: Accurate group count vs individual event-registration count
  it("distinguishes group count (table rows) from individual event registration count", () => {
    const items: CsvRegistrationItem[] = [
      createMockRegistrationItem({ pId: "p-1", name: "User 1", eventName: "Event A", registrationId: "r-1" }),
      createMockRegistrationItem({ pId: "p-1", name: "User 1", eventName: "Event B", registrationId: "r-2" }),
      createMockRegistrationItem({ pId: "p-1", name: "User 1", eventName: "Event C", registrationId: "r-3" }),
      createMockRegistrationItem({ pId: "p-2", name: "User 2", eventName: "Event A", registrationId: "r-4" }),
    ];

    const groups = groupRegistrationsByParticipant(items);
    const totalEventRegistrations = items.length;
    const totalGroups = groups.length;

    expect(totalEventRegistrations).toBe(4);
    expect(totalGroups).toBe(2);
    expect(totalGroups).not.toBe(totalEventRegistrations);
  });

  // Test 3: Complete registration-ID coverage with zero omissions and zero duplicates
  it("preserves 100% of registration IDs across table groups without omissions or duplicates", () => {
    const originalIds = new Set<string>();
    const items: CsvRegistrationItem[] = [];

    // Create 100 participants with varying event counts
    for (let p = 1; p <= 100; p++) {
      const eventCount = (p % 3) + 1; // 1, 2, or 3 events
      for (let e = 1; e <= eventCount; e++) {
        const regId = `reg-${p}-${e}`;
        originalIds.add(regId);
        items.push(
          createMockRegistrationItem({
            pId: `p-${p}`,
            name: `User ${p}`,
            eventName: `Event ${e}`,
            registrationId: regId,
            eventId: `evt-${e}`,
          })
        );
      }
    }

    const groups = groupRegistrationsByParticipant(items);

    // Collect all registration IDs from groups
    const collectedIds = new Set<string>();
    let totalCollected = 0;

    for (const group of groups) {
      for (const item of group) {
        expect(collectedIds.has(item.registration.id!)).toBe(false); // No duplicates
        collectedIds.add(item.registration.id!);
        totalCollected++;
      }
    }

    expect(collectedIds.size).toBe(originalIds.size);
    expect(totalCollected).toBe(items.length);

    // Check set difference
    for (const id of originalIds) {
      expect(collectedIds.has(id)).toBe(true);
    }
  });

  // Test 4: Multiple events and secondary team members within a group
  it("maintains secondary team members and event details correctly within grouped rows", () => {
    const items: CsvRegistrationItem[] = [
      createMockRegistrationItem({
        pId: "p-lead",
        name: "Lead Dev",
        email: "lead@cgc.edu",
        eventName: "Hackathon 2026",
        category: "Technical",
        registrationId: "reg-team-01",
        teamName: "CodeWarriors",
        members: [
          {
            id: "m-01",
            name: "Member One",
            participant_id: "SVK26-M01",
            is_team_leader: false,
          },
          {
            id: "m-02",
            name: "Member Two",
            participant_id: "SVK26-M02",
            is_team_leader: false,
          },
        ],
      }),
      createMockRegistrationItem({
        pId: "p-lead",
        name: "Lead Dev",
        email: "lead@cgc.edu",
        eventName: "Solo Code",
        category: "Technical",
        registrationId: "reg-solo-02",
        teamName: null,
        members: [],
      }),
    ];

    const groups = groupRegistrationsByParticipant(items);

    expect(groups.length).toBe(1);
    const group = groups[0];
    expect(group.length).toBe(2);

    // First event is a team event
    expect(group[0].registration.team_name).toBe("CodeWarriors");
    expect(group[0].members).toHaveLength(2);
    expect(group[0].members?.[0].name).toBe("Member One");

    // Second event is a solo event
    expect(group[1].registration.team_name).toBeNull();
    expect(group[1].members).toHaveLength(0);
  });

  // Test 5: Search and filters preserving the correct underlying event registrations
  it("filters registrations by search term without silently dropping matching records", () => {
    const items: CsvRegistrationItem[] = [
      createMockRegistrationItem({
        pId: "p-1",
        name: "Aman Deep",
        email: "aman@gmail.com",
        college: "CGC Jhanjeri",
        eventName: "Web Dev",
        registrationId: "reg-a1",
      }),
      createMockRegistrationItem({
        pId: "p-1",
        name: "Aman Deep",
        email: "aman@gmail.com",
        college: "CGC Jhanjeri",
        eventName: "Gaming",
        registrationId: "reg-a2",
      }),
      createMockRegistrationItem({
        pId: "p-2",
        name: "Rohit Kumar",
        email: "rohit@gmail.com",
        college: "IIT",
        eventName: "Robotics",
        registrationId: "reg-r1",
      }),
    ];

    // Filter by participant name
    const filterQuery = "aman";
    const filtered = items.filter((item) =>
      item.participant.name?.toLowerCase().includes(filterQuery)
    );

    expect(filtered.length).toBe(2);
    const filteredGroups = groupRegistrationsByParticipant(filtered);
    expect(filteredGroups.length).toBe(1);
    expect(filteredGroups[0].map((i) => i.registration.id)).toEqual(["reg-a1", "reg-a2"]);
  });

  // Test 6: Registration-level export completeness beyond 1,000 records
  it("exports individual registration records with complete coverage beyond 1,000 items", async () => {
    const largeDataset: CsvRegistrationItem[] = [];

    // Generate 1,469 registration items across 1,085 participants
    let regCounter = 1;
    for (let p = 1; p <= 1085; p++) {
      const count = p <= 384 ? 2 : 1;
      for (let e = 1; e <= count; e++) {
        largeDataset.push(
          createMockRegistrationItem({
            pId: `p-${p}`,
            participantId: `SVK26-P${p.toString().padStart(4, "0")}`,
            name: `Participant ${p}`,
            email: `user${p}@example.com`,
            eventName: `Event ${e}`,
            category: "Technical",
            registrationId: `reg-${regCounter}`,
            eventId: `evt-${e}`,
            paymentStatus: "free",
          })
        );
        regCounter++;
      }
    }

    expect(largeDataset.length).toBe(1469);

    // Build the registrations workbook
    const workbook = buildRegistrationsWorkbook(largeDataset);
    const allSheet = workbook.getWorksheet("All Registrations");
    expect(allSheet).toBeDefined();

    // ExcelJS header is row 1, data rows are 2 to 1470 (1469 rows)
    expect(allSheet!.rowCount).toBe(1470);

    // Verify row 2 (first data row) and row 1470 (last data row)
    // Cell 1 is Sr. No., Cell 2 is Participant ID, Cell 3 is Participant Name
    const firstRowSrNo = allSheet!.getRow(2).getCell(1).value;
    const firstRowPartId = allSheet!.getRow(2).getCell(2).value;
    const lastRowSrNo = allSheet!.getRow(1470).getCell(1).value;
    const lastRowPartId = allSheet!.getRow(1470).getCell(2).value;

    expect(firstRowSrNo).toBe(1);
    expect(firstRowPartId).toBe("SVK26-P0001");
    expect(lastRowSrNo).toBe(1469);
    expect(lastRowPartId).toBe("SVK26-P1085");
  });

  // Test 7: Dynamic count wording for both unfiltered and filtered states
  it("formats dynamic count text accurately for unfiltered and filtered states", () => {
    // Unfiltered state (e.g. 1,085 groups representing 1,469 registrations)
    const unfiltered = formatCountSummary(1085, 1469, 1469, 1085);
    expect(unfiltered.summary).toBe(
      "Showing 1,085 primary participant groups representing 1,469 of 1,469 active event registrations"
    );
    expect(unfiltered.filteredNote).toBeNull();

    // Filtered state (e.g. searching for a college leaves 200 groups representing 260 registrations)
    const filtered = formatCountSummary(200, 260, 1469, 1085);
    expect(filtered.summary).toBe(
      "Showing 200 primary participant groups representing 260 of 1,469 active event registrations"
    );
    expect(filtered.filteredNote).toBe(
      "(1,209 registrations / 885 groups filtered out)"
    );
  });

  // Test 8: Deterministic regression model simulating the observed 1,085 vs 1,469 distribution
  it("mathematically reconciles the 1,085 participant groups and 1,469 event registrations", () => {
    const distribution = [
      { count: 907, eventsPerParticipant: 1 },
      { count: 103, eventsPerParticipant: 2 },
      { count: 36, eventsPerParticipant: 3 },
      { count: 17, eventsPerParticipant: 4 },
      { count: 8, eventsPerParticipant: 5 },
      { count: 5, eventsPerParticipant: 6 },
      { count: 4, eventsPerParticipant: 7 },
      { count: 1, eventsPerParticipant: 9 },
      { count: 1, eventsPerParticipant: 14 },
      { count: 1, eventsPerParticipant: 18 },
      { count: 1, eventsPerParticipant: 19 },
      { count: 1, eventsPerParticipant: 22 },
    ];

    let totalCalculatedParticipants = 0;
    let totalCalculatedRegistrations = 0;

    const mockDataset: { participant: { id: string }; registration: { id: string } }[] = [];
    let pIdCounter = 1;
    let rIdCounter = 1;

    for (const tier of distribution) {
      totalCalculatedParticipants += tier.count;
      totalCalculatedRegistrations += tier.count * tier.eventsPerParticipant;

      for (let i = 0; i < tier.count; i++) {
        const participantId = `p-${pIdCounter++}`;
        for (let j = 0; j < tier.eventsPerParticipant; j++) {
          mockDataset.push({
            participant: { id: participantId },
            registration: { id: `r-${rIdCounter++}` },
          });
        }
      }
    }

    expect(totalCalculatedParticipants).toBe(1085);
    expect(totalCalculatedRegistrations).toBe(1469);
    expect(mockDataset.length).toBe(1469);

    const grouped = groupRegistrationsByParticipant(mockDataset);
    expect(grouped.length).toBe(1085);

    // Verify serial numbers end at 1,085 (grouped.length)
    const lastSerialNumber = grouped.length;
    expect(lastSerialNumber).toBe(1085);

    // Verify all 1,469 registration IDs exist
    const uniqueRegIds = new Set(grouped.flatMap((g) => g.map((item) => item.registration.id)));
    expect(uniqueRegIds.size).toBe(1469);
  });
});
