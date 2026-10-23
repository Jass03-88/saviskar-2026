import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as teamAccommodationPOST } from "@/app/api/team/accommodation/route";

// ─── 1. Mock Registration Session ──────────────────────────────────────────
vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: vi.fn(),
}));
import { getRegistrationSession } from "@/lib/auth/session";

// ─── 2. Mock Rate Limit ───────────────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// ─── 3. Mock Payment Gateway ──────────────────────────────────────────────
const mockGateway = {
  name: "payu",
  fetchPaymentDetails: vi.fn(),
};

vi.mock("@/lib/payments", () => ({
  getPaymentGateway: vi.fn(() => mockGateway),
}));

// ─── 4. Synthetic 15 Members Dataset (Graphic Era Hill University) ─────────
interface MockParticipant {
  id: string;
  participant_id: string;
  name: string;
  email: string;
  phone: string;
  college: string;
}

const LEADER: MockParticipant = {
  id: "uuid-divyansh-01",
  participant_id: "SVK26-09A7C27C",
  name: "Divyansh Tiwari",
  email: "divyansh.tiwari@example.com",
  phone: "9876500001",
  college: "Graphic Era Hill University",
};

const TEAM_MEMBERS_15: MockParticipant[] = [
  LEADER,
  { id: "uuid-aman-02", participant_id: "SVK26-09A7C27D", name: "Aman Sharma", email: "aman.sharma@example.com", phone: "9876500002", college: "Graphic Era Hill University" },
  { id: "uuid-rohit-03", participant_id: "SVK26-09A7C27E", name: "Rohit Verma", email: "rohit.verma@example.com", phone: "9876500003", college: "Graphic Era Hill University" },
  { id: "uuid-sneha-04", participant_id: "SVK26-09A7C27F", name: "Sneha Rawat", email: "sneha.rawat@example.com", phone: "9876500004", college: "Graphic Era Hill University" },
  { id: "uuid-pooja-05", participant_id: "SVK26-09A7C280", name: "Pooja Negi", email: "pooja.negi@example.com", phone: "9876500005", college: "Graphic Era Hill University" },
  { id: "uuid-ankit-06", participant_id: "SVK26-09A7C281", name: "Ankit Bisht", email: "ankit.bisht@example.com", phone: "9876500006", college: "Graphic Era Hill University" },
  { id: "uuid-priya-07", participant_id: "SVK26-09A7C282", name: "Priya Chauhan", email: "priya.chauhan@example.com", phone: "9876500007", college: "Graphic Era Hill University" },
  { id: "uuid-karan-08", participant_id: "SVK26-09A7C283", name: "Karan Joshi", email: "karan.joshi@example.com", phone: "9876500008", college: "Graphic Era Hill University" },
  { id: "uuid-simran-09", participant_id: "SVK26-09A7C284", name: "Simran Kaur", email: "simran.kaur@example.com", phone: "9876500009", college: "Graphic Era Hill University" },
  { id: "uuid-aditya-10", participant_id: "SVK26-09A7C285", name: "Aditya Mehta", email: "aditya.mehta@example.com", phone: "9876500010", college: "Graphic Era Hill University" },
  { id: "uuid-neha-11", participant_id: "SVK26-09A7C286", name: "Neha Bhatt", email: "neha.bhatt@example.com", phone: "9876500011", college: "Graphic Era Hill University" },
  { id: "uuid-vikas-12", participant_id: "SVK26-09A7C287", name: "Vikas Rana", email: "vikas.rana@example.com", phone: "9876500012", college: "Graphic Era Hill University" },
  { id: "uuid-riya-13", participant_id: "SVK26-09A7C288", name: "Riya Sen", email: "riya.sen@example.com", phone: "9876500013", college: "Graphic Era Hill University" },
  { id: "uuid-manish-14", participant_id: "SVK26-09A7C289", name: "Manish Kumar", email: "manish.kumar@example.com", phone: "9876500014", college: "Graphic Era Hill University" },
  { id: "uuid-deepak-15", participant_id: "SVK26-09A7C290", name: "Deepak Pant", email: "deepak.pant@example.com", phone: "9876500015", college: "Graphic Era Hill University" },
];

const PE_ID = "pe-nritya-hill-hustlers-001";

