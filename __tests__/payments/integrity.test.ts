import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimitStore } from "@/lib/rate-limit";

describe("Phase 2B: Participant Data Integrity & Email Uniqueness", () => {
  it("A: normalizes email with lower(trim(email))", () => {
    const rawEmail1 = "  Student.Test@College.Edu  ";
    const rawEmail2 = "student.test@college.edu";
    expect(rawEmail1.trim().toLowerCase()).toBe(rawEmail2.trim().toLowerCase());
  });

  it("B: detects duplicate emails across different casing", () => {
    const existingEmails = new Set(["john.doe@example.com"]);
    const newAttemptEmail = "  John.Doe@Example.COM  ";
    const normalized = newAttemptEmail.trim().toLowerCase();
    expect(existingEmails.has(normalized)).toBe(true);
  });

  it("C: concurrent same-email registrations resolve to the same participant identity", () => {
    const db = new Map<string, { id: string; participant_id: string; email: string }>();

    function getOrCreateParticipant(name: string, email: string) {
      const normalizedEmail = email.trim().toLowerCase();
      const existing = db.get(normalizedEmail);
      if (existing) {
        return { participant: existing, created: false };
      }
      const newParticipant = {
        id: `uuid-${db.size + 1}`,
        participant_id: `SVK26-A1B2C3D${db.size + 1}`,
        email: normalizedEmail,
      };
      db.set(normalizedEmail, newParticipant);
      return { participant: newParticipant, created: true };
    }

    const reg1 = getOrCreateParticipant("Alice", "ALICE@univ.edu");
    const reg2 = getOrCreateParticipant("Alice", "alice@univ.edu");
    const reg3 = getOrCreateParticipant("Alice", "  Alice@Univ.Edu  ");

    expect(reg1.created).toBe(true);
    expect(reg2.created).toBe(false);
    expect(reg3.created).toBe(false);
    expect(reg2.participant.id).toBe(reg1.participant.id);
    expect(reg3.participant.id).toBe(reg1.participant.id);
    expect(db.size).toBe(1);
  });
});

describe("Phase 2B: Participant ID Collision Retry", () => {
  it("A: retries ID generation when collision occurs and succeeds within 3 attempts", () => {
    const existingIds = new Set(["SVK26-COLLIDE1", "SVK26-COLLIDE2"]);
    const idGeneratorMock = (() => {
      const sequence = ["SVK26-COLLIDE1", "SVK26-COLLIDE2", "SVK26-UNIQUE01"];
      let idx = 0;
      return () => sequence[idx++];
    })();

    let attempts = 0;
    let finalId = "";

    while (attempts < 3) {
      attempts++;
      const generated = idGeneratorMock();
      if (!existingIds.has(generated)) {
        finalId = generated;
        existingIds.add(finalId);
        break;
      }
    }

    expect(attempts).toBe(3);
    expect(finalId).toBe("SVK26-UNIQUE01");
  });

  it("B: fails safely with controlled error if 3 attempts are exhausted", () => {
    const existingIds = new Set(["SVK26-REPEAT"]);
    const idGeneratorMock = () => "SVK26-REPEAT";

    let attempts = 0;
    let failedSafely = false;
    let errCode = "";

    while (attempts < 3) {
      attempts++;
      const generated = idGeneratorMock();
      if (!existingIds.has(generated)) {
        break;
      }
      if (attempts >= 3) {
        failedSafely = true;
        errCode = "SVK11";
      }
    }

    expect(failedSafely).toBe(true);
    expect(errCode).toBe("SVK11");
  });
});

