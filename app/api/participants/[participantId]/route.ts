/**
 * GET /api/participants/[participantId]
 *
 * Public participant lookup for the registration form.
 *
 * When a returning participant enters their Saviskar ID,
 * this route fetches their profile and registered events
 * so the form can:
 *   - Pre-fill their name/college/email/phone
 *   - Show which events they already have
 *   - Prevent re-registering for the same event
 *
 * This is intentionally a PUBLIC route (no admin auth).
 * It returns limited participant info and event names only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PARTICIPANT_ID_PATTERN =
  /^SVK26-[A-Z0-9]{8}$/i;

function jsonResponse(
  body: unknown,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{ participantId: string }>;
  }
) {
  const { participantId: rawParticipantId } =
    await context.params;

  const participantId =
    rawParticipantId.trim().toUpperCase();

  if (
    !PARTICIPANT_ID_PATTERN.test(
      participantId
    )
  ) {
    return jsonResponse(
      {
        success: false,
        error: "Invalid participant ID.",
      },
      400
    );
  }

  // ─── Supabase Admin ─────────────────────────────────────

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error(
      "Public participant lookup: Missing Supabase config."
    );

    return jsonResponse(
      {
        success: false,
        error:
          "Participant lookup is not configured.",
      },
      500
    );
  }

  const supabaseAdmin = createClient(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  // ─── Look Up Participant ────────────────────────────────

  const { data, error } =
    await supabaseAdmin
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
          events(name)
        )
      `
      )
      .eq(
        "participant_id",
        participantId
      )
      .maybeSingle();

  if (error) {
    console.error(
      "Participant lookup failed:",
      error
    );

    return jsonResponse(
      {
        success: false,
        error:
          "Unable to look up this participant.",
      },
      500
    );
  }

  if (!data) {
    return jsonResponse(
      {
        success: false,
        error: "Participant not found.",
      },
      404
    );
  }

  // ─── Format Events ─────────────────────────────────────

  const participantEvents =
    (data.participant_events as Array<{
      id: string;
      event_id: string;
      registration_status: string | null;
      payment_status: string | null;
      payment_amount: number | null;
      team_name: string | null;
      events:
        | { name: string | null }
        | { name: string | null }[]
        | null;
    }> | null) ?? [];

  return jsonResponse({
    success: true,

    participant: {
      participantId:
        data.participant_id,
      name: data.name,
      college: data.college,
      email: data.email,
      phone: data.phone,
    },

    events: participantEvents.map(
      (event) => ({
        participantEventId: event.id,
        eventId: event.event_id,
        eventName:
          (Array.isArray(event.events)
            ? event.events[0]
            : event.events
          )?.name ?? "Unknown event",
        registrationStatus:
          event.registration_status,
        paymentStatus:
          event.payment_status,
        paymentAmount:
          event.payment_amount,
        teamName: event.team_name,
      })
    ),
  });
}
