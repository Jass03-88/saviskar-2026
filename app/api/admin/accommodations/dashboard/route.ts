import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAccommodationAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  return createSupabaseClient(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

const DB_BATCH_SIZE = 1000;
const MAX_SUPPORTED_ACCOMMODATIONS = 20000;

async function fetchInBatches<T>(
  fetchBatch: (start: number, end: number, isFirst: boolean) => Promise<{ data: T[] | null; count?: number | null; error: any }>,
  targetRange: { start: number; end: number },
  batchSize: number = DB_BATCH_SIZE,
  resourceLimit: number = MAX_SUPPORTED_ACCOMMODATIONS
): Promise<{ data: T[]; totalCount: number; error: any }> {
  const firstBatchEnd = Math.min(targetRange.end, targetRange.start + batchSize - 1);
  const firstRes = await fetchBatch(targetRange.start, firstBatchEnd, true);

  if (firstRes.error) {
    return { data: [], totalCount: 0, error: firstRes.error };
  }

  const availableCount = firstRes.count ?? (firstRes.data?.length || 0);

  if (availableCount > resourceLimit) {
    return {
      data: [],
      totalCount: availableCount,
      error: new Error(
        `Accommodation record volume (${availableCount}) exceeds maximum supported dashboard limit (${resourceLimit}). Please contact system administrator.`
      ),
    };
  }

  const effectiveEnd = Math.min(targetRange.end, availableCount - 1);
  if (effectiveEnd < targetRange.start || !firstRes.data) {
    return { data: [], totalCount: availableCount, error: null };
  }

  const allData: T[] = [...firstRes.data];

  if (effectiveEnd > firstBatchEnd) {
    for (let currentOffset = targetRange.start + batchSize; currentOffset <= effectiveEnd; currentOffset += batchSize) {
      const currentBatchEnd = Math.min(effectiveEnd, currentOffset + batchSize - 1);
      const nextRes = await fetchBatch(currentOffset, currentBatchEnd, false);

      if (nextRes.error) {
        return {
          data: [],
          totalCount: availableCount,
          error: new Error(
            `Failed to retrieve batch [${currentOffset}..${currentBatchEnd}]: ${nextRes.error.message || nextRes.error}`
          ),
        };
      }

      if (!nextRes.data || nextRes.data.length === 0) {
        return {
          data: [],
          totalCount: availableCount,
          error: new Error(`Incomplete batch retrieved: got 0 records for range [${currentOffset}..${currentBatchEnd}].`),
        };
      }

      allData.push(...nextRes.data);
    }
  }

  const expectedLength = effectiveEnd - targetRange.start + 1;
  if (allData.length !== expectedLength) {
    return {
      data: [],
      totalCount: availableCount,
      error: new Error(
        `Incomplete accommodation dataset: expected ${expectedLength} records, but retrieved ${allData.length}.`
      ),
    };
  }

  return { data: allData, totalCount: availableCount, error: null };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAccommodationAdmin();

    if (auth.error) {
      return NextResponse.json(
        {
          error:
            auth.error === "MFA_REQUIRED"
              ? "Master Admin MFA verification required."
              : auth.error,
        },
        { status: auth.status }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (!supabaseAdmin) {
      return NextResponse.json(
        {
          error: "Admin service is not configured.",
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const requestedPageSize = searchParams.get("pageSize");
    // When pageSize is >= 5000 or unspecified, client requests the complete dataset for grouping
    const isFullDatasetRequested = !requestedPageSize || parseInt(requestedPageSize, 10) >= 5000;
    const pageSize = requestedPageSize ? Math.max(1, parseInt(requestedPageSize, 10)) : 5000;

    const targetRange = isFullDatasetRequested
      ? { start: 0, end: Number.MAX_SAFE_INTEGER }
      : { start: (page - 1) * pageSize, end: (page - 1) * pageSize + pageSize - 1 };

    const { data: hostels, error: hostelsError } = await supabaseAdmin
      .from("hostels")
      .select("*")
      .order("name", { ascending: true });

    // Load Floors
    const { data: floors, error: floorsError } = await supabaseAdmin
      .from("hostel_floors")
      .select("*")
      .order("floor_number", { ascending: true });

    // Load Rooms
    const { data: rooms, error: roomsError } = await supabaseAdmin
      .from("hostel_rooms")
      .select("*")
      .order("room_number", { ascending: true });

    // Load Plans
    const { data: plans, error: plansError } = await supabaseAdmin
      .from("accommodation_plans")
      .select("*")
      .order("price", { ascending: true });

    // Load Accommodations in bounded batches of at most 1,000 records
    const extendedQuery = async (start: number, end: number, isFirst: boolean) => await
      supabaseAdmin
        .from("participant_accommodations")
        .select(`
          id,
          participant_id,
          accommodation_plan_id,
          payment_order_id,
          start_date,
          end_date,
          duration_days,
          amount,
          currency,
          status,
          hostel_id,
          room_id,
          checked_in,
          checked_in_at,
          checked_out,
          checked_out_at,
          created_at,
          participants (
            participant_id,
            name,
            email,
            phone,
            gender,
            state,
            college,
            faculty_incharges ( id, registration_group_id ),
            participant_events (
              id,
              team_name,
              registration_group_id,
              participant_id,
              participants ( participant_id, name )
            ),
            participant_event_members (
              id,
              participant_event_id,
              is_team_leader,
              participant_events (
                id,
                team_name,
                registration_group_id,
                participant_id,
                participants ( participant_id, name )
              )
            )
          )
        `, isFirst ? { count: "exact" } : undefined)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(start, end);

    let fetchResult = await fetchInBatches<any>(extendedQuery, targetRange);

    // Fallback if the extended join query fails due to schema divergence
    if (fetchResult.error) {
      console.warn("Accommodation extended query failed, falling back to basic query:", fetchResult.error);
      const fallbackQuery = async (start: number, end: number, isFirst: boolean) => await
        supabaseAdmin
          .from("participant_accommodations")
          .select(`
            id,
            participant_id,
            accommodation_plan_id,
            payment_order_id,
            start_date,
            end_date,
            duration_days,
            amount,
            currency,
            status,
            hostel_id,
            room_id,
            checked_in,
            checked_in_at,
            checked_out,
            checked_out_at,
            created_at,
            participants (
              participant_id,
              name,
              email,
              phone,
              gender,
              state,
              college,
              faculty_incharges ( id ),
              participant_events ( id ),
              participant_event_members ( id )
            )
          `, isFirst ? { count: "exact" } : undefined)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(start, end);

      fetchResult = await fetchInBatches<any>(fallbackQuery, targetRange);
    }

    if (hostelsError || roomsError || plansError || fetchResult.error) {
      console.error("Accommodation Dashboard Error", { hostelsError, floorsError, roomsError, plansError, accError: fetchResult.error });
      const errorMsg = fetchResult.error?.message || "Failed to load dashboard data.";
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const accommodations = fetchResult.data;
    const count = fetchResult.totalCount;

    // Load Active Allocations in bounded batches of at most 1,000 rows
    const allocationsQuery = async (start: number, end: number, isFirst: boolean) => await
      supabaseAdmin
        .from("accommodation_allocations")
        .select("hostel_id, room_id, participant_accommodation_id, participant_accommodations ( participant_id, start_date, end_date )", isFirst ? { count: "exact" } : undefined)
        .eq("status", "active")
        .order("id", { ascending: false })
        .range(start, end);

    const allocationsResult = await fetchInBatches<any>(allocationsQuery, { start: 0, end: Number.MAX_SAFE_INTEGER });

    if (allocationsResult.error) {
      console.error("Accommodation Allocations Load Error", allocationsResult.error);
      const errorMsg = allocationsResult.error.message || "Failed to load occupancy data.";
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const activeAllocations = allocationsResult.data;

    const roomParticipants = new Map<string, Set<string>>();
    const floorParticipants = new Map<string, Set<string>>();
    const hostelParticipants = new Map<string, Set<string>>();

    const roomToFloor = new Map<string, string>();
    if (rooms) {
      for (const r of rooms) {
        if (r.floor_id) roomToFloor.set(r.id, r.floor_id);
      }
    }

    if (activeAllocations) {
      let anonymousCounter = 0;
      for (const a of activeAllocations) {
        const participantKey =
          a.participant_accommodations?.participant_id ||
          a.participant_id ||
          a.participant_accommodation_id ||
          `anon_${++anonymousCounter}`;

        if (a.room_id) {
          if (!roomParticipants.has(a.room_id)) roomParticipants.set(a.room_id, new Set());
          roomParticipants.get(a.room_id)!.add(participantKey);

          const floorId = roomToFloor.get(a.room_id);
          if (floorId) {
            if (!floorParticipants.has(floorId)) floorParticipants.set(floorId, new Set());
            floorParticipants.get(floorId)!.add(participantKey);
          }
        }
        if (a.hostel_id) {
          if (!hostelParticipants.has(a.hostel_id)) hostelParticipants.set(a.hostel_id, new Set());
          hostelParticipants.get(a.hostel_id)!.add(participantKey);
        }
      }
    }

    const roomOccupancy = new Map<string, number>();
    for (const [rId, pSet] of roomParticipants) {
      roomOccupancy.set(rId, pSet.size);
    }
    const floorOccupancy = new Map<string, number>();
    for (const [fId, pSet] of floorParticipants) {
      floorOccupancy.set(fId, pSet.size);
    }
    const hostelOccupancy = new Map<string, number>();
    for (const [hId, pSet] of hostelParticipants) {
      hostelOccupancy.set(hId, pSet.size);
    }

    const activeAllocationsSummary = (activeAllocations || []).map((a: any) => {
      const pa = Array.isArray(a.participant_accommodations)
        ? a.participant_accommodations[0]
        : a.participant_accommodations;
      return {
        hostel_id: a.hostel_id,
        room_id: a.room_id,
        participant_id: pa?.participant_id || a.participant_id || a.participant_accommodation_id || "",
        start_date: pa?.start_date || null,
        end_date: pa?.end_date || null,
      };
    });

    // Calculate total accommodation stats including check-in/out in bounded batches
    const statsQuery = async (start: number, end: number, isFirst: boolean) => await
      supabaseAdmin
        .from("participant_accommodations")
        .select(`
          status,
          checked_in,
          checked_out,
          room_id,
          participants (
            faculty_incharges ( id ),
            participant_events ( id ),
            participant_event_members ( id )
          )
        `, isFirst ? { count: "exact" } : undefined)
        .order("id", { ascending: false })
        .range(start, end);

    const statsFetchResult = await fetchInBatches<any>(statsQuery, { start: 0, end: Number.MAX_SAFE_INTEGER });
    if (statsFetchResult.error) {
      console.error("Accommodation Stats Load Error", statsFetchResult.error);
      return NextResponse.json({ error: statsFetchResult.error.message || "Failed to load accommodation statistics." }, { status: 500 });
    }
    const statusStats = statsFetchResult.data;

    let total = 0, paid = 0, pending = 0, cancelled = 0, checkedIn = 0, checkedOut = 0;
    let allocated = 0, awaitingAllocation = 0;
    let activeParticipants = 0, activeFaculty = 0;

    if (statusStats) {
      for (const s of statusStats) {
        if (s.status === "paid") {
          total++;
          paid++;
          if (s.room_id) allocated++;
          else awaitingAllocation++;
        }
        else if (s.status === "pending" || s.status === "unpaid") {
          total++;
          pending++;
        }

        if (s.status === "cancelled" || s.status === "failed") {
          cancelled++;
        } else {
          if (s.checked_out) checkedOut++;
          else if (s.checked_in) checkedIn++;

          const p = s.participants as any;
          const pObj = Array.isArray(p) ? p[0] : p;
          const facultyCount = pObj?.faculty_incharges?.length ?? 0;
          const eventCount = (pObj?.participant_events?.length ?? 0) + (pObj?.participant_event_members?.length ?? 0);
          const is_faculty = facultyCount > 0 && eventCount === 0;

          if (is_faculty) activeFaculty++;
          else activeParticipants++;
        }
      }
    }

    let totalCapacity = 0;
    if (rooms) {
      for (const r of rooms) {
        if (r.is_active) totalCapacity += r.capacity;
      }
    }
    const occupiedCapacity = activeAllocations?.length ?? 0;

    const processedAccommodations = (accommodations ?? []).map((acc: any) => {
      const p = acc.participants;
      const facultyCount = p?.faculty_incharges?.length ?? 0;
      const eventCount = (p?.participant_events?.length ?? 0) + (p?.participant_event_members?.length ?? 0);
      const is_faculty = facultyCount > 0 && eventCount === 0;

      // Collect all verified team affiliations for participant p to detect multiple/ambiguous teams
      const teamAffiliationsMap = new Map<
        string,
        {
          teamId: string;
          teamName: string;
          registrationGroupId: string | null;
          teamLeaderName: string | null;
          teamLeaderParticipantId: string | null;
        }
      >();

      // A. Inspect participant_event_members (where participant joined a team or is team leader)
      if (Array.isArray(p?.participant_event_members)) {
        for (const m of p.participant_event_members) {
          const pe = Array.isArray(m?.participant_events)
            ? m.participant_events[0]
            : m?.participant_events;
          const canonicalTeamId = pe?.id || m?.participant_event_id;
          const tName = (pe?.team_name || "").trim();

          // Only consider valid if canonical team ID exists
          if (canonicalTeamId && tName) {
            let leaderName: string | null = null;
            let leaderParticipantId: string | null = null;

            if (m.is_team_leader) {
              leaderName = p?.name || null;
              leaderParticipantId = p?.participant_id || null;
            } else if (pe?.participants) {
              const l = Array.isArray(pe.participants) ? pe.participants[0] : pe.participants;
              leaderName = l?.name || null;
              leaderParticipantId = l?.participant_id || null;
            }

            teamAffiliationsMap.set(canonicalTeamId, {
              teamId: canonicalTeamId,
              teamName: tName,
              registrationGroupId: pe?.registration_group_id || null,
              teamLeaderName: leaderName,
              teamLeaderParticipantId: leaderParticipantId,
            });
          }
        }
      }

      // B. Inspect direct participant_events (where participant registered as team leader)
      if (Array.isArray(p?.participant_events)) {
        for (const pe of p.participant_events) {
          const canonicalTeamId = pe?.id;
          const tName = (pe?.team_name || "").trim();

          if (canonicalTeamId && tName) {
            // If already present from members, preserve it; otherwise p is team leader
            if (!teamAffiliationsMap.has(canonicalTeamId)) {
              teamAffiliationsMap.set(canonicalTeamId, {
                teamId: canonicalTeamId,
                teamName: tName,
                registrationGroupId: pe?.registration_group_id || null,
                teamLeaderName: p?.name || null,
                teamLeaderParticipantId: p?.participant_id || null,
              });
            }
          }
        }
      }

      let teamId: string | null = null;
      let teamName: string | null = null;
      let registrationGroupId: string | null = null;
      let teamLeaderName: string | null = null;
      let teamLeaderParticipantId: string | null = null;
      let isAmbiguous = false;

      // Safe ambiguity check:
      if (teamAffiliationsMap.size === 1) {
        // Exactly one canonical team relationship: unambiguous!
        const [singleTeam] = Array.from(teamAffiliationsMap.values());
        teamId = singleTeam.teamId;
        teamName = singleTeam.teamName;
        registrationGroupId = singleTeam.registrationGroupId;
        teamLeaderName = singleTeam.teamLeaderName;
        teamLeaderParticipantId = singleTeam.teamLeaderParticipantId;
      } else if (teamAffiliationsMap.size > 1) {
        // Participant belongs to multiple distinct teams: AMBIGUOUS!
        // Do not arbitrarily choose one team; mark ambiguous and display individually
        isAmbiguous = true;
      } else {
        // No canonical team event affiliations found.
        // Check for verified shared registration_group_id
        const groupIds = new Set<string>();
        if (Array.isArray(p?.participant_events)) {
          for (const pe of p.participant_events) {
            if (pe?.registration_group_id) groupIds.add(pe.registration_group_id);
          }
        }
        if (Array.isArray(p?.faculty_incharges)) {
          for (const f of p.faculty_incharges) {
            if (f?.registration_group_id) groupIds.add(f.registration_group_id);
          }
        }

        if (groupIds.size === 1) {
          registrationGroupId = Array.from(groupIds)[0];
        } else if (groupIds.size > 1) {
          isAmbiguous = true;
        }
      }

      acc.team_id = teamId;
      acc.team_name = teamName;
      acc.registration_group_id = registrationGroupId;
      acc.team_leader_name = teamLeaderName;
      acc.team_leader_participant_id = teamLeaderParticipantId;
      acc.is_ambiguous = isAmbiguous;

      if (acc.participants) {
        delete acc.participants.faculty_incharges;
        delete acc.participants.participant_events;
        delete acc.participants.participant_event_members;
        acc.participants.is_faculty = is_faculty;
      }
      return acc;
    });

    return NextResponse.json(
      {
        accommodations: processedAccommodations,
        hostels: hostels ?? [],
        floors: floors ?? [],
        rooms: rooms ?? [],
        plans: plans ?? [],
        roomOccupancy: Object.fromEntries(roomOccupancy),
        floorOccupancy: Object.fromEntries(floorOccupancy),
        hostelOccupancy: Object.fromEntries(hostelOccupancy),
        activeAllocations: activeAllocationsSummary,
        stats: { total, paid, pending, cancelled, checkedIn, checkedOut, allocated, awaitingAllocation, totalCapacity, occupiedCapacity, participants: activeParticipants, faculty: activeFaculty },
        page,
        pageSize,
        totalCount: count ?? 0,
        role: auth.role,
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err) {
    console.error("UNHANDLED ACCOMMODATION DASHBOARD GET ERROR:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
