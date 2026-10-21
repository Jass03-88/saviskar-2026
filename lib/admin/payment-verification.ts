import { SupabaseClient } from "@supabase/supabase-js";
import { PayUGateway } from "@/lib/payments/payu";
import { PaymentVerificationError } from "@/lib/payments/types";

export type ReconciliationOutcome =
  | "MATCHED_PAID"
  | "GATEWAY_PAID_LOCAL_PENDING"
  | "LOCAL_PAID_GATEWAY_NOT_CONFIRMED"
  | "AMOUNT_MISMATCH"
  | "GATEWAY_REFERENCE_MISMATCH"
  | "CONFLICTING_ITEM_MAPPING"
  | "MISSING_ACCOMMODATION_LINK"
  | "ORDER_LINKAGE_MISMATCH"
  | "PAYMENT_PENDING"
  | "PAYMENT_FAILED"
  | "ORDER_NOT_FOUND"
  | "INCOMPLETE_LOCAL_ITEM_MAPPING"
  | "GATEWAY_UNAVAILABLE"
  | "VERIFICATION_INCONCLUSIVE";

export type DiagnosticFindingType =
  | "SEPARATE_ORDER_NOTICE"
  | "RETRY_ORDER_NOTICE"
  | "MISSING_ORDER_LINK"
  | "MISSING_ACCOMMODATION_LINK"
  | "DUPLICATE_ITEM_MAPPING"
  | "CONFLICTING_ITEM_MAPPING"
  | "CONTRADICTORY_LOCAL_STATUS"
  | "AMOUNT_ALLOCATION_MISMATCH"
  | "UNLINKED_REGISTRATION_FOUND";

export type DiagnosticFinding = {
  type: DiagnosticFindingType;
  severity: "info" | "warning" | "error";
  title: string;
  description: string;
  orderId?: string;
  itemId?: string;
  participantId?: string;
};

export type LinkedItemDetail = {
  id: string;
  itemType: "event" | "accommodation";
  title: string;
  category?: string | null;
  expectedAmount: number;
  localStatus: string;
  delegateName?: string;
  dates?: string;
  paymentOrderId?: string | null;
};

export type OrderVerificationResult = {
  orderId: string;
  orderReference: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  gateway: string;
  payerParticipantId: string;
  payerName: string;
  payerEmail: string;
  payerPublicId: string;
  expectedAmount: number;
  currency: string;
  gatewayReportedAmount: number | null;
  gatewayReportedCurrency: string | null;
  additionalCharges: number | null;
  settlementAmount?: number | null;
  deductions?: number | null;
  customerTransactionAmount?: number | null;
  bankRefNum?: string | null;
  udf1?: string | null;
  localOrderStatus: string;
  authoritativeGatewayStatus: string;
  settlementReceiptStatus: "receipt_created" | "receipt_missing" | "not_applicable";
  outcome: ReconciliationOutcome;
  outcomeMessage: string;
  linkedItems: LinkedItemDetail[];
  diagnosticFindings: DiagnosticFinding[];
  orderCreatedAt: string | null;
  gatewayTransactionTime: string | null;
  verifiedAt: string;
  diagnostics: {
    verifiedAt: string;
    rawGatewayStatus?: string;
    mode?: string;
    addedOn?: string;
    unmappedStatus?: string;
    amountDifference?: number;
    isConvenienceFeeLikely?: boolean;
    isLocalPreview?: boolean;
    auditNote?: string;
    bankRefNum?: string;
    udf1?: string;
    settlementAmount?: number;
    deductions?: number;
    customerTransactionAmount?: number;
  };
};

/**
 * Formats an ISO or PayU timestamp string into Asia/Kolkata (IST) calendar date and 12-hour time.
 * E.g., "21 Oct 2026, 08:30 AM IST"
 * If null, undefined, empty, or invalid, returns "Not available".
 */
export function formatIndianTimestamp(isoOrDateStr: string | null | undefined): string {
  if (!isoOrDateStr || typeof isoOrDateStr !== "string" || !isoOrDateStr.trim()) {
    return "Not available";
  }

  const trimmed = isoOrDateStr.trim();
  let date: Date;

  // Handle PayU's format: "YYYY-MM-DD HH:mm:ss"
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    date = new Date(`${trimmed.replace(/\s+/, "T")}+05:30`);
  } else {
    date = new Date(trimmed);
  }

  if (isNaN(date.getTime())) {
    return "Not available";
  }

  const formatted = date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return `${formatted} IST`;
}

export type VerificationSummary = {
  totalParticipants: number;
  totalOrders: number;
  matchedPaid: number;
  gatewayPaidLocalPending: number;
  amountMismatch: number;
  pendingUnverified: number;
  otherMismatches: number;
  gatewayReferenceMismatch?: number;
  conflictingItemMapping?: number;
  missingAccommodationLink?: number;
  verifiedAt: string;
  isLocalPreview: boolean;
  environment: "local_simulation" | "production_gateway";
};

export type VerificationResponse = {
  success: boolean;
  summary: VerificationSummary;
  orders: OrderVerificationResult[];
  unlinkedItems?: LinkedItemDetail[];
  findings?: DiagnosticFinding[];
  error?: string;
};

/**
 * Safely converts an amount in INR to integer paise (cents)
 * to avoid IEEE 754 floating point precision issues.
 */
export function toPaise(amount: number | string | null | undefined): number {
  if (amount == null) return 0;
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

/**
 * Determines whether the current execution context is safe for local previews.
 * Local previews must NEVER hit live production PayU credentials.
 */
export function isLocalOrTestEnvironment(): boolean {
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.PAYU_MOCK_VERIFICATION === "true") return true;
  // If running locally on localhost without explicit production flag
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}

/**
 * Authoritative, Read-Only Payment Verification Engine.
 *
 * Invariants:
 * 1. Strictly read-only: does not update payment_orders, participant_events,
 *    participant_accommodations, payments, or trigger emails.
 * 2. Decimal-safe monetary comparisons.
 * 3. Deduplicates shared orders across participants and multi-event registrations.
 * 4. Isolates local/test preview mode from live external gateway endpoints.
 */
