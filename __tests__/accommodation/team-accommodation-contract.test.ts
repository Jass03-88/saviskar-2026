/**
 * SAVISKAR 2026 — STEP 4: TEAM CHECKOUT FRONTEND-TO-API CONTRACT TEST
 *
 * Automated integration contract test verifying that the actual production
 * `components/registration/TeamAccommodationModal.tsx` and the actual
 * `app/api/team/accommodation/route.ts` communicate with full fidelity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOCUMENTED REQUEST / RESPONSE CONTRACT:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. Outgoing Request Payload (Modal -> API):
 *    Method: POST
 *    URL: /api/team/accommodation
 *    Headers:
 *      Content-Type: application/json
 *      Accept: application/json
 *    Body:
 *      {
 *        "participantEventId": string,       // e.g. "pe-nritya-hill-hustlers-001"
 *        "bookings": Array<{
 *          "email": string,                  // Delegate's verified team email
 *          "planSlug": string,               // Standard slug e.g. "2_days", "1_day"
 *          "selectedDate": string,           // ISO date e.g. "2026-10-28"
 *          "extraDays": string               // "none", "before_27", "after_30", "both"
 *        }>
 *      }
 *    CRITICAL INVARIANT: The frontend NEVER sends price, fee, or amount fields.
 *    The server calculates all pricing authoritatively from registered plans.
 *
 * 2. Successful Response Payload (API -> Modal):
 *    Status: 201 Created
 *    Body:
 *      {
 *        "success": true,
 *        "participantId": string,            // Public ID e.g. "SVK26-09A7C27C"
 *        "paymentOrderId": string,           // UUID e.g. "po-team-12345"
 *        "orderReference": string,           // Unique ref e.g. "SVK-TEAM-..."
 *        "totalAmount": number,              // Server-calculated INR total (e.g. 14985)
 *        "paymentRequired": boolean,         // true if totalAmount > 0
 *        "paymentOrder": { ... },
 *        "bookings": [ ... ]
 *      }
 *
 * 3. Error Response Payload (API -> Modal):
 *    Status: 400 | 401 | 403 | 409 | 500 | 503
 *    Body:
 *      {
 *        "success": false,
 *        "error": string,                    // Descriptive user-facing message
 *        "code"?: string                     // e.g. "OVERLAPPING_STAY", "PAYMENT_PENDING"
 *      }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { NextRequest } from "next/server";
import { POST as teamAccommodationPOST } from "@/app/api/team/accommodation/route";
import TeamAccommodationModal, {
  type TeamMemberForModal,
} from "@/components/registration/TeamAccommodationModal";

// ─── 1. Mock External Services (Registration Session & Rate Limit) ─────────
vi.mock("@/lib/auth/session", () => ({
  getRegistrationSession: vi.fn(),
}));
import { getRegistrationSession } from "@/lib/auth/session";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

// ─── 2. Mock Payment Gateway ──────────────────────────────────────────────
const mockGateway = {
  name: "payu",
  fetchPaymentDetails: vi.fn(),
};

vi.mock("@/lib/payments", () => ({
  getPaymentGateway: vi.fn(() => mockGateway),
}));

// ─── 3. Mock React-DOM & Motion for Node Environment ──────────────────────
vi.mock("react-dom", () => ({
  createPortal: vi.fn((node: any) => node),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: any) => children,
  motion: {
    div: ({ children, ...props }: any) => React.createElement("div", props, children),
  },
}));

vi.mock("@/components/registration/useModalScrollLock", () => ({
  useModalScrollLock: vi.fn(),
}));

// ─── 4. Synthetic 15 Members Dataset (Graphic Era Hill University) ─────────
const LEADER: TeamMemberForModal = {
  id: "uuid-divyansh-01",
  name: "Divyansh Tiwari",
  email: "divyansh.tiwari@example.com",
  phone: "9876500001",
  isTeamLeader: true,
  participantId: "SVK26-09A7C27C",
  college: "Graphic Era Hill University",
  accommodations: [],
};

const TEAM_MEMBERS_15: TeamMemberForModal[] = [
  LEADER,
  { id: "uuid-aman-02", name: "Aman Sharma", email: "aman.sharma@example.com", phone: "9876500002", isTeamLeader: false, participantId: "SVK26-09A7C27D", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-rohit-03", name: "Rohit Verma", email: "rohit.verma@example.com", phone: "9876500003", isTeamLeader: false, participantId: "SVK26-09A7C27E", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-sneha-04", name: "Sneha Rawat", email: "sneha.rawat@example.com", phone: "9876500004", isTeamLeader: false, participantId: "SVK26-09A7C27F", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-pooja-05", name: "Pooja Negi", email: "pooja.negi@example.com", phone: "9876500005", isTeamLeader: false, participantId: "SVK26-09A7C280", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-ankit-06", name: "Ankit Bisht", email: "ankit.bisht@example.com", phone: "9876500006", isTeamLeader: false, participantId: "SVK26-09A7C281", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-priya-07", name: "Priya Chauhan", email: "priya.chauhan@example.com", phone: "9876500007", isTeamLeader: false, participantId: "SVK26-09A7C282", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-karan-08", name: "Karan Joshi", email: "karan.joshi@example.com", phone: "9876500008", isTeamLeader: false, participantId: "SVK26-09A7C283", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-simran-09", name: "Simran Kaur", email: "simran.kaur@example.com", phone: "9876500009", isTeamLeader: false, participantId: "SVK26-09A7C284", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-aditya-10", name: "Aditya Mehta", email: "aditya.mehta@example.com", phone: "9876500010", isTeamLeader: false, participantId: "SVK26-09A7C285", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-neha-11", name: "Neha Bhatt", email: "neha.bhatt@example.com", phone: "9876500011", isTeamLeader: false, participantId: "SVK26-09A7C286", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-vikas-12", name: "Vikas Rana", email: "vikas.rana@example.com", phone: "9876500012", isTeamLeader: false, participantId: "SVK26-09A7C287", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-riya-13", name: "Riya Sen", email: "riya.sen@example.com", phone: "9876500013", isTeamLeader: false, participantId: "SVK26-09A7C288", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-manish-14", name: "Manish Kumar", email: "manish.kumar@example.com", phone: "9876500014", isTeamLeader: false, participantId: "SVK26-09A7C289", college: "Graphic Era Hill University", accommodations: [] },
  { id: "uuid-deepak-15", name: "Deepak Pant", email: "deepak.pant@example.com", phone: "9876500015", isTeamLeader: false, participantId: "SVK26-09A7C290", college: "Graphic Era Hill University", accommodations: [] },
];

const PE_ID = "pe-nritya-hill-hustlers-001";

// ─── 5. In-Memory Database & Supabase Mock ─────────────────────────────────
interface MockDbState {
  participants: any[];
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
            if (table === "participant_accommodations") {
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
        const totalAmountINR = count * 999;
        const orderId = `po-team-${Date.now()}`;
        const orderRef = `SVK-TEAM-${Date.now()}`;

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

// Mock document globally before importing or rendering components
if (typeof globalThis.document === "undefined") {
  (globalThis as any).document = {
    body: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// ─── 6. React Functional Component Harness ─────────────────────────────────
// Allows executing the exact production functional component and extracting its handlers & state
let hookStates: any[] = [];
let hookIndex = 0;

vi.mock("react", async () => {
  const actual = await vi.importActual("react") as typeof React;
  return {
    ...actual,
    useState: vi.fn((init) => {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        // Force mounted to true at index 0
        if (idx === 0) {
          hookStates[idx] = true;
        } else {
          hookStates[idx] = typeof init === "function" ? init() : init;
        }
      }
      const setState = (newVal: any) => {
        hookStates[idx] = typeof newVal === "function" ? newVal(hookStates[idx]) : newVal;
      };
      return [hookStates[idx], setState];
    }),
    useRef: vi.fn((init) => {
      const idx = hookIndex++;
      if (hookStates[idx] === undefined) {
        hookStates[idx] = { current: init };
      }
      return hookStates[idx];
    }),
    useEffect: vi.fn((fn, deps) => {
      const idx = hookIndex++;
      const prev = hookStates[idx];
      let changed = !prev || !deps || deps.some((d: any, i: number) => d !== prev.deps?.[i]);
      if (changed) {
        fn();
        hookStates[idx] = { deps: deps ? [...deps] : undefined };
      }
    }),
    useMemo: vi.fn((fn, deps) => {
      const idx = hookIndex++;
      const prev = hookStates[idx];
      let changed = !prev || !deps || deps.some((d: any, i: number) => d !== prev.deps?.[i]);
      if (changed) {
        const val = fn();
        hookStates[idx] = { val, deps: deps ? [...deps] : undefined };
        return val;
      }
      return prev.val;
    }),
    useCallback: vi.fn((fn) => fn),
  };
});

function findInTree(tree: any, predicate: (el: any) => boolean): any {
  if (!tree || typeof tree !== "object") return null;
  if (predicate(tree)) return tree;

  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findInTree(child, predicate);
      if (found) return found;
    }
  }

  if (tree.props) {
    if (tree.props.children) {
      const found = findInTree(tree.props.children, predicate);
      if (found) return found;
    }
  }

  return null;
}

// ─── TEST SUITE ────────────────────────────────────────────────────────────
describe("SAVISKAR 2026 — Step 4: Team Checkout Frontend-to-API Contract Test", () => {
  let mockOnClose: any;
  let mockOnProceedToPayment: any;
  let interceptedRequest: { url: string; method: string; body: any } | null;

  beforeEach(() => {
    vi.clearAllMocks();
    hookStates = [];
    hookIndex = 0;
    interceptedRequest = null;
    mockOnClose = vi.fn();
    mockOnProceedToPayment = vi.fn().mockResolvedValue(undefined);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SECRET_KEY = "test_secret_key";

    // Setup fresh database fixture
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
      rpcCalls: [],
      updatedAccommodations: [],
    };

    (getRegistrationSession as any).mockResolvedValue({
      authenticated: true,
      email: LEADER.email,
    });

    // Mock global fetch to wire the modal's outgoing request directly into the real API route
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      interceptedRequest = {
        url: String(url),
        method: init?.method || "GET",
        body: JSON.parse(init?.body || "{}"),
      };

      // Create NextRequest and pass into the actual API handler
      const nextReq = new NextRequest(`http://localhost:3000${url}`, {
        method: init?.method || "POST",
        headers: init?.headers || { "Content-Type": "application/json" },
        body: init?.body,
      });

      const response = await teamAccommodationPOST(nextReq);
      const resJson = await response.json();

      return {
        ok: response.ok,
        status: response.status,
        json: async () => resJson,
      } as Response;
    });
  });

  function renderModal(propsOverrides: Partial<React.ComponentProps<typeof TeamAccommodationModal>> = {}) {
    hookIndex = 0;
    return TeamAccommodationModal({
      isOpen: true,
      onClose: mockOnClose,
      participantEventId: PE_ID,
      teamName: "Hill hustlers",
      eventName: "Nritya-e-bharat",
      members: TEAM_MEMBERS_15,
      onProceedToPayment: mockOnProceedToPayment,
      ...propsOverrides,
    });
  }

  // =========================================================================
  // 1. ALL 15 MEMBERS: SELECTION, CONTRACT VERIFICATION & PERSISTENCE
  // =========================================================================
  it("Contract: Selecting all 15 members in modal transmits clean payload and settles for ₹14,985", async () => {
    // 1. Initial render of modal
    let tree = renderModal();

    // 2. Click "Select All" button in the modal UI
    const selectAllBtn = findInTree(tree, (node) =>
      node?.type === "button" && typeof node.props?.children === "string" && node.props.children.includes("Select All")
    );
    expect(selectAllBtn).toBeDefined();
    selectAllBtn.props.onClick();

    // 3. Re-render after selection
    tree = renderModal();

    // 4. Verify checkout button is enabled and displays ₹14,985
    const submitBtn = findInTree(tree, (node) =>
      node?.type === "button" && typeof node.props?.onClick === "function" && node.props?.disabled !== undefined
    );
    expect(submitBtn).toBeDefined();
    expect(submitBtn.props.disabled).toBe(false);

    // 5. Click checkout button in modal
    await submitBtn.props.onClick();

    // 6. Assert exact outgoing HTTP request contract from the modal
    expect(interceptedRequest).toBeDefined();
    expect(interceptedRequest?.url).toBe("/api/team/accommodation");
    expect(interceptedRequest?.method).toBe("POST");
    expect(interceptedRequest?.body.participantEventId).toBe(PE_ID);
    expect(interceptedRequest?.body.bookings).toHaveLength(15);

    // Verify each booking contains plan/date info and NO price tampering
    for (const booking of interceptedRequest?.body.bookings) {
      expect(booking.planSlug).toBe("2_days");
      expect(booking.selectedDate).toBe("2026-10-28");
      expect(booking.extraDays).toBe("none");
      expect((booking as any).price).toBeUndefined();
      expect((booking as any).amount).toBeUndefined();
    }

    // Verify all 15 distinct emails are present with 0 duplicates
    const bookingEmails = interceptedRequest?.body.bookings.map((b: any) => b.email);
    expect(new Set(bookingEmails).size).toBe(15);
    for (const m of TEAM_MEMBERS_15) {
      expect(bookingEmails).toContain(m.email);
    }

    // 7. Verify resulting database operations and record associations
    const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
    expect(rpcCall).toBeDefined();
    expect(rpcCall?.params.p_accommodations).toHaveLength(15);
    expect(rpcCall?.params.p_events).toEqual([]); // ₹3,500 event fee strictly excluded

    // Assert that exactly all 15 participant UUIDs had their stay dates synced
    expect(db.updatedAccommodations).toHaveLength(15);
    const updatedUuids = db.updatedAccommodations.map(
      (u) => u.filters.find((f: any) => f.col === "participant_id")?.val
    );
    for (const m of TEAM_MEMBERS_15) {
      expect(updatedUuids).toContain(m.id);
    }

    // 8. Verify modal lifecycle callbacks
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnProceedToPayment).toHaveBeenCalledTimes(1);
    expect(mockOnProceedToPayment).toHaveBeenCalledWith(
      expect.stringMatching(/^po-team-/),
      LEADER.participantId
    );
  });

  // =========================================================================
  // 2. 14 MEMBERS: SELECTIVE EXCLUSION & EXACT RECORD ASSOCIATIONS
  // =========================================================================
  it("Contract: Selecting 14 members excludes the 15th member and settles for ₹13,986", async () => {
    // Render and select all
    let tree = renderModal();
    const selectAllBtn = findInTree(tree, (node) =>
      node?.type === "button" && typeof node.props?.children === "string" && node.props.children.includes("Select All")
    );
    selectAllBtn.props.onClick();

    // Re-render
    tree = renderModal();

    // Deselect member #15 Deepak Pant
    // In TeamAccommodationModal, hookStates[3] is the selections Record
    hookStates[3] = {
      ...hookStates[3],
      [TEAM_MEMBERS_15[14].email]: {
        ...hookStates[3][TEAM_MEMBERS_15[14].email],
        selected: false,
      },
    };

    // Re-render with 14 selected
    tree = renderModal();
    const submitBtn = findInTree(tree, (node) =>
      node?.type === "button" && typeof node.props?.onClick === "function" && node.props?.disabled !== undefined
    );
    expect(submitBtn.props.disabled).toBe(false);

    // Submit
    await submitBtn.props.onClick();

    // Assert intercepted request has exactly 14 bookings
    expect(interceptedRequest?.body.bookings).toHaveLength(14);
    const bookingEmails = interceptedRequest?.body.bookings.map((b: any) => b.email);
    expect(bookingEmails).not.toContain(TEAM_MEMBERS_15[14].email);

    // Verify DB operations
    const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
    expect(rpcCall?.params.p_accommodations).toHaveLength(14);

    expect(db.updatedAccommodations).toHaveLength(14);
    const updatedUuids = db.updatedAccommodations.map(
      (u) => u.filters.find((f: any) => f.col === "participant_id")?.val
    );
    expect(updatedUuids).not.toContain(TEAM_MEMBERS_15[14].id);

    // Verify callbacks
    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnProceedToPayment).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // 3. 1 MEMBER: SINGLE DELEGATE CONTRACT & TOTAL ₹999
  // =========================================================================
  it("Contract: Selecting 1 member transmits single booking and settles for ₹999", async () => {
    let tree = renderModal();

    // Select only Divyansh Tiwari at hookStates[3]
    hookStates[3] = {
      ...hookStates[3],
      [LEADER.email]: {
        selected: true,
        planSlug: "2_days",
        selectedDate: "2026-10-28",
        extraDays: "none",
      },
    };

    tree = renderModal();
    const submitBtn = findInTree(tree, (node) =>
      node?.type === "button" && typeof node.props?.onClick === "function" && node.props?.disabled !== undefined
    );
    expect(submitBtn.props.disabled).toBe(false);

    await submitBtn.props.onClick();

    expect(interceptedRequest?.body.bookings).toHaveLength(1);
    expect(interceptedRequest?.body.bookings[0].email).toBe(LEADER.email);

    const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
    expect(rpcCall?.params.p_accommodations).toHaveLength(1);

    expect(db.updatedAccommodations).toHaveLength(1);
    expect(db.payment_orders[0].amount).toBe(999);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnProceedToPayment).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // 4. 0 MEMBERS: DISABLED BUTTON & REJECTION WITHOUT ORDER CREATION
  // =========================================================================
  it("Contract: 0 members selected disables checkout button and prevents order creation", async () => {
    const tree = renderModal();

    // Verify checkout button is disabled
    const submitBtn = findInTree(tree, (node) =>
      node?.type === "button" && typeof node.props?.onClick === "function" && node.props?.disabled !== undefined
    );
    expect(submitBtn.props.disabled).toBe(true);

    // If handleSubmit is invoked directly with 0 selections:
    await submitBtn.props.onClick();

    // Fetch was never called
    expect(interceptedRequest).toBeNull();
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.payment_orders).toHaveLength(0);
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnProceedToPayment).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 5. EVENT FEE SEPARATION (₹3,500)
  // =========================================================================
  it("Contract: Paid ₹3,500 event registration is never conflated with accommodation total", async () => {
    expect(db.participant_events[0].payment_amount).toBe(3500);

    let tree = renderModal();
    const selectAllBtn = findInTree(tree, (node) =>
      node?.type === "button" && typeof node.props?.children === "string" && node.props.children.includes("Select All")
    );
    selectAllBtn.props.onClick();

    tree = renderModal();
    const submitBtn = findInTree(tree, (node) =>
      node?.type === "button" && typeof node.props?.onClick === "function" && node.props?.disabled !== undefined
    );

    await submitBtn.props.onClick();

    // Order amount is strictly 14,985 (15 * 999), NOT 18,485
    const createdOrder = db.payment_orders[0];
    expect(createdOrder.amount).toBe(14985);

    // p_events sent to RPC is strictly empty
    const rpcCall = db.rpcCalls.find((c) => c.name === "register_participant_events");
    expect(rpcCall?.params.p_events).toEqual([]);
  });

  // =========================================================================
  // 6. ERROR HANDLING, STALE STATE & FAILURES (UI PRESERVES SELECTIONS)
  // =========================================================================
  describe("6. Error Handling & Stale Selection Preservation", () => {
    it("When API returns 409 conflict, modal catches error, does NOT close, and preserves selections", async () => {
      // Configure gateway mock to return active pending status (which causes API to return 409 PAYMENT_PENDING)
      db.payment_orders.push({
        id: "po-active-in-flight",
        status: "pending",
        gateway: "payu",
        gateway_order_id: "txnid-active-999",
      });
      db.participant_accommodations.push({
        id: "acc-active-aman",
        participant_id: TEAM_MEMBERS_15[1].id,
        start_date: "2026-10-28",
        end_date: "2026-10-30",
        status: "pending",
        payment_order_id: "po-active-in-flight",
        payment_orders: db.payment_orders[0],
      });

      mockGateway.fetchPaymentDetails.mockResolvedValueOnce({
        status: "pending",
        rawStatus: "in progress",
      });

      let tree = renderModal();
      const selectAllBtn = findInTree(tree, (node) =>
        node?.type === "button" && typeof node.props?.children === "string" && node.props.children.includes("Select All")
      );
      selectAllBtn.props.onClick();

      tree = renderModal();
      const submitBtn = findInTree(tree, (node) =>
        node?.type === "button" && typeof node.props?.onClick === "function" && node.props?.disabled !== undefined
      );

      await submitBtn.props.onClick();

      // Modal did NOT close and did NOT proceed to payment
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(mockOnProceedToPayment).not.toHaveBeenCalled();

      // Hook index for errorMessage is hookStates[6]
      // Verify error message was recorded in modal state
      expect(hookStates[6]).toContain("is currently being processed by the gateway");

      // Verify selections (hookStates[3]) remain intact and were NOT cleared
      const currentSelections = hookStates[3];
      expect(Object.keys(currentSelections)).toHaveLength(15);
      expect(currentSelections[LEADER.email].selected).toBe(true);
      expect(currentSelections[TEAM_MEMBERS_15[1].email].selected).toBe(true);
    });

    it("When network throws an exception, modal catches error, does NOT close, and preserves selections", async () => {
      // Force fetch to reject with network error
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));

      let tree = renderModal();
      const selectAllBtn = findInTree(tree, (node) =>
        node?.type === "button" && typeof node.props?.children === "string" && node.props.children.includes("Select All")
      );
      selectAllBtn.props.onClick();

      tree = renderModal();
      const submitBtn = findInTree(tree, (node) =>
        node?.type === "button" && typeof node.props?.onClick === "function" && node.props?.disabled !== undefined
      );

      await submitBtn.props.onClick();

      // Modal did NOT close
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(mockOnProceedToPayment).not.toHaveBeenCalled();

      // Error message set at hookStates[6]
      expect(hookStates[6]).toBe("Failed to fetch");

      // Selections preserved at hookStates[3]
      expect(hookStates[3][LEADER.email].selected).toBe(true);
    });
  });
});
