/**
 * __tests__/payments/payment-recovery-accommodation.test.ts
 *
 * Dedicated regression tests for payment recovery and accommodation settlement:
 * 1. Successful captured-payment recovery settles eligible accommodation records.
 * 2. Repeated recovery attempts do not produce duplicate or inconsistent state (Idempotency).
 * 3. Cancelled accommodation records remain cancelled (never reactivated).
 * 4. Unpaid or failed payment orders do not mark accommodations as paid.
 * 5. Unrelated accommodation records are never updated.
 * 6. Atomic process_payment_success RPC invocation with canonical parameters.
 * 7. Combined event + accommodation orders settle both line items.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/payments/create/route";
import { NextRequest } from "next/server";

// In-memory mock database state
interface MockOrder {
  id: string;
  order_reference: string;
  payer_participant_id: string;
  amount: number;
  currency: string;
  gateway: string;
  gateway_order_id: string | null;
  gateway_payment_id?: string | null;
  status: string;
}

interface MockOrderItem {
  id: string;
  payment_order_id: string;
  participant_id: string;
  participant_event_id?: string | null;
  participant_accommodation_id?: string | null;
  amount: number;
}

interface MockAccommodation {
  id: string;
  participant_id: string;
  status: string;
  amount: number;
  payment_order_id: string | null;
  start_date: string;
  end_date: string;
}

interface MockEvent {
  id: string;
  payment_status: string;
  payment_id?: string | null;
}

let dbOrders: MockOrder[] = [];
let dbOrderItems: MockOrderItem[] = [];
let dbAccommodations: MockAccommodation[] = [];
let dbEvents: MockEvent[] = [];
let dbPayments: Array<Record<string, unknown>> = [];
let dbProcessedEvents: Array<Record<string, unknown>> = [];
let dbRpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
let emailSentOrderIds: string[] = [];

// Gateway response controls
let mockGatewayStatus = "paid";
let mockGatewayPaymentId = "payu_captured_999";
let mockGatewayAmountPaise = 99900;
let mockRpcBehavior:
  | "success"
  | "reject"
  | "error"
  | "unsupported"
  | "timeout_settled"
  | "timeout_unsettled"
  | "timeout_mismatched_payment_id"
  | "timeout_mismatched_order_id"
  | "already_processed"
  | "already_refunded"
  | "missing_action"
  | "unknown_action" = "success";

function makeChain(resolveVal: () => Promise<{ data: unknown; error: unknown }>): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    then: (onF: any) => resolveVal().then(onF),
    catch: () => chain,
    finally: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    is: () => chain,
    limit: () => chain,
    order: () => chain,
    update: () => chain,
    insert: () => chain,
    single: () => resolveVal().then((r) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })),
    maybeSingle: () => resolveVal().then((r) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })),
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (name: string, params: Record<string, unknown>) => {
      dbRpcCalls.push({ name, params });

      if (name === "process_payment_success") {
        if (mockRpcBehavior === "unsupported") {
          return Promise.resolve({
            data: null,
            error: { code: "PGRST202", message: "function process_payment_success does not exist" },
          });
        }
        if (mockRpcBehavior === "error") {
          return Promise.resolve({
            data: null,
            error: { code: "50000", message: "Database connection failed unexpectedly" },
          });
        }
        if (mockRpcBehavior === "timeout_unsettled") {
          return Promise.resolve({
            data: null,
            error: { code: "57014", message: "canceling statement due to statement timeout" },
          });
        }
        if (mockRpcBehavior === "reject") {
          return Promise.resolve({
            data: { success: false, error: "Amount mismatch: order amount does not match gateway captured amount" },
            error: null,
          });
        }
        if (mockRpcBehavior === "already_processed") {
          return Promise.resolve({
            data: { success: true, action: "already_processed" },
            error: null,
          });
        }
        if (mockRpcBehavior === "already_refunded") {
          return Promise.resolve({
            data: { success: true, action: "already_refunded" },
            error: null,
          });
        }
        if (mockRpcBehavior === "missing_action") {
          return Promise.resolve({
            data: { success: true },
            error: null,
          });
        }
        if (mockRpcBehavior === "unknown_action") {
          return Promise.resolve({
            data: { success: true, action: "unrecognized_state" },
            error: null,
          });
        }

        // Simulate atomic process_payment_success behavior
        const order = dbOrders.find((o) => o.gateway_order_id === params.p_gateway_order_id);
        if (!order) {
          return Promise.resolve({ data: { success: false, error: "Order not found" }, error: null });
        }

        if (order.status === "paid") {
          return Promise.resolve({ data: { success: true, action: "already_paid" }, error: null });
        }

        // Idempotency token
        const existingClaim = dbProcessedEvents.find(
          (e) => e.payment_id === params.p_gateway_payment_id && e.event_type === "payment.captured"
        );
        if (existingClaim) {
          return Promise.resolve({ data: { success: true, action: "already_processed" }, error: null });
        }
        dbProcessedEvents.push({
          order_id: order.id,
          payment_id: params.p_gateway_payment_id,
          event_type: "payment.captured",
        });

        // Update payment_orders
        order.status = "paid";
        order.gateway_payment_id = params.p_gateway_payment_id as string;

        // Update linked events
        const items = dbOrderItems.filter((i) => i.payment_order_id === order.id);
        for (const item of items) {
          if (item.participant_event_id) {
            const ev = dbEvents.find((e) => e.id === item.participant_event_id);
            if (ev) {
              ev.payment_status = "paid";
              ev.payment_id = params.p_gateway_payment_id as string;
            }
          }
          if (item.participant_accommodation_id) {
            const acc = dbAccommodations.find((a) => a.id === item.participant_accommodation_id);
            // Stays only activate if not cancelled
            if (acc && acc.status !== "cancelled") {
              acc.status = "paid";
              acc.payment_order_id = order.id;
            }
          }
        }

        // Insert payment receipt
        dbPayments.push({
          participant_id: order.payer_participant_id,
          amount: order.amount,
          status: "paid",
          gateway: params.p_gateway_name,
          gateway_payment_id: params.p_gateway_payment_id,
          gateway_order_id: params.p_gateway_order_id,
        });

        if (mockRpcBehavior === "timeout_settled") {
          return Promise.resolve({
            data: null,
            error: { code: "57014", message: "canceling statement due to statement timeout" },
          });
        }

        if (mockRpcBehavior === "timeout_mismatched_payment_id") {
          order.gateway_payment_id = "diff_gateway_payment_id_999";
          return Promise.resolve({
            data: null,
            error: { code: "57014", message: "canceling statement due to statement timeout" },
          });
        }

        if (mockRpcBehavior === "timeout_mismatched_order_id") {
          order.gateway_order_id = "diff_txnid_999";
          return Promise.resolve({
            data: null,
            error: { code: "57014", message: "canceling statement due to statement timeout" },
          });
        }

        return Promise.resolve({ data: { success: true, action: "settled" }, error: null });
      }

      return Promise.resolve({ data: null, error: null });
    },

    from: (table: string) => {
      if (table === "payment_orders") {
        return {
          select: () =>
            makeChain(() =>
              Promise.resolve({
                data: dbOrders[0] ? { ...dbOrders[0] } : null,
                error: null,
              })
            ),
          update: (fields: Partial<MockOrder>) => {
            if (dbOrders[0]) {
              Object.assign(dbOrders[0], fields);
            }
            return makeChain(() => Promise.resolve({ data: dbOrders[0], error: null }));
          },
        };
      }

      if (table === "payment_order_items") {
        return {
          select: () =>
            makeChain(() =>
              Promise.resolve({
                data: dbOrderItems,
                error: null,
              })
            ),
        };
      }

      if (table === "participants") {
        return {
          select: () =>
            makeChain(() =>
              Promise.resolve({
                data: {
                  id: "part-uuid-001",
                  participant_id: "SVK26-ABC12345",
                  name: "Test Participant",
                  email: "test@example.com",
                  phone: "+919876543210",
                },
                error: null,
              })
            ),
        };
      }

      if (table === "participant_events") {
        return {
          update: (fields: Partial<MockEvent>) => {
            return {
              in: (_col: string, ids: string[]) => {
                dbEvents
                  .filter((e) => ids.includes(e.id))
                  .forEach((e) => Object.assign(e, fields));
                return makeChain(() => Promise.resolve({ data: dbEvents, error: null }));
              },
            };
          },
        };
      }

      if (table === "participant_accommodations") {
        return {
          update: (fields: Partial<MockAccommodation>) => {
            return {
              in: (_col: string, ids: string[]) => {
                return {
                  eq: (statusCol: string, statusVal: string) => {
                    dbAccommodations
                      .filter((a) => ids.includes(a.id) && (a as any)[statusCol] === statusVal)
                      .forEach((a) => Object.assign(a, fields));
                    return makeChain(() => Promise.resolve({ data: dbAccommodations, error: null }));
                  },
                };
              },
              eq: (col1: string, val1: string) => {
                return {
                  eq: (col2: string, val2: string) => {
                    dbAccommodations
                      .filter((a) => (a as any)[col1] === val1 && (a as any)[col2] === val2)
                      .forEach((a) => Object.assign(a, fields));
                    return makeChain(() => Promise.resolve({ data: dbAccommodations, error: null }));
                  },
                };
              },
            };
          },
        };
      }

      if (table === "processed_payment_events") {
        return {
          insert: (entry: Record<string, unknown>) => {
            const isDup = dbProcessedEvents.some((e) => e.payment_id === entry.payment_id);
            if (isDup) {
              return makeChain(() => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } }));
            }
            dbProcessedEvents.push(entry);
            return makeChain(() => Promise.resolve({ data: { id: "claim-id" }, error: null }));
          },
        };
      }

      if (table === "payments") {
        return {
          insert: (entry: Record<string, unknown>) => {
            dbPayments.push(entry);
            return makeChain(() => Promise.resolve({ data: entry, error: null }));
          },
        };
      }

      return makeChain(() => Promise.resolve({ data: null, error: null }));
    },
  }),
}));

vi.mock("@/lib/payments/post-payment", () => ({
  ensurePaymentConfirmationSent: (orderId: string) => {
    emailSentOrderIds.push(orderId);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: () =>
    Promise.resolve({ authenticated: true, email: "test@example.com" }),
}));

vi.mock("@/lib/payments", () => ({
  getPaymentGateway: () => ({
    name: "payu",
    fetchPaymentDetails: () =>
      Promise.resolve({
        status: mockGatewayStatus,
        gatewayPaymentId: mockGatewayPaymentId,
        gatewayOrderId: "txnid-acc-101",
        amount: mockGatewayAmountPaise,
        currency: "INR",
      }),
  }),
}));

describe("SAVISKAR 2026 — Payment Recovery & Accommodation Settlement Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbOrders = [];
    dbOrderItems = [];
    dbAccommodations = [];
    dbEvents = [];
    dbPayments = [];
    dbProcessedEvents = [];
    dbRpcCalls = [];
    emailSentOrderIds = [];

    mockGatewayStatus = "paid";
    mockGatewayPaymentId = "payu_captured_999";
    mockGatewayAmountPaise = 99900;
    mockRpcBehavior = "success";

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SECRET_KEY = "test-secret-key";
    process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar.co.in";
  });

  it("1. Successfully settles eligible accommodation records when payment was captured on gateway", async () => {
    // Setup Order
    const poId = "po-acc-001";
    const accId = "acc-stay-001";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-ACC-001",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-001",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.alreadyPaid).toBe(true);

    // Verify order became paid
    expect(dbOrders[0].status).toBe("paid");
    expect(dbOrders[0].gateway_payment_id).toBe("payu_captured_999");

    // Verify accommodation became paid
    expect(dbAccommodations[0].status).toBe("paid");

    // Verify confirmation email sent
    expect(emailSentOrderIds).toContain(poId);
  });

  it("2. Repeated recovery calls are idempotent and do not duplicate payments or emails", async () => {
    const poId = "po-acc-002";
    const accId = "acc-stay-002";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-ACC-002",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-002",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req1 = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    expect(emailSentOrderIds).toHaveLength(1);
    expect(dbPayments).toHaveLength(1);

    // Second call: duplicate recovery
    const req2 = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });
    const res2 = await POST(req2);
    const data2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(data2.alreadyPaid).toBe(true);

    // No duplicate email or payment record
    expect(emailSentOrderIds).toHaveLength(1);
    expect(dbPayments).toHaveLength(1);
    expect(dbAccommodations[0].status).toBe("paid");
  });

  it("3. Cancelled accommodation records remain cancelled (never reactivated by recovery)", async () => {
    const poId = "po-acc-003";
    const accId = "acc-stay-cancelled";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-ACC-003",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-003",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    // Accommodation was explicitly cancelled earlier by admin
    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "cancelled",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Accommodation MUST remain cancelled
    expect(dbAccommodations[0].status).toBe("cancelled");
  });

  it("4. Unpaid or failed payment orders do not mark accommodations as paid", async () => {
    const poId = "po-acc-004";
    const accId = "acc-stay-unpaid";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-ACC-004",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-004",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    // Gateway reports pending / in progress
    mockGatewayStatus = "pending";

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409); // PAYMENT_PENDING

    // Stays must remain pending
    expect(dbAccommodations[0].status).toBe("pending");
    expect(dbOrders[0].status).toBe("pending");
  });

  it("5. Unrelated accommodation records are never updated by recovery", async () => {
    const poId = "po-acc-005";
    const targetAccId = "acc-target-stay";
    const unrelatedAccId = "acc-unrelated-stay";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-ACC-005",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-005",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: targetAccId,
      amount: 999,
    });

    dbAccommodations.push(
      {
        id: targetAccId,
        participant_id: "part-uuid-001",
        status: "pending",
        amount: 999,
        payment_order_id: poId,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
      },
      {
        id: unrelatedAccId,
        participant_id: "part-uuid-999", // Unrelated participant
        status: "pending",
        amount: 499,
        payment_order_id: "po-unrelated-999",
        start_date: "2026-10-30",
        end_date: "2026-10-31",
      }
    );

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Target accommodation becomes paid
    expect(dbAccommodations.find((a) => a.id === targetAccId)?.status).toBe("paid");

    // Unrelated accommodation remains strictly untouched
    expect(dbAccommodations.find((a) => a.id === unrelatedAccId)?.status).toBe("pending");
  });

  it("6. Settle both event registration and accommodation in combined group orders", async () => {
    const poId = "po-combo-006";
    const evId = "pe-event-006";
    const accId = "acc-stay-006";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-COMBO-006",
      payer_participant_id: "part-uuid-001",
      amount: 1499,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push(
      {
        id: "item-combo-1",
        payment_order_id: poId,
        participant_id: "part-uuid-001",
        participant_event_id: evId,
        amount: 500,
      },
      {
        id: "item-combo-2",
        payment_order_id: poId,
        participant_id: "part-uuid-001",
        participant_accommodation_id: accId,
        amount: 999,
      }
    );

    dbEvents.push({
      id: evId,
      payment_status: "pending",
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    mockGatewayAmountPaise = 149900;

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(dbOrders[0].status).toBe("paid");
    expect(dbEvents[0].payment_status).toBe("paid");
    expect(dbAccommodations[0].status).toBe("paid");
  });

  it("7. Explicit business rejection from settlement RPC fails closed (400 SETTLEMENT_REJECTED)", async () => {
    mockRpcBehavior = "reject";

    const poId = "po-reject-007";
    const accId = "acc-reject-007";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-REJECT-007",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-reject-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.code).toBe("SETTLEMENT_REJECTED");
    expect(data.error).toContain("Amount mismatch");

    // Fail closed: order and accommodation must remain pending, no email sent
    expect(dbOrders[0].status).toBe("pending");
    expect(dbAccommodations[0].status).toBe("pending");
    expect(emailSentOrderIds).toHaveLength(0);
    expect(dbPayments).toHaveLength(0);
  });

  it("8. Database/infrastructure RPC error fails closed safely with 500 SETTLEMENT_FAILED", async () => {
    mockRpcBehavior = "error";

    const poId = "po-error-008";
    const accId = "acc-error-008";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-ERROR-008",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-error-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.code).toBe("SETTLEMENT_FAILED");

    // Must NOT execute manual fallback writes
    expect(dbOrders[0].status).toBe("pending");
    expect(dbAccommodations[0].status).toBe("pending");
    expect(emailSentOrderIds).toHaveLength(0);
    expect(dbPayments).toHaveLength(0);
  });

  it("9. Capability gate: missing RPC function fails closed with retryable 503 SERVICE_UNAVAILABLE", async () => {
    mockRpcBehavior = "unsupported";

    const poId = "po-missing-009";
    const accId = "acc-missing-009";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-MISSING-009",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-missing-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.code).toBe("SERVICE_UNAVAILABLE");

    expect(dbOrders[0].status).toBe("pending");
    expect(dbAccommodations[0].status).toBe("pending");
    expect(emailSentOrderIds).toHaveLength(0);
  });

  it("10. Ambiguous outcome / RPC timeout reconciles via authorized status lookup if DB committed", async () => {
    mockRpcBehavior = "timeout_settled"; // DB committed and marked paid, but RPC threw timeout

    const poId = "po-timeout-010";
    const accId = "acc-timeout-010";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-TIMEOUT-010",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-timeout-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.alreadyPaid).toBe(true);
    expect(data.paymentOrderId).toBe(poId);

    // Status lookup verified paid order, avoided duplicate email
    expect(dbOrders[0].status).toBe("paid");
    expect(dbAccommodations[0].status).toBe("paid");
  });

  it("11. Duplicate callback with already_processed action returns idempotent success without duplicate email", async () => {
    mockRpcBehavior = "already_processed";

    const poId = "po-dup-011";
    const accId = "acc-dup-011";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-DUP-011",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-dup-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.alreadyPaid).toBe(true);

    // No duplicate email
    expect(emailSentOrderIds).toHaveLength(0);
  });

  it("12. Already-paid order in database returns idempotent success immediately without calling RPC", async () => {
    const poId = "po-already-paid-012";
    const accId = "acc-already-paid-012";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-ALREADY-PAID-012",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      gateway_payment_id: "payu_captured_old",
      status: "paid", // Already paid
    });

    dbOrderItems.push({
      id: "item-paid-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "paid",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.alreadyPaid).toBe(true);

    // RPC was NEVER called because order was already in paid state
    const rpcCalls = dbRpcCalls.filter((c) => c.name === "process_payment_success");
    expect(rpcCalls).toHaveLength(0);
    expect(emailSentOrderIds).toHaveLength(0);
  });

  it("13. Paid order with a different gateway payment ID does not return success (fails closed)", async () => {
    mockRpcBehavior = "timeout_mismatched_payment_id";

    const poId = "po-mismatch-payid-013";
    const accId = "acc-mismatch-payid-013";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-MISMATCH-013",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-mismatch-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.code).toBe("SETTLEMENT_FAILED");
    expect(emailSentOrderIds).toHaveLength(0);
  });

  it("14. Paid order with a different gateway order ID does not return success (fails closed)", async () => {
    mockRpcBehavior = "timeout_mismatched_order_id";

    const poId = "po-mismatch-orderid-014";
    const accId = "acc-mismatch-orderid-014";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-MISMATCH-014",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-mismatch-2",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.code).toBe("SETTLEMENT_FAILED");
    expect(emailSentOrderIds).toHaveLength(0);
  });

  it("15. Unpaid order after ambiguous RPC timeout remains a controlled failure", async () => {
    mockRpcBehavior = "timeout_unsettled";

    const poId = "po-unsettled-015";
    const accId = "acc-unsettled-015";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-UNSETTLED-015",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-unsettled-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.code).toBe("SETTLEMENT_FAILED");
    expect(dbOrders[0].status).toBe("pending");
    expect(dbAccommodations[0].status).toBe("pending");
    expect(emailSentOrderIds).toHaveLength(0);
  });

  it("16. No payment or email side effects occur when transaction identity cannot be verified", async () => {
    mockRpcBehavior = "timeout_mismatched_payment_id";
    emailSentOrderIds = [];

    const poId = "po-sidefx-016";
    const accId = "acc-sidefx-016";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-SIDEFX-016",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-sidefx-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    // Strict side-effect assertions: NO emails sent and no confirmation
    expect(emailSentOrderIds).toHaveLength(0);
  });

  it("17. Fails safely when settlement RPC returns success: true with a missing action", async () => {
    mockRpcBehavior = "missing_action";
    emailSentOrderIds = [];

    const poId = "po-missing-action-017";
    const accId = "acc-missing-action-017";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-MISSINGACT-017",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-missingact-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.code).toBe("INVALID_SETTLEMENT_RESPONSE");
    expect(emailSentOrderIds).toHaveLength(0);
    expect(dbPayments).toHaveLength(0);
    expect(dbOrders[0].status).toBe("pending");
    expect(dbAccommodations[0].status).toBe("pending");
  });

  it("18. Fails safely when settlement RPC returns success: true with an unknown action", async () => {
    mockRpcBehavior = "unknown_action";
    emailSentOrderIds = [];

    const poId = "po-unknown-action-018";
    const accId = "acc-unknown-action-018";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-UNKNOWNACT-018",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-unknownact-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.code).toBe("INVALID_SETTLEMENT_RESPONSE");
    expect(emailSentOrderIds).toHaveLength(0);
    expect(dbPayments).toHaveLength(0);
    expect(dbOrders[0].status).toBe("pending");
    expect(dbAccommodations[0].status).toBe("pending");
  });

  it("19. Fails safely with controlled error and issues no resume token when order is already refunded", async () => {
    mockRpcBehavior = "already_refunded";
    emailSentOrderIds = [];

    const poId = "po-refunded-019";
    const accId = "acc-refunded-019";

    dbOrders.push({
      id: poId,
      order_reference: "SVK-REFUNDED-019",
      payer_participant_id: "part-uuid-001",
      amount: 999,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "txnid-acc-101",
      status: "pending",
    });

    dbOrderItems.push({
      id: "item-refunded-1",
      payment_order_id: poId,
      participant_id: "part-uuid-001",
      participant_accommodation_id: accId,
      amount: 999,
    });

    dbAccommodations.push({
      id: accId,
      participant_id: "part-uuid-001",
      status: "pending",
      amount: 999,
      payment_order_id: poId,
      start_date: "2026-10-28",
      end_date: "2026-10-30",
    });

    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: poId }),
    });

    const res = await POST(req);
    const data = await res.json();

    // 1. Must return a controlled error, never represented as a successful payment
    expect(res.status).toBe(400);
    expect(data.code).toBe("ORDER_ALREADY_REFUNDED");
    expect(data.success).toBe(false);
    expect(data.alreadyPaid).toBeUndefined();

    // 2. Must not receive a success resume token that allows registration to continue
    expect(data.resumeToken).toBeUndefined();
    expect(data.resumeUrl).toBeUndefined();

    // 3. Must not send confirmation email
    expect(emailSentOrderIds).toHaveLength(0);

    // 4. Must not create additional payment records or mutate order/accommodation to paid
    expect(dbPayments).toHaveLength(0);
    expect(dbOrders[0].status).toBe("pending");
    expect(dbAccommodations[0].status).toBe("pending");
  });
});
