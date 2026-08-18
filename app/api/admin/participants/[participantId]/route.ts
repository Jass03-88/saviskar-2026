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
          events(name)
        )
      `
    )
    .eq("participant_id", participantId)
    .maybeSingle();

  if (error) {
    console.error("Participant lookup failed:", error);

    return response(
      {
        success: false,
        error: "Unable to look up this participant.",
      },
      500
    );
  }

  if (!data) {
    return response(
      {
        success: false,
        error: "Participant not found.",
      },
      404
    );
  }

  const participantEvents =
    (data.participant_events as Array<{
      id: string;
      event_id: string;
      registration_status: string | null;
      payment_status: string | null;
      payment_amount: number | null;
      team_name: string | null;
      checked_in: boolean | null;
      checked_in_at: string | null;
      events:
        | { name: string | null }
        | { name: string | null }[]
        | null;
    }> | null) ?? [];

  return response({
    success: true,

    participant: {
      participantId: data.participant_id,
      name: data.name,
      college: data.college,
      email: data.email,
      phone: data.phone,
    },

    events: participantEvents.map((event) => ({
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
    })),
  });
}
