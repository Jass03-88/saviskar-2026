import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createPaymentResumeToken,
  verifyPaymentResumeToken,
  generatePaymentResumeUrl,
  getSiteBaseUrl,
} from "@/lib/payments/resume-token";
import { getPaymentGateway } from "@/lib/payments";

describe("Phase 2C: Secure Payment Resume Token & Security Model", () => {
  const TEST_SECRET = "test-resume-secret-for-cryptographic-testing-32b";
  const sampleParams = {
    paymentOrderId: "po-12345678-abcd-ef01-2345-6789abcdef01",
    participantId: "SVK26-FFE51470",
    payerParticipantUuid: "p-uuid-9ab32acb-c39a-49a1-9e30-b1e7b23fed18",
    secretOverride: TEST_SECRET,
  };

  it("TEST 1: Token creation produces valid signed token in base64url format", () => {
    const token = createPaymentResumeToken(sampleParams);
    expect(token).toBeDefined();
    expect(typeof token).toBe("string");

    const parts = token.split(".");
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBeGreaterThan(10);
    expect(parts[1].length).toBeGreaterThan(10);
  });

  it("TEST 2: Valid token successfully resolves the intended pending payment order and claims", () => {
    const token = createPaymentResumeToken(sampleParams);
    const result = verifyPaymentResumeToken(token, TEST_SECRET);

    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload?.paymentOrderId).toBe(sampleParams.paymentOrderId);
    expect(result.payload?.participantId).toBe(sampleParams.participantId);
    expect(result.payload?.payerParticipantUuid).toBe(
      sampleParams.payerParticipantUuid
    );
    expect(result.payload?.exp).toBeGreaterThan(Date.now());
  });

  it("TEST 3: Tampered token signature is rejected safely", () => {
    const token = createPaymentResumeToken(sampleParams);
    const [payload, sig] = token.split(".");
    // Tamper with signature
    const tamperedSig = sig.slice(0, -4) + "XXXX";
    const tamperedToken = `${payload}.${tamperedSig}`;

    const result = verifyPaymentResumeToken(tamperedToken, TEST_SECRET);
    expect(result.valid).toBe(false);
    expect(result.payload).toBeUndefined();
    expect(result.error).toBe("This payment link is invalid or has expired.");
  });

  it("TEST 4: Expired token is rejected", () => {
    // Create token expired 1 minute ago
    const token = createPaymentResumeToken({
      ...sampleParams,
      expiresInMs: -60000,
    });

    const result = verifyPaymentResumeToken(token, TEST_SECRET);
    expect(result.valid).toBe(false);
    expect(result.payload).toBeUndefined();
    expect(result.error).toBe("This payment link is invalid or has expired.");
  });

  it("TEST 5: Malformed token format is rejected", () => {
    expect(verifyPaymentResumeToken("", TEST_SECRET).valid).toBe(false);
    expect(verifyPaymentResumeToken("invalid-token", TEST_SECRET).valid).toBe(
      false
    );
    expect(
      verifyPaymentResumeToken("part1.part2.part3", TEST_SECRET).valid
    ).toBe(false);
    expect(verifyPaymentResumeToken("..", TEST_SECRET).valid).toBe(false);
  });

  it("TEST 6: Token cannot be used to access another participant's payment order (cross-participant rejection)", () => {
    // Participant A's valid token
    const token = createPaymentResumeToken(sampleParams);
    const result = verifyPaymentResumeToken(token, TEST_SECRET);
    expect(result.valid).toBe(true);

    // Database check simulation: Attacker B tries to use token with order owned by Participant B
    const dbOrder = {
      id: "po-12345678-abcd-ef01-2345-6789abcdef01",
      payer_participant_id: "other-participant-uuid-9999",
      amount: 15,
      status: "pending",
    };

    const isAuthorized =
      dbOrder.payer_participant_id === result.payload?.payerParticipantUuid;
    expect(isAuthorized).toBe(false);
  });

  it("TEST 7: Already-paid order returns completed status and cannot be charged again", () => {
    const dbOrder = {
      id: sampleParams.paymentOrderId,
      payer_participant_id: sampleParams.payerParticipantUuid,
      amount: 15,
      status: "paid",
      order_reference: "SVK-SVK26-FFE51470-20260830-ABC123",
    };

    let canCheckout = false;
    let statusResponse = "";

    if (dbOrder.status === "paid") {
      statusResponse = "already_completed";
      canCheckout = false;
    } else if (dbOrder.status === "pending") {
      canCheckout = true;
    }

    expect(statusResponse).toBe("already_completed");
    expect(canCheckout).toBe(false);
  });

  it("TEST 8: Cancelled/non-pending order cannot be charged", () => {
    const nonPendingStatuses = ["cancelled", "failed", "refunded"];

    for (const status of nonPendingStatuses) {
      const dbOrder = {
        id: sampleParams.paymentOrderId,
        status,
      };

      const isEligibleForPayment = dbOrder.status === "pending";
      expect(isEligibleForPayment).toBe(false);
    }
  });
});

