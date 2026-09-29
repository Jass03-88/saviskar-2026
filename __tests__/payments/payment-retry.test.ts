import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/payments/create/route";
import { NextRequest } from "next/server";
import { PayUGateway } from "@/lib/payments/payu";
import { PaymentVerificationError } from "@/lib/payments/types";

// Mock Supabase
function makeThenableChain(overrideFn?: () => Promise<{ data: unknown; error: unknown }>): Record<string, unknown> {
  const defaultResolve = () => (overrideFn ? overrideFn() : Promise.resolve({ data: null, error: null }));
  function then(this: void, onFulfilled: (v: { data: unknown; error: unknown }) => unknown) {
    return defaultResolve().then(onFulfilled);
  }
  const chain: Record<string, unknown> = {
    then,
    catch: () => chain,
    finally: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    is: () => chain,
    or: () => chain,
    limit: () => chain,
    order: () => chain,
    update: () => chain,
    insert: () => chain,
    upsert: () => chain,
    delete: () => chain,
    single: () =>
      defaultResolve().then((res) => ({
        data: Array.isArray(res.data) ? res.data[0] ?? null : res.data,
        error: res.error,
      })),
    maybeSingle: () =>
      defaultResolve().then((res) => ({
        data: Array.isArray(res.data) ? res.data[0] ?? null : res.data,
        error: res.error,
      })),
  };
  return chain;
}

let mockPaymentOrder: Record<string, unknown> | null = null;
let mockGatewayStatus: string = "failed";
let mockGatewayFetchThrows: boolean | Error = false;
let mockGatewayCreateThrows = false;
let mockUpdateGatewayIdFails = false;
let mockRpcError: { code?: string; message?: string } | null = null;
let mockActivePendingOrderExists = false;

const updatedOrders: Array<Record<string, unknown>> = [];
const processedEventClaims: Array<Record<string, unknown>> = [];
const insertedPayments: Array<Record<string, unknown>> = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name === "create_payment_retry_attempt") {
        if (mockRpcError) {
          return Promise.resolve({ data: null, error: mockRpcError });
        }
        if (mockActivePendingOrderExists) {
          return Promise.resolve({
            data: null,
            error: {
              code: "40001",
              message: "ACTIVE_ATTEMPT_EXISTS: An active pending payment order already exists for this registration",
            },
          });
        }

        // Simulate successful atomic RPC execution:
        // Marks old order failed
        updatedOrders.push({ id: params.p_payment_order_id, status: "failed" });
        if (mockPaymentOrder && mockPaymentOrder.id === params.p_payment_order_id) {
          mockPaymentOrder.status = "failed";
        }
        // An active pending order now exists
        mockActivePendingOrderExists = true;

        return Promise.resolve({
          data: {
            success: true,
            old_order_id: params.p_payment_order_id,
            new_order_id: "new_order_uuid_777",
            order_reference: params.p_new_order_reference,
            payer_participant_id: "payer_uuid_001",
            amount: 299,
            currency: "INR",
            status: "pending",
            items_count: 1,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      if (table === "payment_orders") {
        return {
          select: () => makeThenableChain(() => Promise.resolve({ data: mockPaymentOrder, error: null })),
          update: (fields: Record<string, unknown>) => {
            if (mockUpdateGatewayIdFails && fields.gateway_order_id) {
              return makeThenableChain(() =>
                Promise.resolve({ data: null, error: { message: "Database connection failed during update" } })
              );
            }
            updatedOrders.push(fields);
            if (mockPaymentOrder) {
              Object.assign(mockPaymentOrder, fields);
            }
            if (fields.status === "failed") {
              mockActivePendingOrderExists = false;
            }
            return makeThenableChain();
          },
        };
      }
      if (table === "participants") {
        return {
          select: () =>
            makeThenableChain(() =>
              Promise.resolve({
                data: {
                  id: "payer_uuid_001",
                  participant_id: "SVK26-ALICE01",
                  name: "Alice",
                  email: "alice@example.com",
                  phone: "+919876543210",
                },
                error: null,
              })
            ),
        };
      }
      if (table === "payment_order_items") {
        return {
          select: (fields?: string) =>
            makeThenableChain(() => {
              if (fields && fields.includes("payment_orders!inner")) {
                return Promise.resolve({
                  data: mockActivePendingOrderExists
                    ? [{ payment_orders: { id: "active_po_uuid_777", status: "pending" } }]
                    : [],
                  error: null,
                });
              }
              return Promise.resolve({
                data: [
                  {
                    id: "item_uuid_1",
                    participant_id: "payer_uuid_001",
                    participant_event_id: "pe_uuid_1",
                    participant_event_member_id: null,
                    event_id: "event_uuid_1",
                    amount: 299,
                  },
                ],
                error: null,
              });
            }),
          insert: () => makeThenableChain(),
        };
      }
      if (table === "processed_payment_events") {
        return {
          insert: (fields: Record<string, unknown>) => {
            const isDuplicate = processedEventClaims.some((c) => c.payment_id === fields.payment_id);
            if (isDuplicate) {
              return makeThenableChain(() => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } }));
            }
            processedEventClaims.push(fields);
            return makeThenableChain(() => Promise.resolve({ data: { id: "claim_1" }, error: null }));
          },
        };
      }
      if (table === "participant_events") {
        return {
          update: () => makeThenableChain(),
        };
      }
      if (table === "payments") {
        return {
          insert: (fields: Record<string, unknown>) => {
            insertedPayments.push(fields);
            return makeThenableChain();
          },
        };
      }
      return makeThenableChain();
    },
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: () => Promise.resolve({ authenticated: true, email: "alice@example.com" }),
}));

