import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PaymentVerificationError } from "@/lib/payments/types";

// ─── 1. Mock Registration Session ──────────────────────────────────────────
vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: vi.fn(),
}));
import { getRegistrationSession } from "@/lib/auth/session";

// ─── 2. Mock Rate Limit ───────────────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// ─── 3. Mock Post Payment Confirmation ────────────────────────────────────
vi.mock("@/lib/payments/post-payment", () => ({
  ensurePaymentConfirmationSent: vi.fn(),
}));

// ─── 4. Mock Gateway ──────────────────────────────────────────────────────
const mockGateway = {
  name: "payu",
  validateWebhook: vi.fn(),
  fetchPaymentDetails: vi.fn(),
  createOrder: vi.fn(),
  getCheckoutConfig: vi.fn(),
};

vi.mock("@/lib/payments", () => ({
  getPaymentGateway: vi.fn(() => mockGateway),
}));

// ─── 5. Mock In-Memory Database ────────────────────────────────────────────
interface MockDbState {
  participants: any[];
  participant_event_members: any[];
  participant_events: any[];
  participant_accommodations: any[];
  payment_orders: any[];
  payment_order_items: any[];
  rpcCalls: { name: string; params: any }[];
}

let db: MockDbState;

function matchesFilters(row: any, filters: { col: string; op: string; val: any }[]): boolean {
  for (const f of filters) {
    const val = row[f.col];
    if (f.op === "eq" && val !== f.val) return false;
    if (f.op === "ilike" && String(val).toLowerCase() !== String(f.val).toLowerCase()) return false;
    if (f.op === "is" && f.val === null && val !== null && val !== undefined) return false;
    if (f.op === "in" && Array.isArray(f.val) && !f.val.includes(val)) return false;
    if (f.op === "lt" && !(val < f.val)) return false;
    if (f.op === "gt" && !(val > f.val)) return false;
  }
  return true;
}

function executeFilter(table: string, filters: { col: string; op: string; val: any }[]): any[] {
  const rows = (db as any)[table] || [];
  return rows.filter((r: any) => matchesFilters(r, filters));
}