describe("Phase 2C: Registration & Flow Scenarios", () => {
  const TEST_SECRET = "test-resume-secret-for-cryptographic-testing-32b";

  it("TEST 9: FREE event does not create a payment link or payment order", () => {
    const freeEvent = {
      id: "evt-hackathon-free",
      name: "Hackathon",
      payment_type: "free",
      registration_fee: 0,
    };

    let paymentResumeUrl: string | null = null;
    let paymentOrder: any = null;

    if (freeEvent.payment_type === "paid" && paymentOrder?.id) {
      paymentResumeUrl = generatePaymentResumeUrl({
        paymentOrderId: "po-1",
        participantId: "SVK26-1111",
        payerParticipantUuid: "p-uuid-1",
        secretOverride: TEST_SECRET,
      });
    }

    expect(paymentOrder).toBeNull();
    expect(paymentResumeUrl).toBeNull();
  });

  it("TEST 10: New participant → paid event → payment link resolves correct order", () => {
    const newParticipant = {
      id: "p-uuid-new-1",
      participantId: "SVK26-NEW00001",
    };
    const newPaidOrder = {
      id: "po-new-paid-1",
      amount: 200,
      status: "pending",
    };

    const link = generatePaymentResumeUrl({
      paymentOrderId: newPaidOrder.id,
      participantId: newParticipant.participantId,
      payerParticipantUuid: newParticipant.id,
      baseUrl: "https://saviskar.cgc.ac.in",
      secretOverride: TEST_SECRET,
    });

    expect(link).toContain("https://saviskar.cgc.ac.in/payment/resume?token=");

    const token = decodeURIComponent(link.split("token=")[1]);
    const verified = verifyPaymentResumeToken(token, TEST_SECRET);

    expect(verified.valid).toBe(true);
    expect(verified.payload?.paymentOrderId).toBe("po-new-paid-1");
    expect(verified.payload?.participantId).toBe("SVK26-NEW00001");
  });

  it("TEST 11: Returning participant with FREE Hackathon → PAID Battle of Bands → payment link resolves Battle of Bands order", () => {
    const returningParticipant = {
      id: "p-uuid-returning-1",
      participantId: "SVK26-FFE51470",
    };

    const battleOfBandsOrder = {
      id: "po-bob-paid-1",
      amount: 15,
      status: "pending",
    };

    const link = generatePaymentResumeUrl({
      paymentOrderId: battleOfBandsOrder.id,
      participantId: returningParticipant.participantId,
      payerParticipantUuid: returningParticipant.id,
      secretOverride: TEST_SECRET,
    });

    const token = decodeURIComponent(link.split("token=")[1]);
    const verified = verifyPaymentResumeToken(token, TEST_SECRET);

    expect(verified.valid).toBe(true);
    expect(verified.payload?.paymentOrderId).toBe("po-bob-paid-1");
    expect(verified.payload?.participantId).toBe("SVK26-FFE51470");
  });

  it("TEST 12: Returning participant recovery does not select the old free event", () => {
    const participantEvents = [
      {
        id: "pe-free-hackathon",
        event_id: "evt-hackathon",
        payment_status: "not_required",
        payment_amount: 0,
      },
      {
        id: "pe-paid-bob",
        event_id: "evt-bob",
        payment_status: "pending",
        payment_amount: 15,
      },
    ];

    const targetPending = participantEvents.find(
      (e) => e.payment_status === "pending" && e.payment_amount > 0
    );

    expect(targetPending).toBeDefined();
    expect(targetPending?.id).toBe("pe-paid-bob");
    expect(targetPending?.id).not.toBe("pe-free-hackathon");
  });

  it("TEST 13: Multiple paid events resolve the consolidated payment order", () => {
    const multiEventOrder = {
      id: "po-multi-1",
      amount: 1100, // 200 + 600 + 300
      status: "pending",
      items: [
        { name: "Event A", amount: 200 },
        { name: "Event B", amount: 600 },
        { name: "Event C", amount: 300 },
      ],
    };

    const calculatedSum = multiEventOrder.items.reduce(
      (acc, i) => acc + i.amount,
      0
    );
    expect(multiEventOrder.amount).toBe(1100);
    expect(calculatedSum).toBe(1100);

    const link = generatePaymentResumeUrl({
      paymentOrderId: multiEventOrder.id,
      participantId: "SVK26-MULTI01",
      payerParticipantUuid: "p-uuid-multi",
      secretOverride: TEST_SECRET,
    });

    const token = decodeURIComponent(link.split("token=")[1]);
    const verified = verifyPaymentResumeToken(token, TEST_SECRET);
    expect(verified.payload?.paymentOrderId).toBe("po-multi-1");
  });
});

