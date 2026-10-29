import { createClient } from "@supabase/supabase-js";
import { generateReceiptPdf, ReceiptData } from "../generate-receipt-pdf";
import { sendRegistrationEmail } from "../send-registration-email";
import { resolveReceiptTeamMembers } from "./team-members";
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
    .or(`receipt_email_claim_id.is.null,receipt_email_claimed_at.is.null,receipt_email_claimed_at.lt.${staleThreshold}`)
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

    // Fetch linked events, accommodations, and members from payment_order_items
    const { data: orderItems, error: itemsError } = await supabaseAdmin
      .from("payment_order_items")
      .select(`
        id,
        amount,
        item_type,
        event_id,
        participant_event_id,
        participant_accommodation_id,
        events (
          name,
          category,
          registration_type
        ),
        participant_events (
          id,
          team_name
        ),
        participant_accommodations (
          id,
          start_date,
          end_date,
          duration_days,
          accommodation_plans (
            name,
            slug
          ),
          participants (
            name,
            participant_id
          )
        )
      `)
      .eq("payment_order_id", paymentOrderId);

    if (itemsError || !orderItems || orderItems.length === 0) {
      throw new Error(`No payment order items found: ${itemsError?.message}`);
    }

    type OrderItemRow = {
      id?: string;
      amount: number | string;
      item_type?: string | null;
      participant_event_id?: string;
      participant_accommodation_id?: string;
      events:
        | { name?: string; category?: string | null; registration_type?: string }
        | { name?: string; category?: string | null; registration_type?: string }[]
        | null;
      participant_events:
        | { id?: string; team_name?: string | null }
        | { id?: string; team_name?: string | null }[]
        | null;
      participant_accommodations:
        | {
            id?: string;
            start_date?: string;
            end_date?: string;
            duration_days?: number;
            accommodation_plans?: { name?: string; slug?: string } | { name?: string; slug?: string }[] | null;
            participants?: { name?: string; participant_id?: string } | { name?: string; participant_id?: string }[] | null;
          }
        | {
            id?: string;
            start_date?: string;
            end_date?: string;
            duration_days?: number;
            accommodation_plans?: { name?: string; slug?: string } | { name?: string; slug?: string }[] | null;
            participants?: { name?: string; participant_id?: string } | { name?: string; participant_id?: string }[] | null;
          }[]
        | null;
    };

    const typedItems = orderItems as unknown as OrderItemRow[];

    // Fetch direct participant_accommodations as complement/fallback
    const hasAccItems = typedItems.some((it) => it.item_type === "accommodation");
    let directAccRecords: Array<any> = [];
    if (hasAccItems) {
      const { data: directAccs } = await supabaseAdmin
        .from("participant_accommodations")
        .select(`
          id,
          start_date,
          end_date,
          duration_days,
          amount,
          status,
          accommodation_plans (
            name,
            slug
          ),
          participants (
            name,
            participant_id
          )
        `)
        .eq("payment_order_id", paymentOrderId);
      if (directAccs && directAccs.length > 0) {
        directAccRecords = directAccs;
      }
    }

    const receiptItems = typedItems.map((item, idx) => {
      if (item.item_type === "accommodation") {
        const rawAcc = item.participant_accommodations;
        const acc = (Array.isArray(rawAcc) ? rawAcc[0] : rawAcc) || directAccRecords[idx] || directAccRecords[0];
        const rawPlan = acc?.accommodation_plans;
        const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
        const rawDelegate = acc?.participants;
        const delegate = Array.isArray(rawDelegate) ? rawDelegate[0] : rawDelegate;

        const planName = plan?.name || "Accommodation Booking";
        const delegateLabel = delegate?.name ? ` (${delegate.name})` : "";
        const datesStr = acc?.start_date && acc?.end_date ? `${acc.start_date} to ${acc.end_date}` : null;
        return {
          eventName: `${planName}${delegateLabel}`,
          category: "Accommodation",
          registrationType: "individual" as const,
          teamName: null,
          amount: Number(item.amount) || 0,
          dates: datesStr,
          durationDays: acc?.duration_days || null,
          checkoutDate: acc?.end_date || null,
        };
      }

      const eventData = Array.isArray(item.events) ? item.events[0] : item.events;
      const peData = Array.isArray(item.participant_events) ? item.participant_events[0] : item.participant_events;
      return {
        eventName: eventData?.name ?? "Event Registration",
        category: eventData?.category ?? null,
        registrationType: eventData?.registration_type === "team" ? ("team" as const) : ("individual" as const),
        teamName: peData?.team_name ?? null,
        amount: Number(item.amount) || 0,
      };
    });

    const isAccommodationOnly = typedItems.every((it) => it.item_type === "accommodation");
    const primaryItem = typedItems.find((it) => it.item_type !== "accommodation") || typedItems[0];
    const primaryEvent = Array.isArray(primaryItem.events) ? primaryItem.events[0] : primaryItem.events;
    const primaryPe = Array.isArray(primaryItem.participant_events) ? primaryItem.participant_events[0] : primaryItem.participant_events;

    const isAnyTeamEvent = receiptItems.some((item) => item.registrationType === "team");

    // Collect participant_event_ids strictly for linked team events
    const teamParticipantEventIds = typedItems
      .filter((item) => {
        const eventData = Array.isArray(item.events) ? item.events[0] : item.events;
        return eventData?.registration_type === "team";
      })
      .map((item) => {
        const peData = Array.isArray(item.participant_events) ? item.participant_events[0] : item.participant_events;
        return peData?.id || item.participant_event_id;
      })
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
        console.error("[RECEIPT] team members lookup error:", membersError);
      } else if (members) {
        teamMemberRows = members as unknown as typeof teamMemberRows;
      }
    }

    const receiptTeamMembers = resolveReceiptTeamMembers({
      isAnyTeamEvent,
      teamMemberRows,
      payer: participant,
    });

    // 3. GENERATE MULTI-EVENT PDF (including complete team members if team registration)
    const receiptData: ReceiptData = {
      receiptReference: `RCP-${order.order_reference}`,
      paymentDate: paymentDateStr,
      participantName: participant.name,
      participantId: participant.participant_id,
      email: participant.email,
      phone: participant.phone,
      college: participant.college || "N/A",
      items: receiptItems,
      teamMembers: receiptTeamMembers.length > 0 ? receiptTeamMembers : undefined,
      eventName: isAccommodationOnly
        ? (receiptItems[0]?.eventName || "Campus Accommodation")
        : (primaryEvent?.name ?? "Saviskar Event"),
      eventCategory: isAccommodationOnly ? "Accommodation" : (primaryEvent?.category ?? null),
      registrationType: isAccommodationOnly ? "individual" : (primaryEvent?.registration_type === "team" ? ("team" as const) : ("individual" as const)),
      teamName: primaryPe?.team_name ?? null,
      amount: order.amount,
      gateway: order.gateway || "Unknown",
      gatewayOrderId: order.gateway_order_id || "",
      gatewayPaymentId: order.gateway_payment_id || "",
    };

    console.log(`[RECEIPT] generating multi-event PDF with ${receiptItems.length} item(s) and ${receiptTeamMembers.length} member(s)`);
    const pdfBuffer = await generateReceiptPdf(receiptData);
    console.log(`[RECEIPT] PDF generated + byte size: ${pdfBuffer.byteLength}`);

    // Determine whether payer is actually a team head for the registration email
    const isPayerTeamHead = isAnyTeamEvent
      ? receiptTeamMembers.some(
          (m) => m.participantId === String(participant.participant_id) && m.isTeamLeader
        )
      : false;

    // Members to send in email (excluding primary leader who is already primary recipient)
    const emailMembers = receiptTeamMembers
      .filter((row) => row.participantId !== String(participant.participant_id))
      .map((row) => ({
        participantId: row.participantId,
        name: row.name,
        college: row.college || "",
        email: row.email || "",
        phone: row.phone || "",
        isTeamLeader: row.isTeamLeader === true,
      }));

    // Summary event label for email
    const eventNameLabel = receiptItems.length === 1
      ? receiptItems[0].eventName
      : `${receiptItems[0].eventName} (+${receiptItems.length - 1} more)`;

    const accommodationDetails = hasAccItems
      ? typedItems
          .filter((it) => it.item_type === "accommodation")
          .map((it, idx) => {
            const rawAcc = it.participant_accommodations;
            const acc = (Array.isArray(rawAcc) ? rawAcc[0] : rawAcc) || directAccRecords[idx] || directAccRecords[0];
            const rawPlan = acc?.accommodation_plans;
            const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
            const rawDelegate = acc?.participants;
            const delegate = Array.isArray(rawDelegate) ? rawDelegate[0] : rawDelegate;
            return {
              planName: plan?.name || "Accommodation",
              participantName: delegate?.name || participant.name,
              dates: acc?.start_date && acc?.end_date ? `${acc.start_date} to ${acc.end_date}` : "Festival Dates",
              durationDays: acc?.duration_days || undefined,
              checkoutDate: acc?.end_date || undefined,
              orderReference: order.order_reference,
              paymentId: order.gateway_payment_id || undefined,
              amount: Number(it.amount) || 0,
            };
          })
      : [];

    // 4. SEND EMAIL
    const emailResult = await sendRegistrationEmail({
      registrationId: primaryPe?.id || primaryItem.participant_event_id || primaryItem.participant_accommodation_id,
      idempotencyKey: `rcp_${order.order_reference}_${participant.participant_id}`,
      participantId: participant.participant_id,
      eventName: eventNameLabel,
      eventCategory: isAccommodationOnly ? "Accommodation" : (primaryEvent?.category ?? null),
      name: participant.name,
      college: participant.college || "N/A",
      email: participant.email,
      phone: participant.phone,
      team: primaryPe?.team_name ?? null,
      isTeamEvent: isAnyTeamEvent,
      isTeamHead: isPayerTeamHead,
      members: isAnyTeamEvent ? emailMembers : [],
      accommodationDetails,
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
    const { error: markSentError } = await supabaseAdmin
      .from("payment_orders")
      .update({ 
        receipt_email_sent_at: new Date().toISOString(),
        receipt_email_claim_id: null,
        receipt_email_claimed_at: null,
      })
      .eq("id", paymentOrderId)
      .eq("receipt_email_claim_id", claimId)
      .is("receipt_email_sent_at", null);

    if (markSentError) {
      console.error("[RECEIPT] Failed to mark order receipt_email_sent_at:", markSentError, { paymentOrderId, claimId });
    }
    
    console.log(`[RECEIPT] COMPLETE`);

  } catch (error) {
    console.error("[RECEIPT] ensurePaymentConfirmationSent: Exception caught:", error);

    // Release the claim so it can be retried later safely.
    // Scoped strictly to claimId and unsent state: cannot clear newer claims or overwrite sent orders.
    // We intentionally DO NOT revert the 'paid' status.
    const { error: releaseError } = await supabaseAdmin
      .from("payment_orders")
      .update({
        receipt_email_claim_id: null,
        receipt_email_claimed_at: null,
      })
      .eq("id", paymentOrderId)
      .eq("receipt_email_claim_id", claimId)
      .is("receipt_email_sent_at", null);

    if (releaseError) {
      console.error("[RECEIPT] Failed to release email claim:", releaseError, { paymentOrderId, claimId });
    }
  }

}
