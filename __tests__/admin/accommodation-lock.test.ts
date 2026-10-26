import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  DEFAULT_SITE_ACCESS,
  SITE_PAGE_DEFINITIONS,
  SITE_ACCESS_AUDIT_TARGET_ID,
  clearSiteAccessCache,
  __setTestSiteAccess,
} from "@/lib/config/site-access";
import * as serverLib from "@/lib/supabase/server";
import * as authSessionLib from "@/lib/auth/session";
import * as rateLimitLib from "@/lib/rate-limit";
import { PATCH as patchSiteAccessApi } from "@/app/api/admin/site-access/route";
import { POST as postRegister } from "@/app/api/register/route";
import { POST as postTeamAccommodation } from "@/app/api/team/accommodation/route";
import { POST as postAccommodationsBook } from "@/app/api/accommodations/book/route";
import { POST as postPaymentRecover } from "@/app/api/payments/recover/route";
import { POST as postPaymentCreate } from "@/app/api/payments/create/route";

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return {
    ...mod,
    after: vi.fn(() => {}),
  };
});

function makeQueryChain(resolveData: any, errorData: any = null) {
  const defaultResolve = () => Promise.resolve({ data: resolveData, error: errorData });
  const chain: any = {
    then: (onFulfilled: any, onRejected: any) => defaultResolve().then(onFulfilled, onRejected),
    catch: (fn: any) => defaultResolve().catch(fn),
    finally: (fn: any) => defaultResolve().finally(fn),
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    is: () => chain,
    lt: () => chain,
    gt: () => chain,
    limit: () => chain,
    order: () => chain,
    update: () => chain,
    insert: () => chain,
    single: () =>
      Promise.resolve({
        data: Array.isArray(resolveData) ? resolveData[0] ?? null : resolveData,
        error: errorData,
      }),
    maybeSingle: () =>
      Promise.resolve({
        data: Array.isArray(resolveData) ? resolveData[0] ?? null : resolveData,
        error: errorData,
      }),
  };
  return chain;
}