// ─── 5. In-Memory Database & Supabase Mock ─────────────────────────────────
interface MockDbState {
  participants: MockParticipant[];
  participant_event_members: any[];
  participant_events: any[];
  participant_accommodations: any[];
  payment_orders: any[];
  rpcCalls: { name: string; params: any }[];
  updatedAccommodations: any[];
}

let db: MockDbState;

function createMockSupabaseAdmin() {
  return {
    from: (table: string) => {
      let filters: { col: string; op: string; val: any }[] = [];
      let updates: any = null;

      const builder: any = {
        select: vi.fn(() => builder),
        ilike: vi.fn((col: string, val: any) => {
          filters.push({ col, op: "ilike", val });
          return builder;
        }),
        eq: vi.fn((col: string, val: any) => {
          filters.push({ col, op: "eq", val });
          return builder;
        }),
        in: vi.fn((col: string, val: any) => {
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
        update: vi.fn((payload: any) => {
          updates = payload;
          return builder;
        }),
        maybeSingle: vi.fn(async () => {
          let rows = executeFilter(table, filters);
          return { data: rows[0] || null, error: null };
        }),
        single: vi.fn(async () => {
          let rows = executeFilter(table, filters);
          return { data: rows[0] || null, error: null };
        }),
        then: (resolve: any) => {
          if (updates) {
            // Apply updates
            if (table === "payment_orders") {
              for (const po of db.payment_orders) {
                if (matchesFilters(po, filters)) {
                  Object.assign(po, updates);
                }
              }
            } else if (table === "participant_accommodations") {
              db.updatedAccommodations.push({ updates, filters });
            }
            resolve({ data: null, error: null });
            return;
          }
          let rows = executeFilter(table, filters);
          resolve({ data: rows, error: null });
        },
      };

      return builder;
    },
    rpc: vi.fn(async (name: string, params: any) => {
      db.rpcCalls.push({ name, params });

      if (name === "register_participant_events") {
        const count = params.p_accommodations?.length || 0;
        const totalPaise = count * 999 * 100;
        const totalAmountINR = count * 999;
        const orderId = `po-team-${Date.now()}`;
        const orderRef = `SVK-TEAM-${Date.now()}`;

        // Insert order into mock DB
        db.payment_orders.push({
          id: orderId,
          order_reference: orderRef,
          amount: totalAmountINR,
          currency: "INR",
          status: "pending",
          payer_participant_id: params.p_participant_id,
        });

        return {
          data: [
            {
              participant_id: params.p_participant_id,
              payment_order_id: orderId,
              status: "success",
              message: "Team accommodation order registered successfully",
            },
          ],
          error: null,
        };
      }

      if (name === "process_payment_failure") {
        return { data: { success: true }, error: null };
      }

      if (name === "process_payment_success") {
        return { data: { success: true }, error: null };
      }

      return { data: null, error: new Error(`Unknown RPC ${name}`) };
    }),
  };
}

function matchesFilters(row: any, filters: { col: string; op: string; val: any }[]): boolean {
  for (const f of filters) {
    const val = row[f.col];
    if (f.op === "eq" && val !== f.val) return false;
    if (f.op === "ilike" && String(val).toLowerCase() !== String(f.val).toLowerCase()) return false;
    if (f.op === "is" && f.val === null && val !== null && val !== undefined) return false;
    if (f.op === "in" && Array.isArray(f.val) && !f.val.includes(val)) return false;
  }
  return true;
}

function executeFilter(table: string, filters: { col: string; op: string; val: any }[]): any[] {
  const rows = (db as any)[table] || [];
  return rows.filter((r: any) => matchesFilters(r, filters));
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => createMockSupabaseAdmin()),
}));

