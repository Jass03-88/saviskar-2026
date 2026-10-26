import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  DEFAULT_SITE_ACCESS,
  SITE_PAGE_DEFINITIONS,
  clearSiteAccessCache,
  __setTestSiteAccess,
  getSiteAccessState,
  getSiteAccess,
} from "@/lib/config/site-access";
import * as serverLib from "@/lib/supabase/server";
import * as authSessionLib from "@/lib/auth/session";
import { createPaymentResumeToken } from "@/lib/payments/resume-token";
import * as rateLimitLib from "@/lib/rate-limit";
import { PATCH as patchSiteAccessApi } from "@/app/api/admin/site-access/route";
import { POST as postRegister } from "@/app/api/register/route";
import { POST as postRequestOtp } from "@/app/api/auth/request-otp/route";
import { POST as postVerifyOtp } from "@/app/api/auth/verify-otp/route";
import { POST as postPaymentCreate } from "@/app/api/payments/create/route";
import { POST as postPaymentRecover } from "@/app/api/payments/recover/route";
import { POST as postTeamAccommodation } from "@/app/api/team/accommodation/route";

vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return {
    ...mod,
    after: vi.fn(() => {}),
  };
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-test.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";
process.env.TEST_LIVE_DB = "true";
process.env.PAYU_KEY = "test-payu-key";
process.env.PAYU_SALT = "test-payu-salt";
process.env.PAYU_ENVIRONMENT = "test";
process.env.RESUME_TOKEN_SECRET = "test-resume-token-secret-must-be-32-chars-long";

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

