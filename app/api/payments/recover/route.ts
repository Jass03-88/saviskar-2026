import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { getRegistrationSession } from "@/lib/auth/session";
import { verifyPaymentResumeToken } from "@/lib/payments/resume-token";

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return errorResponse("Payment service is not configured.", 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let body: {
    participantId?: string;
    participantEventId?: string;
    participantAccommodationId?: string;
    resumeToken?: string;
  };

  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid request body.", 400);
  }

  const participantId =
    typeof body.participantId === "string" ? body.participantId.trim().toUpperCase() : "";
  const participantEventId =
    typeof body.participantEventId === "string" ? body.participantEventId.trim() : "";
  const participantAccommodationId =
    typeof body.participantAccommodationId === "string" ? body.participantAccommodationId.trim() : "";

  if (!participantId || (!participantEventId && !participantAccommodationId)) {
    return errorResponse("Missing required fields.", 400);
  }

  // ─── Token Input Conflict Hardening ─────────────────────
  const headerToken =
    request.headers.get("x-payment-resume-token")?.trim() || "";
  const bodyToken =
    typeof body.resumeToken === "string" ? body.resumeToken.trim() : "";

  if (headerToken && bodyToken && headerToken !== bodyToken) {
    return errorResponse("Mismatched payment resume tokens provided.", 400);
  }

  const resumeToken = headerToken || bodyToken;

  // ─── Initial Credential Check ───────────────────────────
  const session = await getRegistrationSession();

  if (!session.authenticated && !resumeToken) {
    return errorResponse("Payment recovery authorization required.", 401);
  }

  // ─── 1. Load Item & Owner ──────────────────────────────
  let participantData: { id: string; participant_id: string; email: string } | null = null;
  let amount = 0;
  let itemEventId: string | null = null;

  if (participantEventId) {
    const { data: pe, error: peError } = await supabaseAdmin
      .from("participant_events")
      .select(`
        id, payment_status, event_id, payment_amount,
        participants!inner(participant_id, id, email),
        events!inner(payment_type)
      `)
      .eq("id", participantEventId)
      .maybeSingle();

    if (peError || !pe) {
      return errorResponse("Registration not found.", 404);
    }

    const rawParticipant = pe.participants;
    participantData = Array.isArray(rawParticipant) ? rawParticipant[0] : rawParticipant;

    if (!participantData || participantData.participant_id !== participantId) {
      return errorResponse("Unauthorized. Registration does not belong to this participant.", 403);
    }

    if (pe.payment_status === "paid") {
      return errorResponse("Payment is already completed.", 400);
    }

    amount = Number(pe.payment_amount) || 0;
    itemEventId = pe.event_id;
  } else if (participantAccommodationId) {
    const { data: pa, error: paError } = await supabaseAdmin
      .from("participant_accommodations")
      .select(`
        id, status, amount, payment_order_id, start_date, end_date,
        participants!inner(participant_id, id, email)
      `)
      .eq("id", participantAccommodationId)
      .maybeSingle();

    if (paError || !pa) {
      return errorResponse("Accommodation booking not found.", 404);
    }

    const rawParticipant = pa.participants;
    participantData = Array.isArray(rawParticipant) ? rawParticipant[0] : rawParticipant;

    if (!participantData || participantData.participant_id !== participantId) {
      return errorResponse("Unauthorized. Booking does not belong to this participant.", 403);
    }

    if (pa.status === "paid") {
      return errorResponse("Payment is already completed.", 400);
    }

    if (pa.status === "cancelled") {
      return errorResponse("This accommodation booking has been cancelled and cannot be paid.", 400);
    }

    // Payment-Integrity Safeguard: Reject recovery if another confirmed booking already claimed these dates
    if (pa.start_date && pa.end_date) {
      const { data: conflict } = await supabaseAdmin
        .from("participant_accommodations")
        .select("id")
        .eq("participant_id", participantData.id)
        .neq("id", pa.id)
        .eq("status", "paid")
        .lt("start_date", pa.end_date)
        .gt("end_date", pa.start_date)
        .limit(1)
        .maybeSingle();

      if (conflict) {
        return errorResponse(
          "These accommodation dates are already covered by another confirmed booking.",
          400
        );
      }
    }

    amount = Number(pa.amount) || 0;
  }

  if (!participantData) {
    return errorResponse("Participant not found.", 404);
  }

  // ─── 2. Authorize via Session or Resume Token ───────────
  let isAuthorized = false;

  // Option A: Active Registration Session
  if (session.authenticated && session.email) {
    if (
      participantData.email &&
      session.email.toLowerCase() === participantData.email.trim().toLowerCase()
    ) {
      isAuthorized = true;
    }
  }

  // Option B: Signed Payment Resume Token
  let verifiedTokenPayload: ReturnType<typeof verifyPaymentResumeToken>["payload"] = undefined;

  if (!isAuthorized && resumeToken) {
    const tokenResult = verifyPaymentResumeToken(resumeToken);
    if (tokenResult.valid && tokenResult.payload) {
      const payload = tokenResult.payload;
      if (
        payload.participantId === participantData.participant_id &&
        payload.payerParticipantUuid === participantData.id
      ) {
        isAuthorized = true;
        verifiedTokenPayload = payload;
      }
    }
  }

  if (!isAuthorized) {
    return errorResponse("Unauthorized access to this registration.", 403);
  }

  if (amount <= 0) {
    return errorResponse("No payment required for this item.", 400);
  }

  // ─── 4. Look For Existing Pending Payment Order ─────────
  let itemQuery = supabaseAdmin
    .from("payment_order_items")
    .select(`
      payment_order_id,
      participant_id,
      payment_orders!inner(id, status, payer_participant_id)
    `)
    .eq("payment_orders.status", "pending")
    .limit(1);

  if (participantEventId) {
    itemQuery = itemQuery.eq("participant_event_id", participantEventId);
  } else {
    itemQuery = itemQuery.eq("participant_accommodation_id", participantAccommodationId);
  }

  const { data: existingItem } = await itemQuery.maybeSingle();

  if (existingItem?.payment_order_id) {
    const paymentOrderData = Array.isArray(existingItem.payment_orders)
      ? existingItem.payment_orders[0]
      : existingItem.payment_orders;

    // Verify entire chain resolves to the same participant
    if (
      existingItem.participant_id !== participantData.id ||
      paymentOrderData?.payer_participant_id !== participantData.id
    ) {
      return errorResponse("Payment order data mismatch.", 403);
    }

    if (
      verifiedTokenPayload &&
      verifiedTokenPayload.paymentOrderId !== existingItem.payment_order_id
    ) {
      return errorResponse("Payment token does not match this order.", 403);
    }

    return NextResponse.json(
      { paymentOrderId: existingItem.payment_order_id },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // If authorized via resume token, token is tied to a specific paymentOrderId
  if (verifiedTokenPayload) {
    return errorResponse("Pending payment order for this link was not found.", 404);
  }

  // ─── 5. Create New Payment Order (Session Authorized) ───
  const orderRef = `SVK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

  const { data: newOrder, error: orderError } = await supabaseAdmin
    .from("payment_orders")
    .insert({
      order_reference: orderRef,
      payer_participant_id: participantData.id,
      amount: amount,
      currency: "INR",
      status: "pending",
    })
    .select("id")
    .single();

  if (orderError || !newOrder) {
    console.error("Order create error:", orderError);
    return errorResponse("Could not create payment order.", 500);
  }

  // ─── 6. Create Payment Order Item ───────────────────────
  const orderItemPayload: Record<string, unknown> = {
    payment_order_id: newOrder.id,
    participant_id: participantData.id,
    amount: amount,
  };

  if (participantEventId) {
    orderItemPayload.participant_event_id = participantEventId;
    orderItemPayload.event_id = itemEventId;
    orderItemPayload.item_type = "event";
  } else {
    orderItemPayload.participant_accommodation_id = participantAccommodationId;
    orderItemPayload.item_type = "accommodation";
  }

  const { error: itemError } = await supabaseAdmin
    .from("payment_order_items")
    .insert(orderItemPayload);

  if (itemError) {
    console.error("Order item create error:", itemError);
    return errorResponse("Could not link payment order.", 500);
  }

  if (participantAccommodationId) {
    await supabaseAdmin
      .from("participant_accommodations")
      .update({ payment_order_id: newOrder.id, updated_at: new Date().toISOString() })
      .eq("id", participantAccommodationId);
  }

  return NextResponse.json(
    { paymentOrderId: newOrder.id },
    { headers: { "Cache-Control": "no-store" } }
  );
}
