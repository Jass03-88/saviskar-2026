import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/supabase/server";
import { getCanonicalStayLabel } from "@/lib/accommodation-dates";
import { evaluateEventPaymentStatus } from "@/lib/admin/check-in-rules";

const PARTICIPANT_ID_PATTERN = /^SVK26-[A-Z0-9]{8}$/i;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export type TeamMemberAccommodation = {
  hasBooking: boolean;
  bookingStatus: string | null;
  planName: string | null;
  durationDays: number | null;
  startDate: string | null;
  endDate: string | null;
  checkoutDate: string | null;
  stayLabel: string | null;
  amountDue: number | null;
  amountPaid: number | null;
  balance: number | null;
  paymentStatus: string | null;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedOut: boolean;
  checkedOutAt: string | null;
  hostelName: string | null;
  roomNumber: string | null;
  floorNumber: string | null;
};

export type TeamRosterMember = {
  id: string;
  participantRecordId?: string | null;
  participantId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  college?: string | null;
  gender?: string | null;
  state?: string | null;
  isTeamLeader: boolean;
  isScannedParticipant: boolean;
  eventRegistrationStatus?: string | null;
  eventPaymentStatus?: string | null;
  eventCheckedIn?: boolean;
  eventCheckedInAt?: string | null;
  mainCheckedIn?: boolean;
  mainCheckedInAt?: string | null;
  accommodation: TeamMemberAccommodation | null;
};

export type TeamRoster = {
  teamName: string | null;
  leaderParticipantId: string | null;
  leaderName: string | null;
  members: TeamRosterMember[];
};

  export type ScannerWarning = {
  id: string;
  code?: string;
  type: "warning" | "info" | "review";
  title: string;
  message: string;
};

