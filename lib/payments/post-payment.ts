import { createClient } from "@supabase/supabase-js";
import { generateReceiptPdf, ReceiptData } from "../generate-receipt-pdf";
import { sendRegistrationEmail } from "../send-registration-email";
import crypto from "crypto";

export async function ensurePaymentConfirmationSent(paymentOrderId: string) {
  console.log(`[RECEIPT] entered function for paymentOrder: ${paymentOrderId}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error("[RECEIPT] ensurePaymentConfirmationSent: Missing Supabase config.");
    return;
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // 1. ATOMIC CLAIM (with stale-claim recovery)
  // We try to claim the payment order for receipt generation.
  // A claim is valid if unsent AND (unclaimed OR claim is stale > 10 minutes).
  console.log(`[RECEIPT] attempting atomic claim for order: ${paymentOrderId}`);
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const claimId = crypto.randomUUID();

  const { data: claimData, error: claimError } = await supabaseAdmin
    .from("payment_orders")
    .update({
      receipt_email_claim_id: claimId,
      receipt_email_claimed_at: now.toISOString(),
    })
    .eq("id", paymentOrderId)
    .is("receipt_email_sent_at", null)
    .or(`receipt_email_claim_id.is.null,receipt_email_claimed_at.lt.${staleThreshold}`)
    .select("id");

  if (claimError) {
    console.error("[RECEIPT] claim FAILED with error:", claimError);
    return;
  }

  // If we didn't update any rows, it means the email was already sent or an active (<10 min) claim exists.
  if (!claimData || claimData.length === 0) {
    console.log(`[RECEIPT] claim FAILED (0 rows updated) - already claimed/sent. Skipping.`);
    return;
  }
  
  console.log(`[RECEIPT] claim SUCCESS for order: ${paymentOrderId} with claimId: ${claimId}`);

  try {
    // 2. FETCH VERIFIED DATA
    // We only trust the database, not the client payload.
    const { data: order, error: orderError } = await supabaseAdmin
      .from("payment_orders")
      .select(`
        order_reference,
        amount,
        currency,
        gateway,
        gateway_order_id,
        gateway_payment_id,
        payer_participant_id
      `)
      .eq("id", paymentOrderId)
      .single();

    if (orderError || !order) {
      throw new Error(`Failed to fetch payment order details: ${orderError?.message}`);
    }
    console.log(`[RECEIPT] payment order found. amount: ${order.amount}, status: paid (implied by execution)`);

    // Get the authoritative payment time from the 'payments' table
    const { data: paymentRecord } = await supabaseAdmin
      .from("payments")
      .select("created_at")
      .eq("gateway_payment_id", order.gateway_payment_id)
      .limit(1)
      .maybeSingle();

    const paymentDateStr = paymentRecord?.created_at
      ? new Date(paymentRecord.created_at).toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : new Date().toLocaleString("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
        });

    // Fetch participant data
    const { data: participant } = await supabaseAdmin
      .from("participants")
      .select("participant_id, name, email, phone, college")
      .eq("id", order.payer_participant_id)
      .single();

    if (!participant) {
      throw new Error("Payer participant not found.");
    }
    console.log(`[RECEIPT] recipient email resolved: ${participant.email}`);

    // Fetch linked events and members from payment_order_items
    const { data: orderItems, error: itemsError } = await supabaseAdmin
      .from("payment_order_items")
      .select(`
        id,
        amount,
        event_id,
        participant_event_id,
        events (
          name,
          category,
          registration_type
        ),
        participant_events (
          id,
          team_name
        )
      `)
      .eq("payment_order_id", paymentOrderId);

    if (itemsError || !orderItems || orderItems.length === 0) {
      throw new Error(`No payment order items found: ${itemsError?.message}`);
    }

    const receiptItems = orderItems.map((item: any) => {
      const eventData = Array.isArray(item.events) ? item.events[0] : item.events;
      const peData = Array.isArray(item.participant_events) ? item.participant_events[0] : item.participant_events;
      return {
        eventName: eventData?.name ?? "Event Registration",
        category: eventData?.category ?? null,
        registrationType: (eventData?.registration_type as "individual" | "team") ?? "individual",
        teamName: peData?.team_name ?? null,
        amount: Number(item.amount) || 0,
      };
    });

    const primaryItem = orderItems[0];
    const primaryEvent = Array.isArray(primaryItem.events) ? primaryItem.events[0] : primaryItem.events;
    const primaryPe = Array.isArray(primaryItem.participant_events) ? primaryItem.participant_events[0] : primaryItem.participant_events;

    // 3. GENERATE MULTI-EVENT PDF
    const receiptData: ReceiptData = {
      receiptReference: `RCP-${order.order_reference}`,
      paymentDate: paymentDateStr,
      participantName: participant.name,
      participantId: participant.participant_id,
      email: participant.email,
      phone: participant.phone,
      college: participant.college,
      items: receiptItems,
      eventName: primaryEvent?.name ?? "Saviskar Event",
      eventCategory: primaryEvent?.category ?? null,
      registrationType: (primaryEvent?.registration_type as "individual" | "team") ?? "individual",
      teamName: primaryPe?.team_name ?? null,
      amount: order.amount,
      gateway: order.gateway || "Unknown",
      gatewayOrderId: order.gateway_order_id || "",
      gatewayPaymentId: order.gateway_payment_id || "",
    };

    console.log(`[RECEIPT] generating multi-event PDF with ${receiptItems.length} item(s)`);
    const pdfBuffer = await generateReceiptPdf(receiptData);
    console.log(`[RECEIPT] PDF generated + byte size: ${pdfBuffer.byteLength}`);

    // Get team members for primary event if any
    const primaryPeId = primaryPe?.id || primaryItem.participant_event_id;
    const { data: teamMemberRows } = await supabaseAdmin
      .from("participant_event_members")
      .select(`
        name, email, phone, is_team_leader,
        participants ( participant_id, college )
      `)
      .eq("participant_event_id", primaryPeId);

    const emailMembers = (teamMemberRows ?? [])
      .map((row) => {
        const pData = Array.isArray(row.participants) ? row.participants[0] : row.participants;
        return {
          participantId: String(pData?.participant_id ?? ""),
          name: String(row.name ?? ""),
          college: String(pData?.college ?? ""),
          email: String(row.email ?? ""),
          phone: String(row.phone ?? ""),
          isTeamLeader: row.is_team_leader === true,
        };
      })
      .filter((row) => row.participantId !== String(participant.participant_id));

    // Summary event label for email
    const eventNameLabel = receiptItems.length === 1
      ? receiptItems[0].eventName
      : `${receiptItems[0].eventName} (+${receiptItems.length - 1} more)`;

    // 4. SEND EMAIL
    const emailResult = await sendRegistrationEmail({
      registrationId: primaryPeId,
      participantId: participant.participant_id,
      eventName: eventNameLabel,
      eventCategory: primaryEvent?.category ?? null,
      name: participant.name,
      college: participant.college,
      email: participant.email,
      phone: participant.phone,
      team: primaryPe?.team_name ?? null,
      isTeamEvent: primaryEvent?.registration_type === "team",
      isTeamHead: true,
      members: emailMembers,
      receiptPdf: {
        buffer: pdfBuffer,
        filename: `Saviskar-2026-Payment-Receipt-${participant.participant_id}.pdf`,
      },
    });

    console.log(`[RECEIPT] sending through Resend...`);
    
    if (!emailResult.success) {
      console.error(`[RECEIPT] Resend response / ERROR:`, emailResult.error);
      throw new Error(`Email sending failed: ${emailResult.error}`);
    }
    console.log(`[RECEIPT] Resend response: success`);

    console.log(`[RECEIPT] updating receipt_email_sent_at`);
    // 5. MARK AS SENT & CLEAR CLAIM
    await supabaseAdmin
      .from("payment_orders")
      .update({ 
        receipt_email_sent_at: new Date().toISOString(),
        receipt_email_claim_id: null,
        receipt_email_claimed_at: null,
      })
      .eq("id", paymentOrderId)
      .eq("receipt_email_claim_id", claimId);
    
    console.log(`[RECEIPT] COMPLETE`);

  } catch (error) {
    console.error("[RECEIPT] ensurePaymentConfirmationSent: Exception caught:", error);

    // Release the claim so it can be retried later safely.
    // We intentionally DO NOT revert the 'paid' status.
    await supabaseAdmin
      .from("payment_orders")
      .update({
        receipt_email_claim_id: null,
        receipt_email_claimed_at: null,
      })
      .eq("id", paymentOrderId)
      .eq("receipt_email_claim_id", claimId);
  }

}
