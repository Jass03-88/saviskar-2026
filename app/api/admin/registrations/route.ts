import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Participant = {
  id: string;
  participant_id: string;
  name: string;
  college: string | null;
  email: string;
  phone: string | null;
  photo_url: string | null;
  created_at: string;
};

type ParticipantEvent = {
  id: string;
  participant_id: string;
  event_id: string;
  registration_status: string | null;
  payment_status: string | null;
  payment_amount: number | null;
  payment_id: string | null;
  team_name: string | null;
  checked_in: boolean | null;
  checked_in_at: string | null;
  created_at: string;
};

type EventRecord = {
  id: string;
  name: string;
  category: string | null;
};

type Member = {
  id: string;
  participant_event_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_team_leader: boolean | null;
  participant_id: string | null;
  participants: {
    participant_id: string;
    college: string | null;
  } | null;
};

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  return createSupabaseClient(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

export async function GET() {
  const auth = await requireAdmin();

  if (auth.error) {
    return NextResponse.json(
      {
        error:
          auth.error === "MFA_REQUIRED"
            ? "Master Admin MFA verification required."
            : auth.error,
      },
      { status: auth.status }
    );
  }

  const supabaseAdmin = getSupabaseAdmin();

  if (!supabaseAdmin) {
    console.error(
      "Admin registrations API is missing Supabase server configuration."
    );

    return NextResponse.json(
      {
        error:
          "Registration service is not configured.",
      },
      { status: 500 }
    );
  }

  const [
    participantsResult,
    participantEventsResult,
    eventsResult,
    membersResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("participants")
      .select(
        "id, participant_id, name, college, email, phone, photo_url, created_at"
      )
      .order("created_at", {
        ascending: false,
      }),

    supabaseAdmin
      .from("participant_events")
      .select(
        "id, participant_id, event_id, registration_status, payment_status, payment_amount, payment_id, team_name, checked_in, checked_in_at, created_at"
      )
      .order("created_at", {
        ascending: false,
      }),

    supabaseAdmin
      .from("events")
      .select("id, name, category")
      .order("name", {
        ascending: true,
      }),

    supabaseAdmin
      .from("participant_event_members")
      .select(
        "id, participant_event_id, name, email, phone, is_team_leader, participant_id, participants(participant_id, college)"
      ),
  ]);

  const queryError =
    participantsResult.error ??
    participantEventsResult.error ??
    eventsResult.error ??
    membersResult.error;

  if (queryError) {
    console.error(
      "Admin registrations query failed:",
      queryError
    );

    return NextResponse.json(
      {
        error:
          "Could not load registrations.",
      },
      { status: 500 }
    );
  }

  const participants =
    (participantsResult.data ?? []) as Participant[];

  const participantEvents =
    (participantEventsResult.data ??
      []) as ParticipantEvent[];

  const events =
    (eventsResult.data ?? []) as EventRecord[];

  const rawMembers =
    (membersResult.data ?? []) as any[];

  const members = rawMembers.map(
    (member) => {
      const participant =
        Array.isArray(member.participants)
          ? member.participants[0]
          : member.participants;

      return {
        id: member.id,
        participant_event_id:
          member.participant_event_id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        is_team_leader:
          member.is_team_leader,
        participant_id:
          member.participant_id,
        participants: participant
          ? {
              participant_id: String(
                participant.participant_id || ""
              ),
              college: participant.college
                ? String(
                    participant.college
                  )
                : null,
            }
          : null,
      };
    }
  ) as Member[];

  const participantsById =
    new Map(
      participants.map(
        (participant) => [
          participant.id,
          participant,
        ]
      )
    );

  const eventsById =
    new Map(
      events.map((event) => [
        event.id,
        event,
      ])
    );

  const membersByParticipantEventId =
    new Map<string, Member[]>();

  members.forEach((member) => {
    const current =
      membersByParticipantEventId.get(
        member.participant_event_id
      ) ?? [];

    current.push(member);

    membersByParticipantEventId.set(
      member.participant_event_id,
      current
    );
  });

  const registrations =
    participantEvents.flatMap(
      (registration) => {
        const participant =
          participantsById.get(
            registration.participant_id
          );

        return participant
          ? [
              {
                participant,
                registration,
                event:
                  eventsById.get(
                    registration.event_id
                  ) ?? null,
                members:
                  membersByParticipantEventId.get(
                    registration.id
                  ) ?? [],
              },
            ]
          : [];
      }
    );

  return NextResponse.json(
    {
      registrations,
      events,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function PATCH(
  request: Request
) {
  const auth = await requireAdmin();

  if (auth.error) {
    return NextResponse.json(
      {
        error:
          auth.error === "MFA_REQUIRED"
            ? "Master Admin MFA verification required."
            : auth.error,
      },
      { status: auth.status }
    );
  }

  const body =
    (await request
      .json()
      .catch(() => null)) as {
      participantEventId?: unknown;
      checkedIn?: unknown;
    } | null;

  if (
    !body ||
    typeof body.participantEventId !==
      "string" ||
    typeof body.checkedIn !== "boolean"
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid check-in request.",
      },
      { status: 400 }
    );
  }

  const supabaseAdmin =
    getSupabaseAdmin();

  if (!supabaseAdmin) {
    return NextResponse.json(
      {
        error:
          "Registration service is not configured.",
      },
      { status: 500 }
    );
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("participant_events")
    .update({
      checked_in:
        body.checkedIn,
      checked_in_at:
        body.checkedIn
          ? new Date().toISOString()
          : null,
    })
    .eq(
      "id",
      body.participantEventId
    )
    .select(
      "id, checked_in, checked_in_at"
    )
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      {
        error:
          "Could not update check-in status.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    registration: data,
  });
}

export async function DELETE(
  request: Request
) {
  const auth = await requireAdmin();

  if (auth.error) {
    return NextResponse.json(
      {
        error:
          auth.error === "MFA_REQUIRED"
            ? "Master Admin MFA verification required."
            : auth.error,
      },
      { status: auth.status }
    );
  }

  const participantEventId =
    new URL(request.url).searchParams.get(
      "participantEventId"
    );

  if (!participantEventId) {
    return NextResponse.json(
      {
        error:
          "Missing event registration ID.",
      },
      { status: 400 }
    );
  }

  const supabaseAdmin =
    getSupabaseAdmin();

  if (!supabaseAdmin) {
    return NextResponse.json(
      {
        error:
          "Registration service is not configured.",
      },
      { status: 500 }
    );
  }

  const { error: memberError } =
    await supabaseAdmin
      .from(
        "participant_event_members"
      )
      .delete()
      .eq(
        "participant_event_id",
        participantEventId
      );

  if (memberError) {
    console.error(
      "Admin registration member delete failed:",
      memberError
    );

    return NextResponse.json(
      {
        error:
          "Could not remove the team members for this registration.",
      },
      { status: 500 }
    );
  }

  const { error } =
    await supabaseAdmin
      .from("participant_events")
      .delete()
      .eq(
        "id",
        participantEventId
      );

  if (error) {
    console.error(
      "Admin registration delete failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Could not delete the event registration.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
  });
}