export async function verifyParticipantPayments(params: {
  supabaseAdmin: SupabaseClient;
  participantIds?: string[];
  orderIds?: string[];
  mockGatewayResults?: Record<string, {
    status: string;
    amountPaise: number;
    gatewayPaymentId?: string;
    gatewayOrderId?: string;
    rawStatus?: string;
    mode?: string;
    addedOn?: string;
    bankRefNum?: string;
    udf1?: string;
    additionalChargesPaise?: number;
    settlementAmountPaise?: number;
    deductionsPaise?: number;
    customerTransactionAmountPaise?: number;
  }>;
}): Promise<VerificationResponse> {
  const { supabaseAdmin, mockGatewayResults } = params;
  const verifiedAt = new Date().toISOString();

  // Normalize IDs
  const explicitOrderIds = new Set((params.orderIds || []).filter((id) => Boolean(id && id.trim())));
  const candidateParticipantIds = Array.from(new Set((params.participantIds || []).filter((id) => Boolean(id && id.trim()))));

  // If orderIds were provided, discover their payer_participant_id
  if (explicitOrderIds.size > 0) {
    const { data: initialOrders } = await supabaseAdmin
      .from("payment_orders")
      .select("id, payer_participant_id")
      .in("id", Array.from(explicitOrderIds));

    (initialOrders || []).forEach((io) => {
      if (io.payer_participant_id && !candidateParticipantIds.includes(io.payer_participant_id)) {
        candidateParticipantIds.push(io.payer_participant_id);
      }
    });
  }

  if (candidateParticipantIds.length === 0 && explicitOrderIds.size === 0) {
    return {
      success: true,
      summary: {
        totalParticipants: 0,
        totalOrders: 0,
        matchedPaid: 0,
        gatewayPaidLocalPending: 0,
        amountMismatch: 0,
        pendingUnverified: 0,
        otherMismatches: 0,
        verifiedAt,
        isLocalPreview: isLocalOrTestEnvironment(),
        environment: isLocalOrTestEnvironment() ? "local_simulation" : "production_gateway",
      },
      orders: [],
      unlinkedItems: [],
      findings: [],
    };
  }

  // 1. Fetch Participants
  let participantsMap = new Map();
  if (candidateParticipantIds.length > 0) {
    const { data: participants, error: pError } = await supabaseAdmin
      .from("participants")
      .select("id, participant_id, name, email, phone, college")
      .in("id", candidateParticipantIds);

    if (pError) {
      throw new Error(`Failed to load participants: ${pError.message}`);
    }

    participantsMap = new Map((participants || []).map((p) => [p.id, p]));
  }

  // 2. Fetch Participant Events
  const { data: participantEvents, error: peError } = await supabaseAdmin
    .from("participant_events")
    .select(`
      id,
      participant_id,
      event_id,
      payment_status,
      payment_amount,
      payment_id,
      events (
        id,
        name,
        category,
        payment_type,
        registration_fee
      )
    `)
    .in("participant_id", candidateParticipantIds)
    .eq("is_archived", false);

  if (peError) {
    throw new Error(`Failed to load participant events: ${peError.message}`);
  }

  const peIds = (participantEvents || []).map((pe) => pe.id);

  // 3. Fetch Accommodations
  const { data: accommodations, error: accError } = await supabaseAdmin
    .from("participant_accommodations")
    .select(`
      id,
      participant_id,
      accommodation_plan_id,
      start_date,
      end_date,
      duration_days,
      amount,
      currency,
      status,
      payment_order_id,
      accommodation_plans (
        id,
        name,
        price
      )
    `)
    .in("participant_id", candidateParticipantIds)
    .neq("status", "cancelled");

  if (accError) {
    console.warn("Accommodations fetch warning in verifier:", accError);
  }

  const accList = accommodations || [];

  // 4. Discover linked payment orders from payment_order_items and participant_accommodations
  const discoveredOrderIds = new Set<string>(explicitOrderIds);
  const isExplicitOrdersOnly = explicitOrderIds.size > 0 && (!params.participantIds || params.participantIds.length === 0);

  if (!isExplicitOrdersOnly) {
    // Add payment_order_id from accommodations
    accList.forEach((acc) => {
      if (acc.payment_order_id) {
        discoveredOrderIds.add(acc.payment_order_id);
      }
    });

    // Query payment_order_items by participant_event_id
    if (peIds.length > 0) {
      const { data: peOrderItems, error: poiError } = await supabaseAdmin
        .from("payment_order_items")
        .select("payment_order_id, participant_event_id, participant_accommodation_id")
        .in("participant_event_id", peIds);

      if (!poiError && peOrderItems) {
        peOrderItems.forEach((poi) => {
          if (poi.payment_order_id) discoveredOrderIds.add(poi.payment_order_id);
        });
      }
    }

    // Also query payment_orders directly by payer_participant_id
    if (candidateParticipantIds.length > 0) {
      const { data: payerOrders } = await supabaseAdmin
        .from("payment_orders")
        .select("id")
        .in("payer_participant_id", candidateParticipantIds);

      (payerOrders || []).forEach((po) => discoveredOrderIds.add(po.id));
    }
  }

  const uniqueOrderIds = Array.from(discoveredOrderIds);

  // 5. Load authoritative Payment Orders and all their items
  let paymentOrders: any[] = [];
  let allOrderItems: any[] = [];
  let canonicalReceipts: any[] = [];

  if (uniqueOrderIds.length > 0) {
    const [ordersRes, itemsRes, receiptsRes] = await Promise.all([
      supabaseAdmin
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
        .in("id", uniqueOrderIds),

      supabaseAdmin
        .from("payment_order_items")
        .select(`
          id,
          payment_order_id,
          item_type,
          amount,
          participant_event_id,
          participant_accommodation_id,
          events ( id, name, category, payment_type, registration_fee ),
          participant_events ( id, participant_id, payment_status, payment_amount ),
          participant_accommodations (
            id,
            participant_id,
            amount,
            status,
            start_date,
            end_date,
            accommodation_plans ( name )
          )
        `)
        .in("payment_order_id", uniqueOrderIds),

      supabaseAdmin
        .from("payments")
        .select("id, gateway_order_id, gateway_payment_id, amount, status, participant_id, created_at")
        .in("gateway_order_id", uniqueOrderIds.map(id => id)) // Or match by gateway_order_id
    ]);

    paymentOrders = ordersRes.data || [];
    allOrderItems = itemsRes.data || [];
    canonicalReceipts = receiptsRes.data || [];
  }

  const itemsByOrderId = new Map<string, any[]>();
  allOrderItems.forEach((item) => {
    const list = itemsByOrderId.get(item.payment_order_id) || [];
    list.push(item);
    itemsByOrderId.set(item.payment_order_id, list);
  });

  const receiptsByGatewayOrderId = new Map<string, any>();
  canonicalReceipts.forEach((r) => {
    if (r.gateway_order_id) receiptsByGatewayOrderId.set(r.gateway_order_id, r);
  });

  // Track item occurrences across orders to detect duplicate mappings
  const itemOrderMap = new Map<string, string[]>();
  allOrderItems.forEach((poi) => {
    const itemId = poi.participant_event_id || poi.participant_accommodation_id;
    if (itemId && poi.payment_order_id) {
      const list = itemOrderMap.get(itemId) || [];
      if (!list.includes(poi.payment_order_id)) {
        list.push(poi.payment_order_id);
      }
      itemOrderMap.set(itemId, list);
    }
  });

  // Group orders by payer to detect multi-checkout participants (e.g. separate MUN registrations)
  const ordersByPayer = new Map<string, any[]>();
  paymentOrders.forEach((o) => {
    const list = ordersByPayer.get(o.payer_participant_id) || [];
    list.push(o);
    ordersByPayer.set(o.payer_participant_id, list);
  });

  // Also map participant_accommodations directly linked to an order
  const accsByOrderId = new Map<string, any[]>();
  accList.forEach((acc) => {
    if (acc.payment_order_id) {
      const list = accsByOrderId.get(acc.payment_order_id) || [];
      list.push(acc);
      accsByOrderId.set(acc.payment_order_id, list);
    }
  });

  // 6. Verify each distinct payment order
  const results: OrderVerificationResult[] = [];
  const processedOrderIds = new Set<string>();

  for (const order of paymentOrders) {
    if (processedOrderIds.has(order.id)) continue;
    processedOrderIds.add(order.id);

    const payer = participantsMap.get(order.payer_participant_id);
    const orderItems = itemsByOrderId.get(order.id) || [];
    const directAccs = accsByOrderId.get(order.id) || [];

    // Assemble Linked Items
    const linkedItems: LinkedItemDetail[] = [];
    let hasMissingAccommodationRecord = false;

    // Event items
    orderItems.forEach((poi) => {
      if (poi.item_type === "event" || poi.participant_event_id) {
        const rawEvt = Array.isArray(poi.events) ? poi.events[0] : poi.events;
        const rawPe = Array.isArray(poi.participant_events) ? poi.participant_events[0] : poi.participant_events;
        linkedItems.push({
          id: poi.id,
          itemType: "event",
          title: rawEvt?.name || "Event Registration",
          category: rawEvt?.category || null,
          expectedAmount: Number(poi.amount) || Number(rawEvt?.registration_fee) || 0,
          localStatus: rawPe?.payment_status || "pending",
          paymentOrderId: order.id,
        });
      } else if (poi.item_type === "accommodation" || poi.participant_accommodation_id) {
        const rawAcc = Array.isArray(poi.participant_accommodations)
          ? poi.participant_accommodations[0]
          : poi.participant_accommodations || accList.find((a) => a.id === poi.participant_accommodation_id);
        if (!rawAcc && poi.participant_accommodation_id) {
          hasMissingAccommodationRecord = true;
        }
        const rawPlan = rawAcc?.accommodation_plans;
        const plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
        const dates = rawAcc?.start_date && rawAcc?.end_date ? `${rawAcc.start_date} to ${rawAcc.end_date}` : undefined;
        const accId = poi.participant_accommodation_id || poi.id;
        linkedItems.push({
          id: accId,
          itemType: "accommodation",
          title: plan?.name || (!rawAcc ? "Missing Accommodation Booking" : "Accommodation Booking"),
          category: "Accommodation",
          expectedAmount: Number(poi.amount) || Number(rawAcc?.amount) || 0,
          localStatus: rawAcc?.status || "missing",
          dates,
          paymentOrderId: order.id,
        });
      }
    });

    // Directly linked accommodations if not already in orderItems
    directAccs.forEach((acc) => {
      const alreadyInList = linkedItems.some(
        (li) => li.itemType === "accommodation" && li.id === acc.id
      );
      if (!alreadyInList) {
        const rawPlan = Array.isArray(acc.accommodation_plans) ? acc.accommodation_plans[0] : acc.accommodation_plans;
        const dates = acc.start_date && acc.end_date ? `${acc.start_date} to ${acc.end_date}` : undefined;
        linkedItems.push({
          id: acc.id,
          itemType: "accommodation",
          title: rawPlan?.name || "Accommodation Booking",
          category: "Accommodation",
          expectedAmount: Number(acc.amount) || 0,
          localStatus: acc.status || "pending",
          dates,
          paymentOrderId: order.id,
        });
      }
    });

    // Calculate expected order amount
    const expectedAmount = Number(order.amount) || 0;
    const expectedAmountPaise = toPaise(expectedAmount);

    // Gateway verification details
    let gatewayReportedStatus = "unknown";
    let gatewayReportedAmountPaise: number | null = null;
    let gatewayPaymentId = order.gateway_payment_id || null;
    let reportedGatewayOrderId: string = order.gateway_order_id;
    let rawGatewayStatus: string | undefined;
    let gatewayMode: string | undefined;
    let gatewayAddedOn: string | undefined;
    let gatewayError: string | null = null;
    let isLocalPreview = false;
    let bankRefNum: string | null = null;
    let udf1: string | null = null;
    let settlementAmountPaise: number | null = null;
    let deductionsPaise: number | null = null;
    let customerTxnAmountPaise: number | null = null;
    let gatewayAdditionalChargesPaise: number | null = null;

    // Check mock results first (used in unit/integration tests and local dev previews)
    if (mockGatewayResults && (mockGatewayResults[order.gateway_order_id] || mockGatewayResults[order.id])) {
      const mock = mockGatewayResults[order.gateway_order_id] || mockGatewayResults[order.id];
      gatewayReportedStatus = mock.status;
      gatewayReportedAmountPaise = mock.amountPaise;
      gatewayPaymentId = mock.gatewayPaymentId || gatewayPaymentId;
      reportedGatewayOrderId = mock.gatewayOrderId || order.gateway_order_id;
      rawGatewayStatus = mock.rawStatus || mock.status;
      gatewayMode = mock.mode;
      gatewayAddedOn = mock.addedOn;
      bankRefNum = mock.bankRefNum || null;
      udf1 = mock.udf1 || null;
      settlementAmountPaise = mock.settlementAmountPaise ?? null;
      deductionsPaise = mock.deductionsPaise ?? null;
      customerTxnAmountPaise = mock.customerTransactionAmountPaise ?? null;
      if (mock.additionalChargesPaise != null) {
        gatewayAdditionalChargesPaise = mock.additionalChargesPaise;
      }
      isLocalPreview = true;
    } else if (isLocalOrTestEnvironment()) {
      // SAFE LOCAL FALLBACK:
      // When running in local development without mock injection, do not hit live external PayU servers.
      // Represent deterministic status matching existing local records and clearly mark as preview.
      isLocalPreview = true;
      if (order.status === "paid") {
        gatewayReportedStatus = "paid";
        gatewayReportedAmountPaise = expectedAmountPaise;
        rawGatewayStatus = "success (local simulated)";
      } else {
        gatewayReportedStatus = "pending";
        gatewayReportedAmountPaise = expectedAmountPaise;
        rawGatewayStatus = "pending (local simulated)";
      }
    } else {
      // Production Server-Side PayU Verification (Read-Only)
      try {
        const gateway = new PayUGateway();
        const details = await gateway.fetchPaymentDetails(order.gateway_order_id);
        gatewayReportedStatus = details.status;
        gatewayReportedAmountPaise = details.amount;
        reportedGatewayOrderId = details.gatewayOrderId || order.gateway_order_id;
        if (details.gatewayPaymentId) {
          gatewayPaymentId = details.gatewayPaymentId;
        }
        rawGatewayStatus = details.rawStatus;
        gatewayMode = details.mode;
        gatewayAddedOn = details.addedOn;
        bankRefNum = details.bankRefNum || null;
        udf1 = details.udf1 || null;
        settlementAmountPaise = details.settlementAmount ?? null;
        deductionsPaise = details.deductions ?? null;
        customerTxnAmountPaise = details.customerTransactionAmount ?? null;
        if (details.additionalCharges != null) {
          gatewayAdditionalChargesPaise = details.additionalCharges;
        }
      } catch (err) {
        if (err instanceof PaymentVerificationError) {
          gatewayError = err.message;
          if (err.errorType === "network" || err.errorType === "timeout") {
            gatewayReportedStatus = "gateway_unavailable";
          } else {
            gatewayReportedStatus = "verification_error";
          }
        } else {
          gatewayError = err instanceof Error ? err.message : String(err);
          gatewayReportedStatus = "gateway_unavailable";
        }
      }
    }

    // Decimal-safe amount evaluation
    const gatewayAmountINR = gatewayReportedAmountPaise != null ? gatewayReportedAmountPaise / 100 : null;
    const amountDifference = gatewayReportedAmountPaise != null
      ? (gatewayReportedAmountPaise - expectedAmountPaise) / 100
      : undefined;

    // Check if small discrepancy could be PayU gateway convenience charges + GST
    const isConvenienceFeeLikely =
      amountDifference != null &&
      amountDifference > 0 &&
      amountDifference <= 50;

    // Evaluate Canonical Receipt in payments table
    const canonicalReceipt = receiptsByGatewayOrderId.get(order.gateway_order_id);
    let settlementReceiptStatus: "receipt_created" | "receipt_missing" | "not_applicable" = "not_applicable";
    if (order.status === "paid") {
      settlementReceiptStatus = canonicalReceipt ? "receipt_created" : "receipt_missing";
    }

    // Determine Outcome Classification
    let outcome: ReconciliationOutcome = "VERIFICATION_INCONCLUSIVE";
    let outcomeMessage = "";

    // 1. Check Gateway Reference Mismatch
    if (reportedGatewayOrderId && reportedGatewayOrderId !== order.gateway_order_id) {
      outcome = "GATEWAY_REFERENCE_MISMATCH";
      outcomeMessage = `Gateway transaction reference mismatch: local order expects "${order.gateway_order_id}", but gateway returned "${reportedGatewayOrderId}".`;
    } else if (order.currency && order.currency.toUpperCase() !== "INR") {
      outcome = "AMOUNT_MISMATCH";
      outcomeMessage = `Unsupported currency "${order.currency}". Only INR is supported.`;
    } else if (gatewayReportedStatus === "gateway_unavailable") {
      outcome = "GATEWAY_UNAVAILABLE";
      outcomeMessage = `PayU verification endpoint was unreachable or timed out: ${gatewayError || "Connection failed"}.`;
    } else if (gatewayReportedStatus === "not_found") {
      if (order.status === "paid") {
        outcome = "LOCAL_PAID_GATEWAY_NOT_CONFIRMED";
        outcomeMessage = "Order is recorded as PAID locally, but PayU reports 'Not Found' (no captured transaction).";
      } else {
        outcome = "ORDER_NOT_FOUND";
        outcomeMessage = "Order was created but attendee did not initiate or complete payment on PayU.";
      }
    } else if (gatewayReportedStatus === "failed") {
      outcome = "PAYMENT_FAILED";
      outcomeMessage = `PayU reports payment failure (Status: ${rawGatewayStatus || "failed"}).`;
    } else if (gatewayReportedStatus === "pending") {
      outcome = "PAYMENT_PENDING";
      outcomeMessage = "Payment is awaiting completion or confirmation by PayU.";
    } else if (gatewayReportedStatus === "paid") {
      // Gateway is PAID. Check amount matching.
      const amountsMatch =
        gatewayReportedAmountPaise != null &&
        gatewayReportedAmountPaise === expectedAmountPaise;

      if (!amountsMatch && !isConvenienceFeeLikely) {
        outcome = "AMOUNT_MISMATCH";
        outcomeMessage = `Order amount (₹${expectedAmount}) does not match gateway captured amount (₹${gatewayAmountINR ?? "unknown"}).`;
      } else if (order.status !== "paid") {
        outcome = "GATEWAY_PAID_LOCAL_PENDING";
        const localStatusText = order.status === "failed" ? "FAILED" : "PENDING";
        outcomeMessage = `Payment was captured on PayU (₹${gatewayAmountINR ?? expectedAmount}), but local database status remains ${localStatusText}. Atomic settlement has not run.`;
      } else {
        // Both local order and gateway are paid. Check linked items.
        const allItemsPaid = linkedItems.length > 0 && linkedItems.every((i) => i.localStatus === "paid");
        if (linkedItems.length === 0) {
          outcome = "INCOMPLETE_LOCAL_ITEM_MAPPING";
          outcomeMessage = "Order is paid on gateway and locally, but no line items (events/accommodations) are mapped to it.";
        } else if (!allItemsPaid) {
          outcome = "ORDER_LINKAGE_MISMATCH";
          const pendingItems = linkedItems.filter((i) => i.localStatus !== "paid").map((i) => i.title);
          outcomeMessage = `Payment order is confirmed paid, but linked item(s) remain unpaid: ${pendingItems.join(", ")}.`;
        } else {
          outcome = "MATCHED_PAID";
          outcomeMessage = "Payment verified on PayU and all linked events/accommodations are confirmed paid.";
        }
      }
    } else {
      outcome = "VERIFICATION_INCONCLUSIVE";
      outcomeMessage = `Verification result was inconclusive: ${rawGatewayStatus || gatewayReportedStatus}.`;
    }

    // Check if any linked item is conflicting with another settled order
    let conflictingSettledOrderRef: string | null = null;
    linkedItems.forEach((li) => {
      const mappedOrders = itemOrderMap.get(li.id) || [];
      if (mappedOrders.length > 1) {
        const otherPaid = paymentOrders.find(
          (o) => o.id !== order.id && mappedOrders.includes(o.id) && o.status === "paid"
        );
        if (otherPaid) {
          conflictingSettledOrderRef = otherPaid.order_reference;
        }
      }
    });

    if (conflictingSettledOrderRef && order.status !== "paid") {
      outcome = "CONFLICTING_ITEM_MAPPING";
      outcomeMessage = `Item is already mapped to another settled order (${conflictingSettledOrderRef}). Reconciliation blocked due to conflicting item mapping.`;
    }

    // Missing accommodation link check
    const hasAccommodationItem = orderItems.some(
      (poi) => poi.item_type === "accommodation" || poi.participant_accommodation_id
    );
    const hasLinkedAcc = linkedItems.some((li) => li.itemType === "accommodation");
    if (hasMissingAccommodationRecord || (hasAccommodationItem && !hasLinkedAcc)) {
      outcome = "MISSING_ACCOMMODATION_LINK";
      outcomeMessage = "Order contains accommodation items, but the linked accommodation record was not found or is missing.";
    }

    // Diagnostic Findings for this specific order
    const diagnosticFindings: DiagnosticFinding[] = [];

    // Notice if participant has multiple orders (e.g. General Assembly vs Security Council)
    const payerTotalOrders = ordersByPayer.get(order.payer_participant_id) || [];
    if (payerTotalOrders.length > 1) {
      diagnosticFindings.push({
        type: "SEPARATE_ORDER_NOTICE",
        severity: "info",
        title: "Independent Registration Order",
        description: `Participant has ${payerTotalOrders.length} separate payment orders. Each checkout is independent; payment of one order does not settle another.`,
        orderId: order.id,
        participantId: order.payer_participant_id,
      });
    }

    // Contradictory local statuses
    if (order.status === "paid") {
      const nonPaid = linkedItems.filter((i) => i.localStatus !== "paid");
      if (nonPaid.length > 0) {
        diagnosticFindings.push({
          type: "CONTRADICTORY_LOCAL_STATUS",
          severity: "warning",
          title: "Contradictory Local Status",
          description: `Order ${order.order_reference} is PAID, but ${nonPaid.length} linked item(s) are unpaid (${nonPaid.map((i) => `${i.title}: ${i.localStatus}`).join(", ")}).`,
          orderId: order.id,
          participantId: order.payer_participant_id,
        });
      }
    } else if (order.status === "pending") {
      const paidItems = linkedItems.filter((i) => i.localStatus === "paid");
      if (paidItems.length > 0) {
        diagnosticFindings.push({
          type: "CONTRADICTORY_LOCAL_STATUS",
          severity: "warning",
          title: "Contradictory Local Status",
          description: `Linked item(s) (${paidItems.map((i) => i.title).join(", ")}) are marked PAID, but payment order remains PENDING.`,
          orderId: order.id,
          participantId: order.payer_participant_id,
        });
      }
    }

    // Unexpected amount allocation
    if (linkedItems.length > 0) {
      const itemsSumPaise = linkedItems.reduce((acc, it) => acc + toPaise(it.expectedAmount), 0);
      if (itemsSumPaise !== expectedAmountPaise) {
        diagnosticFindings.push({
          type: "AMOUNT_ALLOCATION_MISMATCH",
          severity: "warning",
          title: "Amount Allocation Mismatch",
          description: `Order expected amount (₹${expectedAmount}) differs from sum of mapped line items (₹${itemsSumPaise / 100}).`,
          orderId: order.id,
          participantId: order.payer_participant_id,
        });
      }
    }

    // Duplicate item mapping check
    linkedItems.forEach((li) => {
      const mappedOrders = itemOrderMap.get(li.id) || [];
      if (mappedOrders.length > 1) {
        const otherOrders = paymentOrders.filter(
          (o) => o.id !== order.id && mappedOrders.includes(o.id)
        );
        const isRetry = otherOrders.every(
          (o) => o.status === "failed" || o.status === "cancelled" || o.status === "pending"
        );
        if (isRetry) {
          diagnosticFindings.push({
            type: "RETRY_ORDER_NOTICE",
            severity: "info",
            title: "Checkout Retry Chain",
            description: `Item "${li.title}" was part of ${mappedOrders.length} checkout attempt(s). Only one canonical order may be settled.`,
            orderId: order.id,
            itemId: li.id,
            participantId: order.payer_participant_id,
          });
        } else {
          diagnosticFindings.push({
            type: "DUPLICATE_ITEM_MAPPING",
            severity: "error",
            title: "Duplicate Item Mapping",
            description: `Item "${li.title}" is linked to ${mappedOrders.length} distinct payment orders (${mappedOrders.join(", ")}).`,
            orderId: order.id,
            itemId: li.id,
            participantId: order.payer_participant_id,
          });
        }
      }
    });

    results.push({
      orderId: order.id,
      orderReference: order.order_reference,
      gatewayOrderId: order.gateway_order_id,
      gatewayPaymentId,
      gateway: order.gateway || "payu",
      payerParticipantId: order.payer_participant_id,
      payerName: payer?.name || "Unknown Participant",
      payerEmail: payer?.email || "Unknown Email",
      payerPublicId: payer?.participant_id || "SVK-UNKNOWN",
      expectedAmount,
      currency: order.currency || "INR",
      gatewayReportedAmount: gatewayAmountINR,
      gatewayReportedCurrency: "INR",
      additionalCharges: gatewayAdditionalChargesPaise != null && gatewayAdditionalChargesPaise > 0
        ? gatewayAdditionalChargesPaise / 100
        : isConvenienceFeeLikely
          ? amountDifference ?? null
          : null,
      settlementAmount: settlementAmountPaise != null ? settlementAmountPaise / 100 : null,
      deductions: deductionsPaise != null ? deductionsPaise / 100 : null,
      customerTransactionAmount: customerTxnAmountPaise != null ? customerTxnAmountPaise / 100 : null,
      bankRefNum,
      udf1,
      localOrderStatus: order.status,
      authoritativeGatewayStatus: gatewayReportedStatus,
      settlementReceiptStatus,
      outcome,
      outcomeMessage,
      linkedItems,
      diagnosticFindings,
      orderCreatedAt: order.created_at || null,
      gatewayTransactionTime: gatewayAddedOn || null,
      verifiedAt,
      diagnostics: {
        verifiedAt,
        rawGatewayStatus,
        mode: gatewayMode,
        addedOn: gatewayAddedOn,
        amountDifference,
        isConvenienceFeeLikely,
        isLocalPreview,
        auditNote: isLocalPreview ? "Verified in safe preview/test environment (mocked gateway)" : undefined,
        bankRefNum: bankRefNum || undefined,
        udf1: udf1 || undefined,
        settlementAmount: settlementAmountPaise ?? undefined,
        deductions: deductionsPaise ?? undefined,
        customerTransactionAmount: customerTxnAmountPaise ?? undefined,
      },
    });
  }

  // 7. Discover unlinked items & participants with no payment orders at all
  const mappedPeIds = new Set(allOrderItems.map((i) => i.participant_event_id).filter(Boolean));
  const mappedPaIds = new Set([
    ...allOrderItems.map((i) => i.participant_accommodation_id).filter(Boolean),
    ...accList.filter((a) => a.payment_order_id).map((a) => a.id),
  ]);

  const unlinkedItems: LinkedItemDetail[] = [];
  const overallFindings: DiagnosticFinding[] = [];

  for (const participantId of candidateParticipantIds) {
    const p = participantsMap.get(participantId);
    const pEvents = (participantEvents || []).filter((pe) => pe.participant_id === participantId);
    const pAccs = accList.filter((a) => a.participant_id === participantId);

    // Check for unlinked payable events
    pEvents.forEach((pe) => {
      if (!mappedPeIds.has(pe.id)) {
        const rawEvt = Array.isArray(pe.events) ? pe.events[0] : pe.events;
        const isPayable = rawEvt?.payment_type === "paid" || Number(pe.payment_amount) > 0;
        if (isPayable) {
          const detail: LinkedItemDetail = {
            id: pe.id,
            itemType: "event",
            title: rawEvt?.name || "Event Registration",
            category: rawEvt?.category || null,
            expectedAmount: Number(pe.payment_amount) || Number(rawEvt?.registration_fee) || 0,
            localStatus: pe.payment_status || "pending",
            paymentOrderId: null,
          };
          unlinkedItems.push(detail);
          overallFindings.push({
            type: "MISSING_ORDER_LINK",
            severity: "warning",
            title: "Unlinked Payable Registration",
            description: `Participant ${p?.name || participantId} has registration "${detail.title}" (₹${detail.expectedAmount}) with no linked payment order.`,
            itemId: pe.id,
            participantId,
          });
        }
      }
    });

    // Check for unlinked payable accommodations
    pAccs.forEach((acc) => {
      if (!mappedPaIds.has(acc.id) && !acc.payment_order_id) {
        const rawPlan = Array.isArray(acc.accommodation_plans) ? acc.accommodation_plans[0] : acc.accommodation_plans;
        const dates = acc.start_date && acc.end_date ? `${acc.start_date} to ${acc.end_date}` : undefined;
        const detail: LinkedItemDetail = {
          id: acc.id,
          itemType: "accommodation",
          title: rawPlan?.name || "Accommodation Booking",
          category: "Accommodation",
          expectedAmount: Number(acc.amount) || 0,
          localStatus: acc.status || "pending",
          dates,
          paymentOrderId: null,
        };
        unlinkedItems.push(detail);
        overallFindings.push({
          type: "MISSING_ORDER_LINK",
          severity: "warning",
          title: "Unlinked Accommodation Booking",
          description: `Participant ${p?.name || participantId} has accommodation "${detail.title}" (₹${detail.expectedAmount}) with no linked payment order.`,
          itemId: acc.id,
          participantId,
        });
      }
    });

    const hasOrder = results.some((r) => r.payerParticipantId === participantId);
    if (!hasOrder) {
      const isAllFree =
        pEvents.length > 0 &&
        pEvents.every((pe) => {
          const rawEvt = Array.isArray(pe.events) ? pe.events[0] : pe.events;
          return rawEvt?.payment_type !== "paid" && Number(pe.payment_amount || 0) === 0;
        }) &&
        pAccs.length === 0;

      const linkedItems: LinkedItemDetail[] = [
        ...pEvents.map((pe) => {
          const rawEvt = Array.isArray(pe.events) ? pe.events[0] : pe.events;
          return {
            id: pe.id,
            itemType: "event" as const,
            title: rawEvt?.name || "Event",
            category: rawEvt?.category || null,
            expectedAmount: Number(pe.payment_amount) || 0,
            localStatus: pe.payment_status || "not_required",
          };
        }),
        ...pAccs.map((acc) => {
          const rawPlan = Array.isArray(acc.accommodation_plans) ? acc.accommodation_plans[0] : acc.accommodation_plans;
          return {
            id: acc.id,
            itemType: "accommodation" as const,
            title: rawPlan?.name || "Accommodation",
            category: "Accommodation",
            expectedAmount: Number(acc.amount) || 0,
            localStatus: acc.status || "pending",
          };
        }),
      ];

      const outcome: ReconciliationOutcome = isAllFree ? "MATCHED_PAID" : "ORDER_LINKAGE_MISMATCH";
      const outcomeMessage = isAllFree
        ? "Free event registration verified. No payment order was required."
        : "Participant has payable events or accommodation, but no payment order was found.";

      results.push({
        orderId: `unlinked-${participantId}`,
        orderReference: "NO-ORDER",
        gatewayOrderId: "N/A",
        gatewayPaymentId: null,
        gateway: "none",
        payerParticipantId: participantId,
        payerName: p?.name || "Unknown",
        payerEmail: p?.email || "Unknown",
        payerPublicId: p?.participant_id || "SVK-UNKNOWN",
        expectedAmount: 0,
        currency: "INR",
        gatewayReportedAmount: null,
        gatewayReportedCurrency: null,
        additionalCharges: null,
        localOrderStatus: isAllFree ? "not_required" : "pending",
        authoritativeGatewayStatus: "none",
        settlementReceiptStatus: "not_applicable",
        outcome,
        outcomeMessage,
        linkedItems,
        diagnosticFindings: isAllFree
          ? []
          : [
              {
                type: "MISSING_ORDER_LINK",
                severity: "warning",
                title: "Payable Items With No Payment Order",
                description: "Participant has payable events or accommodation without any recorded checkout order.",
                participantId,
              },
            ],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt,
        diagnostics: {
          verifiedAt,
          isLocalPreview: isLocalOrTestEnvironment(),
          auditNote: "Participant without dedicated payment order",
        },
      });
    }
  }

  // 8. Generate Summary
  const isLocalPreview = results.some((r) => r.diagnostics.isLocalPreview);
  const summary: VerificationSummary = {
    totalParticipants: candidateParticipantIds.length,
    totalOrders: results.length,
    matchedPaid: results.filter((r) => r.outcome === "MATCHED_PAID").length,
    gatewayPaidLocalPending: results.filter((r) => r.outcome === "GATEWAY_PAID_LOCAL_PENDING").length,
    amountMismatch: results.filter((r) => r.outcome === "AMOUNT_MISMATCH").length,
    pendingUnverified: results.filter(
      (r) =>
        r.outcome === "PAYMENT_PENDING" ||
        r.outcome === "ORDER_NOT_FOUND" ||
        r.outcome === "VERIFICATION_INCONCLUSIVE"
    ).length,
    otherMismatches: results.filter(
      (r) =>
        r.outcome === "LOCAL_PAID_GATEWAY_NOT_CONFIRMED" ||
        r.outcome === "ORDER_LINKAGE_MISMATCH" ||
        r.outcome === "INCOMPLETE_LOCAL_ITEM_MAPPING" ||
        r.outcome === "PAYMENT_FAILED" ||
        r.outcome === "GATEWAY_UNAVAILABLE" ||
        r.outcome === "GATEWAY_REFERENCE_MISMATCH" ||
        r.outcome === "CONFLICTING_ITEM_MAPPING" ||
        r.outcome === "MISSING_ACCOMMODATION_LINK"
    ).length,
    gatewayReferenceMismatch: results.filter((r) => r.outcome === "GATEWAY_REFERENCE_MISMATCH").length,
    conflictingItemMapping: results.filter((r) => r.outcome === "CONFLICTING_ITEM_MAPPING").length,
    missingAccommodationLink: results.filter((r) => r.outcome === "MISSING_ACCOMMODATION_LINK").length,
    verifiedAt,
    isLocalPreview,
    environment: isLocalPreview ? "local_simulation" : "production_gateway",
  };

  // Collect all findings across orders and unlinked items
  const allFindings = [
    ...results.flatMap((r) => r.diagnosticFindings || []),
    ...overallFindings,
  ];

  return {
    success: true,
    summary,
    orders: results,
    unlinkedItems,
    findings: allFindings,
  };
}

