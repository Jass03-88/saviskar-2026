/**
 * POST /api/payments/create
 *
 * Creates a payment gateway order from an existing payment_orders row.
 *
 * Request body:
 *   { paymentOrderId: string }
 *
 * Response:
 *   {
 *     success: true,
 *     gatewayOrderId: string,
 *     checkoutConfig: { gateway, options }
 *   }
 *
 * This route:
 *   1. Validates the payment_orders row exists and is pending
 *   2. Looks up payer info from participants
 *   3. Creates a gateway order via the payment abstraction
 *   4. Stores the gateway_order_id + gateway name back on payment_orders
 *   5. Returns checkout config to the frontend
 */

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { captureException } from "@/lib/monitoring/error-reporter";
import { getPaymentGateway, FetchedPaymentDetails } from "@/lib/payments";
import { getRegistrationSession } from "@/lib/auth/session";
import {
  verifyPaymentResumeToken,
  createPaymentResumeToken,
} from "@/lib/payments/resume-token";
import { getCanonicalPaymentBaseUrl } from "@/lib/payments/canonical-url";
import { CHECKOUT_EXPIRATION_THRESHOLD_MS } from "@/lib/accommodation-expiration";

function errorResponse(
  message: string,
  status: number,
  code?: string,
  headers?: Record<string, string>,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(code ? { code } : {}),
      ...(extra || {}),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    }
  );
}

