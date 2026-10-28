/**
 * Saviskar 2026 — Admin Accommodation Team & Registration Grouping Engine
 *
 * Provides pure, deterministic grouping and group-aware pagination logic
 * for the Admin Accommodation Management UI.
 *
 * Invariants:
 * 1. Only verified canonical identifiers (canonical team_id from participant_events
 *    or canonical registration_group_id) group records together.
 * 2. Team name alone NEVER creates a group without a verified canonical identifier.
 * 3. Ambiguous participants with multiple team affiliations are never arbitrarily
 *    assigned to a team; they safely fall back to standalone display.
 * 4. A single accommodation record is NEVER duplicated across multiple groups.
 * 5. Standalone/unlinked participants are never merged into fictional teams.
 * 6. Shared college, email domain, accommodation plan, timestamps, or payment order alone
 *    DO NOT create a group.
 * 7. Group-aware pagination ensures verified team records remain together and are never
 *    split into partial misleading groups across page boundaries.
 * 8. Allocation actions remain strictly individual; group headers are disclosure-only.
 */

export interface ParticipantDetails {
  participant_id: string;
  name: string;
  email: string;
  phone: string;
  gender: string;
  state: string;
  college?: string | null;
  is_faculty?: boolean;
}

export interface AccommodationRecord {
  id: string;
  participant_id: string;
  accommodation_plan_id: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  amount: number;
  currency: string;
  status: string;
  hostel_id: string | null;
  room_id: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  checked_out: boolean;
  checked_out_at: string | null;
  created_at: string;
  participants: ParticipantDetails | null;
  // Canonical Team / Registration Group identifiers
  team_id?: string | null;
  team_name?: string | null;
  registration_group_id?: string | null;
  team_leader_name?: string | null;
  team_leader_participant_id?: string | null;
  is_ambiguous?: boolean;
}

export interface AccommodationGroup {
  key: string;
  name: string;
  leaderName: string | null;
  leaderParticipantId: string | null;
  records: AccommodationRecord[];
  totalCount: number;
  paidCount: number;
  awaitingAllocationCount: number;
  allocatedCount: number;
  isComplete: boolean;
}

export interface GroupedAccommodationsResult {
  groups: AccommodationGroup[];
  standalone: AccommodationRecord[];
  totalRecordsCount: number;
  totalGroupsCount: number;
  totalStandaloneCount: number;
}

export interface GroupAwarePaginationOptions {
  page?: number;
  pageSize?: number;
  boundaryStrategy?: "keep-with-current" | "move-to-next";
}

