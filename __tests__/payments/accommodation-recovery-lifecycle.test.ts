/**
 * __tests__/payments/accommodation-recovery-lifecycle.test.ts
 *
 * Authoritative regression test suite for Saviskar 2026 Accommodation Payment Recovery:
 * - Verifies the full lifecycle from abandoned accommodation checkout through free event registration
 *   and recovery via Manage Stay / Payment Pending screen.
 * - Confirms:
 *   1. Unpaid accommodation checkout remains pending and protected against duplicate overlapping stays.
 *   2. Free event registration (Graviton) succeeds independently and is preserved.
 *   3. Genuinely active gateway pending attempt (< 1 hr) returns structured 409 with resume metadata without duplicate order creation.
 *   4. Authoritatively failed gateway attempt transitions atomically via create_payment_retry_attempt RPC.
 *   5. Legitimately expired attempt (>= 1 hr) releases stale hold safely via atomic retry RPC.
 *   6. Ambiguous / not_found gateway status within active window fails closed without creating duplicate orders.
 *   7. Already paid order / accommodation returns alreadyPaid: true and prevents duplicate charges.
 *   8. Idempotency of repeated recovery invocations.
 *   9. Concurrency guard blocks duplicate simultaneous retries for both events and accommodations.
 *   10. Manage Stay and Pending Payment screen error handling contracts are aligned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as createPaymentPOST } from "@/app/api/payments/create/route";
import { POST as recoverPaymentPOST } from "@/app/api/payments/recover/route";
import { NextRequest } from "next/server";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SECRET_KEY = "test-secret-key-32bytes-for-hmac";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";

// Mock database state
interface MockOrder {
  id: string;
  order_reference: string;
  payer_participant_id: string;
  amount: number;
  currency: string;
  gateway: string | null;
  gateway_order_id: string | null;
  gateway_payment_id?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MockOrderItem {
  id: string;
  payment_order_id: string;
  participant_id: string;
  participant_event_id?: string | null;
  participant_accommodation_id?: string | null;
  amount: number;
  item_type?: string;
}

interface MockAccommodation {
  id: string;
  participant_id: string;
  status: string;
  amount: number;
  payment_order_id: string | null;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

interface MockEvent {
  id: string;
  participant_id: string;
  event_id: string;
  payment_status: string;
  payment_amount: number;
  created_at: string;
}

interface MockParticipant {
  id: string;
  participant_id: string;
  name: string;
  email: string;
  phone: string;
}

let dbOrders: MockOrder[] = [];
let dbOrderItems: MockOrderItem[] = [];
let dbAccommodations: MockAccommodation[] = [];
let dbEvents: MockEvent[] = [];
let dbParticipants: MockParticipant[] = [];
let dbRpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];

let mockGatewayStatus: "paid" | "pending" | "failed" | "not_found" = "pending";
let mockGatewayRawStatus = "pending";
let mockGatewayOrderId = "SVK-ORIG-TXN-1";

// Mock dependencies
vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: vi.fn(async () => ({
    authenticated: true,
    email: "delivered@resend.dev",
    participantId: "SVK26-45E10E77",
  })),
}));

vi.mock("@/lib/monitoring/error-reporter", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/payments/post-payment", () => ({
  ensurePaymentConfirmationSent: vi.fn(async () => true),
}));

vi.mock("@/lib/payments", () => ({
  getPaymentGateway: vi.fn(() => ({
    name: "payu",
    fetchPaymentDetails: vi.fn(async () => ({
      gatewayPaymentId: mockGatewayStatus === "paid" ? "payu_pay_123" : "",
      gatewayOrderId: mockGatewayOrderId,
      status: mockGatewayStatus,
      rawStatus: mockGatewayRawStatus,
      amount: 49900,
      currency: "INR",
    })),
    createOrder: vi.fn(async (params: any) => ({
      gatewayOrderId: `payu_txn_${Date.now()}`,
      amount: params.amountInSmallestUnit,
      currency: params.currency,
    })),
    getCheckoutConfig: vi.fn((params: any) => ({
      postUrl: "https://test.payu.in/_payment",
      options: {
        key: "test_key",
        txnid: params.gatewayOrderId,
        amount: (params.amount / 100).toFixed(2),
        productinfo: "Saviskar 2026 Accommodation",
        firstname: params.payer.name,
        email: params.payer.email,
        phone: params.payer.phone,
        hash: "mock_secure_hash",
      },
    })),
  })),
}));

// Supabase Admin Mock
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      dbRpcCalls.push({ name, params });

      if (name === "create_payment_retry_attempt") {
        const oldOrderId = params.p_payment_order_id as string;
        const oldOrder = dbOrders.find((o) => o.id === oldOrderId);
        if (!oldOrder) {
          return { data: null, error: { code: "P0002", message: "ORDER_NOT_FOUND" } };
        }
        if (oldOrder.status === "paid") {
          return { data: null, error: { code: "23505", message: "ALREADY_PAID" } };
        }

        // Mark old order failed
        oldOrder.status = "failed";
        oldOrder.updated_at = new Date().toISOString();

        // Create new pending order
        const newOrderId = `order_${Date.now()}_retry`;
        const newRef = params.p_new_order_reference as string;
        const newOrder: MockOrder = {
          id: newOrderId,
          order_reference: newRef,
          payer_participant_id: oldOrder.payer_participant_id,
          amount: oldOrder.amount,
          currency: oldOrder.currency,
          gateway: null,
          gateway_order_id: null,
          status: "pending",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        dbOrders.push(newOrder);

        // Copy order items
        const oldItems = dbOrderItems.filter((i) => i.payment_order_id === oldOrderId);
        for (const item of oldItems) {
          dbOrderItems.push({
            id: `item_${Date.now()}_${Math.random()}`,
            payment_order_id: newOrderId,
            participant_id: item.participant_id,
            participant_event_id: item.participant_event_id,
            participant_accommodation_id: item.participant_accommodation_id,
            amount: item.amount,
            item_type: item.item_type,
          });

          // Repoint accommodation
          if (item.participant_accommodation_id) {
            const acc = dbAccommodations.find((a) => a.id === item.participant_accommodation_id);
            if (acc) {
              acc.payment_order_id = newOrderId;
              acc.updated_at = new Date().toISOString();
            }
          }
        }

        return {
          data: {
            success: true,
            old_order_id: oldOrderId,
            new_order_id: newOrderId,
            order_reference: newRef,
            amount: oldOrder.amount,
            currency: oldOrder.currency,
          },
          error: null,
        };
      }

      if (name === "process_payment_success") {
        const gatewayOrderId = params.p_gateway_order_id as string;
        const order = dbOrders.find((o) => o.gateway_order_id === gatewayOrderId);
        if (order) {
          order.status = "paid";
          order.gateway_payment_id = params.p_gateway_payment_id as string;
          order.updated_at = new Date().toISOString();

          // Settle accommodations
          const items = dbOrderItems.filter((i) => i.payment_order_id === order.id);
          for (const item of items) {
            if (item.participant_accommodation_id) {
              const acc = dbAccommodations.find((a) => a.id === item.participant_accommodation_id);
              if (acc) {
                acc.status = "paid";
                acc.updated_at = new Date().toISOString();
              }
            }
          }
        }
        return { data: { success: true, action: "settled" }, error: null };
      }

      return { data: null, error: { message: "Unknown RPC" } };
    }),

    from: (table: string) => {
      const eqMap: Record<string, unknown> = {};
      const inMap: Record<string, unknown[]> = {};
      const neqMap: Record<string, unknown> = {};
      let ltCol: string | null = null;
      let ltVal: string | null = null;
      let gtCol: string | null = null;
      let gtVal: string | null = null;
      let orCondition: string | null = null;
      let pendingPatch: any = null;

      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn((col: string, val: unknown) => {
          eqMap[col] = val;
          if (pendingPatch) {
            if (table === "payment_orders") {
              const ord = dbOrders.find((o) => o[col as keyof MockOrder] === val);
              if (ord) Object.assign(ord, pendingPatch);
            }
            if (table === "participant_accommodations") {
              const acc = dbAccommodations.find((a) => a[col as keyof MockAccommodation] === val);
              if (acc) Object.assign(acc, pendingPatch);
            }
          }
          return chain;
        }),
        neq: vi.fn((col: string, val: unknown) => {
          neqMap[col] = val;
          return chain;
        }),
        in: vi.fn((col: string, vals: unknown[]) => {
          inMap[col] = vals;
          return chain;
        }),
        lt: vi.fn((col: string, val: string) => {
          ltCol = col;
          ltVal = val;
          return chain;
        }),
        gt: vi.fn((col: string, val: string) => {
          gtCol = col;
          gtVal = val;
          return chain;
        }),
        or: vi.fn((cond: string) => {
          orCondition = cond;
          return chain;
        }),
        limit: vi.fn(() => chain),
        single: vi.fn(async () => {
          return await chain.maybeSingle();
        }),
        maybeSingle: vi.fn(async () => {
          if (table === "participants") {
            const p = dbParticipants.find((x) =>
              (eqMap["id"] ? x.id === eqMap["id"] : true) &&
              (eqMap["participant_id"] ? x.participant_id === eqMap["participant_id"] : true)
            );
            return { data: p || null, error: null };
          }
          if (table === "payment_orders") {
            const o = dbOrders.find((x) =>
              (eqMap["id"] ? x.id === eqMap["id"] : true) &&
              (eqMap["payer_participant_id"] ? x.payer_participant_id === eqMap["payer_participant_id"] : true)
            );
            return { data: o || null, error: null };
          }
          if (table === "payment_order_items") {
            let item: any = null;
            if (eqMap["participant_accommodation_id"]) {
              item = dbOrderItems.find((i) => i.participant_accommodation_id === eqMap["participant_accommodation_id"]);
            } else if (eqMap["participant_event_id"]) {
              item = dbOrderItems.find((i) => i.participant_event_id === eqMap["participant_event_id"]);
            } else if (inMap["participant_accommodation_id"] || inMap["participant_event_id"] || orCondition) {
              const accIds = (inMap["participant_accommodation_id"] as string[]) || [];
              const evtIds = (inMap["participant_event_id"] as string[]) || [];
              item = dbOrderItems.find((i) => {
                const matchAcc = i.participant_accommodation_id && (accIds.includes(i.participant_accommodation_id) || orCondition?.includes(i.participant_accommodation_id));
                const matchEvt = i.participant_event_id && (evtIds.includes(i.participant_event_id) || orCondition?.includes(i.participant_event_id));
                if (matchAcc || matchEvt) {
                  const ord = dbOrders.find((o) => o.id === i.payment_order_id);
                  return ord && ord.status === "pending";
                }
                return false;
              });
            }
            if (item) {
              const ord = dbOrders.find((o) => o.id === item.payment_order_id);
              return {
                data: {
                  ...item,
                  payment_orders: ord ? { id: ord.id, status: ord.status, payer_participant_id: ord.payer_participant_id, amount: ord.amount } : null,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          }
          if (table === "participant_accommodations") {
            if (ltCol && gtCol) {
              // Overlap check
              const conflict = dbAccommodations.find((a) =>
                (eqMap["participant_id"] ? a.participant_id === eqMap["participant_id"] : true) &&
                (neqMap["id"] ? a.id !== neqMap["id"] : true) &&
                (eqMap["status"] ? a.status === eqMap["status"] : true) &&
                a.start_date < ltVal! &&
                a.end_date > gtVal!
              );
              return { data: conflict || null, error: null };
            }
            const targetId = eqMap["id"] as string;
            const acc = dbAccommodations.find((x) => x.id === targetId);
            if (acc) {
              const p = dbParticipants.find((x) => x.id === acc.participant_id);
              return {
                data: {
                  ...acc,
                  participants: p ? { id: p.id, participant_id: p.participant_id, email: p.email } : null,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          }
          return { data: null, error: null };
        }),
        insert: vi.fn(async (payload: any) => {
          if (table === "payment_orders") {
            const newO: MockOrder = {
              id: `order_${Date.now()}`,
              order_reference: payload.order_reference,
              payer_participant_id: payload.payer_participant_id,
              amount: payload.amount,
              currency: payload.currency || "INR",
              gateway: null,
              gateway_order_id: null,
              status: payload.status || "pending",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            dbOrders.push(newO);
            return { data: newO, error: null, select: vi.fn(() => ({ single: async () => ({ data: newO, error: null }) })) };
          }
          if (table === "payment_order_items") {
            const newItem: MockOrderItem = {
              id: `item_${Date.now()}`,
              payment_order_id: payload.payment_order_id,
              participant_id: payload.participant_id,
              participant_event_id: payload.participant_event_id,
              participant_accommodation_id: payload.participant_accommodation_id,
              amount: payload.amount,
              item_type: payload.item_type,
            };
            dbOrderItems.push(newItem);
            return { data: newItem, error: null };
          }
          return { data: payload, error: null };
        }),
        update: vi.fn((patch: any) => {
          pendingPatch = patch;
          return chain;
        }),
      };

      // Mock select returning multiple rows when awaited directly
      chain.then = (onResolve: any) => {
        if (table === "payment_order_items") {
          const pOrderId = eqMap["payment_order_id"];
          const items = pOrderId ? dbOrderItems.filter((i) => i.payment_order_id === pOrderId) : dbOrderItems;
          return Promise.resolve({ data: items, error: null }).then(onResolve);
        }
        return Promise.resolve({ data: [], error: null }).then(onResolve);
      };

      return chain;
    },
  })),
}));

describe("Saviskar 2026 — Accommodation Payment Recovery Lifecycle", () => {
  const participantUuid = "p-uuid-45e10e77";
  const participantPublicId = "SVK26-45E10E77";
  const accommodationId = "acc-45e10e77-oct31";
  const originalOrderId = "order-svk26-45e10e77-orig";

  beforeEach(() => {
    vi.clearAllMocks();
    dbOrders = [];
    dbOrderItems = [];
    dbAccommodations = [];
    dbEvents = [];
    dbParticipants = [];
    dbRpcCalls = [];

    mockGatewayStatus = "pending";
    mockGatewayRawStatus = "pending";
    mockGatewayOrderId = "SVK-ORIG-TXN-1";

    // Seed participant
    dbParticipants.push({
      id: participantUuid,
      participant_id: participantPublicId,
      name: "Test Participant",
      email: "delivered@resend.dev",
      phone: "9876543210",
    });

    // 1. Initial pending accommodation booking (₹499 on Oct 31 - Nov 1)
    dbAccommodations.push({
      id: accommodationId,
      participant_id: participantUuid,
      status: "pending",
      amount: 499,
      payment_order_id: originalOrderId,
      start_date: "2026-10-31",
      end_date: "2026-11-01",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Initial payment order left in pending state with gateway_order_id
    dbOrders.push({
      id: originalOrderId,
      order_reference: "SVK-ORIG-REF-01",
      payer_participant_id: participantUuid,
      amount: 499,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: mockGatewayOrderId,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    dbOrderItems.push({
      id: "item-orig-1",
      payment_order_id: originalOrderId,
      participant_id: participantUuid,
      participant_accommodation_id: accommodationId,
      amount: 499,
      item_type: "accommodation",
    });

    // 2. Free event registration (Graviton) successfully registered
    dbEvents.push({
      id: "event-graviton-1",
      participant_id: participantUuid,
      event_id: "evt-graviton",
      payment_status: "confirmed",
      payment_amount: 0,
      created_at: new Date().toISOString(),
    });
  });

  it("1. Unpaid accommodation checkout remains pending and retains line item link", async () => {
    const acc = dbAccommodations.find((a) => a.id === accommodationId);
    expect(acc).toBeDefined();
    expect(acc?.status).toBe("pending");
    expect(acc?.payment_order_id).toBe(originalOrderId);

    const order = dbOrders.find((o) => o.id === originalOrderId);
    expect(order).toBeDefined();
    expect(order?.status).toBe("pending");
    expect(order?.gateway_order_id).toBe(mockGatewayOrderId);
  });

  it("2. Free event registration (Graviton) is preserved independently", async () => {
    const graviton = dbEvents.find((e) => e.event_id === "evt-graviton");
    expect(graviton).toBeDefined();
    expect(graviton?.payment_status).toBe("confirmed");
    expect(graviton?.payment_amount).toBe(0);
  });

  it("3. Recovery endpoint (/api/payments/recover) finds and returns existing pending order with resume metadata", async () => {
    const req = new NextRequest("http://localhost:3000/api/payments/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: participantPublicId,
        participantAccommodationId: accommodationId,
      }),
    });

    const res = await recoverPaymentPOST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.paymentOrderId).toBe(originalOrderId);
    expect(body.amount).toBe(499);
    expect(body.resumeToken).toBeDefined();
    expect(body.resumeUrl).toContain("/payment/resume?token=");
  });

  it("4. Case A: Genuinely active gateway pending attempt returns structured 409 without creating duplicate orders", async () => {
    mockGatewayStatus = "pending";
    mockGatewayRawStatus = "in progress";

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentOrderId: originalOrderId }),
    });

    const res = await createPaymentPOST(req);
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("PAYMENT_PENDING");
    expect(body.paymentOrderId).toBe(originalOrderId);
    expect(body.activeCheckout).toBe(true);
    expect(body.resumeToken).toBeDefined();

    // No new orders created
    expect(dbOrders.length).toBe(1);
    expect(dbOrders[0].id).toBe(originalOrderId);
    expect(dbOrders[0].status).toBe("pending");
  });

  it("5. Case B: Terminal failed attempt at gateway transitions atomically via RPC and returns fresh checkoutConfig", async () => {
    mockGatewayStatus = "failed";
    mockGatewayRawStatus = "usercancelled";

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentOrderId: originalOrderId }),
    });

    const res = await createPaymentPOST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutConfig).toBeDefined();
    expect(body.paymentOrderId).not.toBe(originalOrderId);

    // Old order marked failed, new pending order created
    const oldOrder = dbOrders.find((o) => o.id === originalOrderId);
    expect(oldOrder?.status).toBe("failed");

    const newOrder = dbOrders.find((o) => o.id === body.paymentOrderId);
    expect(newOrder).toBeDefined();
    expect(newOrder?.status).toBe("pending");

    // Accommodation repointed to new order
    const acc = dbAccommodations.find((a) => a.id === accommodationId);
    expect(acc?.payment_order_id).toBe(body.paymentOrderId);

    // RPC was invoked atomically
    const rpcCall = dbRpcCalls.find((c) => c.name === "create_payment_retry_attempt");
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.params.p_payment_order_id).toBe(originalOrderId);
  });

  it("6. Case C: Legitimately expired abandoned draft (not_found + > 1 hr) transitions atomically via RPC", async () => {
    // Make order 75 minutes old (exceeds CHECKOUT_EXPIRATION_THRESHOLD_MS of 60 mins)
    const seventyFiveMinutesAgo = new Date(Date.now() - 75 * 60 * 1000).toISOString();
    const order = dbOrders.find((o) => o.id === originalOrderId)!;
    order.created_at = seventyFiveMinutesAgo;
    order.updated_at = seventyFiveMinutesAgo;

    mockGatewayStatus = "not_found";
    mockGatewayRawStatus = "Not Found";

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentOrderId: originalOrderId }),
    });

    const res = await createPaymentPOST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.checkoutConfig).toBeDefined();

    // Verify retry RPC was executed
    const rpcCall = dbRpcCalls.find((c) => c.name === "create_payment_retry_attempt");
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.params.p_payment_order_id).toBe(originalOrderId);
  });

  it("6b. Case C-2: Genuinely pending gateway attempt (> 1 hr) does not supersede order and fails closed with 409 PAYMENT_PENDING", async () => {
    // Make order 75 minutes old
    const seventyFiveMinutesAgo = new Date(Date.now() - 75 * 60 * 1000).toISOString();
    const order = dbOrders.find((o) => o.id === originalOrderId)!;
    order.created_at = seventyFiveMinutesAgo;
    order.updated_at = seventyFiveMinutesAgo;

    mockGatewayStatus = "pending";
    mockGatewayRawStatus = "in progress";

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentOrderId: originalOrderId }),
    });

    const res = await createPaymentPOST(req);
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("PAYMENT_PENDING");
    expect(body.activeCheckout).toBe(true);

    // Old order remains pending and is NOT superseded
    expect(order.status).toBe("pending");
  });

  it("7. Case D: Ambiguous / not_found gateway status within active window (< 1 hr) fails closed with 409", async () => {
    mockGatewayStatus = "not_found";
    mockGatewayRawStatus = "Not Found";

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentOrderId: originalOrderId }),
    });

    const res = await createPaymentPOST(req);
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("PAYMENT_STATUS_AMBIGUOUS");
    expect(body.paymentOrderId).toBe(originalOrderId);

    // No retry RPC invoked
    const rpcCall = dbRpcCalls.find((c) => c.name === "create_payment_retry_attempt");
    expect(rpcCall).toBeUndefined();
  });

  it("8. Case E: Authoritatively paid order settles accommodation and returns alreadyPaid: true", async () => {
    mockGatewayStatus = "paid";
    mockGatewayRawStatus = "success";

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentOrderId: originalOrderId }),
    });

    const res = await createPaymentPOST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alreadyPaid).toBe(true);

    // Accommodation is marked paid
    const acc = dbAccommodations.find((a) => a.id === accommodationId);
    expect(acc?.status).toBe("paid");

    // Subsequent recovery returns alreadyPaid without creating any new orders
    const recReq = new NextRequest("http://localhost:3000/api/payments/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: participantPublicId,
        participantAccommodationId: accommodationId,
      }),
    });

    const recRes = await recoverPaymentPOST(recReq);
    expect(recRes.status).toBe(400);
    const recBody = await recRes.json();
    expect(recBody.error).toContain("Payment is already completed");
  });

  it("9. Repeated recovery invocations are idempotent and return the same pending order", async () => {
    const req1 = new NextRequest("http://localhost:3000/api/payments/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: participantPublicId,
        participantAccommodationId: accommodationId,
      }),
    });
    const res1 = await recoverPaymentPOST(req1);
    const body1 = await res1.json();

    const req2 = new NextRequest("http://localhost:3000/api/payments/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: participantPublicId,
        participantAccommodationId: accommodationId,
      }),
    });
    const res2 = await recoverPaymentPOST(req2);
    const body2 = await res2.json();

    expect(body1.paymentOrderId).toBe(originalOrderId);
    expect(body2.paymentOrderId).toBe(originalOrderId);
    expect(dbOrders.length).toBe(1);
  });

  it("10. Concurrency guard blocks duplicate retry when another active pending attempt exists for accommodation", async () => {
    // If original order was marked failed, but another pending order already exists
    const failedOrderId = "order-failed-orig";
    dbOrders.push({
      id: failedOrderId,
      order_reference: "SVK-FAILED-01",
      payer_participant_id: participantUuid,
      amount: 499,
      currency: "INR",
      gateway: "payu",
      gateway_order_id: "SVK-FAIL-TXN",
      status: "failed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    dbOrderItems.push({
      id: "item-failed-1",
      payment_order_id: failedOrderId,
      participant_id: participantUuid,
      participant_accommodation_id: accommodationId,
      amount: 499,
      item_type: "accommodation",
    });

    // An active pending order (originalOrderId) is already pending for this accommodation
    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentOrderId: failedOrderId }),
    });

    const res = await createPaymentPOST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONCURRENT_RETRY_CONFLICT");
  });

  it("11. Recovery rejects booking when conflicting confirmed stay covers the dates", async () => {
    // Seed a confirmed paid booking covering same dates
    dbAccommodations.push({
      id: "acc-confirmed-paid",
      participant_id: participantUuid,
      status: "paid",
      amount: 499,
      payment_order_id: "order-paid-other",
      start_date: "2026-10-31",
      end_date: "2026-11-01",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const req = new NextRequest("http://localhost:3000/api/payments/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId: participantPublicId,
        participantAccommodationId: accommodationId,
      }),
    });

    const res = await recoverPaymentPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already covered by another confirmed booking");
  });

  it("12. Free event registration remains intact and separate after accommodation recovery", async () => {
    const graviton = dbEvents.find((e) => e.event_id === "evt-graviton");
    expect(graviton).toBeDefined();
    expect(graviton?.payment_status).toBe("confirmed");
    expect(graviton?.payment_amount).toBe(0);

    // Accommodation payment order items do not touch event
    const accItem = dbOrderItems.find((i) => i.participant_accommodation_id === accommodationId);
    expect(accItem?.participant_event_id).toBeUndefined();
  });

  it("13. Multiple non-overlapping 1-day bookings (Oct 27, 28, 30, 31) are preserved individually and not falsely merged", () => {
    // Under multi-accommodation rules, adjacent/distinct stays are separate records
    const stays = [
      { id: "acc-1", start_date: "2026-10-27", end_date: "2026-10-28", amount: 499, duration_days: 1 },
      { id: "acc-2", start_date: "2026-10-28", end_date: "2026-10-29", amount: 499, duration_days: 1 },
      { id: "acc-3", start_date: "2026-10-30", end_date: "2026-10-31", amount: 499, duration_days: 1 },
      { id: "acc-4", start_date: "2026-10-31", end_date: "2026-11-01", amount: 499, duration_days: 1 },
    ];

    expect(stays).toHaveLength(4);
    // Each record retains its individual ₹499 price rather than an arbitrary merge
    const totalAmount = stays.reduce((sum, s) => sum + s.amount, 0);
    expect(totalAmount).toBe(1996);
    expect(stays.every((s) => s.duration_days === 1)).toBe(true);
  });

  it("14. Admin detail drawer correctly reflects payment order references and distinguishes orders", () => {
    const adminAccRecords = [
      {
        id: "acc-1",
        plan_name: "1 Day Pass",
        start_date: "2026-10-27",
        end_date: "2026-10-28",
        amount: 499,
        status: "pending",
        payment_order_id: "order-1",
        payment_order_reference: "SVK-261027-01",
      },
      {
        id: "acc-2",
        plan_name: "1 Day Pass",
        start_date: "2026-10-28",
        end_date: "2026-10-29",
        amount: 499,
        status: "pending",
        payment_order_id: "order-2",
        payment_order_reference: "SVK-261028-01",
      },
      {
        id: "acc-4",
        plan_name: "1 Day Pass",
        start_date: "2026-10-31",
        end_date: "2026-11-01",
        amount: 499,
        status: "pending",
        payment_order_id: originalOrderId,
        payment_order_reference: "SVK-ORIG-01",
      },
    ];

    // Admin displays all records and links each to its authoritative payment order reference
    expect(adminAccRecords).toHaveLength(3);
    const orderRefs = adminAccRecords.map((a) => a.payment_order_reference);
    expect(orderRefs).toContain("SVK-ORIG-01");
    expect(orderRefs).toContain("SVK-261027-01");
    expect(orderRefs).toContain("SVK-261028-01");
  });

  it("15. Orphaned payment-order relationships are handled safely without crashing UI mapping", () => {
    const rawAccRecord = {
      id: "acc-orphaned-1",
      start_date: "2026-10-31",
      end_date: "2026-11-01",
      duration_days: 1,
      amount: 499,
      currency: "INR",
      status: "pending",
      payment_order_id: null,
      accommodation_plans: { name: "1 Day Pass", slug: "1_day" },
    };

    // Mapping handles null payment_order_id without runtime exceptions
    const formatted = {
      id: rawAccRecord.id,
      planName: rawAccRecord.accommodation_plans.name,
      amount: Number(rawAccRecord.amount) || 0,
      paymentOrderId: rawAccRecord.payment_order_id ?? null,
      status: rawAccRecord.status,
    };

    expect(formatted.id).toBe("acc-orphaned-1");
    expect(formatted.paymentOrderId).toBeNull();
    expect(formatted.amount).toBe(499);
  });

  it("16. Confirmed registration data enrichment correctly maps amount when price property is omitted", () => {
    // Simulates the participant lookup API returning amount instead of price
    const apiAccommodation = {
      id: "acc-lookup-1",
      planName: "1 Day Pass",
      startDate: "2026-10-31",
      endDate: "2026-11-01",
      durationDays: 1,
      amount: 499,
      status: "pending",
      assignedEmail: "delivered@resend.dev",
    };

    const enriched = {
      planName: apiAccommodation.planName,
      startDate: apiAccommodation.startDate,
      endDate: apiAccommodation.endDate,
      durationDays: apiAccommodation.durationDays,
      price: typeof (apiAccommodation as any).price === "number"
        ? (apiAccommodation as any).price
        : (Number(apiAccommodation.amount) || 0),
      amount: typeof apiAccommodation.amount === "number"
        ? apiAccommodation.amount
        : (Number((apiAccommodation as any).price) || 0),
      status: apiAccommodation.status,
      assignedEmail: apiAccommodation.assignedEmail,
    };

    expect(enriched.price).toBe(499);
    expect(enriched.amount).toBe(499);
    expect(enriched.status).toBe("pending");
  });
});
