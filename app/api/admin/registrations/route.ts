import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  requireAdmin,
  requireMasterAdmin,
} from "@/lib/supabase/server";
import { parseAdminCategories } from "@/lib/admin/scope";
import { fetchInBatches } from "@/lib/supabase/batch";

export const dynamic = "force-dynamic";

type Participant = {
  id: string;
  participant_id: string;
  name: string;
  college: string | null;
  email: string;
  phone: string | null;
  photo_url: string | null;
  gender: string | null;
  state: string | null;
  id_card_storage_path: string | null;
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
  main_checked_in: boolean | null;
  main_checked_in_at: string | null;
  registration_group_id?: string | null;
  is_archived: boolean | null;
  created_at: string;
};

type EventRecord = {
  id: string;
  name: string;
  category: string | null;
  payment_type: string | null;
  registration_fee: number | null;
  registration_limit?: number | null;
};

type Member = {
  id: string;
  participant_event_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_team_leader: boolean | null;
  participant_id: string | null;
  id_card_storage_path?: string | null;
  participants: {
    participant_id: string;
    college: string | null;
    id_card_storage_path?: string | null;
  } | null;
};

type RawMember = {
  id: string;
  participant_event_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_team_leader: boolean | null;
  participant_id: string | null;
  participants:
    | {
        participant_id?: string | null;
        college?: string | null;
        id_card_storage_path?: string | null;
      }
    | {
        participant_id?: string | null;
        college?: string | null;
        id_card_storage_path?: string | null;
      }[]
    | null;
};

type PaymentOrderData = {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
  receipt: string | null;
  created_at: string;
  updated_at: string;
};

