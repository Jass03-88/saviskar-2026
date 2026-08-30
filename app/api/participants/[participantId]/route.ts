/**
 * GET /api/participants/[participantId]
 *
 * Public participant lookup for the registration form.
 *
 * When a returning participant enters their Saviskar ID,
 * this route fetches their profile and registered events
 * so the form can:
 *   - Pre-fill their name/college/email/phone (read-only verified state)
 *   - Show which events they already have (eventId, eventName, paymentStatus)
 *   - Prevent re-registering for the same event
 *
 * Rate limited to 10 requests/minute per IP.
 * Response is minimized to only the fields consumed by the frontend.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const PARTICIPANT_ID_PATTERN = /^SVK26-[A-Z0-9]{8}$/i;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ participantId: string }>;
  }
) {
  // ─── Rate Limiting (10 requests per minute per IP) ──────
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`lookup:${clientIp}`, 10, 60 * 1000);

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
      participant_id,
      name,
      college,
      email,
      phone,
      participant_events(
        event_id,
        payment_status,
        events(name)
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

  if (!data) {
    return jsonResponse(
      {
        success: false,
        error: "Participant not found.",
      },
      404
    );
  }

  // ─── Format Events (Minimizing to only UI-required fields) ───
  const rawParticipantEvents =
    (data.participant_events as Array<{
      event_id: string;
      payment_status: string | null;
      events:
        | { name: string | null }
        | { name: string | null }[]
        | null;
    }> | null) ?? [];

  return jsonResponse({
    success: true,
    participant: {
      participantId: data.participant_id,
      name: data.name,
      college: data.college,
      email: data.email,
      phone: data.phone,
    },
    events: rawParticipantEvents.map((event) => ({
      eventId: event.event_id,
      eventName:
        (Array.isArray(event.events)
          ? event.events[0]
          : event.events
        )?.name ?? "Unknown event",
      paymentStatus: event.payment_status,
    })),
  });
}