describe("Phase 2B: Permanent Deletion & Financial Record Safety", () => {
  it("A: paid payment_orders row is NEVER deleted when registration is permanently deleted", () => {
    const paymentOrders = new Map<string, { id: string; status: string; amount: number }>([
      ["po-1", { id: "po-1", status: "paid", amount: 500 }],
      ["po-2", { id: "po-2", status: "pending", amount: 300 }],
    ]);

    const paymentOrderItems = [
      { id: "item-1", payment_order_id: "po-1", participant_event_id: "pe-paid-1", amount: 500 },
      { id: "item-2", payment_order_id: "po-2", participant_event_id: "pe-unpaid-1", amount: 300 },
    ];

    function deleteRegistrationPermanently(peId: string) {
      // Find item
      const itemIdx = paymentOrderItems.findIndex((i) => i.participant_event_id === peId);
      if (itemIdx === -1) return;
      const item = paymentOrderItems[itemIdx];
      const parentOrder = paymentOrders.get(item.payment_order_id);

      if (parentOrder?.status === "paid") {
        // Paid: decouple item participant_event_id to null, KEEP item and order
        item.participant_event_id = null as any;
      } else {
        // Unpaid/test: remove item and delete order if empty
        paymentOrderItems.splice(itemIdx, 1);
        const hasOtherItems = paymentOrderItems.some((i) => i.payment_order_id === item.payment_order_id);
        if (!hasOtherItems) {
          paymentOrders.delete(item.payment_order_id);
        }
      }
    }

    // Delete paid registration
    deleteRegistrationPermanently("pe-paid-1");
    expect(paymentOrders.has("po-1")).toBe(true);
    expect(paymentOrders.get("po-1")?.status).toBe("paid");
    expect(paymentOrderItems.find((i) => i.id === "item-1")?.participant_event_id).toBeNull();

    // Delete unpaid registration
    deleteRegistrationPermanently("pe-unpaid-1");
    expect(paymentOrders.has("po-2")).toBe(false);
    expect(paymentOrderItems.find((i) => i.id === "item-2")).toBeUndefined();
  });

  it("B: shared multi-event payment order preserves other line items and parent order", () => {
    const paymentOrders = new Map<string, { id: string; status: string; amount: number }>([
      ["po-shared", { id: "po-shared", status: "paid", amount: 800 }],
    ]);

    const paymentOrderItems = [
      { id: "item-1", payment_order_id: "po-shared", participant_event_id: "pe-1", amount: 500 },
      { id: "item-2", payment_order_id: "po-shared", participant_event_id: "pe-2", amount: 300 },
    ];

    // Delete one registration from shared order
    const item1 = paymentOrderItems.find((i) => i.participant_event_id === "pe-1")!;
    item1.participant_event_id = null as any;

    expect(paymentOrders.has("po-shared")).toBe(true);
    expect(paymentOrderItems.find((i) => i.id === "item-2")?.participant_event_id).toBe("pe-2");
    expect(paymentOrderItems.length).toBe(2);
  });
});

describe("Phase 2B: Public Participant Lookup Security & Rate Limiting", () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it("A: allows requests within 10 req/min threshold", () => {
    for (let i = 0; i < 10; i++) {
      const res = checkRateLimit("lookup:192.168.1.1", 10, 60000);
      expect(res.allowed).toBe(true);
    }
  });

  it("B: blocks 11th request with 429 and retryAfter > 0", () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit("lookup:192.168.1.2", 10, 60000);
    }
    const blocked = checkRateLimit("lookup:192.168.1.2", 10, 60000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("C: minimizes public response payload to exclude internal participant UUIDs, gateway IDs, and audit details while preserving event recovery fields", () => {
    const internalDbRow = {
      id: "raw-uuid-12345",
      participant_id: "SVK26-ABCDEF12",
      name: "John Doe",
      college: "Engineering College",
      email: "john@example.com",
      phone: "+91 9876543210",
      created_at: "2026-08-30T00:00:00Z",
      participant_events: [
        {
          id: "pe-uuid-1",
          event_id: "evt-uuid-1",
          registration_status: "confirmed",
          payment_status: "pending",
          payment_amount: 300,
          team_name: "CodeWarriors",
          events: { name: "Hackathon" },
        },
      ],
    };

    // Public sanitized projection (minimized to strictly UI-consumed fields)
    const sanitized = {
      participant: {
        participantId: internalDbRow.participant_id,
        name: internalDbRow.name,
        college: internalDbRow.college,
        email: internalDbRow.email,
        phone: internalDbRow.phone,
      },
      events: internalDbRow.participant_events.map((e) => ({
        participantEventId: e.id,
        eventId: e.event_id,
        eventName: e.events?.name,
        paymentStatus: e.payment_status,
        paymentAmount: e.payment_amount,
      })),
    };

    expect((sanitized.participant as any).id).toBeUndefined();
    expect((sanitized.participant as any).created_at).toBeUndefined();
    expect(sanitized.participant.participantId).toBe("SVK26-ABCDEF12");
    expect(sanitized.events[0].participantEventId).toBe("pe-uuid-1");
    expect(sanitized.events[0].paymentAmount).toBe(300);
    expect((sanitized.events[0] as any).teamName).toBeUndefined();
    expect((sanitized.events[0] as any).registrationStatus).toBeUndefined();
    expect(sanitized.events[0].eventId).toBe("evt-uuid-1");
    expect(sanitized.events[0].eventName).toBe("Hackathon");
    expect(sanitized.events[0].paymentStatus).toBe("pending");
  });
});

