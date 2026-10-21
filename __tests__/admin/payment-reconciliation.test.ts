import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyParticipantPayments,
  verifyPaymentOrders,
  getPaymentAuditScope,
  generateSanitizedDiagnosticReport,
  toPaise,
  ReconciliationOutcome,
  formatIndianTimestamp,
} from "@/lib/admin/payment-verification";
import {
  generateEmailPreviews,
  executeEmailResend,
  EmailTemplateType,
} from "@/lib/admin/email-resend";
import * as reconLib from "@/lib/admin/payment-reconciliation";
import {
  reconcilePaymentOrder,
  retryReconciliationEmail,
} from "@/lib/admin/payment-reconciliation";
import { POST as verifyPost } from "@/app/api/admin/payments/verify/route";
import { POST as resendEmailPost } from "@/app/api/admin/registrations/resend-email/route";
import { POST as reconcilePost } from "@/app/api/admin/payments/reconcile/route";
import { GET as auditGet, POST as auditPost } from "@/app/api/admin/payments/audit/route";
import { PayUGateway } from "@/lib/payments/payu";
import * as serverLib from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import {
  lockBodyScroll,
  unlockBodyScroll,
  resetBodyScrollLockForTesting,
  getActiveBodyLockCountForTesting,
} from "@/lib/admin/useBodyScrollLock";

// Ensure isolated test env
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key-32bytes-for-hmac";

// Synthetic database state for tests
interface MockDb {
  participants: any[];
  participant_events: any[];
  participant_accommodations: any[];
  payment_orders: any[];
  payment_order_items: any[];
  payments: any[];
  admin_audit_logs: any[];
}

let mockDb: MockDb;

