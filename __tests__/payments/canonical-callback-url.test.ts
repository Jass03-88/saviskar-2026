import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  getCanonicalPaymentBaseUrl,
  STABLE_PRODUCTION_ORIGIN,
} from "@/lib/payments/canonical-url";
import { POST as createPaymentOrder } from "@/app/api/payments/create/route";
import { POST as payuSuccess } from "@/app/api/payments/payu/success/route";
import { POST as payuFailure } from "@/app/api/payments/payu/failure/route";
import { GET as resumePayment } from "@/app/api/payments/resume/route";
import { POST as adminRecoverPayment } from "@/app/api/admin/payments/recover/route";
import { createPaymentResumeToken } from "@/lib/payments/resume-token";

// Helper for Supabase chain mocking
function makeThenableChain(override?: () => Promise<{ data: unknown; error: unknown }>): Record<string, unknown> {
  const defaultResolve = () => override ? override() : Promise.resolve({ data: null, error: null });
  function then(this: void, onFulfilled: (v: { data: unknown; error: unknown }) => unknown) {
    return defaultResolve().then(onFulfilled);
  }
  const chain: Record<string, unknown> = {
    then, catch: () => chain, finally: () => chain, select: () => chain, eq: () => chain,
    in: () => chain, not: () => chain, is: () => chain, or: () => chain, limit: () => chain,
    order: () => chain, update: () => chain, insert: () => chain, upsert: () => chain,
    delete: () => chain, maybeSingle: defaultResolve, single: defaultResolve,
  };
  return chain;
}

let mockOrder: Record<string, unknown> | null = null;
let mockPayer: Record<string, unknown> | null = null;
let mockOrderItems: Array<Record<string, unknown>> = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "payment_orders") {
        return {
          select: () => makeThenableChain(() => Promise.resolve({ data: mockOrder, error: null })),
          update: () => makeThenableChain(),
        };
      }
      if (table === "participants") {
        return {
          select: () => makeThenableChain(() => Promise.resolve({ data: mockPayer, error: null })),
        };
      }
      if (table === "payment_order_items") {
        return {
          select: () => makeThenableChain(() => Promise.resolve({ data: mockOrderItems, error: null })),
        };
      }
      if (table === "processed_payment_events") {
        return {
          insert: () => makeThenableChain(() => Promise.resolve({ data: { id: "claim_1" }, error: null })),
        };
      }
      return makeThenableChain();
    },
  }),
}));

let mockAdminAuth: { error: string | null; status: number } = { error: null, status: 200 };

vi.mock("@/lib/supabase/server", () => ({
  requireAdmin: () => Promise.resolve(mockAdminAuth),
}));

vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: () => Promise.resolve({ authenticated: true, email: "attendee@example.com" }),
}));

vi.mock("@/lib/payments", () => ({
  getPaymentGateway: () => ({
    name: "payu",
    createOrder: () => Promise.resolve({ gatewayOrderId: "txnid_order_999", status: "pending" }),
    getCheckoutConfig: (params: { baseUrl: string }) => ({
      gateway: "payu",
      options: {
        surl: `${params.baseUrl}/api/payments/payu/success`,
        furl: `${params.baseUrl}/api/payments/payu/failure`,
      },
    }),
    fetchPaymentDetails: () => Promise.resolve({ status: "paid", gatewayPaymentId: "pay_captured_123", amount: 29900 }),
    validateWebhook: () => ({
      valid: true,
      event: { gatewayOrderId: "txnid_order_999", status: "failed" },
    }),
  }),
}));

vi.mock("@/lib/payments/post-payment", () => ({
  ensurePaymentConfirmationSent: () => Promise.resolve(),
}));

