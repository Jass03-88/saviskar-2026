import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  requireAdmin,
  requireMasterAdmin,
} from "@/lib/supabase/server";

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
  is_archived: boolean | null;
  created_at: string;
};

type EventRecord = {
  id: string;
  name: string;
  category: string | null;
  payment_type: string | null;
  registration_fee: number | null;
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

export async function GET(request: Request) {
  try {
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

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // 1. Fetch paginated participant_events
  const {
    data: participantEventsData,
    count: totalCount,
    error: peError,
  } = await supabaseAdmin
    .from("participant_events")
    .select(
      "id, participant_id, event_id, registration_status, payment_status, payment_amount, payment_id, team_name, checked_in, checked_in_at, is_archived, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (peError) {
    console.error("Admin registrations query failed:", peError);
    return NextResponse.json(
      { error: "Could not load registrations." },
      { status: 500 }
    );
  }

  const participantEvents =
    (participantEventsData ?? []) as ParticipantEvent[];

  const participantIds = Array.from(
    new Set(participantEvents.map((pe) => pe.participant_id).filter(Boolean))
  );
  const peIds = participantEvents.map((pe) => pe.id);

  // 2. Fetch associated participants, events catalog, members, and payment orders
  const [
    participantsResult,
    eventsResult,
    membersResult,
    paymentOrdersResult,
  ] = await Promise.all([
    participantIds.length > 0
      ? supabaseAdmin
          .from("participants")
          .select(
            "id, participant_id, name, college, email, phone, photo_url, created_at"
          )
          .in("id", participantIds)
      : Promise.resolve({ data: [], error: null }),

    supabaseAdmin
      .from("events")
      .select("id, name, category, payment_type, registration_fee")
      .order("name", {
        ascending: true,
      }),

    peIds.length > 0
      ? supabaseAdmin
          .from("participant_event_members")
          .select(
            "id, participant_event_id, name, email, phone, is_team_leader, participant_id, participants(participant_id, college)"
          )
          .in("participant_event_id", peIds)
      : Promise.resolve({ data: [], error: null }),

    peIds.length > 0
      ? supabaseAdmin
          .from("payment_order_items")
          .select(
            "participant_event_id, payment_orders(id, order_reference, gateway, gateway_order_id, gateway_payment_id, status, updated_at)"
          )
          .in("participant_event_id", peIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const queryError =
    participantsResult.error ??
    eventsResult.error ??
    membersResult.error ??
    paymentOrdersResult.error;

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

  const paymentItems = [...(paymentOrdersResult.data ?? [])] as any[];
  
  // Sort to prioritize successful/paid orders if multiple exist
  paymentItems.sort((a, b) => {
    const aOrder = Array.isArray(a.payment_orders) ? a.payment_orders[0] : a.payment_orders;
    const bOrder = Array.isArray(b.payment_orders) ? b.payment_orders[0] : b.payment_orders;
    if (aOrder?.status === "paid" && bOrder?.status !== "paid") return -1;
    if (bOrder?.status === "paid" && aOrder?.status !== "paid") return 1;
    return new Date(bOrder?.updated_at || 0).getTime() - new Date(aOrder?.updated_at || 0).getTime();
  });

  const paymentOrdersByRegistration = new Map<string, any>();
  for (const item of paymentItems) {
    if (!item.participant_event_id || !item.payment_orders) continue;
    const order = Array.isArray(item.payment_orders) ? item.payment_orders[0] : item.payment_orders;
    if (!paymentOrdersByRegistration.has(item.participant_event_id) && order) {
      paymentOrdersByRegistration.set(item.participant_event_id, order);
    }
  }

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
              payment_order:
                paymentOrdersByRegistration.get(
                  registration.id
                ) ?? null,
            },
          ]
          : [];
      }
    );

  return NextResponse.json(
    {
      registrations,
      events,
      role: auth.role,
      total: totalCount ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((totalCount ?? 0) / pageSize),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
  } catch (err: any) {
    console.error("UNHANDLED GET ERROR:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request
) {
  try {
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
  } catch (err: any) {
    console.error("UNHANDLED PATCH ERROR:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request
) {
  try {
    const auth = await requireMasterAdmin();

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

  const permanent =
    new URL(request.url).searchParams.get(
      "permanent"
    ) === "true";

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

  let error;

  if (permanent) {
    const res = await supabaseAdmin.rpc("delete_registration_permanently", {
      p_participant_event_id: participantEventId,
      p_admin_id: auth.user.id,
    });
    error = res.error;
  } else {
    const res = await supabaseAdmin
      .from("participant_events")
      .update({ is_archived: true })
      .eq("id", participantEventId);
    error = res.error;

    if (!error) {
      await supabaseAdmin.from("admin_audit_logs").insert({
        admin_id: auth.user!.id,
        action_type: "ARCHIVE_REGISTRATION",
        target_id: participantEventId,
        details: { archived_at: new Date().toISOString() },
      });
    }
  }

  if (error) {
    console.error(
      "Admin registration delete/archive failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Could not process the registration.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
  });
  } catch (err: any) {
    console.error("UNHANDLED DELETE ERROR:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  request: Request
) {
  try {
    const auth = await requireMasterAdmin();

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
      } | null;

  if (
    !body ||
    typeof body.participantEventId !==
    "string"
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid restore request.",
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

  const { error } =
    await supabaseAdmin
      .from("participant_events")
      .update({ is_archived: false })
      .eq(
        "id",
        body.participantEventId
      );

  if (!error) {
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_id: auth.user!.id,
      action_type: "RESTORE_REGISTRATION",
      target_id: body.participantEventId,
      details: { restored_at: new Date().toISOString() },
    });
  }

  if (error) {
    console.error(
      "Admin registration restore failed:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Could not restore the event registration.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
  });
  } catch (err: any) {
    console.error("UNHANDLED POST ERROR:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}