let mockAuditLogInsert: ((rec: any) => Promise<{ error: any }>) | null = null;
let mockRpcHandler: ((name: string, params: any) => Promise<{ data: any; error: any }>) | null = null;
let mockFromHandler: ((table: string) => any) | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (mockFromHandler) {
        return mockFromHandler(table);
      }
      if (table === "admin_audit_logs") {
        return {
          insert: (rec: any) => {
            if (mockAuditLogInsert) return mockAuditLogInsert(rec);
            return Promise.resolve({ error: null });
          },
          select: () => makeQueryChain(null),
        };
      }
      return makeQueryChain(null);
    },
    rpc: (name: string, params: any) => {
      if (mockRpcHandler) return mockRpcHandler(name, params);
      if (name === "update_site_page_locks") {
        if (mockAuditLogInsert) {
          const insertPromise = mockAuditLogInsert({
            admin_id: params.p_admin_id,
            action_type: "SITE_PAGE_LOCKS_UPDATE",
            target_id: params.p_target_id,
            details: params.p_details,
          });
          return insertPromise.then((res: any) => {
            if (res?.error) return { data: null, error: res.error };
            return { data: { success: true, audit_id: "mock-audit-uuid" }, error: null };
          });
        }
        return Promise.resolve({ data: { success: true, audit_id: "mock-audit-uuid" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-test.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";
process.env.TEST_LIVE_DB = "true";
process.env.PAYU_KEY = "test-payu-key";
process.env.PAYU_SALT = "test-payu-salt";
process.env.PAYU_ENVIRONMENT = "test";
process.env.RESUME_TOKEN_SECRET = "test-resume-token-secret-must-be-32-chars-long";

describe("Phase 1: Accommodation Access Lock — Authorization & Configuration", () => {
  beforeEach(() => {
    clearSiteAccessCache();
    __setTestSiteAccess(null);
    mockAuditLogInsert = null;
    mockRpcHandler = null;
    mockFromHandler = null;
    vi.restoreAllMocks();
  });

  it("includes ACCOMMODATION_ENABLED in DEFAULT_SITE_ACCESS and defaults to true", () => {
    expect(DEFAULT_SITE_ACCESS.ACCOMMODATION_ENABLED).toBe(true);
    expect(SITE_PAGE_DEFINITIONS.ACCOMMODATION_ENABLED).toBeDefined();
    expect(SITE_PAGE_DEFINITIONS.ACCOMMODATION_ENABLED.name).toBe("Campus Accommodation Booking");
  });

  it("allows Primary Master Admin to lock ACCOMMODATION_ENABLED via PATCH /api/admin/site-access", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      user: { id: "primary-master-uuid", email: "jashan082006@gmail.com" } as any,
      status: 200,
    } as any);

    let insertedRecord: any = null;
    mockAuditLogInsert = (record: any) => {
      insertedRecord = record;
      return Promise.resolve({ error: null });
    };

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: false }),
    });

    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.siteAccess.ACCOMMODATION_ENABLED).toBe(false);

    expect(insertedRecord).toBeDefined();
    expect(insertedRecord.action_type).toBe("SITE_PAGE_LOCKS_UPDATE");
    expect(insertedRecord.target_id).toBe(SITE_ACCESS_AUDIT_TARGET_ID);
    expect(insertedRecord.details.locks.ACCOMMODATION_ENABLED).toBe(false);
    expect(insertedRecord.details.changed_key).toBe("ACCOMMODATION_ENABLED");
    expect(insertedRecord.details.changed_value).toBe(false);
  });

  it("strictly rejects non-primary administrators from mutating ACCOMMODATION_ENABLED with 403", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      error: "Super Master Admin access required",
      status: 403,
    } as any);

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: false }),
    });

    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Access denied. Only Primary Master Admins have authorization");
  });

  it("rejects unauthenticated requests from mutating ACCOMMODATION_ENABLED with 401", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      error: "Unauthorized",
      status: 401,
    } as any);

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: false }),
    });

    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(401);
  });

  it("returns 500 when persistent update fails without reporting false success", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      user: { id: "primary-master-uuid", email: "jashan082006@gmail.com" } as any,
      status: 200,
    } as any);

    mockAuditLogInsert = () => Promise.resolve({ error: { message: "Database connection failed" } });

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: false }),
    });

    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to persist site lock configuration.");
  });

  it("fails closed with 500 when atomic RPC is missing (PGRST202) and attempts NO direct audit insert", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      user: { id: "primary-master-uuid", email: "jashan082006@gmail.com" } as any,
      status: 200,
    } as any);

    let directInsertAttempted = false;
    mockFromHandler = (table: string) => {
      if (table === "admin_audit_logs") {
        return {
          insert: () => {
            directInsertAttempted = true;
            return Promise.resolve({ error: null });
          },
          select: () => makeQueryChain(null),
        };
      }
      return makeQueryChain(null);
    };

    mockRpcHandler = (name: string) => {
      if (name === "update_site_page_locks") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "function public.update_site_page_locks does not exist" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: false }),
    });

    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Atomic site page lock service is unavailable. Please verify database migrations.");
    expect(directInsertAttempted).toBe(false);
  });

  it("fails closed with 500 when atomic RPC returns Postgres 42883 undefined_function", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      user: { id: "primary-master-uuid", email: "jashan082006@gmail.com" } as any,
      status: 200,
    } as any);

    let directInsertAttempted = false;
    mockFromHandler = (table: string) => {
      if (table === "admin_audit_logs") {
        return {
          insert: () => {
            directInsertAttempted = true;
            return Promise.resolve({ error: null });
          },
          select: () => makeQueryChain(null),
        };
      }
      return makeQueryChain(null);
    };

    mockRpcHandler = (name: string) => {
      if (name === "update_site_page_locks") {
        return Promise.resolve({
          data: null,
          error: { code: "42883", message: "routine public.update_site_page_locks(uuid, uuid, jsonb) does not exist" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: false }),
    });

    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Atomic site page lock service is unavailable. Please verify database migrations.");
    expect(directInsertAttempted).toBe(false);
  });

  it("fails closed with 500 when atomic RPC experiences operational database errors (lock timeout / 57014)", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      user: { id: "primary-master-uuid", email: "jashan082006@gmail.com" } as any,
      status: 200,
    } as any);

    let directInsertAttempted = false;
    mockFromHandler = (table: string) => {
      if (table === "admin_audit_logs") {
        return {
          insert: () => {
            directInsertAttempted = true;
            return Promise.resolve({ error: null });
          },
          select: () => makeQueryChain(null),
        };
      }
      return makeQueryChain(null);
    };

    mockRpcHandler = (name: string) => {
      if (name === "update_site_page_locks") {
        return Promise.resolve({
          data: null,
          error: { code: "57014", message: "canceling statement due to statement timeout" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: false }),
    });

    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Failed to persist site lock configuration.");
    expect(directInsertAttempted).toBe(false);
  });

  it("ensures existing unrelated Page Locks continue to mutate successfully via the atomic RPC", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      user: { id: "primary-master-uuid", email: "jashan082006@gmail.com" } as any,
      status: 200,
    } as any);

    let rpcCallParams: any = null;
    mockRpcHandler = (name: string, params: any) => {
      if (name === "update_site_page_locks") {
        rpcCallParams = params;
        return Promise.resolve({
          data: { success: true, audit_id: "schedule-audit-uuid" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "SCHEDULE_ENABLED", enabled: false }),
    });

    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.siteAccess.SCHEDULE_ENABLED).toBe(false);
    expect(rpcCallParams).toBeDefined();
    expect(rpcCallParams.p_details.locks.SCHEDULE_ENABLED).toBe(false);
    expect(rpcCallParams.p_details.changed_key).toBe("SCHEDULE_ENABLED");
    expect(rpcCallParams.p_details.changed_value).toBe(false);
  });

  it("preserves accommodation-specific lock timestamp across unrelated page-lock updates", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      user: { id: "primary-master-uuid", email: "jashan082006@gmail.com" } as any,
      status: 200,
    } as any);

    let latestAuditRecord: any = null;
    mockAuditLogInsert = (record: any) => {
      latestAuditRecord = record;
      return Promise.resolve({ error: null });
    };

    // 1. Lock accommodation
    const req1 = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: false }),
    });

    const res1 = await patchSiteAccessApi(req1);
    expect(res1.status).toBe(200);
    expect(latestAuditRecord.details.accommodation_locked_at).toBeDefined();
    const firstLockTime = latestAuditRecord.details.accommodation_locked_at;

    // Simulate query returning the first audit record
    mockFromHandler = (table: string) => {
      if (table === "admin_audit_logs") {
        return makeQueryChain(latestAuditRecord);
      }
      return makeQueryChain(null);
    };

    // 2. Update an unrelated page lock (SCHEDULE_ENABLED)
    const req2 = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "SCHEDULE_ENABLED", enabled: false }),
    });

    const res2 = await patchSiteAccessApi(req2);
    expect(res2.status).toBe(200);
    expect(latestAuditRecord.details.locks.ACCOMMODATION_ENABLED).toBe(false);
    expect(latestAuditRecord.details.locks.SCHEDULE_ENABLED).toBe(false);
    // CRITICAL: The accommodation lock timestamp must NOT change or advance!
    expect(latestAuditRecord.details.accommodation_locked_at).toBe(firstLockTime);
    expect(latestAuditRecord.details.lock_timestamps.ACCOMMODATION_ENABLED).toBe(firstLockTime);

    // 3. Unlock accommodation
    const req3 = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "ACCOMMODATION_ENABLED", enabled: true }),
    });

    const res3 = await patchSiteAccessApi(req3);
    expect(res3.status).toBe(200);
    expect(latestAuditRecord.details.locks.ACCOMMODATION_ENABLED).toBe(true);
    expect(latestAuditRecord.details.accommodation_locked_at).toBeNull();
  });
});

