import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import {
  parseAdminCategories,
  formatCategoryScopeLabel,
  VALID_ADMIN_CATEGORIES,
} from "@/lib/admin/scope";
import { INDIAN_STATES_AND_UT } from "@/lib/states";
import { fetchInBatches, fetchAllRows } from "@/lib/supabase/batch";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdmin();

  if (auth.error) {
    return NextResponse.json(
      { success: false, error: auth.error },
      {
        status: auth.status,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const isMaster = auth.role === "master";
  const assignedCategory = isMaster ? null : auth.assigned_category;
  const assignedEvents = isMaster ? [] : auth.assigned_events || [];
  const parsedAssigned = parseAdminCategories(assignedCategory);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const secretKey = process.env.SUPABASE_SECRET_KEY!;
  const supabaseAdmin = createSupabaseClient(supabaseUrl, secretKey);

  try {
    // 1. Fetch Events
    const { data: rawEvents, error: eventsError } = await supabaseAdmin
      .from("events")
      .select("id, name, category, registration_type, registration_fee, registration_limit, active")
      .order("name", { ascending: true });

    if (eventsError) throw eventsError;

    const allEvents = rawEvents || [];

    // 2. Determine Available Categories for this Admin
    let availableCategories: string[] = [];
    if (isMaster) {
      availableCategories = [...VALID_ADMIN_CATEGORIES];
    } else if (parsedAssigned.length > 0) {
      availableCategories = parsedAssigned;
    } else if (assignedEvents.length > 0) {
      const catSet = new Set<string>();
      for (const ev of allEvents) {
        if (assignedEvents.includes(ev.id) && ev.category) {
          catSet.add(ev.category.toLowerCase().trim());
        }
      }
      availableCategories = Array.from(catSet);
    } else {
      // Unrestricted standard admin
      availableCategories = [...VALID_ADMIN_CATEGORIES];
    }

    // 3. Parse and Validate Requested Filters (?category=... & ?college=...)
    let queryCategory: string | null = null;
    let queryCollege: string | null = null;

    if (request) {
      try {
        const url = new URL(request.url);
        queryCategory = url.searchParams.get("category")?.trim().toLowerCase() || null;
        const colParam = url.searchParams.get("college")?.trim();
        if (colParam && colParam.toLowerCase() !== "all") {
          queryCollege = colParam;
        }
      } catch {
        queryCategory = null;
        queryCollege = null;
      }
    }

    let selectedCategory = "all";
    if (availableCategories.length === 1) {
      // Admin is strictly locked to a single category
      selectedCategory = availableCategories[0];
      if (
        queryCategory &&
        queryCategory !== "all" &&
        queryCategory !== availableCategories[0]
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Access denied: You do not have permission to view analytics for this category.",
          },
          { status: 403 }
        );
      }
    } else if (queryCategory && queryCategory !== "all") {
      if (!availableCategories.includes(queryCategory)) {
        return NextResponse.json(
          {
            success: false,
            error: "Access denied: You do not have permission to view analytics for this category.",
          },
          { status: 403 }
        );
      }
      selectedCategory = queryCategory;
    } else {
      selectedCategory = "all";
    }

    // 4. Determine Scoped Events (all events permitted under admin permissions)
    const scopedEvents = allEvents.filter((ev) => {
      if (isMaster) return true;
      if (assignedEvents.includes(ev.id)) return true;
      if (parsedAssigned.length > 0) {
        return (
          ev.category &&
          parsedAssigned.includes(ev.category.toLowerCase().trim())
        );
      }
      return true;
    });

    const scopedEventIds = scopedEvents.map((ev) => ev.id);

    // If scoped admin has no matching events, return early empty state
    if (scopedEventIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          isMaster,
          role: auth.role,
          assignedCategory: auth.assigned_category,
          assignedEvents: auth.assigned_events,
          availableCategories,
          selectedCategory,
          availableColleges: [],
          selectedCollege: queryCollege || "all",
          categoryScopeLabel: formatCategoryScopeLabel(auth.assigned_category),
          accommodationAccess: auth.accommodation_access,
          overview: {
            totalParticipants: 0,
            eventParticipantCount: 0,
            accommodationOnlyCount: 0,
            withAccommodation: 0,
            withoutAccommodation: 0,
            totalHeadcount: 0,
            headcountWithAccommodation: 0,
            headcountWithoutAccommodation: 0,
            totalRegistrations: 0,
            registrationsWithAccommodation: 0,
            registrationsWithoutAccommodation: 0,
            totalTeams: 0,
            totalSolo: 0,
            totalCheckedIn: 0,
            checkInRate: 0,
            totalColleges: 0,
            totalStates: 0,
            revenue: null,
          },
          stateWise: [],
          eventWise: [],
          categories: [],
          demographics: {
            gender: { male: 0, female: 0, other: 0, unspecified: 0 },
            topColleges: [],
          },
          timeline: [],
          accommodations: null,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // 5. Filter Events according to selectedCategory
    const filteredEvents =
      selectedCategory === "all"
        ? scopedEvents
        : scopedEvents.filter(
            (ev) => ev.category?.toLowerCase().trim() === selectedCategory
          );
    const filteredEventIdSet = new Set(filteredEvents.map((ev) => ev.id));

    // 6. Fetch Participant Events (non-cancelled, non-archived)
    const { data: rawPEs, error: peError } = await fetchAllRows(async (start, end) => {
      let q = supabaseAdmin
        .from("participant_events")
        .select(
          "id, participant_id, event_id, registration_status, payment_status, payment_amount, team_name, checked_in, main_checked_in, is_archived, created_at",
          { count: "exact" }
        )
        .neq("registration_status", "cancelled");

      if (!isMaster || scopedEventIds.length < allEvents.length) {
        q = q.in("event_id", scopedEventIds);
      }

      return q.order("created_at", { ascending: false }).range(start, end);
    });
    if (peError) throw peError;

    // Filter out archived registrations
    const allScopedPEs = (rawPEs || []).filter((pe: any) => pe.is_archived !== true);

    // Filter participant_events to those in filteredEvents (for the selected category)
    const categoryPEs = allScopedPEs.filter((pe) =>
      filteredEventIdSet.has(pe.event_id)
    );
    const categoryPEIds = categoryPEs.map((pe) => pe.id);

    // 7. Fetch Team Members for filtered participant events to count ALL participants
    let eventMembers: any[] = [];
    if (categoryPEIds.length > 0) {
      const { data: rawMembers, error: membersError } = await fetchInBatches<{
        id: string;
        participant_event_id: string;
        participant_id: string | null;
        name?: string;
        is_team_leader?: boolean;
      }>(categoryPEIds, (chunk) =>
        supabaseAdmin
          .from("participant_event_members")
          .select("id, participant_event_id, participant_id, name, is_team_leader")
          .in("participant_event_id", chunk)
      );
      if (membersError) throw membersError;
      eventMembers = rawMembers || [];
    }

    // Map members per participant_event
    const peMembersMap = new Map<string, any[]>();
    for (const m of eventMembers) {
      if (!peMembersMap.has(m.participant_event_id)) {
        peMembersMap.set(m.participant_event_id, []);
      }
      peMembersMap.get(m.participant_event_id)!.push(m);
    }

    // 8. Fetch ALL Participants to get full college mapping & demographics
    const { data: rawParts, error: partError } = await fetchAllRows(async (start, end) => {
      return supabaseAdmin
        .from("participants")
        .select("id, participant_id, name, college, gender, state, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(start, end);
    });
    if (partError) throw partError;
    const allParticipants = rawParts || [];
    const participantMap = new Map(allParticipants.map((p) => [p.id, p]));

    // 9. Fetch Accommodations (non-cancelled / non-failed)
    const { data: rawAccs, error: accsError } = await fetchAllRows(async (start, end) => {
      return supabaseAdmin
        .from("participant_accommodations")
        .select("id, participant_id, status, amount, start_date, end_date, checked_in", { count: "exact" })
        .not("status", "in", '("cancelled","failed")')
        .range(start, end);
    });
    if (accsError) throw accsError;
    const allAccommodations = rawAccs || [];

    // Set of participant IDs who have an active accommodation booking
    const activeAccParticipantIds = new Set<string>();
    for (const acc of allAccommodations) {
      if (acc.participant_id) {
        activeAccParticipantIds.add(acc.participant_id);
      }
    }

    // 10. Build Available Colleges List (from all participants, normalized & sorted by count)
    const collegeCounts = new Map<string, { college: string; count: number }>();
    for (const p of allParticipants) {
      const raw = (p.college || "").trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!collegeCounts.has(key)) {
        collegeCounts.set(key, { college: raw, count: 0 });
      }
      const c = collegeCounts.get(key)!;
      c.count++;
      // Prefer clean capitalized version if available
      if (raw !== raw.toLowerCase() && c.college === c.college.toLowerCase()) {
        c.college = raw;
      }
    }
    const availableColleges = Array.from(collegeCounts.values()).sort(
      (a, b) => b.count - a.count
    );

    // 11. Apply College Filter (if requested)
    const queryCollegeLower = queryCollege ? queryCollege.toLowerCase().trim() : null;
    const selectedCollege = queryCollege ? queryCollege.trim() : "all";

    // Filter registrations: include registration if leader OR any member matches queryCollege
    const filteredPEs = categoryPEs.filter((pe) => {
      if (!queryCollegeLower) return true;

      // Check leader
      const leaderPart = participantMap.get(pe.participant_id);
      if (
        leaderPart &&
        (leaderPart.college || "").toLowerCase().trim() === queryCollegeLower
      ) {
        return true;
      }

      // Check team members
      const members = peMembersMap.get(pe.id) || [];
      return members.some((m) => {
        const memPart = m.participant_id ? participantMap.get(m.participant_id) : null;
        return (
          memPart &&
          (memPart.college || "").toLowerCase().trim() === queryCollegeLower
        );
      });
    });

    // 12. Collect Unique Participants and Headcount in Scope
    const uniqueParticipantIdSet = new Set<string>();
    let totalHeadcount = 0;
    let headcountWithAccommodation = 0;
    let headcountWithoutAccommodation = 0;

    let totalTeams = 0;
    let totalSolo = 0;
    let totalCheckedIn = 0;
    let registrationsWithAccommodation = 0;

    let eventExpectedRevenue = 0;
    let eventPaidRevenue = 0;
    let eventOutstandingRevenue = 0;

    const eventStatsMap = new Map<
      string,
      {
        count: number;
        checkedIn: number;
        paidCount: number;
        revenue: number;
      }
    >();

    const eventLookupMap = new Map(allEvents.map((e) => [e.id, e]));

    for (const pe of filteredPEs) {
      const isCheckedIn = pe.checked_in || pe.main_checked_in;
      if (isCheckedIn) totalCheckedIn++;

      const ev = eventLookupMap.get(pe.event_id);
      const isTeamEvent =
        ev && ev.registration_type && ev.registration_type !== "individual";
      const hasTeamName = Boolean(pe.team_name && pe.team_name.trim());
      const members = peMembersMap.get(pe.id) || [];
      const hasMembers = members.length > 0;

      if (isTeamEvent || hasTeamName || hasMembers) {
        totalTeams++;
      } else {
        totalSolo++;
      }

      // Track registration accommodation status
      let regHasAcco = false;

      if (hasMembers) {
        for (const m of members) {
          const memPart = m.participant_id ? participantMap.get(m.participant_id) : null;
          // When filtering by college, only include members matching the college
          if (queryCollegeLower) {
            if (
              !memPart ||
              (memPart.college || "").toLowerCase().trim() !== queryCollegeLower
            ) {
              continue;
            }
          }

          if (m.participant_id) {
            uniqueParticipantIdSet.add(m.participant_id);
            if (activeAccParticipantIds.has(m.participant_id)) {
              headcountWithAccommodation++;
              regHasAcco = true;
            } else {
              headcountWithoutAccommodation++;
            }
          } else {
            headcountWithoutAccommodation++;
          }
          totalHeadcount++;
        }
      } else {
        const leaderPart = participantMap.get(pe.participant_id);
        if (
          !queryCollegeLower ||
          (leaderPart &&
            (leaderPart.college || "").toLowerCase().trim() === queryCollegeLower)
        ) {
          if (pe.participant_id) {
            uniqueParticipantIdSet.add(pe.participant_id);
            if (activeAccParticipantIds.has(pe.participant_id)) {
              headcountWithAccommodation++;
              regHasAcco = true;
            } else {
              headcountWithoutAccommodation++;
            }
          } else {
            headcountWithoutAccommodation++;
          }
          totalHeadcount++;
        }
      }

      if (regHasAcco) {
        registrationsWithAccommodation++;
      }

      // Financial calculations (Master clearance only)
      const amt = Number(pe.payment_amount) || 0;
      const isPaid =
        pe.payment_status === "paid" ||
        (pe.payment_status === "confirmed" && amt > 0);
      const isUnpaid =
        pe.payment_status === "pending" || pe.payment_status === "unpaid";

      eventExpectedRevenue += amt;
      if (isPaid) {
        eventPaidRevenue += amt;
      } else if (isUnpaid) {
        eventOutstandingRevenue += amt;
      }

      const cur = eventStatsMap.get(pe.event_id) || {
        count: 0,
        checkedIn: 0,
        paidCount: 0,
        revenue: 0,
      };
      cur.count++;
      if (isCheckedIn) cur.checkedIn++;
      if (isPaid) {
        cur.paidCount++;
        cur.revenue += amt;
      }
      eventStatsMap.set(pe.event_id, cur);
    }

    // Event competitor count before including accommodation-only delegates
    const eventParticipantCount = uniqueParticipantIdSet.size;
    let accommodationOnlyCount = 0;

    // If viewing All Categories, also include participants with active accommodation who might not have registered for events yet
    if (selectedCategory === "all") {
      for (const acc of allAccommodations) {
        if (!acc.participant_id) continue;
        const p = participantMap.get(acc.participant_id);
        if (!p) continue;
        if (queryCollegeLower) {
          if ((p.college || "").toLowerCase().trim() !== queryCollegeLower) {
            continue;
          }
        }
        if (!uniqueParticipantIdSet.has(acc.participant_id)) {
          accommodationOnlyCount++;
        }
        uniqueParticipantIdSet.add(acc.participant_id);
      }
    }

    // Total participants (including all team members)
    const totalParticipants = uniqueParticipantIdSet.size;
    let withAccommodation = 0;
    let withoutAccommodation = 0;

    for (const pid of uniqueParticipantIdSet) {
      if (activeAccParticipantIds.has(pid)) {
        withAccommodation++;
      } else {
        withoutAccommodation++;
      }
    }

    const totalRegistrations = filteredPEs.length;
    const registrationsWithoutAccommodation =
      totalRegistrations - registrationsWithAccommodation;
    const checkInRate =
      totalRegistrations > 0
        ? Math.round((totalCheckedIn / totalRegistrations) * 100)
        : 0;

    // Filter Accommodations for Revenue & Reporting
    const relevantAccs = allAccommodations.filter((acc) => {
      if (!acc.participant_id) return false;
      if (!queryCollegeLower) return true;
      const p = participantMap.get(acc.participant_id);
      return p && (p.college || "").toLowerCase().trim() === queryCollegeLower;
    });

    let accExpectedRevenue = 0;
    let accPaidRevenue = 0;
    let accOutstandingRevenue = 0;

    for (const acc of relevantAccs) {
      const amt = Number(acc.amount) || 0;
      const isPaid = acc.status === "paid" || acc.status === "confirmed";
      const isUnpaid = acc.status === "pending" || acc.status === "unpaid";

      accExpectedRevenue += amt;
      if (isPaid) accPaidRevenue += amt;
      else if (isUnpaid) accOutstandingRevenue += amt;
    }

    // STRICT REVENUE PROTECTION:
    // If auth.role is NOT "master", revenue must be strictly null!
    const isCategoryFiltered = selectedCategory !== "all";
    const revenue = isMaster
      ? {
          totalExpected:
            eventExpectedRevenue + (isCategoryFiltered ? 0 : accExpectedRevenue),
          totalPaid:
            eventPaidRevenue + (isCategoryFiltered ? 0 : accPaidRevenue),
          totalOutstanding:
            eventOutstandingRevenue +
            (isCategoryFiltered ? 0 : accOutstandingRevenue),
          events: {
            expected: eventExpectedRevenue,
            paid: eventPaidRevenue,
            outstanding: eventOutstandingRevenue,
          },
          accommodations: {
            expected: accExpectedRevenue,
            paid: accPaidRevenue,
            outstanding: accOutstandingRevenue,
          },
        }
      : null;

    // 13. State-Wise Breakdown (computed across all unique participants in scope)
    const stateCountsMap = new Map<
      string,
      {
        participantCount: number;
        eventRegistrations: number;
        collegesMap: Map<string, number>;
      }
    >();

    const knownStatesLower = new Map<string, string>();
    for (const st of INDIAN_STATES_AND_UT) {
      knownStatesLower.set(st.toLowerCase(), st);
    }

    const participantsInScope = Array.from(uniqueParticipantIdSet)
      .map((id) => participantMap.get(id))
      .filter(Boolean) as any[];

    for (const p of participantsInScope) {
      let stateName = (p.state || "").trim();
      if (!stateName || stateName.toLowerCase() === "select...") {
        stateName = "Unspecified / Other";
      } else {
        const canonical = knownStatesLower.get(stateName.toLowerCase());
        if (canonical) stateName = canonical;
      }

      const stObj = stateCountsMap.get(stateName) || {
        participantCount: 0,
        eventRegistrations: 0,
        collegesMap: new Map<string, number>(),
      };

      stObj.participantCount++;

      if (p.college && p.college.trim()) {
        const colTrim = p.college.trim();
        stObj.collegesMap.set(colTrim, (stObj.collegesMap.get(colTrim) || 0) + 1);
      }

      stateCountsMap.set(stateName, stObj);
    }

    // Count registrations per state
    for (const pe of filteredPEs) {
      const p = participantMap.get(pe.participant_id);
      if (p) {
        let stateName = (p.state || "").trim();
        if (!stateName || stateName.toLowerCase() === "select...") {
          stateName = "Unspecified / Other";
        } else {
          const canonical = knownStatesLower.get(stateName.toLowerCase());
          if (canonical) stateName = canonical;
        }
        const stObj = stateCountsMap.get(stateName);
        if (stObj) {
          stObj.eventRegistrations++;
        }
      }
    }

    const stateWise = Array.from(stateCountsMap.entries())
      .map(([state, data]) => {
        const topColleges = Array.from(data.collegesMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([col, count]) => `${col} (${count})`);

        return {
          state,
          participantCount: data.participantCount,
          eventRegistrations: data.eventRegistrations,
          percentage:
            totalParticipants > 0
              ? Math.round((data.participantCount / totalParticipants) * 1000) / 10
              : 0,
          topColleges,
        };
      })
      .sort((a, b) => b.participantCount - a.participantCount);

    // 14. Event-Wise Breakdown
    const eventWise = filteredEvents
      .map((ev) => {
        const stats = eventStatsMap.get(ev.id) || {
          count: 0,
          checkedIn: 0,
          paidCount: 0,
          revenue: 0,
        };
        const limit = ev.registration_limit || null;
        const fillRate = limit
          ? Math.min(100, Math.round((stats.count / limit) * 100))
          : null;

        return {
          id: ev.id,
          name: ev.name,
          category: ev.category || "General",
          registrationType: ev.registration_type || "individual",
          registrationFee: ev.registration_fee || 0,
          registrationLimit: limit,
          active: ev.active ?? true,
          count: stats.count,
          checkedIn: stats.checkedIn,
          fillRate,
          ...(isMaster ? { revenue: stats.revenue } : {}),
        };
      })
      .sort((a, b) => b.count - a.count);

    // 15. Category Breakdown
    const categoryStatsMap = new Map<
      string,
      { count: number; eventCount: number; checkedIn: number }
    >();

    for (const cat of availableCategories) {
      categoryStatsMap.set(cat, { count: 0, eventCount: 0, checkedIn: 0 });
    }

    for (const ev of scopedEvents) {
      const cat = (ev.category || "").toLowerCase().trim();
      if (categoryStatsMap.has(cat)) {
        categoryStatsMap.get(cat)!.eventCount++;
      }
    }

    for (const pe of filteredPEs) {
      const ev = eventLookupMap.get(pe.event_id);
      const cat = (ev?.category || "").toLowerCase().trim();
      if (categoryStatsMap.has(cat)) {
        const cur = categoryStatsMap.get(cat)!;
        cur.count++;
        if (pe.checked_in || pe.main_checked_in) {
          cur.checkedIn++;
        }
      }
    }

    const categories = Array.from(categoryStatsMap.entries())
      .map(([category, data]) => ({
        category,
        count: data.count,
        eventCount: data.eventCount,
        checkedIn: data.checkedIn,
        percentage:
          filteredPEs.length > 0
            ? Math.round((data.count / filteredPEs.length) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // 16. Demographics (Gender & Colleges computed across all participants in scope)
    const genderCounts = { male: 0, female: 0, other: 0, unspecified: 0 };
    const collegesMap = new Map<string, { count: number; state: string | null }>();

    for (const p of participantsInScope) {
      const g = (p.gender || "").toLowerCase().trim();
      if (g === "male" || g === "m") genderCounts.male++;
      else if (g === "female" || g === "f") genderCounts.female++;
      else if (g && g !== "select...") genderCounts.other++;
      else genderCounts.unspecified++;

      if (p.college && p.college.trim()) {
        const col = p.college.trim();
        const cur = collegesMap.get(col) || { count: 0, state: p.state || null };
        cur.count++;
        collegesMap.set(col, cur);
      }
    }

    const topColleges = Array.from(collegesMap.entries())
      .map(([college, data]) => ({
        college,
        count: data.count,
        state: data.state,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // 17. Accommodation Analytics (if authorized)
    let accommodations = null;
    if (isMaster || auth.accommodation_access) {
      let paidBookings = 0;
      let pendingBookings = 0;
      let checkedInBookings = 0;
      const dateOccupancyMap = new Map<string, number>();

      for (const a of relevantAccs) {
        if (a.status === "paid" || a.status === "confirmed") paidBookings++;
        else if (a.status === "pending" || a.status === "unpaid") pendingBookings++;

        if (a.checked_in) checkedInBookings++;

        if (a.start_date) {
          dateOccupancyMap.set(
            a.start_date,
            (dateOccupancyMap.get(a.start_date) || 0) + 1
          );
        }
      }

      accommodations = {
        totalBookings: relevantAccs.length,
        paidBookings,
        pendingBookings,
        checkedIn: checkedInBookings,
        dateOccupancy: Array.from(dateOccupancyMap.entries())
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        ...(isMaster
          ? {
              expectedRevenue: accExpectedRevenue,
              paidRevenue: accPaidRevenue,
              outstandingRevenue: accOutstandingRevenue,
            }
          : {}),
      };
    }

    // 18. Registration Timeline (Daily counts over last 14 days)
    const timelineMap = new Map<string, number>();
    for (const pe of filteredPEs) {
      if (pe.created_at) {
        const dateStr = pe.created_at.slice(0, 10);
        timelineMap.set(dateStr, (timelineMap.get(dateStr) || 0) + 1);
      }
    }

    const timeline = Array.from(timelineMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);

    return NextResponse.json(
      {
        success: true,
        isMaster,
        role: auth.role,
        assignedCategory: auth.assigned_category,
        assignedEvents: auth.assigned_events,
        availableCategories,
        selectedCategory,
        availableColleges,
        selectedCollege,
        categoryScopeLabel: formatCategoryScopeLabel(auth.assigned_category),
        accommodationAccess: auth.accommodation_access,
        overview: {
          totalParticipants,
          eventParticipantCount,
          accommodationOnlyCount,
          withAccommodation,
          withoutAccommodation,
          totalHeadcount,
          headcountWithAccommodation,
          headcountWithoutAccommodation,
          totalRegistrations,
          registrationsWithAccommodation,
          registrationsWithoutAccommodation,
          totalTeams,
          totalSolo,
          totalCheckedIn,
          checkInRate,
          totalColleges: collegesMap.size,
          totalStates: stateCountsMap.size,
          revenue,
        },
        stateWise,
        eventWise,
        categories,
        demographics: {
          gender: genderCounts,
          topColleges,
        },
        timeline,
        accommodations,
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err: any) {
    console.error("Admin Analytics API error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load analytics" },
      { status: 500 }
    );
  }
}