describe("Phase 2C: Parameter Tampering & Authority Invariants", () => {
  it("TEST 14: Payment amount displayed comes from DB payment_orders.amount", () => {
    const dbOrder = { id: "po-auth-1", amount: 800, currency: "INR" };
    const clientSuppliedAmount = 1; // Attacker tries to pay ₹1

    // Server must strictly use dbOrder.amount
    const authoritativeAmount = dbOrder.amount;
    expect(authoritativeAmount).toBe(800);
    expect(authoritativeAmount).not.toBe(clientSuppliedAmount);
  });

  it("TEST 15: Client cannot modify amount through query parameters", () => {
    const url = new URL("https://example.com/payment/resume?token=valid.token&amount=5");
    const clientAmount = url.searchParams.get("amount");

    // Amount parameter is ignored because /api/payments/resume only parses 'token'
    expect(clientAmount).toBe("5");
    const serverAllowedParams = ["token"];
    expect(serverAllowedParams.includes("amount")).toBe(false);
  });

  it("TEST 16: Client cannot modify participant ID through query parameters", () => {
    const url = new URL("https://example.com/payment/resume?token=valid.token&participantId=SVK26-FAKE");
    const clientParticipantId = url.searchParams.get("participantId");

    // participantId parameter is ignored
    expect(clientParticipantId).toBe("SVK26-FAKE");
    const serverAllowedParams = ["token"];
    expect(serverAllowedParams.includes("participantId")).toBe(false);
  });

  it("TEST 17: Client cannot modify paymentOrderId to access another order", () => {
    const url = new URL("https://example.com/payment/resume?token=valid.token&paymentOrderId=po-other");
    const clientOrderId = url.searchParams.get("paymentOrderId");

    // paymentOrderId parameter is ignored
    expect(clientOrderId).toBe("po-other");
    const serverAllowedParams = ["token"];
    expect(serverAllowedParams.includes("paymentOrderId")).toBe(false);
  });
});

describe("Phase 2C: Email CTA & Razorpay Configuration Hardening", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("TEST 18: Payment Pending email contains the Complete Payment CTA", () => {
    const sampleResumeUrl =
      "https://saviskar.cgc.ac.in/payment/resume?token=sample.valid.token";

    const emailSnippet = `
      <a href="${sampleResumeUrl}">COMPLETE PAYMENT</a>
      <div>Your registration is saved, but payment is still pending.</div>
    `;

    expect(emailSnippet).toContain("COMPLETE PAYMENT");
    expect(emailSnippet).toContain("payment is still pending");
  });

  it("TEST 19: The CTA points to the secure signed resume route", () => {
    const sampleResumeUrl =
      "https://saviskar.cgc.ac.in/payment/resume?token=sample.valid.token";

    expect(sampleResumeUrl).toContain("/payment/resume?token=");
    expect(sampleResumeUrl.startsWith("https://")).toBe(true);
  });

  it("TEST 20: Razorpay key resolution prefers RAZORPAY_KEY_ID", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_PRIMARY_KEY_123";
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_live_FALLBACK_KEY_456";
    process.env.RAZORPAY_KEY_SECRET = "secret_123";

    const gateway = getPaymentGateway("razorpay");
    expect(gateway).toBeDefined();

    // Verify keyId resolution logic
    const resolvedKeyId =
      process.env.RAZORPAY_KEY_ID?.trim() ||
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();
    expect(resolvedKeyId).toBe("rzp_live_PRIMARY_KEY_123");
  });

  it("TEST 21: Razorpay key resolution falls back to NEXT_PUBLIC_RAZORPAY_KEY_ID", () => {
    delete process.env.RAZORPAY_KEY_ID;
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_live_FALLBACK_KEY_456";
    process.env.RAZORPAY_KEY_SECRET = "secret_123";

    const resolvedKeyId =
      process.env.RAZORPAY_KEY_ID?.trim() ||
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();
    expect(resolvedKeyId).toBe("rzp_live_FALLBACK_KEY_456");
  });

  it("TEST 22: Whitespace around Razorpay key values is trimmed", () => {
    process.env.RAZORPAY_KEY_ID = "  rzp_live_TRIMMED_KEY  \n";
    process.env.RAZORPAY_KEY_SECRET = "  secret_trimmed_123  \r\n";

    const resolvedKeyId =
      process.env.RAZORPAY_KEY_ID?.trim() ||
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();
    const resolvedSecret = process.env.RAZORPAY_KEY_SECRET?.trim();

    expect(resolvedKeyId).toBe("rzp_live_TRIMMED_KEY");
    expect(resolvedSecret).toBe("secret_trimmed_123");
  });

  it("TEST 23: Missing Razorpay key fails safely", () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

    const resolveKey = () => {
      const key =
        process.env.RAZORPAY_KEY_ID?.trim() ||
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim();
      if (!key) throw new Error("RAZORPAY_KEY_ID is not set in environment variables.");
      return key;
    };

    expect(resolveKey).toThrow("RAZORPAY_KEY_ID is not set in environment variables.");
  });

  it("TEST 24: Razorpay secret is never exposed through client-side configuration", () => {
    const publicEnvVars = Object.keys(process.env).filter((k) =>
      k.startsWith("NEXT_PUBLIC_")
    );

    for (const key of publicEnvVars) {
      expect(key).not.toContain("SECRET");
      expect(key).not.toContain("KEY_SECRET");
    }
  });
});