export interface PaginatedGroupedResult {
  groups: AccommodationGroup[];
  standalone: AccommodationRecord[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalRecordsCount: number;
  totalGroupsCount: number;
  totalStandaloneCount: number;
  displayedRecordsCount: number;
}

/**
 * Groups accommodation records using only verified canonical persistent identifiers.
 * Rejects team_name alone as a grouping key.
 */
export function groupAccommodationRecords(records: AccommodationRecord[]): GroupedAccommodationsResult {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      groups: [],
      standalone: [],
      totalRecordsCount: 0,
      totalGroupsCount: 0,
      totalStandaloneCount: 0,
    };
  }

  const groupsMap = new Map<
    string,
    {
      key: string;
      name: string;
      leaderName: string | null;
      leaderParticipantId: string | null;
      records: AccommodationRecord[];
      explicitTeam: boolean;
    }
  >();

  const candidateStandalone: AccommodationRecord[] = [];

  for (const acc of records) {
    // Ambiguous records or missing canonical IDs safely fall back to standalone
    if (acc.is_ambiguous) {
      candidateStandalone.push(acc);
      continue;
    }

    const rawTeamId = (acc.team_id || "").trim();
    const rawGroupId = (acc.registration_group_id || "").trim();
    const rawTeamName = (acc.team_name || "").trim();

    let groupKey: string | null = null;
    let displayName = "";
    let isExplicitTeam = false;

    // RULE: Use ONLY verified canonical persistent identifiers (team_id or registration_group_id).
    // NEVER use team_name alone as a grouping key without a canonical team_id.
    if (rawTeamId) {
      groupKey = `team:${rawTeamId}`;
      displayName = rawTeamName || `Team ${rawTeamId.slice(0, 8)}`;
      isExplicitTeam = true;
    } else if (rawGroupId) {
      groupKey = `group:${rawGroupId}`;
      displayName = rawTeamName || `Registration Group ${rawGroupId.slice(0, 8)}`;
      isExplicitTeam = false;
    }

    if (groupKey) {
      const existing = groupsMap.get(groupKey);
      if (existing) {
        existing.records.push(acc);
        if (!existing.leaderName && acc.team_leader_name) {
          existing.leaderName = acc.team_leader_name;
          existing.leaderParticipantId = acc.team_leader_participant_id || null;
        }
      } else {
        groupsMap.set(groupKey, {
          key: groupKey,
          name: displayName,
          leaderName: acc.team_leader_name || null,
          leaderParticipantId: acc.team_leader_participant_id || null,
          records: [acc],
          explicitTeam: isExplicitTeam,
        });
      }
    } else {
      // No verified canonical identifier: standalone individual record
      candidateStandalone.push(acc);
    }
  }

  const finalGroups: AccommodationGroup[] = [];
  const finalStandalone: AccommodationRecord[] = [...candidateStandalone];

  for (const group of groupsMap.values()) {
    // If an anonymous registration group (without a verified team event) only has 1 record,
    // it was a solo participant checkout session: display standalone.
    if (!group.explicitTeam && group.records.length === 1) {
      finalStandalone.push(...group.records);
      continue;
    }

    const paidCount = group.records.filter((r) => r.status === "paid").length;
    const awaitingAllocationCount = group.records.filter(
      (r) => r.status === "paid" && !r.room_id
    ).length;
    const allocatedCount = group.records.filter(
      (r) => r.status === "paid" && Boolean(r.room_id)
    ).length;
    const isComplete = paidCount > 0 && awaitingAllocationCount === 0;

    finalGroups.push({
      key: group.key,
      name: group.name,
      leaderName: group.leaderName,
      leaderParticipantId: group.leaderParticipantId,
      records: group.records,
      totalCount: group.records.length,
      paidCount,
      awaitingAllocationCount,
      allocatedCount,
      isComplete,
    });
  }

  // Stable sort: groups with pending allocations first, then alphabetically by name
  finalGroups.sort((a, b) => {
    if (a.awaitingAllocationCount !== b.awaitingAllocationCount) {
      return b.awaitingAllocationCount - a.awaitingAllocationCount;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    groups: finalGroups,
    standalone: finalStandalone,
    totalRecordsCount: records.length,
    totalGroupsCount: finalGroups.length,
    totalStandaloneCount: finalStandalone.length,
  };
}

/**
 * Group-aware pagination helper.
 * Ensures a verified team's accommodation records remain together and are never
 * split into misleading partial groups across pages.
 */
export function paginateGroupedAccommodations(
  records: AccommodationRecord[],
  options: GroupAwarePaginationOptions = {}
): PaginatedGroupedResult {
  const grouped = groupAccommodationRecords(records);
  const pageSize = Math.max(1, options.pageSize || 50);
  const boundaryStrategy = options.boundaryStrategy || "move-to-next";

  // Build display units: verified complete groups, then standalone records
  type DisplayUnit =
    | { type: "group"; data: AccommodationGroup; recordCount: number }
    | { type: "standalone"; data: AccommodationRecord; recordCount: number };

  const units: DisplayUnit[] = [
    ...grouped.groups.map((g) => ({
      type: "group" as const,
      data: g,
      recordCount: g.records.length,
    })),
    ...grouped.standalone.map((s) => ({
      type: "standalone" as const,
      data: s,
      recordCount: 1,
    })),
  ];

  if (units.length === 0) {
    return {
      groups: [],
      standalone: [],
      page: 1,
      pageSize,
      totalPages: 1,
      totalRecordsCount: 0,
      totalGroupsCount: 0,
      totalStandaloneCount: 0,
      displayedRecordsCount: 0,
    };
  }

  // Partition units into pages so that a team is NEVER split across pages
  const pages: Array<{
    groups: AccommodationGroup[];
    standalone: AccommodationRecord[];
    recordCount: number;
  }> = [];

  let currentPage = {
    groups: [] as AccommodationGroup[],
    standalone: [] as AccommodationRecord[],
    recordCount: 0,
  };

  for (const unit of units) {
    const wouldExceed =
      currentPage.recordCount > 0 && currentPage.recordCount + unit.recordCount > pageSize;

    // If unit exceeds target budget:
    // 'move-to-next': seal current page so this complete unit starts on a fresh page
    if (wouldExceed && boundaryStrategy === "move-to-next") {
      pages.push(currentPage);
      currentPage = { groups: [], standalone: [], recordCount: 0 };
    }

    if (unit.type === "group") {
      currentPage.groups.push(unit.data);
    } else {
      currentPage.standalone.push(unit.data);
    }
    currentPage.recordCount += unit.recordCount;

    // Under 'move-to-next', a fresh unit that reaches/exceeds pageSize seals the page.
    // Under 'keep-with-current', keeping the unit that exceeded pageSize seals the page immediately.
    if (currentPage.recordCount >= pageSize) {
      pages.push(currentPage);
      currentPage = { groups: [], standalone: [], recordCount: 0 };
    }
  }

  if (currentPage.recordCount > 0) {
    pages.push(currentPage);
  }

  const totalPages = Math.max(1, pages.length);
  const targetPage = Math.min(totalPages, Math.max(1, options.page || 1));
  const pageContent = pages[targetPage - 1] || { groups: [], standalone: [], recordCount: 0 };

  return {
    groups: pageContent.groups,
    standalone: pageContent.standalone,
    page: targetPage,
    pageSize,
    totalPages,
    totalRecordsCount: grouped.totalRecordsCount,
    totalGroupsCount: grouped.totalGroupsCount,
    totalStandaloneCount: grouped.totalStandaloneCount,
    displayedRecordsCount: pageContent.recordCount,
  };
}

/**
 * Generates a valid, deterministic DOM element ID for a group's collapsible member rows container.
 */
export function getGroupControlsId(groupKey: string): string {
  const sanitized = (groupKey || "").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `group-rows-${sanitized}`;
}

/**
 * Generates a valid, deterministic DOM element ID for a group's header row.
 */
export function getGroupHeaderId(groupKey: string): string {
  const sanitized = (groupKey || "").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `group-header-${sanitized}`;
}

export interface ParticipantAccommodationEntry {
  participantId: string;
  participantDbId: string;
  participantCode: string;
  name: string;
  email: string;
  phone: string;
  gender: string;
  state: string;
  college?: string | null;
  isFaculty: boolean;
  records: AccommodationRecord[];
  primaryRecord: AccommodationRecord;
  isMultiOrder: boolean;
  totalOrders: number;
  totalAmount: number;
  allPaid: boolean;
  hasPaid: boolean;
  isAllocated: boolean;
  isPartiallyAllocated: boolean;
  isAwaitingAllocation: boolean;
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  canReallocate: boolean;
  assignedRoomId?: string | null;
  assignedHostelId?: string | null;
  combinedDateRange: string;
}

/**
 * Groups raw accommodation records by stable canonical participant ID.
 * All accommodation orders belonging to the same participant are consolidated into a single entry.
 * Original individual records, amounts, dates, and payment references are preserved.
 */
export function groupRecordsByParticipant(records: AccommodationRecord[]): ParticipantAccommodationEntry[] {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }

  const map = new Map<string, AccommodationRecord[]>();

  for (const acc of records) {
    // Identity key: MUST use stable database participant ID (acc.participant_id or acc.participants?.participant_id)
    // Never group by name or email alone.
    const key = (acc.participants?.participant_id || acc.participant_id || "").trim();
    const mapKey = key || `record_${acc.id}`;
    const existing = map.get(mapKey);
    if (existing) {
      existing.push(acc);
    } else {
      map.set(mapKey, [acc]);
    }
  }

  const entries: ParticipantAccommodationEntry[] = [];

  for (const [key, accs] of map.entries()) {
    // Sort orders by start_date ascending
    accs.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

    // Find primary record: prefer one with an active room allocation, or first paid, or first
    const primaryRecord = accs.find((a) => a.room_id) || accs.find((a) => a.status === "paid") || accs[0];
    const p = primaryRecord.participants;

    const allPaid = accs.every((a) => a.status === "paid");
    const hasPaid = accs.some((a) => a.status === "paid");
    const paidAccs = accs.filter((a) => a.status === "paid");

    const allocatedCount = paidAccs.filter((a) => !!a.room_id).length;
    const isAllocated = paidAccs.length > 0 && allocatedCount === paidAccs.length;
    const isPartiallyAllocated = allocatedCount > 0 && allocatedCount < paidAccs.length;
    const isAwaitingAllocation = paidAccs.length > 0 && allocatedCount === 0;

    const isCheckedIn = accs.some((a) => a.checked_in && !a.checked_out);
    const isCheckedOut = accs.length > 0 && accs.every((a) => a.checked_out);
    const canReallocate = isAllocated && !isCheckedOut;

    // Calculate combined stay interval
    const startDates = accs.map((a) => a.start_date).filter(Boolean).sort();
    const endDates = accs.map((a) => a.end_date).filter(Boolean).sort();
    const combinedDateRange =
      startDates.length > 0 && endDates.length > 0
        ? `${startDates[0]} to ${endDates[endDates.length - 1]}`
        : primaryRecord.start_date || "—";

    entries.push({
      participantId: key,
      participantDbId: primaryRecord.participant_id,
      participantCode: p?.participant_id || key,
      name: p?.name || "Unknown",
      email: p?.email || "",
      phone: p?.phone || "",
      gender: p?.gender || "",
      state: p?.state || "",
      college: p?.college || null,
      isFaculty: Boolean(p?.is_faculty),
      records: accs,
      primaryRecord,
      isMultiOrder: accs.length > 1,
      totalOrders: accs.length,
      totalAmount: accs.reduce((sum, a) => sum + (Number(a.amount) || 0), 0),
      allPaid,
      hasPaid,
      isAllocated,
      isPartiallyAllocated,
      isAwaitingAllocation,
      isCheckedIn,
      isCheckedOut,
      canReallocate,
      assignedRoomId: primaryRecord.room_id,
      assignedHostelId: primaryRecord.hostel_id,
      combinedDateRange,
    });
  }

  return entries;
}