describe("Phase 1: Accommodation Access Lock — Registration & Booking Protection", () => {
  beforeEach(() => {
    clearSiteAccessCache();
    __setTestSiteAccess(null);
    mockAuditLogInsert = null;
    mockRpcHandler = null;
    mockFromHandler = null;
    vi.restoreAllMocks();

    vi.spyOn(rateLimitLib, "checkRateLimitAsync").mockResolvedValue({
      allowed: true,
      retryAfter: 0,
    });
  });

  it("blocks new participant accommodation booking via POST /api/register when locked with HTTP 403 ACCOMMODATION_LOCKED", async () => {
    __setTestSiteAccess({ ACCOMMODATION_ENABLED: false });

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "delegate@cgc.edu.in",
    });

    const req = new NextRequest("http://localhost:3000/api/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "content-length": "500",
      },
      body: JSON.stringify({
        email: "delegate@cgc.edu.in",
        name: "Delegate CGC",
        college: "CGC University Mohali",
        phone: "9876543210",
        idCardStoragePath: "delegate@cgc.edu.in/id-card.jpg",
        events: [],
        accommodations: [
          {
            email: "delegate@cgc.edu.in",
            planSlug: "2_days",
            selectedDate: "2026-10-28",
            extraDays: "none",
          },
        ],
      }),
    });

    const res = await postRegister(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("ACCOMMODATION_LOCKED");
    expect(data.error).toContain("Hostel allocations are temporarily closed by administration");
  });

  it("blocks mixed event and accommodation registration while accommodation is locked", async () => {
    __setTestSiteAccess({ ACCOMMODATION_ENABLED: false });

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "delegate@cgc.edu.in",
    });

    const req = new NextRequest("http://localhost:3000/api/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "content-length": "600",
      },
      body: JSON.stringify({
        email: "delegate@cgc.edu.in",
        name: "Delegate CGC",
        college: "CGC University Mohali",
        phone: "9876543210",
        idCardStoragePath: "delegate@cgc.edu.in/id-card.jpg",
        events: [
          {
            eventId: "00000000-0000-0000-0000-000000000001",
            team: null,
            isTeamHead: false,
            members: [],
          },
        ],
        accommodations: [
          {
            email: "delegate@cgc.edu.in",
            planSlug: "1_day",
            selectedDate: "2026-10-28",
            extraDays: "none",
          },
        ],
      }),
    });

    const res = await postRegister(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("ACCOMMODATION_LOCKED");
  });

  it("permits pure event-only registration when accommodation is locked", async () => {
    __setTestSiteAccess({ ACCOMMODATION_ENABLED: false });

    const eventUuid = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "delegate@cgc.edu.in",
    });

    mockFromHandler = (table: string) => {
      if (table === "events") {
        return makeQueryChain([
          {
            id: eventUuid,
            name: "Code Circuit",
            registration_open: true,
            min_team_size: 1,
            max_team_size: 1,
            payment_type: "free",
          },
        ]);
      }
      if (table === "participants") {
        return makeQueryChain({
          id: "participant-uuid-1",
          participant_id: "SVK26-ABC12345",
          email: "delegate@cgc.edu.in",
          name: "Delegate CGC",
          college: "CGC University Mohali",
        });
      }
      if (table === "participant_events") {
        return makeQueryChain([
          {
            id: "pe-uuid-1",
            participant_id: "participant-uuid-1",
            event_id: eventUuid,
            registration_status: "registered",
            payment_status: "not_required",
            payment_amount: 0,
            payment_id: null,
            team_name: null,
            checked_in: false,
            checked_in_at: null,
            events: {
              id: eventUuid,
              name: "Code Circuit",
              category: "Technical",
              registration_type: "individual",
              registration_fee: 0,
              payment_type: "free",
              payment_unit: "per_participant",
            },
          },
        ]);
      }
      return makeQueryChain(null);
    };

    mockRpcHandler = (funcName: string) => {
      if (funcName === "register_participant_events") {
        return Promise.resolve({
          data: [
            {
              participant_id: "SVK26-ABC12345",
              participant_event_id: "pe-uuid-1",
              event_id: eventUuid,
              event_name: "Code Circuit",
              status: "registered",
              payment_order_id: null,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    const req = new NextRequest("http://localhost:3000/api/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "content-length": "500",
      },
      body: JSON.stringify({
        email: "delegate@cgc.edu.in",
        name: "Delegate CGC",
        college: "CGC University Mohali",
        phone: "9876543210",
        idCardStoragePath: "delegate@cgc.edu.in/id-card.jpg",
        events: [
          {
            eventId: eventUuid,
            team: null,
            isTeamHead: false,
            members: [],
          },
        ],
        accommodations: [],
      }),
    });

    const res = await postRegister(req);
    const data = await res.json();
    expect([200, 201]).toContain(res.status);
    expect(data.success).toBe(true);
  });

  it("blocks POST /api/team/accommodation when locked with HTTP 403 ACCOMMODATION_LOCKED", async () => {
    __setTestSiteAccess({ ACCOMMODATION_ENABLED: false });

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "leader@cgc.edu.in",
    });

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantEventId: "00000000-0000-0000-0000-000000000001",
        bookings: [
          {
            email: "member@cgc.edu.in",
            planSlug: "2_days",
            selectedDate: "2026-10-28",
            extraDays: "none",
          },
        ],
      }),
    });

    const res = await postTeamAccommodation(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("ACCOMMODATION_LOCKED");
  });

  it("blocks POST /api/accommodations/book alias route when locked with HTTP 403 ACCOMMODATION_LOCKED", async () => {
    __setTestSiteAccess({ ACCOMMODATION_ENABLED: false });

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "leader@cgc.edu.in",
    });

    const req = new NextRequest("http://localhost:3000/api/accommodations/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookings: [
          {
            email: "solo@cgc.edu.in",
            planSlug: "1_day",
            selectedDate: "2026-10-28",
            extraDays: "none",
          },
        ],
      }),
    });

    const res = await postAccommodationsBook(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("ACCOMMODATION_LOCKED");
  });
});

