import { SupabaseClient } from "@supabase/supabase-js";
import { generatePaymentResumeUrl } from "@/lib/payments/resume-token";
import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";
import { sendRegistrationEmail } from "@/lib/send-registration-email";
import { isLocalOrTestEnvironment } from "./payment-verification";

export type EmailTemplateType =
  | "registration_summary"
  | "payment_receipt"
  | "payment_status_update";

export type RecipientPreview = {
  participantId: string;
  publicParticipantId: string;
  name: string;
  email: string;
  college: string;
  eligible: boolean;
  ineligibilityReason?: string;
  paymentOrderId?: string | null;
  orderReference?: string | null;
  totalPaidAmount: number;
  totalPendingAmount: number;
  events: Array<{
    name: string;
    category?: string | null;
    paymentType: string;
    fee: number;
    status: string;
  }>;
  accommodations: Array<{
    planName: string;
    dates: string;
    amount: number;
    status: string;
  }>;
  previewSubject: string;
  previewBannerText: string;
  previewBannerStyle: "success" | "pending" | "partial" | "free";
  nextStepText?: string;
};

export type ResendPreviewResult = {
  templateType: EmailTemplateType;
  totalRecipients: number;
  eligibleRecipients: number;
  ineligibleRecipients: number;
  recipients: RecipientPreview[];
};

export type ResendSendResult = {
  success: boolean;
  templateType: EmailTemplateType;
  totalProcessed: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  isLocalSimulation: boolean;
  results: Array<{
    participantId: string;
    email: string;
    status: "sent" | "simulated" | "skipped" | "failed";
    message: string;
  }>;
};

/**
 * Loads authoritative recipient registration facts and builds a strict, preview-first representation.
 */