export async function POST(
  request: NextRequest
) {
  // ─── Supabase Admin ─────────────────────────────────────

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey =
    process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error(
      "Payment create API: Missing Supabase config."
    );
    return errorResponse(
      "Payment service is not configured.",
      500,
      "CONFIG_ERROR"
    );
  }

  const supabaseAdmin = createClient(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  // ─── Parse Request ──────────────────────────────────────

  let body: { paymentOrderId?: string; resumeToken?: string };

  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "Invalid request body.",
      400,
      "INVALID_REQUEST"
    );
  }

  const paymentOrderId =
    typeof body.paymentOrderId === "string"
      ? body.paymentOrderId.trim()
      : "";

  if (!paymentOrderId) {
    return errorResponse(
      "Payment order ID is required.",
      400,
      "MISSING_PAYMENT_ORDER_ID"
    );
  }

  // ─── Token Input Conflict Hardening ─────────────────────
  const headerToken =
    request.headers.get("x-payment-resume-token")?.trim() || "";
  const bodyToken =
    typeof body.resumeToken === "string"
      ? body.resumeToken.trim()
      : "";

  if (headerToken && bodyToken && headerToken !== bodyToken) {
    return errorResponse(
      "Mismatched payment resume tokens provided.",
      400,
      "TOKEN_MISMATCH"
    );
  }

  const resumeToken = headerToken || bodyToken;

  // ─── Look Up Payment Order ──────────────────────────────

  const {
    data: paymentOrder,
    error: lookupError,
  } = await supabaseAdmin
    .from("payment_orders")
    .select(
      `
      id,
      order_reference,
      payer_participant_id,
      amount,
      currency,
      gateway,
      gateway_order_id,
      status,
      created_at,
      updated_at
    `
    )
    .eq("id", paymentOrderId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      "Payment order lookup failed:",
      lookupError
    );
    return errorResponse(
      "Could not find the payment order.",
      500,
      "DATABASE_ERROR"
    );
  }

  if (!paymentOrder) {
    return errorResponse(
      "Payment order not found.",
      404,
      "ORDER_NOT_FOUND"
    );
  }

  if (
    Number(paymentOrder.amount) <= 0
  ) {
    return errorResponse(
      "Payment order has no amount.",
      400,
      "INVALID_AMOUNT"
    );
  }

  // ─── Look Up Payer Info ─────────────────────────────────

  if (!paymentOrder.payer_participant_id) {
    return errorResponse(
      "Payment order is missing payer information.",
      400,
      "MISSING_PAYER_INFO"
    );
  }

  const {
    data: payer,
    error: payerError,
  } = await supabaseAdmin
    .from("participants")
    .select("id, participant_id, name, email, phone")
    .eq(
      "id",
      paymentOrder.payer_participant_id
    )
    .maybeSingle();

  if (payerError || !payer) {
    console.error(
      "Payer lookup failed:",
      payerError
    );
    return errorResponse(
      "Payer information not found.",
      404,
      "PAYER_NOT_FOUND"
    );
  }

  // ─── Verify Internal Linked Items Consistency ───────────

  const { data: orderItems, error: itemsError } = await supabaseAdmin
    .from("payment_order_items")
    .select("id, participant_id, participant_event_id, participant_accommodation_id, amount")
    .eq("payment_order_id", paymentOrder.id);

  if (itemsError || !orderItems || orderItems.length === 0) {
    return errorResponse(
      "Payment order has no linked items.",
      400,
      "EMPTY_ORDER_ITEMS"
    );
  }

  const itemsMismatch = orderItems.some(
    (item) => item.participant_id !== paymentOrder.payer_participant_id
  );

  if (itemsMismatch) {
    return errorResponse(
      "Payment order items are inconsistent.",
      403,
      "ORDER_ITEMS_MISMATCH"
    );
  }

  // ─── Authorization Boundary (Session or Resume Token) ───

  const session = await getRegistrationSession();
  let isAuthorized = false;

  // Option A: Active Registration Session
  if (session.authenticated && session.email) {
    if (
      payer.email &&
      session.email.toLowerCase() === payer.email.trim().toLowerCase()
    ) {
      isAuthorized = true;
    }
  }

  // Option B: Signed Payment Resume Token
  if (!isAuthorized && resumeToken) {
    const tokenResult = verifyPaymentResumeToken(resumeToken);
    if (tokenResult.valid && tokenResult.payload) {
      const payload = tokenResult.payload;
      if (
        payload.paymentOrderId === paymentOrder.id &&
        payload.payerParticipantUuid === paymentOrder.payer_participant_id &&
        payload.participantId === payer.participant_id
      ) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    if (!session.authenticated && !resumeToken) {
      return errorResponse(
        "Payment authorization required.",
        401,
        "AUTH_REQUIRED"
      );
    }
    return errorResponse(
      "Unauthorized access to this payment order.",
      403,
      "FORBIDDEN"
    );
  }

  const payerName = payer.name ?? "";
  const payerEmail = payer.email ?? "";
  const payerPhone = payer.phone ?? "";

  const baseUrlResult = getCanonicalPaymentBaseUrl(request);
  if (!baseUrlResult.success) {
    console.error(baseUrlResult.internalLog);
    return errorResponse(baseUrlResult.error, 500, "CANONICAL_URL_ERROR");
  }
  const resolvedBaseUrl = baseUrlResult.origin;

  // ─── If Order Is Already Paid in DB, Return Idempotent Success ─
  if (paymentOrder.status === "paid") {
    const participantPublicId = payer.participant_id ?? "";
    const resumeToken = createPaymentResumeToken({
      paymentOrderId: paymentOrder.id,
      participantId: participantPublicId,
      payerParticipantUuid: paymentOrder.payer_participant_id ?? "",
    });

    return NextResponse.json(
      {
        success: true,
        alreadyPaid: true,
        paymentOrderId: paymentOrder.id,
        gatewayOrderId: paymentOrder.gateway_order_id,
        participantId: participantPublicId,
        participant: {
          participantId: participantPublicId,
          name: payerName,
          email: payerEmail,
        },
        resumeToken,
        resumeUrl: `${resolvedBaseUrl}/payment/resume?token=${encodeURIComponent(resumeToken)}`,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  if (paymentOrder.status === "failed") {
    // If order was marked failed, check if another active pending attempt already exists for these participant events or accommodations
    const participantEventIds = orderItems.map((item) => item.participant_event_id).filter(Boolean);
    const participantAccommodationIds = orderItems.map((item) => item.participant_accommodation_id).filter(Boolean);
    if (participantEventIds.length > 0 || participantAccommodationIds.length > 0) {
      let activeQuery = supabaseAdmin
        .from("payment_order_items")
        .select("payment_orders!inner(id, status)")
        .eq("payment_orders.status", "pending")
        .limit(1);

      if (participantEventIds.length > 0 && participantAccommodationIds.length > 0) {
        activeQuery = activeQuery.or(
          `participant_event_id.in.(${participantEventIds.join(",")}),participant_accommodation_id.in.(${participantAccommodationIds.join(",")})`
        );
      } else if (participantEventIds.length > 0) {
        activeQuery = activeQuery.in("participant_event_id", participantEventIds);
      } else {
        activeQuery = activeQuery.in("participant_accommodation_id", participantAccommodationIds);
      }

      const { data: activeOrder } = await activeQuery.maybeSingle();

      if (activeOrder) {
        return errorResponse(
          "A payment attempt is currently active. Please complete it or wait a moment before trying again.",
          409,
          "CONCURRENT_RETRY_CONFLICT"
        );
      }
    }
  } else if (paymentOrder.status !== "pending") {
    return errorResponse(
      `Payment order cannot be processed (status: ${paymentOrder.status}).`,
      400,
      "INVALID_ORDER_STATUS"
    );
  }

  // ─── If Gateway Order Already Exists, Verify & Handle Retry ───

  if (paymentOrder.gateway_order_id) {
    const gateway = getPaymentGateway(paymentOrder.gateway ?? undefined);

    let details: FetchedPaymentDetails;
    try {
      details = await gateway.fetchPaymentDetails(paymentOrder.gateway_order_id);
    } catch (err) {
      console.error(
        "PayU Verify Payment failed. Failing safely without creating duplicate order:",
        err instanceof Error ? err.message : String(err)
      );
      return errorResponse(
        "Unable to verify current payment status with the gateway. Please try again in a few moments.",
        503,
        "VERIFICATION_UNAVAILABLE"
      );
    }

    // ─── Case A: Transaction Is Already Paid on Gateway ──────────
    if (details.status === "paid") {
      console.log("Transaction already captured on gateway. Reconciling payment order.", {
        paymentOrderId: paymentOrder.id,
        gatewayOrderId: paymentOrder.gateway_order_id,
      });

      const fetchedGatewayPaymentId = details.gatewayPaymentId;
      const verifiedAmountPaise = details.amount || Math.round(Number(paymentOrder.amount) * 100);
      const verifiedCurrency = details.currency || paymentOrder.currency || "INR";

      // ─── Atomic Database Settlement RPC ──────────────────────
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("process_payment_success", {
        p_gateway_order_id: paymentOrder.gateway_order_id,
        p_gateway_payment_id: fetchedGatewayPaymentId,
        p_amount_paise: verifiedAmountPaise,
        p_currency: verifiedCurrency,
        p_gateway_name: gateway.name,
      });

      if (rpcError || !rpcData) {
        console.error("Payment settlement RPC returned error or unexpected result:", {
          rpcError,
          paymentOrderId: paymentOrder.id,
          gatewayOrderId: paymentOrder.gateway_order_id,
        });

        // Reconcile ambiguous outcomes: check if the order was actually settled atomically despite timeout/error
        const { data: refreshedOrder } = await supabaseAdmin
          .from("payment_orders")
          .select("id, status, gateway_order_id, gateway_payment_id")
          .eq("id", paymentOrder.id)
          .maybeSingle();

        const isTransactionVerified =
          Boolean(refreshedOrder) &&
          refreshedOrder?.id === paymentOrder.id &&
          refreshedOrder?.status === "paid" &&
          Boolean(refreshedOrder?.gateway_order_id) &&
          refreshedOrder?.gateway_order_id === paymentOrder.gateway_order_id &&
          Boolean(refreshedOrder?.gateway_payment_id) &&
          Boolean(fetchedGatewayPaymentId) &&
          refreshedOrder?.gateway_payment_id === fetchedGatewayPaymentId;

        if (!isTransactionVerified) {
          console.warn("Ambiguous payment settlement could not verify exact transaction identity:", {
            paymentOrderId: paymentOrder.id,
            expectedGatewayOrderId: paymentOrder.gateway_order_id,
            expectedGatewayPaymentId: fetchedGatewayPaymentId,
            refreshedOrder: refreshedOrder
              ? {
                  id: refreshedOrder.id,
                  status: refreshedOrder.status,
                  gateway_order_id: refreshedOrder.gateway_order_id,
                  gateway_payment_id: refreshedOrder.gateway_payment_id,
                }
              : null,
          });

          // Fail closed: do NOT mark anything paid through manual fallback, do not insert payment claims, do not send email
          const isCapabilityGate =
            rpcError?.code === "PGRST202" ||
            rpcError?.code === "42883" ||
            Boolean(rpcError?.message && rpcError.message.includes("does not exist"));

          return errorResponse(
            isCapabilityGate
              ? "Payment settlement service is temporarily unavailable. Please retry shortly."
              : "Payment settlement could not be completed due to a system error. Please retry shortly.",
            isCapabilityGate ? 503 : 500,
            isCapabilityGate ? "SERVICE_UNAVAILABLE" : "SETTLEMENT_FAILED"
          );
        }

        console.log("Order confirmed paid via authorized status lookup despite ambiguous RPC result:", {
          paymentOrderId: paymentOrder.id,
          gatewayOrderId: paymentOrder.gateway_order_id,
          gatewayPaymentId: fetchedGatewayPaymentId,
        });
      } else if (!rpcData.success) {
        console.error("Payment settlement RPC rejected captured payment:", {
          error: rpcData.error,
          paymentOrderId: paymentOrder.id,
        });
        return errorResponse(
          rpcData.error || "Payment verification failed during settlement.",
          400,
          "SETTLEMENT_REJECTED"
        );
      } else {
        // Require documented, explicitly valid action from process_payment_success contract
        const validSettlementActions = [
          "settled",
          "settled_with_accommodation_conflict",
          "already_paid",
          "already_processed",
          "already_refunded",
        ];

        const action = typeof rpcData.action === "string" ? rpcData.action : "";

        if (!action || !validSettlementActions.includes(action)) {
          console.error("Payment settlement RPC returned unexpected or missing action:", {
            action: rpcData.action,
            rpcData,
            paymentOrderId: paymentOrder.id,
            gatewayOrderId: paymentOrder.gateway_order_id,
          });
          return errorResponse(
            "Payment settlement returned an unexpected response. Please contact support or retry shortly.",
            500,
            "INVALID_SETTLEMENT_RESPONSE"
          );
        }

        if (action === "already_refunded") {
          console.warn("Payment recovery halted because payment order is already refunded:", {
            paymentOrderId: paymentOrder.id,
            gatewayOrderId: paymentOrder.gateway_order_id,
          });
          return errorResponse(
            "This payment order has already been refunded and cannot be processed.",
            400,
            "ORDER_ALREADY_REFUNDED"
          );
        }

        // Only send confirmation email for newly settled orders, never for idempotent already settled callbacks
        if (action === "settled" || action === "settled_with_accommodation_conflict") {
          const { ensurePaymentConfirmationSent } = await import("@/lib/payments/post-payment");
          await ensurePaymentConfirmationSent(paymentOrder.id);
        }
      }

      const participantPublicId = payer.participant_id ?? "";
      const resumeToken = createPaymentResumeToken({
        paymentOrderId: paymentOrder.id,
        participantId: participantPublicId,
        payerParticipantUuid: paymentOrder.payer_participant_id ?? "",
      });

      const resumeUrl = `${resolvedBaseUrl}/payment/resume?token=${encodeURIComponent(resumeToken)}`;

      return NextResponse.json(
        {
          success: true,
          alreadyPaid: true,
          paymentOrderId: paymentOrder.id,
          gatewayOrderId: paymentOrder.gateway_order_id,
          participantId: participantPublicId,
          participant: {
            participantId: participantPublicId,
            name: payerName,
            email: payerEmail,
          },
          resumeToken,
          resumeUrl,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ─── Evaluate Order Age & Gateway Terminal State ───────────
    const rawDateStr = paymentOrder.updated_at || paymentOrder.created_at;
    const orderTimestamp = rawDateStr ? new Date(rawDateStr).getTime() : NaN;
    const hasValidDate = !Number.isNaN(orderTimestamp) && orderTimestamp > 0;
    const orderAgeMs = hasValidDate ? Date.now() - orderTimestamp : 0;
    const isLegitimatelyExpired = hasValidDate && orderAgeMs >= CHECKOUT_EXPIRATION_THRESHOLD_MS;

    // ─── Case B: Active Pending Payment in Progress on Gateway ───
    if (details.status === "pending") {
      const participantPublicId = payer.participant_id ?? "";
      const resumeToken = createPaymentResumeToken({
        paymentOrderId: paymentOrder.id,
        participantId: participantPublicId,
        payerParticipantUuid: paymentOrder.payer_participant_id ?? "",
      });
      const resumeUrl = `${resolvedBaseUrl}/payment/resume?token=${encodeURIComponent(resumeToken)}`;

      return errorResponse(
        "A payment attempt is currently being processed by the gateway. Please complete it on your payment app or wait a few moments before retrying.",
        409,
        "PAYMENT_PENDING",
        undefined,
        {
          paymentOrderId: paymentOrder.id,
          orderReference: paymentOrder.order_reference,
          amount: paymentOrder.amount,
          resumeToken,
          resumeUrl,
          activeCheckout: true,
        }
      );
    }

    // ─── Check for Authoritative Terminal Failure ─────────────────
    const rawLower = (details.rawStatus || "").toLowerCase().trim();
    const isTerminalFailure =
      details.status === "failed" &&
      (
        rawLower === "failure" ||
        rawLower === "failed" ||
        rawLower === "bounced" ||
        rawLower === "usercancelled" ||
        rawLower === "dropped" ||
        rawLower === "expired" ||
        rawLower === "auto_cancelled" ||
        rawLower === "timed_out" ||
        rawLower === "rejected" ||
        !rawLower
      );

    // Only abandoned draft checkouts (where PayU reports not_found and order age >= 60m)
    // or confirmed terminal failures are eligible for atomic retry.
    const isAbandonedDraft = details.status === "not_found" && isLegitimatelyExpired;

    if (!isTerminalFailure && !isAbandonedDraft) {
      // ─── Case D: Ambiguous / Unresolved Gateway Status (Not Found or Unknown) ──
      // PayU 'Not Found' within active window does not guarantee that no customer debit occurred.
      // Genuinely pending or unresolved attempts must not be superseded by elapsed time alone.
      console.warn(
        `Payment attempt ${paymentOrder.gateway_order_id} has ambiguous gateway status "${details.status}" (raw: "${details.rawStatus}"). Failing closed.`
      );

      const participantPublicId = payer.participant_id ?? "";
      const resumeToken = createPaymentResumeToken({
        paymentOrderId: paymentOrder.id,
        participantId: participantPublicId,
        payerParticipantUuid: paymentOrder.payer_participant_id ?? "",
      });
      const resumeUrl = `${resolvedBaseUrl}/payment/resume?token=${encodeURIComponent(resumeToken)}`;

      return errorResponse(
        "Payment status is currently ambiguous on the gateway (Not Found). Please wait a few moments before retrying or contact support if your account was debited.",
        409,
        "PAYMENT_STATUS_AMBIGUOUS",
        undefined,
        {
          paymentOrderId: paymentOrder.id,
          orderReference: paymentOrder.order_reference,
          amount: paymentOrder.amount,
          resumeToken,
          resumeUrl,
          activeCheckout: true,
        }
      );
    }

    // ─── Case C: Authoritatively Verified Terminal Failure OR Abandoned Draft ──
    // The previous txnid must NEVER be reused for PayU checkout.
    // Atomically transition via database RPC:
    // Locks participant events / accommodations and old order, checks concurrency,
    // marks old order 'failed', creates new 'pending' order, and copies order items atomically.
    console.log(
      `Payment attempt ${paymentOrder.gateway_order_id} eligible for atomic retry (` +
      (isAbandonedDraft
        ? `abandoned draft checkout: not_found and age ${Math.round(orderAgeMs / 60000)}m >= ${Math.round(CHECKOUT_EXPIRATION_THRESHOLD_MS / 60000)}m`
        : `terminal failure: "${details.status}"`) +
      `). Initiating atomic retry via RPC.`
    );

    const newOrderRef = `SVK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

    const { data: retryRpcResult, error: rpcError } = await supabaseAdmin
      .rpc("create_payment_retry_attempt", {
        p_payment_order_id: paymentOrder.id,
        p_new_order_reference: newOrderRef,
      });

    if (rpcError || !retryRpcResult || !retryRpcResult.new_order_id) {
      console.error("create_payment_retry_attempt RPC failed:", rpcError);
      const errorMsg = rpcError?.message || "";
      if (rpcError?.code === "40001" || errorMsg.includes("ACTIVE_ATTEMPT_EXISTS")) {
        return errorResponse(
          "A payment attempt is currently active. Please complete it or wait a moment before trying again.",
          409,
          "CONCURRENT_RETRY_CONFLICT"
        );
      }
      if (
        rpcError?.code === "23505" ||
        errorMsg.includes("ALREADY_PAID") ||
        errorMsg.includes("EVENT_ALREADY_PAID") ||
        errorMsg.includes("ACCOMMODATION_ALREADY_PAID")
      ) {
        return errorResponse(
          "This registration has already been paid.",
          400,
          "ALREADY_PAID"
        );
      }
      return errorResponse(
        "Could not initiate a retry payment order. Please try again.",
        500,
        "RETRY_RPC_FAILED"
      );
    }

    const newPaymentOrderId = retryRpcResult.new_order_id as string;
    const effectiveOrderReference = (retryRpcResult.order_reference as string) || newOrderRef;
    const effectiveAmount = Number(retryRpcResult.amount || paymentOrder.amount);
    const effectiveCurrency = (retryRpcResult.currency as string) || paymentOrder.currency || "INR";

    // Create fresh gateway order with unique transaction ID
    let newGatewayResult;
    try {
      newGatewayResult = await gateway.createOrder({
        orderReference: effectiveOrderReference,
        amountInSmallestUnit: Math.round(effectiveAmount * 100),
        currency: effectiveCurrency,
        payer: {
          name: payerName,
          email: payerEmail,
          phone: payerPhone,
        },
      });
    } catch (createErr) {
      console.error("Gateway order creation failed during retry:", createErr);
      // Mark the newly created pending order as failed so it never blocks future retries as an orphaned pending attempt
      await supabaseAdmin
        .from("payment_orders")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", newPaymentOrderId);

      return errorResponse(
        "Could not initialize checkout with payment gateway. Please try again.",
        500,
        "GATEWAY_ORDER_FAILED"
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("payment_orders")
      .update({
        gateway: gateway.name,
        gateway_order_id: newGatewayResult.gatewayOrderId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", newPaymentOrderId);

    if (updateError) {
      console.error("Failed to update new payment order with gateway info:", updateError);
      // Fail closed: mark the new order as failed so we don't leave an unrecorded gateway order
      await supabaseAdmin
        .from("payment_orders")
        .update({
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", newPaymentOrderId);

      return errorResponse(
        "Could not finalize payment session. Please try again.",
        500,
        "GATEWAY_RECORD_UPDATE_FAILED"
      );
    }

    const checkoutConfig = gateway.getCheckoutConfig({
      gatewayOrderId: newGatewayResult.gatewayOrderId,
      amount: Math.round(effectiveAmount * 100),
      currency: effectiveCurrency,
      payer: {
        name: payerName,
        email: payerEmail,
        phone: payerPhone,
      },
      orderReference: effectiveOrderReference,
      baseUrl: resolvedBaseUrl,
    });

    const participantPublicId = payer.participant_id ?? "";
    const newResumeToken = createPaymentResumeToken({
      paymentOrderId: newPaymentOrderId,
      participantId: participantPublicId,
      payerParticipantUuid: paymentOrder.payer_participant_id ?? "",
    });

    return NextResponse.json(
      {
        success: true,
        paymentOrderId: newPaymentOrderId,
        gatewayOrderId: newGatewayResult.gatewayOrderId,
        checkoutConfig,
        resumeToken: newResumeToken,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // ─── Create Gateway Order (First Attempt) ───────────────────

  const gateway = getPaymentGateway();

  let gatewayResult;

  try {
    gatewayResult = await gateway.createOrder({
      orderReference: paymentOrder.order_reference,
      amountInSmallestUnit: Number(paymentOrder.amount) * 100,
      currency: paymentOrder.currency ?? "INR",
      payer: {
        name: payerName,
        email: payerEmail,
        phone: payerPhone,
      },
    });
  } catch (err) {
    captureException(err, {
      route: "/api/payments/create",
      orderId: paymentOrder.id,
      extra: { paymentOrderId: paymentOrder.id },
    });
    console.error("Gateway order creation failed:", err);
    await supabaseAdmin
      .from("payment_orders")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentOrderId);

    return errorResponse(
      "Could not create payment order with the payment gateway.",
      500,
      "GATEWAY_ORDER_FAILED"
    );
  }

  // ─── Update Payment Order With Gateway Info ─────────────────

  const { error: updateError } = await supabaseAdmin
    .from("payment_orders")
    .update({
      status: "pending",
      gateway: gateway.name,
      gateway_order_id: gatewayResult.gatewayOrderId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentOrderId);

  if (updateError) {
    console.error("Failed to update payment order with gateway info:", updateError);
    await supabaseAdmin
      .from("payment_orders")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentOrderId);

    return errorResponse(
      "Could not record payment gateway information.",
      500,
      "GATEWAY_RECORD_UPDATE_FAILED"
    );
  }

  // ─── Build Checkout Config ─────────────────────────────────

  const checkoutConfig = gateway.getCheckoutConfig({
    gatewayOrderId: gatewayResult.gatewayOrderId,
    amount: Number(paymentOrder.amount) * 100,
    currency: paymentOrder.currency ?? "INR",
    payer: {
      name: payerName,
      email: payerEmail,
      phone: payerPhone,
    },
    orderReference: paymentOrder.order_reference,
    baseUrl: resolvedBaseUrl,
  });

  const participantPublicId = payer.participant_id ?? "";
  const checkoutResumeToken = createPaymentResumeToken({
    paymentOrderId: paymentOrder.id,
    participantId: participantPublicId,
    payerParticipantUuid: paymentOrder.payer_participant_id ?? "",
  });

  return NextResponse.json(
    {
      success: true,
      paymentOrderId: paymentOrder.id,
      gatewayOrderId: gatewayResult.gatewayOrderId,
      checkoutConfig,
      resumeToken: checkoutResumeToken,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