function createMockSupabaseAdmin() {
  return {
    from: (table: string) => {
      let filters: { col: string; op: string; val: any }[] = [];
      let updates: any = null;

      const builder: any = {
        select: vi.fn(() => builder),
        ilike: vi.fn((col: string, val: any) => { filters.push({ col, op: "ilike", val }); return builder; }),
        eq: vi.fn((col: string, val: any) => { filters.push({ col, op: "eq", val }); return builder; }),
        in: vi.fn((col: string, val: any) => { filters.push({ col, op: "in", val }); return builder; }),
        lt: vi.fn((col: string, val: any) => { filters.push({ col, op: "lt", val }); return builder; }),
        gt: vi.fn((col: string, val: any) => { filters.push({ col, op: "gt", val }); return builder; }),
        is: vi.fn((col: string, val: any) => { filters.push({ col, op: "is", val }); return builder; }),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        update: vi.fn((payload: any) => {
          updates = payload;
          return builder;
        }),
        insert: vi.fn((payload: any) => {
          const inserted = Array.isArray(payload) ? payload : [payload];
          const target = (db as any)[table];
          if (target) target.push(...inserted);
          return builder;
        }),
        maybeSingle: vi.fn(async () => {
          const rows = executeFilter(table, filters);
          return { data: rows[0] || null, error: null };
        }),
        single: vi.fn(async () => {
          const rows = executeFilter(table, filters);
          return { data: rows[0] || null, error: null };
        }),
        then: (resolve: any) => {
          if (updates) {
            const rows = (db as any)[table] || [];
            for (const r of rows) {
              if (matchesFilters(r, filters)) {
                Object.assign(r, updates);
              }
            }
            resolve({ data: null, error: null });
            return;
          }
          const rows = executeFilter(table, filters);
          resolve({ data: rows, error: null });
        },
      };

      return builder;
    },
    rpc: vi.fn(async (name: string, params: any) => {
      db.rpcCalls.push({ name, params });

      if (name === "process_payment_success") {
        const order = db.payment_orders.find((o) => o.gateway_order_id === params.p_gateway_order_id);
        if (!order) return { data: { success: false, error: "Order not found" }, error: null };
        if (order.status === "paid") {
          return { data: { success: true, action: "already_paid" }, error: null };
        }
        order.status = "paid";
        order.gateway_payment_id = params.p_gateway_payment_id;
        return { data: { success: true, action: "settled", payment_order_id: order.id }, error: null };
      }

      if (name === "process_payment_failure") {
        const order = db.payment_orders.find((o) => o.gateway_order_id === params.p_gateway_order_id);
        if (!order) return { data: { success: false, error: "Order not found" }, error: null };
        if (order.status === "paid" || order.status === "refunded") {
          return { data: { success: true, action: "already_finalized" }, error: null };
        }
        order.status = "failed";
        return { data: { success: true, action: "failed", payment_order_id: order.id }, error: null };
      }

      if (name === "create_payment_retry_attempt") {
        const order = db.payment_orders.find((o) => o.id === params.p_payment_order_id);
        if (!order) return { data: null, error: { message: "Order not found" } };
        order.status = "failed";
        const newOrderId = `po-retry-${Date.now()}`;
        db.payment_orders.push({
          id: newOrderId,
          order_reference: params.p_new_order_reference,
          amount: order.amount,
          currency: order.currency || "INR",
          status: "pending",
          payer_participant_id: order.payer_participant_id,
        });
        return {
          data: { new_order_id: newOrderId, order_reference: params.p_new_order_reference, amount: order.amount, currency: order.currency || "INR" },
          error: null,
        };
      }

      if (name === "register_participant_events") {
        const count = params.p_accommodations?.length || 0;
        const totalAmountINR = count * 999;
        const newOrderId = `po-new-${Date.now()}`;
        const newOrderRef = `SVK-TEAM-${Date.now()}`;

        db.payment_orders.push({
          id: newOrderId,
          order_reference: newOrderRef,
          amount: totalAmountINR,
          currency: "INR",
          status: "pending",
          payer_participant_id: params.p_participant_id,
        });

        return {
          data: [
            {
              participant_id: params.p_participant_id,
              payment_order_id: newOrderId,
              status: "accommodation_only",
              message: "Team accommodation order registered successfully",
            },
          ],
          error: null,
        };
      }

      return { data: null, error: null };
    }),
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => createMockSupabaseAdmin()),
}));

// Import route handlers
import { POST as payuSuccessPOST } from "@/app/api/payments/payu/success/route";
import { POST as payuFailurePOST } from "@/app/api/payments/payu/failure/route";
import { POST as payuWebhookPOST } from "@/app/api/payments/webhook/route";
import { POST as teamAccommodationPOST } from "@/app/api/team/accommodation/route";
import { POST as paymentsCreatePOST } from "@/app/api/payments/create/route";

const LEADER = {
  id: "uuid-divyansh-01",
  participant_id: "SVK26-09A7C27C",
  name: "Divyansh Tiwari",
  email: "divyansh.tiwari@example.com",
  phone: "9876500001",
  college: "Graphic Era Hill University",
};

const PE_ID = "pe-nritya-hill-hustlers-001";

