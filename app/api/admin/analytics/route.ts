import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import {
  parseAdminCategories,
  formatCategoryScopeLabel,
  VALID_ADMIN_CATEGORIES,
} from "@/lib/admin/scope";
import { INDIAN_STATES_AND_UT } from "@/lib/states";

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

    // 3. Parse and Validate Requested Category Filter (?category=...)
    let queryCategory: string | null = null;
    if (request) {
      try {
        const url = new URL(request.url);
        queryCategory = url.searchParams.get("category")?.trim().toLowerCase() || null;
      } catch {
        queryCategory = null;
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
          categoryScopeLabel: formatCategoryScopeLabel(auth.assigned_category),
          accommodationAccess: auth.accommodation_access,
          overview: {
            totalParticipants: 0,
            totalRegistrations: 0,
            totalTeams: 0,
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

    // 6. Fetch Participant Events (non-cancelled) for Scoped Events
    let peQuery = supabaseAdmin
      .from("participant_events")
      .select(
        "id, participant_id, event_id, registration_status, payment_status, payment_amount, team_name, checked_in, main_checked_in, created_at"
      )
      .neq("registration_status", "cancelled");

    if (!isMaster || scopedEventIds.length < allEvents.length) {
      peQuery = peQuery.in("event_id", scopedEventIds);
    }

    const { data: rawPEs, error: peError } = await peQuery;
    if (peError) throw peError;

    const allScopedPEs = rawPEs || [];

    // Filter participant_events to those in filteredEvents (for the selected category)
    const participantEvents = allScopedPEs.filter((pe) =>
      filteredEventIdSet.has(pe.event_id)
    );

    const relevantParticipantIds = Array.from(
      new Set(participantEvents.map((pe) => pe.participant_id))
    );

    // 7. Fetch Participants for the relevantParticipantIds
    let participants: any[] = [];
    if (relevantParticipantIds.length > 0) {
      const { data: rawParts, error: partError } = await supabaseAdmin
        .from("participants")
        .select("id, participant_id, name, college, gender, state, created_at");

      if (partError) throw partError;
      const relevantSet = new Set(relevantParticipantIds);
      participants = (rawParts || []).filter((p) => relevantSet.has(p.id));
    }
    const participantMap = new Map(participants.map((p) => [p.id, p]));

    // 8. Fetch Accommodations (only if master or has accommodation_access)
    let rawAccs: any[] = [];
    if (isMaster || auth.accommodation_access) {
      const { data: accsData } = await supabaseAdmin
        .from("participant_accommodations")
        .select("id, participant_id, status, amount, start_date, end_date, checked_in")
        .neq("status", "cancelled");
      rawAccs = accsData || [];
    }

    // ==========================================
    // AGGREGATIONS FOR SELECTED CATEGORY / SCOPE
    // ==========================================

    // A. Overview Calculations
    const totalParticipants = participants.length;
    const totalRegistrations = participantEvents.length;

    const teamsSet = new Set<string>();
    let totalCheckedIn = 0;
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

    for (const pe of participantEvents) {
      if (pe.team_name && pe.team_name.trim()) {
        teamsSet.add(`${pe.event_id}:::${pe.team_name.trim().toLowerCase()}`);
      }

      const isCheckedIn = pe.checked_in || pe.main_checked_in;
      if (isCheckedIn) totalCheckedIn++;

      const amt = Number(pe.payment_amount) || 0;
      const isPaid =
        pe.payment_status === "confirmed" || pe.payment_status === "paid";
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

    const checkInRate =
      totalRegistrations > 0
        ? Math.round((totalCheckedIn / totalRegistrations) * 100)
        : 0;

    // Accommodation Revenue (Master only)
    let accExpectedRevenue = 0;
    let accPaidRevenue = 0;
    let accOutstandingRevenue = 0;

    for (const acc of rawAccs) {
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

    // B. State-Wise Breakdown
    const stateCountsMap = new Map<
      string,
      {
        participantCount: number;
        eventRegistrations: number;
        collegesMap: Map<string, number>;
      }
    >();

    // Index known states for case-insensitive matching
    const knownStatesLower = new Map<string, string>();
    for (const st of INDIAN_STATES_AND_UT) {
      knownStatesLower.set(st.toLowerCase(), st);
    }

    for (const p of participants) {
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

    // Count registrations per state for selected category
    for (const pe of participantEvents) {
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

    // C. Event-Wise Breakdown
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
          // Revenue field ONLY included for master admins!
          ...(isMaster ? { revenue: stats.revenue } : {}),
        };
      })
      .sort((a, b) => b.count - a.count);

    // D. Category Breakdown (computed across permitted categories in scopedEvents)
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

    const eventMap = new Map(allEvents.map((e) => [e.id, e]));
    for (const pe of allScopedPEs) {
      const ev = eventMap.get(pe.event_id);
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
          allScopedPEs.length > 0
            ? Math.round((data.count / allScopedPEs.length) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // E. Demographics (Gender & Colleges for selected category)
    const genderCounts = { male: 0, female: 0, other: 0, unspecified: 0 };
    const collegesMap = new Map<string, { count: number; state: string | null }>();

    for (const p of participants) {
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
      .slice(0, 15);

    // F. Accommodation Analytics (if authorized)
    let accommodations = null;
    if (isMaster || auth.accommodation_access) {
      let paidBookings = 0;
      let pendingBookings = 0;
      let checkedInBookings = 0;
      const dateOccupancyMap = new Map<string, number>();

      for (const a of rawAccs) {
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
        totalBookings: rawAccs.length,
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

    // G. Registration Timeline (Daily Counts over last 14 days)
    const timelineMap = new Map<string, number>();
    for (const pe of participantEvents) {
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
        categoryScopeLabel: formatCategoryScopeLabel(auth.assigned_category),
        accommodationAccess: auth.accommodation_access,
        overview: {
          totalParticipants,
          totalRegistrations,
          totalTeams: teamsSet.size,
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
