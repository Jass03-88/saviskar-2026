import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/payments/create/route";
import { NextRequest } from "next/server";
import { createRegistrationSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createPaymentResumeToken } from "@/lib/payments/resume-token";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key-32bytes-for-hmac";
process.env.SESSION_SECRET = "test-session-secret-high-entropy-32bytes";
process.env.PAYMENT_RESUME_TOKEN_SECRET = "test-resume-secret-high-entropy-32bytes";

const mockDbPaymentOrders: Record<string, Record<string, unknown>> = {
  "po-valid-pending": {
    id: "po-valid-pending",
    order_reference: "SVK-ORDER-001",
    payer_participant_id: "part-uuid-alice",
    amount: 500,
    currency: "INR",
    status: "pending",
    gateway: null,
    gateway_order_id: null,
  },
  "po-already-paid": {
    id: "po-already-paid",
    order_reference: "SVK-ORDER-002",
    payer_participant_id: "part-uuid-alice",
    amount: 500,
    currency: "INR",
    status: "paid",
    gateway: "payu",
    gateway_order_id: "order_ALREADY_PAID",
  },
  "po-user-bob": {
    id: "po-user-bob",
    order_reference: "SVK-ORDER-003",
    payer_participant_id: "part-uuid-bob",
    amount: 800,
    currency: "INR",
    status: "pending",
    gateway: null,
    gateway_order_id: null,
  },
};

const mockDbParticipants: Record<string, Record<string, unknown>> = {
  "part-uuid-alice": {
    id: "part-uuid-alice",
    participant_id: "SVK26-ALICE001",
    name: "Alice Smith",
    email: "alice@example.com",
    phone: "9876543210",
  },
  "part-uuid-bob": {
    id: "part-uuid-bob",
    participant_id: "SVK26-BOB00002",
    name: "Bob Jones",
    email: "bob@example.com",
    phone: "9123456780",
  },
};

const mockDbOrderItems: Record<string, Array<Record<string, unknown>>> = {
  "po-valid-pending": [
    {
      id: "item-1",
      participant_id: "part-uuid-alice",
      participant_event_id: "pe-alice-1",
      amount: 500,
    },
  ],
  "po-already-paid": [
    {
      id: "item-2",
      participant_id: "part-uuid-alice",
      participant_event_id: "pe-alice-2",
      amount: 500,
    },
  ],
  "po-user-bob": [
    {
      id: "item-3",
      participant_id: "part-uuid-bob",
      participant_event_id: "pe-bob-1",
      amount: 800,
    },
  ],
};

let capturedCreateOrderParams: unknown = null;

vi.mock("@/lib/payments", () => ({
  getPaymentGateway: () => ({
    name: "payu",
    createOrder: async (params: unknown) => {
      capturedCreateOrderParams = params;
      return {
        gatewayOrderId: "order_GATEWAY_NEW_123",
        status: "created",
      };
    },
    getCheckoutConfig: (params: Record<string, unknown>) => ({
      gateway: "payu",
      options: {
        key: "payu_test_key",
        amount: params.amount,
        currency: params.currency,
        order_id: params.gatewayOrderId,
      },
    }),
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            if (table === "payment_orders") {
              return { data: mockDbPaymentOrders[val] || null, error: null };
            }
            if (table === "participants") {
              return { data: mockDbParticipants[val] || null, error: null };
            }
            return { data: null, error: null };
          },
          then: (resolve: (val: unknown) => void) => {
            if (table === "payment_order_items") {
              resolve({ data: mockDbOrderItems[val] || [], error: null });
            } else {
              resolve({ data: null, error: null });
            }
          },
        }),
      }),
      update: () => ({
        eq: () => ({
          then: (resolve: (val: unknown) => void) => resolve({ error: null }),
        }),
      }),
    }),
  }),
}));

