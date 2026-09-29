import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/payments/create/route";
import { GET } from "@/app/api/payments/resume/route";
import { NextRequest } from "next/server";

// Mock Supabase
function makeThenableChain(maybySingleOverride?: () => Promise<{ data: unknown; error: unknown }>): Record<string, unknown> {
  const defaultResolve = () => maybySingleOverride ? maybySingleOverride() : Promise.resolve({ data: null, error: null });
  const terminalFn = defaultResolve;
  function then(this: void, onFulfilled: (v: { data: unknown; error: unknown }) => unknown) {
    return defaultResolve().then(onFulfilled);
  }
  const chain: Record<string, unknown> = {
    then, catch: () => chain, finally: () => chain, select: () => chain, eq: () => chain,
    in: () => chain, not: () => chain, is: () => chain, or: () => chain, limit: () => chain,
    order: () => chain, update: () => chain, insert: () => chain, upsert: () => chain,
    delete: () => chain, maybeSingle: terminalFn, single: terminalFn,
  };
  return chain;
}

let mockPaymentOrder: Record<string, unknown> | null = null;
let mockGatewayStatus: string | null = null;
let mockGatewayFetchThrows = false;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (name: string) => {
      if (name === "create_payment_retry_attempt") {
        return Promise.resolve({
          data: {
            success: true,
            old_order_id: "po_uuid_001",
            new_order_id: "new_po_uuid_002",
            order_reference: "SVK-NEW-1",
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
          update: () => makeThenableChain(),
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  id: "new_po_uuid_002",
                  order_reference: "SVK-NEW-1",
                  payer_participant_id: "payer_uuid_001",
                  amount: 299,
                  currency: "INR",
                  status: "pending",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "participants") {
        return {
          select: () => makeThenableChain(() => Promise.resolve({
            data: { id: "payer_uuid_001", participant_id: "SVK-123", name: "Alice", email: "alice@example.com" },
            error: null
          })),
        };
      }
      if (table === "payment_order_items") {
        return {
          select: () => makeThenableChain(() => Promise.resolve({
            data: [{ participant_event_id: "pe-1", participant_id: "payer_uuid_001" }],
            error: null
          })),
          insert: () => makeThenableChain(),
        };
      }
      if (table === "processed_payment_events") {
        return {
          insert: () => makeThenableChain(() => Promise.resolve({ data: { id: "claim_1" }, error: null })),
        }
      }
      return makeThenableChain();
    }
  })
}));

vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: () => Promise.resolve({ authenticated: true, email: "alice@example.com" }),
}));

vi.mock("@/lib/payments", () => ({
  getPaymentGateway: () => ({
    name: "payu",
    createOrder: () => Promise.resolve({ gatewayOrderId: "new_gateway_order_id", status: "pending" }),
    getCheckoutConfig: (params: { baseUrl: string }) => ({
      gateway: "payu",
      options: { surl: `${params.baseUrl}/api/payments/payu/success` }
    }),
    fetchPaymentDetails: () => {
      if (mockGatewayFetchThrows) return Promise.reject(new Error("Network Error"));
      return Promise.resolve({ status: mockGatewayStatus, gatewayPaymentId: "pay_123" });
    }
  })
}));

vi.mock("@/lib/payments/post-payment", () => ({
  ensurePaymentConfirmationSent: vi.fn(),
}));

describe("P0 Fixes: Callback URL Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPaymentOrder = {
      id: "po_uuid_001",
      status: "pending",
      payer_participant_id: "payer_uuid_001",
      amount: 299,
      currency: "INR",
      order_reference: "REF-1",
      gateway_order_id: null // fresh order
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SECRET_KEY = "test-key";
  });

  it("1. Production uses configured callback origin and ignores malicious Host header", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app";
    
    const req = new NextRequest("https://attacker.com/api/payments/create", {
      method: "POST",
      headers: { "host": "attacker.com", "x-forwarded-host": "attacker.com" },
      body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checkoutConfig.options.surl).toBe("https://saviskar-26.vercel.app/api/payments/payu/success");
  });

  it("2. Local development can use dynamic public tunnel origin", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: { "host": "dynamic-tunnel.ngrok.app", "x-forwarded-proto": "https" },
      body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
    });

    const res = await POST(req);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.checkoutConfig.options.surl).toBe("https://dynamic-tunnel.ngrok.app/api/payments/payu/success");
  });
});

describe("P0 Fixes: Stuck Transaction Recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    mockPaymentOrder = {
      id: "po_uuid_001",
      status: "pending",
      payer_participant_id: "payer_uuid_001",
      amount: 299,
      currency: "INR",
      order_reference: "REF-1",
      gateway_order_id: "existing_txnid" 
    };
  });

  it("3. Already-captured PayU transaction recovers and settles without creating new checkout", async () => {
    mockGatewayStatus = "paid"; // Simulate PayU saying it's captured
    mockGatewayFetchThrows = false;

    const req = new NextRequest("http://localhost/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
    });

    const res = await POST(req);
    const data = await res.json();
    
    expect(data.success).toBe(true);
    expect(data.alreadyPaid).toBe(true);
    expect(data.checkoutConfig).toBeUndefined(); // DOES NOT launch checkout
    
    const { ensurePaymentConfirmationSent } = await import("@/lib/payments/post-payment");
    expect(ensurePaymentConfirmationSent).toHaveBeenCalledWith("po_uuid_001");
  });

  it("4. Pending transaction in progress fails safely with 409 PAYMENT_PENDING", async () => {
    mockGatewayStatus = "pending"; // PayU says pending
    mockGatewayFetchThrows = false;

    const req = new NextRequest("http://localhost/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
    });

    const res = await POST(req);
    const data = await res.json();
    
    expect(data.success).toBe(false);
    expect(data.code).toBe("PAYMENT_PENDING");
    expect(res.status).toBe(409);
  });

  it("5. Malformed Verify Payment response or timeout fails safely with 503 VERIFICATION_UNAVAILABLE", async () => {
    mockGatewayFetchThrows = true;

    const req = new NextRequest("http://localhost/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
    });

    const res = await POST(req);
    const data = await res.json();
    
    expect(data.success).toBe(false);
    expect(data.code).toBe("VERIFICATION_UNAVAILABLE");
    expect(data.error).toContain("Unable to verify current payment status with the gateway");
    expect(res.status).toBe(503);
  });

  it("6. Failed or abandoned transaction safely creates new payment attempt with fresh txnid", async () => {
    mockGatewayStatus = "failed"; // PayU says failed/dropped
    mockGatewayFetchThrows = false;

    const req = new NextRequest("http://localhost/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.paymentOrderId).toBe("new_po_uuid_002");
    expect(data.gatewayOrderId).toBe("new_gateway_order_id");
    expect(data.checkoutConfig).toBeDefined();
    expect(res.status).toBe(200);
  });
});

describe("P0 Fixes: Resume Endpoint Fallback", () => {
  it("7. resume endpoint always returns JSON on failure", async () => {
    // missing token -> triggers errorResponse
    const req = new NextRequest("http://localhost/api/payments/resume");
    const res = await GET(req);
    expect(res.headers.get("content-type")).toContain("application/json");
    
    const data = await res.json();
    expect(data.success).toBe(false);
  });
});
