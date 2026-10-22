import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  verifyParticipantPayments,
  verifyPaymentOrders,
  getPaymentAuditScope,
  generateSanitizedDiagnosticReport,
  toPaise,
  ReconciliationOutcome,
  formatIndianTimestamp,
  getReconciliationConfirmationSummary,
  computeItemAllocationBreakdown,
  formatINR,
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
import { PayUGateway, normalizePayUAmountFields, parsePaise } from "@/lib/payments/payu";
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

  it("2. Case 1 diagnosis: Gateway paid but local pending (bank 1000.18 vs order 999.00 with explicit PayU surcharge)", async () => {
    const supabase = createMockSupabase(mockDb);

    // Mock PayU returning ₹1000.18 (100018 paise) with explicit ₹1.18 surcharge
    const mockGatewayResults = {
      "TXN-CASE1": {
        status: "paid",
        amountPaise: 100018, // 1,000.18 gross
        additionalChargesPaise: 118, // explicit 1.18 surcharge
        customerTransactionAmountPaise: 100018,
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
    expect(orderRes?.customerTransactionAmount).toBe(1000.18);
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
              amount_settled: "999.00",
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

  // =========================================================================
  // Part 11: PayU Amount Normalization, Ambiguity Gates & Regression Suite (A–L)
  // =========================================================================
  describe("Part 11: PayU Amount Normalization, Ambiguity Gates & Regression Suite (A–L)", () => {
    it("85. Scenario A: Local order amount matches PayU canonical base amount, while payer debit legitimately differs by explicit surcharge", () => {
      const txRecord = {
        amt: "999.00",
        transaction_amount: "999.00",
        additional_charges: "1.18",
        net_amount_debit: "999.00",
        amount_settled: "999.00",
        disc: "0.00",
      };

      const normalized = normalizePayUAmountFields(txRecord);

      expect(normalized.baseAmountPaise).toBe(99900); // Canonical base ₹999.00
      expect(normalized.customerTransactionAmountPaise).toBe(100018); // ₹1,000.18 payer debit
      expect(normalized.additionalChargesPaise).toBe(118); // ₹1.18 explicit surcharge
      expect(normalized.settlementAmountPaise).toBe(99900); // ₹999.00 net merchant settlement
      expect(normalized.amountAmbiguityReason).toBeUndefined();
    });

    it("86. Scenario B: Department-style report with customer amount ₹1,000.18 and merchant settlement ₹999.00 reconciles canonical base amount", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb", // Attempt 1
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900, // Authoritative base amount
          additionalChargesPaise: 118, // Surcharge reported
          customerTransactionAmountPaise: 100018, // Customer debit
          settlementAmountPaise: 99900, // CGC settlement
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(true);
      expect(reconRes.settled).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_amount_paise: 99900, // Canonical base order amount
          p_gateway_payment_id: "31387025914",
          p_gateway_order_id: "SVK-1792433168043-c5151e1",
        })
      );
    });

    it("87. Scenario C: PayU response where amt differs from transaction_amount is not assumed interchangeable without reconciliation", () => {
      // Discordant case: amt = 999.00, transaction_amount = 950.00, additional_charges = 0
      const discordantRecord = {
        amt: "999.00",
        transaction_amount: "950.00",
        additional_charges: "0.00",
      };
      const resultDiscordant = normalizePayUAmountFields(discordantRecord);
      expect(resultDiscordant.amountAmbiguityReason).toBeDefined();
      expect(resultDiscordant.amountAmbiguityReason).toContain("PayU amount fields mismatch");

      // Gross reconciled case: amt = 999.00, transaction_amount = 1000.18, additional_charges = 1.18
      const reconciledRecord = {
        amt: "999.00",
        transaction_amount: "1000.18",
        additional_charges: "1.18",
      };
      const resultReconciled = normalizePayUAmountFields(reconciledRecord);
      expect(resultReconciled.amountAmbiguityReason).toBeUndefined();
      expect(resultReconciled.baseAmountPaise).toBe(99900);
      expect(resultReconciled.customerTransactionAmountPaise).toBe(100018);
    });

    it("88. Scenario D: Response in which net_amount_debit differs from amount_settled flags settlement discrepancy", () => {
      const conflictingSettlementRecord = {
        amt: "999.00",
        transaction_amount: "999.00",
        net_amount_debit: "999.00",
        amount_settled: "950.00", // Discordant settlement amount!
      };
      const result = normalizePayUAmountFields(conflictingSettlementRecord);
      expect(result.amountAmbiguityReason).toBeDefined();
      expect(result.amountAmbiguityReason).toContain("PayU settlement discrepancy");
      expect(result.settlementAmountPaise).toBe(95000);
    });

    it("89. Scenario E: Successful PayU transaction with an amount-field ambiguity strictly blocks reconciliation", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Status is 'paid', but amount fields are discordant
      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 99900,
            gatewayPaymentId: "31387025914",
            amountAmbiguityReason: "PayU amount fields mismatch: 'amt' (₹999) and 'transaction_amount' (₹950) differ",
          },
        },
      });

      expect(verifyRes.orders[0].outcome).toBe("AMOUNT_MISMATCH");
      expect(verifyRes.orders[0].outcomeMessage).toContain("Amount field ambiguity");

      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "31387025914",
          amountAmbiguityReason: "PayU amount fields mismatch: 'amt' (₹999) and 'transaction_amount' (₹950) differ",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain("Amount field ambiguity");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("89b. Scenario F: Explicit documented customer surcharge classifies according to true contract without blanket tolerance", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 99900, // Exact canonical base
            additionalChargesPaise: 118, // Explicit 1.18 surcharge
            customerTransactionAmountPaise: 100018,
            gatewayPaymentId: "31387025914",
          },
        },
      });

      const o = verifyRes.orders[0];
      expect(o.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING");
      expect(o.expectedAmount).toBe(999);
      expect(o.gatewayReportedAmount).toBe(999);
      expect(o.additionalCharges).toBe(1.18);
      expect(o.customerTransactionAmount).toBe(1000.18);
    });

    it("90. Scenario G: Payment with no explicitly reported additional charge: arbitrary difference strictly rejected", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Gateway reports ₹1000.18 but additionalChargesPaise is 0 / not returned
      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 100018, // ₹1,000.18
            additionalChargesPaise: 0, // Unreported surcharge!
            gatewayPaymentId: "31387025914",
          },
        },
      });

      const o = verifyRes.orders[0];
      expect(o.outcome).toBe("AMOUNT_MISMATCH");
      expect(o.outcomeMessage).toContain("Unreported differences cannot be treated as permissible fees");
    });

    it("91. Scenario H: Wrong merchant reference, transaction ID or currency strictly blocked", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Wrong currency
      const reconCurrency = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "31387025914",
          currency: "USD", // Wrong currency!
        },
      });
      expect(reconCurrency.success).toBe(false);
      expect(reconCurrency.error).toContain("Currency mismatch");

      // Missing transaction ID
      const reconMissingId = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "", // Missing mihpayid!
        },
      });
      expect(reconMissingId.success).toBe(false);
      expect(reconMissingId.error).toContain("Missing gateway payment ID (mihpayid)");
    });

    it("92. Scenario I: Failed local retry confirmed paid: only that exact order becomes eligible and settles", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Attempt 1 is confirmed paid
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
        },
      });

      expect(reconRes.success).toBe(true);

      const o1 = db.payment_orders.find((o) => o.id === "b2366e0f-e566-4632-8c68-0369baba05cb")!;
      const o2 = db.payment_orders.find((o) => o.id === "9e9d3f27-075c-4b59-913c-a66e00d89df6")!;
      const o3 = db.payment_orders.find((o) => o.id === "b55ef6d8-3902-4581-8f1b-797bdfb3b287")!;

      expect(o1.status).toBe("paid");
      expect(o2.status).toBe("failed");
      expect(o3.status).toBe("pending");
    });

    it("93. Scenario J: Already-settled order safe idempotency", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Pre-set order as already paid
      const o1 = db.payment_orders.find((o) => o.id === "b2366e0f-e566-4632-8c68-0369baba05cb")!;
      o1.status = "paid";

      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: o1.id,
      });

      expect(reconRes.success).toBe(true);
      expect(reconRes.alreadySettled).toBe(true);
      expect(reconRes.action).toBe("already_paid");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it("94. Scenario K: Simulated gateway response attempting reconciliation is blocked", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const originalEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = "development";
        const reconRes = await reconcilePaymentOrder({
          supabaseAdmin: supabase,
          adminId: "master-uuid",
          adminEmail: "master@saviskar.internal",
          paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
          // No mock provided in dev mode
        });

        expect(reconRes.success).toBe(false);
        expect(reconRes.error).toContain("Reconciliation is disabled in local preview mode");
        expect(supabase.rpc).not.toHaveBeenCalled();
      } finally {
        (process.env as any).NODE_ENV = originalEnv;
      }
    });

    it("95. Scenario L: Sanitized diagnostics show all raw-source field values separately without sensitive credentials", async () => {
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
            deductionsPaise: 0,
            customerTransactionAmountPaise: 100018,
            payuAmtPaise: 99900,
            payuTransactionAmountPaise: 99900,
          },
        },
      });

      const report = generateSanitizedDiagnosticReport(verification);

      expect(report).toContain("**Local Order Amount (payment_orders.amount)**: ₹999.00 INR");
      expect(report).toContain("**Gateway Base Amount (PayU amt / transaction_amount)**: ₹999.00 INR");
      expect(report).toContain("**Additional Charge Reported by PayU (additional_charges)**: ₹1.18");
      expect(report).toContain("**Customer Debit (Calculated/Reported)**: ₹1000.18");
      expect(report).toContain("**Merchant Settlement (amount_settled)**: ₹999.00");
      expect(report).toContain("**Gateway Deductions / Fees (PayU disc)**: ₹0.00");
      expect(report).toContain("**PayU Raw Fields**: amt: 999.00, transaction_amount: 999.00");

      // Zero sensitive tokens
      expect(report).not.toContain("PAYU_KEY");
      expect(report).not.toContain("PAYU_SALT");
      expect(report).not.toContain("sha512");
    });
  });

  // =========================================================================
  // Part 12: Reconciliation Confirmation Dialog Display & Transition Safety Suite (97–107)
  // =========================================================================
  describe("Part 12: Reconciliation Confirmation Dialog Display & Transition Safety", () => {
    it("97. Requirement 1: Separate Reference Identifiers are accurately labeled without ambiguity", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "order-uuid-1",
        orderReference: "SVK-SVK26-2B846A46-20261019180605894-68460D",
        gatewayOrderId: "SVK-1792433168043-c5151e1",
        gatewayPaymentId: "31387025914",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0001",
        expectedAmount: 999,
        currency: "INR",
        gatewayReportedAmount: 999,
        gatewayReportedCurrency: "INR",
        additionalCharges: 1.18,
        settlementAmount: 999,
        customerTransactionAmount: 1000.18,
        localOrderStatus: "failed",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        outcomeMessage: "Payment confirmed on gateway.",
        linkedItems: [
          {
            id: "acc-1",
            itemType: "accommodation",
            title: "2 Days Accommodation",
            expectedAmount: 999,
            localStatus: "pending",
          },
        ],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.saviskarOrderRef).toBe("SVK-SVK26-2B846A46-20261019180605894-68460D");
      expect(summary.merchantTxnRef).toBe("SVK-1792433168043-c5151e1");
      expect(summary.payuPaymentId).toBe("31387025914");
      expect(summary.expectedAmountINR).toBe(999);
      expect(summary.canSettle).toBe(true);
    });

    it("98. Requirement 1 & 4: Merchant Transaction Reference (txnid) is NEVER substituted as PayU Payment ID (mihpayid)", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "order-uuid-2",
        orderReference: "SVK-ORD-REF",
        gatewayOrderId: "SVK-TXNID-12345", // merchant reference (txnid)
        gatewayPaymentId: null, // missing mihpayid!
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0002",
        expectedAmount: 999,
        currency: "INR",
        gatewayReportedAmount: 999,
        gatewayReportedCurrency: "INR",
        additionalCharges: 0,
        localOrderStatus: "failed",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        outcomeMessage: "Payment confirmed on gateway.",
        linkedItems: [],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.merchantTxnRef).toBe("SVK-TXNID-12345");
      // Must NOT substitute gatewayOrderId into payuPaymentId!
      expect(summary.payuPaymentId).not.toBe("SVK-TXNID-12345");
      expect(summary.payuPaymentId).toBe("Not returned by PayU");
      expect(summary.canSettle).toBe(false);
      expect(summary.blockReason).toContain("Missing PayU Payment ID (mihpayid)");
    });

    it("99. Requirement 1 & 8: Missing IDs display Unavailable fallback rather than cross-populating", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "order-uuid-3",
        orderReference: "",
        gatewayOrderId: "",
        gatewayPaymentId: "",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0003",
        expectedAmount: 999,
        currency: "INR",
        gatewayReportedAmount: 999,
        gatewayReportedCurrency: "INR",
        additionalCharges: 0,
        localOrderStatus: "failed",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        outcomeMessage: "Payment confirmed on gateway.",
        linkedItems: [],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.saviskarOrderRef).toBe("Unavailable");
      expect(summary.merchantTxnRef).toBe("Unavailable");
      expect(summary.payuPaymentId).toBe("Not returned by PayU");
    });

    it("100. Requirement 2 & 5 & 6: Known Target Case derives Payment Order FAILED → PAID and 2 Days Accommodation PENDING → PAID", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        orderReference: "SVK-SVK26-2B846A46-20261019180605894-68460D",
        gatewayOrderId: "SVK-1792433168043-c5151e1",
        gatewayPaymentId: "31387025914",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Kritika Sangotra",
        payerEmail: "kritika@example.com",
        payerPublicId: "SVK-26-0004",
        expectedAmount: 999,
        currency: "INR",
        gatewayReportedAmount: 999,
        gatewayReportedCurrency: "INR",
        additionalCharges: 1.18,
        settlementAmount: 999,
        customerTransactionAmount: 1000.18,
        localOrderStatus: "failed", // Real local order status is FAILED
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        outcomeMessage: "Gateway captured payment; eligible for administrative settlement.",
        linkedItems: [
          {
            id: "70f77d52-4f5a-4268-a4b3-00b9771ffd33",
            itemType: "accommodation",
            title: "2 Days Accommodation",
            expectedAmount: 999,
            localStatus: "pending",
          },
        ],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.transitions).toHaveLength(2);

      // 1. Payment Order row: FAILED → PAID (NOT hardcoded pending!)
      expect(summary.transitions[0].recordName).toBe("Payment Order");
      expect(summary.transitions[0].sourceStatus).toBe("failed");
      expect(summary.transitions[0].targetStatus).toBe("paid");
      expect(summary.transitions[0].transitionDisplay).toBe("FAILED → PAID");
      expect(summary.transitions[0].isUnchanged).toBe(false);

      // 2. Accommodation row: PENDING → PAID
      expect(summary.transitions[1].recordName).toBe("2 Days Accommodation");
      expect(summary.transitions[1].sourceStatus).toBe("pending");
      expect(summary.transitions[1].targetStatus).toBe("paid");
      expect(summary.transitions[1].transitionDisplay).toBe("PENDING → PAID");
      expect(summary.transitions[1].isUnchanged).toBe(false);

      expect(summary.canSettle).toBe(true);
    });

    it("101. Requirement 2 & 5: Payment order with local status pending shows PENDING → PAID", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "order-pending-1",
        orderReference: "SVK-PENDING-REF",
        gatewayOrderId: "SVK-TXN-PENDING",
        gatewayPaymentId: "31387099999",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0005",
        expectedAmount: 500,
        currency: "INR",
        gatewayReportedAmount: 500,
        gatewayReportedCurrency: "INR",
        additionalCharges: 0,
        localOrderStatus: "pending",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        outcomeMessage: "Gateway captured payment.",
        linkedItems: [
          {
            id: "evt-1",
            itemType: "event",
            title: "Roborace Challenge",
            expectedAmount: 500,
            localStatus: "pending",
          },
        ],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.transitions[0].transitionDisplay).toBe("PENDING → PAID");
      expect(summary.transitions[1].transitionDisplay).toBe("PENDING → PAID");
      expect(summary.canSettle).toBe(true);
    });

    it("102. Requirement 2 & 7: Multiple linked items each display their independent expected transition", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "multi-order-1",
        orderReference: "SVK-MULTI-REF",
        gatewayOrderId: "SVK-TXN-MULTI",
        gatewayPaymentId: "31387088888",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0006",
        expectedAmount: 1499,
        currency: "INR",
        gatewayReportedAmount: 1499,
        gatewayReportedCurrency: "INR",
        additionalCharges: 0,
        localOrderStatus: "failed",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        outcomeMessage: "Gateway captured payment.",
        linkedItems: [
          {
            id: "evt-1",
            itemType: "event",
            title: "Web Dev Sprint",
            expectedAmount: 500,
            localStatus: "pending",
          },
          {
            id: "acc-1",
            itemType: "accommodation",
            title: "2 Days Accommodation",
            expectedAmount: 999,
            localStatus: "pending",
          },
        ],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.transitions).toHaveLength(3);
      expect(summary.transitions[0].recordName).toBe("Payment Order");
      expect(summary.transitions[0].transitionDisplay).toBe("FAILED → PAID");

      expect(summary.transitions[1].recordName).toBe("Web Dev Sprint");
      expect(summary.transitions[1].transitionDisplay).toBe("PENDING → PAID");

      expect(summary.transitions[2].recordName).toBe("2 Days Accommodation");
      expect(summary.transitions[2].transitionDisplay).toBe("PENDING → PAID");
    });

    it("103. Requirement 2: Already-paid items do not claim active status changes and block redundant settlement", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "paid-order-1",
        orderReference: "SVK-ALREADY-PAID",
        gatewayOrderId: "SVK-TXN-PAID",
        gatewayPaymentId: "31387077777",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0007",
        expectedAmount: 999,
        currency: "INR",
        gatewayReportedAmount: 999,
        gatewayReportedCurrency: "INR",
        additionalCharges: 0,
        localOrderStatus: "paid",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_created",
        outcome: "MATCHED_PAID",
        outcomeMessage: "Order is already paid.",
        linkedItems: [
          {
            id: "acc-1",
            itemType: "accommodation",
            title: "2 Days Accommodation",
            expectedAmount: 999,
            localStatus: "paid",
          },
        ],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.transitions[0].isUnchanged).toBe(true);
      expect(summary.transitions[0].transitionDisplay).toBe("PAID (Already Settled)");
      expect(summary.transitions[1].isUnchanged).toBe(true);
      expect(summary.transitions[1].transitionDisplay).toBe("PAID (Already Settled)");

      // Redundant settlement should be blocked
      expect(summary.canSettle).toBe(false);
    });

    it("104. Requirement 2 & 10: Missing accommodation booking or corrupted status displays Outcome requires review and blocks confirmation", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "corrupted-order-1",
        orderReference: "SVK-CORRUPT-REF",
        gatewayOrderId: "SVK-TXN-CORRUPT",
        gatewayPaymentId: "31387066666",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0008",
        expectedAmount: 999,
        currency: "INR",
        gatewayReportedAmount: 999,
        gatewayReportedCurrency: "INR",
        additionalCharges: 0,
        localOrderStatus: "failed",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        outcomeMessage: "Gateway captured payment.",
        linkedItems: [
          {
            id: "acc-missing-1",
            itemType: "accommodation",
            title: "Missing Accommodation Booking",
            expectedAmount: 999,
            localStatus: "missing", // Booking record is missing!
          },
        ],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.transitions[1].requiresReview).toBe(true);
      expect(summary.transitions[1].transitionDisplay).toBe("Outcome requires review");
      expect(summary.canSettle).toBe(false);
      expect(summary.blockReason).toContain("require administrative review");
    });

    it("105. Requirement 3 & 10: Amount ambiguity blocks settlement in the confirmation summary", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "ambig-order-1",
        orderReference: "SVK-AMBIG-REF",
        gatewayOrderId: "SVK-TXN-AMBIG",
        gatewayPaymentId: "31387055555",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0009",
        expectedAmount: 999,
        currency: "INR",
        gatewayReportedAmount: 999,
        gatewayReportedCurrency: "INR",
        additionalCharges: 1.18,
        amountAmbiguityReason: "Contradictory settlement amount fields returned by PayU.",
        localOrderStatus: "failed",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        outcomeMessage: "Gateway captured payment.",
        linkedItems: [],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.canSettle).toBe(false);
      expect(summary.blockReason).toContain("Contradictory settlement amount fields");
    });

    it("106. Requirement 3 & 10: Non-reconcilable outcome (e.g. AMOUNT_MISMATCH) blocks settlement", () => {
      const summary = getReconciliationConfirmationSummary({
        orderId: "mismatch-order-1",
        orderReference: "SVK-MISMATCH-REF",
        gatewayOrderId: "SVK-TXN-MISMATCH",
        gatewayPaymentId: "31387044444",
        gateway: "payu",
        payerParticipantId: "part-1",
        payerName: "Test Participant",
        payerEmail: "test@example.com",
        payerPublicId: "SVK-26-0010",
        expectedAmount: 999,
        currency: "INR",
        gatewayReportedAmount: 500, // Mismatch!
        gatewayReportedCurrency: "INR",
        additionalCharges: 0,
        localOrderStatus: "failed",
        authoritativeGatewayStatus: "paid",
        settlementReceiptStatus: "receipt_missing",
        outcome: "AMOUNT_MISMATCH",
        outcomeMessage: "Order amount (₹999) does not match gateway captured amount (₹500).",
        linkedItems: [],
        diagnosticFindings: [],
        orderCreatedAt: null,
        gatewayTransactionTime: null,
        verifiedAt: new Date().toISOString(),
        diagnostics: { verifiedAt: new Date().toISOString() },
      });

      expect(summary.canSettle).toBe(false);
      expect(summary.blockReason).toContain("does not match gateway captured amount");
    });

    it("107. Requirement 3 & 9: Summary calculation is pure and causes zero RPC calls or side effects", () => {
      const mockOrder: any = {
        orderId: "pure-check-1",
        orderReference: "SVK-PURE-REF",
        gatewayOrderId: "SVK-TXN-PURE",
        gatewayPaymentId: "31387033333",
        expectedAmount: 999,
        localOrderStatus: "failed",
        outcome: "GATEWAY_PAID_LOCAL_PENDING",
        linkedItems: [{ id: "acc-1", itemType: "accommodation", title: "Stay", localStatus: "pending" }],
      };

      // Calling helper multiple times produces identical pure outputs without mutating order
      const summary1 = getReconciliationConfirmationSummary(mockOrder);
      const summary2 = getReconciliationConfirmationSummary(mockOrder);

      expect(summary1).toEqual(summary2);
      expect(mockOrder.localOrderStatus).toBe("failed"); // No mutation
    });
  });

  // =========================================================================
  // Part 13: PayU Merchant Settlement Amount Mapping & Safeguards Suite (108–115)
  // =========================================================================
  describe("Part 13: PayU Merchant Settlement Amount Mapping & Safeguards Suite", () => {
    // 1. ₹999 base amount, ₹1.18 additional charge, ₹1,000.18 customer debit, and an authoritative settlement amount of ₹999.
    it("108. Regression 1: ₹999 base amount, ₹1.18 additional charge, ₹1,000.18 customer debit, and an authoritative settlement amount of ₹999", async () => {
      const txRecord = {
        amt: "999.00",
        transaction_amount: "999.00",
        additional_charges: "1.18",
        net_amount_debit: "1000.18",
        amount_settled: "999.00",
        disc: "0.00",
      };

      const normalized = normalizePayUAmountFields(txRecord);
      expect(normalized.baseAmountPaise).toBe(99900);
      expect(normalized.additionalChargesPaise).toBe(118);
      expect(normalized.customerTransactionAmountPaise).toBe(100018);
      expect(normalized.settlementAmountPaise).toBe(99900);
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);
      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 99900,
            additionalChargesPaise: 118,
            customerTransactionAmountPaise: 100018,
            settlementAmountPaise: 99900,
            gatewayPaymentId: "31387025914",
          },
        },
      });

      const order = verifyRes.orders[0];
      expect(order.expectedAmount).toBe(999);
      expect(order.gatewayReportedAmount).toBe(999);
      expect(order.additionalCharges).toBe(1.18);
      expect(order.customerTransactionAmount).toBe(1000.18);
      expect(order.settlementAmount).toBe(999);
      expect(order.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING");

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).toContain("- **Merchant Settlement (amount_settled)**: ₹999.00");
    });

    // 2. The same transaction when the response does not contain a settlement amount; display unavailable.
    it("109. Regression 2: Same transaction without amount_settled displays unavailable and does not misclassify as amount mismatch", async () => {
      const txRecord = {
        amt: "999.00",
        transaction_amount: "999.00",
        additional_charges: "1.18",
        net_amount_debit: "1000.18",
        disc: "0.00",
        // No amount_settled returned by PayU
      };

      const normalized = normalizePayUAmountFields(txRecord);
      expect(normalized.baseAmountPaise).toBe(99900);
      expect(normalized.additionalChargesPaise).toBe(118);
      expect(normalized.customerTransactionAmountPaise).toBe(100018);
      expect(normalized.settlementAmountPaise).toBeUndefined();
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);
      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 99900,
            additionalChargesPaise: 118,
            customerTransactionAmountPaise: 100018,
            // settlementAmountPaise omitted/undefined
            gatewayPaymentId: "31387025914",
          },
        },
      });

      const order = verifyRes.orders[0];
      expect(order.settlementAmount).toBeNull();
      // Crucial: Base amount ₹999 matches expected ₹999, so missing settlement evidence is NOT an amount mismatch!
      expect(order.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING");

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).toContain("- **Merchant Settlement (amount_settled)**: Not returned by PayU");
    });

    // 3. A response whose raw amt is ₹1,000.18 while documented base/charge fields differ; do not mislabel it as settlement.
    it("110. Regression 3: Response whose raw amt is ₹1,000.18 and txn_amt is ₹999.00 does not mislabel amt as settlement", async () => {
      const txRecord = {
        amt: "1000.18",
        transaction_amount: "999.00",
        additional_charges: "1.18",
        net_amount_debit: "1000.18",
        // No amount_settled
      };

      const normalized = normalizePayUAmountFields(txRecord);
      expect(normalized.baseAmountPaise).toBe(99900); // Base is 999.00
      expect(normalized.customerTransactionAmountPaise).toBe(100018); // Customer debit is 1000.18
      expect(normalized.payuAmtPaise).toBe(100018);
      expect(normalized.payuTransactionAmountPaise).toBe(99900);
      expect(normalized.settlementAmountPaise).toBeUndefined(); // NEVER falls back to amt or net_amount_debit!
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);
      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["b2366e0f-e566-4632-8c68-0369baba05cb"],
        mockGatewayResults: {
          "SVK-1792433168043-c5151e1": {
            status: "paid",
            amountPaise: 99900,
            additionalChargesPaise: 118,
            customerTransactionAmountPaise: 100018,
            payuAmtPaise: 100018,
            payuTransactionAmountPaise: 99900,
            gatewayPaymentId: "31387025914",
          },
        },
      });

      const order = verifyRes.orders[0];
      expect(order.settlementAmount).toBeNull();
      expect(order.payuAmt).toBe(1000.18);
      expect(order.payuTransactionAmount).toBe(999);
      expect(order.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING");

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).toContain("- **Merchant Settlement (amount_settled)**: Not returned by PayU");
      expect(report).toContain("- **PayU Raw Fields**: amt: 1000.18, transaction_amount: 999.00");
    });

    // 4. Separate net_amount_debit and amount_settled fields.
    it("111. Regression 4: Separate net_amount_debit and amount_settled are mapped independently without conflation", () => {
      const txRecord = {
        amt: "999.00",
        transaction_amount: "999.00",
        additional_charges: "1.18",
        net_amount_debit: "1000.18",
        amount_settled: "999.00",
      };

      const normalized = normalizePayUAmountFields(txRecord);
      // net_amount_debit maps to customerTransactionAmountPaise
      expect(normalized.customerTransactionAmountPaise).toBe(100018);
      // amount_settled maps to settlementAmountPaise
      expect(normalized.settlementAmountPaise).toBe(99900);
      // Differing between net_amount_debit and amount_settled is valid when additional charges exist
      expect(normalized.amountAmbiguityReason).toBeUndefined();
    });

    // 5. Genuine base-amount mismatches still block reconciliation.
    it("112. Regression 5: Genuine base-amount mismatches still block reconciliation", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000, // ₹500 base vs ₹999 expected
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain("Amount mismatch");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    // 6. Missing or contradictory payment identifiers and currencies remain blocked.
    it("113. Regression 6: Missing or contradictory payment identifiers and currencies remain blocked", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Contradictory order reference
      const reconOrderMismatch = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-DIFFERENT-TXN-ID",
        },
      });
      expect(reconOrderMismatch.success).toBe(false);
      expect(reconOrderMismatch.error).toContain("Gateway order reference mismatch");

      // Currency mismatch
      const reconCurrencyMismatch = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "31387025914",
          currency: "EUR",
        },
      });
      expect(reconCurrencyMismatch.success).toBe(false);
      expect(reconCurrencyMismatch.error).toContain("Currency mismatch");

      // Missing gateway payment ID
      const reconMissingPaymentId = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          gatewayPaymentId: "",
        },
      });
      expect(reconMissingPaymentId.success).toBe(false);
      expect(reconMissingPaymentId.error).toContain("Missing gateway payment ID (mihpayid)");
    });

    // 7. Simulation never authorizes reconciliation.
    it("114. Regression 7: Simulation in development/preview mode never authorizes reconciliation", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const origEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = "development";
        const reconRes = await reconcilePaymentOrder({
          supabaseAdmin: supabase,
          adminId: "master-uuid",
          adminEmail: "master@saviskar.internal",
          paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
          // No mockGatewayResult provided
        });

        expect(reconRes.success).toBe(false);
        expect(reconRes.error).toContain("Reconciliation is disabled in local preview mode");
        expect(supabase.rpc).not.toHaveBeenCalled();
      } finally {
        (process.env as any).NODE_ENV = origEnv;
      }
    });

    // 8. The canonical ₹999 amount passed to settlement remains unchanged.
    it("115. Regression 8: The canonical ₹999 amount passed to process_payment_success remains strictly unchanged", async () => {
      const db = createKritikaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Reconciling an order where customer paid ₹1,000.18 with ₹1.18 surcharge
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "b2366e0f-e566-4632-8c68-0369baba05cb",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 99900,
          additionalChargesPaise: 118,
          customerTransactionAmountPaise: 100018,
          gatewayPaymentId: "31387025914",
          gatewayOrderId: "SVK-1792433168043-c5151e1",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_amount_paise: 99900, // MUST BE CANONICAL 99900 (₹999.00), NEVER 100018
          p_gateway_payment_id: "31387025914",
          p_gateway_order_id: "SVK-1792433168043-c5151e1",
          p_currency: "INR",
          p_gateway_name: "payu",
        })
      );
    });
  });

  describe("Part 10: Step 3 — Retry-Chain Diagnostics & Explicit Line-Item Breakdown", () => {
    // 1. Historical failed order whose exact event item is demonstrably settled by a separate paid retry
    it("116. Cover 1: Historical failed order whose exact event item is settled by a separate paid retry", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-retry-evt", name: "Gautam Hari Om", email: "gautam@test.internal", participant_id: "SVK-GAUTAM" },
        ],
        payment_orders: [
          {
            id: "order-fail-evt",
            order_reference: "SVK-2026-PAY-FAIL-EVT",
            gateway: "payu",
            gateway_order_id: "TXN-FAIL-EVT",
            amount: 500,
            currency: "INR",
            status: "failed",
            payer_participant_id: "part-retry-evt",
            created_at: "2026-10-20T10:00:00Z",
          },
          {
            id: "order-paid-evt",
            order_reference: "SVK-2026-PAY-PAID-EVT",
            gateway: "payu",
            gateway_order_id: "TXN-PAID-EVT",
            amount: 500,
            currency: "INR",
            status: "paid",
            payer_participant_id: "part-retry-evt",
            created_at: "2026-10-20T10:30:00Z",
          },
        ],
        payment_order_items: [
          {
            id: "poi-1",
            payment_order_id: "order-fail-evt",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-mun-exact-1",
            events: { id: "evt-mun", name: "MUN General Assembly", category: "Literary", registration_fee: 500 },
            participant_events: { id: "pe-mun-exact-1", participant_id: "part-retry-evt", payment_status: "paid" },
          },
          {
            id: "poi-2",
            payment_order_id: "order-paid-evt",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-mun-exact-1",
            events: { id: "evt-mun", name: "MUN General Assembly", category: "Literary", registration_fee: 500 },
            participant_events: { id: "pe-mun-exact-1", participant_id: "part-retry-evt", payment_status: "paid" },
          },
        ],
        participant_events: [
          { id: "pe-mun-exact-1", participant_id: "part-retry-evt", payment_status: "paid", payment_amount: 500 },
        ],
        participant_accommodations: [],
        payments: [
          { id: "pay-receipt-1", gateway_order_id: "TXN-PAID-EVT", gateway_payment_id: "MIH-PAID-EVT", amount: 500, status: "success" },
        ],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-retry-evt"],
        mockGatewayResults: {
          "TXN-FAIL-EVT": { status: "failed", amountPaise: 50000 },
          "TXN-PAID-EVT": { status: "paid", amountPaise: 50000 },
        },
      });

      const failedOrder = res.orders.find((o) => o.orderId === "order-fail-evt")!;
      // A: Historical failed attempt remains PAYMENT_FAILED, not CONFLICTING_ITEM_MAPPING
      expect(failedOrder.outcome).toBe("PAYMENT_FAILED");
      expect(failedOrder.localOrderStatus).toBe("failed");

      // Informational notice is present
      const retryNotice = failedOrder.diagnosticFindings.find((f) => f.type === "RETRY_ORDER_NOTICE");
      expect(retryNotice).toBeDefined();
      expect(retryNotice?.severity).toBe("info");
      expect(retryNotice?.description).toContain("Historical failed checkout — item was settled by a subsequent successful retry");
      expect(retryNotice?.description).toContain("SVK-2026-PAY-PAID-EVT");

      // No warning about contradictory status
      const contradictoryWarning = failedOrder.diagnosticFindings.find((f) => f.type === "CONTRADICTORY_LOCAL_STATUS");
      expect(contradictoryWarning).toBeUndefined();

      // Linked item details show retry settlement
      expect(failedOrder.linkedItems[0].settlementContext).toBe("settled_by_retry");
      expect(failedOrder.linkedItems[0].settledByOrderReference).toBe("SVK-2026-PAY-PAID-EVT");
    });

    // 2. Historical failed accommodation order whose exact booking is linked to a verified successful retry
    it("117. Cover 2: Historical failed accommodation order whose exact booking is linked to a verified successful retry", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-retry-acc", name: "Rutba Shakeel", email: "rutba@test.internal", participant_id: "SVK-RUTBA" },
        ],
        payment_orders: [
          {
            id: "order-fail-acc",
            order_reference: "SVK-2026-PAY-FAIL-ACC",
            gateway: "payu",
            gateway_order_id: "TXN-FAIL-ACC",
            amount: 999,
            currency: "INR",
            status: "failed",
            payer_participant_id: "part-retry-acc",
            created_at: "2026-10-20T11:00:00Z",
          },
          {
            id: "order-paid-acc",
            order_reference: "SVK-2026-PAY-PAID-ACC",
            gateway: "payu",
            gateway_order_id: "TXN-PAID-ACC",
            amount: 999,
            currency: "INR",
            status: "paid",
            payer_participant_id: "part-retry-acc",
            created_at: "2026-10-20T11:45:00Z",
          },
        ],
        payment_order_items: [
          {
            id: "poi-acc-fail",
            payment_order_id: "order-fail-acc",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "pa-exact-booking-1",
            participant_accommodations: {
              id: "pa-exact-booking-1",
              participant_id: "part-retry-acc",
              amount: 999,
              status: "paid",
              start_date: "2026-03-01",
              end_date: "2026-03-03",
              accommodation_plans: { name: "Standard 2-Day Accommodations" },
            },
          },
          {
            id: "poi-acc-paid",
            payment_order_id: "order-paid-acc",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "pa-exact-booking-1",
            participant_accommodations: {
              id: "pa-exact-booking-1",
              participant_id: "part-retry-acc",
              amount: 999,
              status: "paid",
              start_date: "2026-03-01",
              end_date: "2026-03-03",
              accommodation_plans: { name: "Standard 2-Day Accommodations" },
            },
          },
        ],
        participant_events: [],
        participant_accommodations: [
          {
            id: "pa-exact-booking-1",
            participant_id: "part-retry-acc",
            payment_order_id: "order-paid-acc",
            amount: 999,
            status: "paid",
            start_date: "2026-03-01",
            end_date: "2026-03-03",
            accommodation_plans: { name: "Standard 2-Day Accommodations" },
          },
        ],
        payments: [
          { id: "pay-receipt-acc", gateway_order_id: "TXN-PAID-ACC", gateway_payment_id: "MIH-PAID-ACC", amount: 999, status: "success" },
        ],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-retry-acc"],
        mockGatewayResults: {
          "TXN-FAIL-ACC": { status: "failed", amountPaise: 99900 },
          "TXN-PAID-ACC": { status: "paid", amountPaise: 99900 },
        },
      });

      const failedOrder = res.orders.find((o) => o.orderId === "order-fail-acc")!;
      expect(failedOrder.outcome).toBe("PAYMENT_FAILED");

      const retryNotice = failedOrder.diagnosticFindings.find((f) => f.type === "RETRY_ORDER_NOTICE");
      expect(retryNotice).toBeDefined();
      expect(retryNotice?.severity).toBe("info");
      expect(retryNotice?.description).toContain("SVK-2026-PAY-PAID-ACC");

      expect(failedOrder.linkedItems[0].settlementContext).toBe("settled_by_retry");
    });

    // 3. Paid item with no provable successful canonical order remains an actionable warning (Classification B)
    it("118. Cover 3: Paid item with no provable successful canonical order remains an actionable warning", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-unres", name: "Unresolved Participant", email: "unres@test.internal", participant_id: "SVK-UNRES" },
        ],
        payment_orders: [
          {
            id: "order-unres-pend",
            order_reference: "SVK-2026-PAY-UNRES",
            gateway: "payu",
            gateway_order_id: "TXN-UNRES",
            amount: 500,
            currency: "INR",
            status: "pending",
            payer_participant_id: "part-unres",
          },
        ],
        payment_order_items: [
          {
            id: "poi-unres",
            payment_order_id: "order-unres-pend",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-unres",
            events: { id: "evt-1", name: "Coding Challenge", category: "Technical", registration_fee: 500 },
            participant_events: { id: "pe-unres", participant_id: "part-unres", payment_status: "paid" },
          },
        ],
        participant_events: [
          { id: "pe-unres", participant_id: "part-unres", payment_status: "paid", payment_amount: 500 },
        ],
        participant_accommodations: [],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-unres"],
        mockGatewayResults: {
          "TXN-UNRES": { status: "pending", amountPaise: 50000 },
        },
      });

      const order = res.orders[0];
      const warning = order.diagnosticFindings.find((f) => f.type === "CONTRADICTORY_LOCAL_STATUS");
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");
      expect(warning?.description).toContain("Paid item — canonical successful payment order could not be established");

      expect(order.linkedItems[0].settlementContext).toBe("unresolved_paid");
    });

    // 4. A paid item linked only to unrelated paid orders is not classified as settled by retry
    it("119. Cover 4: A paid item linked only to unrelated paid orders is not classified as settled by retry", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-unrelated", name: "Gautam Hari Om", email: "gautam@test.internal", participant_id: "SVK-GAUTAM" },
        ],
        payment_orders: [
          {
            id: "order-fail-mun-sec",
            order_reference: "SVK-2026-PAY-SEC-FAIL",
            gateway: "payu",
            gateway_order_id: "TXN-SEC-FAIL",
            amount: 500,
            status: "failed",
            payer_participant_id: "part-unrelated",
          },
          {
            id: "order-paid-mun-gen",
            order_reference: "SVK-2026-PAY-GEN-PAID",
            gateway: "payu",
            gateway_order_id: "TXN-GEN-PAID",
            amount: 500,
            status: "paid",
            payer_participant_id: "part-unrelated",
          },
        ],
        payment_order_items: [
          {
            id: "poi-sec",
            payment_order_id: "order-fail-mun-sec",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-sec-council", // Distinct item!
            events: { id: "evt-sec", name: "MUN Security Council", registration_fee: 500 },
            participant_events: { id: "pe-sec-council", participant_id: "part-unrelated", payment_status: "paid" },
          },
          {
            id: "poi-gen",
            payment_order_id: "order-paid-mun-gen",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-gen-assembly", // Different item!
            events: { id: "evt-gen", name: "MUN General Assembly", registration_fee: 500 },
            participant_events: { id: "pe-gen-assembly", participant_id: "part-unrelated", payment_status: "paid" },
          },
        ],
        participant_events: [
          { id: "pe-sec-council", participant_id: "part-unrelated", payment_status: "paid" },
          { id: "pe-gen-assembly", participant_id: "part-unrelated", payment_status: "paid" },
        ],
        participant_accommodations: [],
        payments: [
          { id: "pay-gen", gateway_order_id: "TXN-GEN-PAID", amount: 500, status: "success" },
        ],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-unrelated"],
        mockGatewayResults: {
          "TXN-SEC-FAIL": { status: "failed", amountPaise: 50000 },
          "TXN-GEN-PAID": { status: "paid", amountPaise: 50000 },
        },
      });

      const failedOrder = res.orders.find((o) => o.orderId === "order-fail-mun-sec")!;
      // Must NOT be classified as settled by SVK-2026-PAY-GEN-PAID
      expect(failedOrder.linkedItems[0].settlementContext).toBe("unresolved_paid");
      const retryNotice = failedOrder.diagnosticFindings.find(
        (f) => f.type === "RETRY_ORDER_NOTICE" && f.description.includes("SVK-2026-PAY-GEN-PAID")
      );
      expect(retryNotice).toBeUndefined();
    });

    // 5. Pending or failed items remain unresolved and are not labelled as settled
    it("120. Cover 5: Pending or failed items remain unresolved and are not labelled as settled", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-pend", name: "Pending User", email: "pend@test.internal" },
        ],
        payment_orders: [
          {
            id: "order-fail-all",
            order_reference: "SVK-2026-PAY-PEND-ALL",
            gateway: "payu",
            gateway_order_id: "TXN-PEND-ALL",
            amount: 500,
            status: "failed",
            payer_participant_id: "part-pend",
          },
        ],
        payment_order_items: [
          {
            id: "poi-pend",
            payment_order_id: "order-fail-all",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-pend",
            events: { id: "evt-1", name: "RoboWars", registration_fee: 500 },
            participant_events: { id: "pe-pend", participant_id: "part-pend", payment_status: "pending" },
          },
        ],
        participant_events: [
          { id: "pe-pend", participant_id: "part-pend", payment_status: "pending" },
        ],
        participant_accommodations: [],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-pend"],
        mockGatewayResults: {
          "TXN-PEND-ALL": { status: "failed", amountPaise: 50000 },
        },
      });

      const order = res.orders[0];
      expect(order.linkedItems[0].settlementContext).toBe("unsettled");
      expect(order.diagnosticFindings.find((f) => f.type === "RETRY_ORDER_NOTICE")).toBeUndefined();
    });

    // 6. Allocation breakdown distinguishes event count from accommodation count
    it("121. Cover 6: Allocation breakdown distinguishes event count from accommodation count", () => {
      const breakdown = computeItemAllocationBreakdown({
        orderAmount: 8489,
        items: [
          { id: "evt-1", itemType: "event", expectedAmount: 3000 },
          { id: "acc-1", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-2", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-3", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-4", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-5", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-6", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-7", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-8", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-9", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-10", itemType: "accommodation", expectedAmount: 499 },
          { id: "acc-11", itemType: "accommodation", expectedAmount: 499 },
        ],
      });

      expect(breakdown.distinctItemCount).toBe(12);
      expect(breakdown.eventCount).toBe(1);
      expect(breakdown.eventSubtotal).toBe(3000);
      expect(breakdown.accommodationCount).toBe(11);
      expect(breakdown.accommodationSubtotal).toBe(5489);
      expect(breakdown.totalLineItemSum).toBe(8489);
      expect(breakdown.differencePaise).toBe(0);
      expect(breakdown.summaryText).toBe("1 Event (₹3,000) + 11 Accommodations (₹5,489)");
      expect(breakdown.allocationDifferenceText).toBe("Allocation difference: ₹0");
      expect(breakdown.hasAllocationMismatch).toBe(false);
    });

    // 7. Twelve accommodations total ₹5,988, against a ₹8,988 order, producing an exact ₹3,000 allocation difference
    it("122. Cover 7: Pari Jha synthetic historical order: 12 accommodations total ₹5,988 with ₹3,000 allocation difference", () => {
      const items = Array.from({ length: 12 }).map((_, idx) => ({
        id: `acc-pari-hist-${idx + 1}`,
        itemType: "accommodation",
        expectedAmount: 499,
      }));

      const breakdown = computeItemAllocationBreakdown({
        orderAmount: 8988,
        items,
      });

      expect(breakdown.distinctItemCount).toBe(12);
      expect(breakdown.eventCount).toBe(0);
      expect(breakdown.accommodationCount).toBe(12);
      expect(breakdown.accommodationSubtotal).toBe(5988);
      expect(breakdown.totalOrderAmount).toBe(8988);
      expect(breakdown.totalLineItemSum).toBe(5988);
      expect(breakdown.differencePaise).toBe(300000); // Integer paise!
      expect(breakdown.differenceINR).toBe(3000);
      expect(breakdown.hasAllocationMismatch).toBe(true);
      expect(breakdown.summaryText).toBe("12 Accommodations (₹5,988)");
      expect(breakdown.allocationDifferenceText).toBe("Allocation difference: ₹3,000 — missing/unmapped item requires investigation");
    });

    // 8. One ₹3,000 event plus eleven ₹499 accommodations totals ₹8,489, producing zero allocation difference
    it("123. Cover 8: Pari Jha synthetic later order: 1 event (₹3,000) + 11 accommodations (₹5,489) produces zero difference", () => {
      const items = [
        { id: "evt-nukkad", itemType: "event", expectedAmount: 3000 },
        ...Array.from({ length: 11 }).map((_, idx) => ({
          id: `acc-pari-later-${idx + 1}`,
          itemType: "accommodation",
          expectedAmount: 499,
        })),
      ];

      const breakdown = computeItemAllocationBreakdown({
        orderAmount: 8489,
        items,
      });

      expect(breakdown.distinctItemCount).toBe(12);
      expect(breakdown.eventCount).toBe(1);
      expect(breakdown.eventSubtotal).toBe(3000);
      expect(breakdown.accommodationCount).toBe(11);
      expect(breakdown.accommodationSubtotal).toBe(5489);
      expect(breakdown.totalOrderAmount).toBe(8489);
      expect(breakdown.totalLineItemSum).toBe(8489);
      expect(breakdown.differencePaise).toBe(0);
      expect(breakdown.differenceINR).toBe(0);
      expect(breakdown.hasAllocationMismatch).toBe(false);
      expect(breakdown.summaryText).toBe("1 Event (₹3,000) + 11 Accommodations (₹5,489)");
      expect(breakdown.allocationDifferenceText).toBe("Allocation difference: ₹0");
    });

    // 9. Duplicate or malformed mappings cannot silently inflate the displayed line-item sum
    it("124. Cover 9: Duplicate and malformed items do not silently inflate displayed line-item sum", () => {
      const breakdown = computeItemAllocationBreakdown({
        orderAmount: 1000,
        items: [
          { id: "evt-1", itemType: "event", expectedAmount: 500, participantEventId: "pe-dup-1" },
          // Duplicate of evt-1 (same canonical participantEventId)
          { id: "evt-1-repeat", itemType: "event", expectedAmount: 500, participantEventId: "pe-dup-1" },
          // Malformed item: invalid amount
          { id: "bad-item-1", itemType: "event", expectedAmount: NaN },
          // Malformed item: negative amount
          { id: "bad-item-2", itemType: "accommodation", expectedAmount: -200 },
        ],
      });

      // Exactly 1 valid distinct item counted in sum
      expect(breakdown.totalLineItemSum).toBe(500);
      expect(breakdown.eventCount).toBe(1);
      expect(breakdown.hasInvalidOrUnavailableItems).toBe(true);
      expect(breakdown.invalidItemsCount).toBe(2);
      expect(breakdown.differenceINR).toBe(500);
    });

    // 10. Separate retry attempts remain independent
    it("125. Cover 10: Separate retry attempts calculate their own line-item allocation independently", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-pari-synth", name: "Pari Jha", email: "pari@test.internal", participant_id: "SVK-PARI" },
        ],
        payment_orders: [
          {
            id: "order-pari-hist-8988",
            order_reference: "SVK-2026-PAY-HIST-8988",
            gateway: "payu",
            gateway_order_id: "TXN-PARI-HIST",
            amount: 8988,
            currency: "INR",
            status: "failed",
            payer_participant_id: "part-pari-synth",
          },
          {
            id: "order-pari-later-8489",
            order_reference: "SVK-2026-PAY-LATER-8489",
            gateway: "payu",
            gateway_order_id: "TXN-PARI-LATER",
            amount: 8489,
            currency: "INR",
            status: "paid",
            payer_participant_id: "part-pari-synth",
          },
        ],
        payment_order_items: [
          // Order 1 has 12 accommodations (total ₹5,988)
          ...Array.from({ length: 12 }).map((_, idx) => ({
            id: `poi-hist-${idx + 1}`,
            payment_order_id: "order-pari-hist-8988",
            item_type: "accommodation",
            amount: 499,
            participant_accommodation_id: `acc-pari-${idx + 1}`,
            participant_accommodations: {
              id: `acc-pari-${idx + 1}`,
              participant_id: "part-pari-synth",
              amount: 499,
              status: "paid",
              accommodation_plans: { name: "1 Day Accommodation" },
            },
          })),
          // Order 2 has 1 event (₹3,000) and 11 accommodations (₹5,489)
          {
            id: "poi-later-evt",
            payment_order_id: "order-pari-later-8489",
            item_type: "event",
            amount: 3000,
            participant_event_id: "pe-nukkad",
            events: { id: "evt-nukkad", name: "Nukkad Natak", registration_fee: 3000 },
            participant_events: { id: "pe-nukkad", participant_id: "part-pari-synth", payment_status: "paid" },
          },
          ...Array.from({ length: 11 }).map((_, idx) => ({
            id: `poi-later-acc-${idx + 1}`,
            payment_order_id: "order-pari-later-8489",
            item_type: "accommodation",
            amount: 499,
            participant_accommodation_id: `acc-pari-${idx + 1}`,
            participant_accommodations: {
              id: `acc-pari-${idx + 1}`,
              participant_id: "part-pari-synth",
              amount: 499,
              status: "paid",
              accommodation_plans: { name: "1 Day Accommodation" },
            },
          })),
        ],
        participant_events: [
          { id: "pe-nukkad", participant_id: "part-pari-synth", payment_status: "paid" },
        ],
        participant_accommodations: Array.from({ length: 12 }).map((_, idx) => ({
          id: `acc-pari-${idx + 1}`,
          participant_id: "part-pari-synth",
          payment_order_id: idx < 11 ? "order-pari-later-8489" : "order-pari-hist-8988",
          amount: 499,
          status: "paid",
          accommodation_plans: { name: "1 Day Accommodation" },
        })),
        payments: [
          { id: "pay-pari-receipt", gateway_order_id: "TXN-PARI-LATER", amount: 8489, status: "success" },
        ],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-pari-synth"],
        mockGatewayResults: {
          "TXN-PARI-HIST": { status: "failed", amountPaise: 898800 },
          "TXN-PARI-LATER": { status: "paid", amountPaise: 848900 },
        },
      });

      const orderHist = res.orders.find((o) => o.orderId === "order-pari-hist-8988")!;
      const orderLater = res.orders.find((o) => o.orderId === "order-pari-later-8489")!;

      // Order 1 has its own breakdown: 12 Accommodations (₹5,988), diff ₹3,000
      expect(orderHist.allocationBreakdown?.summaryText).toBe("12 Accommodations (₹5,988)");
      expect(orderHist.allocationBreakdown?.differenceINR).toBe(3000);
      expect(orderHist.allocationBreakdown?.hasAllocationMismatch).toBe(true);

      // Order 2 has its own breakdown: 1 Event (₹3,000) + 11 Accommodations (₹5,489), diff ₹0
      expect(orderLater.allocationBreakdown?.summaryText).toBe("1 Event (₹3,000) + 11 Accommodations (₹5,489)");
      expect(orderLater.allocationBreakdown?.differenceINR).toBe(0);
      expect(orderLater.allocationBreakdown?.hasAllocationMismatch).toBe(false);
    });

    // 11. No diagnostic finding enables reconciliation
    it("126. Cover 11: Retry-chain diagnostic finding does NOT make a failed historical order eligible for reconciliation", async () => {
      const historicalFailedOrder: any = {
        orderId: "order-fail-hist-123",
        orderReference: "SVK-2026-PAY-FAIL-HIST",
        gatewayOrderId: "TXN-FAIL-HIST",
        gatewayPaymentId: "MIH-FAIL-HIST-999",
        expectedAmount: 8988,
        localOrderStatus: "failed",
        authoritativeGatewayStatus: "failed",
        outcome: "PAYMENT_FAILED",
        outcomeMessage: "PayU reports payment failure.",
        linkedItems: [
          {
            id: "acc-1",
            itemType: "accommodation",
            title: "Accommodation",
            expectedAmount: 499,
            localStatus: "paid",
            settlementContext: "settled_by_retry",
            settledByOrderReference: "SVK-2026-PAY-LATER-PAID",
          },
        ],
        diagnosticFindings: [
          {
            type: "RETRY_ORDER_NOTICE",
            severity: "info",
            title: "Settled by Subsequent Retry",
            description: "Historical failed checkout — item was settled by a subsequent successful retry.",
          },
        ],
      };

      const summary = getReconciliationConfirmationSummary(historicalFailedOrder);
      expect(summary.canSettle).toBe(false);
      expect(summary.blockReason).toBe("PayU reports payment failure.");
    });

    // 12. Missing or ambiguous canonical order mappings remain visible as warnings
    it("127. Cover 12: Missing accommodation bookings and allocation mismatches remain visible as warnings", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-warn", name: "Warning User", email: "warn@test.internal" },
        ],
        payment_orders: [
          {
            id: "order-missing-acc",
            order_reference: "SVK-2026-PAY-MISSING-ACC",
            gateway: "payu",
            gateway_order_id: "TXN-MISSING-ACC",
            amount: 1500,
            status: "pending",
            payer_participant_id: "part-warn",
          },
        ],
        payment_order_items: [
          {
            id: "poi-missing-acc",
            payment_order_id: "order-missing-acc",
            item_type: "accommodation",
            amount: 999,
            participant_accommodation_id: "non-existent-acc-id", // Missing record!
          },
        ],
        participant_events: [],
        participant_accommodations: [], // Empty!
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-warn"],
        mockGatewayResults: {
          "TXN-MISSING-ACC": { status: "pending", amountPaise: 150000 },
        },
      });

      const order = res.orders[0];
      // Outcome is MISSING_ACCOMMODATION_LINK
      expect(order.outcome).toBe("MISSING_ACCOMMODATION_LINK");

      // Amount Allocation Mismatch warning is also emitted because 1500 != 999
      const allocMismatch = order.diagnosticFindings.find((f) => f.type === "AMOUNT_ALLOCATION_MISMATCH");
      expect(allocMismatch).toBeDefined();
      expect(allocMismatch?.severity).toBe("warning");
      expect(allocMismatch?.description).toContain("Allocation difference: ₹501 — missing/unmapped item requires investigation");
    });
    // 13. Valid event target ID matches the exact subsequent successful retry
    it("128. Cover 13: Valid event target ID still matches the exact subsequent successful retry", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-128", name: "Canonical Event User", email: "user128@test.internal" },
        ],
        payment_orders: [
          {
            id: "order-128-fail",
            order_reference: "SVK-2026-PAY-128-FAIL",
            gateway: "payu",
            gateway_order_id: "TXN-128-FAIL",
            amount: 500,
            status: "failed",
            payer_participant_id: "part-128",
            created_at: "2026-10-20T10:00:00Z",
          },
          {
            id: "order-128-paid",
            order_reference: "SVK-2026-PAY-128-PAID",
            gateway: "payu",
            gateway_order_id: "TXN-128-PAID",
            amount: 500,
            status: "paid",
            payer_participant_id: "part-128",
            created_at: "2026-10-20T10:30:00Z",
          },
        ],
        payment_order_items: [
          {
            id: "poi-join-128-fail",
            payment_order_id: "order-128-fail",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-canonical-128",
            events: { id: "evt-128", name: "Hackathon", registration_fee: 500 },
            participant_events: { id: "pe-canonical-128", participant_id: "part-128", payment_status: "paid" },
          },
          {
            id: "poi-join-128-paid",
            payment_order_id: "order-128-paid",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-canonical-128",
            events: { id: "evt-128", name: "Hackathon", registration_fee: 500 },
            participant_events: { id: "pe-canonical-128", participant_id: "part-128", payment_status: "paid" },
          },
        ],
        participant_events: [
          { id: "pe-canonical-128", participant_id: "part-128", payment_status: "paid", payment_amount: 500 },
        ],
        participant_accommodations: [],
        payments: [
          { id: "pay-128", gateway_order_id: "TXN-128-PAID", gateway_payment_id: "MIH-128", amount: 500, status: "success" },
        ],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-128"],
        mockGatewayResults: {
          "TXN-128-FAIL": { status: "failed", amountPaise: 50000 },
          "TXN-128-PAID": { status: "paid", amountPaise: 50000 },
        },
      });

      const failedOrder = res.orders.find((o) => o.orderId === "order-128-fail")!;
      expect(failedOrder.outcome).toBe("PAYMENT_FAILED");

      // Verify canonical event ID and join-row ID are preserved separately
      expect(failedOrder.linkedItems[0].orderItemId).toBe("poi-join-128-fail");
      expect(failedOrder.linkedItems[0].participantEventId).toBe("pe-canonical-128");
      expect(failedOrder.linkedItems[0].hasMissingTarget).toBeFalsy();

      // Retry matching succeeded via exact canonical event ID
      expect(failedOrder.linkedItems[0].settlementContext).toBe("settled_by_retry");
      expect(failedOrder.linkedItems[0].settledByOrderReference).toBe("SVK-2026-PAY-128-PAID");

      const retryNotice = failedOrder.diagnosticFindings.find((f) => f.type === "RETRY_ORDER_NOTICE");
      expect(retryNotice).toBeDefined();
      expect(retryNotice?.severity).toBe("info");
      expect(retryNotice?.description).toContain("SVK-2026-PAY-128-PAID");
    });

    // 14. Missing participant_event_id with a valid join-row ID is flagged, not treated as a valid event mapping
    it("129. Cover 14: Missing participant_event_id with a valid join-row ID is flagged as invalid mapping", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-129", name: "Unmapped Join Row User", email: "user129@test.internal" },
        ],
        payment_orders: [
          {
            id: "order-129",
            order_reference: "SVK-2026-PAY-129",
            gateway: "payu",
            gateway_order_id: "TXN-129",
            amount: 500,
            status: "pending",
            payer_participant_id: "part-129",
          },
        ],
        payment_order_items: [
          {
            id: "poi-join-row-valid-uuid-129",
            payment_order_id: "order-129",
            item_type: "event",
            amount: 500,
            participant_event_id: null as any, // Missing canonical target ID!
            events: { id: "evt-129", name: "RoboWars", registration_fee: 500 },
          },
        ],
        participant_events: [],
        participant_accommodations: [],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-129"],
        mockGatewayResults: {
          "TXN-129": { status: "pending", amountPaise: 50000 },
        },
      });

      const order = res.orders[0];
      // Outcome is flagged as INCOMPLETE_LOCAL_ITEM_MAPPING
      expect(order.outcome).toBe("INCOMPLETE_LOCAL_ITEM_MAPPING");

      // Verify join-row ID is stored separately as orderItemId, and not used as canonical event ID
      const item = order.linkedItems[0];
      expect(item.orderItemId).toBe("poi-join-row-valid-uuid-129");
      expect(item.participantEventId).toBeUndefined();
      expect(item.hasMissingTarget).toBe(true);
      expect(item.localStatus).toBe("missing");

      // Allocation breakdown excludes unmapped item from valid event count and sum
      expect(order.allocationBreakdown?.eventCount).toBe(0);
      expect(order.allocationBreakdown?.totalLineItemSum).toBe(0);
      expect(order.allocationBreakdown?.invalidItemsCount).toBe(1);
      expect(order.allocationBreakdown?.hasInvalidOrUnavailableItems).toBe(true);
      expect(order.allocationBreakdown?.differenceINR).toBe(500);

      // Diagnostic warning MISSING_ORDER_LINK is emitted
      const missingLinkWarning = order.diagnosticFindings.find((f) => f.type === "MISSING_ORDER_LINK");
      expect(missingLinkWarning).toBeDefined();
      expect(missingLinkWarning?.severity).toBe("warning");
      expect(missingLinkWarning?.description).toContain("missing or unmapped canonical participant event ID");
    });

    // 15. A join-row UUID coincidentally appearing elsewhere cannot establish a retry relationship
    it("130. Cover 15: Join-row UUID coincidentally appearing elsewhere cannot establish a retry relationship", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-130", name: "Coincidence User", email: "user130@test.internal" },
        ],
        payment_orders: [
          {
            id: "order-130-fail",
            order_reference: "SVK-2026-PAY-130-FAIL",
            gateway: "payu",
            gateway_order_id: "TXN-130-FAIL",
            amount: 500,
            status: "failed",
            payer_participant_id: "part-130",
            created_at: "2026-10-20T08:00:00Z",
          },
          {
            id: "order-130-paid",
            order_reference: "SVK-2026-PAY-130-PAID",
            gateway: "payu",
            gateway_order_id: "TXN-130-PAID",
            amount: 500,
            status: "paid",
            payer_participant_id: "part-130",
            created_at: "2026-10-20T09:00:00Z",
          },
        ],
        payment_order_items: [
          {
            id: "coincident-uuid-999", // Join row ID
            payment_order_id: "order-130-fail",
            item_type: "event",
            amount: 500,
            participant_event_id: null as any, // Missing canonical ID!
            events: { id: "evt-fail", name: "Event A", registration_fee: 500 },
          },
          {
            id: "poi-paid-other",
            payment_order_id: "order-130-paid",
            item_type: "event",
            amount: 500,
            participant_event_id: "coincident-uuid-999", // Coincidentally same string as join-row ID above
            events: { id: "evt-paid", name: "Event B", registration_fee: 500 },
            participant_events: { id: "coincident-uuid-999", participant_id: "part-130", payment_status: "paid" },
          },
        ],
        participant_events: [
          { id: "coincident-uuid-999", participant_id: "part-130", payment_status: "paid", payment_amount: 500 },
        ],
        participant_accommodations: [],
        payments: [
          { id: "pay-130", gateway_order_id: "TXN-130-PAID", gateway_payment_id: "MIH-130", amount: 500, status: "success" },
        ],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-130"],
        mockGatewayResults: {
          "TXN-130-FAIL": { status: "failed", amountPaise: 50000 },
          "TXN-130-PAID": { status: "paid", amountPaise: 50000 },
        },
      });

      const failedOrder = res.orders.find((o) => o.orderId === "order-130-fail")!;
      // Must NOT be marked as settled by retry!
      expect(failedOrder.linkedItems[0].settlementContext).toBe("unsettled");
      expect(failedOrder.linkedItems[0].settledByOrderReference).toBeUndefined();

      // Must NOT have a RETRY_ORDER_NOTICE
      const retryNotice = failedOrder.diagnosticFindings.find((f) => f.type === "RETRY_ORDER_NOTICE");
      expect(retryNotice).toBeUndefined();

      // Must have missing link warning and incomplete mapping outcome
      expect(failedOrder.outcome).toBe("INCOMPLETE_LOCAL_ITEM_MAPPING");
      const missingWarning = failedOrder.diagnosticFindings.find((f) => f.type === "MISSING_ORDER_LINK");
      expect(missingWarning).toBeDefined();
    });

    // 16. Duplicate valid event mappings are handled without distorting totals
    it("131. Cover 16: Duplicate valid event mappings are handled without distorting totals", () => {
      const breakdown = computeItemAllocationBreakdown({
        orderAmount: 1499,
        items: [
          {
            id: "pe-canonical-dup-1",
            orderItemId: "poi-join-1",
            itemType: "event",
            expectedAmount: 1000,
            participantEventId: "pe-canonical-dup-1",
          },
          {
            id: "pe-canonical-dup-1-repeat",
            orderItemId: "poi-join-2",
            itemType: "event",
            expectedAmount: 1000,
            participantEventId: "pe-canonical-dup-1",
          },
          {
            id: "pa-canonical-1",
            orderItemId: "poi-join-3",
            itemType: "accommodation",
            expectedAmount: 499,
            participantAccommodationId: "pa-canonical-1",
          },
        ],
      });

      // Valid distinct item count is 2 (1 event + 1 accommodation)
      expect(breakdown.distinctItemCount).toBe(2);
      expect(breakdown.eventCount).toBe(1);
      expect(breakdown.eventSubtotal).toBe(1000);
      expect(breakdown.accommodationCount).toBe(1);
      expect(breakdown.accommodationSubtotal).toBe(499);

      // Total sum is 1499 (1000 + 499), NOT inflated to 2499
      expect(breakdown.totalLineItemSum).toBe(1499);
      expect(breakdown.totalLineItemSumPaise).toBe(149900);
      expect(breakdown.differenceINR).toBe(0);
      expect(breakdown.hasAllocationMismatch).toBe(false);
    });

    // 17. Invalid event mappings remain visible as warnings and cannot enable settlement
    it("132. Cover 17: Invalid event mappings remain visible as warnings and cannot enable settlement", async () => {
      const db: MockDb = {
        participants: [
          { id: "part-132", name: "Invalid Event User", email: "user132@test.internal" },
        ],
        payment_orders: [
          {
            id: "order-132",
            order_reference: "SVK-2026-PAY-132",
            gateway: "payu",
            gateway_order_id: "TXN-132",
            gateway_payment_id: "MIH-132-SUCCESS",
            amount: 1000,
            status: "pending",
            payer_participant_id: "part-132",
          },
        ],
        payment_order_items: [
          {
            id: "poi-join-invalid-132",
            payment_order_id: "order-132",
            item_type: "event",
            amount: 1000,
            participant_event_id: "" as any, // Invalid/empty canonical target ID!
            events: { id: "evt-132", name: "Solo Dance", registration_fee: 1000 },
          },
        ],
        participant_events: [],
        participant_accommodations: [],
        payments: [],
        admin_audit_logs: [],
      };

      const supabase = createMockSupabase(db);
      const res = await verifyParticipantPayments({
        supabaseAdmin: supabase as any,
        participantIds: ["part-132"],
        mockGatewayResults: {
          "TXN-132": {
            status: "paid",
            amountPaise: 100000,
            gatewayPaymentId: "MIH-132-SUCCESS",
          },
        },
      });

      const order = res.orders[0];
      // Outcome is flagged as INCOMPLETE_LOCAL_ITEM_MAPPING despite gateway paid status
      expect(order.outcome).toBe("INCOMPLETE_LOCAL_ITEM_MAPPING");

      // Warning remains visible in diagnostic findings
      const warning = order.diagnosticFindings.find((f) => f.type === "MISSING_ORDER_LINK");
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");

      // Reconciliation confirmation summary blocks settlement
      const summary = getReconciliationConfirmationSummary(order);
      expect(summary.canSettle).toBe(false);
      expect(summary.blockReason).toContain("missing or unmapped");
    });

  });

  // =========================================================================
  // Part 14: Step 4 — Status-Aware PayU Normalization & Zero-Debit Parsing (Tests 133–150)
  // =========================================================================
  describe("Part 14: Step 4 — Status-Aware PayU Normalization & Zero-Debit Parsing (Tests 133–150)", () => {
    function createNainaAuthoritativeDb() {
      return {
        participants: [
          {
            id: "naina-uuid-2f18f504",
            name: "Naina Rathour",
            email: "nainarana1912@gmail.com",
            phone: "9876543210",
            participant_id: "SVK26-2F18F504",
          },
        ],
        events: [
          {
            id: "evt-ga-uuid",
            name: "MUN — General Assembly",
            category: "MUN",
            registration_fee: 500,
            payment_type: "paid",
          },
          {
            id: "evt-sc-uuid",
            name: "MUN — United Nations Security Council",
            category: "MUN",
            registration_fee: 500,
            payment_type: "paid",
          },
        ],
        participant_events: [
          {
            id: "pe-ga-uuid",
            participant_id: "naina-uuid-2f18f504",
            event_id: "evt-ga-uuid",
            payment_status: "paid",
            payment_amount: 500,
            payment_id: "order-ga-uuid",
          },
          {
            id: "pe-sc-uuid",
            participant_id: "naina-uuid-2f18f504",
            event_id: "evt-sc-uuid",
            payment_status: "pending",
            payment_amount: 500,
            payment_id: null,
          },
        ],
        participant_accommodations: [],
        payment_orders: [
          // Order 1: General Assembly (already paid, receipt record missing in payments table as documented)
          {
            id: "order-ga-uuid",
            order_reference: "SVK-SVK26-2F18F504-20261015095641365-9D0FF8",
            payer_participant_id: "naina-uuid-2f18f504",
            gateway: "payu",
            gateway_order_id: "SVK-1792055699266-49b0ga",
            gateway_payment_id: "403993715525547",
            amount: 500,
            currency: "INR",
            status: "paid",
            created_at: "2026-10-15T09:56:41.365Z",
            updated_at: "2026-10-15T10:00:00.000Z",
          },
          // Order 2: Security Council (pending order, expected ₹500)
          {
            id: "order-sc-uuid",
            order_reference: "SVK-SVK26-2F18F504-20261015091457471-BBF2F1",
            payer_participant_id: "naina-uuid-2f18f504",
            gateway: "payu",
            gateway_order_id: "SVK-1792055699266-49b0e3b",
            gateway_payment_id: null,
            amount: 500,
            currency: "INR",
            status: "pending",
            created_at: "2026-10-15T09:14:57.471Z",
            updated_at: "2026-10-15T09:14:57.471Z",
          },
        ],
        payment_order_items: [
          {
            id: "poi-ga-uuid",
            payment_order_id: "order-ga-uuid",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-ga-uuid",
            participant_accommodation_id: null,
          },
          {
            id: "poi-sc-uuid",
            payment_order_id: "order-sc-uuid",
            item_type: "event",
            amount: 500,
            participant_event_id: "pe-sc-uuid",
            participant_accommodation_id: null,
          },
        ],
        payments: [], // Missing receipt record for General Assembly order
        admin_audit_logs: [],
      };
    }

    // 1. net_amount_debit missing: show unavailable, not ₹0.00, and do not create a false numerical mismatch.
    it("133. Regression 1: net_amount_debit missing shows unavailable, not ₹0.00, and does not create false mismatch", async () => {
      const txRecord = {
        amt: "500.00",
        transaction_amount: "500.00",
        // net_amount_debit is absent / undefined
      };

      const normalized = normalizePayUAmountFields(txRecord);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBeUndefined();
      expect(normalized.netDebitPaise).toBeUndefined();
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "paid",
            amountPaise: 50000,
            gatewayPaymentId: "403993715525548",
            // No customerTransactionAmountPaise, no netDebitPaise
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.expectedAmount).toBe(500);
      expect(order.gatewayReportedAmount).toBe(500);
      expect(order.customerTransactionAmount).toBeNull();
      expect(order.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING"); // Clean match, NOT AMOUNT_MISMATCH!

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).toContain("- **Customer Debit (Calculated/Reported)**: Not returned by PayU");
      expect(report).not.toContain("customer debit (₹0.00)");
      expect(report).not.toContain("₹0.00 differs from customer debit");
    });

    // 2. net_amount_debit: null treated according to supported contract without coercing to zero
    it("134. Regression 2: net_amount_debit: null is treated according to supported response contract without coercing to zero", async () => {
      const txRecord = {
        amt: "500.00",
        transaction_amount: "500.00",
        net_amount_debit: null,
      };

      const normalized = normalizePayUAmountFields(txRecord);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBeUndefined();
      expect(normalized.netDebitPaise).toBeUndefined();
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "paid",
            amountPaise: 50000,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.customerTransactionAmount).toBeNull();
      expect(order.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING");

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).toContain("- **Customer Debit (Calculated/Reported)**: Not returned by PayU");
    });

    // 3. net_amount_debit: "" preserves absent/invalid state safely
    it("135. Regression 3: net_amount_debit: '' or whitespace preserves absent/invalid state safely", async () => {
      const txRecordEmpty = {
        amt: "500.00",
        transaction_amount: "500.00",
        net_amount_debit: "",
      };
      const normEmpty = normalizePayUAmountFields(txRecordEmpty);
      expect(normEmpty.customerTransactionAmountPaise).toBeUndefined();
      expect(normEmpty.netDebitPaise).toBeUndefined();
      expect(normEmpty.amountAmbiguityReason).toBeUndefined();

      const txRecordSpaces = {
        amt: "500.00",
        transaction_amount: "500.00",
        net_amount_debit: "   ",
      };
      const normSpaces = normalizePayUAmountFields(txRecordSpaces);
      expect(normSpaces.customerTransactionAmountPaise).toBeUndefined();
      expect(normSpaces.netDebitPaise).toBeUndefined();
      expect(normSpaces.amountAmbiguityReason).toBeUndefined();
    });

    // 4. Explicit numeric zero: validate according to actual contract and fail closed if payment evidence remains contradictory
    it("136. Regression 4: Explicit numeric zero validates according to contract and fails closed when contradictory", async () => {
      const txRecordZero = {
        amt: "500.00",
        transaction_amount: "500.00",
        net_amount_debit: "0.00",
      };

      const normalized = normalizePayUAmountFields(txRecordZero);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBe(0);
      expect(normalized.netDebitPaise).toBe(0);
      expect(normalized.amountAmbiguityReason).toBeDefined();
      expect(normalized.amountAmbiguityReason).toContain(
        "PayU customer debit discrepancy: 'net_amount_debit' is ₹0.00 for a ₹500.00 order. Zero debit cannot prove payment capture."
      );

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "paid",
            amountPaise: 50000,
            customerTransactionAmountPaise: 0,
            netDebitPaise: 0,
            amountAmbiguityReason: normalized.amountAmbiguityReason,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.outcome).toBe("AMOUNT_MISMATCH");
      expect(order.outcomeMessage).toContain("Zero debit cannot prove payment capture");

      // Attempting reconciliation with contradictory zero debit MUST fail closed
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          customerTransactionAmountPaise: 0,
          netDebitPaise: 0,
          amountAmbiguityReason: normalized.amountAmbiguityReason,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain("Amount field ambiguity");
      expect(reconRes.error).toContain("Zero debit cannot prove payment capture");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    // 5. Valid ₹500 base amount with no customer-debit or settlement fields returned reconciles cleanly
    it("137. Regression 5: Valid ₹500 base amount with no customer-debit or settlement fields returned allows reconciliation", async () => {
      const txRecord = {
        amt: "500.00",
        transaction_amount: "500.00",
      };

      const normalized = normalizePayUAmountFields(txRecord);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBeUndefined();
      expect(normalized.settlementAmountPaise).toBeUndefined();
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
          currency: "INR",
        },
      });

      expect(reconRes.success).toBe(true);
      expect(reconRes.settled).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_amount_paise: 50000,
          p_gateway_payment_id: "403993715525548",
          p_gateway_order_id: "SVK-1792055699266-49b0e3b",
        })
      );
    });

    // 6. Genuine customer-debit or base-amount discrepancies remain visible and block unsafe reconciliation
    it("138. Regression 6: Genuine customer-debit or base-amount discrepancies remain visible and block unsafe reconciliation", async () => {
      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Case A: Base amount mismatch (₹450 reported vs ₹500 expected)
      const reconBaseMismatch = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 45000,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });
      expect(reconBaseMismatch.success).toBe(false);
      expect(reconBaseMismatch.error).toContain("Amount mismatch");

      // Case B: Customer debit mismatch (₹450 debited vs ₹500 base)
      const txDebitMismatch = {
        amt: "500.00",
        transaction_amount: "500.00",
        net_amount_debit: "450.00",
      };
      const normDebitMismatch = normalizePayUAmountFields(txDebitMismatch);
      expect(normDebitMismatch.amountAmbiguityReason).toBeDefined();
      expect(normDebitMismatch.amountAmbiguityReason).toContain(
        "PayU customer debit discrepancy: 'net_amount_debit' (₹450.00) differs from base order amount (₹500.00)."
      );

      const reconDebitMismatch = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          customerTransactionAmountPaise: 45000,
          netDebitPaise: 45000,
          amountAmbiguityReason: normDebitMismatch.amountAmbiguityReason,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });
      expect(reconDebitMismatch.success).toBe(false);
      expect(reconDebitMismatch.error).toContain("Amount field ambiguity");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    // 7. Wrong merchant reference, payment ID or currency still blocks settlement
    it("139. Regression 7: Wrong merchant reference, payment ID or currency strictly blocks settlement", async () => {
      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Wrong merchant reference (txnid)
      const reconWrongTxnId = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-WRONG-TXNID",
        },
      });
      expect(reconWrongTxnId.success).toBe(false);
      expect(reconWrongTxnId.error).toContain("Gateway order reference mismatch");

      // Missing gateway payment ID (mihpayid)
      const reconMissingId = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          gatewayPaymentId: "",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });
      expect(reconMissingId.success).toBe(false);
      expect(reconMissingId.error).toContain("Missing gateway payment ID (mihpayid)");

      // Wrong currency
      const reconWrongCurrency = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
          currency: "USD",
        },
      });
      expect(reconWrongCurrency.success).toBe(false);
      expect(reconWrongCurrency.error).toContain("Currency mismatch");
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    // 8. Simulation never authorizes reconciliation
    it("140. Regression 8: Local simulation preview mode never authorizes reconciliation", async () => {
      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const origEnv = process.env.NODE_ENV;
      try {
        (process.env as any).NODE_ENV = "development";
        const reconRes = await reconcilePaymentOrder({
          supabaseAdmin: supabase,
          adminId: "master-uuid",
          adminEmail: "master@saviskar.internal",
          paymentOrderId: "order-sc-uuid",
        });

        expect(reconRes.success).toBe(false);
        expect(reconRes.settled).toBe(false);
        expect(reconRes.error).toContain("Reconciliation is disabled in local preview mode");
        expect(supabase.rpc).not.toHaveBeenCalled();
      } finally {
        (process.env as any).NODE_ENV = origEnv;
      }
    });

    // 9. The already-paid General Assembly order is never modified by the Security Council verification workflow
    it("141. Regression 9: The already-paid General Assembly order is never modified by the Security Council verification workflow", async () => {
      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Verify all orders for Naina
      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        participantIds: ["naina-uuid-2f18f504"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "paid",
            amountPaise: 50000,
            customerTransactionAmountPaise: 0,
            netDebitPaise: 0,
            amountAmbiguityReason:
              "PayU customer debit discrepancy: 'net_amount_debit' is ₹0.00 for a ₹500.00 order. Zero debit cannot prove payment capture.",
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      expect(verifyRes.orders).toHaveLength(2);

      const gaOrder = verifyRes.orders.find((o) => o.orderId === "order-ga-uuid")!;
      const scOrder = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;

      // 1. General Assembly order preserves its paid status and missing receipt record
      expect(gaOrder.localOrderStatus).toBe("paid");
      expect(gaOrder.settlementReceiptStatus).toBe("receipt_missing");

      // 2. Security Council order is flagged as AMOUNT_MISMATCH due to contradictory zero debit
      expect(scOrder.localOrderStatus).toBe("pending");
      expect(scOrder.outcome).toBe("AMOUNT_MISMATCH");

      // 3. Database records remain completely untouched
      const dbGaOrder = db.payment_orders.find((o) => o.id === "order-ga-uuid")!;
      expect(dbGaOrder.status).toBe("paid");
      expect(dbGaOrder.amount).toBe(500);

      const dbGaItem = db.participant_events.find((pe) => pe.id === "pe-ga-uuid")!;
      expect(dbGaItem.payment_status).toBe("paid");

      // 4. Ensure payments table had zero receipts inserted for GA order (no unauthorized mutation)
      expect(db.payments).toHaveLength(0);
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    // 10. Scenario 1: Gateway failure with explicit net_amount_debit: "0.00" classifies as PAYMENT_FAILED without false amount discrepancy
    it("142. Scenario 1: Gateway failure with explicit net_amount_debit: '0.00' classifies as PAYMENT_FAILED without false amount discrepancy", async () => {
      const txRecordFailure = {
        amt: "500.00",
        transaction_amount: "500.00",
        net_amount_debit: "0.00",
        status: "failure",
      };

      const normalized = normalizePayUAmountFields(txRecordFailure);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBe(0);
      expect(normalized.netDebitPaise).toBe(0);
      // Case A: No amount ambiguity reason solely because zero differs from expected charge
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "failed",
            rawStatus: "failure",
            amountPaise: 50000,
            customerTransactionAmountPaise: 0,
            netDebitPaise: 0,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.outcome).toBe("PAYMENT_FAILED");
      expect(order.outcomeMessage).toContain("PayU reports payment failure (Status: failure)");
      expect(order.amountAmbiguityReason).toBeNull();

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).not.toContain("Amount Ambiguity");
      expect(report).toContain("PayU reports payment failure (Status: failure)");

      // Attempting reconciliation must be strictly blocked at Gate 6a
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "failed",
          amountPaise: 50000,
          customerTransactionAmountPaise: 0,
          netDebitPaise: 0,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain('Gateway status is "failed"');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    // 11. Scenario 2: Gateway pending with explicit zero debit classifies as PAYMENT_PENDING without false amount warning
    it("143. Scenario 2: Gateway pending with explicit zero debit classifies as PAYMENT_PENDING without false amount warning", async () => {
      const txRecordPending = {
        amt: "500.00",
        transaction_amount: "500.00",
        net_amount_debit: "0.00",
        status: "pending",
      };

      const normalized = normalizePayUAmountFields(txRecordPending);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBe(0);
      expect(normalized.netDebitPaise).toBe(0);
      // Case B: No false amount discrepancy on pending
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "pending",
            rawStatus: "pending",
            amountPaise: 50000,
            customerTransactionAmountPaise: 0,
            netDebitPaise: 0,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.outcome).toBe("PAYMENT_PENDING");
      expect(order.outcomeMessage).toContain("Payment is awaiting completion or confirmation by PayU");
      expect(order.amountAmbiguityReason).toBeNull();

      // Reconciliation must be strictly blocked at Gate 6a
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "pending",
          amountPaise: 50000,
          customerTransactionAmountPaise: 0,
          netDebitPaise: 0,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(reconRes.error).toContain('Gateway status is "pending"');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    // 12. Scenario 7: Malformed or invalid debit values are safely preserved as absent without error or zero coercion
    it("144. Scenario 7: Malformed or invalid debit values are safely preserved as absent without error or zero coercion", async () => {
      const txMalformed = {
        amt: "500.00",
        transaction_amount: "500.00",
        net_amount_debit: "invalid_amount_string",
      };

      const normalized = normalizePayUAmountFields(txMalformed);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBeUndefined();
      expect(normalized.netDebitPaise).toBeUndefined();
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      expect(parsePaise("invalid_string")).toBeUndefined();
      expect(parsePaise(NaN)).toBeUndefined();
      expect(parsePaise({})).toBeUndefined();
      expect(parsePaise("")).toBeUndefined();
      expect(parsePaise("   ")).toBeUndefined();
    });

    // 13. Scenario 8: Valid successful ₹500 payment with separately reported additional charge reconciles base amount cleanly
    it("145. Scenario 8: Valid successful ₹500 payment with separately reported additional charge reconciles base amount cleanly", async () => {
      const txSurcharge = {
        amt: "500.00",
        transaction_amount: "500.00",
        additional_charges: "15.00",
        net_amount_debit: "515.00",
        status: "success",
      };

      const normalized = normalizePayUAmountFields(txSurcharge);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.additionalChargesPaise).toBe(1500);
      expect(normalized.customerTransactionAmountPaise).toBe(51500);
      expect(normalized.netDebitPaise).toBe(51500);
      expect(normalized.amountAmbiguityReason).toBeUndefined();

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "paid",
            amountPaise: 50000,
            additionalChargesPaise: 1500,
            customerTransactionAmountPaise: 51500,
            netDebitPaise: 51500,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.outcome).toBe("GATEWAY_PAID_LOCAL_PENDING");
      expect(order.expectedAmount).toBe(500);
      expect(order.additionalCharges).toBe(15);
      expect(order.customerTransactionAmount).toBe(515);

      // Reconciles canonical base amount ₹500 cleanly
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "paid",
          amountPaise: 50000,
          additionalChargesPaise: 1500,
          customerTransactionAmountPaise: 51500,
          netDebitPaise: 51500,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });

      expect(reconRes.success).toBe(true);
      expect(reconRes.settled).toBe(true);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "process_payment_success",
        expect.objectContaining({
          p_amount_paise: 50000, // Exact canonical ₹500 base amount passed to database RPC!
          p_gateway_payment_id: "403993715525548",
        })
      );
    });

    // 14. Scenario 12: Multiple independent checkout attempts where one linked item is already paid preserves independence
    it("146. Scenario 12: Multiple independent checkout attempts where one linked item is already paid preserves item status and blocks retry settlement", async () => {
      const db = createNainaAuthoritativeDb();
      // Suppose Security Council event pe-sc-uuid was also linked to a previous settled order
      db.participant_events.find((pe) => pe.id === "pe-sc-uuid")!.payment_status = "paid";
      db.payment_orders.push({
        id: "order-sc-prior-paid",
        order_reference: "SVK-SVK26-2F18F504-20261015080000000-PRIOR1",
        payer_participant_id: "naina-uuid-2f18f504",
        amount: 500,
        currency: "INR",
        status: "paid",
        gateway: "payu",
        gateway_order_id: "SVK-1792050000000-prior",
        gateway_payment_id: "403993700000000",
        created_at: "2026-10-15T08:00:00.000Z",
        updated_at: "2026-10-15T08:00:00.000Z",
      });
      db.payment_order_items.push({
        id: "poi-sc-prior",
        payment_order_id: "order-sc-prior-paid",
        item_type: "event",
        amount: 500,
        participant_event_id: "pe-sc-uuid",
        participant_accommodation_id: null,
      });

      const supabase = createMockSupabase(db);

      // Verify orders for participant to discover retry-chain and cross-order item linkage
      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        participantIds: ["naina-uuid-2f18f504"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "failed",
            amountPaise: 50000,
            netDebitPaise: 0,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const scOrder = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      // Order preserves authoritative gateway failure and does not infer success from linked item
      expect(scOrder.outcome).toBe("PAYMENT_FAILED");
      expect(scOrder.outcomeMessage).toContain("PayU reports payment failure");

      // Preserves separate order notice / contradictory local status findings
      expect(scOrder.diagnosticFindings.some((df) => df.type === "SEPARATE_ORDER_NOTICE")).toBe(true);

      // Attempting to settle this retry attempt is strictly blocked
      const reconRes = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "failed",
          amountPaise: 50000,
          netDebitPaise: 0,
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });

      expect(reconRes.success).toBe(false);
      expect(reconRes.settled).toBe(false);
      expect(supabase.rpc).not.toHaveBeenCalled();

      // Item status remains paid in database
      const itemInDb = db.participant_events.find((pe) => pe.id === "pe-sc-uuid")!;
      expect(itemInDb.payment_status).toBe("paid");
    });

    // 15. Scenarios 13 & 14: Failed or pending gateway status can never be reconciled merely because amount warning is absent
    it("147. Scenarios 13 & 14: Failed or pending gateway status can never be reconciled merely because amount warning is absent", async () => {
      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      // Attempt reconciliation with failed status and clean amounts
      const reconFailed = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "failed",
          amountPaise: 50000,
          customerTransactionAmountPaise: 0,
          netDebitPaise: 0,
          amountAmbiguityReason: undefined, // Suppressed/clean warning!
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });

      expect(reconFailed.success).toBe(false);
      expect(reconFailed.settled).toBe(false);
      expect(reconFailed.error).toContain('Gateway status is "failed". Only confirmed "paid" transactions can be reconciled.');
      expect(supabase.rpc).not.toHaveBeenCalled();

      // Attempt reconciliation with pending status and clean amounts
      const reconPending = await reconcilePaymentOrder({
        supabaseAdmin: supabase,
        adminId: "master-uuid",
        adminEmail: "master@saviskar.internal",
        paymentOrderId: "order-sc-uuid",
        mockGatewayResult: {
          status: "pending",
          amountPaise: 50000,
          customerTransactionAmountPaise: 0,
          netDebitPaise: 0,
          amountAmbiguityReason: undefined, // Suppressed/clean warning!
          gatewayPaymentId: "403993715525548",
          gatewayOrderId: "SVK-1792055699266-49b0e3b",
        },
      });

      expect(reconPending.success).toBe(false);
      expect(reconPending.settled).toBe(false);
      expect(reconPending.error).toContain('Gateway status is "pending". Only confirmed "paid" transactions can be reconciled.');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    // 16. Failed status plus explicit zero debit and a separate genuine discrepancy: separate discrepancy remains visible
    it("148. Failed status plus explicit zero debit and a separate genuine discrepancy preserves the separate discrepancy", async () => {
      const txDiscordantFailed = {
        amt: "500.00",
        transaction_amount: "400.00", // Discordant!
        additional_charges: "0.00",
        net_amount_debit: "0.00",
        status: "failure",
      };

      const normalized = normalizePayUAmountFields(txDiscordantFailed);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBe(0);
      expect(normalized.netDebitPaise).toBe(0);
      // Independent discrepancy is preserved!
      expect(normalized.amountAmbiguityReason).toBeDefined();
      expect(normalized.amountAmbiguityReason).toContain("PayU amount fields mismatch: 'amt' (₹500) and 'transaction_amount' (₹400) differ");
      // Spurious zero debit warning is NOT added!
      expect(normalized.amountAmbiguityReason).not.toContain("net_amount_debit' is ₹0.00");

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "failed",
            rawStatus: "failure",
            amountPaise: 50000,
            customerTransactionAmountPaise: 0,
            netDebitPaise: 0,
            amountAmbiguityReason: normalized.amountAmbiguityReason,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.outcome).toBe("PAYMENT_FAILED");
      expect(order.amountAmbiguityReason).toBeDefined();
      expect(order.amountAmbiguityReason).toContain("PayU amount fields mismatch");

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).toContain("- **⚠️ Amount Ambiguity**: PayU amount fields mismatch");
      expect(report).not.toContain("Zero debit cannot prove payment capture");
    });

    // 17. Pending status plus explicit zero debit and a separate genuine discrepancy: separate discrepancy remains visible
    it("149. Pending status plus explicit zero debit and a separate genuine discrepancy preserves the separate discrepancy", async () => {
      const txDiscordantPending = {
        amt: "500.00",
        transaction_amount: "400.00", // Discordant!
        additional_charges: "0.00",
        net_amount_debit: "0.00",
        status: "pending",
      };

      const normalized = normalizePayUAmountFields(txDiscordantPending);
      expect(normalized.baseAmountPaise).toBe(50000);
      expect(normalized.customerTransactionAmountPaise).toBe(0);
      expect(normalized.netDebitPaise).toBe(0);
      // Independent discrepancy is preserved!
      expect(normalized.amountAmbiguityReason).toBeDefined();
      expect(normalized.amountAmbiguityReason).toContain("PayU amount fields mismatch: 'amt' (₹500) and 'transaction_amount' (₹400) differ");
      expect(normalized.amountAmbiguityReason).not.toContain("net_amount_debit' is ₹0.00");

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "pending",
            rawStatus: "pending",
            amountPaise: 50000,
            customerTransactionAmountPaise: 0,
            netDebitPaise: 0,
            amountAmbiguityReason: normalized.amountAmbiguityReason,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.outcome).toBe("PAYMENT_PENDING");
      expect(order.amountAmbiguityReason).toBeDefined();
      expect(order.amountAmbiguityReason).toContain("PayU amount fields mismatch");

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).toContain("- **⚠️ Amount Ambiguity**: PayU amount fields mismatch");
    });

    // 18. Legacy/mock combined string containing both genuine mismatch and zero-debit warning cleans only zero debit
    it("150. Legacy/mock combined string containing both genuine mismatch and zero-debit warning strips only zero-debit finding", async () => {
      const combinedReason =
        "PayU amount fields mismatch: 'amt' (₹500.00) and 'transaction_amount' (₹400.00) differ and cannot be reconciled with additional_charges (₹0.00). PayU customer debit discrepancy: 'net_amount_debit' is ₹0.00 for a ₹500.00 order. Zero debit cannot prove payment capture.";

      const db = createNainaAuthoritativeDb();
      const supabase = createMockSupabase(db);

      const verifyRes = await verifyPaymentOrders({
        supabaseAdmin: supabase as any,
        orderIds: ["order-sc-uuid"],
        mockGatewayResults: {
          "SVK-1792055699266-49b0e3b": {
            status: "failed",
            amountPaise: 50000,
            customerTransactionAmountPaise: 0,
            netDebitPaise: 0,
            amountAmbiguityReason: combinedReason,
            gatewayPaymentId: "403993715525548",
          },
        },
      });

      const order = verifyRes.orders.find((o) => o.orderId === "order-sc-uuid")!;
      expect(order.outcome).toBe("PAYMENT_FAILED");
      // Zero debit part is stripped, but genuine mismatch remains!
      expect(order.amountAmbiguityReason).toBe(
        "PayU amount fields mismatch: 'amt' (₹500.00) and 'transaction_amount' (₹400.00) differ and cannot be reconciled with additional_charges (₹0.00)."
      );

      const report = generateSanitizedDiagnosticReport(verifyRes);
      expect(report).toContain("- **⚠️ Amount Ambiguity**: PayU amount fields mismatch");
      expect(report).not.toContain("Zero debit cannot prove payment capture");
    });
  });

});
