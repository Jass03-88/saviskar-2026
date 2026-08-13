import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EventPayload = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
  event_date?: unknown;
  start_time?: unknown;
  venue?: unknown;
  active?: unknown;
  registration_open?: unknown;
  registration_type?: unknown;
  min_team_size?: unknown;
  max_team_size?: unknown;
  registration_fee?: unknown;
  payment_type?: unknown;
  payment_unit?: unknown;
};

function cleanString(value: unknown, max = 500) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, max)
    : "";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function numberOrNull(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getAdminClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: admin, error: adminError } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return {
      error: NextResponse.json(
        { error: "Event service is not configured." },
        { status: 500 }
      ),
    };
  }

  return {
    client: createSupabaseClient(
      supabaseUrl,
      supabaseSecretKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    ),
  };
}

function normalisePayload(body: EventPayload) {
  const name = cleanString(body.name, 160);
  const category = cleanString(body.category, 80);
  const slug = slugify(cleanString(body.slug, 120) || name);

  if (!name) throw new Error("Event name is required.");
  if (!category) throw new Error("Event category is required.");
  if (!slug) throw new Error("A valid event slug could not be generated.");

  const registrationType =
    body.registration_type === "team" ? "team" : "individual";

  const paymentUnit = ["free", "per_student", "per_team", "tbd"].includes(
    String(body.payment_unit)
  )
    ? String(body.payment_unit)
    : "free";

  const fee = numberOrNull(body.registration_fee) ?? 0;

  if (fee < 0) throw new Error("Registration fee cannot be negative.");

  const minTeamSize = numberOrNull(body.min_team_size);
  const maxTeamSize = numberOrNull(body.max_team_size);

  if (registrationType === "team") {
    if (
      minTeamSize !== null &&
      maxTeamSize !== null &&
      (minTeamSize < 1 || maxTeamSize < minTeamSize)
    ) {
      throw new Error("Team size limits are invalid.");
    }
  }

  return {
    slug,
    name,
    category,
    description: cleanString(body.description, 1000) || null,
    event_date: cleanString(body.event_date, 20) || null,
    start_time: cleanString(body.start_time, 20) || null,
    venue: cleanString(body.venue, 180) || null,
    active: typeof body.active === "boolean" ? body.active : true,
    registration_open:
      typeof body.registration_open === "boolean"
        ? body.registration_open
        : true,
    registration_type: registrationType,
    min_team_size:
      registrationType === "team" ? minTeamSize : null,
    max_team_size:
      registrationType === "team" ? maxTeamSize : null,
    registration_fee: fee,
    payment_type: fee > 0 ? "paid" : "free",
    payment_unit: paymentUnit,
  };
}

export async function GET() {
  const result = await getAdminClient();
  if ("error" in result) return result.error;

  const { data: events, error: eventsError } = await result.client
    .from("events")
    .select(
      "id, slug, name, category, description, event_date, start_time, venue, active, registration_open, registration_type, min_team_size, max_team_size, registration_fee, payment_type, payment_unit"
    )
    .order("event_date", { ascending: true })
    .order("name", { ascending: true });

  if (eventsError) {
    console.error("Admin events query failed:", eventsError);
    return NextResponse.json(
      { error: "Could not load events." },
      { status: 500 }
    );
  }

  const { data: registrations, error: registrationError } = await result.client
    .from("participant_events")
    .select("event_id");

  if (registrationError) {
    console.error("Admin event registration counts failed:", registrationError);
    return NextResponse.json(
      { error: "Could not load event registration counts." },
      { status: 500 }
    );
  }

  const counts = new Map<string, number>();
  for (const row of registrations ?? []) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }

  const enrichedEvents = (events ?? []).map((event) => ({
    ...event,
    registration_count: counts.get(event.id) ?? 0,
  }));

  return NextResponse.json(
    { events: enrichedEvents },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const result = await getAdminClient();
  if ("error" in result) return result.error;

  let body: EventPayload;
  try {
    body = (await request.json()) as EventPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid event request." },
      { status: 400 }
    );
  }

  try {
    const payload = normalisePayload(body);

    const { data, error } = await result.client
      .from("events")
      .insert(payload)
      .select(
        "id, slug, name, category, description, event_date, start_time, venue, active, registration_open, registration_type, min_team_size, max_team_size, registration_fee, payment_type, payment_unit"
      )
      .single();

    if (error) {
      console.error("Admin event create failed:", error);
      const message =
        error.code === "23505"
          ? "An event with this name or slug already exists."
          : error.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create event.",
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const result = await getAdminClient();
  if ("error" in result) return result.error;

  let body: EventPayload;
  try {
    body = (await request.json()) as EventPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid event request." },
      { status: 400 }
    );
  }

  const id = cleanString(body.id, 80);
  if (!id) {
    return NextResponse.json(
      { error: "Event ID is required." },
      { status: 400 }
    );
  }

  try {
    const payload = normalisePayload(body);

    const { data, error } = await result.client
      .from("events")
      .update(payload)
      .eq("id", id)
      .select(
        "id, slug, name, category, description, event_date, start_time, venue, active, registration_open, registration_type, min_team_size, max_team_size, registration_fee, payment_type, payment_unit"
      )
      .maybeSingle();

    if (error) {
      console.error("Admin event update failed:", error);
      const message =
        error.code === "23505"
          ? "An event with this name or slug already exists."
          : error.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json(
        { error: "Event not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ event: data });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update event.",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const result = await getAdminClient();
  if ("error" in result) return result.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "Event ID is required." },
      { status: 400 }
    );
  }

  const { count, error: countError } = await result.client
    .from("participant_events")
    .select("id", { count: "exact", head: true })
    .eq("event_id", id);

  if (countError) {
    console.error("Admin event delete count failed:", countError);
    return NextResponse.json(
      { error: "Could not verify event registrations." },
      { status: 500 }
    );
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "This event has registrations and cannot be deleted. Close registration or deactivate it instead so registration history is preserved.",
      },
      { status: 409 }
    );
  }

  const { error } = await result.client
    .from("events")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Admin event delete failed:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}
