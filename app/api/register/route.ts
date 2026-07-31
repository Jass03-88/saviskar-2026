import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type MemberInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
};

type RegistrationInput = {
  eventId?: unknown;
  name?: unknown;
  college?: unknown;
  email?: unknown;
  phone?: unknown;
  team?: unknown;
  members?: unknown;
};

type EventRow = {
  id: string;
  active: boolean;
  registration_open: boolean;
  registration_type: string;
  min_team_size: number | null;
  max_team_size: number | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanEmail(value: unknown) {
  return cleanString(value, 254).toLowerCase();
}

function cleanPhone(value: unknown) {
  return cleanString(value, 30);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

const MAX_REQUEST_BYTES = 24_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 8;

type RateEntry = { count: number; resetAt: number };
const globalForRateLimit = globalThis as typeof globalThis & {
  __registrationRateLimit?: Map<string, RateEntry>;
};
const registrationRateLimit =
  globalForRateLimit.__registrationRateLimit ??
  (globalForRateLimit.__registrationRateLimit = new Map<string, RateEntry>());

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function checkRateLimit(key: string) {
  const now = Date.now();

  if (registrationRateLimit.size > 1000) {
    for (const [storedKey, entry] of registrationRateLimit) {
      if (entry.resetAt <= now) registrationRateLimit.delete(storedKey);
    }
  }

  const current = registrationRateLimit.get(key);
  if (!current || current.resetAt <= now) {
    registrationRateLimit.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function rateLimitResponse(retryAfter: number) {
  return NextResponse.json(
    {
      success: false,
      error: "Too many registration attempts. Please wait a moment and try again.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimit = checkRateLimit(`register:${clientIp}`);

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfter);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_REQUEST_BYTES) {
      return errorResponse("Registration request is too large.", 413);
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error(
      "Registration API is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY."
    );
    return errorResponse(
      "Registration service is not configured.",
      500
    );
  }

  let body: RegistrationInput;

  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return errorResponse("Registration request is too large.", 413);
    }

    body = JSON.parse(rawBody) as RegistrationInput;
  } catch {
    return errorResponse("Invalid registration request.", 400);
  }

  const eventId = cleanString(body.eventId, 64);
  const name = cleanString(body.name, 120);
  const college = cleanString(body.college, 180);
  const email = cleanEmail(body.email);
  const phone = cleanPhone(body.phone);
  const team = cleanString(body.team, 120);
  const rawMembers = Array.isArray(body.members) ? body.members : [];

  if (!UUID_PATTERN.test(eventId)) {
    return errorResponse("Please select a valid event.", 400);
  }

  if (!name || !college || !email || !phone) {
    return errorResponse(
      "Please complete your name, college, email and phone number.",
      400
    );
  }

  if (!EMAIL_PATTERN.test(email)) {
    return errorResponse("Please enter a valid email address.", 400);
  }

  if (rawMembers.length > 50) {
    return errorResponse("Too many team members were submitted.", 400);
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

  const { data: eventData, error: eventError } =
    await supabaseAdmin
      .from("events")
      .select(
        "id, active, registration_open, registration_type, min_team_size, max_team_size"
      )
      .eq("id", eventId)
      .maybeSingle();

  if (eventError) {
    console.error("Registration event lookup failed:", eventError);
    return errorResponse(
      "We couldn't verify the selected event.",
      500
    );
  }

  if (!eventData) {
    return errorResponse("Selected event was not found.", 404);
  }

  const selectedEvent = eventData as EventRow;

  if (!selectedEvent.active) {
    return errorResponse(
      "This event is currently unavailable.",
      400
    );
  }

  if (!selectedEvent.registration_open) {
    return errorResponse(
      "Registration for this event is currently closed.",
      400
    );
  }

  const isTeamEvent =
    selectedEvent.registration_type?.toLowerCase().trim() ===
    "team";

  const members = rawMembers.map((raw, index) => {
    const member = (raw ?? {}) as MemberInput;
    return {
      name: cleanString(member.name, 120),
      email: cleanEmail(member.email),
      phone: cleanPhone(member.phone),
      index,
    };
  });

  if (!isTeamEvent && members.length > 0) {
    return errorResponse(
      "Team members cannot be added to an individual event.",
      400
    );
  }

  if (isTeamEvent) {
    const minTeamSize = Math.max(
      1,
      selectedEvent.min_team_size ?? 1
    );
    const maxTeamSize = Math.max(
      minTeamSize,
      selectedEvent.max_team_size ?? minTeamSize
    );
    const totalParticipants = members.length + 1;

    if (!team) {
      return errorResponse("Please enter your team name.", 400);
    }

    if (totalParticipants < minTeamSize) {
      return errorResponse(
        `This event requires at least ${minTeamSize} team members including the team leader.`,
        400
      );
    }

    if (totalParticipants > maxTeamSize) {
      return errorResponse(
        `This event allows a maximum of ${maxTeamSize} team members including the team leader.`,
        400
      );
    }

    for (const member of members) {
      if (!member.name || !member.email || !member.phone) {
        return errorResponse(
          `Please complete all details for Team Member ${member.index + 2}.`,
          400
        );
      }

      if (!EMAIL_PATTERN.test(member.email)) {
        return errorResponse(
          `Please enter a valid email for Team Member ${member.index + 2}.`,
          400
        );
      }
    }

    const allEmails = [
      email,
      ...members.map((member) => member.email),
    ];

    if (new Set(allEmails).size !== allEmails.length) {
      return errorResponse(
        "Each participant must use a different email address.",
        400
      );
    }
  }

  /*
   * Friendly duplicate check for a useful response before attempting the
   * write. The database unique index remains the race-safe final guard.
   */
  const { data: existingRegistration, error: duplicateError } =
    await supabaseAdmin
      .from("registrations")
      .select("id")
      .eq("event_id", eventId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

  if (duplicateError) {
    console.error(
      "Duplicate registration lookup failed:",
      duplicateError
    );
    return errorResponse(
      "We couldn't verify your registration status.",
      500
    );
  }

  if (existingRegistration) {
    return errorResponse(
      "This email is already registered for the selected event.",
      409
    );
  }

  /*
   * Atomic registration write.
   *
   * The PostgreSQL function creates the registration and all team members
   * inside one database transaction. If any insert fails, PostgreSQL rolls
   * back the entire operation automatically.
   */
  const { data: registrationId, error: registrationError } =
    await supabaseAdmin.rpc("create_event_registration", {
      p_event_id: eventId,
      p_name: name,
      p_college: college,
      p_email: email,
      p_phone: phone,
      p_team: isTeamEvent ? team : "",
      p_members: isTeamEvent
        ? members.map((member) => ({
            name: member.name,
            email: member.email,
            phone: member.phone,
          }))
        : [],
    });

  if (registrationError) {
    // PostgreSQL 23505 = unique constraint violation.
    if (registrationError.code === "23505") {
      return errorResponse(
        "This email is already registered for the selected event.",
        409
      );
    }

    console.error("Atomic registration RPC failed:", {
      code: registrationError.code,
      message: registrationError.message,
      details: registrationError.details,
      hint: registrationError.hint,
    });

    return errorResponse(
      "We couldn't save your registration. Please try again.",
      500
    );
  }

  if (
    typeof registrationId !== "string" ||
    !UUID_PATTERN.test(registrationId)
  ) {
    console.error(
      "Atomic registration RPC returned an invalid registration ID:",
      registrationId
    );

    return errorResponse(
      "We couldn't confirm your registration. Please try again.",
      500
    );
  }

  return NextResponse.json(
    {
      success: true,
      registrationId,
    },
    { status: 201 }
  );
}
