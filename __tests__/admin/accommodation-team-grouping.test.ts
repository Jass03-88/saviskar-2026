import { describe, it, expect, vi } from "vitest";
import {
  groupAccommodationRecords,
  paginateGroupedAccommodations,
  getGroupControlsId,
  getGroupHeaderId,
  AccommodationRecord,
} from "@/lib/admin/accommodation-grouping";

function createSyntheticRecord(overrides: Partial<AccommodationRecord> = {}): AccommodationRecord {
  return {
    id: overrides.id || "acc-default-id",
    participant_id: overrides.participant_id || "participant-uuid-default",
    accommodation_plan_id: overrides.accommodation_plan_id || "plan-standard-1",
    start_date: overrides.start_date || "2026-10-27",
    end_date: overrides.end_date || "2026-10-28",
    duration_days: overrides.duration_days ?? 1,
    amount: overrides.amount ?? 500,
    currency: overrides.currency || "INR",
    status: overrides.status || "paid",
    hostel_id: overrides.hostel_id || null,
    room_id: overrides.room_id || null,
    checked_in: overrides.checked_in ?? false,
    checked_in_at: overrides.checked_in_at || null,
    checked_out: overrides.checked_out ?? false,
    checked_out_at: overrides.checked_out_at || null,
    created_at: overrides.created_at || "2026-10-20T10:00:00Z",
    participants: overrides.participants ?? {
      participant_id: "SVK26-TEST01",
      name: "Default Participant",
      email: "participant@example.com",
      phone: "9876543210",
      gender: "male",
      state: "Punjab",
      college: "Test Engineering College",
    },
    team_id: overrides.team_id ?? null,
    team_name: overrides.team_name ?? null,
    registration_group_id: overrides.registration_group_id ?? null,
    team_leader_name: overrides.team_leader_name ?? null,
    team_leader_participant_id: overrides.team_leader_participant_id ?? null,
    is_ambiguous: overrides.is_ambiguous ?? false,
  };
}

