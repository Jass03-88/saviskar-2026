import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/payments/webhook/route";
import { NextRequest } from "next/server";
import crypto from "crypto";

const TEST_SALT = "test-salt-for-webhook";
const TEST_KEY = "test-key-for-webhook";

function makeThenableChain(maybySingleOverride?: () => Promise<{ data: unknown; error: unknown }>): Record<string, unknown> {
  const defaultResolve = () => Promise.resolve({ data: null, error: null });
  const terminalFn = maybySingleOverride ?? defaultResolve;
  function then(this: void, onFulfilled: (v: { data: null; error: null }) => unknown) {
    return Promise.resolve({ data: null, error: null }).then(onFulfilled);
  }
  const chain: Record<string, unknown> = {
    then, catch: () => chain, finally: () => chain, select: () => chain, eq: () => chain,
    in: () => chain, not: () => chain, is: () => chain, or: () => chain, limit: () => chain, neq: () => chain,
    order: () => chain, update: () => chain, insert: () => chain, upsert: () => chain,
    delete: () => chain, maybeSingle: terminalFn, single: terminalFn,
  };
  return chain;
}

type MockRpcResponse = {
  data: { success: boolean; action?: string; error?: string } | null;
  error: { code: string; message: string } | null;
};

let mockRpcImplementation: (rpcName: string, args?: any) => Promise<MockRpcResponse> = 
  (rpcName: string, args?: any) => Promise.resolve({ data: null, error: null });

vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: () => ({
      rpc: (rpcName: string, args: any) => mockRpcImplementation(rpcName, args),
      from: (table: string) => {
        if (table === "payment_orders") {
          return {
            select: () => makeThenableChain(() => Promise.resolve({
              data: {
                id: "po_uuid_001",
                status: "pending",
                payer_participant_id: "payer_uuid_001",
                amount: 299,
                currency: "INR",
                gateway_order_id: "txnid_001"
              },
              error: null,
            })),
            update: () => makeThenableChain(),
          };
        }
        return makeThenableChain();
      }
    })
  }
});

vi.mock("@/lib/payments/post-payment", () => ({
  ensurePaymentConfirmationSent: vi.fn(),
}));

describe("PayU Webhook Idempotency & Reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAYU_ENVIRONMENT = "test";
    process.env.PAYU_KEY = TEST_KEY;
    process.env.PAYU_SALT = TEST_SALT;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SECRET_KEY = "test-service-role-key-concurrent";
  });

  const getHash = (amount: string, status: string = "success") => {
    const hashString = `${TEST_SALT}|${status}|||||||||||test@example.com|Test|info|${amount}|txnid_001|${TEST_KEY}`;
    return crypto.createHash("sha512").update(hashString).digest("hex").toLowerCase();
  };

  const makeReq = (amount: string, status: string = "success") => {
    const body = new URLSearchParams({
      status, email: "test@example.com", firstname: "Test", productinfo: "info",
      amount, txnid: "txnid_001", key: TEST_KEY, mihpayid: "pay_001", hash: getHash(amount, status)
    });
    return new NextRequest("http://localhost/api/payments/webhook", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  };

  it("1. Already-paid order with a valid receipt (Idempotent Success)", async () => {
    mockRpcImplementation = (rpcName) => {
      if (rpcName === "process_payment_success") return Promise.resolve({ data: { success: true, action: "already_paid" }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const res = await POST(makeReq("299.00"));
    expect(res.status).toBe(200);
  });

  it("2. Already-paid order with a missing receipt (Reconciliation Error)", async () => {
    mockRpcImplementation = (rpcName) => {
      if (rpcName === "process_payment_success") return Promise.resolve({ data: { success: false, error: "Reconciliation Error: Order is paid but has 0 receipts" }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const res = await POST(makeReq("299.00"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Reconciliation Error");
  });

  it("3. Already-paid order with a conflicting receipt (Reconciliation Error)", async () => {
    mockRpcImplementation = (rpcName) => {
      if (rpcName === "process_payment_success") return Promise.resolve({ data: { success: false, error: "Reconciliation Error: Receipt fields do not match canonical order" }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const res = await POST(makeReq("299.00"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Receipt fields do not match");
  });

  it("4. Exact retry vs conflicting gateway ID/amount/currency", async () => {
    mockRpcImplementation = (rpcName) => {
      if (rpcName === "process_payment_success") return Promise.resolve({ data: { success: false, error: "Conflict: Order already paid with a different gateway payment ID, amount, or currency" }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const res = await POST(makeReq("299.00"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Conflict: Order already paid with a different");
  });

  it("5. Gateway payment ID reused across different orders (Conflict)", async () => {
    mockRpcImplementation = (rpcName) => {
      if (rpcName === "process_payment_success") return Promise.resolve({ data: { success: false, error: "Conflict: Gateway payment ID is already associated with a different order" }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const res = await POST(makeReq("299.00"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Gateway payment ID is already associated with a different order");
  });

  it("6. Missing RPC (Capability Gate)", async () => {
    mockRpcImplementation = (rpcName) => {
      return Promise.resolve({ data: null, error: { code: "PGRST202", message: "function process_payment_success does not exist" } });
    };
    const res = await POST(makeReq("299.00"));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Service temporarily unavailable during upgrade");
  });

  it("7. Transient database failure", async () => {
    mockRpcImplementation = (rpcName) => {
      return Promise.resolve({ data: null, error: { code: "53300", message: "too many connections" } });
    };
    const res = await POST(makeReq("299.00"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Database error");
  });
});
