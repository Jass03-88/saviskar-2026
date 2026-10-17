/**
 * GET /api/payments/resume?token=...
 *
 * Server-side payment resume endpoint.
 *
 * Verifies the cryptographic token signature and expiration, looks up the
 * exact payment order in Supabase, validates payer ownership, and returns
 * authoritative payment details and line items directly from the database.
 *
 * Security:
 *   - Token signature verified with HMAC-SHA256 (timing-safe)
 *   - Expiration checked server-side
 *   - Payer UUID match checked against payment_orders.payer_participant_id
 *   - Amount and currency loaded strictly from DB (no client override)
 *   - Safe error messages (no internal database errors or secrets leaked)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPaymentResumeToken } from "@/lib/payments/resume-token";
import { resolveReceiptTeamMembers } from "@/lib/payments/team-members";

function errorResponse(
  message: string,
  status: number,
  code: string = "ERROR"
) {
  return NextResponse.json(
    { success: false, error: message, code },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    return errorResponse(
      "Payment link token is missing.",
      400,
      "MISSING_TOKEN"
    );
  }

  // 1. Verify token signature & expiration
  const tokenResult = verifyPaymentResumeToken(token);

  if (!tokenResult.valid || !tokenResult.payload) {
    return errorResponse(
      tokenResult.error || "This payment link is invalid or has expired.",
      400,
      "INVALID_TOKEN"
    );
  }

  const { paymentOrderId, payerParticipantUuid, participantId } =
    tokenResult.payload;

  // 2. Supabase Admin Client
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("Resume API: Supabase configuration missing.");
    return errorResponse(
      "Payment service is temporarily unavailable.",
      500,
      "CONFIG_ERROR"
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // 3. Look up Payment Order
  const { data: paymentOrder, error: orderError } = await supabaseAdmin
    .from("payment_orders")
    .select(
      `
      id,
      order_reference,
      payer_participant_id,
      amount,
      currency,
      status,
      gateway,
      gateway_order_id,
      created_at
    `
    )
    .eq("id", paymentOrderId)
    .maybeSingle();

  if (orderError) {
    console.error("Resume API: Payment order lookup error:", orderError);
    return errorResponse(
      "Could not retrieve payment details.",
      500,
      "DB_ERROR"
    );
  }

  if (!paymentOrder) {
    return errorResponse(
      "Payment order was not found.",
      404,
      "NOT_FOUND"
    );
  }

  // 4. Verify Payer Ownership
  if (paymentOrder.payer_participant_id !== payerParticipantUuid) {
    console.warn(
      "Resume API: Payer mismatch on resume token:",
      {
        expected: paymentOrder.payer_participant_id,
        token: payerParticipantUuid,
      }
    );
    return errorResponse(
      "Unauthorized access to this payment order.",
      403,
      "UNAUTHORIZED"
    );
  }

  // 5. Check Order Status
  if (paymentOrder.status !== "pending" && paymentOrder.status !== "paid") {
    return errorResponse(
      "This payment order is no longer valid for resume.",
      400,
      "ORDER_INVALID_STATE"
    );
  }

  // 6. Look up Payer Profile Information
  const { data: payer, error: payerError } = await supabaseAdmin
    .from("participants")
    .select("participant_id, name, college, email, phone")
    .eq("id", payerParticipantUuid)
    .maybeSingle();

  if (payerError || !payer) {
    console.error("Resume API: Payer profile lookup error:", payerError);
  }

  // 7. Look up Line Items & Events
  const { data: orderItems, error: itemsError } = await supabaseAdmin
    .from("payment_order_items")
    .select(
      `
      id,
      amount,
      item_type,
      participant_event_id,
      participant_accommodation_id,
      event_id,
      events (
        id,
        name,
        category,
        registration_type,
        registration_fee,
        payment_type,
        payment_unit
      ),
      participant_accommodations (
        id,
        status,
        start_date,
        end_date,
        accommodation_plans (
          name,
          slug,
          duration
        )
      )
    `
    )
    .eq("payment_order_id", paymentOrderId);

  if (itemsError) {
    console.error("Resume API: Items lookup error:", itemsError);
  }

  const items = (orderItems || []).map((item) => {
    if (item.item_type === "accommodation") {
      const rawAcc = item.participant_accommodations;
      const acc = Array.isArray(rawAcc) ? rawAcc[0] : rawAcc;
      const rawPlan = acc?.accommodation_plans;
      const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;

      return {
        itemId: item.id,
        eventId: null,
        itemType: "accommodation",
        eventName: plan?.name ? `Accommodation: ${plan.name}` : "Accommodation",
        category: "Accommodation",
        amount: Number(item.amount) || 0,
        startDate: acc?.start_date || null,
        endDate: acc?.end_date || null,
        durationDays: (plan as any)?.duration ?? 1,
        planName: plan?.name || null,
      };
    }

    const rawEvent = item.events;
    const event = Array.isArray(rawEvent) ? rawEvent[0] : rawEvent;

    return {
      itemId: item.id,
      eventId: item.event_id,
      itemType: "event",
      eventName: event?.name || "Event Registration",
      category: event?.category || null,
      amount: Number(item.amount) || 0,
      registrationType: event?.registration_type || "individual",
    };
  });

  const isAnyTeamEvent = (orderItems || []).some((item) => {
    const rawEvent = item.events;
    const event = Array.isArray(rawEvent) ? rawEvent[0] : rawEvent;
    return event?.registration_type === "team";
  });

  // 8. Look up Team Members strictly for team events
  const teamParticipantEventIds = (orderItems || [])
    .filter((item) => {
      const rawEvent = item.events;
      const event = Array.isArray(rawEvent) ? rawEvent[0] : rawEvent;
      return event?.registration_type === "team";
    })
    .map((item) => item.participant_event_id)
    .filter(Boolean) as string[];

  let teamMemberRows: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    is_team_leader: boolean;
    participant_event_id: string;
    participants: { participant_id?: string; college?: string } | { participant_id?: string; college?: string }[] | null;
  }> = [];

  if (isAnyTeamEvent && teamParticipantEventIds.length > 0) {
    const { data: members, error: membersError } = await supabaseAdmin
      .from("participant_event_members")
      .select(`
        id,
        name,
        email,
        phone,
        is_team_leader,
        participant_event_id,
        participants (
          participant_id,
          college
        )
      `)
      .in("participant_event_id", teamParticipantEventIds)
      .order("is_team_leader", { ascending: false });

    if (membersError) {
      console.error("Resume API: Team members lookup error:", membersError);
    } else if (members) {
      teamMemberRows = members as unknown as typeof teamMemberRows;
    }
  }

  const teamMembers = resolveReceiptTeamMembers({
    isAnyTeamEvent,
    teamMemberRows,
    payer: payer ? {
      participant_id: payer.participant_id || participantId,
      name: payer.name,
      email: payer.email,
      phone: payer.phone,
      college: payer.college,
    } : null,
  });

  // 9. Authoritative Reconciliation of ALL Participant Registrations & Accommodations
  // Ensures free competitions (amount = 0) and accommodation bookings are preserved and displayed
  const { data: allParticipantEvents } = await supabaseAdmin
    .from("participant_events")
    .select(`
      id,
      event_id,
      registration_status,
      payment_status,
      payment_amount,
      team_name,
      checked_in,
      events (
        id,
        name,
        category,
        registration_type,
        registration_fee,
        payment_type
      )
    `)
    .eq("participant_id", payerParticipantUuid)
    .eq("is_archived", false);

  const { data: allParticipantAccommodations } = await supabaseAdmin
    .from("participant_accommodations")
    .select(`
      id,
      accommodation_plan_id,
      start_date,
      end_date,
      duration_days,
      amount,
      currency,
      status,
      accommodation_plans (
        id,
        name,
        slug,
        duration,
        price
      )
    `)
    .eq("participant_id", payerParticipantUuid)
    .neq("status", "cancelled");

  const registeredCompetitions = (allParticipantEvents ?? []).map((pe) => {
    const rawEvt = Array.isArray(pe.events) ? pe.events[0] : pe.events;
    return {
      participantEventId: pe.id,
      eventId: pe.event_id,
      eventName: rawEvt?.name ?? "Unknown event",
      category: rawEvt?.category ?? null,
      registrationType: rawEvt?.registration_type ?? (pe.team_name ? "team" : "individual"),
      teamName: pe.team_name,
      paymentType: rawEvt?.payment_type ?? (Number(pe.payment_amount) > 0 ? "paid" : "free"),
      paymentStatus: pe.payment_status,
      amount: Number(pe.payment_amount) || 0,
    };
  });

  const registeredAccommodations = (allParticipantAccommodations ?? []).map((acc) => {
    const rawPlan = Array.isArray(acc.accommodation_plans) ? acc.accommodation_plans[0] : acc.accommodation_plans;
    return {
      id: acc.id,
      planName: rawPlan?.name ?? "Accommodation",
      planSlug: rawPlan?.slug ?? "",
      startDate: acc.start_date,
      endDate: acc.end_date,
      durationDays: acc.duration_days,
      amount: Number(acc.amount) || 0,
      currency: acc.currency || "INR",
      status: acc.status,
    };
  });

  // 10. Check for Authoritative Accommodation Overlap Conflicts
  let accommodationConflict = false;
  let accommodationConflictNotice: {
    headline: string;
    message: string;
    supportEmail: string;
    supportPhone: string | null;
    affectedStay?: {
      planName: string;
      startDate: string;
      endDate: string;
      amount: number;
    };
  } | null = null;

  if (paymentOrder.status === "paid") {
    const accommodationItems = (orderItems || []).filter(
      (item) => item.item_type === "accommodation"
    );

    if (accommodationItems.length > 0) {
      // Find any accommodation item in this order whose associated record is cancelled
      const unconfirmedAccItem = accommodationItems.find((item) => {
        const rawAcc = item.participant_accommodations;
        const acc = Array.isArray(rawAcc) ? rawAcc[0] : rawAcc;
        return acc && acc.status === "cancelled";
      });

      if (unconfirmedAccItem) {
        try {
          // Authoritatively verify against conflict audit log to distinguish from ordinary cancellations
          const { data: conflictLogs, error: logError } = await supabaseAdmin
            .from("admin_audit_logs")
            .select("id, action_type, details, created_at")
            .eq("action_type", "ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT")
            .filter("details->>payment_order_id", "eq", paymentOrderId)
            .limit(1);

          if (!logError && conflictLogs && conflictLogs.length > 0) {
            accommodationConflict = true;
            const rawAcc = unconfirmedAccItem.participant_accommodations;
            const acc = Array.isArray(rawAcc) ? rawAcc[0] : rawAcc;
            const rawPlan = acc?.accommodation_plans;
            const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;

            const logDetails = (conflictLogs[0].details || {}) as Record<string, any>;
            const userParticipantId = payer?.participant_id || participantId;

            accommodationConflictNotice = {
              headline: "Accommodation Booking Unavailable",
              message: `Your payment was received and verified, but the requested accommodation stay could not be confirmed because the dates are fully booked or conflict with an active booking. Your event registrations are confirmed. Please contact the Saviskar Helpdesk at support@saviskar.co.in with your Participant ID (${userParticipantId}) and Order Reference (${paymentOrder.order_reference}) for assistance with alternate accommodation or refund evaluation.`,
              supportEmail: "support@saviskar.co.in",
              supportPhone: null,
              affectedStay: {
                planName: plan?.name || "Accommodation Stay",
                startDate: acc?.start_date || logDetails.start_date || "2026-10-28",
                endDate: acc?.end_date || logDetails.end_date || "2026-10-29",
                amount: Number(unconfirmedAccItem.amount) || Number(logDetails.amount) || 0,
              },
            };
          }
        } catch (e) {
          console.error("Resume API: Error querying conflict logs:", e);
        }
      }
    }
  }

  return NextResponse.json(
    {
      success: true,
      status: paymentOrder.status,
      paymentOrderId: paymentOrder.id,
      orderReference: paymentOrder.order_reference,
      amount: Number(paymentOrder.amount),
      currency: paymentOrder.currency || "INR",
      participant: {
        participantId: payer?.participant_id || participantId,
        name: payer?.name || "Participant",
        college: payer?.college || "",
        email: payer?.email || "",
      },
      items,
      registeredCompetitions,
      registeredAccommodations,
      accommodationConflict,
      accommodationConflictNotice,
      teamMembers: teamMembers.length > 0 ? teamMembers : undefined,
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
  } catch (err) {
    console.error("Resume API Unhandled Error:", err);
    return errorResponse("An unexpected error occurred while loading payment details.", 500, "INTERNAL_ERROR");
  }
}
