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
  main_checked_in: boolean | null;
  main_checked_in_at: string | null;
  is_archived: boolean | null;
  registration_group_id: string | null;
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
  participants: {
    participant_id: string;
    college: string | null;
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
      }
    | {
        participant_id?: string | null;
        college?: string | null;
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

  // 1. Fetch paginated participant_events with optional eventId filter
  let peQuery = supabaseAdmin
    .from("participant_events")
    .select(
      "id, participant_id, event_id, registration_status, payment_status, payment_amount, payment_id, team_name, checked_in, checked_in_at, main_checked_in, main_checked_in_at, registration_group_id, is_archived, created_at",
      { count: "exact" }
    );

  if (eventId) {
    peQuery = peQuery.eq("event_id", eventId);
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
        "id, participant_id, event_id, registration_status, payment_status, payment_amount, payment_id, team_name, checked_in, checked_in_at, registration_group_id, is_archived, created_at",
        { count: "exact" }
      );
      
    if (eventId) {
      peQuery = peQuery.eq("event_id", eventId);
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
            "id, participant_id, name, college, email, phone, photo_url, gender, state, id_card_storage_path, created_at"
          )
          .in("id", participantIds)
      : Promise.resolve({ data: [], error: null }),

    supabaseAdmin
      .from("events")
      .select("id, name, category, payment_type, registration_fee, registration_limit")
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

  const registrationGroupIds = Array.from(
    new Set(participantEvents.map((pe) => pe.registration_group_id).filter(Boolean))
  );

  const [facultyResult] = await Promise.all([
    registrationGroupIds.length > 0
      ? supabaseAdmin
          .from("faculty_incharges")
          .select("registration_group_id, participants(id, name, email, phone, college, gender, state, id_card_storage_path)")
          .in("registration_group_id", registrationGroupIds)
      : Promise.resolve({ data: [], error: null }),
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

  const events =
    (eventsResult.data ?? []) as EventRecord[];

  const rawMembers =
    (membersResult.data ?? []) as unknown as RawMember[];

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

  const facultyByGroupId = new Map<string, any>();
  if (facultyResult.data) {
    for (const f of facultyResult.data) {
      if (f.registration_group_id && f.participants) {
        facultyByGroupId.set(f.registration_group_id, f.participants);
      }
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
              payment_order:
                paymentOrdersByRegistration.get(
                  registration.id
                ) ?? null,
              faculty:
                (registration.registration_group_id && facultyByGroupId.get(registration.registration_group_id)) || null,
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
      adminEmail: auth.user?.email || null,
      adminName: auth.user?.user_metadata?.full_name || null,
      isPrimary: auth.user?.id === process.env.PRIMARY_ADMIN_USER_ID,
      accommodation_access: auth.accommodation_access,
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
    let details: any = {};
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

  // Pre-fetch participant and payment info before deletion to handle accommodation lifecycles safely
  let participantId: string | null = null;
  let registrationGroupId: string | null = null;
  let allPaymentOrderIds: string[] = [];
  let pendingPaymentOrderIds: string[] = [];
  // Pre-fetch the participant's active accommodations directly (covers free-event + accommodation checkout)
  let preDeleteAccommodations: { id: string; status: string; payment_order_id: string | null }[] = [];

  if (permanent) {
    const { data: eventData } = await supabaseAdmin
      .from("participant_events")
      .select("participant_id, registration_group_id")
      .eq("id", participantEventId)
      .single();
    
    if (eventData) {
      participantId = eventData.participant_id;
      registrationGroupId = eventData.registration_group_id;

      // Strategy A: Find payment orders via event-type payment_order_items (works for paid events)
      const { data: eventItems } = await supabaseAdmin
        .from("payment_order_items")
        .select("payment_order_id, payment_orders!inner(status)")
        .eq("participant_event_id", participantEventId);

      const eventPaymentOrderIds = eventItems?.map((i: any) => i.payment_order_id).filter(Boolean) || [];

      // Strategy B: Also fetch the participant's non-cancelled accommodations directly.
      // This covers the free-event case where the accommodation payment_order_item
      // has participant_event_id=NULL (only participant_accommodation_id is set).
      const { data: accRows } = await supabaseAdmin
        .from("participant_accommodations")
        .select("id, status, payment_order_id")
        .eq("participant_id", participantId)
        .not("status", "in", "(cancelled,failed)");

      preDeleteAccommodations = (accRows || []) as typeof preDeleteAccommodations;

      // Collect ALL payment_order_ids from both event items and accommodation rows
      const accPaymentOrderIds = preDeleteAccommodations
        .map((a) => a.payment_order_id)
        .filter(Boolean) as string[];

      allPaymentOrderIds = Array.from(new Set([...eventPaymentOrderIds, ...accPaymentOrderIds]));

      // For pending PO cleanup: merge payment order statuses from both sources
      const paidEventPOIds = new Set(
        eventItems?.filter((i: any) => i.payment_orders.status === "paid")
          .map((i: any) => i.payment_order_id) || []
      );

      // Check accommodation payment orders' statuses
      const accPOsToCheck = accPaymentOrderIds.filter((id) => !paidEventPOIds.has(id));
      if (accPOsToCheck.length > 0) {
        const { data: accPOs } = await supabaseAdmin
          .from("payment_orders")
          .select("id, status")
          .in("id", accPOsToCheck);
        for (const po of (accPOs || [])) {
          if (po.status === "paid") paidEventPOIds.add(po.id);
        }
      }

      pendingPaymentOrderIds = allPaymentOrderIds.filter((id) => !paidEventPOIds.has(id));
    }
  }

  let error;

  if (permanent) {
    const res = await supabaseAdmin.rpc("delete_registration_permanently", {
      p_participant_event_id: participantEventId,
      p_admin_id: auth.user.id,
    });
    error = res.error;

    if (!error && participantId) {
      // 1. Identify registration-bound accommodations from pre-fetched data.
      // We use pre-fetched data because AFTER deletion, ON DELETE SET NULL may have
      // cleared payment_order_items.participant_event_id, breaking post-hoc lineage queries.
      // Only affect accommodations whose payment_order_id is in allPaymentOrderIds
      // (proving they were co-created in the same checkout session).
      const linkedAccs = preDeleteAccommodations.filter(
        (a) => a.payment_order_id && allPaymentOrderIds.includes(a.payment_order_id)
      );
      
      const unpaidAccIds = linkedAccs.filter((a) => a.status !== "paid").map((a) => a.id);
      const paidAccIds = linkedAccs.filter((a) => a.status === "paid").map((a) => a.id);

      // 2. Delete entirely any pending payment orders that were mathematically invalidated by this deletion.
      for (const poId of pendingPaymentOrderIds) {
        await supabaseAdmin
          .from("payment_orders")
          .delete()
          .eq("id", poId)
          .neq("status", "paid");
      }

      // 3. Prevent Orphaned Accommodation Bookings
      // Check if participant has any other remaining events
      const { count: remainingCount, error: countError } = await supabaseAdmin
        .from("participant_events")
        .select("*", { count: "exact", head: true })
        .eq("participant_id", participantId);

      if (countError || remainingCount === null) {
        return NextResponse.json(
          { error: "Failed to verify remaining events. Aborting accommodation cleanup for safety." },
          { status: 500 }
        );
      }

      // ONLY affect accommodation when the participant is completely dropping out (0 remaining events).
      // This protects multi-event participants: deleting Event A while Event B exists won't touch accommodation.
      if (remainingCount === 0) {
        if (unpaidAccIds.length > 0) {
          // Unpaid/pending accommodations from the checkout can be safely deleted
          await supabaseAdmin
            .from("participant_accommodations")
            .delete()
            .in("id", unpaidAccIds)
            .neq("status", "paid");
        }

        if (paidAccIds.length > 0) {
          // Paid accommodations must NOT be deleted. Transition them safely to 'cancelled'
          // so financial history is preserved, but they no longer block re-registration.
          await supabaseAdmin
            .from("participant_accommodations")
            .update({ status: "cancelled" })
            .in("id", paidAccIds)
            .eq("status", "paid");
        }
      }
    }
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