export const verifyPaymentOrders = verifyParticipantPayments;

export type PaymentAuditScope = {
  totalCandidateOrders: number;
  totalCandidateParticipants: number;
  breakdown: {
    pendingOrdersCount: number;
    failedOrdersCount: number;
    pendingAccommodationsWithOrdersCount: number;
    paidOrdersWithoutReceiptCount: number;
    retryChainOrdersCount: number;
    duplicateMappingOrdersCount: number;
  };
  candidateOrderIds: string[];
  candidateParticipantIds: string[];
  environment: "local_simulation" | "production_gateway";
  isLocalPreview: boolean;
};

/**
 * Proactively discovers anomalous, retry-chain, and unresolved payment orders
 * across the database for the Payment Reconciliation Centre Audit view.
 */
export async function getPaymentAuditScope(
  supabaseAdmin: SupabaseClient
): Promise<PaymentAuditScope> {
  const isLocal = isLocalOrTestEnvironment();

  // 1. Query pending and failed orders
  const { data: nonPaidOrders } = await supabaseAdmin
    .from("payment_orders")
    .select("id, status, payer_participant_id, gateway_order_id, amount, created_at")
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: false })
    .limit(100);

  // 2. Query pending accommodations with linked payment orders
  const { data: pendingAccs } = await supabaseAdmin
    .from("participant_accommodations")
    .select("id, participant_id, payment_order_id, status")
    .eq("status", "pending")
    .not("payment_order_id", "is", null);

  // 3. Query paid orders to verify payments receipt presence
  const { data: paidOrders } = await supabaseAdmin
    .from("payment_orders")
    .select("id, gateway_order_id, payer_participant_id, status")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(100);

  const paidGatewayOrderIds = (paidOrders || []).map((o) => o.gateway_order_id).filter(Boolean);
  const receiptGatewayIds = new Set<string>();
  if (paidGatewayOrderIds.length > 0) {
    const { data: receipts } = await supabaseAdmin
      .from("payments")
      .select("gateway_order_id")
      .in("gateway_order_id", paidGatewayOrderIds);
    (receipts || []).forEach((r) => {
      if (r.gateway_order_id) receiptGatewayIds.add(r.gateway_order_id);
    });
  }

  const missingReceiptOrders = (paidOrders || []).filter(
    (o) => !receiptGatewayIds.has(o.gateway_order_id)
  );

  // 4. Retry chains & Candidate consolidation
  const candidateOrderIdsSet = new Set<string>();
  const candidateParticipantIdsSet = new Set<string>();

  let pendingCount = 0;
  let failedCount = 0;
  (nonPaidOrders || []).forEach((o) => {
    if (o.status === "pending") pendingCount++;
    if (o.status === "failed") failedCount++;
    candidateOrderIdsSet.add(o.id);
    if (o.payer_participant_id) candidateParticipantIdsSet.add(o.payer_participant_id);
  });

  let pendingAccCount = 0;
  (pendingAccs || []).forEach((acc) => {
    if (acc.payment_order_id) {
      pendingAccCount++;
      candidateOrderIdsSet.add(acc.payment_order_id);
    }
    if (acc.participant_id) candidateParticipantIdsSet.add(acc.participant_id);
  });

  const missingReceiptCount = missingReceiptOrders.length;
  missingReceiptOrders.forEach((o) => {
    candidateOrderIdsSet.add(o.id);
    if (o.payer_participant_id) candidateParticipantIdsSet.add(o.payer_participant_id);
  });

  const candidateOrderIds = Array.from(candidateOrderIdsSet);
  const candidateParticipantIds = Array.from(candidateParticipantIdsSet);

  return {
    totalCandidateOrders: candidateOrderIds.length,
    totalCandidateParticipants: candidateParticipantIds.length,
    breakdown: {
      pendingOrdersCount: pendingCount,
      failedOrdersCount: failedCount,
      pendingAccommodationsWithOrdersCount: pendingAccCount,
      paidOrdersWithoutReceiptCount: missingReceiptCount,
      retryChainOrdersCount: candidateOrderIds.length,
      duplicateMappingOrdersCount: 0,
    },
    candidateOrderIds,
    candidateParticipantIds,
    environment: isLocal ? "local_simulation" : "production_gateway",
    isLocalPreview: isLocal,
  };
}

