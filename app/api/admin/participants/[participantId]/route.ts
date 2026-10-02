import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/supabase/server";

const PARTICIPANT_ID_PATTERN = /^SVK26-[A-Z0-9]{8}$/i;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
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
        participant_id,
        name,
        college,
        email,
        phone,
        participant_events(
          id,
          event_id,
          registration_status,
          payment_status,
          payment_amount,
          team_name,
          checked_in,
          checked_in_at,
          main_checked_in,
          main_checked_in_at,
          registration_group_id,
          events(name)
        ),
        participant_event_members (
          id,
          participant_event_id,
          participant_events (
            id,
            event_id,
            registration_status,
            payment_status,
            payment_amount,
            team_name,
            checked_in,
            checked_in_at,
            main_checked_in,
            main_checked_in_at,
            registration_group_id,
            events(name)
          )
        ),
        participant_accommodations (
          id,
          status,
          start_date,
          end_date,
          duration_days,
          checked_in,
          checked_in_at,
          checked_out,
          checked_out_at,
          accommodation_plans (name),
          hostels (name),
          hostel_rooms (room_number, hostel_floors (floor_number))
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
          participant_id,
          name,
          college,
          email,
          phone,
          participant_events(
            id,
            event_id,
            registration_status,
            payment_status,
            payment_amount,
            team_name,
            checked_in,
            checked_in_at,
            events(name)
          ),
          participant_event_members (
            id,
            participant_event_id,
            participant_events (
              id,
              event_id,
              registration_status,
              payment_status,
              payment_amount,
              team_name,
              checked_in,
              checked_in_at,
              events(name)
            )
          ),
          participant_accommodations (
            id,
            status,
            start_date,
            end_date,
            duration_days,
            checked_in,
            checked_in_at,
            checked_out,
            checked_out_at,
            accommodation_plans (name),
            hostels (name),
            hostel_rooms (room_number, hostel_floors (floor_number))
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
      | { name: string | null }
      | { name: string | null }[]
      | null;
  };

  const directEvents =
    (dataResult.participant_events as Array<RawEventRecord> | null) ?? [];
    
  const memberRows =
    (dataResult.participant_event_members as Array<{
      id: string;
      participant_event_id: string;
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

  return response({
    success: true,

    participant: {
      participantId: dataResult.participant_id,
      name: dataResult.name,
      college: dataResult.college,
      email: dataResult.email,
      phone: dataResult.phone,
    },

    events: combinedEvents.map((event) => ({
      participantEventId: event.id,
      eventId: event.event_id,
      eventName:
        (Array.isArray(event.events) ? event.events[0] : event.events)?.name ??
        "Unknown event",
      registrationStatus: event.registration_status,
      paymentStatus: event.payment_status,
      paymentAmount: event.payment_amount,
      teamName: event.team_name,
      checkedIn: event.checked_in ?? false,
      checkedInAt: event.checked_in_at,
      mainCheckedIn: event.main_checked_in ?? false,
      mainCheckedInAt: event.main_checked_in_at ?? null,
      registrationGroupId: event.registration_group_id ?? null,
    })),

    accommodations: Array.isArray(dataResult.participant_accommodations)
      ? dataResult.participant_accommodations.map((acc: any) => ({
          id: acc.id,
          status: acc.status,
          start_date: acc.start_date,
          end_date: acc.end_date,
          duration_days: acc.duration_days,
          checked_in: acc.checked_in,
          checked_in_at: acc.checked_in_at,
          checked_out: acc.checked_out,
          checked_out_at: acc.checked_out_at,
          planName: acc.accommodation_plans?.name || "Unknown Plan",
          hostelName: acc.hostels?.name || null,
          roomNumber: acc.hostel_rooms?.room_number || null,
          floorNumber: acc.hostel_rooms?.hostel_floors?.floor_number || null,
        }))
      : [],

    ...(schemaWarning ? { schemaWarning } : {}),
  });
}
