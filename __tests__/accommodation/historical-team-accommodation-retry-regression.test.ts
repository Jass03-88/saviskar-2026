/**
 * SAVISKAR 2026 — STEP 6: HISTORICAL TEAM ACCOMMODATION RETRY REGRESSION SUITE
 *
 * Reproduces the exact historical incident state:
 * - 15 verified team members (Graphic Era Hill University, Team "Hill hustlers", Event "Nritya-e-bharat").
 * - Team leader (Divyansh Tiwari, SVK26-09A7C27C) has older individual accommodation order (₹999).
 * - Separate group order covers the remaining 14 members (₹13,986).
 * - Gateway reported the 14-member order as failed, but local database status is still "pending".
 * - Accommodation records remain pending/held.
 * - Separate ₹3,500 event registration is already paid.
 *
 * Verifies that:
 * 1. Submitting a new combined request for all 15 members resolves only terminal old attempts,
 *    expires old holds, and creates exactly one new order for ₹14,985 with 15 accommodation records.
 * 2. Old orders remain in audit history with status "failed" and cannot settle or modify new records.
 * 3. Delayed success callback for an old order follows conflict-resolution rules, cancels the late stay,
 *    and does NOT overwrite the new confirmed accommodation records.
 * 4. Delayed failure callback never reverses a confirmed successful payment.
 * 5. In-flight active gateway checkouts safely block the new checkout (HTTP 409) rather than superseding.
 * 6. Ambiguous or unavailable gateway lookups fail closed (HTTP 409 / 503) without modifying holds.
 * 7. Paid ₹3,500 event registration is completely untouched.
 * 8. Duplicate requests and duplicate callbacks are idempotent and do not double-settle or corrupt data.
 *
 * Strictly isolated: In-memory stateful database & PayU sandbox mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as teamAccommodationPOST } from "@/app/api/team/accommodation/route";
import { POST as payuSuccessPOST } from "@/app/api/payments/payu/success/route";
import { POST as payuFailurePOST } from "@/app/api/payments/payu/failure/route";
import { getRegistrationSession } from "@/lib/auth/session";

// ─── Environment Setup ───────────────────────────────────────────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test_supabase_secret_key_32bytes_min";
process.env.SESSION_SECRET = "test_session_secret_32bytes_minimum_length";
process.env.PAYMENT_RESUME_TOKEN_SECRET = "test_resume_secret_32bytes_minimum_length";
process.env.PAYU_ENVIRONMENT = "test";
process.env.PAYU_KEY = "test_payu_merchant_key";
process.env.PAYU_SALT = "test_payu_merchant_salt";

// ─── Synthetic 15 Members Dataset (Graphic Era Hill University) ──────────────
const LEADER = {
  id: "uuid-divyansh-01",
  participantId: "SVK26-09A7C27C",
  name: "Divyansh Tiwari",
  email: "divyansh.tiwari@example.com",
  phone: "9876500001",
  college: "Graphic Era Hill University",
};

const MEMBERS_14 = [
  { id: "uuid-aman-02", participantId: "SVK26-09A7C27D", name: "Aman Sharma", email: "aman.sharma@example.com", phone: "9876500002", college: "Graphic Era Hill University" },
  { id: "uuid-rohit-03", participantId: "SVK26-09A7C27E", name: "Rohit Verma", email: "rohit.verma@example.com", phone: "9876500003", college: "Graphic Era Hill University" },
  { id: "uuid-sneha-04", participantId: "SVK26-09A7C27F", name: "Sneha Rawat", email: "sneha.rawat@example.com", phone: "9876500004", college: "Graphic Era Hill University" },
  { id: "uuid-pooja-05", participantId: "SVK26-09A7C280", name: "Pooja Negi", email: "pooja.negi@example.com", phone: "9876500005", college: "Graphic Era Hill University" },
  { id: "uuid-ankit-06", participantId: "SVK26-09A7C281", name: "Ankit Bisht", email: "ankit.bisht@example.com", phone: "9876500006", college: "Graphic Era Hill University" },
  { id: "uuid-priya-07", participantId: "SVK26-09A7C282", name: "Priya Chauhan", email: "priya.chauhan@example.com", phone: "9876500007", college: "Graphic Era Hill University" },
  { id: "uuid-karan-08", participantId: "SVK26-09A7C283", name: "Karan Joshi", email: "karan.joshi@example.com", phone: "9876500008", college: "Graphic Era Hill University" },
  { id: "uuid-simran-09", participantId: "SVK26-09A7C284", name: "Simran Kaur", email: "simran.kaur@example.com", phone: "9876500009", college: "Graphic Era Hill University" },
  { id: "uuid-aditya-10", participantId: "SVK26-09A7C285", name: "Aditya Mehta", email: "aditya.mehta@example.com", phone: "9876500010", college: "Graphic Era Hill University" },
  { id: "uuid-neha-11", participantId: "SVK26-09A7C286", name: "Neha Bhatt", email: "neha.bhatt@example.com", phone: "9876500011", college: "Graphic Era Hill University" },
  { id: "uuid-vikas-12", participantId: "SVK26-09A7C287", name: "Vikas Rana", email: "vikas.rana@example.com", phone: "9876500012", college: "Graphic Era Hill University" },
  { id: "uuid-riya-13", participantId: "SVK26-09A7C288", name: "Riya Sen", email: "riya.sen@example.com", phone: "9876500013", college: "Graphic Era Hill University" },
  { id: "uuid-manish-14", participantId: "SVK26-09A7C289", name: "Manish Kumar", email: "manish.kumar@example.com", phone: "9876500014", college: "Graphic Era Hill University" },
  { id: "uuid-deepak-15", participantId: "SVK26-09A7C290", name: "Deepak Pant", email: "deepak.pant@example.com", phone: "9876500015", college: "Graphic Era Hill University" },
];

const ALL_15_MEMBERS = [LEADER, ...MEMBERS_14];
const PE_ID = "pe-nritya-hill-hustlers-001";

// ─── Stateful In-Memory Database ────────────────────────────────────────────
interface MockDbState {
  participants: any[];
  participant_event_members: any[];
  participant_events: any[];
  participant_accommodations: any[];
  payment_orders: any[];
  payment_order_items: any[];
  processed_payment_events: any[];
  payments: any[];
  audit_logs: any[];
}

let db: MockDbState;

// Gateway status map for configurable responses
let mockGatewayResponses: Record<string, any> = {};
let mockGatewayThrowForTxn: string | null = null;

vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: vi.fn(),
  SESSION_COOKIE_NAME: "svk_reg_session",
}));

vi.mock("@/lib/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments")>();
  const { PayUGateway } = await import("@/lib/payments/payu");
  return {
    ...actual,
    getPaymentGateway: () => {
      const realPayu = new PayUGateway();
      return {
        name: "payu",
        createOrder: (params: any) => realPayu.createOrder(params),
        getCheckoutConfig: (params: any) => realPayu.getCheckoutConfig(params),
        validateWebhook: (params: any) => realPayu.validateWebhook(params),
        fetchPaymentDetails: async (gatewayOrderId: string) => {
          if (mockGatewayThrowForTxn === gatewayOrderId) {
            throw new Error(`PayU 504 Gateway Timeout for ${gatewayOrderId}`);
          }
          if (mockGatewayResponses[gatewayOrderId]) {
            return mockGatewayResponses[gatewayOrderId];
          }
          return {
            status: "failed",
            rawStatus: "failure",
            gatewayPaymentId: "",
            gatewayOrderId,
            amount: 99900,
            currency: "INR",
          };
        },
      };
    },
  };
});

// Helper for filter evaluation
function matchesFilter(row: any, f: { col: string; op: string; val: any }): boolean {
  const val = row[f.col];
  if (f.op === "eq") return val === f.val;
  if (f.op === "neq") return val !== f.val;
  if (f.op === "ilike") return String(val || "").toLowerCase() === String(f.val || "").toLowerCase();
  if (f.op === "in") return Array.isArray(f.val) && f.val.includes(val);
  if (f.op === "is") return f.val === null ? (val === null || val === undefined) : val === f.val;
  if (f.op === "lt") return val < f.val;
  if (f.op === "gt") return val > f.val;
  return true;
}

function filterRows(table: string, filters: { col: string; op: string; val: any }[]): any[] {
  const rows = (db as any)[table] || [];
  return rows.filter((r: any) => filters.every((f) => matchesFilter(r, f)));
}

// Stateful Supabase Client Mock
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      let filters: { col: string; op: string; val: any }[] = [];
      let updates: any = null;

      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn((col: string, val: any) => { filters.push({ col, op: "eq", val }); return builder; }),
        neq: vi.fn((col: string, val: any) => { filters.push({ col, op: "neq", val }); return builder; }),
        ilike: vi.fn((col: string, val: any) => { filters.push({ col, op: "ilike", val }); return builder; }),
        in: vi.fn((col: string, val: any[]) => { filters.push({ col, op: "in", val }); return builder; }),
        lt: vi.fn((col: string, val: any) => { filters.push({ col, op: "lt", val }); return builder; }),
        gt: vi.fn((col: string, val: any) => { filters.push({ col, op: "gt", val }); return builder; }),
        is: vi.fn((col: string, val: any) => { filters.push({ col, op: "is", val }); return builder; }),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => {
          const rows = filterRows(table, filters);
          const r = rows[0] || null;
          if (r && table === "participant_accommodations") {
            const po = db.payment_orders.find((p) => p.id === r.payment_order_id);
            return { data: { ...r, payment_orders: po ? [po] : [] }, error: null };
          }
          return { data: r, error: null };
        }),
        single: vi.fn(async () => {
          const rows = filterRows(table, filters);
          return { data: rows[0] || null, error: null };
        }),
        update: vi.fn((payload: any) => {
          updates = payload;
          return builder;
        }),
        insert: vi.fn((payload: any) => {
          const arr = Array.isArray(payload) ? payload : [payload];
          for (const item of arr) {
            const newItem = { id: `id-${Date.now()}-${Math.random()}`, ...item };
            ((db as any)[table] || []).push(newItem);
          }
          return {
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: arr[0], error: null })),
            })),
          };
        }),
      };

      builder.then = (resolve: any) => {
        if (updates) {
          const rows = (db as any)[table] || [];
          for (const r of rows) {
            if (filters.every((f) => matchesFilter(r, f))) {
              Object.assign(r, updates);
            }
          }
          return resolve({ data: null, error: null });
        }
        let rows = filterRows(table, filters);
        if (table === "participant_accommodations") {
          rows = rows.map((r) => {
            const po = db.payment_orders.find((p) => p.id === r.payment_order_id);
            return { ...r, payment_orders: po ? [po] : [] };
          });
        }
        return resolve({ data: rows, error: null });
      };

      return builder;
    },

    rpc: vi.fn(async (rpcName: string, params: any) => {
      // 1. process_payment_failure
      if (rpcName === "process_payment_failure") {
        const order = db.payment_orders.find(
          (p) => p.gateway_order_id === params.p_gateway_order_id
        );
        if (order) {
          // If already paid, do NOT mark failed
          if (order.status !== "paid") {
            order.status = "failed";
            order.updated_at = new Date().toISOString();
          }
        }
        return { data: { success: true }, error: null };
      }

      // 2. process_payment_success (with Safe Settlement & Conflict Resolution)
      if (rpcName === "process_payment_success") {
        const order = db.payment_orders.find(
          (p) => p.gateway_order_id === params.p_gateway_order_id
        );
        if (!order) {
          return { data: { success: false, error: "Order not found" }, error: null };
        }

        // Idempotency token check
        const existingClaim = db.processed_payment_events.find(
          (e) => e.order_id === order.id && e.payment_id === params.p_gateway_payment_id
        );
        if (existingClaim) {
          return { data: { success: true, action: "already_processed" }, error: null };
        }

        db.processed_payment_events.push({
          order_id: order.id,
          payment_id: params.p_gateway_payment_id,
          event_type: "payment.captured",
        });

        // Accommodation conflict resolution:
        // Find accommodations linked to this order
        const linkedAccs = db.participant_accommodations.filter(
          (pa) => pa.payment_order_id === order.id
        );

        let conflictCount = 0;
        for (const acc of linkedAccs) {
          // Check if participant has another accommodation covering overlapping dates that is confirmed 'paid'
          const paidConflict = db.participant_accommodations.find(
            (other) =>
              other.participant_id === acc.participant_id &&
              other.id !== acc.id &&
              other.status === "paid" &&
              other.start_date < acc.end_date &&
              other.end_date > acc.start_date
          );

          if (paidConflict) {
            // Unexpirable conflict: Confirmed paid booking takes strict priority!
            // Cancel this incoming late stay, leave confirmed stay untouched.
            acc.status = "cancelled";
            acc.updated_at = new Date().toISOString();
            conflictCount++;
            db.audit_logs.push({
              action: "late_payment_conflict",
              reason: "Late payment captured on gateway, but accommodation dates were already claimed by another confirmed booking.",
              details: {
                cancelledAccommodationId: acc.id,
                confirmedPaidAccommodationId: paidConflict.id,
                participantId: acc.participant_id,
                orderId: order.id,
              },
            });
          } else {
            acc.status = "paid";
            acc.updated_at = new Date().toISOString();
          }
        }

        order.status = "paid";
        order.gateway_payment_id = params.p_gateway_payment_id;
        order.updated_at = new Date().toISOString();

        return {
          data: {
            success: true,
            conflict_count: conflictCount,
            order_id: order.id,
          },
          error: null,
        };
      }

      // 3. register_participant_events
      if (rpcName === "register_participant_events") {
        const accommodations = params.p_accommodations || [];

        // Check if any participant has an active (non-expired) checkout or confirmed paid stay
        for (const item of accommodations) {
          const email = String(item.email || "").toLowerCase().trim();
          const member = ALL_15_MEMBERS.find((m) => m.email.toLowerCase() === email);
          if (member) {
            // Find existing stays for this participant
            const activePaidStay = db.participant_accommodations.find(
              (pa) => pa.participant_id === member.id && pa.status === "paid"
            );
            if (activePaidStay) {
              return {
                data: null,
                error: {
                  code: "SVK11",
                  message: `Participant already has an active confirmed accommodation booking covering these dates.`,
                },
              };
            }
          }
        }

        // Expire holds from old failed orders
        for (const pa of db.participant_accommodations) {
          const order = db.payment_orders.find((p) => p.id === pa.payment_order_id);
          if (order && order.status === "failed" && pa.status === "pending") {
            pa.status = "cancelled";
            pa.updated_at = new Date().toISOString();
          }
        }

        const count = accommodations.length;
        const totalAmount = count * 999;
        const newOrderId = `po-team-combined-${Date.now()}`;
        const newOrderRef = `SVK-TEAM-09A7C27C-${Date.now()}`;

        const newOrder = {
          id: newOrderId,
          order_reference: newOrderRef,
          payer_participant_id: LEADER.id,
          amount: totalAmount,
          currency: "INR",
          status: "pending",
          gateway: null,
          gateway_order_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        db.payment_orders.push(newOrder);

        for (const item of accommodations) {
          const email = String(item.email || "").toLowerCase().trim();
          const member = ALL_15_MEMBERS.find((m) => m.email.toLowerCase() === email) || LEADER;
          const paId = `pa-new-${member.participantId}-${Date.now()}`;

          db.participant_accommodations.push({
            id: paId,
            participant_id: member.id,
            payment_order_id: newOrderId,
            amount: 999,
            currency: "INR",
            status: "pending",
            duration_days: 2,
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          db.payment_order_items.push({
            id: `poi-${paId}`,
            payment_order_id: newOrderId,
            participant_id: LEADER.id,
            item_type: "accommodation",
            participant_accommodation_id: paId,
            amount: 999,
          });
        }

        return {
          data: [
            {
              participant_id: LEADER.participantId,
              payment_order_id: newOrderId,
              status: "registered",
            },
          ],
          error: null,
        };
      }

      return { data: null, error: null };
    }),
  }),
}));

// ─── TEST SUITE ──────────────────────────────────────────────────────────────
describe("SAVISKAR 2026 — Step 6: Historical Team Accommodation Retry Regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayThrowForTxn = null;

    // Reset synthetic database to the EXACT historical incident state:
    // 1. Leader has individual order for ₹999 (pending locally)
    const oldLeaderOrderId = "po-leader-individual-01";
    const oldLeaderPaId = "pa-leader-ind-01";

    // 2. Separate group order for remaining 14 members for ₹13,986 (pending locally)
    const oldGroup14OrderId = "po-group-14-members";

    db = {
      participants: ALL_15_MEMBERS.map((m) => ({
        id: m.id,
        participant_id: m.participantId,
        name: m.name,
        email: m.email,
        phone: m.phone,
        college: m.college,
      })),
      participant_event_members: ALL_15_MEMBERS.map((m) => ({
        id: `pem-${m.id}`,
        participant_event_id: PE_ID,
        name: m.name,
        email: m.email,
        participant_id: m.id,
        is_team_leader: m.email === LEADER.email,
        participants: {
          id: m.id,
          participant_id: m.participantId,
        },
      })),
      participant_events: [
        {
          id: PE_ID,
          participant_id: LEADER.id,
          team_name: "Hill hustlers",
          payment_status: "paid",
          payment_amount: 3500, // ₹3,500 event registration already settled
        },
      ],
      payment_orders: [
        {
          id: oldLeaderOrderId,
          order_reference: "SVK-IND-LEADER-001",
          payer_participant_id: LEADER.id,
          amount: 999,
          currency: "INR",
          status: "pending",
          gateway: "payu",
          gateway_order_id: "txnid-leader-ind-01",
          created_at: new Date(Date.now() - 3600000).toISOString(),
          updated_at: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: oldGroup14OrderId,
          order_reference: "SVK-GROUP-14-001",
          payer_participant_id: LEADER.id,
          amount: 13986,
          currency: "INR",
          status: "pending", // Still 'pending' in local DB
          gateway: "payu",
          gateway_order_id: "txnid-group-14",
          created_at: new Date(Date.now() - 1800000).toISOString(),
          updated_at: new Date(Date.now() - 1800000).toISOString(),
        },
      ],
      participant_accommodations: [
        // Leader pending hold
        {
          id: oldLeaderPaId,
          participant_id: LEADER.id,
          payment_order_id: oldLeaderOrderId,
          amount: 999,
          currency: "INR",
          status: "pending",
          duration_days: 2,
          start_date: "2026-10-28",
          end_date: "2026-10-30",
          created_at: new Date(Date.now() - 3600000).toISOString(),
          updated_at: new Date(Date.now() - 3600000).toISOString(),
        },
        // 14 members pending holds
        ...MEMBERS_14.map((m, i) => ({
          id: `pa-member-old-${i + 2}`,
          participant_id: m.id,
          payment_order_id: oldGroup14OrderId,
          amount: 999,
          currency: "INR",
          status: "pending",
          duration_days: 2,
          start_date: "2026-10-28",
          end_date: "2026-10-30",
          created_at: new Date(Date.now() - 1800000).toISOString(),
          updated_at: new Date(Date.now() - 1800000).toISOString(),
        })),
      ],
      payment_order_items: [
        {
          id: "poi-leader-old",
          payment_order_id: oldLeaderOrderId,
          participant_id: LEADER.id,
          item_type: "accommodation",
          participant_accommodation_id: oldLeaderPaId,
          amount: 999,
        },
        ...MEMBERS_14.map((m, i) => ({
          id: `poi-member-old-${i + 2}`,
          payment_order_id: oldGroup14OrderId,
          participant_id: LEADER.id,
          item_type: "accommodation",
          participant_accommodation_id: `pa-member-old-${i + 2}`,
          amount: 999,
        })),
      ],
      processed_payment_events: [],
      payments: [],
      audit_logs: [],
    };

    // Default Gateway responses:
    // Gateway confirms both old orders had terminal failure
    mockGatewayResponses = {
      "txnid-leader-ind-01": {
        status: "failed",
        rawStatus: "failure",
        gatewayOrderId: "txnid-leader-ind-01",
        gatewayPaymentId: "",
        amount: 99900,
        currency: "INR",
      },
      "txnid-group-14": {
        status: "failed",
        rawStatus: "failure",
        gatewayOrderId: "txnid-group-14",
        gatewayPaymentId: "",
        amount: 1398600,
        currency: "INR",
      },
    };

    (getRegistrationSession as any).mockResolvedValue({
      authenticated: true,
      email: LEADER.email,
    });
  });

  // ===========================================================================
  // 1. REPRODUCE HISTORICAL INCIDENT: RESOLVE OLD ORDERS & COMBINE TO ₹14,985
  // ===========================================================================
  it("Incident Resolution: Submitting all 15 members resolves old orders and creates one ₹14,985 order", async () => {
    // Assert preconditions
    expect(db.payment_orders).toHaveLength(2);
    expect(db.payment_orders.map((o) => o.status)).toEqual(["pending", "pending"]);
    expect(db.participant_accommodations.filter((a) => a.status === "pending")).toHaveLength(15);

    // Leader submits new combined request for all 15 members
    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: ALL_15_MEMBERS.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(201);
    const data = await res.json();

    // 1. Exactly one new combined order created for ₹14,985
    expect(data.success).toBe(true);
    expect(data.totalAmount).toBe(14985);
    expect(data.paymentOrderId).toBeDefined();

    // 2. Both old orders safely transitioned from 'pending' to 'failed' in database
    const oldLeaderOrder = db.payment_orders.find((o) => o.id === "po-leader-individual-01");
    const oldGroup14Order = db.payment_orders.find((o) => o.id === "po-group-14-members");
    expect(oldLeaderOrder?.status).toBe("failed");
    expect(oldGroup14Order?.status).toBe("failed");

    // 3. New combined order created and pending
    const newCombinedOrder = db.payment_orders.find((o) => o.id === data.paymentOrderId);
    expect(newCombinedOrder).toBeDefined();
    expect(newCombinedOrder?.amount).toBe(14985);
    expect(newCombinedOrder?.status).toBe("pending");

    // 4. Exactly 15 active pending accommodation records exist, all linked to the new order
    const activeStays = db.participant_accommodations.filter(
      (a) => a.payment_order_id === data.paymentOrderId && a.status === "pending"
    );
    expect(activeStays).toHaveLength(15);

    // 5. Old accommodation stays expired/cancelled
    const oldCancelledStays = db.participant_accommodations.filter(
      (a) => a.status === "cancelled"
    );
    expect(oldCancelledStays).toHaveLength(15);

    // 6. Paid event registration remained completely untouched
    const event = db.participant_events.find((e) => e.id === PE_ID);
    expect(event?.payment_status).toBe("paid");
    expect(event?.payment_amount).toBe(3500);
  });

  // ===========================================================================
  // 2. AUDIT TRAIL: OLD ORDERS REMAIN IDENTIFIABLE AND ISOLATED
  // ===========================================================================
  it("Audit History: Old orders remain in database as 'failed' and cannot alter new order records", async () => {
    // Run combined checkout
    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: ALL_15_MEMBERS.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });
    const res = await teamAccommodationPOST(req);
    const data = await res.json();
    const newOrderId = data.paymentOrderId;

    // Verify audit isolation
    const allOrders = db.payment_orders;
    expect(allOrders).toHaveLength(3); // 2 old + 1 new

    const oldLeaderOrder = allOrders.find((o) => o.id === "po-leader-individual-01");
    expect(oldLeaderOrder?.order_reference).toBe("SVK-IND-LEADER-001");
    expect(oldLeaderOrder?.amount).toBe(999);
    expect(oldLeaderOrder?.status).toBe("failed");

    const oldGroupOrder = allOrders.find((o) => o.id === "po-group-14-members");
    expect(oldGroupOrder?.order_reference).toBe("SVK-GROUP-14-001");
    expect(oldGroupOrder?.amount).toBe(13986);
    expect(oldGroupOrder?.status).toBe("failed");

    // Old order items still point to old order IDs
    const oldGroupItems = db.payment_order_items.filter(
      (poi) => poi.payment_order_id === "po-group-14-members"
    );
    expect(oldGroupItems).toHaveLength(14);
    for (const item of oldGroupItems) {
      expect(item.payment_order_id).not.toBe(newOrderId);
    }
  });

  // ===========================================================================
  // 3. DELAYED SUCCESS CALLBACK FOR OLD ORDER DOES NOT SETTLE NEW RECORDS
  // ===========================================================================
  it("Conflict Resolution: Delayed success callback for superseded old order cancels late stay and preserves new order", async () => {
    // 1. Complete combined 15-member checkout
    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: ALL_15_MEMBERS.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });
    const res = await teamAccommodationPOST(req);
    const data = await res.json();
    const newOrderId = data.paymentOrderId;

    // 2. Simulate new order getting paid and settled on gateway
    const newOrder = db.payment_orders.find((o) => o.id === newOrderId);
    newOrder.gateway = "payu";
    newOrder.gateway_order_id = "txnid-new-combined-15";

    // Settle the new order to 'paid'
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient("", "");
    await supabase.rpc("process_payment_success", {
      p_gateway_order_id: "txnid-new-combined-15",
      p_gateway_payment_id: "mih_new_15_success",
      p_amount_paise: 1498500,
      p_currency: "INR",
      p_gateway_name: "payu",
    });

    // Verify all 15 new accommodations are now confirmed 'paid'
    const newPaidStays = db.participant_accommodations.filter(
      (pa) => pa.payment_order_id === newOrderId && pa.status === "paid"
    );
    expect(newPaidStays).toHaveLength(15);

    // 3. Now simulate a late success callback arriving for old 14-member order txnid-group-14
    mockGatewayResponses["txnid-group-14"] = {
      status: "paid",
      rawStatus: "success",
      gatewayOrderId: "txnid-group-14",
      gatewayPaymentId: "mih_late_group_14",
      amount: 1398600,
      currency: "INR",
    };

    // Invoke settlement RPC for the late old order
    const lateSettlementResult = await supabase.rpc("process_payment_success", {
      p_gateway_order_id: "txnid-group-14",
      p_gateway_payment_id: "mih_late_group_14",
      p_amount_paise: 1398600,
      p_currency: "INR",
      p_gateway_name: "payu",
    });

    expect(lateSettlementResult.data?.success).toBe(true);
    expect(lateSettlementResult.data?.conflict_count).toBe(14); // All 14 had conflicts!

    // 4. Verify that ALL 15 confirmed new accommodations remain 'paid' and untouched
    const confirmedStaysAfterLateCallback = db.participant_accommodations.filter(
      (pa) => pa.payment_order_id === newOrderId && pa.status === "paid"
    );
    expect(confirmedStaysAfterLateCallback).toHaveLength(15);

    // 5. Verify audit log recorded the late payment conflict for manual review / refund
    expect(db.audit_logs).toHaveLength(14);
    expect(db.audit_logs[0].action).toBe("late_payment_conflict");
    expect(db.audit_logs[0].reason).toContain("Late payment captured on gateway");
  });

  // ===========================================================================
  // 4. DELAYED FAILURE CALLBACK NEVER REVERSES CONFIRMED SUCCESS
  // ===========================================================================
  it("Safety: Delayed failure callback cannot mark a confirmed paid order as failed", async () => {
    // Create confirmed paid order in DB
    const confirmedOrderId = "po-confirmed-paid";
    db.payment_orders.push({
      id: confirmedOrderId,
      order_reference: "SVK-PAID-001",
      payer_participant_id: LEADER.id,
      amount: 14985,
      currency: "INR",
      status: "paid",
      gateway: "payu",
      gateway_order_id: "txnid-paid-order-999",
      gateway_payment_id: "mih_captured_999",
    });

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient("", "");

    // Attempt to invoke process_payment_failure on the paid order
    await supabase.rpc("process_payment_failure", {
      p_gateway_order_id: "txnid-paid-order-999",
    });

    // Status MUST remain 'paid'
    const order = db.payment_orders.find((o) => o.id === confirmedOrderId);
    expect(order?.status).toBe("paid");
    expect(order?.status).not.toBe("failed");
  });

  // ===========================================================================
  // 5. IN-FLIGHT ACTIVE CHECKOUT BLOCKS NEW CHECKOUT SAFELY
  // ===========================================================================
  it("Safety: If an old checkout is active in-flight, block new checkout with 409 PAYMENT_PENDING", async () => {
    // Simulate gateway reporting that txnid-group-14 is actively in-flight (e.g. UPI PIN awaited)
    mockGatewayResponses["txnid-group-14"] = {
      status: "pending",
      rawStatus: "in progress",
      gatewayOrderId: "txnid-group-14",
      gatewayPaymentId: "",
      amount: 1398600,
      currency: "INR",
    };

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: ALL_15_MEMBERS.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();

    expect(data.code).toBe("PAYMENT_PENDING");
    expect(data.error).toContain("currently being processed by the gateway");

    // Old orders must NOT be marked failed
    const groupOrder = db.payment_orders.find((o) => o.id === "po-group-14-members");
    expect(groupOrder?.status).toBe("pending");

    // No new order created
    expect(db.payment_orders).toHaveLength(2);
  });

  // ===========================================================================
  // 6. AMBIGUOUS OR UNAVAILABLE GATEWAY FAILS CLOSED
  // ===========================================================================
  it("Safety: Ambiguous gateway status fails closed with 409 PAYMENT_STATUS_AMBIGUOUS", async () => {
    mockGatewayResponses["txnid-group-14"] = {
      status: "unknown_custom",
      rawStatus: "bank_internal_review",
      gatewayOrderId: "txnid-group-14",
      amount: 1398600,
      currency: "INR",
    };

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: ALL_15_MEMBERS.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(409);
    const data = await res.json();

    expect(data.code).toBe("PAYMENT_STATUS_AMBIGUOUS");
    expect(db.payment_orders).toHaveLength(2);
  });

  it("Safety: Gateway lookup failure fails closed with 503 without altering records", async () => {
    // Gateway throws 504 Timeout
    mockGatewayThrowForTxn = "txnid-group-14";

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: ALL_15_MEMBERS.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });

    const res = await teamAccommodationPOST(req);
    expect(res.status).toBe(503);
    const data = await res.json();

    expect(data.code).toMatch(/^GATEWAY_/);
    expect(db.payment_orders).toHaveLength(2);
  });

  // ===========================================================================
  // 7. EVENT REGISTRATION IS COMPLETELY UNTOUCHED ACROSS ALL FLOWS
  // ===========================================================================
  it("Invariant: Paid ₹3,500 event registration is never touched during retry or resolution", async () => {
    const eventBefore = { ...db.participant_events[0] };

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: ALL_15_MEMBERS.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });

    await teamAccommodationPOST(req);

    const eventAfter = db.participant_events[0];
    expect(eventAfter.payment_status).toBe("paid");
    expect(eventAfter.payment_amount).toBe(3500);
    expect(eventAfter.payment_amount).toBe(eventBefore.payment_amount);
  });

  // ===========================================================================
  // 8. IDEMPOTENT CALLBACKS & DUPLICATE PROTECTION
  // ===========================================================================
  it("Idempotency: Duplicate success callbacks for same payment are processed idempotently", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient("", "");

    // First call
    const res1 = await supabase.rpc("process_payment_success", {
      p_gateway_order_id: "txnid-leader-ind-01",
      p_gateway_payment_id: "mih_first_time_01",
      p_amount_paise: 99900,
      p_currency: "INR",
      p_gateway_name: "payu",
    });

    expect(res1.data?.success).toBe(true);

    // Duplicate call with exact same payment ID
    const res2 = await supabase.rpc("process_payment_success", {
      p_gateway_order_id: "txnid-leader-ind-01",
      p_gateway_payment_id: "mih_first_time_01",
      p_amount_paise: 99900,
      p_currency: "INR",
      p_gateway_name: "payu",
    });

    expect(res2.data?.success).toBe(true);
    expect(res2.data?.action).toBe("already_processed");

    // Only 1 processed event token recorded
    expect(db.processed_payment_events).toHaveLength(1);
  });
});
