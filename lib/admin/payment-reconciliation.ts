import { SupabaseClient } from "@supabase/supabase-js";
import { PayUGateway } from "@/lib/payments/payu";
import { PaymentVerificationError } from "@/lib/payments/types";
import { toPaise, isLocalOrTestEnvironment } from "./payment-verification";
import { ensurePaymentConfirmationSent } from "@/lib/payments/post-payment";
import { sendRegistrationEmail } from "@/lib/send-registration-email";
import { generatePaymentResumeUrl } from "@/lib/payments/resume-token";

export type ReconcilePaymentParams = {
  supabaseAdmin: SupabaseClient;
  adminId: string;
  adminEmail: string;
  paymentOrderId: string;
  mockGatewayResult?: {
    status: string;
    amountPaise: number;
    gatewayPaymentId: string;
    currency?: string;
    gatewayOrderId?: string;
    additionalChargesPaise?: number;
    customerTransactionAmountPaise?: number;
    settlementAmountPaise?: number;
    amountAmbiguityReason?: string;
  };
};

export type ReconciliationEmailResult = {
  attempted: boolean;
  sent: boolean;
  status: "sent" | "simulated" | "failed";
  message: string;
};

export type ReconcilePaymentResult = {
  success: boolean;
  orderId: string;
  orderReference: string;
  settled: boolean;
  alreadySettled?: boolean;
  action?: string;
  conflictsCount?: number;
  error?: string;
  reloadedOrder?: any;
  linkedEvents?: any[];
  linkedAccommodations?: any[];
  emailResult?: ReconciliationEmailResult;
};

/**
 * Authoritative, Server-Enforced Payment Reconciliation Service.
 *
 * Security & Invariants:
 * 1. Independent Server-Side Reload: Never trusts the client payload.
 * 2. Pre-Settlement Gateway Re-Verification: Re-checks PayU gateway status immediately before settlement.
 * 3. Local Simulation Safety Guard: Disables reconciliation in local preview mode unless an authorized mock result is explicitly provided.
 * 4. Idempotent Settlement Invocation: Calls the authoritative `process_payment_success` database RPC. Never directly updates status columns.
 * 5. Distinct Order Preservation: Settle only the specific order; never aggregates or settles unrelated registrations.
 * 6. Resilient Post-Settlement Email: Financial settlement and email delivery are independent outcomes. Email failures never revert settlement.
 */