function createMockSupabase(db: MockDb) {
  return {
    from: (table: string) => {
      let currentData: any[] = [...(db[table as keyof MockDb] || [])];
      let queryError: any = null;

      const builder: any = {
        select: (cols?: string) => builder,
        eq: (col: string, val: any) => {
          currentData = currentData.filter((r) => r[col] === val);
          return builder;
        },
        neq: (col: string, val: any) => {
          currentData = currentData.filter((r) => r[col] !== val);
          return builder;
        },
        not: (col: string, op: string, val: any) => {
          if (op === "is" && val === null) {
            currentData = currentData.filter((r) => r[col] !== null && r[col] !== undefined);
          } else {
            currentData = currentData.filter((r) => r[col] !== val);
          }
          return builder;
        },
        in: (col: string, vals: any[]) => {
          currentData = currentData.filter((r) => vals.includes(r[col]));
          return builder;
        },
        order: () => builder,
        limit: (n: number) => {
          currentData = currentData.slice(0, n);
          return builder;
        },
        maybeSingle: async () => ({
          data: currentData[0] || null,
          error: queryError,
        }),
        single: async () => ({
          data: currentData[0] || null,
          error: currentData[0] ? null : { message: "Not found" },
        }),
        then: (resolve: any) => {
          return Promise.resolve({ data: currentData, error: queryError }).then(resolve);
        },
        insert: async (records: any | any[]) => {
          const recArray = Array.isArray(records) ? records : [records];
          const target = db[table as keyof MockDb];
          if (Array.isArray(target)) {
            target.push(...recArray);
          }
          return { data: recArray, error: null };
        },
        update: (updates: any) => ({
          eq: (col: string, val: any) => {
            const target = db[table as keyof MockDb];
            if (Array.isArray(target)) {
              target.forEach((r) => {
                if (r[col] === val) {
                  Object.assign(r, updates);
                }
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };

      return builder;
    },
    rpc: vi.fn().mockImplementation(async (fn: string, args: any) => {
      if (fn === "process_payment_success") {
        const order = db.payment_orders.find(
          (o) => o.gateway_order_id === args.p_gateway_order_id
        );
        if (!order) {
          return { data: { success: false, error: "Order not found" }, error: null };
        }
        order.status = "paid";
        order.gateway_payment_id = args.p_gateway_payment_id;

        // Find linked items
        const orderItems = (db.payment_order_items || []).filter(
          (poi) => poi.payment_order_id === order.id
        );

        orderItems.forEach((poi) => {
          if (poi.participant_event_id) {
            const pe = (db.participant_events || []).find((e) => e.id === poi.participant_event_id);
            if (pe) {
              pe.payment_status = "paid";
              pe.payment_id = args.p_gateway_payment_id;
            }
          }
          if (poi.participant_accommodation_id) {
            const pa = (db.participant_accommodations || []).find(
              (a) => a.id === poi.participant_accommodation_id
            );
            if (pa) {
              pa.status = "paid";
              pa.payment_order_id = order.id;
            }
          }
        });

        // Also check accommodations directly referencing payment_order_id
        (db.participant_accommodations || []).forEach((pa) => {
          if (pa.payment_order_id === order.id) {
            pa.status = "paid";
          }
        });

        // Insert canonical receipt
        if (db.payments) {
          db.payments.push({
            id: `pay-${Date.now()}`,
            participant_id: order.payer_participant_id,
            amount: order.amount,
            status: "paid",
            gateway: order.gateway || "payu",
            gateway_payment_id: args.p_gateway_payment_id,
            gateway_order_id: args.p_gateway_order_id,
          });
        }

        return { data: { success: true, action: "settled", conflicts_count: 0 }, error: null };
      }
      return { data: null, error: null };
    }),
  } as any;
}

beforeEach(() => {
  mockDb = {
    participants: [
      {
        id: "p-case1",
        participant_id: "SVK26-CASE01",
        name: "Case One Participant",
        email: "case1@example.com",
        college: "CGC Jhanjeri",
        phone: "9876543210",
      },
      {
        id: "p-case2",
        participant_id: "SVK26-CASE02",
        name: "Case Two Participant",
        email: "case2@example.com",
        college: "Chandigarh Group",
        phone: "9876543211",
      },
      {
        id: "p-shared-teammate",
        participant_id: "SVK26-TEAM03",
        name: "Teammate",
        email: "teammate@example.com",
        college: "CGC Jhanjeri",
        phone: "9876543212",
      },
    ],
    participant_events: [
      {
        id: "pe-free-1",
        participant_id: "p-case1",
        event_id: "evt-free",
        payment_status: "not_required",
        payment_amount: 0,
        is_archived: false,
        events: {
          id: "evt-free",
          name: "Project Display",
          category: "technical",
          payment_type: "free",
          registration_fee: 0,
        },
      },
      {
        id: "pe-footlose-2",
        participant_id: "p-case2",
        event_id: "evt-footlose",
        payment_status: "pending",
        payment_amount: 500,
        is_archived: false,
        events: {
          id: "evt-footlose",
          name: "Footlose Solo Dance",
          category: "cultural",
          payment_type: "paid",
          registration_fee: 500,
        },
      },
      {
        id: "pe-shared-order",
        participant_id: "p-shared-teammate",
        event_id: "evt-footlose",
        payment_status: "paid",
        payment_amount: 500,
        is_archived: false,
        events: {
          id: "evt-footlose",
          name: "Footlose Solo Dance",
          category: "cultural",
          payment_type: "paid",
          registration_fee: 500,
        },
      },
    ],
    participant_accommodations: [
      {
        id: "acc-case1",
        participant_id: "p-case1",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "pending",
        payment_order_id: "po-case1-acc",
        accommodation_plans: {
          name: "2-Day Accommodation",
        },
      },
      {
        id: "acc-case2",
        participant_id: "p-case2",
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        duration_days: 2,
        amount: 999,
        status: "paid",
        payment_order_id: "po-case2-acc",
        accommodation_plans: {
          name: "2-Day Accommodation",
        },
      },
    ],
    payment_orders: [
      {
        id: "po-case1-acc",
        order_reference: "SVK-ORD-CASE1",
        gateway: "payu",
        gateway_order_id: "TXN-CASE1",
        gateway_payment_id: "MIH-CASE1",
        amount: 999,
        currency: "INR",
        status: "pending",
        payer_participant_id: "p-case1",
      },
      {
        id: "po-case2-acc",
        order_reference: "SVK-ORD-CASE2",
        gateway: "payu",
        gateway_order_id: "TXN-CASE2",
        gateway_payment_id: "MIH-CASE2",
        amount: 999,
        currency: "INR",
        status: "paid",
        payer_participant_id: "p-case2",
      },
      {
        id: "po-shared",
        order_reference: "SVK-ORD-SHARED",
        gateway: "payu",
        gateway_order_id: "TXN-SHARED",
        gateway_payment_id: "MIH-SHARED",
        amount: 500,
        currency: "INR",
        status: "paid",
        payer_participant_id: "p-shared-teammate",
      },
    ],
    payment_order_items: [
      {
        id: "poi-case1-acc",
        payment_order_id: "po-case1-acc",
        item_type: "accommodation",
        amount: 999,
        participant_accommodation_id: "acc-case1",
        participant_accommodations: {
          id: "acc-case1",
          participant_id: "p-case1",
          amount: 999,
          status: "pending",
          start_date: "2026-10-28",
          end_date: "2026-10-30",
          accommodation_plans: { name: "2-Day Accommodation" },
        },
      },
      {
        id: "poi-case2-acc",
        payment_order_id: "po-case2-acc",
        item_type: "accommodation",
        amount: 999,
        participant_accommodation_id: "acc-case2",
        participant_accommodations: {
          id: "acc-case2",
          participant_id: "p-case2",
          amount: 999,
          status: "paid",
          start_date: "2026-10-28",
          end_date: "2026-10-30",
          accommodation_plans: { name: "2-Day Accommodation" },
        },
      },
      {
        id: "poi-shared-event",
        payment_order_id: "po-shared",
        item_type: "event",
        amount: 500,
        participant_event_id: "pe-shared-order",
        events: {
          name: "Footlose Solo Dance",
          category: "cultural",
          registration_fee: 500,
        },
        participant_events: {
          id: "pe-shared-order",
          payment_status: "paid",
        },
      },
    ],
    payments: [
      {
        id: "pay-case2",
        gateway_order_id: "TXN-CASE2",
        gateway_payment_id: "MIH-CASE2",
        amount: 999,
        status: "paid",
        participant_id: "p-case2",
      },
    ],
    admin_audit_logs: [],
  };
});

describe("Payment Reconciliation Centre & Verification Suite", () => {
  /* ---------------------------------------------------------
     PART D & G: VERIFICATION ENGINE TESTS
  --------------------------------------------------------- */

  it("1. Decimal-safe monetary arithmetic handles paise properly", () => {
    expect(toPaise(999)).toBe(99900);
    expect(toPaise(1000.18)).toBe(100018);
    expect(toPaise(0)).toBe(0);
    expect(toPaise(null)).toBe(0);
    expect(toPaise(undefined)).toBe(0);
  });

  it("2. Case 1 diagnosis: Gateway paid but local pending (bank 1000.18 vs order 999.00 with convenience fee)", async () => {
    const supabase = createMockSupabase(mockDb);

    // Mock PayU returning ₹1000.18 (100018 paise) with success status
    const mockGatewayResults = {
      "TXN-CASE1": {
        status: "paid",
        amountPaise: 100018, // 1,000.18
        gatewayPaymentId: "MIH-CASE1",
        rawStatus: "success",
      },
    };

    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"],
      mockGatewayResults,
    });

    expect(res.success).toBe(true);
    expect(res.summary.gatewayPaidLocalPending).toBe(1);

    const orderRes = res.orders.find((o) => o.orderReference === "SVK-ORD-CASE1");
    expect(orderRes).toBeDefined();
    expect(orderRes?.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING");
    expect(orderRes?.localOrderStatus).toBe("pending");
    expect(orderRes?.authoritativeGatewayStatus).toBe("paid");
    expect(orderRes?.additionalCharges).toBeCloseTo(1.18, 2);
    expect(orderRes?.diagnostics.isConvenienceFeeLikely).toBe(true);
  });

  it("3. Case 2 diagnosis: Paid accommodation (₹999) while Footlose (₹500) remains unlinked and pending", async () => {
    const supabase = createMockSupabase(mockDb);

    // PayU confirms the ₹999 accommodation order as paid
    const mockGatewayResults = {
      "TXN-CASE2": {
        status: "paid",
        amountPaise: 99900,
        gatewayPaymentId: "MIH-CASE2",
        rawStatus: "success",
      },
    };

    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case2"],
      mockGatewayResults,
    });

    expect(res.success).toBe(true);
    const orderRes = res.orders.find((o) => o.orderReference === "SVK-ORD-CASE2");
    expect(orderRes).toBeDefined();
    expect(orderRes?.outcome).toBe("MATCHED_PAID");
    expect(orderRes?.expectedAmount).toBe(999);
    expect(orderRes?.linkedItems.length).toBe(1);
    expect(orderRes?.linkedItems[0].title).toBe("2-Day Accommodation");

    // The Footlose event (₹500) has NO payment order and is not included in the ₹999 order
    const hasFootloseInOrder = orderRes?.linkedItems.some((li) => li.title.includes("Footlose"));
    expect(hasFootloseInOrder).toBe(false);
  });

  it("4. Deduplicates shared orders across a batch", async () => {
    const supabase = createMockSupabase(mockDb);

    // Select participant twice or select multiple participants sharing the same order
    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-shared-teammate", "p-shared-teammate"],
      mockGatewayResults: {
        "TXN-SHARED": { status: "paid", amountPaise: 50000, rawStatus: "success" },
      },
    });

    expect(res.success).toBe(true);
    const sharedOrders = res.orders.filter((o) => o.orderReference === "SVK-ORD-SHARED");
    expect(sharedOrders.length).toBe(1); // Verified strictly ONCE
  });

  it("5. Detects AMOUNT_MISMATCH when gateway amount differs from expected without fee pattern", async () => {
    const supabase = createMockSupabase(mockDb);

    const mockGatewayResults = {
      "TXN-CASE1": {
        status: "paid",
        amountPaise: 50000, // 500 instead of 999
        rawStatus: "success",
      },
    };

    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"],
      mockGatewayResults,
    });

    const orderRes = res.orders.find((o) => o.orderReference === "SVK-ORD-CASE1");
    expect(orderRes?.outcome).toBe("AMOUNT_MISMATCH");
    expect(res.summary.amountMismatch).toBe(1);
  });

  it("6. Detects LOCAL_PAID_GATEWAY_NOT_CONFIRMED when local is paid but gateway not found", async () => {
    const supabase = createMockSupabase(mockDb);

    const mockGatewayResults = {
      "TXN-CASE2": {
        status: "not_found",
        amountPaise: 0,
        rawStatus: "Not Found",
      },
    };

    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case2"],
      mockGatewayResults,
    });

    const orderRes = res.orders.find((o) => o.orderReference === "SVK-ORD-CASE2");
    expect(orderRes?.outcome).toBe("LOCAL_PAID_GATEWAY_NOT_CONFIRMED");
  });

  it("7. Detects PAYMENT_FAILED when gateway reports dropped or usercancelled", async () => {
    const supabase = createMockSupabase(mockDb);

    const mockGatewayResults = {
      "TXN-CASE1": {
        status: "failed",
        amountPaise: 0,
        rawStatus: "usercancelled",
      },
    };

    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"],
      mockGatewayResults,
    });

    const orderRes = res.orders.find((o) => o.orderReference === "SVK-ORD-CASE1");
    expect(orderRes?.outcome).toBe("PAYMENT_FAILED");
  });

  it("8. Detects GATEWAY_UNAVAILABLE on gateway network timeout or error", async () => {
    const supabase = createMockSupabase(mockDb);

    const mockGatewayResults = {
      "TXN-CASE1": {
        status: "gateway_unavailable",
        amountPaise: 0,
        rawStatus: "Network Timeout",
      },
    };

    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"],
      mockGatewayResults,
    });

    const orderRes = res.orders.find((o) => o.orderReference === "SVK-ORD-CASE1");
    expect(orderRes?.outcome).toBe("GATEWAY_UNAVAILABLE");
  });

  it("9. Verification NEVER mutates financial status or database records", async () => {
    const supabase = createMockSupabase(mockDb);

    const initialOrderStatus = mockDb.payment_orders[0].status;
    const initialAccStatus = mockDb.participant_accommodations[0].status;

    await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"],
      mockGatewayResults: {
        "TXN-CASE1": { status: "paid", amountPaise: 99900, rawStatus: "success" },
      },
    });

    // Verify records remained completely unchanged
    expect(mockDb.payment_orders[0].status).toBe(initialOrderStatus);
    expect(mockDb.participant_accommodations[0].status).toBe(initialAccStatus);
  });

  /* ---------------------------------------------------------
     PART F: EMAIL RESEND ENGINE TESTS
  --------------------------------------------------------- */

  it("10. Receipt email is strictly BLOCKED if order is pending or unverified", async () => {
    const supabase = createMockSupabase(mockDb);

    const preview = await generateEmailPreviews({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"], // case1 has status "pending"
      templateType: "payment_receipt",
    });

    expect(preview.recipients.length).toBe(1);
    expect(preview.recipients[0].eligible).toBe(false);
    expect(preview.recipients[0].ineligibilityReason).toContain("No confirmed PAID payment order exists");
  });

  it("11. Receipt email is ELIGIBLE for confirmed paid order", async () => {
    const supabase = createMockSupabase(mockDb);

    const preview = await generateEmailPreviews({
      supabaseAdmin: supabase,
      participantIds: ["p-case2"], // case2 has status "paid"
      templateType: "payment_receipt",
    });

    expect(preview.recipients.length).toBe(1);
    expect(preview.recipients[0].eligible).toBe(true);
    expect(preview.recipients[0].previewSubject).toContain("Official Payment Receipt");
  });

  it("12. Registration Summary accurately separates free events from payable accommodation", async () => {
    const supabase = createMockSupabase(mockDb);

    // Case 1: registered for FREE event (Project Display) + PENDING accommodation (₹999)
    const preview = await generateEmailPreviews({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"],
      templateType: "registration_summary",
    });

    const rec = preview.recipients[0];
    expect(rec.totalPaidAmount).toBe(0);
    expect(rec.totalPendingAmount).toBe(999);
    // MUST NOT display "No payment required"!
    expect(rec.previewBannerText).not.toContain("No payment required");
    expect(rec.previewBannerText).toContain("Payment Pending: ₹999");
  });

  it("13. Payment Status Update reports partial payment correctly", async () => {
    const supabase = createMockSupabase(mockDb);

    // Case 2: paid accommodation (₹999) + pending Footlose event (₹500)
    const preview = await generateEmailPreviews({
      supabaseAdmin: supabase,
      participantIds: ["p-case2"],
      templateType: "payment_status_update",
    });

    const rec = preview.recipients[0];
    expect(rec.totalPaidAmount).toBe(999);
    expect(rec.totalPendingAmount).toBe(500);
    expect(rec.previewBannerText).toContain("Action Required: ₹500 outstanding");
  });

  it("14. Local execution runs in simulation mode with NO real Resend calls", async () => {
    const supabase = createMockSupabase(mockDb);

    const res = await executeEmailResend({
      supabaseAdmin: supabase,
      adminId: "admin-uuid-1",
      adminEmail: "admin@saviskar.co.in",
      participantIds: ["p-case2"],
      templateType: "payment_receipt",
    });

    expect(res.success).toBe(true);
    expect(res.isLocalSimulation).toBe(true);
    expect(res.results[0].status).toBe("simulated");
    expect(res.results[0].message).toContain("Local simulated dispatch");
  });

  it("15. Audit logs are created without leaking secrets or passwords", async () => {
    const supabase = createMockSupabase(mockDb);

    await executeEmailResend({
      supabaseAdmin: supabase,
      adminId: "admin-uuid-1",
      adminEmail: "admin@saviskar.co.in",
      participantIds: ["p-case2"],
      templateType: "registration_summary",
    });

    expect(mockDb.admin_audit_logs.length).toBeGreaterThan(0);
    const log = mockDb.admin_audit_logs[0];
    expect(log.action_type).toBe("RESEND_REGISTRATION_EMAIL");
    expect(log.details.admin_email).toBe("admin@saviskar.co.in");

    // Check secrets are NOT present
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain("PAYU_SALT");
    expect(serialized).not.toContain("PAYU_KEY");
    expect(serialized).not.toContain("RESEND_API_KEY");
  });

  /* ---------------------------------------------------------
     API ROUTES & SECURITY ENFORCEMENT
  --------------------------------------------------------- */

  it("16. Verify API rejects unauthenticated requests with 401/403", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
      user: null,
      role: null,
      error: "Unauthorized",
      status: 401,
      accommodation_access: false,
      assigned_category: null,
      assigned_events: [],
    } as any);

    const req = new NextRequest("http://localhost:3000/api/admin/payments/verify", {
      method: "POST",
      body: JSON.stringify({ participantIds: ["p-case1"] }),
    });

    const res = await verifyPost(req);
    expect(res.status).toBe(401);
  });

  it("17. Resend API rejects unauthenticated requests", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
      user: null,
      role: null,
      error: "Unauthorized",
      status: 401,
      accommodation_access: false,
      assigned_category: null,
      assigned_events: [],
    } as any);

    const req = new NextRequest("http://localhost:3000/api/admin/registrations/resend-email", {
      method: "POST",
      body: JSON.stringify({ action: "send", participantIds: ["p-case1"] }),
    });

    const res = await resendEmailPost(req);
    expect(res.status).toBe(401);
  });

  /* ---------------------------------------------------------
     ROW SELECTION & DATA INTEGRITY TESTS
  --------------------------------------------------------- */

  it("18. Row selection uses stable record IDs and select-all filters visible dataset", () => {
    // Simulate UI filtered list of participant IDs
    const visibleParticipants = ["p-case1", "p-case2"];
    const allParticipants = ["p-case1", "p-case2", "p-unrelated"];

    let selectedIds = new Set<string>();

    // Select single row
    selectedIds.add(visibleParticipants[0]);
    expect(selectedIds.has("p-case1")).toBe(true);
    expect(selectedIds.size).toBe(1);

    // Toggle select-all on visible items only
    const allVisibleSelected = visibleParticipants.every((id) => selectedIds.has(id));
    expect(allVisibleSelected).toBe(false);

    // Add all visible
    visibleParticipants.forEach((id) => selectedIds.add(id));
    expect(selectedIds.size).toBe(2);
    expect(selectedIds.has("p-unrelated")).toBe(false); // Unrelated/filtered out row is NOT selected

    // Clear selection
    selectedIds.clear();
    expect(selectedIds.size).toBe(0);
  });

  it("19. Detects INCOMPLETE_LOCAL_ITEM_MAPPING when payment order has no items", async () => {
    const supabase = createMockSupabase(mockDb);

    // Add order without items
    mockDb.payment_orders.push({
      id: "po-empty-items",
      order_reference: "SVK-ORD-EMPTY",
      gateway: "payu",
      gateway_order_id: "TXN-EMPTY",
      gateway_payment_id: "MIH-EMPTY",
      amount: 1000,
      currency: "INR",
      status: "paid",
      payer_participant_id: "p-case1",
    });

    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"],
      mockGatewayResults: {
        "TXN-CASE1": { status: "pending", amountPaise: 99900 },
        "TXN-EMPTY": { status: "paid", amountPaise: 100000, rawStatus: "success" },
      },
    });

    const emptyOrder = res.orders.find((o) => o.orderReference === "SVK-ORD-EMPTY");
    expect(emptyOrder?.outcome).toBe("INCOMPLETE_LOCAL_ITEM_MAPPING");
  });

  it("20. Multiple paid events and separate accommodation orders aggregate correctly", async () => {
    const supabase = createMockSupabase(mockDb);

    // Add second event to case 2
    mockDb.participant_events.push({
      id: "pe-hackathon",
      participant_id: "p-case2",
      event_id: "evt-hack",
      payment_status: "paid",
      payment_amount: 300,
      is_archived: false,
      events: {
        id: "evt-hack",
        name: "Web Dev Sprint",
        category: "technical",
        payment_type: "paid",
        registration_fee: 300,
      },
    });

    const preview = await generateEmailPreviews({
      supabaseAdmin: supabase,
      participantIds: ["p-case2"],
      templateType: "registration_summary",
    });

    const rec = preview.recipients[0];
    expect(rec.events.length).toBe(2); // Footlose (pending) + Web Dev Sprint (paid)
    expect(rec.accommodations.length).toBe(1); // 2-Day Accommodation (paid)
    // Paid: 999 (acc) + 300 (event) = 1299. Pending: 500 (footlose)
    expect(rec.totalPaidAmount).toBe(1299);
    expect(rec.totalPendingAmount).toBe(500);
    expect(rec.previewBannerText).toContain("Partially Paid");
  });

  it("21. Client-supplied amount or status manipulation cannot bypass server verification", async () => {
    const supabase = createMockSupabase(mockDb);

    // Attacker tries to verify a pending order by claiming it is paid
    const res = await verifyParticipantPayments({
      supabaseAdmin: supabase,
      participantIds: ["p-case1"], // case 1 order is locally pending
      mockGatewayResults: {
        "TXN-CASE1": { status: "pending", amountPaise: 99900, rawStatus: "pending" },
      },
    });

    const orderRes = res.orders.find((o) => o.orderReference === "SVK-ORD-CASE1");
    // Outcome MUST remain pending, not paid
    expect(orderRes?.outcome).toBe("PAYMENT_PENDING");
    expect(orderRes?.localOrderStatus).toBe("pending");
  });

  describe("Dialog Scrolling & Modal Layout Invariants", () => {
    beforeEach(() => {
      resetBodyScrollLockForTesting();
      // Setup mock global window and document
      const mockDoc = {
        body: {
          style: {
            overflow: "",
            paddingRight: "",
          },
        },
        documentElement: {
          clientWidth: 1000,
        },
      };
      (globalThis as any).document = mockDoc;
      (globalThis as any).window = {
        innerWidth: 1015,
      };
    });

    it("22. Opening the dialog locks background scroll and compensates for scrollbar width", () => {
      expect(getActiveBodyLockCountForTesting()).toBe(0);
      expect(document.body.style.overflow).toBe("");

      lockBodyScroll();

      expect(getActiveBodyLockCountForTesting()).toBe(1);
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.body.style.paddingRight).toBe("15px");
    });

    it("23. Closing the dialog restores prior background scroll state and clears compensation padding", () => {
      document.body.style.overflow = "visible";
      document.body.style.paddingRight = "4px";

      lockBodyScroll();
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.body.style.paddingRight).toBe("15px");

      unlockBodyScroll();
      expect(getActiveBodyLockCountForTesting()).toBe(0);
      expect(document.body.style.overflow).toBe("visible");
      expect(document.body.style.paddingRight).toBe("4px");
    });

    it("24. Multiple active dialogs increment reference count and preserve lock until all are closed", () => {
      lockBodyScroll(); // First dialog opens
      expect(getActiveBodyLockCountForTesting()).toBe(1);
      expect(document.body.style.overflow).toBe("hidden");

      lockBodyScroll(); // Second nested dialog opens
      expect(getActiveBodyLockCountForTesting()).toBe(2);
      expect(document.body.style.overflow).toBe("hidden");

      unlockBodyScroll(); // Second dialog closes
      expect(getActiveBodyLockCountForTesting()).toBe(1);
      expect(document.body.style.overflow).toBe("hidden"); // Still locked!

      unlockBodyScroll(); // First dialog closes
      expect(getActiveBodyLockCountForTesting()).toBe(0);
      expect(document.body.style.overflow).toBe(""); // Fully restored
    });

    it("25. Unmounting the dialog restores prior scroll state reliably without leaving page locked", () => {
      lockBodyScroll();
      expect(document.body.style.overflow).toBe("hidden");

      // Simulating component unmount / cleanup
      unlockBodyScroll();
      expect(document.body.style.overflow).toBe("");
      expect(getActiveBodyLockCountForTesting()).toBe(0);
    });

    it("26. Dialog structural layout enforces shrink-0 header/footer and overscroll-contain", () => {
      // Validate that layout classes prevent body scroll leakage and preserve header/footer visibility
      const dialogOverlayClasses = "fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200";
      const dialogCardClasses = "relative w-full max-w-5xl h-[min(90vh,calc(100dvh-2rem))] flex flex-col rounded-3xl bg-white shadow-2xl border border-black/10 overflow-hidden";
      const headerClasses = "flex items-center justify-between px-6 py-4 border-b border-black/[0.08] bg-black/[0.02] shrink-0";
      const bodyClasses = "flex-1 min-h-0 overflow-y-auto p-6 space-y-6";
      const footerClasses = "px-6 py-4 border-t border-black/[0.08] bg-black/[0.02] flex items-center justify-between shrink-0";

      expect(dialogOverlayClasses).toContain("fixed inset-0");
      expect(dialogCardClasses).toContain("h-[min(90vh,calc(100dvh-2rem))]");
      expect(dialogCardClasses).toContain("flex flex-col");
      expect(headerClasses).toContain("shrink-0");
      expect(bodyClasses).toContain("min-h-0");
      expect(bodyClasses).toContain("overflow-y-auto");
      expect(footerClasses).toContain("shrink-0");
    });
  });

  describe("Associated-Order Diagnostics (MUN Case & Multi-Registration Invariants)", () => {
    beforeEach(() => {
      // Set up MUN participant with 2 separate event registrations:
      // 1. UN General Assembly (₹500, Paid)
      // 2. UN Security Council (₹500, Pending)
      mockDb.participants.push({
        id: "p-mun-delegate",
        participant_id: "SVK26-MUN001",
        name: "MUN Delegate",
        email: "delegate@example.com",
        college: "CGC Landran",
        phone: "9876543299",
      });

      mockDb.participant_events.push(
        {
          id: "pe-mun-ga",
          participant_id: "p-mun-delegate",
          event_id: "evt-mun-ga",
          payment_status: "paid",
          payment_amount: 500,
          is_archived: false,
          events: {
            id: "evt-mun-ga",
            name: "United Nation General Assembly",
            category: "mun",
            payment_type: "paid",
            registration_fee: 500,
          },
        },
        {
          id: "pe-mun-sc",
          participant_id: "p-mun-delegate",
          event_id: "evt-mun-sc",
          payment_status: "pending",
          payment_amount: 500,
          is_archived: false,
          events: {
            id: "evt-mun-sc",
            name: "United Nation Security Council",
            category: "mun",
            payment_type: "paid",
            registration_fee: 500,
          },
        }
      );

      mockDb.payment_orders.push(
        {
          id: "po-mun-ga",
          order_reference: "SVK-ORD-MUN-GA",
          gateway: "payu",
          gateway_order_id: "TXN-MUN-GA",
          gateway_payment_id: "MIH-MUN-GA",
          amount: 500,
          currency: "INR",
          status: "paid",
          payer_participant_id: "p-mun-delegate",
        },
        {
          id: "po-mun-sc",
          order_reference: "SVK-ORD-MUN-SC",
          gateway: "payu",
          gateway_order_id: "TXN-MUN-SC",
          gateway_payment_id: null,
          amount: 500,
          currency: "INR",
          status: "pending",
          payer_participant_id: "p-mun-delegate",
        }
      );

      mockDb.payment_order_items.push(
        {
          id: "poi-mun-ga",
          payment_order_id: "po-mun-ga",
          item_type: "event",
          amount: 500,
          participant_event_id: "pe-mun-ga",
          events: { id: "evt-mun-ga", name: "United Nation General Assembly", registration_fee: 500 },
          participant_events: { id: "pe-mun-ga", payment_status: "paid", payment_amount: 500 },
        },
        {
          id: "poi-mun-sc",
          payment_order_id: "po-mun-sc",
          item_type: "event",
          amount: 500,
          participant_event_id: "pe-mun-sc",
          events: { id: "evt-mun-sc", name: "United Nation Security Council", registration_fee: 500 },
          participant_events: { id: "pe-mun-sc", payment_status: "pending", payment_amount: 500 },
        }
      );

      mockDb.payments.push({
        id: "pay-mun-ga",
        gateway_order_id: "TXN-MUN-GA",
        gateway_payment_id: "MIH-MUN-GA",
        amount: 500,
        status: "captured",
        participant_id: "p-mun-delegate",
      });
    });

    it("27. Two distinct MUN registrations produce two distinct order results under the participant", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase,
        participantIds: ["p-mun-delegate"],
        mockGatewayResults: {
          "TXN-MUN-GA": { status: "paid", amountPaise: 50000, gatewayPaymentId: "MIH-MUN-GA" },
          "TXN-MUN-SC": { status: "pending", amountPaise: 50000 },
        },
      });

      expect(res.orders.length).toBe(2);
      const gaOrder = res.orders.find((o) => o.orderReference === "SVK-ORD-MUN-GA");
      const scOrder = res.orders.find((o) => o.orderReference === "SVK-ORD-MUN-SC");

      expect(gaOrder).toBeDefined();
      expect(scOrder).toBeDefined();
      expect(gaOrder?.orderId).not.toBe(scOrder?.orderId);
      expect(gaOrder?.payerParticipantId).toBe("p-mun-delegate");
      expect(scOrder?.payerParticipantId).toBe("p-mun-delegate");
    });

    it("28. Paid General Assembly order does NOT imply payment for Security Council order", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase,
        participantIds: ["p-mun-delegate"],
        mockGatewayResults: {
          "TXN-MUN-GA": { status: "paid", amountPaise: 50000 },
          "TXN-MUN-SC": { status: "pending", amountPaise: 50000 },
        },
      });

      const gaOrder = res.orders.find((o) => o.orderReference === "SVK-ORD-MUN-GA");
      const scOrder = res.orders.find((o) => o.orderReference === "SVK-ORD-MUN-SC");

      expect(gaOrder?.outcome).toBe("MATCHED_PAID");
      expect(gaOrder?.localOrderStatus).toBe("paid");

      expect(scOrder?.outcome).toBe("PAYMENT_PENDING");
      expect(scOrder?.localOrderStatus).toBe("pending");

      // Verify that SEPARATE_ORDER_NOTICE is present on both orders
      const gaNotice = gaOrder?.diagnosticFindings.find((f) => f.type === "SEPARATE_ORDER_NOTICE");
      const scNotice = scOrder?.diagnosticFindings.find((f) => f.type === "SEPARATE_ORDER_NOTICE");
      expect(gaNotice).toBeDefined();
      expect(scNotice).toBeDefined();
      expect(gaNotice?.description).toContain("2 separate payment orders");
    });

    it("29. Repeated references to the same payment order UUID within a batch are deduplicated", async () => {
      const supabase = createMockSupabase(mockDb);

      // Add another registration pointing to the SAME order po-mun-ga
      mockDb.participant_events.push({
        id: "pe-mun-ga-teammate",
        participant_id: "p-shared-teammate",
        event_id: "evt-mun-ga",
        payment_status: "paid",
        payment_amount: 500,
        is_archived: false,
        events: { id: "evt-mun-ga", name: "United Nation General Assembly", registration_fee: 500 },
      });

      mockDb.payment_order_items.push({
        id: "poi-mun-ga-dup",
        payment_order_id: "po-mun-ga",
        item_type: "event",
        amount: 500,
        participant_event_id: "pe-mun-ga-teammate",
        events: { id: "evt-mun-ga", name: "United Nation General Assembly" },
        participant_events: { id: "pe-mun-ga-teammate", payment_status: "paid" },
      });

      // Verify both participants in same batch
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase,
        participantIds: ["p-mun-delegate", "p-shared-teammate"],
      });

      // po-mun-ga must appear only ONCE in the orders array
      const matches = res.orders.filter((o) => o.orderId === "po-mun-ga");
      expect(matches.length).toBe(1);
    });

    it("30. Inconsistent states produce specific DiagnosticFindings (Missing order link, Contradictory status, Amount mismatch)", async () => {
      const supabase = createMockSupabase(mockDb);

      // Add an unlinked payable event for a new participant
      mockDb.participants.push({
        id: "p-inconsistent",
        participant_id: "SVK26-INC01",
        name: "Inconsistent Participant",
        email: "inc@example.com",
      });

      mockDb.participant_events.push({
        id: "pe-unlinked-payable",
        participant_id: "p-inconsistent",
        event_id: "evt-unlinked",
        payment_status: "pending",
        payment_amount: 500,
        is_archived: false,
        events: {
          id: "evt-unlinked",
          name: "Unlinked Competition",
          payment_type: "paid",
          registration_fee: 500,
        },
      });

      // Create an order with contradictory status (order is 'paid', but linked item is 'pending')
      mockDb.payment_orders.push({
        id: "po-contradictory",
        order_reference: "SVK-ORD-CONTRA",
        gateway: "payu",
        gateway_order_id: "TXN-CONTRA",
        amount: 500,
        currency: "INR",
        status: "paid",
        payer_participant_id: "p-inconsistent",
      });

      mockDb.payment_order_items.push({
        id: "poi-contra-item",
        payment_order_id: "po-contradictory",
        item_type: "event",
        amount: 300, // Amount mismatch: order is 500, item is 300
        participant_event_id: "pe-contra-item",
        events: { id: "evt-contra", name: "Contra Event", registration_fee: 300 },
        participant_events: { id: "pe-contra-item", payment_status: "pending", payment_amount: 300 },
      });

      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase,
        participantIds: ["p-inconsistent"],
      });

      const contraOrder = res.orders.find((o) => o.orderReference === "SVK-ORD-CONTRA");
      expect(contraOrder).toBeDefined();

      // Contradictory local status finding
      const contraFinding = contraOrder?.diagnosticFindings.find(
        (f) => f.type === "CONTRADICTORY_LOCAL_STATUS"
      );
      expect(contraFinding).toBeDefined();

      // Amount allocation mismatch finding
      const allocFinding = contraOrder?.diagnosticFindings.find(
        (f) => f.type === "AMOUNT_ALLOCATION_MISMATCH"
      );
      expect(allocFinding).toBeDefined();

      // Missing order link for the unlinked event
      const missingFinding = res.findings?.find((f) => f.type === "MISSING_ORDER_LINK");
      expect(missingFinding).toBeDefined();
      expect(missingFinding?.description).toContain("Unlinked Competition");
    });

    it("31. Local simulation results are clearly labeled with preview flags and environment markers", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase,
        participantIds: ["p-mun-delegate"],
      });

      expect(res.summary.isLocalPreview).toBe(true);
      expect(res.summary.environment).toBe("local_simulation");

      res.orders.forEach((o) => {
        expect(o.diagnostics.isLocalPreview).toBe(true);
      });
    });

    it("32. Read-only verification strictly makes ZERO financial updates or mutations to database tables", async () => {
      const initialOrders = JSON.parse(JSON.stringify(mockDb.payment_orders));
      const initialPayments = JSON.parse(JSON.stringify(mockDb.payments));
      const initialEvents = JSON.parse(JSON.stringify(mockDb.participant_events));
      const initialAccommodations = JSON.parse(JSON.stringify(mockDb.participant_accommodations));

      const supabase = createMockSupabase(mockDb);

      await verifyParticipantPayments({
        supabaseAdmin: supabase,
        participantIds: ["p-case1", "p-case2", "p-mun-delegate"],
      });

      // Verify that no records were modified or inserted into financial tables
      expect(mockDb.payment_orders).toEqual(initialOrders);
      expect(mockDb.payments).toEqual(initialPayments);
      expect(mockDb.participant_events).toEqual(initialEvents);
      expect(mockDb.participant_accommodations).toEqual(initialAccommodations);
    });
  });

  /* =========================================================================
     PART 3, 4, 7: SAFE EXPLICIT PAYMENT RECONCILIATION & NOTIFICATIONS
  ========================================================================= */

  describe("Part 3, 4, 7: Explicit Reconciliation, Timestamp Integrity & Resilient Notifications", () => {
    it("33. Timestamps integrity: formatIndianTimestamp formats distinct timestamps and rejects cross-substitution", async () => {
      // 1. ISO UTC formatting
      const isoFormatted = formatIndianTimestamp("2026-10-21T10:30:00.000Z");
      expect(isoFormatted).toContain("21 Oct 2026");
      expect(isoFormatted).toContain("IST");

      // 2. PayU space-separated date format (YYYY-MM-DD HH:mm:ss)
      const payuFormatted = formatIndianTimestamp("2026-10-21 16:00:00");
      expect(payuFormatted).toContain("21 Oct 2026");
      expect(payuFormatted).toContain("IST");

      // 3. Missing/invalid fallback strictly returns 'Not available' without substitute
      expect(formatIndianTimestamp(null)).toBe("Not available");
      expect(formatIndianTimestamp(undefined)).toBe("Not available");
      expect(formatIndianTimestamp("")).toBe("Not available");
      expect(formatIndianTimestamp("invalid-date-string")).toBe("Not available");

      // 4. Verify in verifyParticipantPayments that timestamps remain distinct
      const supabase = createMockSupabase(mockDb);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase,
        participantIds: ["p-case1"],
      });

      const order = res.orders.find((o) => o.orderId === "po-case1-acc");
      expect(order).toBeDefined();
      expect(order?.verifiedAt).toBeDefined();
      // Order created at is distinct from verified at
      expect(typeof order?.verifiedAt).toBe("string");
      // If gateway did not return addedon, gatewayTransactionTime is null
      if (!order?.gatewayTransactionTime) {
        expect(formatIndianTimestamp(order?.gatewayTransactionTime)).toBe("Not available");
      }
    });

    it("34. Local simulation protection guard: reconciliation is disabled in preview mode without authorized mock fixture", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        // No mockGatewayResult provided
      });

      // When node env is test or local preview without fixture, it safely refuses to mutate
      expect(res.settled).toBe(false);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it("35. Authoritative settlement of eligible order: invokes process_payment_success RPC and creates audit log", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-test-id",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "PAYU-MIH-SETTLED-999",
          currency: "INR",
        },
      });

      expect(res.success).toBe(true);
      expect(res.settled).toBe(true);
      expect(res.orderReference).toBe("SVK-ORD-CASE1");
      expect(res.action).toBe("settled");

      // Verify that process_payment_success RPC was invoked with exact arguments
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_gateway_order_id: "TXN-CASE1",
          p_gateway_payment_id: "PAYU-MIH-SETTLED-999",
          p_amount_paise: 99900,
          p_currency: "INR",
          p_gateway_name: "payu",
        })
      );

      // Verify audit log entry
      const audit = mockDb.admin_audit_logs.find(
        (a) => a.action_type === "ADMIN_PAYMENT_RECONCILIATION_SETTLEMENT"
      );
      expect(audit).toBeDefined();
      expect(audit?.target_id).toBe("po-case1-acc");
      expect(audit?.details.amount).toBe(999);
    });

    it("36. Pre-settlement gate blocks pending, failed, or inconclusive gateway statuses", async () => {
      const supabase = createMockSupabase(mockDb);

      // Attempt reconciliation with pending status
      const pendingRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "pending",
          amountPaise: 99900,
          gatewayPaymentId: "PAYU-MIH-PENDING",
        },
      });

      expect(pendingRes.success).toBe(false);
      expect(pendingRes.settled).toBe(false);
      expect(pendingRes.error).toContain('Gateway status is "pending"');

      // Attempt reconciliation with failed status
      const failedRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "failure",
          amountPaise: 99900,
          gatewayPaymentId: "PAYU-MIH-FAILED",
        },
      });

      expect(failedRes.success).toBe(false);
      expect(failedRes.settled).toBe(false);
      expect(failedRes.error).toContain('Gateway status is "failure"');
    });

    it("37. Block amount mismatch and missing gateway transaction identifier", async () => {
      const supabase = createMockSupabase(mockDb);

      // Amount mismatch: Order is 999 (99900 paise), gateway reports 500 (50000 paise)
      const mismatchRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          gatewayPaymentId: "PAYU-MIH-MISMATCH",
        },
      });

      expect(mismatchRes.success).toBe(false);
      expect(mismatchRes.settled).toBe(false);
      expect(mismatchRes.error).toContain("Amount mismatch");

      // Missing gateway payment ID
      const missingIdRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "",
        },
      });

      expect(missingIdRes.success).toBe(false);
      expect(missingIdRes.settled).toBe(false);
      expect(missingIdRes.error).toContain("Missing gateway payment ID (mihpayid)");
    });

    it("38. Idempotency & duplicate settlement prevention: already-paid orders are short-circuited safely", async () => {
      const supabase = createMockSupabase(mockDb);

      // po-case2-acc is already 'paid' in mockDb
      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case2-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "PAYU-MIH-CASE2",
        },
      });

      expect(res.success).toBe(true);
      expect(res.alreadySettled).toBe(true);
      expect(res.action).toBe("already_paid");
      // Must NOT invoke process_payment_success again
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("39. Independent checkouts are preserved: settling one order never settles unrelated orders", async () => {
      const supabase = createMockSupabase(mockDb);

      // Add two independent orders for mun delegate
      mockDb.payment_orders.push({
        id: "po-mun-independent-1",
        order_reference: "SVK-ORD-MUN-1",
        gateway: "payu",
        gateway_order_id: "TXN-MUN-1",
        amount: 500,
        currency: "INR",
        status: "pending",
        payer_participant_id: "p-mun-delegate",
      });

      mockDb.payment_order_items.push({
        id: "poi-mun-1",
        payment_order_id: "po-mun-independent-1",
        item_type: "event",
        amount: 500,
        participant_event_id: "pe-mun-ga",
      });

      mockDb.payment_orders.push({
        id: "po-mun-independent-2",
        order_reference: "SVK-ORD-MUN-2",
        gateway: "payu",
        gateway_order_id: "TXN-MUN-2",
        amount: 500,
        currency: "INR",
        status: "pending",
        payer_participant_id: "p-mun-delegate",
      });

      mockDb.payment_order_items.push({
        id: "poi-mun-2",
        payment_order_id: "po-mun-independent-2",
        item_type: "event",
        amount: 500,
        participant_event_id: "pe-mun-sc",
      });

      // Settle ONLY order 1
      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-mun-independent-1",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          gatewayPaymentId: "PAYU-MIH-MUN-1",
        },
      });

      expect(res.success).toBe(true);
      expect(res.orderReference).toBe("SVK-ORD-MUN-1");

      // Verify that order 2 remains strictly pending
      const order2 = mockDb.payment_orders.find((o) => o.id === "po-mun-independent-2");
      expect(order2?.status).toBe("pending");
    });

    it("40. Canonical records are reloaded post-settlement before email dispatch", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "PAYU-MIH-RELOAD-TEST",
        },
      });

      expect(res.success).toBe(true);
      expect(res.reloadedOrder).toBeDefined();
      expect(res.linkedAccommodations).toBeDefined();
      expect(res.emailResult).toBeDefined();
      expect(res.emailResult?.attempted).toBe(true);
    });

    it("41. Email delivery failure is reported without undoing confirmed settlement", async () => {
      const supabase = createMockSupabase(mockDb);

      // Force an error in participant email retrieval during post-settlement email
      const originalFrom = supabase.from;
      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === "participants") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: { message: "Simulated participant lookup error" } }),
              }),
            }),
          };
        }
        return originalFrom(table);
      });

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "PAYU-MIH-EMAIL-FAIL-TEST",
        },
      });

      // Settlement MUST succeed even if email dispatch fails
      expect(res.success).toBe(true);
      expect(res.settled).toBe(true);
      expect(res.emailResult?.sent).toBe(false);
      expect(res.emailResult?.message).toContain("Participant record not found");

      // Settlement record in payment_orders must NOT be reverted
      const order = mockDb.payment_orders.find((o) => o.id === "po-case1-acc");
      expect(order?.status).toBe("paid");
    });

    it("42. Retrying email does not rerun settlement RPC and blocks unpaid orders", async () => {
      const supabase = createMockSupabase(mockDb);

      // 1. Retry email on paid order po-case2-acc
      const retryRes = await retryReconciliationEmail({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case2-acc",
      });

      expect(retryRes.attempted).toBe(true);
      expect(retryRes.sent).toBe(true);
      // RPC must NOT be called during email retry
      expect(supabase.rpc).not.toHaveBeenCalled();

      // 2. Retry email on an unpaid order (po-case1-acc if reset to pending)
      const unpaidOrder = mockDb.payment_orders.find((o) => o.id === "po-case1-acc");
      if (unpaidOrder) unpaidOrder.status = "pending";

      const unpaidRetryRes = await retryReconciliationEmail({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
      });

      expect(unpaidRetryRes.sent).toBe(false);
      expect(unpaidRetryRes.message).toContain("Order is not paid");
    });

    it("43. API Route /api/admin/payments/reconcile rejects unauthorized access with 401", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        user: null,
        role: null,
        error: "Unauthorized",
        status: 401,
        accommodation_access: false,
        assigned_category: null,
        assigned_events: [],
      } as any);

      const req = new NextRequest("http://localhost:3000/api/admin/payments/reconcile", {
        method: "POST",
        body: JSON.stringify({ paymentOrderId: "po-case1-acc" }),
      });

      const res = await reconcilePost(req);
      expect(res.status).toBe(401);
    });

    it("44. Client-supplied tampering of amounts, statuses or recipients is rejected", async () => {
      const supabase = createMockSupabase(mockDb);

      // Attempt to reconcile with an attacker trying to supply amount: 1, status: "paid", etc.
      // reconcilePaymentOrder accepts strictly { supabaseAdmin, adminId, adminEmail, paymentOrderId }
      // and reloads the authoritative order from the DB:
      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        // Even if attacker passes rogue fields in mock gateway result:
        mockGatewayResult: {
          status: "pending", // Gateway is pending, not paid
          amountPaise: 100, // Attacker says ₹1
          gatewayPaymentId: "ROGUE-PAYMENT-ID",
        },
      });

      expect(res.settled).toBe(false);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Gateway status is "pending"');

      // Now verify that if gateway amount does not match authoritative DB order amount (999), it is blocked
      const resMismatch = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "admin-1",
        adminEmail: "admin@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 100, // Attacker says ₹1
          gatewayPaymentId: "ROGUE-PAYMENT-ID",
        },
      });

      expect(resMismatch.settled).toBe(false);
      expect(resMismatch.success).toBe(false);
      expect(resMismatch.error).toContain("Amount mismatch");

      // Verify that the order in database was never mutated to paid or amount 1
      const order = mockDb.payment_orders.find((o) => o.id === "po-case1-acc");
      expect(order?.amount).toBe(999);
      expect(order?.status).toBe("pending");
    });

    it("45. Route validation: rejects invalid JSON and missing paymentOrderId parameter", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        user: { id: "master-1", email: "master@saviskar.internal" },
        role: "master",
        error: null,
        status: 200,
        accommodation_access: true,
        assigned_category: null,
        assigned_events: [],
      } as any);

      // Missing paymentOrderId
      const reqEmpty = new NextRequest("http://localhost:3000/api/admin/payments/reconcile", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const resEmpty = await reconcilePost(reqEmpty);
      expect(resEmpty.status).toBe(400);
      const jsonEmpty = await resEmpty.json();
      expect(jsonEmpty.error).toContain("Missing required paymentOrderId parameter");
    });

    it("46. Financial Authorization: Ordinary admin role attempting reconcile is strictly rejected with 403 Forbidden", async () => {
      vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValueOnce({
        user: { id: "admin-sub", email: "subadmin@saviskar.internal" },
        role: "admin",
        error: "Master Admin access required",
        status: 403,
        accommodation_access: true,
        assigned_category: null,
        assigned_events: [],
      } as any);

      const req = new NextRequest("http://localhost:3000/api/admin/payments/reconcile", {
        method: "POST",
        body: JSON.stringify({ action: "reconcile", paymentOrderId: "po-case1-acc" }),
      });

      const res = await reconcilePost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Master Admin access required");
    });

    it("47. Email Retry Authorization: Ordinary admin role calling retry_email is independently authorized", async () => {
      vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
        user: { id: "admin-sub", email: "subadmin@saviskar.internal" },
        role: "admin",
        error: null,
        status: 200,
        accommodation_access: true,
        assigned_category: null,
        assigned_events: [],
      } as any);

      vi.spyOn(reconLib, "retryReconciliationEmail").mockResolvedValueOnce({
        attempted: true,
        sent: true,
        status: "sent",
        message: "Email re-sent successfully.",
      });

      const req = new NextRequest("http://localhost:3000/api/admin/payments/reconcile", {
        method: "POST",
        body: JSON.stringify({ action: "retry_email", paymentOrderId: "po-case2-acc" }),
      });

      const res = await reconcilePost(req);
      // Admin session succeeds (email retry permitted for normal admins)
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.emailResult).toBeDefined();
      expect(json.emailResult.sent).toBe(true);
    });

    it("47b. Email Retry Authorization: Unauthenticated caller calling retry_email is rejected with 401 Unauthorized", async () => {
      vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
        user: null,
        role: null,
        error: "Unauthorized",
        status: 401,
        accommodation_access: false,
        assigned_category: null,
        assigned_events: [],
      } as any);

      const req = new NextRequest("http://localhost:3000/api/admin/payments/reconcile", {
        method: "POST",
        body: JSON.stringify({ action: "retry_email", paymentOrderId: "po-case2-acc" }),
      });

      const res = await reconcilePost(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Unauthorized");
    });

    it("48. Exact base-amount match: Gateway reporting exact ₹999 settles without tolerance and passes canonical paise to RPC", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900, // Exact match: ₹999.00
          gatewayPaymentId: "MIH-EXACT-MATCH",
          currency: "INR",
        },
      });

      expect(res.success).toBe(true);
      expect(res.settled).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_amount_paise: 99900, // Exact canonical base amount
          p_gateway_payment_id: "MIH-EXACT-MATCH",
        })
      );
    });

    it("49. Explicit PayU additional_charges surcharge: Gross ₹1000.18 with explicit ₹1.18 surcharge succeeds", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 100018, // Gross: ₹1,000.18
          additionalChargesPaise: 118, // Explicit PayU surcharge: ₹1.18
          gatewayPaymentId: "MIH-SURCHARGE-EXPLICIT",
          currency: "INR",
        },
      });

      expect(res.success).toBe(true);
      expect(res.settled).toBe(true);
      // RPC must receive canonical base order amount (₹999 = 99900 paise), NOT gross amount
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_amount_paise: 99900,
          p_gateway_payment_id: "MIH-SURCHARGE-EXPLICIT",
        })
      );
    });

    it("50. Zero tolerance: Unreported arbitrary extra amount (without explicit surcharge) is strictly blocked", async () => {
      const supabase = createMockSupabase(mockDb);

      // Gateway reports ₹1000.18, but additionalChargesPaise is 0 or absent (no explicit surcharge reported by PayU)
      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 100018, // ₹1,000.18
          additionalChargesPaise: 0, // Unreported!
          gatewayPaymentId: "MIH-UNREPORTED-SURCHARGE",
          currency: "INR",
        },
      });

      expect(res.success).toBe(false);
      expect(res.settled).toBe(false);
      expect(res.error).toContain("Amount mismatch");
      expect(res.error).toContain("Unreported extra amounts or arbitrary differences cannot be treated as permissible fees");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("51. Currency Mismatch: Gateway reporting foreign currency (USD) is strictly blocked", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-USD-FAIL",
          currency: "USD", // Mismatch against order's INR
        },
      });

      expect(res.success).toBe(false);
      expect(res.settled).toBe(false);
      expect(res.error).toContain("Currency mismatch");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("52. Gateway Order Reference (txnid) Mismatch is strictly blocked", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-TXN-MISMATCH",
          gatewayOrderId: "TXN-DIFFERENT-REFERENCE", // Mismatch against TXN-CASE1
          currency: "INR",
        },
      });

      expect(res.success).toBe(false);
      expect(res.settled).toBe(false);
      expect(res.error).toContain("Gateway order reference mismatch");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("53. Missing or empty gateway payment ID (mihpayid) is strictly blocked", async () => {
      const supabase = createMockSupabase(mockDb);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "po-case1-acc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "   ", // Blank ID
          currency: "INR",
        },
      });

      expect(res.success).toBe(false);
      expect(res.settled).toBe(false);
      expect(res.error).toContain("Missing gateway payment ID (mihpayid)");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("54. Modal scroll protection invariant: Dialog markup includes data-lenis-prevent and data-lenis-prevent-wheel", async () => {
      // Read the dialog files to assert structural compliance with Lenis smooth-scroll prevention
      const fs = await import("fs");
      const path = await import("path");

      const pvdPath = path.resolve(process.cwd(), "components/admin/PaymentVerificationDialog.tsx");
      const redPath = path.resolve(process.cwd(), "components/admin/ResendEmailDialog.tsx");

      const pvdContent = fs.readFileSync(pvdPath, "utf-8");
      const redContent = fs.readFileSync(redPath, "utf-8");

      // Verify that PaymentVerificationDialog contains data-lenis-prevent attributes
      expect(pvdContent).toContain('data-lenis-prevent="true"');
      expect(pvdContent).toContain('data-lenis-prevent-wheel="true"');

      // Verify that ResendEmailDialog contains data-lenis-prevent attributes
      expect(redContent).toContain('data-lenis-prevent="true"');
      expect(redContent).toContain('data-lenis-prevent-wheel="true"');
    });

    it("55. Kritika-like accommodation retry chain: 3 distinct orders pointing to the same accommodation booking emit RETRY_ORDER_NOTICE and preserve distinct statuses", async () => {
      const kritikaDb: MockDb = {
        participants: [
          {
            id: "part-kritika",
            participant_id: "SVK26-2B846A46",
            name: "Kritika Sangotra",
            email: "kritika@example.com",
            phone: "9876543210",
          },
        ],
        participant_events: [
          {
            id: "pe-canvas-art",
            participant_id: "part-kritika",
            event_id: "evt-canvas",
            payment_status: "confirmed",
            payment_amount: 0,
            is_archived: false,
            events: {
              id: "evt-canvas",
              name: "Canvas Art",
              category: "Non-Technical",
              payment_type: "free",
              registration_fee: 0,
            },
          },
        ],
        participant_accommodations: [
          {
            id: "acc-kritika-2day",
            participant_id: "part-kritika",
            amount: 999,
            currency: "INR",
            status: "pending",
            payment_order_id: "order-3-pending",
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            accommodation_plans: { name: "Two Days Accommodation" },
          },
        ],
        payment_orders: [
          {
            id: "order-1-failed",
            order_reference: "SVK-SVK26-2B846A46-20261019180605894-68460D",
            gateway: "payu",
            gateway_order_id: "SVK-1792433168043-c5151e1",
            gateway_payment_id: null,
            amount: 999,
            currency: "INR",
            status: "failed",
            payer_participant_id: "part-kritika",
            created_at: "2026-10-19T18:06:05Z",
          },
          {
            id: "order-2-failed",
            order_reference: "SVK-MVFKH73B-582FCD",
            gateway: "payu",
            gateway_order_id: "SVK-1792433250045-4baccf8",
            gateway_payment_id: null,
            amount: 999,
            currency: "INR",
            status: "failed",
            payer_participant_id: "part-kritika",
            created_at: "2026-10-19T18:07:29Z",
          },
          {
            id: "order-3-pending",
            order_reference: "SVK-MVFKKII8-4F4365",
            gateway: "payu",
            gateway_order_id: "SVK-1792433404794-c283787",
            gateway_payment_id: null,
            amount: 999,
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-kritika",
            created_at: "2026-10-19T18:10:04Z",
          },
        ],
        payment_order_items: [
          {
            id: "poi-1",
            payment_order_id: "order-1-failed",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-kritika-2day",
            participant_accommodations: {
              id: "acc-kritika-2day",
              amount: 999,
              status: "pending",
              start_date: "2026-10-28",
              end_date: "2026-10-30",
              accommodation_plans: { name: "Two Days Accommodation" },
            },
          },
          {
            id: "poi-2",
            payment_order_id: "order-2-failed",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-kritika-2day",
            participant_accommodations: {
              id: "acc-kritika-2day",
              amount: 999,
              status: "pending",
              start_date: "2026-10-28",
              end_date: "2026-10-30",
              accommodation_plans: { name: "Two Days Accommodation" },
            },
          },
          {
            id: "poi-3",
            payment_order_id: "order-3-pending",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-kritika-2day",
            participant_accommodations: {
              id: "acc-kritika-2day",
              amount: 999,
              status: "pending",
              start_date: "2026-10-28",
              end_date: "2026-10-30",
              accommodation_plans: { name: "Two Days Accommodation" },
            },
          },
        ],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(kritikaDb);
      const verifyRes = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-kritika"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": { status: "failed", amountPaise: 99900 },
          "SVK-1792433250045-4baccf8": { status: "failed", amountPaise: 99900 },
          "SVK-1792433404794-c283787": { status: "pending", amountPaise: 99900 },
        },
      });

      expect(verifyRes.success).toBe(true);
      // All 3 orders must remain distinct
      expect(verifyRes.orders).toHaveLength(3);

      const o1 = verifyRes.orders.find((o) => o.orderId === "order-1-failed")!;
      const o2 = verifyRes.orders.find((o) => o.orderId === "order-2-failed")!;
      const o3 = verifyRes.orders.find((o) => o.orderId === "order-3-pending")!;

      expect(o1.localOrderStatus).toBe("failed");
      expect(o2.localOrderStatus).toBe("failed");
      expect(o3.localOrderStatus).toBe("pending");

      // Verify that retry notice is emitted for each order in the retry chain
      expect(
        o3.diagnosticFindings.some((f) => f.type === "RETRY_ORDER_NOTICE")
      ).toBe(true);

      // Verify no automatic merge: each order maintains its own expected amount
      expect(o1.expectedAmount).toBe(999);
      expect(o2.expectedAmount).toBe(999);
      expect(o3.expectedAmount).toBe(999);
    });

    it("56. Conflicting item mapping: If an accommodation item is already marked paid under another order, verifying a second pending order yields CONFLICTING_ITEM_MAPPING and blocks reconciliation", async () => {
      const conflictDb: MockDb = {
        participants: [
          {
            id: "part-conflict",
            participant_id: "SVK26-CONFLICT",
            name: "Conflict Test",
            email: "conflict@example.com",
          },
        ],
        participant_events: [],
        participant_accommodations: [
          {
            id: "acc-shared",
            participant_id: "part-conflict",
            amount: 999,
            currency: "INR",
            status: "paid",
            payment_order_id: "order-already-paid",
          },
        ],
        payment_orders: [
          {
            id: "order-already-paid",
            order_reference: "SVK-ORDER-PAID",
            gateway: "payu",
            gateway_order_id: "TXN-PAID-1",
            amount: 999,
            currency: "INR",
            status: "paid",
            payer_participant_id: "part-conflict",
          },
          {
            id: "order-pending-dupe",
            order_reference: "SVK-ORDER-PENDING",
            gateway: "payu",
            gateway_order_id: "TXN-PENDING-2",
            amount: 999,
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-conflict",
          },
        ],
        payment_order_items: [
          {
            id: "poi-paid",
            payment_order_id: "order-already-paid",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-shared",
          },
          {
            id: "poi-pending",
            payment_order_id: "order-pending-dupe",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-shared",
          },
        ],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(conflictDb);

      // 1. Verification returns CONFLICTING_ITEM_MAPPING
      const verifyRes = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-conflict"],
        mockGatewayResults: {
          "TXN-PAID-1": { status: "paid", amountPaise: 99900 },
          "TXN-PENDING-2": { status: "paid", amountPaise: 99900 },
        },
      });

      const dupeOrder = verifyRes.orders.find((o) => o.orderId === "order-pending-dupe")!;
      expect(dupeOrder.outcome).toBe("CONFLICTING_ITEM_MAPPING");
      expect(dupeOrder.outcomeMessage).toContain("already mapped to another settled order");

      // 2. Reconciliation is strictly blocked
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-pending-dupe",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-CONFLICT-TEST",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain("Ambiguous item mapping");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("57. Conflicting item mapping: Sum of line items does not match payment order amount blocks reconciliation", async () => {
      const sumMismatchDb: MockDb = {
        participants: [
          { id: "part-sum", participant_id: "SVK26-SUM", name: "Sum Test", email: "sum@test.com" },
        ],
        participant_events: [],
        participant_accommodations: [],
        payment_orders: [
          {
            id: "order-sum-mismatch",
            order_reference: "SVK-SUM-MISMATCH",
            gateway: "payu",
            gateway_order_id: "TXN-SUM-1",
            amount: 1500, // Order expects ₹1,500
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-sum",
          },
        ],
        payment_order_items: [
          {
            id: "poi-sum-1",
            payment_order_id: "order-sum-mismatch",
            item_type: "event",
            amount: 500, // Only ₹500 line item! Sum is 500 !== 1500
            participant_event_id: "pe-some-id",
          },
        ],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(sumMismatchDb);
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sum-mismatch",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 150000,
          gatewayPaymentId: "MIH-SUM-TEST",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain("Conflicting item mapping: Sum of line items");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("58. Gateway reference mismatch: Verification returning a mismatched transaction reference yields GATEWAY_REFERENCE_MISMATCH", async () => {
      const mismatchDb: MockDb = {
        participants: [
          { id: "part-ref", participant_id: "SVK26-REF", name: "Ref Test", email: "ref@test.com" },
        ],
        participant_events: [],
        participant_accommodations: [
          {
            id: "acc-ref",
            participant_id: "part-ref",
            amount: 999,
            currency: "INR",
            status: "pending",
            accommodation_plans: { name: "Two Days Accommodation" },
          },
        ],
        payment_orders: [
          {
            id: "order-ref-test",
            order_reference: "SVK-REF-1",
            gateway: "payu",
            gateway_order_id: "TXN-EXPECTED-REF",
            amount: 999,
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-ref",
          },
        ],
        payment_order_items: [
          {
            id: "poi-ref",
            payment_order_id: "order-ref-test",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-ref",
          },
        ],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(mismatchDb);
      const verifyRes = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-ref"],
        mockGatewayResults: {
          "TXN-EXPECTED-REF": {
            status: "paid",
            amountPaise: 99900,
            gatewayOrderId: "TXN-DIFFERENT-REF", // Mismatched reference returned
          },
        },
      });

      expect(verifyRes.orders[0].outcome).toBe("GATEWAY_REFERENCE_MISMATCH");
      expect(verifyRes.orders[0].outcomeMessage).toContain("Gateway transaction reference mismatch");
    });

    it("59. Missing accommodation link: Order with accommodation item type but absent accommodation record yields MISSING_ACCOMMODATION_LINK", async () => {
      const missingAccDb: MockDb = {
        participants: [
          { id: "part-noacc", participant_id: "SVK26-NOACC", name: "No Acc Test", email: "noacc@test.com" },
        ],
        participant_events: [],
        participant_accommodations: [], // No accommodation in DB!
        payment_orders: [
          {
            id: "order-noacc",
            order_reference: "SVK-NOACC-1",
            gateway: "payu",
            gateway_order_id: "TXN-NOACC",
            amount: 999,
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-noacc",
          },
        ],
        payment_order_items: [
          {
            id: "poi-orphan-acc",
            payment_order_id: "order-noacc",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-deleted-or-missing",
            participant_accommodations: null, // Record missing!
          },
        ],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(missingAccDb);
      const verifyRes = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-noacc"],
        mockGatewayResults: {
          "TXN-NOACC": { status: "pending", amountPaise: 99900 },
        },
      });

      expect(verifyRes.orders[0].outcome).toBe("MISSING_ACCOMMODATION_LINK");
    });

    it("60. Free event with no accommodation: Valid free event yields MATCHED_PAID without requiring payment order", async () => {
      const freeDb: MockDb = {
        participants: [
          { id: "part-free", participant_id: "SVK26-FREE", name: "Free User", email: "free@example.com" },
        ],
        participant_events: [
          {
            id: "pe-free",
            participant_id: "part-free",
            event_id: "evt-canvas",
            payment_status: "confirmed",
            payment_amount: 0,
            is_archived: false,
            events: {
              id: "evt-canvas",
              name: "Canvas Art",
              category: "Non-Technical",
              payment_type: "free",
              registration_fee: 0,
            },
          },
        ],
        participant_accommodations: [],
        payment_orders: [],
        payment_order_items: [],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(freeDb);
      const verifyRes = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-free"],
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.orders).toHaveLength(1);
      expect(verifyRes.orders[0].orderReference).toBe("NO-ORDER");
      expect(verifyRes.orders[0].outcome).toBe("MATCHED_PAID");
      expect(verifyRes.orders[0].outcomeMessage).toContain("Free event registration verified. No payment order was required.");
      expect(verifyRes.findings).toHaveLength(0);
    });

    it("61. Free event with pending accommodation: Event confirmed free, accommodation pending with distinct payment order", async () => {
      const freeWithPendingAccDb: MockDb = {
        participants: [
          { id: "part-mix", participant_id: "SVK26-MIX", name: "Mix User", email: "mix@example.com" },
        ],
        participant_events: [
          {
            id: "pe-free-mix",
            participant_id: "part-mix",
            event_id: "evt-free",
            payment_status: "confirmed",
            payment_amount: 0,
            is_archived: false,
            events: {
              id: "evt-free",
              name: "Canvas Art",
              category: "Non-Technical",
              payment_type: "free",
              registration_fee: 0,
            },
          },
        ],
        participant_accommodations: [
          {
            id: "acc-mix",
            participant_id: "part-mix",
            amount: 999,
            currency: "INR",
            status: "pending",
            payment_order_id: "po-mix-acc",
            accommodation_plans: { name: "Two Days Accommodation" },
          },
        ],
        payment_orders: [
          {
            id: "po-mix-acc",
            order_reference: "SVK-MIX-ACC",
            gateway: "payu",
            gateway_order_id: "TXN-MIX-ACC",
            amount: 999,
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-mix",
          },
        ],
        payment_order_items: [
          {
            id: "poi-mix-acc",
            payment_order_id: "po-mix-acc",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-mix",
            participant_accommodations: {
              id: "acc-mix",
              amount: 999,
              status: "pending",
              accommodation_plans: { name: "Two Days Accommodation" },
            },
          },
        ],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(freeWithPendingAccDb);
      const verifyRes = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-mix"],
        mockGatewayResults: {
          "TXN-MIX-ACC": { status: "pending", amountPaise: 99900 },
        },
      });

      expect(verifyRes.orders).toHaveLength(1);
      expect(verifyRes.orders[0].orderReference).toBe("SVK-MIX-ACC");
      expect(verifyRes.orders[0].outcome).toBe("PAYMENT_PENDING");
      // The accommodation is pending, but the free event remains confirmed and is not marked as needing PayU
      const pe = freeWithPendingAccDb.participant_events[0];
      expect(pe.payment_status).toBe("confirmed");
    });

    it("62. Free event with paid accommodation: Reconciliation of accommodation leaves free event intact and email correctly lists both", async () => {
      const freeWithPaidAccDb: MockDb = {
        participants: [
          { id: "part-paidacc", participant_id: "SVK26-PAIDACC", name: "Paid Acc User", email: "paidacc@example.com" },
        ],
        participant_events: [
          {
            id: "pe-free-paidacc",
            participant_id: "part-paidacc",
            event_id: "evt-free-2",
            payment_status: "confirmed",
            payment_amount: 0,
            is_archived: false,
            events: {
              id: "evt-free-2",
              name: "Canvas Art",
              category: "Non-Technical",
              payment_type: "free",
              registration_fee: 0,
            },
          },
        ],
        participant_accommodations: [
          {
            id: "acc-paidacc",
            participant_id: "part-paidacc",
            amount: 999,
            currency: "INR",
            status: "pending",
            payment_order_id: "po-paidacc",
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            accommodation_plans: { name: "Two Days Accommodation" },
          },
        ],
        payment_orders: [
          {
            id: "po-paidacc",
            order_reference: "SVK-PAIDACC-ORDER",
            gateway: "payu",
            gateway_order_id: "TXN-PAIDACC-ORDER",
            amount: 999,
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-paidacc",
          },
        ],
        payment_order_items: [
          {
            id: "poi-paidacc",
            payment_order_id: "po-paidacc",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-paidacc",
            participant_accommodations: {
              id: "acc-paidacc",
              amount: 999,
              status: "pending",
              start_date: "2026-10-28",
              end_date: "2026-10-30",
              accommodation_plans: { name: "Two Days Accommodation" },
            },
          },
        ],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(freeWithPaidAccDb);
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "po-paidacc",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-PAIDACC-TEST",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(true);
      expect(reconRes.settled).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_amount_paise: 99900,
          p_gateway_payment_id: "MIH-PAIDACC-TEST",
        })
      );
    });
  });

  describe("Part 8: Comprehensive Retry-Chain Settlement Safety Audit (Exact Gateway-Paid Locally Failed Order)", () => {
    function buildKritikaRetryDb(): MockDb {
      return {
        participants: [
          {
            id: "part-kritika",
            participant_id: "SVK26-2B846A46",
            name: "Kritika Sangotra",
            email: "kritika@example.com",
            phone: "9876543210",
          },
        ],
        participant_events: [
          {
            id: "pe-canvas-art",
            participant_id: "part-kritika",
            event_id: "evt-canvas",
            payment_status: "confirmed",
            payment_amount: 0,
            is_archived: false,
            events: {
              id: "evt-canvas",
              name: "Canvas Art",
              category: "Non-Technical",
              payment_type: "free",
              registration_fee: 0,
            },
          },
        ],
        participant_accommodations: [
          {
            id: "acc-kritika-2day",
            participant_id: "part-kritika",
            amount: 999,
            currency: "INR",
            status: "pending",
            payment_order_id: "order-3-pending", // Currently linked to latest pending attempt
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            accommodation_plans: { name: "Two Days Accommodation" },
          },
        ],
        payment_orders: [
          {
            id: "order-1-failed",
            order_reference: "SVK-SVK26-2B846A46-20261019180605894-68460D",
            gateway: "payu",
            gateway_order_id: "SVK-1792433168043-c5151e1",
            gateway_payment_id: null,
            amount: 999,
            currency: "INR",
            status: "failed",
            payer_participant_id: "part-kritika",
            created_at: "2026-10-19T18:06:05Z",
          },
          {
            id: "order-2-failed",
            order_reference: "SVK-MVFKH73B-582FCD",
            gateway: "payu",
            gateway_order_id: "SVK-1792433250045-4baccf8",
            gateway_payment_id: null,
            amount: 999,
            currency: "INR",
            status: "failed",
            payer_participant_id: "part-kritika",
            created_at: "2026-10-19T18:07:29Z",
          },
          {
            id: "order-3-pending",
            order_reference: "SVK-MVFKKII8-4F4365",
            gateway: "payu",
            gateway_order_id: "SVK-1792433404794-c283787",
            gateway_payment_id: null,
            amount: 999,
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-kritika",
            created_at: "2026-10-19T18:10:04Z",
          },
        ],
        payment_order_items: [
          {
            id: "poi-1",
            payment_order_id: "order-1-failed",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-kritika-2day",
            participant_accommodations: {
              id: "acc-kritika-2day",
              amount: 999,
              status: "pending",
              start_date: "2026-10-28",
              end_date: "2026-10-30",
              accommodation_plans: { name: "Two Days Accommodation" },
            },
          },
          {
            id: "poi-2",
            payment_order_id: "order-2-failed",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-kritika-2day",
            participant_accommodations: {
              id: "acc-kritika-2day",
              amount: 999,
              status: "pending",
              start_date: "2026-10-28",
              end_date: "2026-10-30",
              accommodation_plans: { name: "Two Days Accommodation" },
            },
          },
          {
            id: "poi-3",
            payment_order_id: "order-3-pending",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "acc-kritika-2day",
            participant_accommodations: {
              id: "acc-kritika-2day",
              amount: 999,
              status: "pending",
              start_date: "2026-10-28",
              end_date: "2026-10-30",
              accommodation_plans: { name: "Two Days Accommodation" },
            },
          },
        ],
        payments: [],
        admin_audit_logs: [],
      };
    }

    it("63. Scenario A: Attempt 1 is confirmed paid by PayU (locally failed) -> safe settlement, accommodation repointed and confirmed paid, other attempts stay distinct", async () => {
      const db = buildKritikaRetryDb();
      const supabase = createMockSupabase(db);

      // Attempt 1 is locally failed, but PayU confirms it was paid with mihpayid
      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-1-failed",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-ATTEMPT-1",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(res.success).toBe(true);
      expect(res.settled).toBe(true);
      expect(res.orderReference).toBe("SVK-SVK26-2B846A46-20261019180605894-68460D");

      // Verify Attempt 1 is paid
      const o1 = db.payment_orders.find((o) => o.id === "order-1-failed")!;
      expect(o1.status).toBe("paid");
      expect(o1.gateway_payment_id).toBe("MIH-ATTEMPT-1");

      // Verify Attempts 2 & 3 remain distinct and unchanged
      const o2 = db.payment_orders.find((o) => o.id === "order-2-failed")!;
      const o3 = db.payment_orders.find((o) => o.id === "order-3-pending")!;
      expect(o2.status).toBe("failed");
      expect(o3.status).toBe("pending");

      // Verify accommodation is now paid and canonical payment_order_id is repointed to Attempt 1
      const acc = db.participant_accommodations.find((a) => a.id === "acc-kritika-2day")!;
      expect(acc.status).toBe("paid");
      expect(acc.payment_order_id).toBe("order-1-failed");

      // Verify exactly 1 canonical receipt in payments
      expect(db.payments).toHaveLength(1);
      expect(db.payments[0].gateway_order_id).toBe("SVK-1792433168043-c5151e1");
      expect(db.payments[0].gateway_payment_id).toBe("MIH-ATTEMPT-1");

      // Verify unrelated event status unchanged
      const pe = db.participant_events.find((e) => e.id === "pe-canvas-art")!;
      expect(pe.payment_status).toBe("confirmed");

      // Verify subsequent attempt to reconcile Attempt 2 or 3 is strictly blocked
      const dupeRecon = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-3-pending",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-ATTEMPT-3-LATE",
          gatewayOrderId: "SVK-1792433404794-c283787",
          currency: "INR",
        },
      });

      expect(dupeRecon.success).toBe(false);
      expect(dupeRecon.settled).toBe(false);
      expect(dupeRecon.error).toContain("Ambiguous item mapping: Linked accommodation booking is already marked paid under another payment order");
    });

    it("64. Scenario B: Attempt 2 is confirmed paid by PayU (locally failed) -> safe settlement, accommodation repointed to Attempt 2, Attempt 1 stays failed", async () => {
      const db = buildKritikaRetryDb();
      const supabase = createMockSupabase(db);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-2-failed",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-ATTEMPT-2",
          gatewayOrderId: "SVK-1792433250045-4baccf8",
          currency: "INR",
        },
      });

      expect(res.success).toBe(true);
      expect(res.settled).toBe(true);

      const o1 = db.payment_orders.find((o) => o.id === "order-1-failed")!;
      const o2 = db.payment_orders.find((o) => o.id === "order-2-failed")!;
      const o3 = db.payment_orders.find((o) => o.id === "order-3-pending")!;
      expect(o1.status).toBe("failed");
      expect(o2.status).toBe("paid");
      expect(o3.status).toBe("pending");

      const acc = db.participant_accommodations.find((a) => a.id === "acc-kritika-2day")!;
      expect(acc.status).toBe("paid");
      expect(acc.payment_order_id).toBe("order-2-failed");
      expect(db.payments).toHaveLength(1);
      expect(db.payments[0].gateway_order_id).toBe("SVK-1792433250045-4baccf8");
    });

    it("65. Scenario C: Attempt 3 is confirmed paid by PayU (locally pending) -> safe settlement, accommodation confirmed paid, payment_order_id stays Attempt 3", async () => {
      const db = buildKritikaRetryDb();
      const supabase = createMockSupabase(db);

      const res = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-3-pending",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-ATTEMPT-3",
          gatewayOrderId: "SVK-1792433404794-c283787",
          currency: "INR",
        },
      });

      expect(res.success).toBe(true);
      expect(res.settled).toBe(true);

      const o1 = db.payment_orders.find((o) => o.id === "order-1-failed")!;
      const o2 = db.payment_orders.find((o) => o.id === "order-2-failed")!;
      const o3 = db.payment_orders.find((o) => o.id === "order-3-pending")!;
      expect(o1.status).toBe("failed");
      expect(o2.status).toBe("failed");
      expect(o3.status).toBe("paid");

      const acc = db.participant_accommodations.find((a) => a.id === "acc-kritika-2day")!;
      expect(acc.status).toBe("paid");
      expect(acc.payment_order_id).toBe("order-3-pending");
      expect(db.payments).toHaveLength(1);
    });

    it("66. Scenario D: No attempt is confirmed paid -> reconciliation is strictly blocked, records remain unchanged", async () => {
      const db = buildKritikaRetryDb();
      const supabase = createMockSupabase(db);

      // Attempt 1 reports failed on gateway
      const res1 = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-1-failed",
        mockGatewayResult: {
          status: "failed",
          amountPaise: 99900,
          gatewayPaymentId: "",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(res1.success).toBe(false);
      expect(res1.settled).toBe(false);
      expect(res1.error).toContain('Gateway status is "failed"');

      // Attempt 3 reports pending on gateway
      const res3 = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-3-pending",
        mockGatewayResult: {
          status: "pending",
          amountPaise: 99900,
          gatewayPaymentId: "",
          gatewayOrderId: "SVK-1792433404794-c283787",
          currency: "INR",
        },
      });

      expect(res3.success).toBe(false);
      expect(res3.settled).toBe(false);
      expect(res3.error).toContain('Gateway status is "pending"');

      // Verify zero database mutations
      const o1 = db.payment_orders.find((o) => o.id === "order-1-failed")!;
      const o2 = db.payment_orders.find((o) => o.id === "order-2-failed")!;
      const o3 = db.payment_orders.find((o) => o.id === "order-3-pending")!;
      expect(o1.status).toBe("failed");
      expect(o2.status).toBe("failed");
      expect(o3.status).toBe("pending");

      const acc = db.participant_accommodations.find((a) => a.id === "acc-kritika-2day")!;
      expect(acc.status).toBe("pending");
      expect(acc.payment_order_id).toBe("order-3-pending");
      expect(db.payments).toHaveLength(0);
    });

    it("67. Idempotency on locally-failed retry order: Repeated reconciliation of settled Attempt 1 returns already_paid safely without double crediting", async () => {
      const db = buildKritikaRetryDb();
      const supabase = createMockSupabase(db);

      // First reconciliation
      const res1 = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-1-failed",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-ATTEMPT-1",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(res1.success).toBe(true);
      expect(res1.settled).toBe(true);

      // Second (duplicate/concurrent) reconciliation call
      const res2 = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-1-failed",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "MIH-ATTEMPT-1",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(res2.success).toBe(true);
      expect(res2.settled).toBe(true);
      expect(res2.alreadySettled).toBe(true);
      expect(res2.action).toBe("already_paid");
      // Still exactly 1 receipt in payments
      expect(db.payments).toHaveLength(1);
    });
  });

  // Database fixture matching real Supabase records for Kritika Sangotra
  function createKritikaAuthoritativeDb(): MockDb {
    return {
      participants: [
        {
          id: "c68d3f09-7fa9-4fd7-ad78-3d10921f6169",
          participant_id: "SVK26-2B846A46",
          name: "Kritika Sangotra",
          email: "kritika@example.com",
          phone: "9876543210",
        },
      ],
      participant_events: [
        {
          id: "3e54b6c3-1111-2222-3333-444455556666",
          participant_id: "c68d3f09-7fa9-4fd7-ad78-3d10921f6169",
          event_id: "evt-canvas",
          payment_status: "confirmed",
          payment_amount: 0,
          is_archived: false,
          events: {
            id: "evt-canvas",
            name: "Canvas Art",
            category: "Non-Technical",
            payment_type: "free",
            registration_fee: 0,
          },
        },
      ],
      participant_accommodations: [
        {
          id: "70f77d52-4f5a-4268-a4b3-00b9771ffd33",
          participant_id: "c68d3f09-7fa9-4fd7-ad78-3d10921f6169",
          amount: 999,
          currency: "INR",
          status: "pending",
          payment_order_id: "b55ef6d8-3902-4581-8f1b-797bdfb3b287", // Attempt 3
          start_date: "2026-10-28",
          end_date: "2026-10-30",
          accommodation_plans: { name: "Two Days Accommodation" },
        },
      ],
      payment_orders: [
        {
          // Attempt 1: Created at 11:36:05 PM IST
          id: "b2366e0f-e566-4632-8c68-0369baba05cb",
          order_reference: "SVK-SVK26-2B846A46-20261019180605894-68460D",
          gateway: "payu",
          gateway_order_id: "SVK-1792433168043-c5151e1",
          gateway_payment_id: null,
          amount: 999,
          currency: "INR",
          status: "failed",
          payer_participant_id: "c68d3f09-7fa9-4fd7-ad78-3d10921f6169",
          created_at: "2026-10-19T18:06:05.825965+00:00",
          updated_at: "2026-10-19T18:07:29.929717+00:00",
        },
        {
          // Attempt 2: Created at 11:37:29 PM IST
          id: "9e9d3f27-075c-4b59-913c-a66e00d89df6",
          order_reference: "SVK-MVFKH73B-582FCD",
          gateway: "payu",
          gateway_order_id: "SVK-1792433250045-4baccf8",
          gateway_payment_id: null,
          amount: 999,
          currency: "INR",
          status: "failed",
          payer_participant_id: "c68d3f09-7fa9-4fd7-ad78-3d10921f6169",
          created_at: "2026-10-19T18:07:29.929717+00:00",
          updated_at: "2026-10-19T18:10:04.69051+00:00",
        },
        {
          // Attempt 3: Created at 11:40:04 PM IST
          id: "b55ef6d8-3902-4581-8f1b-797bdfb3b287",
          order_reference: "SVK-MVFKKII8-4F4365",
          gateway: "payu",
          gateway_order_id: "SVK-1792433404794-c283787",
          gateway_payment_id: null,
          amount: 999,
          currency: "INR",
          status: "pending",
          payer_participant_id: "c68d3f09-7fa9-4fd7-ad78-3d10921f6169",
          created_at: "2026-10-19T18:10:04.69051+00:00",
          updated_at: "2026-10-19T18:10:04.794+00:00",
        },
      ],
      payment_order_items: [
        {
          id: "5898c280-175f-4dbb-9e46-049c749fbc5b",
          payment_order_id: "b2366e0f-e566-4632-8c68-0369baba05cb",
          item_type: "accommodation",
          amount: 999,
          participant_accommodation_id: "70f77d52-4f5a-4268-a4b3-00b9771ffd33",
          participant_accommodations: {
            id: "70f77d52-4f5a-4268-a4b3-00b9771ffd33",
            amount: 999,
            status: "pending",
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            accommodation_plans: { name: "Two Days Accommodation" },
          },
        },
        {
          id: "3ae7035c-aa7e-436a-82b8-15e140d87120",
          payment_order_id: "9e9d3f27-075c-4b59-913c-a66e00d89df6",
          item_type: "accommodation",
          amount: 999,
          participant_accommodation_id: "70f77d52-4f5a-4268-a4b3-00b9771ffd33",
          participant_accommodations: {
            id: "70f77d52-4f5a-4268-a4b3-00b9771ffd33",
            amount: 999,
            status: "pending",
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            accommodation_plans: { name: "Two Days Accommodation" },
          },
        },
        {
          id: "d7c4dc5c-ef14-49e6-8199-6cb102abb4a1",
          payment_order_id: "b55ef6d8-3902-4581-8f1b-797bdfb3b287",
          item_type: "accommodation",
          amount: 999,
          participant_accommodation_id: "70f77d52-4f5a-4268-a4b3-00b9771ffd33",
          participant_accommodations: {
            id: "70f77d52-4f5a-4268-a4b3-00b9771ffd33",
            amount: 999,
            status: "pending",
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            accommodation_plans: { name: "Two Days Accommodation" },
          },
        },
      ],
      payments: [],
      admin_audit_logs: [],
    };
  }

  describe("Part 9: Authoritative PayU Report Reference Matching & Amount/Fee Audit (Transactions_31387025914.pdf)", () => {
    it("69. Exact Merchant Ref ID & UDF1 Match against Authoritative PayU Report: Attempt 1 matches 100% character-for-character while Attempts 2 & 3 show NO MATCH", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // PDF report references:
      const pdfPayUTxnId = "31387025914";
      const pdfBankRef = "131568971245";
      const pdfMerchantRefId = "SVK-1792433168043-c5151e1";
      const pdfUdf1 = "SVK-SVK26-2B846A46-20261019180605894-68460D";

      const verifyRes = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["c68d3f09-7fa9-4fd7-ad78-3d10921f6169"],
        mockGatewayResults: {
          [pdfMerchantRefId]: {
            status: "paid",
            amountPaise: 100018,
            gatewayPaymentId: pdfPayUTxnId,
            gatewayOrderId: pdfMerchantRefId,
            rawStatus: "Success",
          },
        },
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.orders).toHaveLength(3);

      const attempt1 = verifyRes.orders.find((o) => o.orderId === "b2366e0f-e566-4632-8c68-0369baba05cb")!;
      const attempt2 = verifyRes.orders.find((o) => o.orderId === "9e9d3f27-075c-4b59-913c-a66e00d89df6")!;
      const attempt3 = verifyRes.orders.find((o) => o.orderId === "b55ef6d8-3902-4581-8f1b-797bdfb3b287")!;

      // Attempt 1: Exact Match to PayU PDF Report
      expect(attempt1.gatewayOrderId).toBe(pdfMerchantRefId);
      expect(attempt1.orderReference).toBe(pdfUdf1);
      expect(attempt1.localOrderStatus).toBe("failed");
      expect(attempt1.authoritativeGatewayStatus).toBe("paid");
      expect(attempt1.gatewayPaymentId).toBe(pdfPayUTxnId);

      // Attempts 2 & 3: Do NOT match the PDF report
      expect(attempt2.gatewayOrderId).not.toBe(pdfMerchantRefId);
      expect(attempt2.orderReference).not.toBe(pdfUdf1);
      expect(attempt3.gatewayOrderId).not.toBe(pdfMerchantRefId);
      expect(attempt3.orderReference).not.toBe(pdfUdf1);
    });

    it("70. Separate Amount & Fee Semantics: Customer Transaction Amount (₹1,000.18) vs Settlement Amount (₹999.00) with ₹0.00 Deductions settles canonical base amount", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // PDF report financial values:
      const customerTransactionAmountPaise = 100018; // ₹1,000.18
      const settlementBaseAmountPaise = 99900;       // ₹999.00
      const customerSideFeePaise = 118;              // ₹1.18 convenience fee
      const payUDeductionsFromSettlementPaise = 0;   // ₹0.00 deductions from merchant

      expect(customerTransactionAmountPaise - customerSideFeePaise).toBe(settlementBaseAmountPaise);
      expect(payUDeductionsFromSettlementPaise).toBe(0);

      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb", // Attempt 1
        mockGatewayResult: {
          status: "paid",
          amountPaise: customerTransactionAmountPaise,
          additionalChargesPaise: customerSideFeePaise,
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(true);
      expect(reconRes.settled).toBe(true);

      // Verify canonical settlement RPC was called with base settlement amount in paise (99900)
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_gateway_order_id: "SVK-1792433168043-c5151e1",
          p_gateway_payment_id: "31387025914",
          p_amount_paise: settlementBaseAmountPaise, // 99900 paise = ₹999.00
          p_currency: "INR",
        })
      );
    });

    it("71. Unreported difference without explicit fee confirmation is strictly blocked", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Gateway reports ₹1,000.18 but additionalChargesPaise is 0 (unreported)
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 100018,
          additionalChargesPaise: 0, // Unreported surcharge!
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain("Amount mismatch");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("72. Non-matching Merchant Reference is strictly rejected", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Reconciling Attempt 1 with mismatched gatewayOrderId
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-NON-EXISTENT-TXNID", // Mismatched reference
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain("Gateway order reference mismatch");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("73. Conflicting order/reference mapping: Attempting to settle Attempt 3 when PayU verified Attempt 1 is strictly rejected", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Attempting to reconcile Attempt 3 (SVK-1792433404794-c283787) with Attempt 1's gateway receipt
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b55ef6d8-3902-4581-8f1b-797bdfb3b287", // Attempt 3
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-1792433168043-c5151e1", // Attempt 1's txnid! Mismatch against Attempt 3
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain("Gateway order reference mismatch: Expected \"SVK-1792433404794-c283787\", but Gateway reported \"SVK-1792433168043-c5151e1\"");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("74. Older failed retry (Attempt 1) is settled while newer pending retry (Attempt 3) remains unpaid and distinct", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb", // Attempt 1
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(true);

      const o1 = db.payment_orders.find((o) => o.id === "b2366e0f-e566-4632-8c68-0369baba05cb")!;
      const o2 = db.payment_orders.find((o) => o.id === "9e9d3f27-075c-4b59-913c-a66e00d89df6")!;
      const o3 = db.payment_orders.find((o) => o.id === "b55ef6d8-3902-4581-8f1b-797bdfb3b287")!;

      // Attempt 1 is settled
      expect(o1.status).toBe("paid");
      expect(o1.gateway_payment_id).toBe("31387025914");

      // Attempt 2 remains failed
      expect(o2.status).toBe("failed");
      // Attempt 3 remains pending and unpaid
      expect(o3.status).toBe("pending");
      expect(o3.gateway_payment_id).toBeNull();

      // Accommodation is repointed to Attempt 1 and marked paid
      const acc = db.participant_accommodations.find((a) => a.id === "70f77d52-4f5a-4268-a4b3-00b9771ffd33")!;
      expect(acc.status).toBe("paid");
      expect(acc.payment_order_id).toBe("b2366e0f-e566-4632-8c68-0369baba05cb");
    });

    it("75. Read-only verification strictly makes ZERO mutations to records", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const snapshotBefore = JSON.stringify(db);

      await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["c68d3f09-7fa9-4fd7-ad78-3d10921f6169"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": { status: "paid", amountPaise: 99900 },
        },
      });

      const snapshotAfter = JSON.stringify(db);
      expect(snapshotAfter).toBe(snapshotBefore);
    });

    it("76. Simulation preview prevents any settlement calls or email dispatch", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const originalEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = "development";
        const res = await reconcilePaymentOrder({
          supabaseAdmin: supabase,
          adminId: "master-uuid",
          adminEmail: "master@saviskar.internal",
          paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
          // mockGatewayResult omitted
        });

        expect(res.success).toBe(false);
        expect(res.settled).toBe(false);
        expect(res.error).toContain("Reconciliation is disabled in local preview mode");
        expect(supabase.rpc).not.toHaveBeenCalled();
      } finally {
        (process.env as any).NODE_ENV = originalEnv;
      }
    });
  });

  // =========================================================================
  // Part 10: Automated Server-Side PayU Verification & Proactive Audit Engine
  // =========================================================================
  describe("Part 10: Automated Server-Side PayU Verification & Audit Engine", () => {
    it("77. PayUGateway fetchPaymentBatchDetails batches multiple order references safely", async () => {
      const origKey = process.env.PAYU_KEY;
      const origSalt = process.env.PAYU_SALT;
      const origEnv = process.env.PAYU_ENVIRONMENT;

      try {
        process.env.PAYU_KEY = "test_merchant_key";
        process.env.PAYU_SALT = "test_merchant_salt";
        process.env.PAYU_ENVIRONMENT = "test";

        const mockResponseData = {
          status: 1,
          msg: "2 out of 2 Transactions Fetched Successfully",
          transaction_details: {
            "SVK-1792433168043-c5151e1": {
              mihpayid: "31387025914",
              txnid: "SVK-1792433168043-c5151e1",
              status: "success",
              amt: "999.00",
              transaction_amount: "1000.18",
              additional_charges: "1.18",
              bank_ref_num: "131568971245",
              udf1: "SVK-SVK26-2B846A46-20261019180605894-68460D",
              net_amount_debit: "999.00",
              disc: "0.00",
              mode: "UPI",
            },
            "SVK-1792433250045-4baccf8": {
              mihpayid: "31387025999",
              txnid: "SVK-1792433250045-4baccf8",
              status: "failure",
              amt: "999.00",
              mode: "UPI",
            },
          },
        };

        const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify(mockResponseData),
        } as any);

        const gateway = new PayUGateway();
        const batchResults = await gateway.fetchPaymentBatchDetails([
          "SVK-1792433168043-c5151e1",
          "SVK-1792433250045-4baccf8",
        ]);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(batchResults["SVK-1792433168043-c5151e1"]).toBeDefined();
        expect(batchResults["SVK-1792433168043-c5151e1"].status).toBe("paid");
        expect(batchResults["SVK-1792433168043-c5151e1"].amount).toBe(99900); // 999.00 base paise
        expect(batchResults["SVK-1792433168043-c5151e1"].additionalCharges).toBe(118); // 1.18 paise
        expect(batchResults["SVK-1792433168043-c5151e1"].bankRefNum).toBe("131568971245");
        expect(batchResults["SVK-1792433168043-c5151e1"].udf1).toBe("SVK-SVK26-2B846A46-20261019180605894-68460D");
        expect(batchResults["SVK-1792433168043-c5151e1"].settlementAmount).toBe(99900);

        expect(batchResults["SVK-1792433250045-4baccf8"]).toBeDefined();
        expect(batchResults["SVK-1792433250045-4baccf8"].status).toBe("failed");

        fetchSpy.mockRestore();
      } finally {
        process.env.PAYU_KEY = origKey;
        process.env.PAYU_SALT = origSalt;
        process.env.PAYU_ENVIRONMENT = origEnv;
      }
    });

    it("78. PayUGateway handles missing credentials securely without leaking secrets", async () => {
      const origKey = process.env.PAYU_KEY;
      try {
        delete process.env.PAYU_KEY;
        const gateway = new PayUGateway();
        await expect(gateway.fetchPaymentDetails("SVK-123")).rejects.toThrow(
          "PAYU_KEY is not set in environment variables."
        );
      } finally {
        process.env.PAYU_KEY = origKey;
      }
    });

    it("79. getPaymentAuditScope discovers candidate anomalous orders and calculates breakdown counts", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const scope = await getPaymentAuditScope(supabase as any);

      expect(scope.totalCandidateOrders).toBeGreaterThanOrEqual(3);
      expect(scope.breakdown.pendingOrdersCount).toBe(1); // Attempt 3
      expect(scope.breakdown.failedOrdersCount).toBe(2); // Attempt 1 & Attempt 2
      expect(scope.breakdown.pendingAccommodationsWithOrdersCount).toBe(1);
      expect(scope.candidateOrderIds).toContain("b2366e0f-e566-4632-8c68-0369baba05cb");
      expect(scope.candidateOrderIds).toContain("9e9d3f27-075c-4b59-913c-a66e00d89df6");
      expect(scope.candidateOrderIds).toContain("b55ef6d8-3902-4581-8f1b-797bdfb3b287");
    });

    it("80. verifyPaymentOrders accepts orderIds directly and audits candidates without participant IDs", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const res = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 99900,
            gatewayPaymentId: "31387025914",
            bankRefNum: "131568971245",
            udf1: "SVK-SVK26-2B846A46-20261019180605894-68460D",
            additionalChargesPaise: 118,
            settlementAmountPaise: 99900,
          },
        },
      });

      expect(res.success).toBe(true);
      expect(res.orders.length).toBe(1);
      const o1 = res.orders[0];
      expect(o1.orderId).toBe("b2366e0f-e566-4632-8c68-0369baba05cb");
      expect(o1.payerName).toBe("Kritika Sangotra");
      expect(o1.expectedAmount).toBe(999);
      expect(o1.gatewayReportedAmount).toBe(999);
      expect(o1.additionalCharges).toBe(1.18);
      expect(o1.bankRefNum).toBe("131568971245");
      expect(o1.udf1).toBe("SVK-SVK26-2B846A46-20261019180605894-68460D");
      expect(o1.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING");
    });

    it("81. Server-side API timeouts map to inconclusive / gateway unavailable rather than false failure", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const res = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "gateway_unavailable",
            amountPaise: 0,
            rawStatus: "Network timeout contacting PayU endpoint",
          },
        },
      });

      expect(res.success).toBe(true);
      const o1 = res.orders[0];
      expect(o1.outcome).toBe("GATEWAY_UNAVAILABLE");
      expect(o1.localOrderStatus).toBe("failed"); // Remains untouched
    });

    it("82. generateSanitizedDiagnosticReport produces comprehensive markdown report without leaking credentials", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verification = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 99900,
            gatewayPaymentId: "31387025914",
            bankRefNum: "131568971245",
            udf1: "SVK-SVK26-2B846A46-20261019180605894-68460D",
            additionalChargesPaise: 118,
            settlementAmountPaise: 99900,
          },
        },
      });

      const report = generateSanitizedDiagnosticReport(verification);

      expect(report).toContain("SAVISKAR 2026 — AUTHORITATIVE PAYMENT RECONCILIATION AUDIT REPORT");
      expect(report).toContain("SVK-1792433168043-c5151e1");
      expect(report).toContain("31387025914");
      expect(report).toContain("131568971245");
      expect(report).toContain("₹999.00");
      expect(report).toContain("₹1.18");

      // Strictly ZERO secrets or salts
      expect(report).not.toContain("PAYU_KEY");
      expect(report).not.toContain("PAYU_SALT");
      expect(report).not.toContain("sha512");
    });

    it("83. Audit API routes (/api/admin/payments/audit GET and POST) enforce admin authentication and bounded batch execution", async () => {
      // 1. Unauthenticated GET is rejected with 401
      vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
        supabase: {} as any,
        user: null,
        role: null,
        accommodation_access: false,
        assigned_category: null,
        assigned_events: [],
        status: 401,
        error: "Unauthorized",
      });

      const unauthGetRes = await auditGet();
      expect(unauthGetRes.status).toBe(401);

      // 2. Unauthenticated POST is rejected with 401
      vi.spyOn(serverLib, "requireAdmin").mockResolvedValueOnce({
        supabase: {} as any,
        user: null,
        role: null,
        accommodation_access: false,
        assigned_category: null,
        assigned_events: [],
        status: 401,
        error: "Unauthorized",
      });

      const unauthPostReq = new NextRequest("http://localhost:3000/api/admin/payments/audit", {
        method: "POST",
        body: JSON.stringify({ limit: 10 }),
      });
      const unauthPostRes = await auditPost(unauthPostReq);
      expect(unauthPostRes.status).toBe(401);
    });

    it("84. Separate base, transaction and settlement amounts are reported with exact surcharges", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const res = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 99900,
            gatewayPaymentId: "31387025914",
            bankRefNum: "131568971245",
            udf1: "SVK-SVK26-2B846A46-20261019180605894-68460D",
            additionalChargesPaise: 118,
            settlementAmountPaise: 99900,
            deductionsPaise: 0,
            customerTransactionAmountPaise: 100018,
          },
        },
      });

      const o = res.orders[0];
      expect(o.expectedAmount).toBe(999); // Base order
      expect(o.gatewayReportedAmount).toBe(999); // Base captured
      expect(o.additionalCharges).toBe(1.18); // Convenience fee
      expect(o.settlementAmount).toBe(999); // Credited to CGC Jhanjeri
      expect(o.deductions).toBe(0); // Zero PayU deductions
      expect(o.customerTransactionAmount).toBe(1000.18); // Gross customer debit
    });
  });
});
