import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isAdminSessionExpired,
  getAdminSessionMaxAgeSeconds,
  DEFAULT_ADMIN_SESSION_MAX_AGE_SECONDS,
  toAdminSessionCookieOptions,
  isLocalDevelopmentMfaBypassAllowed,
} from "@/lib/supabase/admin-session";
import {
  adminBrowserCookieMethods,
  parseBrowserCookies,
  serializeBrowserCookie,
} from "@/lib/supabase/client";
import {
  createRegistrationSessionToken,
  verifyRegistrationSessionToken,
  DEFAULT_SESSION_EXP_MS,
} from "@/lib/auth/session";
import * as serverLib from "@/lib/supabase/server";
import { updateSession } from "@/lib/supabase/proxy";
import { NextRequest } from "next/server";
import { GET as getAdminSession } from "@/app/api/admin/session/route";
import { POST as postCheckIn } from "@/app/api/admin/check-in/route";

// Shared builder for DB queries in server client
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn().mockReturnThis();
const mockEq = vi.fn().mockReturnThis();

const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  eq: mockEq,
  maybeSingle: mockMaybeSingle,
});

const mockGetUser = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockGetAAL = vi.fn();

const mockServerClient = {
  auth: {
    getUser: mockGetUser,
    signOut: mockSignOut,
    mfa: {
      getAuthenticatorAssuranceLevel: mockGetAAL,
    },
  },
  from: mockFrom,
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => mockServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockReturnValue([]),
    setAll: vi.fn(),
  }),
}));