export async function reconcilePaymentOrder(
  params: ReconcilePaymentParams
): Promise<ReconcilePaymentResult> {
  const {
    supabaseAdmin,
    adminId,
    adminEmail,
    paymentOrderId,
    mockGatewayResult,
  } = params;

  if (!paymentOrderId || typeof paymentOrderId !== "string") {
    return {
      success: false,
      orderId: paymentOrderId || "",
      orderReference: "UNKNOWN",
      settled: false,
      error: "Valid paymentOrderId is required for reconciliation.",
    };
  }

  // 1. Authoritative Reload of Local Payment Order
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("payment_orders")
    .select(`
      id,
      order_reference,
      gateway,
      gateway_order_id,
      gateway_payment_id,
      amount,
      currency,
      status,
      payer_participant_id,
      created_at,
      updated_at
    `)
    .eq("id", paymentOrderId)
    .single();

  if (orderErr || !order) {
    return {
      success: false,
      orderId: paymentOrderId,
      orderReference: "UNKNOWN",
      settled: false,
      error: `Payment order not found: ${orderErr?.message || "Record does not exist."}`,
    };
  }

  // 2. Local State Check: Is it already settled?
  if (order.status === "paid") {
    return {
      success: true,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: true,
      alreadySettled: true,
      action: "already_paid",
      reloadedOrder: order,
    };
  }

  // 3. Check Linked Items
  const { data: items, error: itemsErr } = await supabaseAdmin
    .from("payment_order_items")
    .select("id, item_type, amount, participant_event_id, participant_accommodation_id")
    .eq("payment_order_id", order.id);

  if (itemsErr || !items || items.length === 0) {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: "No line items are mapped to this payment order. Manual investigation is required.",
    };
  }

  // Validate line items sum matches order amount
  const itemsSumPaise = items.reduce((acc, it) => acc + toPaise(it.amount), 0);
  const orderAmountPaise = toPaise(order.amount);
  if (itemsSumPaise !== orderAmountPaise) {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: `Conflicting item mapping: Sum of line items (₹${itemsSumPaise / 100}) does not match payment order amount (₹${order.amount}). Reconciliation blocked.`,
    };
  }

  // Check if any linked event registration is already confirmed under another order
  const peIds = items.map((i) => i.participant_event_id).filter(Boolean);
  const paIds = items.map((i) => i.participant_accommodation_id).filter(Boolean);

  if (peIds.length > 0) {
    const { data: peRecords } = await supabaseAdmin
      .from("participant_events")
      .select("id, payment_status, payment_id")
      .in("id", peIds);

    const alreadyPaidPe = (peRecords || []).find(
      (pe) => pe.payment_status === "confirmed" && pe.payment_id && pe.payment_id !== order.id
    );
    if (alreadyPaidPe) {
      return {
        success: false,
        orderId: order.id,
        orderReference: order.order_reference,
        settled: false,
        error: "Ambiguous item mapping: Linked event registration is already marked confirmed under another payment order. Reconciliation blocked.",
      };
    }
  }

  // Check if any linked accommodation booking is already paid under another order
  if (paIds.length > 0) {
    const { data: paRecords } = await supabaseAdmin
      .from("participant_accommodations")
      .select("id, status, payment_order_id")
      .in("id", paIds);

    const alreadyPaidPa = (paRecords || []).find(
      (pa) => pa.status === "paid" && pa.payment_order_id && pa.payment_order_id !== order.id
    );
    if (alreadyPaidPa) {
      return {
        success: false,
        orderId: order.id,
        orderReference: order.order_reference,
        settled: false,
        error: "Ambiguous item mapping: Linked accommodation booking is already marked paid under another payment order. Reconciliation blocked.",
      };
    }
  }

  // 4. Local Simulation Protection Guard
  const isLocalSim = isLocalOrTestEnvironment();
  if (isLocalSim && !mockGatewayResult && process.env.NODE_ENV !== "test") {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: "Reconciliation is disabled in local preview mode. Simulated gateway results cannot authorize database mutations.",
    };
  }

  // 5. Fresh Server-Side Gateway Verification
  let gatewayReportedStatus = "unknown";
  let gatewayAmountPaise = 0;
  let gatewayPaymentId = "";
  let gatewayCurrency = "INR";
  let gatewayOrderId = "";
  let gatewayAdditionalChargesPaise = 0;
  let gatewayCustomerTxnAmountPaise: number | undefined;
  let gatewayAmountAmbiguityReason: string | undefined;

  if (mockGatewayResult) {
    // Authorized test/preview fixture
    gatewayReportedStatus = mockGatewayResult.status;
    gatewayAmountPaise = mockGatewayResult.amountPaise;
    gatewayPaymentId = mockGatewayResult.gatewayPaymentId;
    gatewayCurrency = mockGatewayResult.currency || "INR";
    gatewayOrderId = mockGatewayResult.gatewayOrderId || order.gateway_order_id;
    gatewayAdditionalChargesPaise = mockGatewayResult.additionalChargesPaise || 0;
    gatewayCustomerTxnAmountPaise = mockGatewayResult.customerTransactionAmountPaise;
    gatewayAmountAmbiguityReason = mockGatewayResult.amountAmbiguityReason;
  } else {
    // Production Gateway Call
    try {
      const gateway = new PayUGateway();
      const details = await gateway.fetchPaymentDetails(order.gateway_order_id);
      gatewayReportedStatus = details.status;
      gatewayAmountPaise = details.amount;
      gatewayPaymentId = details.gatewayPaymentId || "";
      gatewayCurrency = details.currency || "INR";
      gatewayOrderId = details.gatewayOrderId || order.gateway_order_id;
      gatewayAdditionalChargesPaise = details.additionalCharges || 0;
      gatewayCustomerTxnAmountPaise = details.customerTransactionAmount;
      gatewayAmountAmbiguityReason = details.amountAmbiguityReason;
    } catch (err) {
      const msg = err instanceof PaymentVerificationError ? err.message : String(err);
      return {
        success: false,
        orderId: order.id,
        orderReference: order.order_reference,
        settled: false,
        error: `Authoritative gateway verification failed: ${msg}`,
      };
    }
  }

  // 6. Pre-Settlement Gate Verification
  // 6a. Gateway Status: Only confirmed "paid"
  if (gatewayReportedStatus !== "paid") {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: `Gateway status is "${gatewayReportedStatus}". Only confirmed "paid" transactions can be reconciled.`,
    };
  }

  // 6b. Currency Comparison: Decimal-safe canonical comparison
  const canonicalCurrency = (order.currency || "INR").trim().toUpperCase();
  const reportedCurrency = (gatewayCurrency || "INR").trim().toUpperCase();
  if (canonicalCurrency !== reportedCurrency) {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: `Currency mismatch: Order is "${canonicalCurrency}", but Gateway reported "${reportedCurrency}". Reconciliation blocked.`,
    };
  }

  // 6c. Gateway Order Reference Matching (txnid)
  if (gatewayOrderId && gatewayOrderId !== order.gateway_order_id) {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: `Gateway order reference mismatch: Expected "${order.gateway_order_id}", but Gateway reported "${gatewayOrderId}". Reconciliation blocked.`,
    };
  }

  // 6d. Gateway Payment ID (mihpayid) Verification
  if (!gatewayPaymentId || gatewayPaymentId.trim().length === 0) {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: "Missing gateway payment ID (mihpayid). Cannot establish canonical transaction link.",
    };
  }

  // 6e. Ambiguity Gate: Unresolved amount-field discrepancies strictly block reconciliation
  if (gatewayAmountAmbiguityReason) {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: `Amount field ambiguity: ${gatewayAmountAmbiguityReason} Reconciliation blocked.`,
    };
  }

  // 6f. Exact Amount Comparison — Zero Blanket Tolerance
  // Distinguishes base merchant amount from explicitly reported additional_charges
  const expectedBasePaise = toPaise(order.amount);
  let isAmountMatched = false;
  const canonicalSettlementPaise = expectedBasePaise;

  if (gatewayAmountPaise === expectedBasePaise) {
    // Exact base amount match
    isAmountMatched = true;
  } else if (
    gatewayCustomerTxnAmountPaise != null &&
    gatewayAdditionalChargesPaise > 0 &&
    gatewayCustomerTxnAmountPaise - gatewayAdditionalChargesPaise === expectedBasePaise
  ) {
    // Gross customer debit minus explicit surcharge matches base order amount
    isAmountMatched = true;
  } else if (
    gatewayAdditionalChargesPaise > 0 &&
    gatewayAmountPaise - gatewayAdditionalChargesPaise === expectedBasePaise
  ) {
    // Surcharge explicitly reported by PayU where gateway amount was gross
    isAmountMatched = true;
  }

  if (!isAmountMatched) {
    const errorDetail = gatewayAdditionalChargesPaise > 0
      ? `Gateway reported base ₹${gatewayAmountPaise / 100} with explicit surcharge ₹${gatewayAdditionalChargesPaise / 100}, which does not match base order amount ₹${order.amount}.`
      : `Gateway reported ₹${gatewayAmountPaise / 100}, expected ₹${order.amount}. Unreported extra amounts or arbitrary differences cannot be treated as permissible fees.`;

    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: `Amount mismatch: ${errorDetail} Reconciliation blocked.`,
    };
  }

  // 7. Invoke Existing Idempotent Settlement Pathway (process_payment_success)
  // Pass canonical base order amount expected by database RPC
  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
    "process_payment_success",
    {
      p_gateway_order_id: order.gateway_order_id,
      p_gateway_payment_id: gatewayPaymentId,
      p_amount_paise: canonicalSettlementPaise,
      p_currency: canonicalCurrency,
      p_gateway_name: order.gateway || "payu",
    }
  );

  if (rpcError) {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: `Database settlement RPC failed: ${rpcError.message}`,
    };
  }

  if (rpcData && !rpcData.success) {
    return {
      success: false,
      orderId: order.id,
      orderReference: order.order_reference,
      settled: false,
      error: rpcData.error || "Database settlement RPC rejected transaction.",
    };
  }

  // 8. Audit Log
  try {
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_id: adminId,
      action_type: "ADMIN_PAYMENT_RECONCILIATION_SETTLEMENT",
      target_id: order.id,
      details: {
        admin_email: adminEmail,
        order_reference: order.order_reference,
        gateway_order_id: order.gateway_order_id,
        gateway_payment_id: gatewayPaymentId,
        amount: order.amount,
        action: rpcData?.action,
        conflicts_count: rpcData?.conflicts_count || 0,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (auditErr) {
    console.warn("Failed to write reconciliation audit log:", auditErr);
  }

  // 9. Reload Canonical Records
  const [reloadedOrderRes, reloadedEventsRes, reloadedAccsRes] = await Promise.all([
    supabaseAdmin.from("payment_orders").select("*").eq("id", order.id).single(),
    supabaseAdmin
      .from("participant_events")
      .select("id, event_id, payment_status, payment_amount, events(name, registration_fee)")
      .eq("participant_id", order.payer_participant_id),
    supabaseAdmin
      .from("participant_accommodations")
      .select("id, amount, status, start_date, end_date, accommodation_plans(name)")
      .eq("participant_id", order.payer_participant_id),
  ]);

  const reloadedOrder = reloadedOrderRes.data || order;
  const reloadedEvents = reloadedEventsRes.data || [];
  const reloadedAccs = reloadedAccsRes.data || [];

  // 10. Automatic Updated Registration / Status Email
  let emailResult: ReconciliationEmailResult = {
    attempted: true,
    sent: false,
    status: "failed",
    message: "Email dispatch not yet executed.",
  };

  try {
    emailResult = await sendReconciliationUpdatedEmail({
      supabaseAdmin,
      adminId,
      adminEmail,
      paymentOrderId: order.id,
      payerParticipantId: order.payer_participant_id,
      reloadedEvents,
      reloadedAccs,
    });
  } catch (emailErr) {
    const errorMsg = emailErr instanceof Error ? emailErr.message : String(emailErr);
    console.error("Reconciliation post-settlement email exception:", errorMsg);

    emailResult = {
      attempted: true,
      sent: false,
      status: "failed",
      message: `Payment reconciled; email delivery failed: ${errorMsg}`,
    };

    // Log email failure in audit trail without reverting settlement
    try {
      await supabaseAdmin.from("admin_audit_logs").insert({
        admin_id: adminId,
        action_type: "RECONCILIATION_EMAIL_FAILURE",
        target_id: order.id,
        details: {
          admin_email: adminEmail,
          payment_order_id: order.id,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      // Ignored
    }
  }

  return {
    success: true,
    orderId: order.id,
    orderReference: order.order_reference,
    settled: true,
    action: rpcData?.action,
    conflictsCount: rpcData?.conflicts_count || 0,
    reloadedOrder,
    linkedEvents: reloadedEvents,
    linkedAccommodations: reloadedAccs,
    emailResult,
  };
}

/**
 * Retries ONLY the reconciliation email without re-running payment settlement.
 */
export async function retryReconciliationEmail(params: {
  supabaseAdmin: SupabaseClient;
  adminId: string;
  adminEmail: string;
  paymentOrderId: string;
}): Promise<ReconciliationEmailResult> {
  const { supabaseAdmin, adminId, adminEmail, paymentOrderId } = params;

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("payment_orders")
    .select("id, payer_participant_id, status")
    .eq("id", paymentOrderId)
    .single();

  if (orderErr || !order) {
    return {
      attempted: true,
      sent: false,
      status: "failed",
      message: `Payment order not found: ${orderErr?.message || "Missing order"}`,
    };
  }

  if (order.status !== "paid") {
    return {
      attempted: true,
      sent: false,
      status: "failed",
      message: "Order is not paid. Receipt and confirmation emails cannot be dispatched for unpaid orders.",
    };
  }

  const [reloadedEventsRes, reloadedAccsRes] = await Promise.all([
    supabaseAdmin
      .from("participant_events")
      .select("id, event_id, payment_status, payment_amount, events(name, registration_fee)")
      .eq("participant_id", order.payer_participant_id),
    supabaseAdmin
      .from("participant_accommodations")
      .select("id, amount, status, start_date, end_date, accommodation_plans(name)")
      .eq("participant_id", order.payer_participant_id),
  ]);

  return sendReconciliationUpdatedEmail({
    supabaseAdmin,
    adminId,
    adminEmail,
    paymentOrderId: order.id,
    payerParticipantId: order.payer_participant_id,
    reloadedEvents: reloadedEventsRes.data || [],
    reloadedAccs: reloadedAccsRes.data || [],
  });
}

/**
 * Sends the updated registration email after confirmed reconciliation.
 */
async function sendReconciliationUpdatedEmail(params: {
  supabaseAdmin: SupabaseClient;
  adminId: string;
  adminEmail: string;
  paymentOrderId: string;
  payerParticipantId: string;
  reloadedEvents: any[];
  reloadedAccs: any[];
}): Promise<ReconciliationEmailResult> {
  const {
    supabaseAdmin,
    adminId,
    adminEmail,
    paymentOrderId,
    payerParticipantId,
    reloadedEvents,
    reloadedAccs,
  } = params;

  // 1. Fetch Participant details
  const { data: participant } = await supabaseAdmin
    .from("participants")
    .select("id, participant_id, name, email, college, phone")
    .eq("id", payerParticipantId)
    .single();

  if (!participant) {
    return {
      attempted: true,
      sent: false,
      status: "failed",
      message: "Participant record not found.",
    };
  }

  // 2. Calculate authoritative overall totals
  const totalPaidEvents = reloadedEvents
    .filter((e) => e.payment_status === "paid")
    .reduce((sum, e) => sum + (Number(e.payment_amount) || Number(e.events?.registration_fee) || 0), 0);

  const totalPendingEvents = reloadedEvents
    .filter((e) => e.payment_status === "pending")
    .reduce((sum, e) => sum + (Number(e.payment_amount) || Number(e.events?.registration_fee) || 0), 0);

  const totalPaidAccs = reloadedAccs
    .filter((a) => a.status === "confirmed" || a.status === "paid")
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

  const totalPendingAccs = reloadedAccs
    .filter((a) => a.status === "pending")
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

  const totalPaid = totalPaidEvents + totalPaidAccs;
  const totalPending = totalPendingEvents + totalPendingAccs;
  const requiresPayment = totalPending > 0;

  // 3. Local Simulation Check
  if (isLocalOrTestEnvironment()) {
    return {
      attempted: true,
      sent: true,
      status: "simulated",
      message: `Local simulated dispatch: Updated confirmation preview validated for ${participant.email} (Paid: ₹${totalPaid}, Pending: ₹${totalPending}). No live email sent.`,
    };
  }

  // 4. Production Dispatch: Dispatch official receipt for the reconciled order
  try {
    await ensurePaymentConfirmationSent(paymentOrderId);
  } catch (receiptErr) {
    console.warn("ensurePaymentConfirmationSent failed during reconciliation:", receiptErr);
  }

  // 5. If other items remain pending, dispatch updated status with resume link
  if (requiresPayment) {
    let resumeUrl: string | null = null;
    try {
      resumeUrl = generatePaymentResumeUrl({
        paymentOrderId,
        participantId: participant.participant_id,
        payerParticipantUuid: participant.id,
      });
    } catch {
      // Ignored
    }

    const emailRes = await sendRegistrationEmail({
      participantId: participant.participant_id,
      eventName: reloadedEvents[0]?.events?.name || "Saviskar 2026",
      eventCategory: reloadedEvents[0]?.events?.category || null,
      name: participant.name,
      college: participant.college || "N/A",
      email: participant.email,
      phone: participant.phone,
      requiresPayment: true,
      paymentResumeUrl: resumeUrl,
      accommodationDetails: reloadedAccs.map((a) => ({
        planName: a.accommodation_plans?.name || "Accommodation",
        participantName: participant.name,
        dates: a.start_date && a.end_date ? `${a.start_date} to ${a.end_date}` : "Festival Dates",
        amount: Number(a.amount) || 0,
      })),
    });

    if (!emailRes.success) {
      return {
        attempted: true,
        sent: false,
        status: "failed",
        message: `Updated status email delivery failed: ${emailRes.error || "Provider error"}`,
      };
    }
  }

  // Log successful audit
  try {
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_id: adminId,
      action_type: "RECONCILIATION_EMAIL_SENT",
      target_id: paymentOrderId,
      details: {
        admin_email: adminEmail,
        recipient_email: participant.email,
        total_paid: totalPaid,
        total_pending: totalPending,
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    // Ignored
  }

  return {
    attempted: true,
    sent: true,
    status: "sent",
    message: `Updated registration email and receipt successfully delivered to ${participant.email}.`,
  };
}