export async function generateEmailPreviews(params: {
  supabaseAdmin: SupabaseClient;
  participantIds: string[];
  templateType: EmailTemplateType;
}): Promise<ResendPreviewResult> {
  const { supabaseAdmin, participantIds, templateType } = params;

  if (!participantIds || participantIds.length === 0) {
    return {
      templateType,
      totalRecipients: 0,
      eligibleRecipients: 0,
      ineligibleRecipients: 0,
      recipients: [],
    };
  }

  // 1. Fetch participants
  const { data: participants } = await supabaseAdmin
    .from("participants")
    .select("id, participant_id, name, email, college, phone")
    .in("id", participantIds);

  const pList = participants || [];

  // 2. Fetch participant events
  const { data: pes } = await supabaseAdmin
    .from("participant_events")
    .select(`
      id,
      participant_id,
      event_id,
      payment_status,
      payment_amount,
      events (
        name,
        category,
        payment_type,
        registration_fee
      )
    `)
    .in("participant_id", participantIds)
    .eq("is_archived", false);

  // 3. Fetch accommodations
  const { data: accs } = await supabaseAdmin
    .from("participant_accommodations")
    .select(`
      id,
      participant_id,
      start_date,
      end_date,
      duration_days,
      amount,
      status,
      payment_order_id,
      accommodation_plans (
        name
      )
    `)
    .in("participant_id", participantIds)
    .neq("status", "cancelled");

  // 4. Fetch payment orders for participants
  const { data: orders } = await supabaseAdmin
    .from("payment_orders")
    .select("id, order_reference, amount, currency, status, payer_participant_id")
    .in("payer_participant_id", participantIds);

  const ordersByPayer = new Map<string, any[]>();
  (orders || []).forEach((o) => {
    const list = ordersByPayer.get(o.payer_participant_id) || [];
    list.push(o);
    ordersByPayer.set(o.payer_participant_id, list);
  });

  const previews: RecipientPreview[] = [];

  for (const p of pList) {
    const pEvents = (pes || []).filter((pe) => pe.participant_id === p.id);
    const pAccs = (accs || []).filter((a) => a.participant_id === p.id);
    const pOrders = ordersByPayer.get(p.id) || [];

    // Most recent or paid order
    const paidOrder = pOrders.find((o) => o.status === "paid");
    const activeOrder = paidOrder || pOrders[0] || null;

    // Events list
    const mappedEvents = pEvents.map((pe) => {
      const rawEvt = Array.isArray(pe.events) ? pe.events[0] : pe.events;
      const fee = Number(pe.payment_amount) || Number(rawEvt?.registration_fee) || 0;
      const status = rawEvt?.payment_type === "paid"
        ? (pe.payment_status === "paid" ? "Paid" : "Pending")
        : "Not Required (Free)";
      return {
        name: rawEvt?.name || "Event",
        category: rawEvt?.category || null,
        paymentType: rawEvt?.payment_type || "free",
        fee,
        status,
      };
    });

    // Accommodations list
    const mappedAccs = pAccs.map((a) => {
      const rawPlan = Array.isArray(a.accommodation_plans) ? a.accommodation_plans[0] : a.accommodation_plans;
      return {
        planName: rawPlan?.name || "Accommodation",
        dates: a.start_date && a.end_date ? `${a.start_date} to ${a.end_date}` : "Festival Dates",
        amount: Number(a.amount) || 0,
        status: a.status === "paid" ? "Paid" : "Pending",
      };
    });

    // Calculate Paid vs Pending Totals
    let totalPaid = 0;
    let totalPending = 0;

    mappedEvents.forEach((e) => {
      if (e.paymentType === "paid") {
        if (e.status === "Paid") totalPaid += e.fee;
        else totalPending += e.fee;
      }
    });

    mappedAccs.forEach((a) => {
      if (a.status === "Paid") totalPaid += a.amount;
      else totalPending += a.amount;
    });

    // Eligibility & Banner by Template Type
    let eligible = true;
    let ineligibilityReason: string | undefined;
    let previewSubject = "";
    let previewBannerText = "";
    let previewBannerStyle: "success" | "pending" | "partial" | "free" = "success";
    let nextStepText: string | undefined;

    if (templateType === "payment_receipt") {
      // STRICT INVARIANT: Receipts CANNOT be sent unless payment order is authoritatively paid
      if (!paidOrder) {
        eligible = false;
        ineligibilityReason = "No confirmed PAID payment order exists for this participant. Official tax receipts cannot be generated for pending or unpaid orders.";
        previewSubject = `[UNAVAILABLE] Payment Receipt — ${p.participant_id}`;
        previewBannerText = "Receipt Unavailable: No settled payment order.";
        previewBannerStyle = "pending";
      } else {
        previewSubject = `Official Payment Receipt — Saviskar 2026 (${paidOrder.order_reference})`;
        previewBannerText = `Payment Confirmed: ₹${Number(paidOrder.amount).toLocaleString("en-IN")} received via PayU.`;
        previewBannerStyle = "success";
        nextStepText = "Official PDF receipt will be regenerated with complete registration breakdown and attached.";
      }
    } else if (templateType === "registration_summary") {
      previewSubject = `Registration Summary & Status — Saviskar 2026 (${p.participant_id})`;

      // CRITICAL FIX FOR CASE 1 & CASE 2:
      // A free event must NEVER make chargeable accommodation appear free!
      if (totalPending > 0 && totalPaid > 0) {
        previewBannerText = `Partially Paid: ₹${totalPaid.toLocaleString("en-IN")} confirmed, ₹${totalPending.toLocaleString("en-IN")} pending completion.`;
        previewBannerStyle = "partial";
        nextStepText = "Outstanding balance must be settled through the secure payment resume link.";
      } else if (totalPending > 0) {
        previewBannerText = `Payment Pending: ₹${totalPending.toLocaleString("en-IN")} outstanding for registered items/accommodation.`;
        previewBannerStyle = "pending";
        nextStepText = "Please complete payment to confirm your booking and receive your official entry pass.";
      } else if (totalPaid > 0) {
        previewBannerText = `Registration Fully Confirmed: ₹${totalPaid.toLocaleString("en-IN")} paid in full.`;
        previewBannerStyle = "success";
        nextStepText = "Digital pass is active for festival entry.";
      } else {
        previewBannerText = "Free Event Registration Confirmed: No payment required.";
        previewBannerStyle = "free";
        nextStepText = "Entry pass will be valid upon campus check-in.";
      }
    } else {
      // payment_status_update
      previewSubject = `Important Payment Status Update — Saviskar 2026 (${p.participant_id})`;
      if (totalPending > 0) {
        previewBannerText = `Action Required: ₹${totalPending.toLocaleString("en-IN")} outstanding across ${mappedEvents.filter(e => e.status === "Pending").length} event(s) and ${mappedAccs.filter(a => a.status === "Pending").length} accommodation stay(s).`;
        previewBannerStyle = "pending";
        nextStepText = "Use the official payment link to resume and settle pending charges.";
      } else {
        previewBannerText = "All registration charges are settled. No payment is pending.";
        previewBannerStyle = "success";
      }
    }

    previews.push({
      participantId: p.id,
      publicParticipantId: p.participant_id,
      name: p.name,
      email: p.email,
      college: p.college || "N/A",
      eligible,
      ineligibilityReason,
      paymentOrderId: activeOrder?.id || null,
      orderReference: activeOrder?.order_reference || null,
      totalPaidAmount: totalPaid,
      totalPendingAmount: totalPending,
      events: mappedEvents,
      accommodations: mappedAccs,
      previewSubject,
      previewBannerText,
      previewBannerStyle,
      nextStepText,
    });
  }

  return {
    templateType,
    totalRecipients: previews.length,
    eligibleRecipients: previews.filter((p) => p.eligible).length,
    ineligibleRecipients: previews.filter((p) => !p.eligible).length,
    recipients: previews,
  };
}