/**
 * Formats a clean, sanitized markdown diagnostic report suitable for copying
 * and sharing with payment operations or department auditors.
 * Strictly guarantees ZERO secrets, salts, keys, or authentication hashes.
 */
export function generateSanitizedDiagnosticReport(verification: VerificationResponse): string {
  const { summary, orders, findings } = verification;
  const lines: string[] = [];

  lines.push("# SAVISKAR 2026 — AUTHORITATIVE PAYMENT RECONCILIATION AUDIT REPORT");
  lines.push(`**Generated At (IST)**: ${formatIndianTimestamp(summary.verifiedAt)}`);
  lines.push(`**Execution Environment**: ${summary.isLocalPreview ? "Local Simulation / Test Preview" : "Authorized Production Gateway"}`);
  lines.push(`**Audited Order Records**: ${summary.totalOrders} | **Participants Evaluated**: ${summary.totalParticipants}`);
  lines.push("");

  lines.push("## EXECUTIVE SUMMARY");
  lines.push("| Outcome Status | Count | Operational Guidance |");
  lines.push("| :--- | :---: | :--- |");
  lines.push(`| **Matched & Paid** | ${summary.matchedPaid} | Gateway and database confirmed paid with line items |`);
  lines.push(`| **Gateway Paid (Local Pending/Failed)** | ${summary.gatewayPaidLocalPending} | Captured at gateway; eligible for manual Master Admin reconciliation |`);
  lines.push(`| **Payment Failed** | ${orders.filter((o) => o.outcome === "PAYMENT_FAILED").length} | Gateway confirmed payment failure or cancellation |`);
  lines.push(`| **Amount / Currency Mismatch** | ${summary.amountMismatch} | Discrepancy between order expected amount and gateway captured amount |`);
  lines.push(`| **Conflicting / Mismatched Linkages** | ${summary.otherMismatches} | Item mapping conflict or missing accommodation link |`);
  lines.push(`| **Inconclusive / Gateway Unavailable** | ${orders.filter((o) => o.outcome === "VERIFICATION_INCONCLUSIVE" || o.outcome === "GATEWAY_UNAVAILABLE").length} | Transient network error or unmapped gateway response |`);
  lines.push("");

  lines.push("## DETAILED AUDIT FINDINGS BY ORDER");
  if (orders.length === 0) {
    lines.push("_No orders matched the audit criteria._");
  } else {
    orders.forEach((o, idx) => {
      lines.push(`### Order ${idx + 1}: ${o.orderReference} (${o.orderId.substring(0, 8)}...)`);
      lines.push(`- **Participant**: ${o.payerName} (${o.payerPublicId || "N/A"})`);
      lines.push(`- **Merchant Gateway Ref (txnid)**: \`${o.gatewayOrderId}\``);
      lines.push(`- **Gateway Payment ID (mihpayid)**: \`${o.gatewayPaymentId || "None recorded"}\``);
      if (o.bankRefNum) {
        lines.push(`- **Bank Reference Number**: \`${o.bankRefNum}\``);
      }
      if (o.udf1) {
        lines.push(`- **Gateway Echoed UDF1**: \`${o.udf1}\``);
      }
      lines.push(`- **Local Status**: \`${o.localOrderStatus.toUpperCase()}\` | **Gateway Status**: \`${o.authoritativeGatewayStatus.toUpperCase()}\``);
      lines.push(`- **Base Order Amount**: ₹${o.expectedAmount.toFixed(2)} ${o.currency}`);
      if (o.gatewayReportedAmount != null) {
        lines.push(`- **Gateway Captured Amount**: ₹${o.gatewayReportedAmount.toFixed(2)} ${o.gatewayReportedCurrency || o.currency}`);
      }
      if (o.additionalCharges && o.additionalCharges > 0) {
        lines.push(`- **Customer Gateway Surcharge**: ₹${o.additionalCharges.toFixed(2)}`);
      }
      if (o.settlementAmount != null) {
        lines.push(`- **Net Settlement Amount**: ₹${o.settlementAmount.toFixed(2)}`);
      }
      if (o.deductions != null) {
        lines.push(`- **Gateway Deductions / Fees**: ₹${o.deductions.toFixed(2)}`);
      }
      lines.push(`- **Receipt Status**: \`${o.settlementReceiptStatus}\``);
      lines.push(`- **Audit Outcome**: **${o.outcome}** — ${o.outcomeMessage}`);

      if (o.linkedItems && o.linkedItems.length > 0) {
        lines.push("- **Linked Line Items**:");
        o.linkedItems.forEach((li) => {
          lines.push(`  - [${li.itemType.toUpperCase()}] ${li.title}: Expected ₹${li.expectedAmount.toFixed(2)}, Local Status: \`${li.localStatus}\``);
        });
      }
      lines.push("");
    });
  }

  if (findings && findings.length > 0) {
    lines.push("## SYSTEM DIAGNOSTIC NOTICES");
    findings.forEach((f) => {
      lines.push(`- **[${f.severity.toUpperCase()}] ${f.title}**: ${f.description}`);
    });
    lines.push("");
  }

  lines.push("---");
  lines.push("_Report generated automatically by Saviskar 2026 Authoritative Payment Reconciliation Engine. Zero secrets, credentials, or authentication hashes are recorded._");

  return lines.join("\n");
}