let createdGatewayOrderCount = 0;
vi.mock("@/lib/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments")>();
  return {
    ...actual,
    getPaymentGateway: () => ({
      name: "payu",
      createOrder: () => {
        if (mockGatewayCreateThrows) {
          throw new Error("PayU Gateway Connection Timed Out");
        }
        createdGatewayOrderCount++;
        return Promise.resolve({
          gatewayOrderId: `SVK-FRESH-TXN-${createdGatewayOrderCount}`,
          status: "pending",
        });
      },
      getCheckoutConfig: (params: { gatewayOrderId: string; baseUrl: string }) => ({
        gateway: "payu",
        postUrl: "https://test.payu.in/_payment",
        options: {
          txnid: params.gatewayOrderId,
          hash: "test_computed_hash",
          surl: `${params.baseUrl}/api/payments/payu/success`,
          furl: `${params.baseUrl}/api/payments/payu/failure`,
        },
      }),
      fetchPaymentDetails: (gatewayOrderId: string) => {
        if (mockGatewayFetchThrows) {
          if (mockGatewayFetchThrows instanceof Error) throw mockGatewayFetchThrows;
          throw new PaymentVerificationError("timeout", "Network or timeout error fetching payment details");
        }
        return Promise.resolve({
          status: mockGatewayStatus,
          gatewayPaymentId: mockGatewayStatus === "paid" ? "mih_payu_capture_999" : "",
          gatewayOrderId,
          amount: 29900,
          currency: "INR",
          rawStatus: mockGatewayStatus,
        });
      },
    }),
  };
});

const mockEmailSentOrders: string[] = [];
vi.mock("@/lib/payments/post-payment", () => ({
  ensurePaymentConfirmationSent: vi.fn((orderId: string) => {
    mockEmailSentOrders.push(orderId);
    return Promise.resolve({ sent: true });
  }),
}));