describe("Phase 1: Accommodation Access Lock — Option A Payment Lifecycle", () => {
  const lockEffectiveTime = new Date("2026-10-26T12:00:00Z").toISOString();
  const preLockOrderTime = new Date("2026-10-26T11:30:00Z").toISOString(); // 30 mins before lock
  const postLockOrderTime = new Date("2026-10-26T12:15:00Z").toISOString(); // 15 mins after lock

  beforeEach(() => {
    clearSiteAccessCache();
    __setTestSiteAccess({ ACCOMMODATION_ENABLED: false }, lockEffectiveTime);
    mockAuditLogInsert = null;
    mockRpcHandler = null;
    mockFromHandler = null;
    vi.restoreAllMocks();
  });

  it("allows valid pre-lock pending accommodation order to proceed to checkout", async () => {
    const testNow = new Date("2026-10-26T11:45:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(testNow);

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "payer@cgc.edu.in",
    });

    mockFromHandler = (table: string) => {
      if (table === "payment_orders") {
        return makeQueryChain({
          id: "order-prelock-1",
          order_reference: "SVK-PRELOCK-1",
          payer_participant_id: "participant-uuid-1",
          amount: 999,
          currency: "INR",
          gateway: "payu",
          gateway_order_id: null,
          status: "pending",
          created_at: preLockOrderTime,
          updated_at: preLockOrderTime,
        });
      }
      if (table === "participants") {
        return makeQueryChain({
          id: "participant-uuid-1",
          participant_id: "SVK26-PAYER001",
          name: "Pre-lock Payer",
          email: "payer@cgc.edu.in",
          phone: "9876543210",
        });
      }
      if (table === "payment_order_items") {
        return makeQueryChain([
          {
            id: "item-1",
            participant_id: "participant-uuid-1",
            participant_event_id: null,
            participant_accommodation_id: "acc-booking-uuid-1",
            amount: 999,
          },
        ]);
      }
      return makeQueryChain(null);
    };

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "saviskar.co.in",
      },
      body: JSON.stringify({ paymentOrderId: "order-prelock-1" }),
    });

    const res = await postPaymentCreate(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.paymentOrderId).toBe("order-prelock-1");
  });

  it("blocks accommodation order created after lock timestamp from checkout", async () => {
    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "payer@cgc.edu.in",
    });

    mockFromHandler = (table: string) => {
      if (table === "payment_orders") {
        return makeQueryChain({
          id: "order-postlock-1",
          order_reference: "SVK-POSTLOCK-1",
          payer_participant_id: "participant-uuid-1",
          amount: 999,
          currency: "INR",
          gateway: null,
          gateway_order_id: null,
          status: "pending",
          created_at: postLockOrderTime,
        });
      }
      if (table === "participants") {
        return makeQueryChain({
          id: "participant-uuid-1",
          participant_id: "SVK26-PAYER001",
          name: "Post-lock Payer",
          email: "payer@cgc.edu.in",
        });
      }
      if (table === "payment_order_items") {
        return makeQueryChain([
          {
            id: "item-1",
            participant_id: "participant-uuid-1",
            participant_accommodation_id: "acc-booking-uuid-1",
            amount: 999,
          },
        ]);
      }
      return makeQueryChain(null);
    };

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "saviskar.co.in",
      },
      body: JSON.stringify({ paymentOrderId: "order-postlock-1" }),
    });

    const res = await postPaymentCreate(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("ACCOMMODATION_LOCKED");
  });

  it("blocks expired pre-lock accommodation hold from checkout", async () => {
    const testNow = new Date("2026-10-26T14:30:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(testNow);

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "payer@cgc.edu.in",
    });

    mockFromHandler = (table: string) => {
      if (table === "payment_orders") {
        return makeQueryChain({
          id: "order-prelock-expired",
          order_reference: "SVK-EXPIRED-1",
          payer_participant_id: "participant-uuid-1",
          amount: 999,
          currency: "INR",
          gateway: null,
          gateway_order_id: null,
          status: "pending",
          created_at: preLockOrderTime,
        });
      }
      if (table === "participants") {
        return makeQueryChain({
          id: "participant-uuid-1",
          participant_id: "SVK26-PAYER001",
          name: "Expired Payer",
          email: "payer@cgc.edu.in",
        });
      }
      if (table === "payment_order_items") {
        return makeQueryChain([
          {
            id: "item-1",
            participant_id: "participant-uuid-1",
            participant_accommodation_id: "acc-booking-uuid-1",
            amount: 999,
          },
        ]);
      }
      return makeQueryChain(null);
    };

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "saviskar.co.in",
      },
      body: JSON.stringify({ paymentOrderId: "order-prelock-expired" }),
    });

    const res = await postPaymentCreate(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("ACCOMMODATION_LOCKED");
    expect(data.error).toContain("hold has expired");
  });

  it("blocks payment recovery from generating a new payment order for an accommodation when locked", async () => {
    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "payer@cgc.edu.in",
    });

    let accCallCount = 0;
    mockFromHandler = (table: string) => {
      if (table === "participant_accommodations") {
        accCallCount++;
        if (accCallCount === 1) {
          return makeQueryChain({
            id: "acc-booking-uuid-1",
            status: "pending",
            amount: 999,
            payment_order_id: null,
            start_date: "2026-10-28",
            end_date: "2026-10-30",
            participants: {
              id: "participant-uuid-1",
              participant_id: "SVK26-PAYER001",
              email: "payer@cgc.edu.in",
            },
          });
        }
        return makeQueryChain(null);
      }
      if (table === "payment_order_items") {
        return makeQueryChain(null);
      }
      return makeQueryChain(null);
    };

    const req = new NextRequest("http://localhost:3000/api/payments/recover", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "saviskar.co.in",
      },
      body: JSON.stringify({
        participantId: "SVK26-PAYER001",
        participantAccommodationId: "acc-booking-uuid-1",
      }),
    });

    const res = await postPaymentRecover(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("ACCOMMODATION_LOCKED");
  });
});
