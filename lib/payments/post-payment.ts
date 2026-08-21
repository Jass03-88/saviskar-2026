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

  // 1. ATOMIC CLAIM
  // We try to claim the payment order for receipt generation.
  // This prevents race conditions between the verify route and the webhook.
  console.log(`[RECEIPT] attempting atomic claim for order: ${paymentOrderId}`);
  const claimId = crypto.randomUUID();

  const { data: claimData, error: claimError } = await supabaseAdmin
    .from("payment_orders")
    .update({ receipt_email_claim_id: claimId })
    .eq("id", paymentOrderId)
    .is("receipt_email_sent_at", null)
    .is("receipt_email_claim_id", null)
    .select("id");

  if (claimError) {
    console.error("[RECEIPT] claim FAILED with error:", claimError);
    return;
  }

  // If we didn't update any rows, it means the email was already sent or another process is currently sending it.
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

    // Fetch linked events and members
    const { data: orderItems } = await supabaseAdmin
      .from("payment_order_items")
      .select("participant_event_id")
      .eq("payment_order_id", paymentOrderId);

    const participantEventIds = (orderItems ?? []).map((item) => item.participant_event_id).filter(Boolean);

    if (participantEventIds.length === 0) {
      throw new Error("No participant events linked to this order.");
    }

    // We generate the receipt for the first event (assuming mostly single-checkout or primary event)
    const { data: pe } = await supabaseAdmin
      .from("participant_events")
      .select(`
        id,
        team_name,
        events ( name, category, registration_type )
      `)
      .eq("id", participantEventIds[0])
      .single();

    if (!pe || !pe.events) {
      throw new Error("Event details not found.");
    }

    const eventData = Array.isArray(pe.events) ? pe.events[0] : pe.events;

    // 3. GENERATE PDF
    const receiptData: ReceiptData = {
      receiptReference: `RCP-${order.order_reference}`,
      paymentDate: paymentDateStr,
      participantName: participant.name,
      participantId: participant.participant_id,
      email: participant.email,
      phone: participant.phone,
      college: participant.college,
      eventName: eventData.name,
      eventCategory: eventData.category,
      registrationType: eventData.registration_type as "individual" | "team",
      teamName: pe.team_name,
      amount: order.amount,
      gateway: order.gateway || "Unknown",
      gatewayOrderId: order.gateway_order_id || "",
      gatewayPaymentId: order.gateway_payment_id || "",
    };

    console.log(`[RECEIPT] generating PDF`);
    const pdfBuffer = await generateReceiptPdf(receiptData);
    console.log(`[RECEIPT] PDF generated + byte size: ${pdfBuffer.byteLength}`);

    // Get team members if any
    const { data: teamMemberRows } = await supabaseAdmin
      .from("participant_event_members")
      .select(`
        name, email, phone, is_team_leader,
        participants ( participant_id, college )
      `)
      .eq("participant_event_id", pe.id);

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

    // 4. SEND EMAIL
    const emailResult = await sendRegistrationEmail({
      registrationId: pe.id,
      participantId: participant.participant_id,
      eventName: eventData.name,
      eventCategory: eventData.category,
      name: participant.name,
      college: participant.college,
      email: participant.email,
      phone: participant.phone,
      team: pe.team_name,
      isTeamEvent: eventData.registration_type === "team",
      isTeamHead: true, // Payer is usually head for team checkouts
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
    // 5. MARK AS SENT
    await supabaseAdmin
      .from("payment_orders")
      .update({ 
        receipt_email_sent_at: new Date().toISOString(),
        receipt_email_claim_id: null
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
      .update({ receipt_email_claim_id: null })
      .eq("id", paymentOrderId)
      .eq("receipt_email_claim_id", claimId);
  }
}