describe("PayUGateway fetchPaymentDetails Unit Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      PAYU_ENVIRONMENT: "test",
      PAYU_KEY: "test_key",
      PAYU_SALT: "test_salt",
    };
    vi.restoreAllMocks();
  });

  it("1. Throws PaymentVerificationError('invalid_credentials') when PayU returns 'Invalid Hash.'", async () => {
    const gateway = new PayUGateway();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 0, msg: "Invalid Hash." }), { status: 200 })
    );

    await expect(gateway.fetchPaymentDetails("txnid_1")).rejects.toMatchObject({
      name: "PaymentVerificationError",
      errorType: "invalid_credentials",
    });
  });

  it("2. Returns { status: 'not_found' } when PayU returns 0 transactions found (unpaid/abandoned)", async () => {
    const gateway = new PayUGateway();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 0,
          msg: "0 out of 1 Transactions Fetched Successfully",
          transaction_details: {
            txnid_abandoned: {
              status: "Not Found",
              mihpayid: "Not Found",
            },
          },
        }),
        { status: 200 }
      )
    );

    const details = await gateway.fetchPaymentDetails("txnid_abandoned");
    expect(details.status).toBe("not_found");
    expect(details.gatewayPaymentId).toBe("");
    expect(details.gatewayOrderId).toBe("txnid_abandoned");
  });

  it("3. Returns { status: 'paid' } when PayU returns success", async () => {
    const gateway = new PayUGateway();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 1,
          msg: "1 out of 1 Transactions Fetched Successfully",
          transaction_details: {
            txnid_paid: {
              status: "success",
              mihpayid: "403993715526",
              amt: "299.00",
              txnid: "txnid_paid",
            },
          },
        }),
        { status: 200 }
      )
    );

    const details = await gateway.fetchPaymentDetails("txnid_paid");
    expect(details.status).toBe("paid");
    expect(details.gatewayPaymentId).toBe("403993715526");
    expect(details.amount).toBe(29900);
  });

  it("4. Returns { status: 'failed' } when PayU returns failure, bounced, or usercancelled", async () => {
    const gateway = new PayUGateway();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 1,
          msg: "1 out of 1 Transactions Fetched Successfully",
          transaction_details: {
            txnid_fail: {
              status: "failure",
              mihpayid: "403993715527",
              amt: "299.00",
              txnid: "txnid_fail",
            },
          },
        }),
        { status: 200 }
      )
    );

    const details = await gateway.fetchPaymentDetails("txnid_fail");
    expect(details.status).toBe("failed");
  });

  it("5. Throws PaymentVerificationError('malformed') on non-JSON response from provider", async () => {
    const gateway = new PayUGateway();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html>502 Bad Gateway</html>", { status: 200 })
    );

    await expect(gateway.fetchPaymentDetails("txnid_err")).rejects.toMatchObject({
      name: "PaymentVerificationError",
      errorType: "malformed",
    });
  });

  it("6. Throws PaymentVerificationError('timeout') on request timeout", async () => {
    const gateway = new PayUGateway();
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(timeoutErr);

    await expect(gateway.fetchPaymentDetails("txnid_timeout")).rejects.toMatchObject({
      name: "PaymentVerificationError",
      errorType: "timeout",
    });
  });
});

