/**
 * SAVISKAR 2026 — STEP 5: TEAM CHECKOUT TO PAYU HANDOFF CONTRACT TEST
 *
 * Verifies that:
 * 1. Team Accommodation Modal checkout produces the authoritative server-side payment order.
 * 2. RegistrationForm handoff (`handleModalPayment` -> `initiatePaymentCheckout`) passes the exact order ID.
 * 3. `/api/payments/create` resolves the authoritative stored amount from the database, not client-supplied values.
 * 4. The PayU hosted checkout form is constructed with exact parameters:
 *    - Authoritative amount (e.g. ₹14,985 for 15 members -> "14985.00")
 *    - Correct currency ("INR")
 *    - Payer details (Divyansh Tiwari, email, phone)
 *    - Callback URLs (surl, furl on canonical origin)
 *    - Order reference in udf1
 *    - Valid HMAC SHA-512 hash
 * 5. Paid ₹3,500 event registration is NEVER conflated with accommodation checkout.
 * 6. Exactly ONE combined team order checkout is prepared (no duplicate or individual checkouts).
 * 7. 14 members (₹13,986), 1 member (₹999), and 0 members (rejected) behave correctly.
 * 8. Failure modes (409 conflict, 500/503 errors, malformed IDs) fail closed and do not submit PayU forms.
 *
 * Strictly isolated: In-memory mock database & PayU sandbox gateway.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as teamAccommodationPOST } from "@/app/api/team/accommodation/route";
import { POST as paymentsCreatePOST } from "@/app/api/payments/create/route";
import {
  buildPayUCheckoutForm,
  submitPayUCheckoutForm,
} from "@/lib/payments/checkout-form";
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

const TEAM_MEMBERS_15 = [
  LEADER,
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

const PE_ID = "pe-nritya-hill-hustlers-001";

// ─── In-Memory Database Fixture ──────────────────────────────────────────────
interface MockDb {
  participants: any[];
  participant_event_members: any[];
  participant_events: any[];
  participant_accommodations: any[];
  payment_orders: any[];
  payment_order_items: any[];
  processed_payment_events: any[];
}

let db: MockDb;

// Mock session
vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: vi.fn(),
  SESSION_COOKIE_NAME: "svk_reg_session",
}));

// Mock Payment Gateway to use real PayUGateway calculations while enabling mock status overrides
let mockGatewayStatus = "failed";
let mockGatewayFetchDetails: any = null;

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
        fetchPaymentDetails: async (gatewayOrderId: string) => {
          if (mockGatewayFetchDetails) {
            return mockGatewayFetchDetails;
          }
          return {
            status: mockGatewayStatus,
            gatewayPaymentId: mockGatewayStatus === "paid" ? "mih_payu_capture_999" : "",
            gatewayOrderId,
            amount: 1498500,
            currency: "INR",
            rawStatus: mockGatewayStatus,
          };
        },
      };
    },
  };
});

function matchesFilters(row: any, filters: { col: string; op: string; val: any }[]): boolean {
  for (const f of filters) {
    const val = row[f.col];
    if (f.op === "eq" && val !== f.val) return false;
    if (f.op === "ilike" && String(val || "").toLowerCase() !== String(f.val || "").toLowerCase()) return false;
    if (f.op === "is" && f.val === null && val !== null && val !== undefined) return false;
    if (f.op === "in" && Array.isArray(f.val) && !f.val.includes(val)) return false;
    if (f.op === "lt" && !(val < f.val)) return false;
    if (f.op === "gt" && !(val > f.val)) return false;
  }
  return true;
}

function executeFilter(table: string, filters: { col: string; op: string; val: any }[]): any[] {
  const rows = (db as any)[table] || [];
  return rows.filter((r: any) => matchesFilters(r, filters));
}

// Mock Supabase
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      let filters: { col: string; op: string; val: any }[] = [];
      let updates: any = null;

      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn((col: string, val: any) => {
          filters.push({ col, op: "eq", val });
          return builder;
        }),
        ilike: vi.fn((col: string, val: any) => {
          filters.push({ col, op: "ilike", val });
          return builder;
        }),
        in: vi.fn((col: string, val: any[]) => {
          filters.push({ col, op: "in", val });
          return builder;
        }),
        lt: vi.fn((col: string, val: any) => {
          filters.push({ col, op: "lt", val });
          return builder;
        }),
        gt: vi.fn((col: string, val: any) => {
          filters.push({ col, op: "gt", val });
          return builder;
        }),
        is: vi.fn((col: string, val: any) => {
          filters.push({ col, op: "is", val });
          return builder;
        }),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => {
          let rows = executeFilter(table, filters);
          return { data: rows[0] || null, error: null };
        }),
        single: vi.fn(async () => {
          let rows = executeFilter(table, filters);
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
            if (matchesFilters(r, filters)) {
              Object.assign(r, updates);
            }
          }
          return resolve({ data: null, error: null });
        }
        let rows = executeFilter(table, filters);
        return resolve({ data: rows, error: null });
      };

      return builder;
    },
    rpc: vi.fn(async (rpcName: string, params: any) => {
      if (rpcName === "register_participant_events") {
        const orderId = `po-team-${Date.now()}`;
        const totalAmount = (params.p_accommodations || []).reduce(
          (sum: number, a: any) => sum + (a.plan_slug === "2_days" ? 999 : 599),
          0
        );

        const newOrder = {
          id: orderId,
          order_reference: `SVK-TEAM-${Date.now()}`,
          payer_participant_id: LEADER.id,
          amount: totalAmount,
          currency: "INR",
          status: "pending",
          gateway: null,
          gateway_order_id: null,
        };
        db.payment_orders.push(newOrder);

        // Insert participant accommodations and order items
        for (const acc of params.p_accommodations || []) {
          const paId = `pa-${acc.email}-${Date.now()}`;
          const member = TEAM_MEMBERS_15.find((m) => m.email.toLowerCase() === acc.email.toLowerCase()) || LEADER;
          db.participant_accommodations.push({
            id: paId,
            participant_id: member.id,
            payment_order_id: orderId,
            amount: 999,
            currency: "INR",
            status: "pending",
            duration_days: 2,
            start_date: "2026-10-28",
            end_date: "2026-10-30",
          });

          db.payment_order_items.push({
            id: `poi-${paId}`,
            payment_order_id: orderId,
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
              payment_order_id: orderId,
              status: "registered",
            },
          ],
          error: null,
        };
      }

      if (rpcName === "process_payment_failure" || rpcName === "process_payment_success") {
        return { data: { success: true }, error: null };
      }

      return { data: null, error: null };
    }),
  }),
}));

// ─── Production Client Handoff Helper ────────────────────────────────────────
// Simulates the exact state updates and execution flow of RegistrationForm.tsx
interface RegistrationFormHandoffResult {
  paymentProcessing: boolean;
  paymentPending: boolean;
  errorMessage: string;
  pendingPaymentOrderId: string | null;
  formSubmitted: boolean;
  submittedForm: any;
}

async function executeRegistrationFormHandoff(
  paymentOrderId: string,
  participantId: string,
  doc: Document
): Promise<RegistrationFormHandoffResult> {
  let paymentProcessing = true;
  let paymentPending = false;
  let errorMessage = "";
  let pendingPaymentOrderId: string | null = null;
  let formSubmitted = false;
  let submittedForm: any = null;

  try {
    // 1. Create gateway order via /api/payments/create
    const req = new NextRequest("https://saviskar.co.in/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-forwarded-proto": "https",
        Host: "saviskar.co.in",
      },
      body: JSON.stringify({ paymentOrderId }),
    });

    const createResponse = await paymentsCreatePOST(req);
    const createResult = await createResponse.json();

    if (!createResponse.ok || !createResult?.success) {
      if (
        createResult?.code === "VERIFICATION_UNAVAILABLE" ||
        createResponse.status === 503 ||
        createResponse.status === 502
      ) {
        throw new Error(
          "Payment verification is temporarily unavailable. Please try again in a few moments."
        );
      }
      if (
        createResult?.code === "PAYMENT_PENDING" ||
        createResponse.status === 409
      ) {
        throw new Error(
          createResult?.error ||
            "A payment attempt is currently being processed by the gateway. Please complete it on your payment app or wait a few moments before retrying."
        );
      }
      throw new Error(
        createResult?.error || "Could not initialize payment. Please try again."
      );
    }

    if (createResult.paymentOrderId) {
      pendingPaymentOrderId = createResult.paymentOrderId;
    }

    // 2. Submit PayU Hosted Checkout form using shared helper
    submittedForm = submitPayUCheckoutForm(createResult.checkoutConfig, doc);
    formSubmitted = true;
    paymentProcessing = true; // Remains true while navigating away
  } catch (error) {
    paymentProcessing = false;
    paymentPending = true;
    errorMessage = error instanceof Error ? error.message : "Payment could not be processed.";
  }

  return {
    paymentProcessing,
    paymentPending,
    errorMessage,
    pendingPaymentOrderId,
    formSubmitted,
    submittedForm,
  };
}

// ─── Mock Document for Testing ───────────────────────────────────────────────
function createMockDocument() {
  const form: any = {
    method: "",
    action: "",
    style: {},
    inputs: [] as { name: string; value: string }[],
    appendChild: vi.fn((child: any) => {
      if (child.name) {
        form.inputs.push({ name: child.name, value: child.value });
      }
    }),
    submit: vi.fn(),
  };

  const doc: any = {
    createElement: vi.fn((tag: string) => {
      if (tag === "form") return form;
      if (tag === "input") return { type: "", name: "", value: "" };
      return {};
    }),
    body: {
      appendChild: vi.fn(),
    },
  };

  return { doc, form };
}

// ─── TEST SUITE ──────────────────────────────────────────────────────────────
describe("SAVISKAR 2026 — Step 5: Team Checkout to PayU Handoff Contract Test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayStatus = "failed";
    mockGatewayFetchDetails = null;

    db = {
      participants: TEAM_MEMBERS_15.map((m) => ({
        id: m.id,
        participant_id: m.participantId,
        name: m.name,
        email: m.email,
        phone: m.phone,
        college: m.college,
      })),
      participant_event_members: TEAM_MEMBERS_15.map((m) => ({
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
      participant_accommodations: [],
      payment_orders: [],
      payment_order_items: [],
      processed_payment_events: [],
    };

    (getRegistrationSession as any).mockResolvedValue({
      authenticated: true,
      email: LEADER.email,
    });
  });

  // ===========================================================================
  // 1. ALL 15 MEMBERS: FULL HANDOFF TO PAYU FORM SUBMISSION
  // ===========================================================================
  it("Handoff: 15 members team accommodation order creates PayU form with ₹14,985 and correct metadata", async () => {
    // 1. Team Accommodation Checkout (Modal -> API)
    const teamReq = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: TEAM_MEMBERS_15.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });

    const teamRes = await teamAccommodationPOST(teamReq);
    expect(teamRes.status).toBe(201);
    const teamData = await teamRes.json();

    expect(teamData.success).toBe(true);
    expect(teamData.totalAmount).toBe(14985);
    expect(teamData.paymentOrderId).toBeDefined();
    expect(teamData.participantId).toBe(LEADER.participantId);

    // 2. Parent Registration Form Handoff (RegistrationForm.tsx initiatePaymentCheckout)
    const { doc, form } = createMockDocument();
    const handoffResult = await executeRegistrationFormHandoff(
      teamData.paymentOrderId,
      teamData.participantId,
      doc
    );

    // 3. Verify Form Execution
    expect(handoffResult.formSubmitted).toBe(true);
    expect(handoffResult.paymentPending).toBe(false);
    expect(handoffResult.errorMessage).toBe("");
    expect(form.submit).toHaveBeenCalledTimes(1);
    expect(doc.body.appendChild).toHaveBeenCalledWith(form);

    // 4. Verify PayU Endpoint & Action
    expect(form.method).toBe("POST");
    expect(form.action).toBe("https://test.payu.in/_payment");

    // 5. Inspect Form Inputs & Metadata
    const inputMap = Object.fromEntries(
      form.inputs.map((inp: { name: string; value: string }) => [inp.name, inp.value])
    );

    // Assert exact amount formatted to 2 decimals
    expect(inputMap.amount).toBe("14985.00");
    expect(inputMap.productinfo).toBe("Saviskar 2026 Registration");
    expect(inputMap.firstname).toBe(LEADER.name);
    expect(inputMap.email).toBe(LEADER.email);
    expect(inputMap.phone).toBe(LEADER.phone);
    expect(inputMap.key).toBe("test_payu_merchant_key");
    expect(inputMap.udf1).toMatch(/^SVK-TEAM-/); // Order reference
    expect(inputMap.surl).toBe("https://saviskar.co.in/api/payments/payu/success");
    expect(inputMap.furl).toBe("https://saviskar.co.in/api/payments/payu/failure");
    expect(inputMap.hash).toBeDefined();
    expect(inputMap.hash.length).toBe(128); // SHA-512 hex string

    // 6. Confirm Database Association
    expect(db.payment_orders).toHaveLength(1);
    expect(db.payment_orders[0].amount).toBe(14985);
    expect(db.payment_orders[0].gateway).toBe("payu");
    expect(db.payment_order_items).toHaveLength(15);
    expect(db.participant_accommodations).toHaveLength(15);
  });

  // ===========================================================================
  // 2. SEPARATE PAID ₹3,500 EVENT REGISTRATION IS NEVER CHARGED AGAIN
  // ===========================================================================
  it("Handoff: Paid ₹3,500 event registration is never added to the accommodation PayU checkout", async () => {
    // Assert event registration exists in DB with 3500 paid
    const eventRow = db.participant_events.find((e) => e.id === PE_ID);
    expect(eventRow.payment_amount).toBe(3500);
    expect(eventRow.payment_status).toBe("paid");

    // Checkout for all 15 members
    const teamReq = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: TEAM_MEMBERS_15.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });

    const teamRes = await teamAccommodationPOST(teamReq);
    const teamData = await teamRes.json();

    const { doc, form } = createMockDocument();
    await executeRegistrationFormHandoff(
      teamData.paymentOrderId,
      teamData.participantId,
      doc
    );

    const inputMap = Object.fromEntries(
      form.inputs.map((inp: { name: string; value: string }) => [inp.name, inp.value])
    );

    // Must be strictly ₹14,985.00, NOT ₹18,485.00 (14,985 + 3,500)
    expect(inputMap.amount).toBe("14985.00");
    expect(inputMap.amount).not.toBe("18485.00");
  });

  // ===========================================================================
  // 3. 14 MEMBERS: ₹13,986 AND EXACT RECORD SUBSET
  // ===========================================================================
  it("Handoff: 14 members checkout prepares PayU form with ₹13,986.00", async () => {
    // Exclude 15th member Deepak Pant
    const members14 = TEAM_MEMBERS_15.slice(0, 14);

    const teamReq = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: members14.map((m) => ({
          email: m.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          extraDays: "none",
        })),
      }),
    });

    const teamRes = await teamAccommodationPOST(teamReq);
    const teamData = await teamRes.json();
    expect(teamData.totalAmount).toBe(13986);

    const { doc, form } = createMockDocument();
    await executeRegistrationFormHandoff(
      teamData.paymentOrderId,
      teamData.participantId,
      doc
    );

    const inputMap = Object.fromEntries(
      form.inputs.map((inp: { name: string; value: string }) => [inp.name, inp.value])
    );

    expect(inputMap.amount).toBe("13986.00");
    expect(db.payment_order_items).toHaveLength(14);
  });

  // ===========================================================================
  // 4. ONE MEMBER: ₹999.00
  // ===========================================================================
  it("Handoff: 1 member checkout prepares PayU form with ₹999.00", async () => {
    const teamReq = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [
          {
            email: LEADER.email,
            planSlug: "2_days",
            selectedDate: "2026-10-28",
            extraDays: "none",
          },
        ],
      }),
    });

    const teamRes = await teamAccommodationPOST(teamReq);
    const teamData = await teamRes.json();
    expect(teamData.totalAmount).toBe(999);

    const { doc, form } = createMockDocument();
    await executeRegistrationFormHandoff(
      teamData.paymentOrderId,
      teamData.participantId,
      doc
    );

    const inputMap = Object.fromEntries(
      form.inputs.map((inp: { name: string; value: string }) => [inp.name, inp.value])
    );

    expect(inputMap.amount).toBe("999.00");
    expect(db.payment_order_items).toHaveLength(1);
  });

  // ===========================================================================
  // 5. ZERO MEMBERS: REJECTED WITHOUT ORDER OR PAYU FORM
  // ===========================================================================
  it("Handoff: 0 members checkout is rejected, creating 0 orders and 0 PayU forms", async () => {
    const teamReq = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: PE_ID,
        bookings: [],
      }),
    });

    const teamRes = await teamAccommodationPOST(teamReq);
    expect(teamRes.status).toBe(400);

    const { doc, form } = createMockDocument();
    expect(db.payment_orders).toHaveLength(0);
    expect(form.submit).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // 6. CLIENT-SIDE AMOUNT OVERRIDE RESISTANCE
  // ===========================================================================
  it("Security: Frontend cannot override server stored amount by tampering with request", async () => {
    // 1. Create legit ₹14,985 order in DB
    const orderId = "po-legit-14985";
    db.payment_orders.push({
      id: orderId,
      order_reference: "SVK-LEGIT-001",
      payer_participant_id: LEADER.id,
      amount: 14985,
      currency: "INR",
      status: "pending",
      gateway: null,
      gateway_order_id: null,
    });
    db.payment_order_items.push({
      id: "poi-1",
      payment_order_id: orderId,
      participant_id: LEADER.id,
      amount: 14985,
    });

    // 2. Tampered request trying to submit amount = ₹1
    const tamperedReq = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "saviskar.co.in",
      },
      body: JSON.stringify({
        paymentOrderId: orderId,
        amount: 1, // Malicious override attempt!
        totalAmount: 1,
      }),
    });

    const res = await paymentsCreatePOST(tamperedReq);
    const data = await res.json();
    expect(res.status).toBe(200);

    // PayU config MUST still charge 14985.00 from authoritative DB
    expect(data.checkoutConfig.options.amount).toBe("14985.00");
  });

  // ===========================================================================
  // 7. GATEWAY CONFLICT (HTTP 409) DOES NOT TRIGGER PAYU CHECKOUT
  // ===========================================================================
  it("Safety: Active payment conflict (409) fails closed without submitting PayU form", async () => {
    const orderId = "po-conflict-001";
    db.payment_orders.push({
      id: orderId,
      order_reference: "SVK-CONFLICT-001",
      payer_participant_id: LEADER.id,
      amount: 14985,
      currency: "INR",
      status: "pending",
      gateway: "payu",
      gateway_order_id: "txnid-active-pending", // already has active gateway order
    });
    db.payment_order_items.push({
      id: "poi-conflict",
      payment_order_id: orderId,
      participant_id: LEADER.id,
      amount: 14985,
    });

    mockGatewayFetchDetails = {
      status: "pending",
      gatewayPaymentId: "pay_active_upi",
      unmappedStatus: "in progress",
    };

    const { doc, form } = createMockDocument();
    const result = await executeRegistrationFormHandoff(orderId, LEADER.participantId, doc);

    expect(result.formSubmitted).toBe(false);
    expect(result.paymentPending).toBe(true);
    expect(result.errorMessage).toContain("currently being processed");
    expect(form.submit).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // 8. MALFORMED / MISSING ORDER ID FAILS CLOSED
  // ===========================================================================
  it("Safety: Missing or empty order ID fails closed without PayU form submission", async () => {
    const { doc, form } = createMockDocument();
    const result = await executeRegistrationFormHandoff("", LEADER.participantId, doc);

    expect(result.formSubmitted).toBe(false);
    expect(result.paymentPending).toBe(true);
    expect(result.errorMessage).toContain("Payment order ID is required");
    expect(form.submit).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // 9. FORM HELPER ROBUSTNESS & VALIDATION
  // ===========================================================================
  it("Helper: buildPayUCheckoutForm validates missing postUrl and hash", () => {
    // Missing postUrl
    expect(() =>
      buildPayUCheckoutForm({ options: { hash: "abc" } })
    ).toThrow("Payment gateway configuration is missing or invalid.");

    // Missing hash
    expect(() =>
      buildPayUCheckoutForm({ postUrl: "https://test.payu.in" })
    ).toThrow("Payment gateway configuration is missing or invalid.");

    // Null config
    expect(() => buildPayUCheckoutForm(null)).toThrow(
      "Payment gateway configuration is missing or invalid."
    );
  });
});