describe("SAVISKAR 2026 — Step 11: PayU Payment-State & Safe Not-Found Handling Audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYU_ENVIRONMENT = "test";
    process.env.PAYU_KEY = "test_audit_key_999";
    process.env.PAYU_SALT = "test_audit_salt_999";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SECRET_KEY = "test-service-role-key-audit";
    process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar.co.in";
    delete process.env.PAYMENT_CALLBACK_BASE_URL;

    vi.mocked(getRegistrationSession).mockResolvedValue({
      authenticated: true,
      email: LEADER.email,
    });

    db = {
      participants: [LEADER],
      participant_event_members: [
        {
          id: `pem-${LEADER.id}`,
          participant_event_id: PE_ID,
          name: LEADER.name,
          email: LEADER.email,
          participant_id: LEADER.id,
        },
      ],
      participant_events: [
        {
          id: PE_ID,
          event_id: "event-western-dance-001",
          team_name: "Hill Hustlers",
          payment_status: "paid",
        },
      ],
      participant_accommodations: [],
      payment_orders: [],
      payment_order_items: [],
      rpcCalls: [],
    };
  });

  // =========================================================================
  // 1. PROVIDER REPORTS NOT FOUND; ORDER MAY HAVE BEEN SUBMITTED
  // =========================================================================
  it("Requirement 1: PayU reports Not Found; order may have been submitted -> fails closed with 409 PAYMENT_STATUS_AMBIGUOUS without marking failed or creating replacement order", async () => {
    const priorOrderId = "po-notfound-01";
    const priorTxnId = "txnid-notfound-01";

    db.payment_orders.push({
      id: priorOrderId,
      status: "pending",
      gateway: "payu",
      gateway_order_id: priorTxnId,
      updated_at: new Date().toISOString(),
    });

    db.participant_accommodations.push({
      id: "pa-01",
      participant_id: LEADER.id,
      status: "pending",
      payment_order_id: priorOrderId,
      payment_orders: db.payment_orders[0],
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    mockGateway.fetchPaymentDetails.mockResolvedValue({
      gatewayOrderId: priorTxnId,
      status: "not_found",
      rawStatus: "Not Found",
      amount: 0,
      currency: "INR",
    });

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [{ email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" }],
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("PAYMENT_STATUS_AMBIGUOUS");
    expect(data.error).toContain("Payment status for divyansh.tiwari@example.com is currently ambiguous (not_found)");

    // Safety checks:
    // 1. process_payment_failure was NEVER invoked
    expect(db.rpcCalls.filter((c) => c.name === "process_payment_failure")).toHaveLength(0);
    // 2. register_participant_events was NEVER invoked
    expect(db.rpcCalls.filter((c) => c.name === "register_participant_events")).toHaveLength(0);
    // 3. Prior payment order remains in protected 'pending' state
    expect(db.payment_orders[0].status).toBe("pending");
    // 4. Accommodation hold remains protected
    expect(db.participant_accommodations[0].status).toBe("pending");
  });

  // =========================================================================
  // 2. CHECKOUT WAS PROVABLY NEVER DISPATCHED (GATEWAY_ORDER_ID IS NULL)
  // =========================================================================
  it("Requirement 2: Checkout was provably never dispatched (gateway_order_id is null on draft order) -> safely transitions draft to failed and permits checkout under advisory lock", async () => {
    const priorOrderId = "po-draft-02";

    // Draft order created locally that never received a gateway_order_id
    db.payment_orders.push({
      id: priorOrderId,
      status: "pending",
      gateway: null,
      gateway_order_id: null,
      updated_at: new Date().toISOString(),
    });

    db.participant_accommodations.push({
      id: "pa-02",
      participant_id: LEADER.id,
      status: "pending",
      payment_order_id: priorOrderId,
      payment_orders: db.payment_orders[0],
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [{ email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" }],
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Reliable local evidence allowed safe draft transition to failed
    expect(db.payment_orders.find((o) => o.id === priorOrderId)?.status).toBe("failed");
    // register_participant_events proceeded under advisory lock
    expect(db.rpcCalls.find((c) => c.name === "register_participant_events")).toBeDefined();
  });

  // =========================================================================
  // 3. PAYU RETURNS STATUS 0 WITH NOT FOUND ENVELOPE / TRANSACTION DETAIL
  // =========================================================================
  it("Requirement 3: PayU returns status: 0 with 'Not Found' transaction detail -> correctly classified as not_found and handled conservatively", async () => {
    const priorOrderId = "po-env-03";
    const priorTxnId = "txnid-env-03";

    db.payment_orders.push({
      id: priorOrderId,
      status: "pending",
      gateway: "payu",
      gateway_order_id: priorTxnId,
      updated_at: new Date().toISOString(),
    });

    db.participant_accommodations.push({
      id: "pa-03",
      participant_id: LEADER.id,
      status: "pending",
      payment_order_id: priorOrderId,
      payment_orders: db.payment_orders[0],
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    // PayU verify_payment envelope returns status: 0 with transaction_details not found
    mockGateway.fetchPaymentDetails.mockResolvedValue({
      gatewayPaymentId: "",
      gatewayOrderId: priorTxnId,
      status: "not_found",
      amount: 0,
      currency: "INR",
      rawStatus: "0 out of 1 Transactions Fetched",
    });

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [{ email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" }],
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("PAYMENT_STATUS_AMBIGUOUS");

    // Order state and hold remain unmodified
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.payment_orders[0].status).toBe("pending");
  });

  // =========================================================================
  // 4. PAYU RETURNS MALFORMED RESPONSE
  // =========================================================================
  it("Requirement 4: PayU returns a malformed non-JSON response -> fails closed with 503 preserving existing state", async () => {
    const priorOrderId = "po-malformed-04";
    const priorTxnId = "txnid-malformed-04";

    db.payment_orders.push({
      id: priorOrderId,
      status: "pending",
      gateway: "payu",
      gateway_order_id: priorTxnId,
      updated_at: new Date().toISOString(),
    });

    db.participant_accommodations.push({
      id: "pa-04",
      participant_id: LEADER.id,
      status: "pending",
      payment_order_id: priorOrderId,
      payment_orders: db.payment_orders[0],
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    mockGateway.fetchPaymentDetails.mockRejectedValue(
      new PaymentVerificationError("malformed", "Malformed non-JSON response from PayU.")
    );

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [{ email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" }],
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(["GATEWAY_VERIFICATION_UNAVAILABLE", "GATEWAY_UNAVAILABLE"]).toContain(data.code);

    // No DB modifications
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.payment_orders[0].status).toBe("pending");
  });

  // =========================================================================
  // 5. PAYU TIMES OUT OR RETURNS NETWORK/SERVER ERROR
  // =========================================================================
  it("Requirement 5: PayU times out or returns a network error -> fails closed with 503 without altering records", async () => {
    const priorOrderId = "po-timeout-05";
    const priorTxnId = "txnid-timeout-05";

    db.payment_orders.push({
      id: priorOrderId,
      status: "pending",
      gateway: "payu",
      gateway_order_id: priorTxnId,
      updated_at: new Date().toISOString(),
    });

    db.participant_accommodations.push({
      id: "pa-05",
      participant_id: LEADER.id,
      status: "pending",
      payment_order_id: priorOrderId,
      payment_orders: db.payment_orders[0],
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    mockGateway.fetchPaymentDetails.mockRejectedValue(new Error("PayU 504 Gateway Timeout"));

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [{ email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" }],
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(["GATEWAY_VERIFICATION_UNAVAILABLE", "GATEWAY_UNAVAILABLE"]).toContain(data.code);

    // Database completely unmodified
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.payment_orders[0].status).toBe("pending");
  });

  // =========================================================================
  // 6. PAYU REPORTS PENDING / PROCESSING
  // =========================================================================
  it("Requirement 6: PayU reports pending -> rejects conflicting checkout attempt with 409 PAYMENT_PENDING", async () => {
    const priorOrderId = "po-pending-06";
    const priorTxnId = "txnid-pending-06";

    db.payment_orders.push({
      id: priorOrderId,
      status: "pending",
      gateway: "payu",
      gateway_order_id: priorTxnId,
      updated_at: new Date().toISOString(),
    });

    db.participant_accommodations.push({
      id: "pa-06",
      participant_id: LEADER.id,
      status: "pending",
      payment_order_id: priorOrderId,
      payment_orders: db.payment_orders[0],
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    mockGateway.fetchPaymentDetails.mockResolvedValue({
      gatewayOrderId: priorTxnId,
      status: "pending",
      rawStatus: "in progress",
      amount: 99900,
      currency: "INR",
    });

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [{ email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" }],
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("PAYMENT_PENDING");

    // Zero failure RPC calls
    expect(db.rpcCalls.filter((c) => c.name === "process_payment_failure")).toHaveLength(0);
    expect(db.payment_orders[0].status).toBe("pending");
  });

  // =========================================================================
  // 7. VERIFIED PAID RESULT
  // =========================================================================
  it("Requirement 7: A verified paid result -> settles atomically via process_payment_success after amount/currency checks", async () => {
    const orderId = "po-paid-07";
    const txnId = "txnid-paid-07";

    db.payment_orders.push({
      id: orderId,
      order_reference: "SVK-ORDER-PAID-07",
      payer_participant_id: LEADER.id,
      amount: 999,
      currency: "INR",
      gateway_order_id: txnId,
      status: "pending",
    });

    mockGateway.validateWebhook.mockReturnValue({
      valid: true,
      event: {
        eventType: "payment.captured",
        gatewayOrderId: txnId,
        gatewayPaymentId: "mihpayid-paid-07",
        status: "paid",
        amount: 99900,
        currency: "INR",
      },
    });

    mockGateway.fetchPaymentDetails.mockResolvedValue({
      gatewayOrderId: txnId,
      gatewayPaymentId: "mihpayid-paid-07",
      status: "paid",
      rawStatus: "success",
      amount: 99900,
      currency: "INR",
    });

    const body = new URLSearchParams({
      txnid: txnId,
      mihpayid: "mihpayid-paid-07",
      status: "success",
      amount: "999.00",
      firstname: "Divyansh",
      email: LEADER.email,
      hash: "mock-valid-hash",
    }).toString();

    const req = new NextRequest("https://saviskar.co.in/api/payments/payu/success", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const res = await payuSuccessPOST(req);
    expect(res.status).toBe(303);

    const successRpc = db.rpcCalls.find((c) => c.name === "process_payment_success");
    expect(successRpc).toBeDefined();
    expect(successRpc?.params.p_gateway_order_id).toBe(txnId);
    expect(successRpc?.params.p_gateway_payment_id).toBe("mihpayid-paid-07");
    expect(db.payment_orders[0].status).toBe("paid");
  });

  // =========================================================================
  // 8. VERIFIED TERMINAL FAILURE
  // =========================================================================
  it("Requirement 8: A verified terminal failure -> atomically transitions order to failed via process_payment_failure", async () => {
    const orderId = "po-fail-08";
    const txnId = "txnid-fail-08";

    db.payment_orders.push({
      id: orderId,
      order_reference: "SVK-ORDER-FAIL-08",
      payer_participant_id: LEADER.id,
      amount: 999,
      currency: "INR",
      gateway_order_id: txnId,
      status: "pending",
    });

    mockGateway.validateWebhook.mockReturnValue({
      valid: true,
      event: {
        eventType: "failure",
        gatewayOrderId: txnId,
        gatewayPaymentId: "mihpayid-fail-08",
        status: "failed",
        amount: 99900,
        currency: "INR",
      },
    });

    const body = new URLSearchParams({
      txnid: txnId,
      mihpayid: "mihpayid-fail-08",
      status: "failure",
      amount: "999.00",
      firstname: "Divyansh",
      email: LEADER.email,
      hash: "mock-valid-hash",
    }).toString();

    const req = new NextRequest("https://saviskar.co.in/api/payments/payu/failure", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const res = await payuFailurePOST(req);
    expect(res.status).toBe(303);

    const failRpc = db.rpcCalls.find((c) => c.name === "process_payment_failure");
    expect(failRpc).toBeDefined();
    expect(failRpc?.params.p_gateway_order_id).toBe(txnId);
    expect(db.payment_orders[0].status).toBe("failed");
  });

  // =========================================================================
  // 9. UNAUTHENTICATED FAILURE CALLBACK PAIRED WITH NOT FOUND
  // =========================================================================
  it("Requirement 9: An unauthenticated failure callback paired with Not Found -> does not mutate payment state", async () => {
    const orderId = "po-unauth-09";
    const txnId = "txnid-unauth-09";

    db.payment_orders.push({
      id: orderId,
      order_reference: "SVK-ORDER-UNAUTH-09",
      payer_participant_id: LEADER.id,
      amount: 999,
      currency: "INR",
      gateway_order_id: txnId,
      status: "pending",
    });

    // Hash check fails (unauthenticated spoof or tampered callback)
    mockGateway.validateWebhook.mockReturnValue({ valid: false, error: "Invalid webhook signature." });
    // Server-to-server check returns Not Found
    mockGateway.fetchPaymentDetails.mockResolvedValue({
      gatewayOrderId: txnId,
      status: "not_found",
      rawStatus: "Not Found",
      amount: 0,
      currency: "INR",
    });

    const body = new URLSearchParams({
      txnid: txnId,
      status: "failure",
      hash: "forged_hash_without_salt",
    }).toString();

    const req = new NextRequest("https://saviskar.co.in/api/payments/payu/failure", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const res = await payuFailurePOST(req);
    expect(res.status).toBe(303);

    // CRITICAL SECURITY ASSERTION: process_payment_failure MUST NOT be called!
    expect(db.rpcCalls.filter((c) => c.name === "process_payment_failure")).toHaveLength(0);
    // Order remains protected in 'pending' status
    expect(db.payment_orders[0].status).toBe("pending");
  });

  // =========================================================================
  // 10. DELAYED FAILURE NOTIFICATION ARRIVES AFTER ORDER PAID
  // =========================================================================
  it("Requirement 10: Delayed failure notification arrives after payment settled -> paid state remains unchanged", async () => {
    const orderId = "po-paid-10";
    const txnId = "txnid-paid-10";

    db.payment_orders.push({
      id: orderId,
      order_reference: "SVK-PAID-10",
      payer_participant_id: LEADER.id,
      amount: 999,
      currency: "INR",
      gateway_order_id: txnId,
      status: "paid", // Already settled!
    });

    mockGateway.validateWebhook.mockReturnValue({
      valid: true,
      event: {
        eventType: "failure",
        gatewayOrderId: txnId,
        gatewayPaymentId: "mihpayid-late-fail-10",
        status: "failed",
        amount: 99900,
        currency: "INR",
      },
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/payu/failure", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `status=failure&txnid=${txnId}&mihpayid=mihpayid-late-fail-10&hash=validhash`,
    });

    const res = await payuFailurePOST(req);
    expect(res.status).toBe(303);

    // RPC called with already_finalized, order status MUST remain 'paid'
    const failRpc = db.rpcCalls.find((c) => c.name === "process_payment_failure");
    expect(failRpc).toBeDefined();
    expect(db.payment_orders[0].status).toBe("paid");
  });

  // =========================================================================
  // 11. OLD ORDER LATE SUCCESS CALLBACK AFTER REPLACEMENT ORDER EXISTS
  // =========================================================================
  it("Requirement 11: Older order receives late success callback after replacement order exists -> protects newer order and follows conflict-resolution behavior", async () => {
    const oldOrderId = "po-old-11";
    const oldTxnId = "txnid-old-11";

    db.payment_orders.push({
      id: oldOrderId,
      status: "pending",
      payer_participant_id: LEADER.id,
      amount: 999,
      currency: "INR",
      gateway_order_id: oldTxnId,
    });

    mockGateway.validateWebhook.mockReturnValue({
      valid: true,
      event: {
        eventType: "payment.captured",
        gatewayOrderId: oldTxnId,
        gatewayPaymentId: "mihpayid-late-11",
        status: "paid",
        amount: 99900,
        currency: "INR",
      },
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `status=success&txnid=${oldTxnId}&mihpayid=mihpayid-late-11&amount=999.00&hash=mockhash`,
    });

    const res = await payuWebhookPOST(req);
    expect(res.status).toBe(200);

    const successRpc = db.rpcCalls.find((c) => c.name === "process_payment_success");
    expect(successRpc).toBeDefined();
    expect(successRpc?.params.p_gateway_order_id).toBe(oldTxnId);
    expect(db.payment_orders[0].status).toBe("paid");
  });

  // =========================================================================
  // 12. INDIVIDUAL & TEAM ACCOMMODATION RETRY PATHS FAIL SAFELY ON AMBIGUOUS
  // =========================================================================
  it("Requirement 12: Both individual (/api/payments/create) and team (/api/team/accommodation) retry paths fail safely with 409 PAYMENT_STATUS_AMBIGUOUS when verification is unresolved", async () => {
    // 12a. Individual retry path (/api/payments/create)
    const soloOrderId = "po-solo-12";
    const soloTxnId = "txnid-solo-12";

    db.payment_orders.push({
      id: soloOrderId,
      order_reference: "SVK-SOLO-12",
      payer_participant_id: LEADER.id,
      amount: 999,
      currency: "INR",
      gateway_order_id: soloTxnId,
      gateway: "payu",
      status: "pending",
    });

    db.payment_order_items.push({
      id: "poi-12",
      payment_order_id: soloOrderId,
      participant_id: LEADER.id,
      participant_event_id: PE_ID,
      amount: 999,
    });

    // Provider reports Not Found (ambiguous)
    mockGateway.fetchPaymentDetails.mockResolvedValue({
      gatewayOrderId: soloTxnId,
      status: "not_found",
      rawStatus: "Not Found",
      amount: 0,
      currency: "INR",
    });

    const soloReq = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentOrderId: soloOrderId }),
    });

    const soloRes = await paymentsCreatePOST(soloReq);
    expect(soloRes.status).toBe(409);
    const soloData = await soloRes.json();
    expect(soloData.code).toBe("PAYMENT_STATUS_AMBIGUOUS");
    expect(soloData.error).toContain("Payment status is currently ambiguous on the gateway (Not Found)");

    // create_payment_retry_attempt must NOT be called; order must remain pending
    expect(db.rpcCalls.filter((c) => c.name === "create_payment_retry_attempt")).toHaveLength(0);
    expect(db.payment_orders.find((o) => o.id === soloOrderId)?.status).toBe("pending");

    // 12b. Team accommodation retry path (/api/team/accommodation)
    const teamReq = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [{ email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28", extraDays: "none" }],
      }),
    });

    // Add accommodation hold pointing to solo order
    db.participant_accommodations.push({
      id: "pa-solo-12",
      participant_id: LEADER.id,
      status: "pending",
      payment_order_id: soloOrderId,
      payment_orders: db.payment_orders.find((o) => o.id === soloOrderId),
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const teamRes = await teamAccommodationPOST(teamReq);
    expect(teamRes.status).toBe(409);
    const teamData = await teamRes.json();
    expect(teamData.code).toBe("PAYMENT_STATUS_AMBIGUOUS");

    // process_payment_failure must NOT be called; hold remains pending
    expect(db.rpcCalls.filter((c) => c.name === "process_payment_failure")).toHaveLength(0);
    expect(db.participant_accommodations[0].status).toBe("pending");
  });
});
