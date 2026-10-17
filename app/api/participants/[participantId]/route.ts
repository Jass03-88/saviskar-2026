/**
 * GET /api/participants/[participantId]
 *
 * Public participant lookup for the registration form with ownership challenge.
 *
 * Requires both participantId and the registered email address to prevent
 * unauthorized profile enumeration and PII harvesting.
 *
 * Rate limited to 10 requests/minute per IP.
 * PII is masked and response is minimized to only the fields consumed by the frontend.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimitAsync, getClientIp } from "@/lib/rate-limit";

const PARTICIPANT_ID_PATTERN = /^SVK26-[A-Z0-9]{8}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 1) {
    return `***${email.slice(atIndex)}`;
  }
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  return `${local[0]}***${domain}`;
}

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.replace(/\s+/g, "");
  if (cleaned.length >= 6) {
    return `${cleaned.slice(0, 2)}*****${cleaned.slice(-2)}`;
  }
  return "******";
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ participantId: string }>;
  }
) {
  // ─── Rate Limiting (10 requests per minute per IP) ──────
  const clientIp = getClientIp(request);
  const rateLimit = await checkRateLimitAsync(`lookup:${clientIp}`, 10, 60 * 1000);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Too many lookup attempts. Please wait a moment and try again.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfter),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const { participantId: rawParticipantId } = await context.params;
  const participantId = rawParticipantId.trim().toUpperCase();

  if (!PARTICIPANT_ID_PATTERN.test(participantId)) {
    return jsonResponse(
      {
        success: false,
        error: "Invalid participant ID.",
      },
      400
    );
  }

  const { searchParams } = new URL(request.url);
  const rawEmail = searchParams.get("email");

  if (!rawEmail || !rawEmail.trim()) {
    return jsonResponse(
      {
        success: false,
        error: "Participant ID and registered email are required.",
      },
      400
    );
  }

  const normalizedEmail = rawEmail.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return jsonResponse(
      {
        success: false,
        error: "Invalid email format.",
      },
      400
    );
  }

  // ─── Supabase Admin ─────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("Public participant lookup: Missing Supabase config.");
    return jsonResponse(
      {
        success: false,
        error: "Participant lookup is not configured.",
      },
      500
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // ─── Look Up Participant ────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from("participants")
    .select(
      `
      id,
      participant_id,
      name,
      college,
      email,
      phone,
      gender,
      state,
      participant_events (
        id,
        event_id,
        registration_status,
        payment_status,
        payment_amount,
        team_name,
        checked_in,
        checked_in_at,
        is_archived,
        events (
          id,
          name,
          category,
          registration_type,
          registration_fee,
          payment_type,
          payment_unit
        )
      ),
      participant_event_members (
        id,
        participant_event_id,
        is_team_leader,
        participant_events (
          id,
          event_id,
          registration_status,
          payment_status,
          payment_amount,
          team_name,
          checked_in,
          checked_in_at,
          is_archived,
          events (
            id,
            name,
            category,
            registration_type,
            registration_fee,
            payment_type,
            payment_unit
          )
        )
      ),
      participant_accommodations (
        id,
        accommodation_plan_id,
        start_date,
        end_date,
        duration_days,
        amount,
        currency,
        status,
        room_id,
        hostel_id,
        checked_in,
        checked_in_at,
        checked_out,
        checked_out_at,
        accommodation_plans (
          id,
          name,
          slug,
          duration,
          price
        ),
        hostels (
          id,
          name
        ),
        hostel_rooms (
          id,
          room_number
        )
      )
    `
    )
    .eq("participant_id", participantId)
    .maybeSingle();

  if (error) {
    console.error("Participant lookup failed:", error);
    return jsonResponse(
      {
        success: false,
        error: "Unable to look up this participant.",
      },
      500
    );
  }

  // Ownership verification: compare normalized email against authoritative participant email
  // If no record or email mismatch, return non-enumerating 404
  if (!data || !data.email || data.email.trim().toLowerCase() !== normalizedEmail) {
    return jsonResponse(
      {
        success: false,
        error: "Participant not found.",
      },
      404
    );
  }

  // ─── Format Events (Minimizing to only UI-required fields) ───
  type RawEventRecord = {
    id: string;
    event_id: string;
    registration_status?: string | null;
    payment_status: string | null;
    payment_amount: number | null;
    team_name?: string | null;
    checked_in?: boolean | null;
    checked_in_at?: string | null;
    is_archived?: boolean | null;
    events:
      | {
          id?: string;
          name: string | null;
          category?: string | null;
          registration_type?: string | null;
          registration_fee?: number | null;
          payment_type?: string | null;
        }
      | {
          id?: string;
          name: string | null;
          category?: string | null;
          registration_type?: string | null;
          registration_fee?: number | null;
          payment_type?: string | null;
        }[]
      | null;
  };

  const directEvents = (data.participant_events as RawEventRecord[] | null) ?? [];
  const memberRows =
    (data.participant_event_members as Array<{
      id: string;
      participant_event_id: string;
      is_team_leader?: boolean | null;
      participant_events: RawEventRecord | RawEventRecord[] | null;
    }> | null) ?? [];

  const eventsByParticipantEventId = new Map<
    string,
    {
      participantEventId: string;
      eventId: string;
      eventName: string;
      category: string | null;
      registrationType: string;
      teamName: string | null;
      isTeamLeader: boolean;
      paymentStatus: string | null;
      paymentAmount: number | null;
      registrationStatus: string | null;
      checkedIn: boolean;
      teamMembers?: Array<{
        id: string;
        name: string;
        email: string;
        phone: string;
        isTeamLeader: boolean;
        participantId: string | null;
        college: string | null;
        accommodations: Array<{
          id: string;
          planName: string;
          planSlug: string;
          startDate: string;
          endDate: string;
          durationDays: number;
          amount: number;
          status: string;
        }>;
      }>;
    }
  >();

  // 1. Process direct events (individual or team events where this participant is the registrant/leader)
  for (const event of directEvents) {
    if (!event || event.is_archived === true) continue;
    const rawEvt = Array.isArray(event.events) ? event.events[0] : event.events;
    const eventName = rawEvt?.name ?? "Unknown event";
    const category = rawEvt?.category ?? null;
    const registrationType = rawEvt?.registration_type ?? (event.team_name ? "team" : "individual");
    const isTeamLeader = registrationType === "team";

    eventsByParticipantEventId.set(event.id, {
      participantEventId: event.id,
      eventId: event.event_id,
      eventName,
      category,
      registrationType,
      teamName: event.team_name ?? null,
      isTeamLeader,
      paymentStatus: event.payment_status,
      paymentAmount: event.payment_amount,
      registrationStatus: event.registration_status ?? "confirmed",
      checkedIn: Boolean(event.checked_in),
    });
  }

  // 2. Process team member events (events where this participant is registered as a team member)
  for (const memberRow of memberRows) {
    const event = Array.isArray(memberRow.participant_events)
      ? memberRow.participant_events[0]
      : memberRow.participant_events;

    if (!event || event.is_archived === true) continue;
    if (eventsByParticipantEventId.has(event.id)) continue;

    const rawEvt = Array.isArray(event.events) ? event.events[0] : event.events;
    const eventName = rawEvt?.name ?? "Unknown event";
    const category = rawEvt?.category ?? null;
    const registrationType = rawEvt?.registration_type ?? "team";
    const isTeamLeader = memberRow.is_team_leader === true;

    eventsByParticipantEventId.set(event.id, {
      participantEventId: event.id,
      eventId: event.event_id,
      eventName,
      category,
      registrationType,
      teamName: event.team_name ?? null,
      isTeamLeader,
      paymentStatus: event.payment_status,
      paymentAmount: event.payment_amount,
      registrationStatus: event.registration_status ?? "confirmed",
      checkedIn: Boolean(event.checked_in),
    });
  }

  // 3. Process team members for team events
  const teamParticipantEventIds = Array.from(eventsByParticipantEventId.keys());
  if (teamParticipantEventIds.length > 0) {
    let memberQuery: any = supabaseAdmin
      .from("participant_event_members")
      .select(`
        id,
        name,
        email,
        phone,
        is_team_leader,
        participant_event_id,
        participant_id,
        participants (
          id,
          participant_id,
          college
        )
      `);

    if (typeof memberQuery?.in === "function") {
      memberQuery = memberQuery.in("participant_event_id", teamParticipantEventIds);
    }
    if (typeof memberQuery?.order === "function") {
      memberQuery = memberQuery.order("is_team_leader", { ascending: false });
    }

    const { data: teamMembersData } = (await memberQuery) ?? { data: [] };

    const memberParticipantUuids = Array.from(
      new Set(
        (teamMembersData ?? [])
          .map((m: any) => m.participant_id || m.participants?.id)
          .filter(Boolean)
      )
    );

    const memberAccsByParticipantId = new Map<string, any[]>();
    if (memberParticipantUuids.length > 0) {
      let accQuery: any = supabaseAdmin
        .from("participant_accommodations")
        .select(`
          id,
          participant_id,
          start_date,
          end_date,
          duration_days,
          amount,
          currency,
          status,
          accommodation_plans (
            name,
            slug
          )
        `);

      if (typeof accQuery?.in === "function") {
        accQuery = accQuery.in("participant_id", memberParticipantUuids);
      }
      if (typeof accQuery?.neq === "function") {
        accQuery = accQuery.neq("status", "cancelled");
      }

      const { data: memberAccs } = (await accQuery) ?? { data: [] };

      if (memberAccs) {
        for (const mAcc of memberAccs) {
          const list = memberAccsByParticipantId.get(mAcc.participant_id) || [];
          const rawPlan = Array.isArray(mAcc.accommodation_plans)
            ? mAcc.accommodation_plans[0]
            : mAcc.accommodation_plans;
          list.push({
            id: mAcc.id,
            planName: rawPlan?.name || "Accommodation",
            planSlug: rawPlan?.slug || "",
            startDate: mAcc.start_date,
            endDate: mAcc.end_date,
            durationDays: mAcc.duration_days,
            amount: Number(mAcc.amount) || 0,
            status: mAcc.status,
          });
          memberAccsByParticipantId.set(mAcc.participant_id, list);
        }
      }
    }

    if (teamMembersData) {
      for (const m of teamMembersData as any[]) {
        const ev = eventsByParticipantEventId.get(m.participant_event_id);
        if (ev) {
          if (!ev.teamMembers) ev.teamMembers = [];
          const pUuid = m.participant_id || m.participants?.id;
          ev.teamMembers.push({
            id: m.id,
            name: m.name,
            email: maskEmail(m.email || ""),
            phone: m.phone ? maskPhone(m.phone) : "",
            isTeamLeader: m.is_team_leader === true,
            participantId: m.participants?.participant_id || null,
            college: m.participants?.college || null,
            accommodations: memberAccsByParticipantId.get(pUuid) || [],
          });
        }
      }
    }
  }

  // ─── Format Accommodations ──────────────────────────────
  type RawAccRecord = {
    id: string;
    start_date: string;
    end_date: string;
    duration_days: number;
    amount: number;
    currency: string | null;
    status: string;
    room_id?: string | null;
    hostel_id?: string | null;
    checked_in?: boolean | null;
    checked_in_at?: string | null;
    checked_out?: boolean | null;
    checked_out_at?: string | null;
    accommodation_plans:
      | { name: string; slug: string; duration?: number; price?: number }
      | { name: string; slug: string; duration?: number; price?: number }[]
      | null;
    hostels?: { id: string; name: string } | { id: string; name: string }[] | null;
    hostel_rooms?: { id: string; room_number: string } | { id: string; room_number: string }[] | null;
  };

  const rawAccs = (data.participant_accommodations as RawAccRecord[] | null) ?? [];
  const accommodations = rawAccs
    .filter((acc) => acc && acc.status !== "cancelled")
    .map((acc) => {
      const rawPlan = Array.isArray(acc.accommodation_plans)
        ? acc.accommodation_plans[0]
        : acc.accommodation_plans;
      const rawHostel = Array.isArray(acc.hostels) ? acc.hostels[0] : acc.hostels;
      const rawRoom = Array.isArray(acc.hostel_rooms) ? acc.hostel_rooms[0] : acc.hostel_rooms;
      return {
        id: acc.id,
        planName: rawPlan?.name ?? "Accommodation",
        planSlug: rawPlan?.slug ?? "",
        startDate: acc.start_date,
        endDate: acc.end_date,
        durationDays: acc.duration_days,
        amount: Number(acc.amount) || 0,
        currency: acc.currency || "INR",
        status: acc.status,
        allocationStatus: acc.room_id ? "allocated" : "awaiting_allocation",
        hostelName: rawHostel?.name || null,
        roomNumber: rawRoom?.room_number || null,
        checkedIn: Boolean(acc.checked_in),
        checkedInAt: acc.checked_in_at || null,
        checkedOut: Boolean(acc.checked_out),
        checkedOutAt: acc.checked_out_at || null,
      };
    });

  // ─── Summary Totals ──────────────────────────────────────
  let totalPayable = 0;
  let totalPaid = 0;
  let totalPending = 0;

  for (const ev of eventsByParticipantEventId.values()) {
    const amt = Number(ev.paymentAmount) || 0;
    if (amt > 0) {
      totalPayable += amt;
      if (ev.paymentStatus === "paid") {
        totalPaid += amt;
      } else if (ev.paymentStatus === "pending") {
        totalPending += amt;
      }
    }
  }

  for (const acc of accommodations) {
    const amt = Number(acc.amount) || 0;
    if (amt > 0) {
      totalPayable += amt;
      if (acc.status === "paid") {
        totalPaid += amt;
      } else if (acc.status === "pending" || acc.status === "unpaid") {
        totalPending += amt;
      }
    }
  }

  return jsonResponse({
    success: true,
    participant: {
      participantId: data.participant_id,
      name: data.name,
      college: data.college,
      email: maskEmail(data.email),
      phone: maskPhone(data.phone),
      gender: data.gender ?? null,
      state: data.state ?? null,
    },
    events: Array.from(eventsByParticipantEventId.values()),
    accommodations,
    summary: {
      totalPayable,
      totalPaid,
      totalPending,
    },
  });
}