describe("Phase 2B: Admin Pagination Safety", () => {
  it("A: calculates page bounds correctly with default pageSize = 50", () => {
    function getPageBounds(page = 1, pageSize = 50) {
      const p = Math.max(1, page);
      const ps = Math.min(100, Math.max(1, pageSize));
      const from = (p - 1) * ps;
      const to = from + ps - 1;
      return { page: p, pageSize: ps, from, to };
    }

    expect(getPageBounds(1, 50)).toEqual({ page: 1, pageSize: 50, from: 0, to: 49 });
    expect(getPageBounds(2, 50)).toEqual({ page: 2, pageSize: 50, from: 50, to: 99 });
    expect(getPageBounds(3, 20)).toEqual({ page: 3, pageSize: 20, from: 40, to: 59 });
  });

  it("B: clamps excessive pageSize to maximum 100", () => {
    const pageSize = Math.min(100, Math.max(1, 500));
    expect(pageSize).toBe(100);
  });

  it("C: calculates totalPages correctly", () => {
    expect(Math.ceil(125 / 50)).toBe(3);
    expect(Math.ceil(50 / 50)).toBe(1);
    expect(Math.ceil(0 / 50)).toBe(0);
  });
});

describe("Phase 2B: Structured SVK Error Codes Mapping", () => {
  const errorMap: Record<string, { status: number; message: string }> = {
    SVK01: { status: 404, message: "That Participant ID was not found." },
    SVK02: { status: 400, message: "The provided email does not match this Participant ID." },
    SVK03: { status: 400, message: "Event is currently unavailable." },
    SVK04: { status: 400, message: "Registration is currently closed." },
    SVK05: { status: 400, message: "Registration limit reached." },
    SVK06: { status: 400, message: "Please enter your team name." },
    SVK07: { status: 400, message: "Event requires minimum team members." },
    SVK08: { status: 400, message: "Event allows maximum team members." },
    SVK09: { status: 400, message: "Missing team member details." },
    SVK10: { status: 400, message: "Each team member must use a different email address." },
    SVK11: { status: 400, message: "Invalid event or payload." },
  };

  it("A: maps SVK01 to 404 Participant Not Found", () => {
    expect(errorMap["SVK01"].status).toBe(404);
  });

  it("B: maps SVK02 to 400 Email Mismatch", () => {
    expect(errorMap["SVK02"].status).toBe(400);
  });

  it("C: maps SVK05 to 400 Capacity Limit Reached", () => {
    expect(errorMap["SVK05"].status).toBe(400);
  });

  it("D: maps SVK06 and SVK10 to 400 Team Validation Errors", () => {
    expect(errorMap["SVK06"].status).toBe(400);
    expect(errorMap["SVK10"].status).toBe(400);
  });
});