/**
 * Server-Enforced Email Dispatcher.
 *
 * Invariants:
 * 1. Independent server-side re-check of recipient eligibility and status.
 * 2. Rejects any attempt to forge paid status or receipt.
 * 3. In local development or test mode, mocks network dispatch and returns simulated outcome.
 * 4. Logs audit trail in admin_audit_logs.
 */
export async function executeEmailResend(params: {
  supabaseAdmin: SupabaseClient;
  adminId: string;
  adminEmail: string;
  participantIds: string[];
  templateType: EmailTemplateType;
}): Promise<ResendSendResult> {
  const { supabaseAdmin, adminId, adminEmail, participantIds, templateType } = params;

  // Re-verify previews and eligibility on the server
  const previewData = await generateEmailPreviews({
    supabaseAdmin,
    participantIds,
    templateType,
  });

  const isLocalSim = isLocalOrTestEnvironment();
  const dispatchResults: ResendSendResult["results"] = [];
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const recipient of previewData.recipients) {
    if (!recipient.eligible) {
      skippedCount++;
      dispatchResults.push({
        participantId: recipient.participantId,
        email: recipient.email,
        status: "skipped",
        message: recipient.ineligibilityReason || "Skipped due to ineligibility.",
      });
      continue;
    }

    if (isLocalSim) {
      // Local development or test mock: do not hit external Resend API
      sentCount++;
      dispatchResults.push({
        participantId: recipient.participantId,
        email: recipient.email,
        status: "simulated",
        message: `Local simulated dispatch: ${templateType} preview validated for ${recipient.email}. No live email sent.`,
      });
      continue;
    }

    // Production environment dispatch
    try {
      if (templateType === "payment_receipt" && recipient.paymentOrderId) {
        // Reuse existing receipt generation & dispatch pipeline
        await ensurePaymentConfirmationSent(recipient.paymentOrderId);
        sentCount++;
        dispatchResults.push({
          participantId: recipient.participantId,
          email: recipient.email,
          status: "sent",
          message: `Official receipt sent to ${recipient.email}.`,
        });
      } else {
        // Registration summary or status update dispatch
        const requiresPayment = recipient.totalPendingAmount > 0;
        let resumeUrl: string | null = null;
        if (requiresPayment && recipient.paymentOrderId) {
          try {
            resumeUrl = generatePaymentResumeUrl({
              paymentOrderId: recipient.paymentOrderId,
              participantId: recipient.publicParticipantId,
              payerParticipantUuid: recipient.participantId,
            });
          } catch {
            // Safe fallback
          }
        }

        const emailResult = await sendRegistrationEmail({
          participantId: recipient.publicParticipantId,
          eventName: recipient.events[0]?.name || "Saviskar 2026",
          eventCategory: recipient.events[0]?.category || null,
          name: recipient.name,
          college: recipient.college,
          email: recipient.email,
          requiresPayment,
          paymentResumeUrl: resumeUrl,
          accommodationDetails: recipient.accommodations.map((a) => ({
            planName: a.planName,
            participantName: recipient.name,
            dates: a.dates,
            amount: a.amount,
          })),
        });

        if (emailResult.success) {
          sentCount++;
          dispatchResults.push({
            participantId: recipient.participantId,
            email: recipient.email,
            status: "sent",
            message: `Sent ${templateType} to ${recipient.email}.`,
          });
        } else {
          failedCount++;
          dispatchResults.push({
            participantId: recipient.participantId,
            email: recipient.email,
            status: "failed",
            message: emailResult.error || "Email delivery failed.",
          });
        }
      }
    } catch (err) {
      failedCount++;
      dispatchResults.push({
        participantId: recipient.participantId,
        email: recipient.email,
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Record Audit Trail
  try {
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_id: adminId,
      action_type: "RESEND_REGISTRATION_EMAIL",
      target_id: participantIds[0] || null,
      details: {
        admin_email: adminEmail,
        template_type: templateType,
        total_recipients: participantIds.length,
        sent_count: sentCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
        is_local_simulation: isLocalSim,
        dispatches: dispatchResults.map((d) => ({
          email: d.email,
          status: d.status,
          message: d.message,
        })),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (auditErr) {
    console.warn("Failed to log email resend audit:", auditErr);
  }

  return {
    success: failedCount === 0,
    templateType,
    totalProcessed: previewData.recipients.length,
    sentCount,
    failedCount,
    skippedCount,
    isLocalSimulation: isLocalSim,
    results: dispatchResults,
  };
}