const mockCookieStore: Map<string, string> = new Map();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const val = mockCookieStore.get(name);
      return val ? { name, value: val } : undefined;
    },
    set: (name: string, val: string) => {
      mockCookieStore.set(name, val);
    },
    delete: (name: string) => {
      mockCookieStore.delete(name);
    },
  }),
}));

function makeRequest(
  body: Record<string, unknown>,
  headersObj?: Record<string, string>
): NextRequest {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...(headersObj || {}),
  });

  return new NextRequest("http://localhost/api/payments/create", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("Section 6 & 8: Payment Create Authorization & Amount Authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieStore.clear();
    capturedCreateOrderParams = null;
  });

  it("1. No authentication -> rejected with 401", async () => {
    const req = makeRequest({ paymentOrderId: "po-valid-pending" });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("authorization required");
  });

  it("2. User B session attempting to create payment for User A order -> rejected with 403", async () => {
    const bobSession = createRegistrationSessionToken("bob@example.com", 60_000);
    mockCookieStore.set(SESSION_COOKIE_NAME, bobSession);

    // po-valid-pending belongs to Alice!
    const req = makeRequest({ paymentOrderId: "po-valid-pending" });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Unauthorized access");
  });

  it("3. Valid session of Alice accessing Alice's order -> 200 and loads DB amount", async () => {
    const aliceSession = createRegistrationSessionToken("alice@example.com", 60_000);
    mockCookieStore.set(SESSION_COOKIE_NAME, aliceSession);

    const req = makeRequest({
      paymentOrderId: "po-valid-pending",
      amount: 1, // Fake client amount attempting to override DB
      currency: "USD", // Fake client currency
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.gatewayOrderId).toBe("order_GATEWAY_NEW_123");

    // Authoritative check: amount must be DB amount (500 * 100 paise = 50000 paise)
    expect(capturedCreateOrderParams).toMatchObject({
      amountInSmallestUnit: 50000,
      currency: "INR",
    });
  });

  it("4. Valid signed payment resume token authorizes payment creation without session", async () => {
    const token = createPaymentResumeToken({
      paymentOrderId: "po-valid-pending",
      participantId: "SVK26-ALICE001",
      payerParticipantUuid: "part-uuid-alice",
      expiresInMs: 60_000,
      secretOverride: process.env.PAYMENT_RESUME_TOKEN_SECRET,
    });

    const req = makeRequest(
      { paymentOrderId: "po-valid-pending", resumeToken: token },
      { "x-payment-resume-token": token }
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("5. Tampered or expired resume token -> rejected with 403", async () => {
    const req = makeRequest({
      paymentOrderId: "po-valid-pending",
      resumeToken: "malformed.or.tampered.token",
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it("6. Mismatched resume tokens in header vs body -> rejected with 400", async () => {
    const req = makeRequest(
      { paymentOrderId: "po-valid-pending", resumeToken: "tokenA" },
      { "x-payment-resume-token": "tokenB" }
    );
    const res = await POST(req);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Mismatched payment resume tokens");
  });

  it("7. Resume token for User B cannot be used for User A order -> rejected with 403", async () => {
    const bobToken = createPaymentResumeToken({
      paymentOrderId: "po-user-bob",
      participantId: "SVK26-BOB00002",
      payerParticipantUuid: "part-uuid-bob",
      expiresInMs: 60_000,
      secretOverride: process.env.PAYMENT_RESUME_TOKEN_SECRET,
    });

    // Attempt to authorize Alice's order using Bob's resume token
    const req = makeRequest({
      paymentOrderId: "po-valid-pending",
      resumeToken: bobToken,
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it("8. Attempt to create payment for an already-paid order -> returns alreadyPaid contract without checkoutConfig", async () => {
    const aliceSession = createRegistrationSessionToken("alice@example.com", 60_000);
    mockCookieStore.set(SESSION_COOKIE_NAME, aliceSession);

    const req = makeRequest({ paymentOrderId: "po-already-paid" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.alreadyPaid).toBe(true);
    expect(data.participantId).toBeDefined();
    expect(data.checkoutConfig).toBeUndefined();
  });
});