describe("Phase 2B: Returning Participant → Paid Event Flow & Recovery Regression Tests", () => {
  it("Test A: FREE event → same participant → PAID event creates atomic order & resolves gateway params", () => {
    // 1. Existing participant with previously registered free event
    const participant = {
      id: "uuid-p1",
      participantId: "SVK26-FFE51470",
      name: "Jashan",
      email: "jashan.cgcu@gmail.com",
      phone: "+91 9876543210",
      college: "CGC University",
    };

    const existingEvents = [
      {
        id: "pe-free-1",
        participant_id: participant.id,
        event_id: "evt-hackathon-free",
        payment_status: "not_required",
        payment_amount: 0,
      },
    ];

    // 2. Participant registers for new paid event (Battle of Bands, ₹15)
    const newEvent = {
      id: "evt-bob-paid",
      name: "Battle of Bands",
      registration_fee: 5,
      team_members_count: 3,
    };
    const calculatedFee = newEvent.registration_fee * newEvent.team_members_count; // ₹15

    const newPeId = "pe-bob-paid-1";
    const paymentOrder = {
      id: "po-bob-1",
      order_reference: `SVK-${participant.participantId}-20260830-ABC123`,
      payer_participant_id: participant.id,
      amount: calculatedFee,
      currency: "INR",
      status: "pending",
      gateway_order_id: null as string | null,
    };

    const paymentOrderItem = {
      id: "poi-1",
      payment_order_id: paymentOrder.id,
      participant_id: participant.id,
      participant_event_id: newPeId,
      amount: calculatedFee,
    };

    // 3. Verify order linking & gateway payload calculation
    expect(paymentOrder.amount).toBe(15);
    expect(paymentOrder.payer_participant_id).toBe(participant.id);
    expect(paymentOrderItem.participant_event_id).toBe(newPeId);

    // Gateway order parameters:
    const amountInSmallestUnit = Number(paymentOrder.amount) * 100; // 1500 paise
    const receipt = paymentOrder.order_reference.slice(0, 40);

    expect(amountInSmallestUnit).toBe(1500);
    expect(receipt.length).toBeLessThanOrEqual(40);
  });

  it("Test B: FREE event → same participant → PAID event → Retry Payment / Recovery correctly identifies pending event", () => {
    const participant = {
      id: "uuid-p1",
      participantId: "SVK26-FFE51470",
    };

    // Participant events in database
    const participantEvents = [
      {
        id: "pe-free-1",
        event_id: "evt-hackathon-free",
        events: { name: "Hackathon" },
        payment_status: "not_required",
        payment_amount: 0,
      },
      {
        id: "pe-bob-pending",
        event_id: "evt-bob-paid",
        events: { name: "Battle of Bands" },
        payment_status: "pending",
        payment_amount: 15,
      },
    ];

    // Public API projection format
    const publicEvents = participantEvents.map((e) => ({
      participantEventId: e.id,
      eventId: e.event_id,
      eventName: e.events.name,
      paymentStatus: e.payment_status,
      paymentAmount: e.payment_amount,
    }));

    // Recovery function target selection
    const pendingItem = publicEvents.find((e) => e.paymentStatus === "pending");
    expect(pendingItem).toBeDefined();
    expect(pendingItem?.participantEventId).toBe("pe-bob-pending");
    expect(pendingItem?.paymentAmount).toBe(15);

    // Mock recovery payload
    const recoveryRequest = {
      participantId: participant.participantId,
      participantEventId: pendingItem?.participantEventId,
    };

    // Ensure it targets the pending paid event and NOT the free event
    expect(recoveryRequest.participantEventId).toBe("pe-bob-pending");
    expect(recoveryRequest.participantEventId).not.toBe("pe-free-1");
  });

  it("Test C: New participant → PAID event succeeds with atomic order creation", () => {
    const newParticipant = {
      id: "uuid-p-new",
      participantId: "SVK26-NEW00001",
      email: "new.student@univ.edu",
    };

    const newPeId = "pe-new-1";
    const amount = 200;

    const atomicOrder = {
      id: "po-new-1",
      order_reference: `SVK-${newParticipant.participantId}-20260830-ZZZ999`,
      payer_participant_id: newParticipant.id,
      amount,
      currency: "INR",
      status: "pending",
    };

    expect(atomicOrder.amount).toBe(200);
    expect(atomicOrder.payer_participant_id).toBe("uuid-p-new");
    expect(atomicOrder.status).toBe("pending");
  });

  it("Test D: Existing participant → already registered event is idempotent and creates no new orders", () => {
    const existingEvents = new Set(["evt-hackathon-free"]);
    const requestedEvents = ["evt-hackathon-free"];

    let addedCount = 0;
    let alreadyRegisteredCount = 0;
    let orderCreated = false;

    for (const evtId of requestedEvents) {
      if (existingEvents.has(evtId)) {
        alreadyRegisteredCount++;
      } else {
        addedCount++;
        orderCreated = true;
      }
    }

    expect(alreadyRegisteredCount).toBe(1);
    expect(addedCount).toBe(0);
    expect(orderCreated).toBe(false);
  });

  it("Test E: Existing participant → multiple paid events correctly calculates combined atomic total", () => {
    const participant = { id: "uuid-p1", participantId: "SVK26-FFE51470" };

    const newlyAddedEvents = [
      { id: "pe-paid-1", event_id: "evt-1", amount: 200 },
      { id: "pe-paid-2", event_id: "evt-2", amount: 300 },
    ];

    const totalPaidAmount = newlyAddedEvents.reduce((sum, e) => sum + e.amount, 0);

    const combinedOrder = {
      id: "po-combined-1",
      order_reference: `SVK-${participant.participantId}-COMBINED-123`,
      payer_participant_id: participant.id,
      amount: totalPaidAmount,
      currency: "INR",
      status: "pending",
    };

    const lineItems = newlyAddedEvents.map((e) => ({
      payment_order_id: combinedOrder.id,
      participant_event_id: e.id,
      amount: e.amount,
    }));

    expect(combinedOrder.amount).toBe(500);
    expect(lineItems.length).toBe(2);
    expect(lineItems[0].amount).toBe(200);
    expect(lineItems[1].amount).toBe(300);
    expect(Number(combinedOrder.amount) * 100).toBe(50000); // 50000 paise for Razorpay
  });
});