function formatAccommodationRecord(acc: any): TeamMemberAccommodation {
  if (!acc) {
    return {
      hasBooking: false,
      bookingStatus: "none",
      planName: null,
      durationDays: null,
      startDate: null,
      endDate: null,
      checkoutDate: null,
      stayLabel: null,
      amountDue: 0,
      amountPaid: 0,
      balance: 0,
      paymentStatus: "not_booked",
      checkedIn: false,
      checkedInAt: null,
      checkedOut: false,
      checkedOutAt: null,
      hostelName: null,
      roomNumber: null,
      floorNumber: null,
    };
  }

  const planName = acc.accommodation_plans?.name || "Campus Accommodation";
  const durationDays = acc.duration_days || acc.accommodation_plans?.duration || 1;
  const stayLabel = getCanonicalStayLabel(acc.start_date, durationDays);
  const isPaid = acc.status === "paid";
  const amtDue =
    typeof acc.amount === "number" && acc.amount > 0
      ? acc.amount
      : (acc.accommodation_plans?.price || 0);
  const amtPaid = isPaid ? amtDue : 0;
  const balance = isPaid ? 0 : amtDue;
  const paymentStatus =
    acc.status ||
    (acc.payment_orders?.status
      ? String(acc.payment_orders.status).toLowerCase()
      : "unpaid");

  return {
    hasBooking: true,
    bookingStatus: acc.status,
    planName,
    durationDays,
    startDate: acc.start_date,
    endDate: acc.end_date,
    checkoutDate: acc.end_date,
    stayLabel,
    amountDue: amtDue,
    amountPaid: amtPaid,
    balance,
    paymentStatus,
    checkedIn: acc.checked_in ?? false,
    checkedInAt: acc.checked_in_at ?? null,
    checkedOut: acc.checked_out ?? false,
    checkedOutAt: acc.checked_out_at ?? null,
    hostelName: acc.hostels?.name ?? null,
    roomNumber: acc.hostel_rooms?.room_number ?? null,
    floorNumber: acc.hostel_rooms?.hostel_floors?.floor_number ?? null,
  };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ participantId: string }> }
) {
  const auth = await requireAdmin();

  if (auth.error) {
    return response(
      {
        success: false,
        error:
          auth.error === "MFA_REQUIRED"
            ? "Master Admin MFA verification required."
            : auth.error,
      },
      auth.status
    );
  }

  const { participantId: rawParticipantId } = await context.params;

  const participantId = rawParticipantId.trim().toUpperCase();

  if (!PARTICIPANT_ID_PATTERN.test(participantId)) {
    return response(
      {
        success: false,
        error: "Invalid participant ID.",
      },
      400
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("Participant lookup is missing Supabase server configuration.");

    return response(
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
        id_card_storage_path,
        participant_events(
          id,
          event_id,
          participant_id,
          registration_status,
          payment_status,
          payment_amount,
          team_name,
          checked_in,
          checked_in_at,
          main_checked_in,
          main_checked_in_at,
          registration_group_id,
          events(id, name, category, registration_fee, payment_type, payment_unit, registration_type, min_team_size, max_team_size)
        ),
        participant_event_members (
          id,
          participant_event_id,
          participant_id,
          name,
          email,
          phone,
          is_team_leader,
          participant_events (
            id,
            event_id,
            participant_id,
            registration_status,
            payment_status,
            payment_amount,
            team_name,
            checked_in,
            checked_in_at,
            main_checked_in,
            main_checked_in_at,
            registration_group_id,
            events(id, name, category, registration_fee, payment_type, payment_unit, registration_type, min_team_size, max_team_size)
          )
        ),
        participant_accommodations (
          id,
          participant_id,
          status,
          start_date,
          end_date,
          duration_days,
          amount,
          checked_in,
          checked_in_at,
          checked_out,
          checked_out_at,
          accommodation_plans (id, name, slug, price, duration),
          hostels (name),
          hostel_rooms (room_number, hostel_floors (floor_number)),
          payment_orders (id, order_reference, status, amount)
        )
      `
    )
    .eq("participant_id", participantId)
    .maybeSingle();

  let dataResult = data;
  let schemaWarning: string | undefined;

  if (error && error.code === "42703") {
    console.warn("Main check-in columns missing. Falling back to legacy query for participant.");
    schemaWarning = "Main check-in migration is not applied.";

    const fallback = await supabaseAdmin
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
          id_card_storage_path,
          participant_events(
            id,
            event_id,
            participant_id,
            registration_status,
            payment_status,
            payment_amount,
            team_name,
            checked_in,
            checked_in_at,
            events(id, name, category, registration_fee, payment_type, payment_unit, registration_type, min_team_size, max_team_size)
          ),
          participant_event_members (
            id,
            participant_event_id,
            participant_id,
            name,
            email,
            phone,
            is_team_leader,
            participant_events (
              id,
              event_id,
              participant_id,
              registration_status,
              payment_status,
              payment_amount,
              team_name,
              checked_in,
              checked_in_at,
              events(id, name, category, registration_fee, payment_type, payment_unit, registration_type, min_team_size, max_team_size)
            )
          ),
          participant_accommodations (
            id,
            participant_id,
            status,
            start_date,
            end_date,
            duration_days,
            amount,
            checked_in,
            checked_in_at,
            checked_out,
            checked_out_at,
            accommodation_plans (id, name, slug, price, duration),
            hostels (name),
            hostel_rooms (room_number, hostel_floors (floor_number)),
            payment_orders (id, order_reference, status, amount)
          )
        `
      )
      .eq("participant_id", participantId)
      .maybeSingle();

    if (fallback.error) {
      console.error("Participant fallback lookup failed:", fallback.error);
      return response(
        {
          success: false,
          error: "Unable to look up this participant.",
        },
        500
      );
    }

    dataResult = fallback.data as any;
  } else if (error) {
    console.error("Participant lookup failed:", error);

    return response(
      {
        success: false,
        error: "Unable to look up this participant.",
      },
      500
    );
  }

  if (!dataResult) {
    return response(
      {
        success: false,
        error: "Participant not found.",
      },
      404
    );
  }

  type RawEventRecord = {
    id: string;
    event_id: string;
    participant_id?: string | null;
    registration_status: string | null;
    payment_status: string | null;
    payment_amount: number | null;
    team_name: string | null;
    checked_in: boolean | null;
    checked_in_at: string | null;
    main_checked_in?: boolean | null;
    main_checked_in_at?: string | null;
    registration_group_id?: string | null;
    events:
      | {
          id?: string;
          name: string | null;
          category?: string | null;
          registration_fee?: number | null;
          payment_type?: string | null;
          payment_unit?: string | null;
          registration_type?: string | null;
          min_team_size?: number | null;
          max_team_size?: number | null;
        }
      | {
          id?: string;
          name: string | null;
          category?: string | null;
          registration_fee?: number | null;
          payment_type?: string | null;
          payment_unit?: string | null;
          registration_type?: string | null;
          min_team_size?: number | null;
          max_team_size?: number | null;
        }[]
      | null;
  };

  const directEvents =
    (dataResult.participant_events as Array<RawEventRecord> | null) ?? [];

  const memberRows =
    (dataResult.participant_event_members as Array<{
      id: string;
      participant_event_id: string;
      participant_id?: string | null;
      participant_events: RawEventRecord | RawEventRecord[] | null;
    }> | null) ?? [];

  const eventsByParticipantEventId = new Map<string, RawEventRecord>();

  for (const event of directEvents) {
    if (!event) continue;
    eventsByParticipantEventId.set(event.id, event);
  }

  for (const memberRow of memberRows) {
    const event = Array.isArray(memberRow.participant_events)
      ? memberRow.participant_events[0]
      : memberRow.participant_events;

    if (!event) continue;
    eventsByParticipantEventId.set(event.id, event);
  }

  const combinedEvents = Array.from(eventsByParticipantEventId.values());
  const peIds = combinedEvents.map((e) => e.id);

  // 1. Fetch team members across all combined events
  const teamMembersByPeId = new Map<string, any[]>();
  if (peIds.length > 0) {
    try {
      const { data: membersData, error: membersError } = await supabaseAdmin
        .from("participant_event_members")
        .select(`
          id,
          participant_event_id,
          participant_id,
          name,
          email,
          phone,
          is_team_leader,
          participants (
            id,
            participant_id,
            name,
            college,
            email,
            phone,
            gender,
            state,
            id_card_storage_path
          )
        `)
        .in("participant_event_id", peIds);

      if (membersData && !membersError) {
        for (const m of membersData) {
          const list = teamMembersByPeId.get(m.participant_event_id) || [];
          list.push(m);
          teamMembersByPeId.set(m.participant_event_id, list);
        }
      }
    } catch (mErr) {
      console.warn("Could not load team members:", mErr);
    }
  }

  // 2. Fetch accommodation for all members and leaders
  const allParticipantUuids = Array.from(
    new Set([
      dataResult.id,
      ...combinedEvents.map((e: any) => e.participant_id),
      ...Array.from(teamMembersByPeId.values()).flatMap((members) =>
        members.map((m: any) => {
          const p = Array.isArray(m.participants) ? m.participants[0] : m.participants;
          return m.participant_id || p?.id;
        })
      ),
    ])
  ).filter(Boolean);

  const allAccMap = new Map<string, any[]>();

  // Initialize with scanned participant's embedded accommodations
  if (Array.isArray(dataResult.participant_accommodations) && dataResult.id) {
    allAccMap.set(dataResult.id, dataResult.participant_accommodations);
  }

  if (allParticipantUuids.length > 0) {
    try {
      const { data: allAccs, error: accsErr } = await supabaseAdmin
        .from("participant_accommodations")
        .select(`
          id,
          participant_id,
          status,
          start_date,
          end_date,
          duration_days,
          amount,
          checked_in,
          checked_in_at,
          checked_out,
          checked_out_at,
          accommodation_plans (id, name, slug, price, duration),
          hostels (name),
          hostel_rooms (room_number, hostel_floors (floor_number)),
          payment_orders (id, order_reference, status, amount)
        `)
        .in("participant_id", allParticipantUuids);

      if (allAccs && !accsErr) {
        for (const a of allAccs) {
          const list = allAccMap.get(a.participant_id) || [];
          list.push(a);
          allAccMap.set(a.participant_id, list);
        }
      }
    } catch (accErr) {
      console.warn("Could not query all accommodations:", accErr);
    }
  }

  // 3. Faculty in-charges query
  const groupIds = Array.from(
    new Set(
      combinedEvents
        .map((e) => e.registration_group_id)
        .filter(Boolean)
    )
  ) as string[];

  let facultyIncharges: any[] = [];
  if (groupIds.length > 0) {
    try {
      const { data: facultyData } = await supabaseAdmin
        .from("faculty_incharges")
        .select(`
          id,
          registration_group_id,
          participant_id,
          participants (
            id,
            name,
            college,
            email,
            phone,
            gender,
            state,
            id_card_storage_path
          )
        `)
        .in("registration_group_id", groupIds);

      if (facultyData) {
        const seenFaculty = new Set<string>();
        for (const f of facultyData) {
          const p = Array.isArray(f.participants) ? f.participants[0] : f.participants;
          const key = (f.participant_id || p?.id || p?.email || f.id || "").toLowerCase();
          if (key && !seenFaculty.has(key)) {
            seenFaculty.add(key);
            facultyIncharges.push(f);
          } else if (!key) {
            facultyIncharges.push(f);
          }
        }
      }
    } catch (fErr) {
      console.warn("Could not load faculty incharges:", fErr);
    }
  }

  // 4. Generate signed URLs
  let participantIdCardUrl: string | null = null;
  if (dataResult.id_card_storage_path) {
    try {
      const { data: signedData } = await supabaseAdmin.storage
        .from("id_cards")
        .createSignedUrl(dataResult.id_card_storage_path, 60 * 60);
      if (signedData) {
        participantIdCardUrl = signedData.signedUrl;
      }
    } catch (sErr) {
      console.warn("Error creating signed URL for participant ID card:", sErr);
    }
  }

  const facultyWithSignedUrls = await Promise.all(
    facultyIncharges.map(async (faculty) => {
      const participant = Array.isArray(faculty.participants)
        ? faculty.participants[0]
        : faculty.participants;
      const storagePath = participant?.id_card_storage_path ?? null;

      let signedUrl = null;
      if (storagePath) {
        try {
          const { data } = await supabaseAdmin.storage
            .from("id_cards")
            .createSignedUrl(storagePath, 60 * 60);
          if (data) signedUrl = data.signedUrl;
        } catch {
          // ignore storage error
        }
      }
      return {
        id: faculty.id,
        registrationGroupId: faculty.registration_group_id,
        participantId: faculty.participant_id,
        name: participant?.name ?? null,
        college: participant?.college ?? null,
        email: participant?.email ?? null,
        phone: participant?.phone ?? null,
        gender: participant?.gender ?? null,
        state: participant?.state ?? null,
        idCardStoragePath: storagePath,
        id_card_storage_path: storagePath,
        idCardUrl: signedUrl,
      };
    })
  );

  // 5. Format events with team roster and payments
  const formattedEvents = combinedEvents.map((event) => {
    const eventMeta = Array.isArray(event.events) ? event.events[0] : event.events;
    const membersForEvent = teamMembersByPeId.get(event.id) || [];
    const isTeam = Boolean(
      eventMeta?.registration_type === "team" ||
      event.team_name ||
      membersForEvent.length > 1
    );

    let userRole: "leader" | "member" | "individual" = "individual";
    if (isTeam) {
      if (event.participant_id && event.participant_id === dataResult.id) {
        userRole = "leader";
      } else {
        const selfMember = membersForEvent.find((m: any) => {
          const p = Array.isArray(m.participants) ? m.participants[0] : m.participants;
          return m.participant_id === dataResult.id || p?.participant_id === dataResult.participant_id;
        });
        userRole = selfMember?.is_team_leader ? "leader" : "member";
      }
    }

    const paymentDecision = evaluateEventPaymentStatus({
      registrationFee: eventMeta?.registration_fee,
      paymentType: eventMeta?.payment_type,
      paymentAmount: event.payment_amount,
      paymentStatus: event.payment_status,
      registrationStatus: event.registration_status,
    });

    const regFee = eventMeta?.registration_fee ?? 0;
    const isFree = paymentDecision.isFree;
    const feeDue = isFree ? 0 : (regFee > 0 ? regFee : (event.payment_amount ?? 0));
    const recordedPaid =
      typeof event.payment_amount === "number" && event.payment_amount > 0
        ? event.payment_amount
        : 0;
    const isPartiallyPaid = event.payment_status === "partially_paid";
    const amtPaid = isFree
      ? 0
      : paymentDecision.isPaymentComplete
      ? recordedPaid > 0
        ? recordedPaid
        : feeDue
      : isPartiallyPaid
      ? recordedPaid
      : 0;
    const balance = isFree || paymentDecision.isPaymentComplete ? 0 : Math.max(0, feeDue - amtPaid);

    let teamRoster: TeamRoster | null = null;
    if (isTeam) {
      const rosterMembers: TeamRosterMember[] = [];
      const seenMemberUuids = new Set<string>();

      // Ensure the leader is represented
      const leaderInMembers = membersForEvent.some((m: any) => {
        const p = Array.isArray(m.participants) ? m.participants[0] : m.participants;
        return m.participant_id === event.participant_id || p?.id === event.participant_id || m.is_team_leader;
      });

      if (!leaderInMembers && event.participant_id) {
        const isSelf = event.participant_id === dataResult.id;
        const leaderAccList = allAccMap.get(event.participant_id) || [];
        const leaderAcc = leaderAccList[0] || null;

        rosterMembers.push({
          id: `lead_${event.id}`,
          participantRecordId: event.participant_id,
          participantId: isSelf ? dataResult.participant_id : null,
          name: isSelf ? dataResult.name : "Team Leader",
          email: isSelf ? dataResult.email : null,
          phone: isSelf ? dataResult.phone : null,
          college: isSelf ? dataResult.college : null,
          gender: isSelf ? dataResult.gender : null,
          state: isSelf ? dataResult.state : null,
          isTeamLeader: true,
          isScannedParticipant: isSelf,
          eventRegistrationStatus: event.registration_status,
          eventPaymentStatus: event.payment_status,
          eventCheckedIn: event.checked_in ?? false,
          eventCheckedInAt: event.checked_in_at ?? null,
          mainCheckedIn: event.main_checked_in ?? false,
          mainCheckedInAt: event.main_checked_in_at ?? null,
          accommodation: formatAccommodationRecord(leaderAcc),
        });
        seenMemberUuids.add(event.participant_id);
      }

      for (const m of membersForEvent) {
        const p = Array.isArray(m.participants) ? m.participants[0] : m.participants;
        const memberUuid = m.participant_id || p?.id;
        if (memberUuid && seenMemberUuids.has(memberUuid)) {
          continue;
        }
        if (memberUuid) seenMemberUuids.add(memberUuid);

        const isScanned = Boolean(
          (memberUuid && memberUuid === dataResult.id) ||
          (p?.participant_id && p.participant_id === dataResult.participant_id)
        );
        const isLeader = Boolean(m.is_team_leader || (memberUuid && memberUuid === event.participant_id));

        const memberAccList = memberUuid ? (allAccMap.get(memberUuid) || []) : [];
        const memberAcc = memberAccList[0] || null;

        rosterMembers.push({
          id: m.id,
          participantRecordId: memberUuid || null,
          participantId: p?.participant_id || (isScanned ? dataResult.participant_id : null),
          name: m.name || p?.name || "Team Member",
          email: m.email || p?.email || null,
          phone: m.phone || p?.phone || null,
          college: p?.college || (isScanned ? dataResult.college : null),
          gender: p?.gender || (isScanned ? dataResult.gender : null),
          state: p?.state || (isScanned ? dataResult.state : null),
          isTeamLeader: isLeader,
          isScannedParticipant: isScanned,
          eventRegistrationStatus: event.registration_status,
          eventPaymentStatus: event.payment_status,
          eventCheckedIn: event.checked_in ?? false,
          eventCheckedInAt: event.checked_in_at ?? null,
          mainCheckedIn: event.main_checked_in ?? false,
          mainCheckedInAt: event.main_checked_in_at ?? null,
          accommodation: formatAccommodationRecord(memberAcc),
        });
      }

      // Leader first, then teammates
      rosterMembers.sort((a, b) => (a.isTeamLeader ? -1 : b.isTeamLeader ? 1 : 0));

      const leader = rosterMembers.find((m) => m.isTeamLeader);
      teamRoster = {
        teamName: event.team_name,
        leaderParticipantId: leader?.participantId || null,
        leaderName: leader?.name || null,
        members: rosterMembers,
      };
    }

    return {
      participantEventId: event.id,
      eventId: event.event_id,
      eventName: eventMeta?.name ?? "Unknown event",
      eventCategory: eventMeta?.category ?? null,
      registrationFee: eventMeta?.registration_fee ?? 0,
      paymentType: eventMeta?.payment_type ?? (event.payment_amount === 0 ? "free" : "paid"),
      paymentUnit: eventMeta?.payment_unit ?? null,
      registrationType: eventMeta?.registration_type ?? (isTeam ? "team" : "individual"),
      registrationStatus: event.registration_status,
      paymentStatus: event.payment_status,
      paymentAmount: event.payment_amount,
      teamName: event.team_name,
      checkedIn: event.checked_in ?? false,
      checkedInAt: event.checked_in_at,
      mainCheckedIn: event.main_checked_in ?? false,
      mainCheckedInAt: event.main_checked_in_at ?? null,
      registrationGroupId: event.registration_group_id ?? null,
      isTeamEvent: isTeam,
      userRole,
      teamRole: userRole,
      amountDue: feeDue,
      amountPaid: amtPaid,
      balance,
      team: teamRoster,
    };
  });

  // 6. Format accommodations for the scanned participant
  const scannedAccs =
    allAccMap.get(dataResult.id) ||
    (Array.isArray(dataResult.participant_accommodations)
      ? dataResult.participant_accommodations
      : []);

  const formattedAccommodations = scannedAccs.map((acc: any) => {
    const planName = acc.accommodation_plans?.name || "Campus Accommodation";
    const durationDays = acc.duration_days || acc.accommodation_plans?.duration || 1;
    const stayLabel = getCanonicalStayLabel(acc.start_date, durationDays);
    const isPaid = acc.status === "paid";
    const amtDue =
      typeof acc.amount === "number" && acc.amount > 0
        ? acc.amount
        : (acc.accommodation_plans?.price || 0);
    const amtPaid = isPaid ? amtDue : 0;
    const balance = isPaid ? 0 : amtDue;
    const paymentStatus =
      acc.status ||
      (acc.payment_orders?.status
        ? String(acc.payment_orders.status).toLowerCase()
        : "unpaid");

    return {
      id: acc.id,
      status: acc.status,
      start_date: acc.start_date,
      end_date: acc.end_date,
      checkout_date: acc.end_date,
      duration_days: durationDays,
      stayLabel,
      amountDue: amtDue,
      amountPaid: amtPaid,
      balance,
      paymentStatus,
      checked_in: acc.checked_in ?? false,
      checked_in_at: acc.checked_in_at ?? null,
      checked_out: acc.checked_out ?? false,
      checked_out_at: acc.checked_out_at ?? null,
      planName,
      hostelName: acc.hostels?.name || null,
      roomNumber: acc.hostel_rooms?.room_number || null,
      floorNumber: acc.hostel_rooms?.hostel_floors?.floor_number || null,
      paymentOrderId: acc.payment_order_id || acc.payment_orders?.id || null,
      paymentOrderReference: acc.payment_orders?.order_reference || null,
    };
  });

  // 7. Structured Warnings
  const warnings: ScannerWarning[] = [];

  for (const ev of formattedEvents) {
    if (ev.balance > 0 || (ev.paymentType === "paid" && ev.paymentStatus !== "paid")) {
      warnings.push({
        id: `unpaid_event_${ev.participantEventId}`,
        code: "unpaid_event",
        type: "warning",
        title: "Event Payment Pending",
        message: `Payment is incomplete (${ev.paymentStatus || "unpaid"}) for ${ev.eventName}. Fee due: ₹${ev.amountDue}.`,
      });
    }
    if (ev.mainCheckedIn) {
      warnings.push({
        id: `main_checked_in_${ev.participantEventId}`,
        code: "already_checked_in",
        type: "info",
        title: "Main Registration Checked In",
        message: `Participant has already checked in for Main Registration${ev.mainCheckedInAt ? ` (${new Date(ev.mainCheckedInAt).toLocaleDateString()})` : ""}.`,
      });
    }
    if (ev.checkedIn) {
      warnings.push({
        id: `event_checked_in_${ev.participantEventId}`,
        code: "already_checked_in",
        type: "info",
        title: "Event Pass Checked In",
        message: `Participant has already checked in for ${ev.eventName}${ev.checkedInAt ? ` (${new Date(ev.checkedInAt).toLocaleDateString()})` : ""}.`,
      });
    }
  }

  if (formattedAccommodations.length === 0) {
    warnings.push({
      id: "no_accommodation",
      code: "no_accommodation",
      type: "info",
      title: "No Campus Accommodation",
      message: "No campus accommodation booking found for this participant.",
    });
  } else {
    for (const a of formattedAccommodations) {
      if (a.status !== "paid" || a.balance > 0) {
        warnings.push({
          id: `unpaid_acc_${a.id}`,
          code: "unpaid_acc",
          type: "warning",
          title: "Accommodation Payment Pending",
          message: `Accommodation payment is incomplete (${a.status || "unpaid"}) for ${a.planName}. Amount due: ₹${a.amountDue}.`,
        });
      }
      if (!a.roomNumber && a.status === "paid") {
        warnings.push({
          id: `unallocated_acc_${a.id}`,
          code: "unallocated_acc",
          type: "review",
          title: "Room Allocation Required",
          message: `Accommodation is confirmed, but room is not yet allocated for ${a.planName}.`,
        });
      }
      if (a.checked_in && !a.checked_out) {
        warnings.push({
          id: `acc_checked_in_${a.id}`,
          code: "already_checked_in",
          type: "info",
          title: "Accommodation Checked In",
          message: `Participant is currently checked in to ${a.hostelName || "Hostel"} Room ${a.roomNumber || ""}.`,
        });
      }
    }
  }

  for (const ev of formattedEvents) {
    if (ev.team?.members) {
      for (const m of ev.team.members) {
        if (!m.participantId) {
          warnings.push({
            id: `unlinked_member_${m.id}`,
            code: "unlinked_member",
            type: "review",
            title: "Unlinked Team Member",
            message: `Team member "${m.name}" does not have an active permanent participant ID in the database.`,
          });
        }
      }
    }
  }

  return response({
    success: true,

    participant: {
      participantId: dataResult.participant_id,
      name: dataResult.name,
      college: dataResult.college,
      email: dataResult.email,
      phone: dataResult.phone,
      gender: dataResult.gender,
      state: dataResult.state,
      idCardUrl: participantIdCardUrl,
    },

    faculty: facultyWithSignedUrls,
    events: formattedEvents,
    participantEvents: formattedEvents,
    accommodations: formattedAccommodations,
    warnings,

    ...(schemaWarning ? { schemaWarning } : {}),
  });
}