// Helper to create POST request
function makePostRequest(body: any): NextRequest {
  return new NextRequest("http://localhost:3000/api/team/accommodation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// ─── TEST SUITE ────────────────────────────────────────────────────────────
describe("SAVISKAR 2026 — Step 3: Production Route Handler Verification (app/api/team/accommodation/route.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SECRET_KEY = "test_secret_key";

    // Setup fresh in-memory database fixture
    db = {
      participants: [...TEAM_MEMBERS_15],
      participant_event_members: TEAM_MEMBERS_15.map((m) => ({
        id: `pem-${m.id}`,
        participant_event_id: PE_ID,
        name: m.name,
        email: m.email,
        participant_id: m.id,
        is_team_leader: m.email === LEADER.email,
        participants: {
          id: m.id,
          participant_id: m.participant_id,
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
      rpcCalls: [],
      updatedAccommodations: [],
    };

    // Default authenticated session is team leader Divyansh
    (getRegistrationSession as any).mockResolvedValue({
      authenticated: true,
      email: LEADER.email,
    });
  });

  // =========================================================================
  // 1. EXACT SERVER-CALCULATED TOTALS AND INTENDED ACCOMMODATION RECORDS
  // =========================================================================
  describe("1. Exact Server-Calculated Order Totals & Intended Records", () => {
    it("Calculates exact total ₹14,985 for all 15 eligible members and passes all 15 records to RPC", async () => {
      const bookings = TEAM_MEMBERS_15.map((m) => ({
        email: m.email,
        planSlug: "2_days",
        selectedDate: "2026-10-28",
      }));

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings,
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.totalAmount).toBe(14985); // Exactly ₹14,985 (15 * 999)
      expect(data.paymentRequired).toBe(true);
      expect(data.bookings).toHaveLength(15);

      // Assert RPC call payload
      const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
      expect(rpcCall).toBeDefined();
      expect(rpcCall?.params.p_accommodations).toHaveLength(15);

      // Assert every single member email is in the RPC payload
      const passedEmails = rpcCall?.params.p_accommodations.map((a: any) => a.email);
      for (const m of TEAM_MEMBERS_15) {
        expect(passedEmails).toContain(m.email);
      }

      // Assert stay dates were synced for all 15 distinct participant UUIDs
      expect(db.updatedAccommodations).toHaveLength(15);
      const updatedParticipantUuids = db.updatedAccommodations.map(
        (u) => u.filters.find((f: any) => f.col === "participant_id")?.val
      );
      for (const m of TEAM_MEMBERS_15) {
        expect(updatedParticipantUuids).toContain(m.id);
      }
    });

    it("Calculates exact total ₹13,986 for exactly 14 members and excludes the 15th member from order", async () => {
      // 14 members (exclude member #15 Deepak Pant)
      const members14 = TEAM_MEMBERS_15.slice(0, 14);
      const excludedMember = TEAM_MEMBERS_15[14]; // Deepak Pant

      const bookings = members14.map((m) => ({
        email: m.email,
        planSlug: "2_days",
        selectedDate: "2026-10-28",
      }));

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings,
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.totalAmount).toBe(13986); // Exactly ₹13,986 (14 * 999)
      expect(data.bookings).toHaveLength(14);

      // Verify RPC payload
      const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
      expect(rpcCall?.params.p_accommodations).toHaveLength(14);
      const passedEmails = rpcCall?.params.p_accommodations.map((a: any) => a.email);
      expect(passedEmails).not.toContain(excludedMember.email);

      // Verify stay dates synced only for the 14 selected
      expect(db.updatedAccommodations).toHaveLength(14);
      const updatedParticipantUuids = db.updatedAccommodations.map(
        (u) => u.filters.find((f: any) => f.col === "participant_id")?.val
      );
      expect(updatedParticipantUuids).not.toContain(excludedMember.id);
    });

    it("Calculates exact total ₹999 for exactly 1 member", async () => {
      const bookings = [
        {
          email: LEADER.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
        },
      ];

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings,
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.totalAmount).toBe(999); // Exactly ₹999
      expect(data.bookings).toHaveLength(1);

      const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
      expect(rpcCall?.params.p_accommodations).toHaveLength(1);
      expect(rpcCall?.params.p_accommodations[0].email).toBe(LEADER.email);
    });

    it("Rejects 0 selections with HTTP 400 without creating a payment order", async () => {
      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Please select at least one accommodation stay.");

      // Ensure no RPC or order creation occurred
      expect(db.rpcCalls).toHaveLength(0);
      expect(db.payment_orders).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. IMMUNITY TO CLIENT-SUPPLIED PRICE TAMPERING
  // =========================================================================
  describe("2. Client-Supplied Price Tampering Immunity", () => {
    it("Ignores client-supplied prices, amounts, or fee overrides in request payload", async () => {
      const tamperedBookings = [
        {
          email: LEADER.email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          price: 1, // Attempted tampering to ₹1
          amount: 0, // Attempted tampering to ₹0
          fee: 50,
          totalAmount: 10,
        },
        {
          email: TEAM_MEMBERS_15[1].email,
          planSlug: "2_days",
          selectedDate: "2026-10-28",
          price: 10,
          amount: 20,
        },
      ];

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: tamperedBookings,
        amount: 5, // Attempted root tampering
        totalAmount: 1,
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.totalAmount).toBe(1998); // 2 members * ₹999 = ₹1,998

      // Assert payload passed to DB RPC contains only clean plan slugs, NO prices
      const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
      for (const acc of rpcCall?.params.p_accommodations) {
        expect(acc.price).toBeUndefined();
        expect(acc.amount).toBeUndefined();
        expect(acc.plan_slug).toBe("2_days");
      }
    });
  });

  // =========================================================================
  // 3. TEAM AUTHORIZATION & DELEGATE ELIGIBILITY INVARIANTS
  // =========================================================================
  describe("3. Team Authorization & Delegate Eligibility Invariants", () => {
    it("Rejects bookings containing a foreign-team or unauthorized member with HTTP 403", async () => {
      const bookingsWithStranger = [
        { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
        { email: "unauthorized.stranger@othercollege.ac.in", planSlug: "2_days", selectedDate: "2026-10-28" },
      ];

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: bookingsWithStranger,
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.code).toBe("UNAUTHORIZED_MEMBER");
      expect(data.error).toContain("is not a verified member of your team");
      expect(db.rpcCalls).toHaveLength(0);
    });

    it("Rejects non-leader team member attempting to manage team accommodation with HTTP 403", async () => {
      // Authenticate as Aman Sharma (regular member, not leader)
      (getRegistrationSession as any).mockResolvedValue({
        authenticated: true,
        email: TEAM_MEMBERS_15[1].email,
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: TEAM_MEMBERS_15[1].email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[2].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.code).toBe("UNAUTHORIZED_TEAM_LEADER");
      expect(db.rpcCalls).toHaveLength(0);
    });

    it("Rejects unauthenticated request with HTTP 401 UNAUTHORIZED", async () => {
      (getRegistrationSession as any).mockResolvedValue({
        authenticated: false,
        email: null,
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [{ email: LEADER.email, planSlug: "2_days" }],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.code).toBe("UNAUTHORIZED");
      expect(db.rpcCalls).toHaveLength(0);
    });

    it("Rejects intra-payload duplicate/overlapping stays for the same delegate with HTTP 400", async () => {
      const duplicateBookings = [
        { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
        { email: LEADER.email, planSlug: "1_day", selectedDate: "2026-10-29" }, // Overlaps Oct 28-30!
      ];

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: duplicateBookings,
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain("overlap");
      expect(db.rpcCalls).toHaveLength(0);
    });

    it("Rejects booking when delegate already has a confirmed paid overlapping stay in database with HTTP 400", async () => {
      // Setup existing paid accommodation in DB for Member 3 Rohit Verma
      db.participant_accommodations.push({
        id: "acc-paid-rohit-001",
        participant_id: TEAM_MEMBERS_15[2].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "paid",
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[2].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe("OVERLAPPING_STAY");
      expect(data.error).toContain("Accommodation is already booked for these dates");
      expect(db.rpcCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. SEPARATION OF EVENT REGISTRATION FEE (₹3,500) FROM ACCOMMODATION
  // =========================================================================
  describe("4. Event Registration Fee Separation", () => {
    it("Maintains complete separation between ₹3,500 event registration and accommodation order", async () => {
      // The team registration in participant_events has payment_amount = 3500 and status = 'paid'
      expect(db.participant_events[0].payment_amount).toBe(3500);

      const bookings = TEAM_MEMBERS_15.map((m) => ({
        email: m.email,
        planSlug: "2_days",
        selectedDate: "2026-10-28",
      }));

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings,
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      // The accommodation order total is strictly 15 * 999 = 14,985 (NOT 18,485 with event fee added!)
      expect(data.totalAmount).toBe(14985);

      // Verify the RPC payload has p_events: [] (empty) so event fee is never re-billed
      const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
      expect(rpcCall?.params.p_events).toEqual([]);
    });
  });

  // =========================================================================
  // 5. PRIOR PENDING HOLDS, IN-FLIGHT CHECKOUTS & RETRIES (SECTION 7B)
  // =========================================================================
  describe("5. Pending Holds, In-Flight Checkouts & Gateway Retries (Section 7b)", () => {
    it("Safely transitions draft order (gateway_order_id: null) to failed and proceeds with checkout", async () => {
      // Member 2 Aman Sharma has an unsubmitted draft order
      const draftOrderId = "po-draft-aman-01";
      db.payment_orders.push({
        id: draftOrderId,
        status: "pending",
        gateway_order_id: null,
      });
      db.participant_accommodations.push({
        id: "acc-draft-aman",
        participant_id: TEAM_MEMBERS_15[1].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "pending",
        payment_order_id: draftOrderId,
        payment_orders: db.payment_orders[0],
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[1].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);

      // Verify draft order status was updated to 'failed'
      const updatedDraft = db.payment_orders.find((po) => po.id === draftOrderId);
      expect(updatedDraft?.status).toBe("failed");
    });

    it("Calls process_payment_failure RPC when PayU authoritatively reports terminal failure (usercancelled)", async () => {
      const priorTxnId = "txnid-cancelled-123";
      const priorOrderId = "po-prior-cancelled";

      db.payment_orders.push({
        id: priorOrderId,
        status: "pending",
        gateway: "payu",
        gateway_order_id: priorTxnId,
      });
      db.participant_accommodations.push({
        id: "acc-prior-cancelled",
        participant_id: TEAM_MEMBERS_15[1].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "pending",
        payment_order_id: priorOrderId,
        payment_orders: db.payment_orders[0],
      });

      mockGateway.fetchPaymentDetails.mockResolvedValueOnce({
        status: "failed",
        rawStatus: "usercancelled",
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[1].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);

      // Verify failure RPC was called for the cancelled prior order
      const failRpc = db.rpcCalls.find((c) => c.name === "process_payment_failure");
      expect(failRpc).toBeDefined();
      expect(failRpc?.params.p_gateway_order_id).toBe(priorTxnId);
    });

    it("Fails safe with HTTP 409 PAYMENT_PENDING when prior payment is active in-flight on gateway", async () => {
      const priorTxnId = "txnid-active-pending-999";
      const priorOrderId = "po-prior-active";

      db.payment_orders.push({
        id: priorOrderId,
        status: "pending",
        gateway: "payu",
        gateway_order_id: priorTxnId,
      });
      db.participant_accommodations.push({
        id: "acc-prior-active",
        participant_id: TEAM_MEMBERS_15[1].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "pending",
        payment_order_id: priorOrderId,
        payment_orders: db.payment_orders[0],
      });

      // Gateway returns pending (user actively paying via UPI or card)
      mockGateway.fetchPaymentDetails.mockResolvedValueOnce({
        status: "pending",
        rawStatus: "in progress",
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[1].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.code).toBe("PAYMENT_PENDING");
      expect(data.error).toContain("is currently being processed by the gateway");

      // Verify no failure RPC and no registration RPC executed
      expect(db.rpcCalls.find((c) => c.name === "process_payment_failure")).toBeUndefined();
      expect(db.rpcCalls.find((c) => c.name === "register_participant_events")).toBeUndefined();
    });

    it("Fails closed with HTTP 409 PAYMENT_STATUS_AMBIGUOUS when gateway returns unknown status", async () => {
      const priorTxnId = "txnid-ambiguous-001";
      const priorOrderId = "po-prior-ambiguous";

      db.payment_orders.push({
        id: priorOrderId,
        status: "pending",
        gateway: "payu",
        gateway_order_id: priorTxnId,
      });
      db.participant_accommodations.push({
        id: "acc-prior-ambiguous",
        participant_id: TEAM_MEMBERS_15[1].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "pending",
        payment_order_id: priorOrderId,
        payment_orders: db.payment_orders[0],
      });

      mockGateway.fetchPaymentDetails.mockResolvedValueOnce({
        status: "unknown_custom_status",
        rawStatus: "bank_internal_review",
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[1].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.code).toBe("PAYMENT_STATUS_AMBIGUOUS");
      expect(db.rpcCalls.find((c) => c.name === "register_participant_events")).toBeUndefined();
    });

    it("Reconciles and rejects with HTTP 409 DELEGATE_ALREADY_PAID if gateway reports prior attempt succeeded", async () => {
      const priorTxnId = "txnid-already-paid-888";
      const priorOrderId = "po-prior-captured";

      db.payment_orders.push({
        id: priorOrderId,
        status: "pending",
        gateway: "payu",
        gateway_order_id: priorTxnId,
      });
      db.participant_accommodations.push({
        id: "acc-prior-captured",
        participant_id: TEAM_MEMBERS_15[1].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "pending",
        payment_order_id: priorOrderId,
        payment_orders: db.payment_orders[0],
      });

      mockGateway.fetchPaymentDetails.mockResolvedValueOnce({
        status: "paid",
        rawStatus: "success",
        gatewayPaymentId: "payu-num-12345",
        amount: 99900,
        currency: "INR",
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[1].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.code).toBe("DELEGATE_ALREADY_PAID");

      // Verify settlement RPC was called to reconcile the captured payment in DB
      const successRpc = db.rpcCalls.find((c) => c.name === "process_payment_success");
      expect(successRpc).toBeDefined();
      expect(successRpc?.params.p_gateway_payment_id).toBe("payu-num-12345");
    });
  });

  // =========================================================================
  // 6. GATEWAY & DATABASE ERROR FAIL-CLOSED RESILIENCE
  // =========================================================================
  describe("6. Gateway & Database Error Fail-Closed Resilience", () => {
    it("Fails closed with HTTP 503 when gateway lookup throws, without modifying database or proceeding with checkout", async () => {
      const priorTxnId = "txnid-timeout-error";
      const priorOrderId = "po-prior-timeout";

      db.payment_orders.push({
        id: priorOrderId,
        status: "pending",
        gateway: "payu",
        gateway_order_id: priorTxnId,
        updated_at: new Date().toISOString(), // recent order (< 15 mins)
      });
      db.participant_accommodations.push({
        id: "acc-prior-timeout",
        participant_id: TEAM_MEMBERS_15[1].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "pending",
        payment_order_id: priorOrderId,
        payment_orders: db.payment_orders[0],
      });

      mockGateway.fetchPaymentDetails.mockRejectedValueOnce(new Error("PayU 504 Gateway Timeout"));

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[1].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.code).toBe("GATEWAY_VERIFICATION_UNAVAILABLE");

      // Ensure zero RPCs were called
      expect(db.rpcCalls).toHaveLength(0);
    });

    it("Fails closed with HTTP 500 SETTLEMENT_RPC_FAILED if gateway payment details succeeded but DB settlement RPC fails", async () => {
      const priorTxnId = "txnid-settlement-fail";
      const priorOrderId = "po-prior-settle-fail";

      db.payment_orders.push({
        id: priorOrderId,
        status: "pending",
        gateway: "payu",
        gateway_order_id: priorTxnId,
      });
      db.participant_accommodations.push({
        id: "acc-prior-settle-fail",
        participant_id: TEAM_MEMBERS_15[1].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "pending",
        payment_order_id: priorOrderId,
        payment_orders: db.payment_orders[0],
      });

      mockGateway.fetchPaymentDetails.mockResolvedValueOnce({
        status: "paid",
        gatewayPaymentId: "payu-num-fail",
        amount: 99900,
      });

      // Make process_payment_success fail
      const origCreateClient = (await import("@supabase/supabase-js")).createClient;
      (origCreateClient as any).mockReturnValueOnce({
        ...createMockSupabaseAdmin(),
        rpc: vi.fn(async (name: string) => {
          if (name === "process_payment_success") {
            return { data: null, error: new Error("DB connection terminated during settlement") };
          }
          return { data: null, error: null };
        }),
      });

      const req = makePostRequest({
        participantEventId: PE_ID,
        bookings: [
          { email: LEADER.email, planSlug: "2_days", selectedDate: "2026-10-28" },
          { email: TEAM_MEMBERS_15[1].email, planSlug: "2_days", selectedDate: "2026-10-28" },
        ],
      });

      const res = await teamAccommodationPOST(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.code).toBe("SETTLEMENT_RPC_FAILED");
    });
  });
});
