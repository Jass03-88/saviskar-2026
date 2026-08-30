import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    return NextResponse.json(
      { error: "Payment service is not configured." },
      { status: 500 }
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { participantId, participantEventId } = body;

  if (!participantId || !participantEventId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // 1. Verify ownership & get event details
  const { data: pe, error: peError } = await supabaseAdmin
    .from("participant_events")
    .select(`
      id, payment_status, event_id, payment_amount,
      participants!inner(participant_id, id),
      events!inner(payment_type)
    `)
    .eq("id", participantEventId)
    .maybeSingle();

  if (peError || !pe) {
    return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  }

  const participantData = Array.isArray(pe.participants) ? pe.participants[0] : pe.participants;
  const eventData = Array.isArray(pe.events) ? pe.events[0] : pe.events;

  if (!participantData || participantData.participant_id !== participantId) {
    return NextResponse.json({ error: "Unauthorized. Registration does not belong to this participant." }, { status: 403 });
  }

  if (pe.payment_status === "paid") {
    return NextResponse.json({ error: "Payment is already completed." }, { status: 400 });
  }
  
  // Use the finalized payment_amount from participant_events.
  // This already accounts for per_student team multiplication
  // (e.g. 4 students × ₹200 = ₹800).
  const amount = pe.payment_amount || 0;
  if (amount <= 0) {
    return NextResponse.json({ error: "No payment required for this event." }, { status: 400 });
  }

  // 2. Look for existing pending payment_order
  const { data: existingItem } = await supabaseAdmin
    .from("payment_order_items")
    .select("payment_order_id, payment_orders!inner(status)")
    .eq("participant_event_id", participantEventId)
    .eq("payment_orders.status", "pending")
    .limit(1)
    .maybeSingle();

  if (existingItem?.payment_order_id) {
    return NextResponse.json({ paymentOrderId: existingItem.payment_order_id });
  }

  // 3. Create new payment order
  const orderRef = `SVK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  
  const { data: newOrder, error: orderError } = await supabaseAdmin
    .from("payment_orders")
    .insert({
      order_reference: orderRef,
      payer_participant_id: participantData.id,
      amount: amount,
      currency: "INR",
      status: "pending"
    })
    .select("id")
    .single();

  if (orderError || !newOrder) {
    console.error("Order create error:", orderError);
    return NextResponse.json({ error: "Could not create payment order." }, { status: 500 });
  }

  // 4. Create payment order item
  const { error: itemError } = await supabaseAdmin
    .from("payment_order_items")
    .insert({
      payment_order_id: newOrder.id,
      participant_id: participantData.id,
      participant_event_id: participantEventId,
      event_id: pe.event_id,
      amount: amount
    });

  if (itemError) {
    console.error("Order item create error:", itemError);
    return NextResponse.json({ error: "Could not link payment order." }, { status: 500 });
  }

  return NextResponse.json({ paymentOrderId: newOrder.id });
}