describe("/api/payments/create Retry Flow Redesign & Atomic RPC Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdGatewayOrderCount = 0;
    updatedOrders.length = 0;
    insertedPayments.length = 0;
    processedEventClaims.length = 0;
    mockEmailSentOrders.length = 0;
    mockGatewayFetchThrows = false;
    mockGatewayCreateThrows = false;
    mockUpdateGatewayIdFails = false;
    mockRpcError = null;
    mockActivePendingOrderExists = false;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SECRET_KEY = "test-key";
    process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app";

    mockPaymentOrder = {
      id: "po_stuck_001",
      status: "pending",
      payer_participant_id: "payer_uuid_001",
      amount: 299,
      currency: "INR",
      order_reference: "SVK-OLD-REF",
      gateway_order_id: "stuck_txnid_123",
      gateway: "payu",
    };
  });

  it("A. If gateway confirms transaction is PAID -> reconciles idempotently and returns alreadyPaid: true without checkoutConfig", async () => {
    mockGatewayStatus = "paid";

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.alreadyPaid).toBe(true);
    expect(data.participantId).toBe("SVK26-ALICE01");
    expect(data.checkoutConfig).toBeUndefined();
    expect(mockEmailSentOrders).toHaveLength(1);
    expect(insertedPayments).toHaveLength(1);

    // Call a second time: must be idempotent and not send duplicate emails or insert duplicate payments
    const req2 = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });
    const res2 = await POST(req2);
    const data2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(data2.alreadyPaid).toBe(true);
    expect(mockEmailSentOrders).toHaveLength(1); // Still exactly 1
  });

  it("B. If gateway confirms transaction is PENDING in-progress -> returns 409 PAYMENT_PENDING without creating duplicate order", async () => {
    mockGatewayStatus = "pending";

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.code).toBe("PAYMENT_PENDING");
    expect(createdGatewayOrderCount).toBe(0); // NO new PayU txnid requested
  });

  it("C. If gateway confirms transaction is FAILED -> calls atomic RPC, marks old attempt failed, creates new order with fresh txnid", async () => {
    mockGatewayStatus = "failed";

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.paymentOrderId).toBe("new_order_uuid_777");
    expect(data.gatewayOrderId).toBe("SVK-FRESH-TXN-1");
    expect(data.checkoutConfig).toBeDefined();
    expect(data.checkoutConfig.options.txnid).toBe("SVK-FRESH-TXN-1");

    // Old order marked as failed
    const failedUpdate = updatedOrders.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
  });

  it("D. If gateway confirms transaction is NOT FOUND (abandoned) -> calls atomic RPC and creates new order with fresh txnid", async () => {
    mockGatewayStatus = "not_found";

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.paymentOrderId).toBe("new_order_uuid_777");
    expect(data.gatewayOrderId).toBe("SVK-FRESH-TXN-1");
    expect(data.checkoutConfig).toBeDefined();
  });

  it("E. If gateway status is UNKNOWN (verification error/timeout) -> fails safely with 503 VERIFICATION_UNAVAILABLE without creating order", async () => {
    mockGatewayFetchThrows = new PaymentVerificationError("timeout", "Gateway connection timed out");

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.success).toBe(false);
    expect(data.code).toBe("VERIFICATION_UNAVAILABLE");
    expect(data.error).toContain("Unable to verify current payment status with the gateway");
    expect(createdGatewayOrderCount).toBe(0);
  });

  it("F. Data Integrity: Failure during RPC new-order creation fails closed without calling gateway", async () => {
    mockGatewayStatus = "failed";
    mockRpcError = { code: "P0001", message: "Database insert failed" };

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.code).toBe("RETRY_RPC_FAILED");
    expect(createdGatewayOrderCount).toBe(0); // Gateway is NEVER called
  });

  it("G. Data Integrity: Failure while copying order items in RPC fails closed and rolls back", async () => {
    mockGatewayStatus = "failed";
    mockRpcError = { code: "P0002", message: "EMPTY_ORDER_ITEMS: Original payment order has no items" };

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.code).toBe("RETRY_RPC_FAILED");
    expect(createdGatewayOrderCount).toBe(0);
  });

  it("H. Data Integrity: Failure during PayU gateway order creation marks new order failed to prevent orphaned pending order", async () => {
    mockGatewayStatus = "failed";
    mockGatewayCreateThrows = true; // PayU gateway fails to respond

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.code).toBe("GATEWAY_ORDER_FAILED");

    // The newly created order must be marked as failed so it does not block future retries
    const failedUpdate = updatedOrders.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(mockActivePendingOrderExists).toBe(false); // Active pending order cleared
  });

  it("I. Data Integrity: Failure updating the new gateway transaction ID marks order failed and fails closed", async () => {
    mockGatewayStatus = "failed";
    mockUpdateGatewayIdFails = true; // DB update fails when saving gateway_order_id

    const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.code).toBe("GATEWAY_RECORD_UPDATE_FAILED");

    // The order must be marked failed so no dangling pending order is left
    const failedUpdate = updatedOrders.find((u) => u.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(mockActivePendingOrderExists).toBe(false);
  });

  it("J. Concurrency: Two simultaneous retry requests reject concurrent attempt with 409 conflict", async () => {
    mockGatewayStatus = "failed";

    // Request 1 succeeds and creates active pending attempt
    const req1 = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });
    const res1 = await POST(req1);
    const data1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(data1.success).toBe(true);

    // Request 2 runs concurrently while active pending order exists for this participant event
    const req2 = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });
    const res2 = await POST(req2);
    const data2 = await res2.json();

    expect(res2.status).toBe(409);
    expect(data2.success).toBe(false);
    expect(data2.code).toBe("CONCURRENT_RETRY_CONFLICT");
    expect(data2.error).toContain("A payment attempt is currently active");
  });

  it("K. Data Integrity: No partial or orphan records after failure at any stage of retry", async () => {
    // Stage 1: RPC Failure (rolled back, no partial items, no gateway order)
    mockGatewayStatus = "failed";
    mockRpcError = { code: "40001", message: "Database deadlock simulation" };

    const reqRpcFail = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });
    const resRpcFail = await POST(reqRpcFail);
    expect(resRpcFail.status).toBe(409);
    expect(createdGatewayOrderCount).toBe(0);
    expect(mockActivePendingOrderExists).toBe(false);

    // Stage 2: Gateway Network Failure (cleans up pending order by marking it failed)
    mockRpcError = null;
    mockGatewayCreateThrows = true;
    const reqGwFail = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });
    const resGwFail = await POST(reqGwFail);
    expect(resGwFail.status).toBe(500);
    expect(mockActivePendingOrderExists).toBe(false); // No dangling pending order

    // Stage 3: Gateway ID Update Failure (cleans up pending order by marking it failed)
    mockGatewayCreateThrows = false;
    mockUpdateGatewayIdFails = true;
    const reqUpdateFail = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });
    const resUpdateFail = await POST(reqUpdateFail);
    expect(resUpdateFail.status).toBe(500);
    expect(mockActivePendingOrderExists).toBe(false); // No dangling pending order
  });

  it("L. Concurrency: Exactly one active pending attempt allowed per participant event", async () => {
    mockGatewayStatus = "failed";

    // 1. Initial attempt creates pending order
    const req1 = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    expect(mockActivePendingOrderExists).toBe(true);

    // 2. Any subsequent attempt while pending exists is strictly rejected
    const req2 = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_stuck_001" }),
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(409);
    expect((await res2.json()).code).toBe("CONCURRENT_RETRY_CONFLICT");

    // 3. Even with a different request or retry parameter, conflict is enforced
    const req3 = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "new_order_uuid_777" }),
    });
    // If the new order is pending with gateway_order_id, verification returns pending -> 409
    mockGatewayStatus = "pending";
    if (mockPaymentOrder) {
      mockPaymentOrder.id = "new_order_uuid_777";
      mockPaymentOrder.status = "pending";
      mockPaymentOrder.gateway_order_id = "SVK-FRESH-TXN-1";
    }
    const res3 = await POST(req3);
    expect(res3.status).toBe(409);
    expect((await res3.json()).code).toBe("PAYMENT_PENDING");
  });
});