type RawPaymentOrderItem = {
  participant_event_id: string | null;
  payment_orders: PaymentOrderData | PaymentOrderData[] | null;
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
  const pageSize = Math.min(2000, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)));
  const eventId = searchParams.get("eventId")?.trim();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Scoped admin check (category / event specific for normal admins)
  const isMaster = auth.role === "master";
  const assignedCategory = isMaster ? null : auth.assigned_category;
  const assignedEvents = isMaster ? [] : (auth.assigned_events || []);
  const isScoped = !isMaster && (!!assignedCategory || assignedEvents.length > 0);

  let allowedEventIds: string[] | null = null;
  if (isScoped) {
    const { data: catEvents } = await supabaseAdmin
      .from("events")
      .select("id, category");

    const allowedCategories = parseAdminCategories(assignedCategory);

    const matchedIds = (catEvents || [])
      .filter((ev) => {
        if (assignedEvents.includes(ev.id)) return true;
        if (allowedCategories.length > 0 && ev.category && allowedCategories.includes(ev.category.toLowerCase())) return true;
        return false;
      })
      .map((ev) => ev.id);

    allowedEventIds = matchedIds;

    // If scoped admin has no matching events, return early empty state
    if (allowedEventIds.length === 0) {
      return NextResponse.json(
        {
          registrations: [],
          events: [],
          role: auth.role,
          accommodation_access: auth.accommodation_access,
          assigned_category: auth.assigned_category,
          assigned_events: auth.assigned_events,
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (eventId && !allowedEventIds.includes(eventId)) {
      return NextResponse.json(
        { error: "You are not authorized to view registrations for this event." },
        { status: 403 }
      );
    }
  }

  // 1. Fetch paginated participant_events with optional eventId / scope filter
  let peQuery = supabaseAdmin
    .from("participant_events")
    .select(
      "id, participant_id, event_id, registration_status, payment_status, payment_amount, payment_id, team_name, checked_in, checked_in_at, main_checked_in, main_checked_in_at, registration_group_id, is_archived, created_at",
      { count: "exact" }
    );

  if (eventId) {
    peQuery = peQuery.eq("event_id", eventId);
  } else if (allowedEventIds !== null) {
    peQuery = peQuery.in("event_id", allowedEventIds);
  }

  let {
    data: participantEventsData,
    count: totalCount,
    error: peError,
  } = await peQuery
    .order("created_at", { ascending: false })
    .range(from, to);

  let schemaWarning: string | undefined;

  if (peError && peError.code === "42703") {
    console.warn("Main check-in columns missing. Falling back to legacy query.");
    schemaWarning = "Main check-in migration is not applied.";
    
    peQuery = supabaseAdmin
      .from("participant_events")
      .select(
        "id, participant_id, event_id, registration_status, payment_status, payment_amount, payment_id, team_name, checked_in, checked_in_at, is_archived, created_at",
        { count: "exact" }
      );
      
    if (eventId) {
      peQuery = peQuery.eq("event_id", eventId);
    } else if (allowedEventIds !== null) {
      peQuery = peQuery.in("event_id", allowedEventIds);
    }

    const fallbackResult = await peQuery
      .order("created_at", { ascending: false })
      .range(from, to);

    participantEventsData = fallbackResult.data;
    totalCount = fallbackResult.count;
    peError = fallbackResult.error;
  }

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
  const peIds = Array.from(new Set(participantEvents.map((pe) => pe.id).filter(Boolean)));
  const registrationGroupIds = Array.from(
    new Set(
      participantEvents
        .map((pe) => pe.registration_group_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  // 2. Fetch associated participants, events catalog, members, payment orders, and faculty
  // Batched to prevent UND_ERR_HEADERS_OVERFLOW / 16KB URL limit when pageSize is large (e.g. 2000)
  const [
    participantsResult,
    eventsResult,
    membersResult,
    paymentOrdersResult,
    facultyResult,
  ] = await Promise.all([
    fetchInBatches<Participant>(participantIds, (chunk) =>
      supabaseAdmin
        .from("participants")
        .select(
          "id, participant_id, name, college, email, phone, photo_url, gender, state, id_card_storage_path, created_at"
        )
        .in("id", chunk)
    ),

    supabaseAdmin
      .from("events")
      .select("id, name, category, payment_type, registration_fee, registration_limit")
      .order("name", {
        ascending: true,
      }),

    fetchInBatches<RawMember>(peIds, (chunk) =>
      supabaseAdmin
        .from("participant_event_members")
        .select(
          "id, participant_event_id, name, email, phone, is_team_leader, participant_id, participants(participant_id, college, id_card_storage_path)"
        )
        .in("participant_event_id", chunk)
    ),

    fetchInBatches<RawPaymentOrderItem>(peIds, (chunk) =>
      supabaseAdmin
        .from("payment_order_items")
        .select(
          "participant_event_id, payment_orders(id, order_reference, gateway, gateway_order_id, gateway_payment_id, status, updated_at)"
        )
        .in("participant_event_id", chunk)
    ),

    fetchInBatches<any>(registrationGroupIds, (chunk) =>
      supabaseAdmin
        .from("faculty_incharges")
        .select(
          "id, registration_group_id, participant_id, participants(id, name, email, phone, college, gender, state, id_card_storage_path)"
        )
        .in("registration_group_id", chunk)
    ),
  ]);

  const queryError =
    participantsResult.error ??
    eventsResult.error ??
    membersResult.error ??
    paymentOrdersResult.error ??
    facultyResult.error;

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

  const allEvents =
    (eventsResult.data ?? []) as EventRecord[];

  const events =
    allowedEventIds !== null
      ? allEvents.filter((event) => allowedEventIds!.includes(event.id))
      : allEvents;

  const rawMembers =
    (membersResult.data ?? []) as unknown as RawMember[];

  const members = rawMembers.map(
    (member) => {
      const participant =
        Array.isArray(member.participants)
          ? member.participants[0]
          : member.participants;

      const memberIdCardPath = participant?.id_card_storage_path
        ? String(participant.id_card_storage_path).trim() || null
        : null;

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
        id_card_storage_path: memberIdCardPath,
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
            id_card_storage_path: memberIdCardPath,
          }
          : null,
      };
    }
  ) as Member[];

  const paymentItems = [...(paymentOrdersResult.data ?? [])] as unknown as RawPaymentOrderItem[];
  
  // Sort to prioritize successful/paid orders if multiple exist
  paymentItems.sort((a, b) => {
    const aOrder = Array.isArray(a.payment_orders) ? a.payment_orders[0] : a.payment_orders;
    const bOrder = Array.isArray(b.payment_orders) ? b.payment_orders[0] : b.payment_orders;
    if (aOrder?.status === "paid" && bOrder?.status !== "paid") return -1;
    if (bOrder?.status === "paid" && aOrder?.status !== "paid") return 1;
    return new Date(bOrder?.updated_at || 0).getTime() - new Date(aOrder?.updated_at || 0).getTime();
  });

  const paymentOrdersByRegistration = new Map<string, PaymentOrderData>();
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
      allEvents.map((event) => [
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

  const facultyItems = (facultyResult.data ?? []) as any[];
  const facultyByGroupId = new Map<string, {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    college: string | null;
    gender?: string | null;
    state?: string | null;
    id_card_storage_path?: string | null;
    idCardStoragePath?: string | null;
  }>();

  for (const f of facultyItems) {
    const p = Array.isArray(f.participants) ? f.participants[0] : f.participants;
    if (f.registration_group_id && p) {
      facultyByGroupId.set(f.registration_group_id, {
        id: f.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        college: p.college,
        gender: p.gender,
        state: p.state,
        id_card_storage_path: p.id_card_storage_path,
        idCardStoragePath: p.id_card_storage_path,
      });
    }
  }

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
              faculty:
                registration.registration_group_id
                  ? facultyByGroupId.get(registration.registration_group_id) ?? null
                  : null,
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
      accommodation_access: auth.accommodation_access,
      assigned_category: auth.assigned_category,
      assigned_events: auth.assigned_events,
      total: totalCount ?? 0,
      page,
      pageSize,
      totalPages: Math.ceil((totalCount ?? 0) / pageSize),
      ...(schemaWarning ? { schemaWarning } : {}),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
  } catch (err) {
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
        mainCheckedIn?: unknown;
      } | null;

  if (
    !body ||
    typeof body.participantEventId !== "string" ||
    (typeof body.checkedIn !== "boolean" && typeof body.mainCheckedIn !== "boolean")
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

  const updatePayload: any = {};
  if (typeof body.checkedIn === "boolean") {
    updatePayload.checked_in = body.checkedIn;
    updatePayload.checked_in_at = body.checkedIn ? new Date().toISOString() : null;
  }
  if (typeof body.mainCheckedIn === "boolean") {
    updatePayload.main_checked_in = body.mainCheckedIn;
    updatePayload.main_checked_in_at = body.mainCheckedIn ? new Date().toISOString() : null;
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("participant_events")
    .update(updatePayload)
    .eq(
      "id",
      body.participantEventId
    )
    .select(
      "id, checked_in, checked_in_at, main_checked_in, main_checked_in_at"
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

  // Audit log for dashboard check-in actions
  if (auth.user) {
    let actionType = "MANUAL_UPDATE";
    const details: Record<string, unknown> = {};
    if (typeof body.checkedIn === "boolean") {
      actionType = body.checkedIn ? "MANUAL_EVENT_CHECK_IN" : "MANUAL_EVENT_CHECK_OUT";
      details.checked_in = body.checkedIn;
    } else if (typeof body.mainCheckedIn === "boolean") {
      actionType = body.mainCheckedIn ? "MANUAL_MAIN_CHECK_IN" : "MANUAL_MAIN_CHECK_OUT";
      details.main_checked_in = body.mainCheckedIn;
    }
    
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_id: auth.user.id,
      action_type: actionType,
      target_id: body.participantEventId,
      details,
    });
  }

  return NextResponse.json({
    registration: data,
  });
  } catch (err) {
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
        admin_id: auth.user.id,
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
  } catch (err) {
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
      admin_id: auth.user.id,
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
  } catch (err) {
    console.error("UNHANDLED POST ERROR:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}