let mockRpcHandler: ((name: string, params: any) => Promise<{ data: any; error: any }>) | null = null;
let mockFromHandler: ((table: string) => any) | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (mockFromHandler) {
        return mockFromHandler(table);
      }
      return makeQueryChain(null);
    },
    rpc: (name: string, params: any) => {
      if (mockRpcHandler) return mockRpcHandler(name, params);
      if (name === "update_site_page_locks") {
        return Promise.resolve({ data: { success: true, audit_id: "mock-audit-uuid" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

describe("Phase 2: Temporary Registration-Form Lock Architecture", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearSiteAccessCache();
    __setTestSiteAccess(null);
    mockRpcHandler = null;
    mockFromHandler = null;

    vi.spyOn(rateLimitLib, "getClientIp").mockReturnValue("127.0.0.1");
    vi.spyOn(rateLimitLib, "checkRateLimitAsync").mockResolvedValue({
      allowed: true,
      retryAfter: 0,
    });
  });

  // 1. Defaults verification
  it("1. Registration lock defaults to enabled/open in DEFAULT_SITE_ACCESS", () => {
    expect(DEFAULT_SITE_ACCESS.REGISTRATIONS_ENABLED).toBe(true);
    expect(DEFAULT_SITE_ACCESS.REGISTRATION_ENABLED).toBe(true);
    expect("REGISTRATIONS_ENABLED" in SITE_PAGE_DEFINITIONS).toBe(true);
    expect("REGISTRATION_ENABLED" in SITE_PAGE_DEFINITIONS).toBe(true);
  });

  // 2. Primary master admin lock & unlock
  it("2. Primary master admin can lock and unlock registration via atomic route", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      authorized: true,
      user: { id: "master-uuid", email: "jashandeep00030@gmail.com" } as any,
    } as any);

    let recordedDetails: any = null;
    mockRpcHandler = async (name, params) => {
      if (name === "update_site_page_locks") {
        recordedDetails = params.p_details;
        return { data: { success: true, audit_id: "audit-123" }, error: null };
      }
      return { data: null, error: null };
    };

    // Lock registration
    const lockReq = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      body: JSON.stringify({ key: "REGISTRATION_ENABLED", enabled: false }),
      headers: { "Content-Type": "application/json" },
    });
    const lockRes = await patchSiteAccessApi(lockReq);
    const lockData = await lockRes.json();

    expect(lockRes.status).toBe(200);
    expect(lockData.success).toBe(true);
    expect(lockData.siteAccess.REGISTRATION_ENABLED).toBe(false);
    expect(lockData.siteAccess.REGISTRATIONS_ENABLED).toBe(false);
    expect(recordedDetails.lock_timestamps.REGISTRATION_ENABLED).toBeTruthy();
    expect(recordedDetails.registration_locked_at).toBeTruthy();

    // Unlock registration
    const unlockReq = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      body: JSON.stringify({ key: "REGISTRATION_ENABLED", enabled: true }),
      headers: { "Content-Type": "application/json" },
    });
    const unlockRes = await patchSiteAccessApi(unlockReq);
    const unlockData = await unlockRes.json();

    expect(unlockRes.status).toBe(200);
    expect(unlockData.success).toBe(true);
    expect(unlockData.siteAccess.REGISTRATION_ENABLED).toBe(true);
    expect(unlockData.siteAccess.REGISTRATIONS_ENABLED).toBe(true);
    expect(recordedDetails.lock_timestamps.REGISTRATION_ENABLED).toBeNull();
    expect(recordedDetails.registration_locked_at).toBeNull();
  });

  // 3. Unauthorized users cannot modify lock
  it("3. Unauthorized users cannot modify the registration lock", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      authorized: false,
      status: 403,
      error: "Master admin privileges required.",
    } as any);

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      body: JSON.stringify({ key: "REGISTRATION_ENABLED", enabled: false }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchSiteAccessApi(req);
    expect(res.status).toBe(403);
  });

  // 4. Registration and accommodation locks operate independently
  it("4. Registration lock and accommodation lock operate independently", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      authorized: true,
      user: { id: "master-uuid", email: "jashandeep00030@gmail.com" } as any,
    } as any);

    const fixedAccLockTime = "2026-10-26T20:00:00.000Z";
    let lastRecordedDetails: any = null;

    mockRpcHandler = async (name, params) => {
      if (name === "update_site_page_locks") {
        lastRecordedDetails = params.p_details;
        return { data: { success: true, audit_id: "audit-test" }, error: null };
      }
      return { data: null, error: null };
    };

    // First, lock accommodation
    __setTestSiteAccess({ ACCOMMODATION_ENABLED: false }, fixedAccLockTime, null);

    // Now, lock registration via PATCH
    const lockRegReq = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      body: JSON.stringify({ key: "REGISTRATION_ENABLED", enabled: false }),
      headers: { "Content-Type": "application/json" },
    });
    const lockRegRes = await patchSiteAccessApi(lockRegReq);
    expect(lockRegRes.status).toBe(200);

    // Verify accommodation lock timestamp was PRESERVED and not overwritten
    expect(lastRecordedDetails.lock_timestamps.ACCOMMODATION_ENABLED).toBe(fixedAccLockTime);
    expect(lastRecordedDetails.accommodation_locked_at).toBe(fixedAccLockTime);
    // Verify registration lock timestamp was freshly recorded
    expect(lastRecordedDetails.lock_timestamps.REGISTRATION_ENABLED).toBeTruthy();
    expect(lastRecordedDetails.registration_locked_at).toBeTruthy();
  });

  // 5. New users blocked while registration locked
  it("5. New users are blocked from registering while registration is locked", async () => {
    __setTestSiteAccess({ REGISTRATION_ENABLED: false, REGISTRATIONS_ENABLED: false });

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "newuser@test.edu",
    } as any);

    const req = new NextRequest("http://localhost:3000/api/register", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Participant",
        email: "newuser@test.edu",
        events: [{ eventId: "e1" }],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postRegister(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe("REGISTRATION_LOCKED");
    expect(data.error).toContain("Participant registration is temporarily paused");
  });

  // 6. Returning users cannot submit new registrations while locked
  it("6. Returning users are blocked from creating registrations while registration is locked", async () => {
    __setTestSiteAccess({ REGISTRATION_ENABLED: false, REGISTRATIONS_ENABLED: false });

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "existing@test.edu",
    } as any);

    const req = new NextRequest("http://localhost:3000/api/register", {
      method: "POST",
      body: JSON.stringify({
        participantId: "SVK26-TESTUSER",
        email: "existing@test.edu",
        events: [{ eventId: "e2" }],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postRegister(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe("REGISTRATION_LOCKED");
  });

  // 7. OTP verification / continuation blocked
  it("7. OTP request and verification cannot bypass registration lock", async () => {
    __setTestSiteAccess({ REGISTRATION_ENABLED: false, REGISTRATIONS_ENABLED: false });

    // Try requesting OTP
    const reqOtp = new NextRequest("http://localhost:3000/api/auth/request-otp", {
      method: "POST",
      body: JSON.stringify({ email: "student@test.edu" }),
      headers: { "Content-Type": "application/json" },
    });
    const resOtp = await postRequestOtp(reqOtp);
    const dataOtp = await resOtp.json();

    expect(resOtp.status).toBe(403);
    expect(dataOtp.code).toBe("REGISTRATION_LOCKED");
    expect(dataOtp.error).toContain("Participant registration is temporarily paused");

    // Try verifying OTP
    const verifyOtpReq = new NextRequest("http://localhost:3000/api/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email: "student@test.edu", otp: "123456" }),
      headers: { "Content-Type": "application/json" },
    });
    const verifyOtpRes = await postVerifyOtp(verifyOtpReq);
    const verifyOtpData = await verifyOtpRes.json();

    expect(verifyOtpRes.status).toBe(403);
    expect(verifyOtpData.code).toBe("REGISTRATION_LOCKED");
  });

  // 8. Direct API requests and team accommodation blocked
  it("8. Direct API requests and team accommodation are blocked while registration is locked", async () => {
    __setTestSiteAccess({ REGISTRATION_ENABLED: false, REGISTRATIONS_ENABLED: false });

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "leader@test.edu",
    } as any);

    const req = new NextRequest("http://localhost:3000/api/team/accommodation", {
      method: "POST",
      body: JSON.stringify({
        participantEventId: "pe-uuid-1",
        members: [{ email: "member1@test.edu", planSlug: "2_days" }],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postTeamAccommodation(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe("REGISTRATION_LOCKED");
  });

  // 9. Payment creation blocked for registration orders created after lock
  it("9. New payment initiation is blocked for registration orders created after lock", async () => {
    const lockTime = new Date("2026-10-27T01:00:00Z").toISOString();
    __setTestSiteAccess({ REGISTRATION_ENABLED: false, REGISTRATIONS_ENABLED: false }, null, lockTime);

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "payer@cgc.edu.in",
    } as any);

    mockFromHandler = (table: string) => {
      if (table === "payment_orders") {
        return makeQueryChain({
          id: "po-1",
          order_reference: "SVK-ORDER-1",
          status: "pending",
          payer_participant_id: "p-uuid-1",
          amount: 500,
          created_at: new Date("2026-10-27T02:00:00Z").toISOString(), // created AFTER lock
        });
      }
      if (table === "participants") {
        return makeQueryChain({
          id: "p-uuid-1",
          participant_id: "SVK26-TEST",
          email: "payer@cgc.edu.in",
        });
      }
      if (table === "payment_order_items") {
        return makeQueryChain([
          {
            id: "poi-1",
            payment_order_id: "po-1",
            participant_id: "p-uuid-1",
            participant_event_id: "pe-1", // registration item
            participant_accommodation_id: null,
          },
        ]);
      }
      return makeQueryChain(null);
    };

    const req = new NextRequest("http://localhost:3000/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ paymentOrderId: "po-1" }),
      headers: { "Content-Type": "application/json", host: "saviskar.co.in" },
    });

    const res = await postPaymentCreate(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe("REGISTRATION_LOCKED");
    expect(data.error).toContain("Participant registration is temporarily paused");
  });

  // 10. Legitimate pre-lock Option A registration payment recovery
  it("10. Legitimate pre-lock registration payments within hold window can be resumed", async () => {
    const lockTime = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // locked 2m ago
    __setTestSiteAccess({ REGISTRATION_ENABLED: false, REGISTRATIONS_ENABLED: false }, null, lockTime);

    const orderTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // ordered 5m ago (BEFORE lock, within 15m hold)
    const eventUuid = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

    mockFromHandler = (table: string) => {
      if (table === "participants") {
        return makeQueryChain({
          id: "p-uuid-1",
          participant_id: "SVK26-LEGIT",
          email: "legit@test.edu",
        });
      }
      if (table === "participant_events") {
        return makeQueryChain({
          id: "pe-1",
          payment_status: "pending",
          event_id: eventUuid,
          payment_amount: 400,
          participants: {
            id: "p-uuid-1",
            participant_id: "SVK26-LEGIT",
            email: "legit@test.edu",
          },
          events: {
            payment_type: "paid",
          },
        });
      }
      if (table === "payment_order_items") {
        return makeQueryChain({
          payment_order_id: "po-legit",
          participant_id: "p-uuid-1",
          payment_orders: {
            id: "po-legit",
            status: "pending",
            payer_participant_id: "p-uuid-1",
            amount: 400,
            created_at: orderTime,
          },
        });
      }
      return makeQueryChain(null);
    };

    const resumeToken = createPaymentResumeToken({
      paymentOrderId: "po-legit",
      participantId: "SVK26-LEGIT",
      payerParticipantUuid: "p-uuid-1",
    });

    const req = new NextRequest("http://localhost:3000/api/payments/recover", {
      method: "POST",
      body: JSON.stringify({
        participantId: "SVK26-LEGIT",
        participantEventId: "pe-1",
        resumeToken,
      }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postPaymentRecover(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.paymentOrderId).toBe("po-legit");
  });

  // 11. Missing RPC fails closed without silent fallback
  it("11. Missing RPC failure (PGRST202) fails closed and does not report success", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      authorized: true,
      user: { id: "master-uuid", email: "jashandeep00030@gmail.com" } as any,
    } as any);

    mockRpcHandler = async (name) => {
      if (name === "update_site_page_locks") {
        return {
          data: null,
          error: { code: "PGRST202", message: "function update_site_page_locks does not exist" },
        };
      }
      return { data: null, error: null };
    };

    const req = new NextRequest("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      body: JSON.stringify({ key: "REGISTRATION_ENABLED", enabled: false }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await patchSiteAccessApi(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe("Atomic site page lock service is unavailable. Please verify database migrations.");
  });

  // 12. Accommodation lock concurrency/recovery tests continue to pass
  it("12. Accommodation lock operates properly when registration lock is active", async () => {
    __setTestSiteAccess({ REGISTRATION_ENABLED: false, ACCOMMODATION_ENABLED: false });

    const state = await getSiteAccessState();
    expect(state.locks.REGISTRATION_ENABLED).toBe(false);
    expect(state.locks.ACCOMMODATION_ENABLED).toBe(false);
    expect(state.locks.SPONSORS_ENABLED).toBe(true);
  });

  // 13. Admin access remains available even while registration is locked
  it("13. Primary master admin can view site access state while registration is locked", async () => {
    __setTestSiteAccess({ REGISTRATION_ENABLED: false, REGISTRATIONS_ENABLED: false });

    const access = await getSiteAccess();
    expect(access.REGISTRATION_ENABLED).toBe(false);
    expect(access.REGISTRATIONS_ENABLED).toBe(false);
    expect(access.TEAM_ENABLED).toBe(true);
    expect(access.STARNIGHT_ENABLED).toBe(true);
  });

  // 14. Unlocking registration restores registration flow
  it("14. Unlocking registration restores normal registration flow", async () => {
    __setTestSiteAccess({ REGISTRATION_ENABLED: true, REGISTRATIONS_ENABLED: true });

    vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
      authenticated: true,
      email: "openuser@test.edu",
    } as any);

    const eventUuid = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

    mockRpcHandler = async (name) => {
      if (name === "register_participant_events") {
        return {
          data: [
            {
              participant_id: "SVK26-OPEN",
              participant_event_id: "pe-open-1",
              event_id: eventUuid,
              event_name: "Open Event",
              status: "added",
              payment_order_id: "po-open-1",
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    };

    mockFromHandler = (table: string) => {
      if (table === "participants") {
        return makeQueryChain({
          id: "p-open-uuid",
          participant_id: "SVK26-OPEN",
          email: "openuser@test.edu",
        });
      }
      if (table === "payment_orders") {
        return makeQueryChain({
          id: "po-open-1",
          order_reference: "ORD-OPEN-1",
          amount: 200,
          currency: "INR",
          status: "pending",
        });
      }
      if (table === "participant_events") {
        return makeQueryChain([
          {
            id: "pe-open-1",
            participant_id: "p-open-uuid",
            event_id: eventUuid,
            registration_status: "pending",
            payment_status: "pending",
            payment_amount: 200,
            payment_id: null,
            team_name: null,
            checked_in: false,
            checked_in_at: null,
            events: {
              id: eventUuid,
              name: "Open Event",
              category: "Tech",
              registration_type: "individual",
              registration_fee: 200,
              payment_type: "paid",
              payment_unit: "per_head",
            },
          },
        ]);
      }
      return makeQueryChain(null);
    };

    const req = new NextRequest("http://localhost:3000/api/register", {
      method: "POST",
      body: JSON.stringify({
        name: "Open Participant",
        college: "CGC Landran",
        email: "openuser@test.edu",
        phone: "9876543210",
        idCardStoragePath: "openuser@test.edu/id.jpg",
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
      headers: { "Content-Type": "application/json" },
    });

    const res = await postRegister(req);
    const data = await res.json();

    expect([200, 201]).toContain(res.status);
    expect(data.success).toBe(true);
    expect(data.participantId).toBe("SVK26-OPEN");
  });
});