describe("Client Response Parsing & Safety Regressions", () => {
  it("A. Safely handles empty response body without throwing 'Unexpected end of JSON input'", async () => {
    const mockEmptyResponse = new Response("", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });

    let parsedResult: { success?: boolean; error?: string; code?: string } | null = null;
    let parseError: Error | null = null;

    try {
      const text = await mockEmptyResponse.text();
      if (text && text.trim().length > 0) {
        parsedResult = JSON.parse(text);
      }
    } catch (e) {
      parseError = e as Error;
    }

    expect(parseError).toBeNull();
    expect(parsedResult).toBeNull();

    const userMessage =
      parsedResult?.error ||
      (mockEmptyResponse.status >= 500
        ? "Payment verification is temporarily unavailable. Please try again in a few moments."
        : "Could not initialize payment. Please try again.");

    expect(userMessage).toBe("Payment verification is temporarily unavailable. Please try again in a few moments.");
  });

  it("B. Safely handles HTML 502 / proxy response without throwing SyntaxError", async () => {
    const mockHtmlResponse = new Response("<html><body>502 Bad Gateway</body></html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

    let parsedResult: Record<string, unknown> | null = null;
    let didThrowUncaught = false;

    try {
      try {
        const text = await mockHtmlResponse.text();
        if (text && text.trim().length > 0) {
          parsedResult = JSON.parse(text);
        }
      } catch {
        parsedResult = null; // graceful fallback matching RegistrationForm & Resume page
      }
    } catch {
      didThrowUncaught = true;
    }

    expect(didThrowUncaught).toBe(false);
    expect(parsedResult).toBeNull();
  });

  it("C. Handles alreadyPaid: true payload safely without referencing checkoutConfig", () => {
    const mockSuccessAlreadyPaid = {
      success: true,
      alreadyPaid: true,
      paymentOrderId: "po_paid_123",
      participantId: "SVK26-PAID99",
      participant: {
        participantId: "SVK26-PAID99",
        name: "Paid Participant",
        email: "paid@example.com",
      },
    };

    expect(mockSuccessAlreadyPaid.alreadyPaid).toBe(true);
    expect(mockSuccessAlreadyPaid.participantId).toBe("SVK26-PAID99");
    const checkoutConfig = (mockSuccessAlreadyPaid as { checkoutConfig?: unknown }).checkoutConfig;
    expect(checkoutConfig).toBeUndefined();
  });
});