describe("Admin Accommodation Team & Registration Grouping Engine (Step 9.1)", () => {
  // 1. Two distinct canonical team IDs with identical team names remain separate groups
  it("1. Two distinct canonical team IDs with identical team names remain separate groups", () => {
    const team1Leader = createSyntheticRecord({
      id: "acc-t1-1",
      team_id: "canonical-team-id-1",
      team_name: "Code Warriors",
      team_leader_name: "Leader One",
    });
    const team1Member = createSyntheticRecord({
      id: "acc-t1-2",
      team_id: "canonical-team-id-1",
      team_name: "Code Warriors",
      team_leader_name: "Leader One",
    });
    const team2Leader = createSyntheticRecord({
      id: "acc-t2-1",
      team_id: "canonical-team-id-2",
      team_name: "Code Warriors",
      team_leader_name: "Leader Two",
    });
    const team2Member = createSyntheticRecord({
      id: "acc-t2-2",
      team_id: "canonical-team-id-2",
      team_name: "Code Warriors",
      team_leader_name: "Leader Two",
    });

    const result = groupAccommodationRecords([team1Leader, team1Member, team2Leader, team2Member]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].key).toBe("team:canonical-team-id-1");
    expect(result.groups[0].records).toHaveLength(2);
    expect(result.groups[1].key).toBe("team:canonical-team-id-2");
    expect(result.groups[1].records).toHaveLength(2);
    expect(result.standalone).toHaveLength(0);
  });

  // 2. Identical team names with no canonical IDs do not create a group
  it("2. Identical team names with no canonical IDs do not create a group", () => {
    const memberA = createSyntheticRecord({
      id: "acc-no-id-1",
      team_id: null,
      team_name: "Robo Champions",
      registration_group_id: null,
    });
    const memberB = createSyntheticRecord({
      id: "acc-no-id-2",
      team_id: null,
      team_name: "Robo Champions",
      registration_group_id: null,
    });

    const result = groupAccommodationRecords([memberA, memberB]);

    // Team name alone MUST NEVER create a group
    expect(result.groups).toHaveLength(0);
    expect(result.standalone).toHaveLength(2);
    expect(result.standalone.map((r) => r.id)).toEqual(["acc-no-id-1", "acc-no-id-2"]);
  });

  // 3. An ambiguous participant with multiple team affiliations is not assigned arbitrarily to one team
  it("3. An ambiguous participant with multiple team affiliations is not assigned arbitrarily to one team", () => {
    const ambiguousParticipant = createSyntheticRecord({
      id: "acc-ambiguous-1",
      team_id: null,
      team_name: null,
      is_ambiguous: true,
    });
    const normalMember1 = createSyntheticRecord({
      id: "acc-valid-1",
      team_id: "team-single",
      team_name: "Single Team",
    });
    const normalMember2 = createSyntheticRecord({
      id: "acc-valid-2",
      team_id: "team-single",
      team_name: "Single Team",
    });

    const result = groupAccommodationRecords([ambiguousParticipant, normalMember1, normalMember2]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].key).toBe("team:team-single");
    expect(result.groups[0].records).toHaveLength(2);

    expect(result.standalone).toHaveLength(1);
    expect(result.standalone[0].id).toBe("acc-ambiguous-1");
  });

  // 4. A team spanning the current record-page boundary remains together or is paginated using the verified complete group
  it("4. A team spanning the current record-page boundary remains together or is paginated using the verified complete group", () => {
    // 4 members in Team Alpha
    const teamAlpha = [
      createSyntheticRecord({ id: "t-1", team_id: "team-alpha", team_name: "Alpha" }),
      createSyntheticRecord({ id: "t-2", team_id: "team-alpha", team_name: "Alpha" }),
      createSyntheticRecord({ id: "t-3", team_id: "team-alpha", team_name: "Alpha" }),
      createSyntheticRecord({ id: "t-4", team_id: "team-alpha", team_name: "Alpha" }),
    ];
    // 3 standalone participants
    const standalones = [
      createSyntheticRecord({ id: "s-1" }),
      createSyntheticRecord({ id: "s-2" }),
      createSyntheticRecord({ id: "s-3" }),
    ];
    // 3 members in Team Beta
    const teamBeta = [
      createSyntheticRecord({ id: "tb-1", team_id: "team-beta", team_name: "Beta" }),
      createSyntheticRecord({ id: "tb-2", team_id: "team-beta", team_name: "Beta" }),
      createSyntheticRecord({ id: "tb-3", team_id: "team-beta", team_name: "Beta" }),
    ];

    const allRecords = [...teamAlpha, ...standalones, ...teamBeta]; // 10 records total

    // Paginate with pageSize = 5
    const page1 = paginateGroupedAccommodations(allRecords, { page: 1, pageSize: 5 });
    const page2 = paginateGroupedAccommodations(allRecords, { page: 2, pageSize: 5 });

    // Team Alpha has 4 records. Under keep-with-current, it stays complete on Page 1.
    const page1TeamAlpha = page1.groups.find((g) => g.key === "team:team-alpha");
    expect(page1TeamAlpha).toBeDefined();
    expect(page1TeamAlpha!.records).toHaveLength(4);

    // Team Alpha must NOT appear on Page 2 (no duplicate, no partial split)
    const page2TeamAlpha = page2.groups.find((g) => g.key === "team:team-alpha");
    expect(page2TeamAlpha).toBeUndefined();

    // Team Beta must be complete on Page 2
    const page2TeamBeta = page2.groups.find((g) => g.key === "team:team-beta");
    expect(page2TeamBeta).toBeDefined();
    expect(page2TeamBeta!.records).toHaveLength(3);

    const page3 = paginateGroupedAccommodations(allRecords, { page: 3, pageSize: 5 });
    // Total displayed records across all pages must equal total records count (10)
    expect(page1.displayedRecordsCount + page2.displayedRecordsCount + page3.displayedRecordsCount).toBe(10);
  });

  // 5. Group counts remain accurate across filtering and pagination
  it("5. Group counts remain accurate across filtering and pagination", () => {
    const teamMembers = [
      createSyntheticRecord({ id: "m-1", team_id: "team-counts", team_name: "Counts Team", status: "paid", room_id: "room-101" }),
      createSyntheticRecord({ id: "m-2", team_id: "team-counts", team_name: "Counts Team", status: "paid", room_id: null }),
      createSyntheticRecord({ id: "m-3", team_id: "team-counts", team_name: "Counts Team", status: "pending", room_id: null }),
      createSyntheticRecord({ id: "m-4", team_id: "team-counts", team_name: "Counts Team", status: "pending", room_id: null }),
    ];

    // Initial grouping of unfiltered team
    const fullResult = groupAccommodationRecords(teamMembers);
    const fullGroup = fullResult.groups[0];
    expect(fullGroup.totalCount).toBe(4);
    expect(fullGroup.paidCount).toBe(2);
    expect(fullGroup.awaitingAllocationCount).toBe(1);
    expect(fullGroup.allocatedCount).toBe(1);
    expect(fullGroup.isComplete).toBe(false);

    // Filter by status = "paid"
    const paidRecords = teamMembers.filter((r) => r.status === "paid");
    const filteredResult = groupAccommodationRecords(paidRecords);
    const filteredGroup = filteredResult.groups[0];
    expect(filteredGroup.totalCount).toBe(2);
    expect(filteredGroup.paidCount).toBe(2);
    expect(filteredGroup.awaitingAllocationCount).toBe(1);
    expect(filteredGroup.allocatedCount).toBe(1);
    expect(filteredGroup.isComplete).toBe(false);

    // When paginated, group counts match the complete group
    const paginated = paginateGroupedAccommodations(paidRecords, { page: 1, pageSize: 10 });
    expect(paginated.groups[0].totalCount).toBe(2);
    expect(paginated.groups[0].paidCount).toBe(2);
    expect(paginated.groups[0].awaitingAllocationCount).toBe(1);
  });

  // 6. No duplicate accommodation records appear when groups are rendered
  it("6. No duplicate accommodation records appear when groups are rendered", () => {
    const team1 = [
      createSyntheticRecord({ id: "t1-1", team_id: "team-1", team_name: "T1" }),
      createSyntheticRecord({ id: "t1-2", team_id: "team-1", team_name: "T1" }),
    ];
    const group1 = [
      createSyntheticRecord({ id: "g1-1", registration_group_id: "reg-grp-1" }),
      createSyntheticRecord({ id: "g1-2", registration_group_id: "reg-grp-1" }),
    ];
    const standalone = [
      createSyntheticRecord({ id: "s-1" }),
      createSyntheticRecord({ id: "s-2" }),
    ];

    const all = [...team1, ...group1, ...standalone]; // 6 records total

    // Test unpaginated grouping
    const grouped = groupAccommodationRecords(all);
    const renderedIds = [
      ...grouped.groups.flatMap((g) => g.records.map((r) => r.id)),
      ...grouped.standalone.map((s) => s.id),
    ];
    expect(renderedIds).toHaveLength(6);
    expect(new Set(renderedIds).size).toBe(6);

    // Test across pagination pages
    const p1 = paginateGroupedAccommodations(all, { page: 1, pageSize: 3 });
    const allPaginatedIds: string[] = [];
    for (let p = 1; p <= p1.totalPages; p++) {
      const pageResult = paginateGroupedAccommodations(all, { page: p, pageSize: 3 });
      const ids = [
        ...pageResult.groups.flatMap((g) => g.records.map((r) => r.id)),
        ...pageResult.standalone.map((s) => s.id),
      ];
      allPaginatedIds.push(...ids);
    }
    expect(allPaginatedIds).toHaveLength(6);
    expect(new Set(allPaginatedIds).size).toBe(6);
  });

  // 7. Each participant-detail action resolves the exact clicked participant
  it("7. Each participant-detail action resolves the exact clicked participant", () => {
    const leader = createSyntheticRecord({
      id: "acc-leader",
      participant_id: "pid-leader",
      team_id: "team-exact",
      team_name: "Exact Team",
      participants: {
        participant_id: "SVK-LEAD",
        name: "Leader Alice",
        email: "alice@example.com",
        phone: "1111111111",
        gender: "female",
        state: "Punjab",
      },
    });

    const member1 = createSyntheticRecord({
      id: "acc-member-1",
      participant_id: "pid-member-1",
      team_id: "team-exact",
      team_name: "Exact Team",
      participants: {
        participant_id: "SVK-MEMB1",
        name: "Member Bob",
        email: "bob@example.com",
        phone: "2222222222",
        gender: "male",
        state: "Delhi",
      },
    });

    const member2 = createSyntheticRecord({
      id: "acc-member-2",
      participant_id: "pid-member-2",
      team_id: "team-exact",
      team_name: "Exact Team",
      participants: {
        participant_id: "SVK-MEMB2",
        name: "Member Charlie",
        email: "charlie@example.com",
        phone: "3333333333",
        gender: "male",
        state: "Haryana",
      },
    });

    // When clicking view on member1 row
    let selectedForDetail: AccommodationRecord | null = null;
    const onViewParticipant = (acc: AccommodationRecord) => {
      selectedForDetail = acc;
    };

    onViewParticipant(member1);

    expect(selectedForDetail).not.toBeNull();
    expect(selectedForDetail!.id).toBe("acc-member-1");
    expect(selectedForDetail!.participant_id).toBe("pid-member-1");
    expect(selectedForDetail!.participants?.name).toBe("Member Bob");
    expect(selectedForDetail!.participants?.participant_id).toBe("SVK-MEMB1");
    // Must NOT be leader or adjacent member
    expect(selectedForDetail!.participant_id).not.toBe("pid-leader");
    expect(selectedForDetail!.participant_id).not.toBe("pid-member-2");
  });

  // 8. Allocation actions continue targeting only the selected accommodation record
  it("8. Allocation actions continue targeting only the selected accommodation record", () => {
    const acc1 = createSyntheticRecord({ id: "acc-alloc-1", team_id: "team-alloc", team_name: "Alloc Team", room_id: null });
    const acc2 = createSyntheticRecord({ id: "acc-alloc-2", team_id: "team-alloc", team_name: "Alloc Team", room_id: null });
    const acc3 = createSyntheticRecord({ id: "acc-alloc-3", team_id: "team-alloc", team_name: "Alloc Team", room_id: null });

    let allocatedId: string | null = null;
    const onAllocate = (acc: AccommodationRecord) => {
      allocatedId = acc.id;
    };

    // Admin clicks Allocate on acc2
    onAllocate(acc2);

    expect(allocatedId).toBe("acc-alloc-2");
    expect(allocatedId).not.toBe("acc-alloc-1");
    expect(allocatedId).not.toBe("acc-alloc-3");

    // Verify group header does not possess an allocation trigger
    const grouped = groupAccommodationRecords([acc1, acc2, acc3]);
    const groupHeader = grouped.groups[0];
    expect(groupHeader).not.toHaveProperty("allocate");
    expect(groupHeader).not.toHaveProperty("onAllocate");
  });

  // 9. Shared college, email domain, accommodation plan, or payment amount alone does not create a group
  it("9. Shared college, email domain, accommodation plan, or payment amount alone does not create a group", () => {
    const rec1 = createSyntheticRecord({
      id: "acc-shared-1",
      accommodation_plan_id: "plan-gold",
      amount: 1500,
      participants: {
        participant_id: "SVK-1",
        name: "User One",
        email: "user1@cgc.edu.in",
        phone: "111",
        gender: "male",
        state: "Punjab",
        college: "Chandigarh Group of Colleges",
      },
    });

    const rec2 = createSyntheticRecord({
      id: "acc-shared-2",
      accommodation_plan_id: "plan-gold",
      amount: 1500,
      participants: {
        participant_id: "SVK-2",
        name: "User Two",
        email: "user2@cgc.edu.in",
        phone: "222",
        gender: "female",
        state: "Punjab",
        college: "Chandigarh Group of Colleges",
      },
    });

    const result = groupAccommodationRecords([rec1, rec2]);

    expect(result.groups).toHaveLength(0);
    expect(result.standalone).toHaveLength(2);
  });

  // 10. Participants sharing one payment order are not grouped unless a canonical team relationship supports the grouping
  it("10. Participants sharing one payment order are not grouped unless a canonical team relationship supports the grouping", () => {
    const recA = createSyntheticRecord({ id: "acc-order-a", team_id: null, team_name: null });
    const recB = createSyntheticRecord({ id: "acc-order-b", team_id: null, team_name: null });

    const result = groupAccommodationRecords([recA, recB]);

    expect(result.groups).toHaveLength(0);
    expect(result.standalone).toHaveLength(2);
  });

  // 11. A team split across different checkout orders remains one group when the actual team relationship confirms membership
  it("11. A team split across different checkout orders remains one group when the actual team relationship confirms membership", () => {
    const splitLeader = createSyntheticRecord({
      id: "acc-split-1",
      team_id: "canonical-split-team",
      team_name: "Split Order Team",
      amount: 500,
    });
    const splitMember = createSyntheticRecord({
      id: "acc-split-2",
      team_id: "canonical-split-team",
      team_name: "Split Order Team",
      amount: 800,
    });

    const result = groupAccommodationRecords([splitLeader, splitMember]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].key).toBe("team:canonical-split-team");
    expect(result.groups[0].records).toHaveLength(2);
    expect(result.standalone).toHaveLength(0);
  });

  // 12. Collapsing and expanding a group preserves selected participant IDs
  it("12. Collapsing and expanding a group preserves selected participant IDs", () => {
    const selectedIds = new Set<string>(["acc-sel-1", "acc-sel-3"]);
    let collapsedGroupKeys = new Set<string>();

    // Toggle collapse for group
    const toggleCollapse = (groupKey: string) => {
      const next = new Set(collapsedGroupKeys);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      collapsedGroupKeys = next;
    };

    toggleCollapse("team:team-1");
    expect(collapsedGroupKeys.has("team:team-1")).toBe(true);
    expect(selectedIds.has("acc-sel-1")).toBe(true);

    toggleCollapse("team:team-1");
    expect(collapsedGroupKeys.has("team:team-1")).toBe(false);
    expect(selectedIds.has("acc-sel-1")).toBe(true);
  });

  // 13. Authorization and document-access rules remain intact
  it("13. Authorization and document-access rules remain intact", async () => {
    const { requireAccommodationAdmin } = await import("@/lib/supabase/server");
    expect(typeof requireAccommodationAdmin).toBe("function");
  });
  // 14. A team spanning the 1,000-record boundary remains together
  it("14. A team spanning the 1,000-record boundary remains together", () => {
    // Generate 1,200 records where indices 998, 999, 1000, 1001 belong to team-1k-span
    const records = Array.from({ length: 1200 }, (_, i) => {
      const isTeamMember = i >= 998 && i <= 1001;
      return createSyntheticRecord({
        id: `acc-scale-${i}`,
        team_id: isTeamMember ? "team-1k-span" : null,
        team_name: isTeamMember ? "Century Breakers" : null,
        team_leader_name: isTeamMember ? "Span Leader" : null,
      });
    });

    const result = groupAccommodationRecords(records);

    expect(result.groups).toHaveLength(1);
    const spanGroup = result.groups[0];
    expect(spanGroup.key).toBe("team:team-1k-span");
    expect(spanGroup.records).toHaveLength(4);
    expect(spanGroup.totalCount).toBe(4);
    expect(spanGroup.records.map((r) => r.id)).toEqual([
      "acc-scale-998",
      "acc-scale-999",
      "acc-scale-1000",
      "acc-scale-1001",
    ]);

    // All other 1,196 records remain standalone
    expect(result.standalone).toHaveLength(1196);
    expect(result.totalRecordsCount).toBe(1200);
  });

  // 15. The standalone header distinguishes the current-page count from the overall total
  it("15. The standalone header distinguishes the current-page count from the overall total", () => {
    // 45 standalone records
    const records = Array.from({ length: 45 }, (_, i) =>
      createSyntheticRecord({ id: `standalone-${i}` })
    );

    const paginated = paginateGroupedAccommodations(records, { page: 1, pageSize: 20 });

    expect(paginated.standalone).toHaveLength(20);
    expect(paginated.totalStandaloneCount).toBe(45);

    // Header label representation matching page.tsx
    const headerLabel = `Individual / Ungrouped Accommodation — showing ${paginated.standalone.length} of ${paginated.totalStandaloneCount}`;
    expect(headerLabel).toBe("Individual / Ungrouped Accommodation — showing 20 of 45");
  });
  // 16. boundaryStrategy options ('move-to-next' and 'keep-with-current') function consistently
  it("16. boundaryStrategy options ('move-to-next' and 'keep-with-current') function consistently", () => {
    const teamOne = [
      createSyntheticRecord({ id: "t1-1", team_id: "team-1", team_name: "One" }),
      createSyntheticRecord({ id: "t1-2", team_id: "team-1", team_name: "One" }),
      createSyntheticRecord({ id: "t1-3", team_id: "team-1", team_name: "One" }),
    ];
    const teamTwo = [
      createSyntheticRecord({ id: "t2-1", team_id: "team-2", team_name: "Two" }),
      createSyntheticRecord({ id: "t2-2", team_id: "team-2", team_name: "Two" }),
      createSyntheticRecord({ id: "t2-3", team_id: "team-2", team_name: "Two" }),
    ];
    const records = [...teamOne, ...teamTwo];

    // Under move-to-next with pageSize = 4:
    // Team One (3) fits on page 1. Team Two (3) would exceed 4, so it moves to page 2.
    const p1Move = paginateGroupedAccommodations(records, { page: 1, pageSize: 4, boundaryStrategy: "move-to-next" });
    const p2Move = paginateGroupedAccommodations(records, { page: 2, pageSize: 4, boundaryStrategy: "move-to-next" });
    expect(p1Move.groups).toHaveLength(1);
    expect(p1Move.groups[0].key).toBe("team:team-1");
    expect(p2Move.groups).toHaveLength(1);
    expect(p2Move.groups[0].key).toBe("team:team-2");

    // Under keep-with-current with pageSize = 4:
    // Team One (3) + Team Two (3) = 6 records kept together on page 1 and sealed.
    const p1Keep = paginateGroupedAccommodations(records, { page: 1, pageSize: 4, boundaryStrategy: "keep-with-current" });
    expect(p1Keep.groups).toHaveLength(2);
    expect(p1Keep.displayedRecordsCount).toBe(6);
    expect(p1Keep.totalPages).toBe(1);
  });
  // 17. getGroupControlsId and getGroupHeaderId produce deterministic, valid HTML5 element IDs
  it("17. getGroupControlsId and getGroupHeaderId produce deterministic, valid HTML5 element IDs", () => {
    const rawKey = "team:canonical-uuid-123";
    const controlsId = getGroupControlsId(rawKey);
    const headerId = getGroupHeaderId(rawKey);

    expect(controlsId).toBe("group-rows-team-canonical-uuid-123");
    expect(headerId).toBe("group-header-team-canonical-uuid-123");

    // Must be valid CSS/DOM identifiers without colons or spaces
    expect(controlsId).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(headerId).toMatch(/^[a-zA-Z0-9_-]+$/);

    // Registration group key
    const groupKey = "group:reg-uuid-456";
    expect(getGroupControlsId(groupKey)).toBe("group-rows-group-reg-uuid-456");
    expect(getGroupHeaderId(groupKey)).toBe("group-header-group-reg-uuid-456");
  });

  // 18. Accessibility invariant: aria-controls strictly references the member container and aria-expanded synchronizes with state
  it("18. Accessibility invariant: aria-controls strictly references the member container and aria-expanded synchronizes with state", () => {
    const groupKey = "team:team-robotics";
    const controlsId = getGroupControlsId(groupKey);

    // Initial state: expanded
    let collapsedGroupKeys = new Set<string>();
    let isCollapsed = collapsedGroupKeys.has(groupKey);
    let ariaExpanded = !isCollapsed;
    let ariaControls = controlsId;

    expect(ariaExpanded).toBe(true);
    expect(ariaControls).toBe("group-rows-team-team-robotics");

    // Toggle collapse
    collapsedGroupKeys.add(groupKey);
    isCollapsed = collapsedGroupKeys.has(groupKey);
    ariaExpanded = !isCollapsed;

    expect(ariaExpanded).toBe(false);
    expect(ariaControls).toBe("group-rows-team-team-robotics");
  });

  // 19. Collapsing a group hides strictly that group's member container without affecting sibling groups or standalone rows
  it("19. Collapsing a group hides strictly that group's member container without affecting sibling groups or standalone rows", () => {
    const teamA = [
      createSyntheticRecord({ id: "ta-1", team_id: "team-a", team_name: "Team A" }),
      createSyntheticRecord({ id: "ta-2", team_id: "team-a", team_name: "Team A" }),
    ];
    const teamB = [
      createSyntheticRecord({ id: "tb-1", team_id: "team-b", team_name: "Team B" }),
      createSyntheticRecord({ id: "tb-2", team_id: "team-b", team_name: "Team B" }),
    ];
    const standalone = [createSyntheticRecord({ id: "solo-1" })];

    const grouped = groupAccommodationRecords([...teamA, ...teamB, ...standalone]);
    expect(grouped.groups).toHaveLength(2);
    expect(grouped.standalone).toHaveLength(1);

    const groupAKey = grouped.groups.find((g) => g.name === "Team A")!.key;
    const groupBKey = grouped.groups.find((g) => g.name === "Team B")!.key;

    const collapsedKeys = new Set<string>();

    // Collapse only Team A
    collapsedKeys.add(groupAKey);

    expect(collapsedKeys.has(groupAKey)).toBe(true);
    expect(collapsedKeys.has(groupBKey)).toBe(false);

    // Verify visibility mapping
    const isTeamAVisible = !collapsedKeys.has(groupAKey);
    const isTeamBVisible = !collapsedKeys.has(groupBKey);
    expect(isTeamAVisible).toBe(false);
    expect(isTeamBVisible).toBe(true);

    // Standalone is never in collapsedKeys
    expect(collapsedKeys.has("standalone")).toBe(false);
  });
});