describe("Admin Session Expiration and Lifecycle Authority", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.ADMIN_SESSION_MAX_AGE_SECONDS;
    delete process.env.PRIMARY_ADMIN_USER_ID;

    mockSelect.mockReturnThis();
    mockEq.mockReturnThis();
    mockMaybeSingle.mockResolvedValue({
      data: { user_id: "admin-uuid-1", role: "admin" },
      error: null,
    });
    mockGetAAL.mockResolvedValue({
      data: { currentLevel: "aal2" },
      error: null,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Configuration & Helper (isAdminSessionExpired)", () => {
    it("defaults to 28,800 seconds (8 hours) when env var is unset", () => {
      expect(getAdminSessionMaxAgeSeconds()).toBe(DEFAULT_ADMIN_SESSION_MAX_AGE_SECONDS);
      expect(DEFAULT_ADMIN_SESSION_MAX_AGE_SECONDS).toBe(28800);
    });

    it("respects valid ADMIN_SESSION_MAX_AGE_SECONDS environment variable", () => {
      process.env.ADMIN_SESSION_MAX_AGE_SECONDS = "14400";
      expect(getAdminSessionMaxAgeSeconds()).toBe(14400);
    });

    it("falls back to default if ADMIN_SESSION_MAX_AGE_SECONDS is invalid or negative", () => {
      process.env.ADMIN_SESSION_MAX_AGE_SECONDS = "invalid";
      expect(getAdminSessionMaxAgeSeconds()).toBe(28800);

      process.env.ADMIN_SESSION_MAX_AGE_SECONDS = "-500";
      expect(getAdminSessionMaxAgeSeconds()).toBe(28800);
    });

    it("rejects null or undefined user as expired (fail closed)", () => {
      expect(isAdminSessionExpired(null)).toBe(true);
      expect(isAdminSessionExpired(undefined)).toBe(true);
    });

    it("rejects user with missing or empty last_sign_in_at as expired", () => {
      expect(isAdminSessionExpired({ last_sign_in_at: null })).toBe(true);
      expect(isAdminSessionExpired({ last_sign_in_at: undefined })).toBe(true);
      expect(isAdminSessionExpired({ last_sign_in_at: "" })).toBe(true);
      expect(isAdminSessionExpired({ last_sign_in_at: "invalid-date" })).toBe(true);
    });

    it("rejects future-dated last_sign_in_at exceeding 60s clock skew", () => {
      const farFuture = new Date(Date.now() + 120_000).toISOString();
      expect(isAdminSessionExpired({ last_sign_in_at: farFuture })).toBe(true);
    });
  });

  describe("14 Mandatory Session Lifecycle Invariants", () => {
    // 1. Valid admin session is accepted
    it("1. valid admin session is accepted within max lifetime", async () => {
      const recentSignIn = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 mins ago
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: "admin-uuid-1",
            email: "admin@example.com",
            last_sign_in_at: recentSignIn,
          },
        },
        error: null,
      });

      const auth = await serverLib.requireAdmin();
      expect(auth.error).toBe(null);
      expect(auth.status).toBe(200);
      expect(auth.role).toBe("admin");
      expect(auth.user?.id).toBe("admin-uuid-1");
    });

    // 2. Expired admin session is rejected
    it("2. expired admin session is rejected authoritatively by requireAdmin", async () => {
      const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: "admin-uuid-1",
            email: "admin@example.com",
            last_sign_in_at: nineHoursAgo,
          },
        },
        error: null,
      });

      const auth = await serverLib.requireAdmin();
      expect(auth.status).toBe(401);
      expect(auth.error).toBe("Session expired");
      expect(auth.user).toBe(null);
      expect(auth.role).toBe(null);
      expect(mockSignOut).toHaveBeenCalled();
    });

    // 3. Expired admin session cannot access protected admin API
    it("3. expired admin session cannot access protected admin API (/api/admin/session)", async () => {
      const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: "admin-uuid-1",
            email: "admin@example.com",
            last_sign_in_at: nineHoursAgo,
          },
        },
        error: null,
      });

      const res = await getAdminSession();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.authenticated).toBe(false);
      expect(json.error).toBe("Session expired");
    });

    // 4. Expired admin session cannot perform admin mutation
    it("4. expired admin session cannot perform admin mutation (check-in)", async () => {
      const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: "admin-uuid-1",
            email: "admin@example.com",
            last_sign_in_at: tenHoursAgo,
          },
        },
        error: null,
      });

      const req = new NextRequest("http://localhost/api/admin/check-in", {
        method: "POST",
        body: JSON.stringify({ participantEventId: "pe-123", action: "check_in" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postCheckIn(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Session expired");
    });

    // 5. Manual logout still invalidates the session
    it("5. manual logout invalidates the session (user is null)", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const auth = await serverLib.requireAdmin();
      expect(auth.status).toBe(401);
      expect(auth.error).toBe("Unauthorized");
    });

    // 6. Primary Master authorization remains unchanged
    it("6. Primary Master authorization remains strictly enforced via PRIMARY_ADMIN_USER_ID", async () => {
      process.env.PRIMARY_ADMIN_USER_ID = "primary-uuid";
      const validSignIn = new Date().toISOString();

      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "primary-uuid", email: "primary@example.com", last_sign_in_at: validSignIn },
        },
        error: null,
      });
      mockMaybeSingle.mockResolvedValue({
        data: { user_id: "primary-uuid", role: "master" },
        error: null,
      });

      const auth = await serverLib.requireSuperMasterAdmin();
      expect(auth.error).toBe(null);
      expect(auth.status).toBe(200);

      // Non-primary master fails
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "other-master-uuid", email: "other@example.com", last_sign_in_at: validSignIn },
        },
        error: null,
      });
      mockMaybeSingle.mockResolvedValue({
        data: { user_id: "other-master-uuid", role: "master" },
        error: null,
      });

      const otherAuth = await serverLib.requireSuperMasterAdmin();
      expect(otherAuth.status).toBe(403);
      expect(otherAuth.error).toBe("Super Master Admin access required");
    });

    // 7. Master authorization remains unchanged
    it("7. Master authorization remains enforced (role=master required)", async () => {
      const validSignIn = new Date().toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "normal-admin", email: "normal@example.com", last_sign_in_at: validSignIn },
        },
        error: null,
      });
      mockMaybeSingle.mockResolvedValue({
        data: { user_id: "normal-admin", role: "admin" },
        error: null,
      });

      const auth = await serverLib.requireMasterAdmin();
      expect(auth.status).toBe(403);
      expect(auth.error).toBe("Master Admin access required");
    });

    // 8. Normal admin authorization remains unchanged
    it("8. Normal admin authorization remains valid for general admin access", async () => {
      const validSignIn = new Date().toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "normal-admin", email: "normal@example.com", last_sign_in_at: validSignIn },
        },
        error: null,
      });
      mockMaybeSingle.mockResolvedValue({
        data: { user_id: "normal-admin", role: "admin" },
        error: null,
      });

      const auth = await serverLib.requireAdmin();
      expect(auth.error).toBe(null);
      expect(auth.status).toBe(200);
      expect(auth.role).toBe("admin");
    });

    // 9. Master MFA/AAL2 requirement remains enforced
    it("9. Master MFA/AAL2 requirement remains strictly enforced", async () => {
      const validSignIn = new Date().toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "master-user", email: "master@example.com", last_sign_in_at: validSignIn },
        },
        error: null,
      });
      mockMaybeSingle.mockResolvedValue({
        data: { user_id: "master-user", role: "master" },
        error: null,
      });
      mockGetAAL.mockResolvedValue({
        data: { currentLevel: "aal1" }, // Insufficient MFA level
        error: null,
      });

      const auth = await serverLib.requireAdmin();
      expect(auth.status).toBe(403);
      expect(auth.error).toBe("MFA_REQUIRED");
    });

    // 10. Normal Supabase session handling still works
    it("10. normal Supabase session handling proceeds normally when unexpired", async () => {
      const validSignIn = new Date(Date.now() - 60_000).toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "admin-1", email: "a@b.com", last_sign_in_at: validSignIn },
        },
        error: null,
      });
      mockMaybeSingle.mockResolvedValue({
        data: { user_id: "admin-1", role: "admin" },
        error: null,
      });

      const auth = await serverLib.requireAdmin();
      expect(auth.status).toBe(200);
      expect(auth.error).toBe(null);
    });

    // 11. Session refresh cannot extend an admin session beyond maximum lifetime
    it("11. session refresh cannot extend an admin session beyond the configured maximum lifetime", async () => {
      // Scenario: User signed in 9 hours ago.
      // Background Supabase SSR refreshed tokens (so token was issued recently),
      // BUT last_sign_in_at remains 9 hours ago.
      process.env.ADMIN_SESSION_MAX_AGE_SECONDS = "28800"; // 8 hours
      const nineHoursAgo = new Date(Date.now() - 9 * 3600 * 1000).toISOString();

      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: "admin-refreshed",
            email: "refreshed@example.com",
            last_sign_in_at: nineHoursAgo, // Original sign-in timestamp does not advance on refresh
          },
        },
        error: null,
      });

      const auth = await serverLib.requireAdmin();
      expect(auth.status).toBe(401);
      expect(auth.error).toBe("Session expired");

      // Middleware check also rejects
      const req = new NextRequest("http://localhost/admin/events");
      const res = await updateSession(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/admin/login");
    });

    // 12. No client-side-only timeout is relied upon for security
    it("12. server authorization enforces expiration independently of client environment", async () => {
      // Directly invoking server API functions without client context
      const expiredTime = new Date(Date.now() - 30_000_000).toISOString(); // ~8.3 hours
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "hacker-client", email: "hacker@example.com", last_sign_in_at: expiredTime },
        },
        error: null,
      });

      const auth = await serverLib.requireAdmin();
      expect(auth.status).toBe(401);
      expect(auth.error).toBe("Session expired");
    });

    // 13. Unauthenticated users are redirected to the existing admin login
    it("13. unauthenticated users in proxy are redirected to /admin/login", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const req = new NextRequest("http://localhost/admin/registrations");
      const res = await updateSession(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/admin/login");
    });

    // 14. Multiple requests after expiry remain rejected
    it("14. multiple consecutive requests after expiry remain consistently rejected", async () => {
      const expiredTime = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "expired-user", email: "exp@example.com", last_sign_in_at: expiredTime },
        },
        error: null,
      });

      for (let i = 0; i < 5; i++) {
        const auth = await serverLib.requireAdmin();
        expect(auth.status).toBe(401);
        expect(auth.error).toBe("Session expired");
      }
    });
  });

  describe("Browser-Session Scoped Authentication Policy & Invariants", () => {
    describe("Cookie Option Transformer (toAdminSessionCookieOptions)", () => {
      it("strips maxAge and expires from persistent cookie options to create session cookie", () => {
        const persistentOptions = {
          path: "/",
          sameSite: "lax" as const,
          httpOnly: true,
          secure: true,
          maxAge: 400 * 24 * 60 * 60, // 400 days default from @supabase/ssr
          expires: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
        };

        const sessionOptions = toAdminSessionCookieOptions(persistentOptions);
        expect(sessionOptions.maxAge).toBeUndefined();
        expect(sessionOptions.expires).toBeUndefined();
        expect(sessionOptions.path).toBe("/");
        expect(sessionOptions.sameSite).toBe("lax");
        expect(sessionOptions.httpOnly).toBe(true);
        expect(sessionOptions.secure).toBe(true);
      });

      it("preserves maxAge: 0 for cookie deletion so logout and expiration clear cookies", () => {
        const deletionOptions = {
          path: "/",
          sameSite: "lax" as const,
          maxAge: 0,
        };

        const result = toAdminSessionCookieOptions(deletionOptions);
        expect(result.maxAge).toBe(0);
        expect(result.path).toBe("/");
      });

      it("preserves negative maxAge for cookie deletion", () => {
        const deletionOptions = {
          path: "/",
          maxAge: -1,
        };

        const result = toAdminSessionCookieOptions(deletionOptions);
        expect(result.maxAge).toBe(-1);
      });

      it("safely returns undefined when options are undefined", () => {
        expect(toAdminSessionCookieOptions(undefined)).toBeUndefined();
      });
    });

    describe("Browser Cookie Parser and Serializer (lib/supabase/client)", () => {
      it("serializeBrowserCookie outputs cookie without Max-Age or Expires for session-scoped cookies", () => {
        const serialized = serializeBrowserCookie("sb-auth-token", "jwt-token-value", {
          path: "/",
          sameSite: "lax",
          secure: false,
        });

        expect(serialized).toContain("sb-auth-token=jwt-token-value");
        expect(serialized).toContain("Path=/");
        expect(serialized).toContain("SameSite=Lax");
        expect(serialized).not.toContain("Max-Age");
        expect(serialized).not.toContain("Expires");
      });

      it("serializeBrowserCookie preserves Max-Age=0 when explicitly deleting a cookie", () => {
        const serialized = serializeBrowserCookie("sb-auth-token", "", {
          path: "/",
          maxAge: 0,
        });

        expect(serialized).toContain("sb-auth-token=");
        expect(serialized).toContain("Max-Age=0");
        expect(serialized).toContain("Path=/");
      });

      it("parseBrowserCookies correctly extracts key-value pairs from cookie string", () => {
        const raw = "sb-access-token=token123; sb-refresh-token=refresh456; theme=dark";
        const parsed = parseBrowserCookies(raw);

        expect(parsed).toEqual([
          { name: "sb-access-token", value: "token123" },
          { name: "sb-refresh-token", value: "refresh456" },
          { name: "theme", value: "dark" },
        ]);
      });

      it("parseBrowserCookies handles empty, whitespace, and quoted cookie values gracefully", () => {
        expect(parseBrowserCookies("")).toEqual([]);
        expect(parseBrowserCookies("   ")).toEqual([]);

        const withQuotes = 'session="abc%20123"; empty=';
        const parsed = parseBrowserCookies(withQuotes);
        expect(parsed).toEqual([
          { name: "session", value: "abc 123" },
          { name: "empty", value: "" },
        ]);
      });

      it("adminBrowserCookieMethods.setAll strips maxAge on write to enforce session cookie semantics", () => {
        let fakeDocumentCookie = "";
        const originalDocument = globalThis.document;

        // Mock document.cookie
        globalThis.document = {
          get cookie() {
            return fakeDocumentCookie;
          },
          set cookie(val: string) {
            fakeDocumentCookie = val;
          },
        } as unknown as Document;

        try {
          adminBrowserCookieMethods.setAll([
            {
              name: "sb-auth",
              value: "test-token",
              options: { path: "/", maxAge: 34560000, sameSite: "lax" },
            },
          ]);

          expect(fakeDocumentCookie).toContain("sb-auth=test-token");
          expect(fakeDocumentCookie).not.toContain("Max-Age");
          expect(fakeDocumentCookie).not.toContain("Expires");

          // When clearing the cookie
          adminBrowserCookieMethods.setAll([
            {
              name: "sb-auth",
              value: "",
              options: { path: "/", maxAge: 0 },
            },
          ]);

          expect(fakeDocumentCookie).toContain("Max-Age=0");
        } finally {
          globalThis.document = originalDocument;
        }
      });
    });

    describe("Browser Session Lifecycle & Invariants", () => {
      it("Page refresh: admin remains authenticated across requests when session cookie persists", async () => {
        const validSignIn = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
        mockGetUser.mockResolvedValue({
          data: {
            user: { id: "admin-active", email: "admin@test.com", last_sign_in_at: validSignIn },
          },
          error: null,
        });

        // Request 1: Initial page load
        const req1 = new NextRequest("http://localhost/admin");
        const res1 = await updateSession(req1);
        expect(res1.status).toBe(200);

        // Request 2: Page refresh (F5) with session cookie intact
        const req2 = new NextRequest("http://localhost/admin");
        const res2 = await updateSession(req2);
        expect(res2.status).toBe(200);
      });

      it("Navigation: admin remains authenticated navigating across different admin pages", async () => {
        const validSignIn = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        mockGetUser.mockResolvedValue({
          data: {
            user: { id: "admin-nav", email: "admin@test.com", last_sign_in_at: validSignIn },
          },
          error: null,
        });

        const pages = [
          "http://localhost/admin",
          "http://localhost/admin/events",
          "http://localhost/admin/scanner",
          "http://localhost/admin/logs",
        ];

        for (const pageUrl of pages) {
          const req = new NextRequest(pageUrl);
          const res = await updateSession(req);
          expect(res.status).toBe(200);
        }
      });

      it("Browser closed & reopened: discarded session cookie causes redirect to /admin/login", async () => {
        // When the browser process exits, session cookies are discarded.
        // Upon reopening, request arrives with no session cookies (user: null).
        mockGetUser.mockResolvedValue({
          data: { user: null },
          error: null,
        });

        const req = new NextRequest("http://localhost/admin");
        const res = await updateSession(req);

        // Must redirect to login
        expect(res.status).toBe(307);
        expect(res.headers.get("location")).toContain("/admin/login");
      });

      it("Manual logout: immediately terminates session and requires new login", async () => {
        mockGetUser.mockResolvedValue({
          data: { user: null },
          error: null,
        });

        const auth = await serverLib.requireAdmin();
        expect(auth.status).toBe(401);
        expect(auth.error).toBe("Unauthorized");
      });

      it("8-hour absolute maximum lifetime cannot be extended by session cookies or token refreshes", async () => {
        // User logged in 8 hours and 1 minute ago.
        const eightHoursOneMinAgo = new Date(Date.now() - (8 * 3600 + 60) * 1000).toISOString();

        mockGetUser.mockResolvedValue({
          data: {
            user: {
              id: "admin-expired",
              email: "admin@test.com",
              last_sign_in_at: eightHoursOneMinAgo,
            },
          },
          error: null,
        });

        // requireAdmin rejects with 401 Session expired
        const auth = await serverLib.requireAdmin();
        expect(auth.status).toBe(401);
        expect(auth.error).toBe("Session expired");

        // Edge proxy terminates session and redirects to /admin/login
        const req = new NextRequest("http://localhost/admin/events");
        const res = await updateSession(req);
        expect(res.status).toBe(307);
        expect(res.headers.get("location")).toContain("/admin/login");
      });

      it("Registration auth remains persistent with 48h expiration and is independent of admin session", () => {
        const token = createRegistrationSessionToken("participant@example.com");
        const verification = verifyRegistrationSessionToken(token);

        expect(verification.valid).toBe(true);
        expect(verification.payload?.email).toBe("participant@example.com");

        // Registration session has 48 hour lifetime
        const expectedMinExp = Date.now() + DEFAULT_SESSION_EXP_MS - 5000;
        expect(verification.payload?.exp).toBeGreaterThan(expectedMinExp);
      });

      it("Confirms NO inactivity timeout or idle timer is configured", () => {
        // Verifies no idle timer env var exists or is relied upon
        expect(process.env.ADMIN_SESSION_IDLE_TIMEOUT_SECONDS).toBeUndefined();
      });
    });
  });

    describe("Local Development Master Admin MFA Exception Isolation", () => {
      const originalEnv = { ...process.env };

      beforeEach(() => {
        process.env = { ...originalEnv };
      });

      afterEach(() => {
        process.env = { ...originalEnv };
      });

      it("fails closed in production environment even if local Supabase URL is passed", () => {
        (process.env as any).NODE_ENV = "production";
        process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
      });

      it("fails closed in test environment even if local Supabase URL is passed", () => {
        (process.env as any).NODE_ENV = "test";
        process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
      });

      it("fails closed when cloud deployment indicators are present (Vercel, Netlify, Render, Fly)", () => {
        (process.env as any).NODE_ENV = "development";
        process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";

        process.env.VERCEL = "1";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
        delete process.env.VERCEL;

        process.env.VERCEL_ENV = "preview";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
        delete process.env.VERCEL_ENV;

        process.env.NETLIFY = "true";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
        delete process.env.NETLIFY;

        process.env.RENDER = "true";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
        delete process.env.RENDER;

        process.env.FLY_APP_NAME = "my-app";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
        delete process.env.FLY_APP_NAME;
      });

      it("fails closed when Supabase URL points to production host", () => {
        (process.env as any).NODE_ENV = "development";
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ikavnyjfmdxjnlbovkzm.supabase.co";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
      });

      it("fails closed when port is not 54321", () => {
        (process.env as any).NODE_ENV = "development";
        process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3000";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);

        process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:8000";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
      });

      it("fails closed when protocol is https on local host", () => {
        (process.env as any).NODE_ENV = "development";
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://127.0.0.1:54321";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
      });

      it("fails closed when Supabase URL is empty or malformed", () => {
        (process.env as any).NODE_ENV = "development";
        process.env.NEXT_PUBLIC_SUPABASE_URL = "";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);

        process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-valid-url";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(false);
      });

      it("permits exception ONLY when NODE_ENV is development AND URL is http://127.0.0.1:54321 or http://localhost:54321", () => {
        (process.env as any).NODE_ENV = "development";
        process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(true);

        process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
        expect(isLocalDevelopmentMfaBypassAllowed()).toBe(true);
      });
    });
});
