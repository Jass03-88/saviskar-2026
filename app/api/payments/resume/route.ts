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
      participant_event_id,
      event_id,
      events (
        id,
        name,
        category,
        registration_type,
        registration_fee,
        payment_type,
        payment_unit
      )
    `
    )
    .eq("payment_order_id", paymentOrderId);

  if (itemsError) {
    console.error("Resume API: Items lookup error:", itemsError);
  }

  const items = (orderItems || []).map((item) => {
    const rawEvent = item.events;
    const event = Array.isArray(rawEvent) ? rawEvent[0] : rawEvent;

    return {
      itemId: item.id,
      eventId: item.event_id,
      eventName: event?.name || "Event Registration",
      category: event?.category || null,
      amount: Number(item.amount) || 0,
    };
  });

  // 8. Look up Team Members if any item is linked to participant_events
  const participantEventIds = (orderItems || [])
    .map((item) => item.participant_event_id)
    .filter(Boolean) as string[];

  let teamMembers: Array<{
    participantId: string;
    name: string;
    email: string | null;
    phone: string | null;
    college: string | null;
    isTeamLeader: boolean;
    role: string;
  }> = [];

  if (participantEventIds.length > 0) {
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
      .in("participant_event_id", participantEventIds)
      .order("is_team_leader", { ascending: false });

    if (membersError) {
      console.error("Resume API: Team members lookup error:", membersError);
    } else if (members && members.length > 0) {
      const mapped = members
        .map((row) => {
          const pData = Array.isArray(row.participants)
            ? row.participants[0]
            : row.participants;
          const memberPid = String(pData?.participant_id || "");
          const isLeader = row.is_team_leader === true;

          return {
            participantId: memberPid || (isLeader ? payer?.participant_id || participantId : ""),
            name: row.name || (isLeader ? payer?.name || "Team Leader" : "Team Member"),
            college: pData?.college || payer?.college || null,
            email: row.email || null,
            phone: row.phone || null,
            isTeamLeader: isLeader,
            role: isLeader ? "Team Head" : "Team Member",
          };
        })
        .filter((m) => Boolean(m.participantId));

      const hasLeader = mapped.some((m) => m.isTeamLeader);
      if (!hasLeader && payer) {
        mapped.unshift({
          participantId: payer.participant_id || participantId,
          name: payer.name || "Team Head",
          email: payer.email || null,
          phone: payer.phone || null,
          college: payer.college || null,
          isTeamLeader: true,
          role: "Team Head",
        });
      } else {
        mapped.sort((a, b) => (b.isTeamLeader ? 1 : 0) - (a.isTeamLeader ? 1 : 0));
      }

      teamMembers = mapped;
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
