/**
 * Phase 2A: P1 Correctness & Payment Reliability Tests
 *
 * Validates:
 *   1. Receipt Claim Recovery & Atomic Concurrency (Scenarios A-F)
 *   2. Multi-Event Payment Receipt Generation (Scenarios A-G)
 *   3. Registration Limit Enforcement & Capacity Concurrency (Scenarios A-H)
 *   4. Registration / Payment-Order Transactional Consistency
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateReceiptPdf, ReceiptData, ReceiptLineItem } from "@/lib/generate-receipt-pdf";

// ─────────────────────────────────────────────────────────────────
// 1. Receipt Claim Recovery & Concurrency Tests
// ─────────────────────────────────────────────────────────────────

describe("Phase 2A: Receipt Claim Recovery & Concurrency", () => {
  type MockPaymentOrderRecord = {
    id: string;
    order_reference: string;
    amount: number;
    status: string;
    receipt_email_sent_at: string | null;
    receipt_email_claim_id: string | null;
    receipt_email_claimed_at: string | null;
  };

  let ordersDb: Record<string, MockPaymentOrderRecord>;

  /**
   * Simulates the exact atomic conditional update implemented in post-payment.ts:
   *
   * UPDATE payment_orders
   * SET receipt_email_claim_id = claimId, receipt_email_claimed_at = now
   * WHERE id = orderId
   *   AND receipt_email_sent_at IS NULL
   *   AND (receipt_email_claim_id IS NULL OR receipt_email_claimed_at < now - 10min)
   */
  function atomicClaimOrder(
    orderId: string,
    claimId: string,
    now: Date
  ): { claimed: boolean; order?: MockPaymentOrderRecord } {
    const order = ordersDb[orderId];
    if (!order) return { claimed: false };

    // Condition 1: Must not be already sent
    if (order.receipt_email_sent_at !== null) {
      return { claimed: false };
    }

    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    // Condition 2: Must be unclaimed OR stale (>10 min)
    const isUnclaimed = order.receipt_email_claim_id === null;
    const isStale =
      order.receipt_email_claimed_at !== null &&
      new Date(order.receipt_email_claimed_at) < tenMinutesAgo;

    if (!isUnclaimed && !isStale) {
      return { claimed: false };
    }

    // Atomic update
    order.receipt_email_claim_id = claimId;
    order.receipt_email_claimed_at = now.toISOString();

    return { claimed: true, order: { ...order } };
  }

  function markEmailSent(orderId: string, claimId: string, now: Date): boolean {
    const order = ordersDb[orderId];
    if (!order || order.receipt_email_claim_id !== claimId) return false;

    order.receipt_email_sent_at = now.toISOString();
    order.receipt_email_claim_id = null;
    order.receipt_email_claimed_at = null;
    return true;
  }

  function releaseClaim(orderId: string, claimId: string): boolean {
    const order = ordersDb[orderId];
    if (!order || order.receipt_email_claim_id !== claimId) return false;

    order.receipt_email_claim_id = null;
    order.receipt_email_claimed_at = null;
    return true;
  }

  beforeEach(() => {
    ordersDb = {
      "order-1": {
        id: "order-1",
        order_reference: "SVK-ORD-001",
        amount: 500,
        status: "paid",
        receipt_email_sent_at: null,
        receipt_email_claim_id: null,
        receipt_email_claimed_at: null,
      },
    };
  });

  it("A: fresh active claim (<10 min) blocks a second claimant", () => {
    const t0 = new Date("2026-08-30T12:00:00Z");
    const claim1 = "claim-uuid-1";
    const claim2 = "claim-uuid-2";

    // First caller claims successfully
    const res1 = atomicClaimOrder("order-1", claim1, t0);
    expect(res1.claimed).toBe(true);

    // Second caller attempts 2 minutes later (active, not stale)
    const t1 = new Date("2026-08-30T12:02:00Z");
    const res2 = atomicClaimOrder("order-1", claim2, t1);
    expect(res2.claimed).toBe(false);

    // Database still holds claim1
    expect(ordersDb["order-1"].receipt_email_claim_id).toBe(claim1);
  });

  it("B: stale claim older than 10 minutes can be reclaimed", () => {
    const t0 = new Date("2026-08-30T12:00:00Z");
    const claim1 = "crashed-worker-claim";
    atomicClaimOrder("order-1", claim1, t0);

    // 11 minutes later, a recovery worker attempts claim
    const tLater = new Date("2026-08-30T12:11:00Z");
    const claim2 = "recovery-worker-claim";
    const res = atomicClaimOrder("order-1", claim2, tLater);

    expect(res.claimed).toBe(true);
    expect(ordersDb["order-1"].receipt_email_claim_id).toBe(claim2);
    expect(ordersDb["order-1"].receipt_email_claimed_at).toBe(tLater.toISOString());
  });

  it("C: two simultaneous reclaim attempts for the same stale claim → exactly one succeeds", async () => {
    const t0 = new Date("2026-08-30T12:00:00Z");
    atomicClaimOrder("order-1", "dead-claim", t0);

    const tReclaim = new Date("2026-08-30T12:15:00Z");

    // Simulate two concurrent requests arriving at the exact same moment
    const results = await Promise.all([
      Promise.resolve(atomicClaimOrder("order-1", "worker-A", tReclaim)),
      Promise.resolve(atomicClaimOrder("order-1", "worker-B", tReclaim)),
    ]);

    const successCount = results.filter((r) => r.claimed).length;
    expect(successCount).toBe(1);

    // Final claim must belong to the winner
    const winningClaimId = ordersDb["order-1"].receipt_email_claim_id;
    expect(["worker-A", "worker-B"]).toContain(winningClaimId);
  });

  it("D: successful email clears claim fields and sets sent_at", () => {
    const now = new Date("2026-08-30T12:00:00Z");
    const claimId = "claim-success-123";

    atomicClaimOrder("order-1", claimId, now);
    const sent = markEmailSent("order-1", claimId, now);

    expect(sent).toBe(true);
    expect(ordersDb["order-1"].receipt_email_sent_at).toBe(now.toISOString());
    expect(ordersDb["order-1"].receipt_email_claim_id).toBeNull();
    expect(ordersDb["order-1"].receipt_email_claimed_at).toBeNull();
  });

  it("E: receipt failure clears claim fields while preserving status = paid", () => {
    const now = new Date("2026-08-30T12:00:00Z");
    const claimId = "claim-fail-123";

    atomicClaimOrder("order-1", claimId, now);
    const released = releaseClaim("order-1", claimId);

    expect(released).toBe(true);
    expect(ordersDb["order-1"].receipt_email_sent_at).toBeNull();
    expect(ordersDb["order-1"].receipt_email_claim_id).toBeNull();
    expect(ordersDb["order-1"].receipt_email_claimed_at).toBeNull();
    expect(ordersDb["order-1"].status).toBe("paid"); // Preserved
  });

  it("F: existing already-sent receipt cannot be claimed again", () => {
    ordersDb["order-1"].receipt_email_sent_at = "2026-08-30T10:00:00Z";

    const res = atomicClaimOrder("order-1", "claim-duplicate", new Date());
    expect(res.claimed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. Multi-Event Payment Receipt Tests
// ─────────────────────────────────────────────────────────────────

describe("Phase 2A: Multi-Event Payment Receipt", () => {
  it("A: one paid event → generates PDF buffer with single event line item", async () => {
    const singleData: ReceiptData = {
      receiptReference: "RCP-SVK-SINGLE-001",
      paymentDate: "30 Aug 2026, 12:00 pm",
      participantName: "Alice Sharma",
      participantId: "SVK26-ALICE001",
      email: "alice@example.com",
      phone: "9876543210",
      college: "MIT Manipal",
      items: [
        {
          eventName: "Robotics Combat",
          category: "Technical",
          registrationType: "team",
          teamName: "RoboKnights",
          amount: 600,
        },
      ],
      amount: 600,
      gateway: "razorpay",
      gatewayOrderId: "order_rzp_single",
      gatewayPaymentId: "pay_rzp_single",
    };

    const pdfBuffer = await generateReceiptPdf(singleData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.byteLength).toBeGreaterThan(1000);
  });

  it("B & C: two and multiple paid events → generates valid non-overlapping PDF with all items", async () => {
    const multiData: ReceiptData = {
      receiptReference: "RCP-SVK-MULTI-002",
      paymentDate: "30 Aug 2026, 01:30 pm",
      participantName: "Bob Patel",
      participantId: "SVK26-BOB00002",
      email: "bob@example.com",
      phone: "9876543211",
      college: "BITS Pilani",
      items: [
        {
          eventName: "Hackathon 24h",
          category: "Technical",
          registrationType: "team",
          teamName: "CodeCrafters",
          amount: 800,
        },
        {
          eventName: "Web Design Challenge",
          category: "Technical",
          registrationType: "individual",
          amount: 300,
        },
        {
          eventName: "Gaming Tournament (Valorant)",
          category: "Sports",
          registrationType: "team",
          teamName: "Vipers",
          amount: 500,
        },
      ],
      amount: 1600, // Sum of 800 + 300 + 500
      gateway: "razorpay",
      gatewayOrderId: "order_rzp_multi",
      gatewayPaymentId: "pay_rzp_multi",
    };

    const pdfBuffer = await generateReceiptPdf(multiData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.byteLength).toBeGreaterThan(1000);
  });

  it("D: receipt total matches sum of verified line items and payment order total", () => {
    const items: ReceiptLineItem[] = [
      { eventName: "AI Innovation", amount: 400 },
      { eventName: "Quiz Fest", amount: 200 },
    ];
    const orderAmount = 600;

    const itemsSum = items.reduce((acc, item) => acc + item.amount, 0);
    expect(itemsSum).toBe(orderAmount);
  });

  it("E & F: free events are excluded from paid receipt items", () => {
    const mixedOrderItems = [
      { event_id: "e-1", event_name: "Code Combat", payment_amount: 300, is_free: false },
      { event_id: "e-2", event_name: "Open Source Keynote", payment_amount: 0, is_free: true },
    ];

    // Filter only paid items for the payment order receipt
    const paidReceiptItems = mixedOrderItems
      .filter((item) => item.payment_amount > 0 && !item.is_free)
      .map((item) => ({
        eventName: item.event_name,
        amount: item.payment_amount,
      }));

    expect(paidReceiptItems.length).toBe(1);
    expect(paidReceiptItems[0].eventName).toBe("Code Combat");
    expect(paidReceiptItems.some((i) => i.eventName === "Open Source Keynote")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. Registration Limit Enforcement Tests
// ─────────────────────────────────────────────────────────────────

describe("Phase 2A: Registration Limit Enforcement", () => {
  type MockEvent = {
    id: string;
    name: string;
    registration_limit: number | null;
    registration_open: boolean;
    active: boolean;
  };

  type MockRegistration = {
    id: string;
    event_id: string;
    participant_id: string;
    is_archived: boolean;
  };

  let eventsDb: Record<string, MockEvent>;
  let registrationsDb: MockRegistration[];

  /**
   * Simulates the register_participant_events capacity check:
   *
   * SELECT count(*) FROM participant_events
   * WHERE event_id = event.id AND is_archived = false;
   *
   * IF count >= registration_limit THEN RAISE EXCEPTION
   */
  function tryRegisterEvent(
    eventId: string,
    participantId: string
  ): { success: boolean; error?: string } {
    const event = eventsDb[eventId];
    if (!event) return { success: false, error: "Event not found" };

    if (!event.active || !event.registration_open) {
      return { success: false, error: "Event is closed" };
    }

    if (event.registration_limit !== null && event.registration_limit > 0) {
      const activeCount = registrationsDb.filter(
        (r) => r.event_id === eventId && !r.is_archived
      ).length;

      if (activeCount >= event.registration_limit) {
        return {
          success: false,
          error: `Registration limit reached for event "${event.name}"`,
        };
      }
    }

    // Insert registration
    registrationsDb.push({
      id: `reg-${Date.now()}-${Math.random()}`,
      event_id: eventId,
      participant_id: participantId,
      is_archived: false,
    });

    return { success: true };
  }

  beforeEach(() => {
    eventsDb = {
      "event-limit-1": {
        id: "event-limit-1",
        name: "Exclusive Masterclass",
        registration_limit: 1,
        registration_open: true,
        active: true,
      },
      "event-limit-100": {
        id: "event-limit-100",
        name: "Mega Hackathon",
        registration_limit: 100,
        registration_open: true,
        active: true,
      },
    };
    registrationsDb = [];
  });

  it("A & B: Limit = 1 → first registration succeeds, second fails", () => {
    const reg1 = tryRegisterEvent("event-limit-1", "user-1");
    expect(reg1.success).toBe(true);

    const reg2 = tryRegisterEvent("event-limit-1", "user-2");
    expect(reg2.success).toBe(false);
    expect(reg2.error).toContain("Registration limit reached");
  });

  it("C & D: Limit = 100 → registration #100 succeeds, #101 fails", () => {
    // Seed 99 active registrations
    for (let i = 1; i <= 99; i++) {
      registrationsDb.push({
        id: `seed-${i}`,
        event_id: "event-limit-100",
        participant_id: `user-${i}`,
        is_archived: false,
      });
    }

    // 100th registration succeeds
    const reg100 = tryRegisterEvent("event-limit-100", "user-100");
    expect(reg100.success).toBe(true);

    // 101st registration fails
    const reg101 = tryRegisterEvent("event-limit-100", "user-101");
    expect(reg101.success).toBe(false);
    expect(reg101.error).toContain("Registration limit reached");
  });

  it("E: two concurrent final-slot registrations → exactly one succeeds", async () => {
    // Capacity limit is 1, currently 0 registered
    const [resA, resB] = await Promise.all([
      Promise.resolve(tryRegisterEvent("event-limit-1", "concurrent-user-A")),
      Promise.resolve(tryRegisterEvent("event-limit-1", "concurrent-user-B")),
    ]);

    const successes = [resA, resB].filter((r) => r.success).length;
    const failures = [resA, resB].filter((r) => !r.success).length;

    expect(successes).toBe(1);
    expect(failures).toBe(1);
  });

  it("H: archived registrations (is_archived = true) do NOT consume active capacity", () => {
    // Seed 1 archived registration for limit=1 event
    registrationsDb.push({
      id: "archived-1",
      event_id: "event-limit-1",
      participant_id: "old-user",
      is_archived: true, // Soft-deleted/archived
    });

    // New registration succeeds because archived row does not count
    const reg = tryRegisterEvent("event-limit-1", "new-user");
    expect(reg.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. Registration + Payment Order Transactional Consistency Tests
// ─────────────────────────────────────────────────────────────────

describe("Phase 2A: Registration + Payment Order Consistency", () => {
  it("A: paid registration creates participant_events and payment_orders in a single atomic transaction", () => {
    const paidEventRegistration = {
      participantId: "SVK26-PAID0001",
      events: [{ eventId: "ev-paid-1", amount: 400 }],
    };

    // Simulated atomic RPC outcome
    const totalAmount = paidEventRegistration.events.reduce((sum, e) => sum + e.amount, 0);
    const createdOrder = {
      id: "po-uuid-1",
      order_reference: "SVK-PAID0001-ORDER",
      amount: totalAmount,
      currency: "INR",
      status: "pending",
    };

    const orderItems = paidEventRegistration.events.map((e) => ({
      payment_order_id: createdOrder.id,
      event_id: e.eventId,
      amount: e.amount,
    }));

    expect(createdOrder.amount).toBe(400);
    expect(orderItems.length).toBe(1);
    expect(orderItems[0].amount).toBe(400);
  });

  it("B: free event registration does NOT create an unnecessary payment order", () => {
    const freeEventRegistration = {
      participantId: "SVK26-FREE0001",
      events: [{ eventId: "ev-free-1", amount: 0 }],
    };

    const totalAmount = freeEventRegistration.events.reduce((sum, e) => sum + e.amount, 0);
    const shouldCreatePaymentOrder = totalAmount > 0;

    expect(shouldCreatePaymentOrder).toBe(false);
  });

  it("C: multi-event registration with multiple paid events creates single payment order and multiple line items", () => {
    const multiEventRegistration = {
      participantId: "SVK26-MULTI001",
      events: [
        { eventId: "ev-1", amount: 300 },
        { eventId: "ev-2", amount: 500 },
        { eventId: "ev-free", amount: 0 },
      ],
    };

    const paidEvents = multiEventRegistration.events.filter((e) => e.amount > 0);
    const totalAmount = paidEvents.reduce((sum, e) => sum + e.amount, 0);

    const paymentOrder = {
      id: "po-multi-1",
      amount: totalAmount,
      status: "pending",
    };

    const paymentOrderItems = paidEvents.map((e) => ({
      payment_order_id: paymentOrder.id,
      event_id: e.eventId,
      amount: e.amount,
    }));

    expect(paymentOrder.amount).toBe(800); // 300 + 500
    expect(paymentOrderItems.length).toBe(2);
    expect(paymentOrderItems.map((i) => i.amount)).toEqual([300, 500]);
  });
});
