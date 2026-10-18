import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { parseAdminCategories } from "@/lib/admin/scope";
import { INDIAN_STATES_AND_UT } from "@/lib/states";

export const dynamic = "force-dynamic";

export async function GET() {
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
  const assignedEvents = isMaster ? [] : (auth.assigned_events || []);
  const isScoped = !isMaster && (!!assignedCategory || assignedEvents.length > 0);

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
    let allowedEventIds: string[] | null = null;

    if (isScoped) {
      const allowedCategories = parseAdminCategories(assignedCategory);
      allowedEventIds = allEvents
        .filter((ev) => {
          if (assignedEvents.includes(ev.id)) return true;
          if (
            allowedCategories.length > 0 &&
            ev.category &&
            allowedCategories.includes(ev.category.toLowerCase())
          ) {
            return true;
          }
          return false;
        })
        .map((ev) => ev.id);
    }

    const filteredEvents = allowedEventIds
      ? allEvents.filter((ev) => allowedEventIds!.includes(ev.id))
      : allEvents;

    // 2. Fetch Participant Events (non-cancelled)
    let peQuery = supabaseAdmin
      .from("participant_events")
      .select("id, participant_id, event_id, registration_status, payment_status, payment_amount, team_name, checked_in, main_checked_in, created_at")
      .neq("registration_status", "cancelled");

    if (allowedEventIds) {
      if (allowedEventIds.length === 0) {
        // Scoped admin with no events
        return NextResponse.json(
          {
            success: true,
            isMaster: false,
            role: auth.role,
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
      peQuery = peQuery.in("event_id", allowedEventIds);
    }

    const { data: rawPEs, error: peError } = await peQuery;
    if (peError) throw peError;

    const participantEvents = rawPEs || [];
    const relevantParticipantIds = Array.from(
      new Set(participantEvents.map((pe) => pe.participant_id))
    );

    // 3. Fetch Participants
    let partQuery = supabaseAdmin
      .from("participants")
      .select("id, participant_id, name, college, gender, state, created_at");

    if (isScoped && relevantParticipantIds.length > 0) {
      // Chunking if many
      partQuery = partQuery.in("id", relevantParticipantIds.slice(0, 5000));
    }

    const { data: rawParts, error: partError } = await partQuery;
    if (partError) throw partError;

    const participants = (rawParts || []).filter((p) =>
      isScoped ? relevantParticipantIds.includes(p.id) : true
    );
    const participantMap = new Map(participants.map((p) => [p.id, p]));

    // 4. Fetch Accommodations (only if master or has accommodation_access)
    let rawAccs: any[] = [];
    if (isMaster || auth.accommodation_access) {
      const { data: accsData } = await supabaseAdmin
        .from("participant_accommodations")
        .select("id, participant_id, status, amount, start_date, end_date, checked_in")
        .neq("status", "cancelled");
      rawAccs = accsData || [];
    }

    // ==========================================
    // AGGREGATIONS
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
      const isPaid = pe.payment_status === "confirmed" || pe.payment_status === "paid";
      const isUnpaid = pe.payment_status === "pending" || pe.payment_status === "unpaid";

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
    const revenue = isMaster
      ? {
          totalExpected: eventExpectedRevenue + accExpectedRevenue,
          totalPaid: eventPaidRevenue + accPaidRevenue,
          totalOutstanding: eventOutstandingRevenue + accOutstandingRevenue,
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

    // Also count registrations per state
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

    // Category Breakdown
    const categoryMap = new Map<
      string,
      { count: number; eventCount: number; checkedIn: number }
    >();

    for (const ev of eventWise) {
      const cat = ev.category.toLowerCase();
      const cur = categoryMap.get(cat) || { count: 0, eventCount: 0, checkedIn: 0 };
      cur.count += ev.count;
      cur.eventCount++;
      cur.checkedIn += ev.checkedIn;
      categoryMap.set(cat, cur);
    }

    const categories = Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        count: data.count,
        eventCount: data.eventCount,
        checkedIn: data.checkedIn,
        percentage:
          totalRegistrations > 0
            ? Math.round((data.count / totalRegistrations) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // D. Demographics (Gender & Colleges)
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

    // E. Accommodation Analytics (if authorized)
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

    // F. Registration Timeline (Daily Counts over last 14 days)
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