describe("Canonical Payment Callback URL & Resume Destination Hardening", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.PAYMENT_RESUME_TOKEN_SECRET = "test-secret-salt-for-saviskar-auth-32-chars-long";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "mock-secret";
    mockAdminAuth = { error: null, status: 200 };

    mockOrder = {
      id: "po_uuid_001",
      order_reference: "REF-ORD-001",
      payer_participant_id: "payer_uuid_001",
      amount: 299,
      currency: "INR",
      status: "pending",
      gateway: "payu",
      gateway_order_id: null,
    };

    mockPayer = {
      id: "payer_uuid_001",
      participant_id: "SVK26-TEST8888",
      name: "Alice Sharma",
      email: "attendee@example.com",
      phone: "9876543210",
      college: "CGC Landran",
    };

    mockOrderItems = [
      {
        id: "poi_1",
        participant_id: "payer_uuid_001",
        participant_event_id: "pe_1",
        amount: 299,
        event_id: "ev_1",
        events: {
          id: "ev_1",
          name: "Hackathon",
          category: "Technical",
        },
      },
    ];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("1. Canonical URL Resolution (getCanonicalPaymentBaseUrl)", () => {
    it("uses configured PAYMENT_CALLBACK_BASE_URL in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app";

      const res = getCanonicalPaymentBaseUrl();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe("https://saviskar-26.vercel.app");
      }
    });

    it("treats VERCEL_ENV === 'production' as production even if NODE_ENV is unset", () => {
      vi.stubEnv("NODE_ENV", "");
      vi.stubEnv("VERCEL_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app";

      const res = getCanonicalPaymentBaseUrl();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe("https://saviskar-26.vercel.app");
      }

      // Prohibited tunnel must also be rejected under VERCEL_ENV === 'production'
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://test.trycloudflare.com";
      const resBad = getCanonicalPaymentBaseUrl();
      expect(resBad.success).toBe(true);
      if (resBad.success) {
        expect(resBad.origin).toBe("https://saviskar-26.vercel.app");
      }
    });

    it("falls back to NEXT_PUBLIC_SITE_URL in production if callback var is unset", () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.PAYMENT_CALLBACK_BASE_URL;
      process.env.NEXT_PUBLIC_SITE_URL = "https://saviskar-26.vercel.app";

      const res = getCanonicalPaymentBaseUrl();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe("https://saviskar-26.vercel.app");
      }
    });

    it("defaults safely to STABLE_PRODUCTION_ORIGIN if neither env var is defined in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.PAYMENT_CALLBACK_BASE_URL;
      delete process.env.NEXT_PUBLIC_SITE_URL;

      const res = getCanonicalPaymentBaseUrl();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe(STABLE_PRODUCTION_ORIGIN);
      }
    });

    it("STRICTLY FALLS BACK for trycloudflare.com ephemeral tunnels in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL =
        "https://spreading-dans-edges-addition.trycloudflare.com";

      const res = getCanonicalPaymentBaseUrl();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe(STABLE_PRODUCTION_ORIGIN);
      }
    });

    it("STRICTLY FALLS BACK for ngrok-free.app and other ngrok tunnels in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://foo-bar.ngrok-free.app";

      const res = getCanonicalPaymentBaseUrl();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe(STABLE_PRODUCTION_ORIGIN);
      }
    });

    it("STRICTLY FALLS BACK for localhost and non-HTTPS in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3000";
      const resLocal = getCanonicalPaymentBaseUrl();
      expect(resLocal.success).toBe(true);
      if (resLocal.success) {
        expect(resLocal.origin).toBe(STABLE_PRODUCTION_ORIGIN);
      }

      process.env.PAYMENT_CALLBACK_BASE_URL = "http://saviskar-26.vercel.app";
      const resHttp = getCanonicalPaymentBaseUrl();
      expect(resHttp.success).toBe(true);
      if (resHttp.success) {
        expect(resHttp.origin).toBe(STABLE_PRODUCTION_ORIGIN);
      }
    });

    it("STRICTLY FALLS BACK for paths, queries, fragments, and credentials in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      // Path rejection
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app/api/payments";
      const resPath = getCanonicalPaymentBaseUrl();
      expect(resPath.success).toBe(true);
      if (resPath.success) expect(resPath.origin).toBe(STABLE_PRODUCTION_ORIGIN);

      // Query rejection
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app?ref=123";
      const resQuery = getCanonicalPaymentBaseUrl();
      expect(resQuery.success).toBe(true);
      if (resQuery.success) expect(resQuery.origin).toBe(STABLE_PRODUCTION_ORIGIN);

      // Fragment rejection
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app#checkout";
      const resHash = getCanonicalPaymentBaseUrl();
      expect(resHash.success).toBe(true);
      if (resHash.success) expect(resHash.origin).toBe(STABLE_PRODUCTION_ORIGIN);

      // Credential rejection
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://user:pass@saviskar-26.vercel.app";
      const resCred = getCanonicalPaymentBaseUrl();
      expect(resCred.success).toBe(true);
      if (resCred.success) expect(resCred.origin).toBe(STABLE_PRODUCTION_ORIGIN);
    });

    it("STRICTLY FALLS BACK for arbitrary third-party HTTPS domains in production", () => {
      vi.stubEnv("NODE_ENV", "production");

      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar.co.in"; // Netlify site
      const resNetlify = getCanonicalPaymentBaseUrl();
      expect(resNetlify.success).toBe(true);
      if (resNetlify.success) {
        expect(resNetlify.origin).toBe(STABLE_PRODUCTION_ORIGIN);
      }

      process.env.PAYMENT_CALLBACK_BASE_URL = "https://attacker-domain.com";
      const resAttacker = getCanonicalPaymentBaseUrl();
      expect(resAttacker.success).toBe(true);
      if (resAttacker.success) {
        expect(resAttacker.origin).toBe(STABLE_PRODUCTION_ORIGIN);
      }
    });

    it("allows dynamic request origin in local development", () => {
      vi.stubEnv("NODE_ENV", "development");
      delete process.env.PAYMENT_CALLBACK_BASE_URL;
      delete process.env.NEXT_PUBLIC_SITE_URL;

      const req = new NextRequest("http://localhost:3000/api/payments/create", {
        headers: { host: "my-dev-tunnel.ngrok.app", "x-forwarded-proto": "https" },
      });

      const res = getCanonicalPaymentBaseUrl(req);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.origin).toBe("https://my-dev-tunnel.ngrok.app");
      }
    });
  });

  describe("2. Order Creation (/api/payments/create)", () => {
    it("constructs PayU callback URLs strictly with canonical origin in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app";

      const req = new NextRequest("https://attacker.com/api/payments/create", {
        method: "POST",
        headers: { host: "attacker.com", "x-forwarded-host": "attacker.com" },
        body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
      });

      const res = await createPaymentOrder(req);
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.checkoutConfig.options.surl).toBe("https://saviskar-26.vercel.app/api/payments/payu/success");
      expect(data.checkoutConfig.options.furl).toBe("https://saviskar-26.vercel.app/api/payments/payu/failure");
    });

    it("succeeds and uses canonical fallback if tunnel URL is configured in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL =
        "https://spreading-dans-edges-addition.trycloudflare.com";

      const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/create", {
        method: "POST",
        body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
      });

      const res = await createPaymentOrder(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.checkoutConfig.options.surl).toBe("https://saviskar-26.vercel.app/api/payments/payu/success");
    });
  });

  describe("3. PayU Success & Failure Redirect Alignment", () => {
    it("redirects PayU success to canonical /payment/resume origin", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app";
      mockOrder!.gateway_order_id = "txnid_order_999";

      const body = "txnid=txnid_order_999&mihpayid=pay_captured_123&status=success&amount=299.00&firstname=Alice&email=attendee@example.com&hash=validhash";

      const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/payu/success", {
        method: "POST",
        body,
      });

      const res = await payuSuccess(req);
      expect(res.status).toBe(303);
      const redirectLocation = res.headers.get("location");
      expect(redirectLocation).toBeDefined();

      const redirectUrl = new URL(redirectLocation!);
      expect(redirectUrl.origin).toBe("https://saviskar-26.vercel.app");
      expect(redirectUrl.pathname).toBe("/payment/resume");
      expect(redirectUrl.searchParams.get("token")).toBeTruthy();
    });

    it("redirects PayU failure to canonical /payment/resume origin", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app";
      mockOrder!.gateway_order_id = "txnid_order_999";

      const body = "txnid=txnid_order_999&mihpayid=pay_failed_123&status=failure&amount=299.00&firstname=Alice&email=attendee@example.com&hash=validhash";

      const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/payu/failure", {
        method: "POST",
        body,
      });

      const res = await payuFailure(req);
      expect(res.status).toBe(303);
      const redirectLocation = res.headers.get("location");
      expect(redirectLocation).toBeDefined();

      const redirectUrl = new URL(redirectLocation!);
      expect(redirectUrl.origin).toBe("https://saviskar-26.vercel.app");
      expect(redirectUrl.pathname).toBe("/payment/resume");
      expect(redirectUrl.searchParams.get("token")).toBeTruthy();
    });

    it("falls back to STABLE_PRODUCTION_ORIGIN if trycloudflare is present during success callback", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.NEXT_PUBLIC_SITE_URL = "https://spreading-dans-edges-addition.trycloudflare.com";
      delete process.env.PAYMENT_CALLBACK_BASE_URL;
      mockOrder!.gateway_order_id = "txnid_order_999";

      const body = "txnid=txnid_order_999&mihpayid=pay_captured_123&status=success&amount=299.00&firstname=Alice&email=attendee@example.com&hash=validhash";

      const req = new NextRequest("https://saviskar-26.vercel.app/api/payments/payu/success", {
        method: "POST",
        body,
      });

      const res = await payuSuccess(req);
      const redirectUrl = new URL(res.headers.get("location")!);

      // Must never send attendee to dead tunnel:
      expect(redirectUrl.origin).toBe("https://saviskar-26.vercel.app");
      expect(redirectUrl.origin).not.toContain("trycloudflare.com");
    });
  });

  describe("4. Resume Endpoint Returns Participant ID on Paid Status", () => {
    it("returns paid status and public participantId for QR code generation", async () => {
      mockOrder!.status = "paid";

      const token = createPaymentResumeToken({
        paymentOrderId: "po_uuid_001",
        participantId: "SVK26-TEST8888",
        payerParticipantUuid: "payer_uuid_001",
      });

      const req = new NextRequest(`https://saviskar-26.vercel.app/api/payments/resume?token=${encodeURIComponent(token)}`);
      const res = await resumePayment(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe("paid");
      expect(data.participant).toBeDefined();
      expect(data.participant.participantId).toBe("SVK26-TEST8888");
      expect(data.participant.name).toBe("Alice Sharma");
    });
  });

  describe("5. Authenticated Admin Payment Recovery (/api/admin/payments/recover)", () => {
    it("rejects unauthenticated requests with 401", async () => {
      mockAdminAuth = { error: "UNAUTHORIZED", status: 401 };

      const req = new NextRequest("https://saviskar-26.vercel.app/api/admin/payments/recover", {
        method: "POST",
        body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
      });

      const res = await adminRecoverPayment(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("generates a fresh signed payment resume link for a paid order using canonical origin", async () => {
      vi.stubEnv("NODE_ENV", "production");
      process.env.PAYMENT_CALLBACK_BASE_URL = "https://saviskar-26.vercel.app";
      mockOrder!.status = "paid";

      const req = new NextRequest("https://saviskar-26.vercel.app/api/admin/payments/recover", {
        method: "POST",
        body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
      });

      const res = await adminRecoverPayment(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.paymentOrderId).toBe("po_uuid_001");
      expect(data.participantId).toBe("SVK26-TEST8888");
      expect(data.resumeToken).toBeTruthy();

      const resumeUrl = new URL(data.resumeUrl);
      expect(resumeUrl.origin).toBe("https://saviskar-26.vercel.app");
      expect(resumeUrl.pathname).toBe("/payment/resume");
      expect(resumeUrl.searchParams.get("token")).toBe(data.resumeToken);
    });

    it("rejects recovery for an order that is not paid", async () => {
      mockOrder!.status = "pending";

      const req = new NextRequest("https://saviskar-26.vercel.app/api/admin/payments/recover", {
        method: "POST",
        body: JSON.stringify({ paymentOrderId: "po_uuid_001" }),
      });

      const res = await adminRecoverPayment(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("Payment order is not paid");
    });

    it("handles recovery by participantId and triggers idempotent email re-dispatch when requested", async () => {
      mockOrder!.status = "paid";
      mockOrder!.receipt_email_sent_at = "2026-09-29T10:00:00Z";

      const req = new NextRequest("https://saviskar-26.vercel.app/api/admin/payments/recover", {
        method: "POST",
        body: JSON.stringify({ participantId: "SVK26-TEST8888", resendEmail: true }),
      });

      const res = await adminRecoverPayment(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.participantId).toBe("SVK26-TEST8888");
      expect(data.emailDispatched).toBe(true);
      expect(data.resumeUrl).toContain("https://saviskar-26.vercel.app/payment/resume");
    });
  });
});
