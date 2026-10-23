import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_SITE_ACCESS,
  SITE_PAGE_DEFINITIONS,
  SITE_ACCESS_AUDIT_TARGET_ID,
  getSiteAccess,
  clearSiteAccessCache,
} from "@/lib/config/site-access";
import * as serverLib from "@/lib/supabase/server";
import { GET, PATCH } from "@/app/api/admin/site-access/route";

describe("Dynamic Site Access Engine", () => {
  beforeEach(() => {
    clearSiteAccessCache();
    vi.restoreAllMocks();
  });

  it("contains all 8 required site section keys in DEFAULT_SITE_ACCESS", () => {
    const requiredKeys = [
      "REGISTRATIONS_ENABLED",
      "SCHEDULE_ENABLED",
      "SPONSORS_ENABLED",
      "STARNIGHT_ENABLED",
      "EVENT_DETAILS_ENABLED",
      "LEGACY_ENABLED",
      "TEAM_ENABLED",
      "GALLERY_ENABLED",
    ];

    for (const key of requiredKeys) {
      expect(key in DEFAULT_SITE_ACCESS).toBe(true);
      expect(key in SITE_PAGE_DEFINITIONS).toBe(true);
      expect(typeof DEFAULT_SITE_ACCESS[key as keyof typeof DEFAULT_SITE_ACCESS]).toBe("boolean");
    }
  });

  it("returns fallback defaults if database query errors or returns empty", async () => {
    const access = await getSiteAccess();
    expect(access).toBeDefined();
    expect(access.REGISTRATIONS_ENABLED).toBe(true);
    expect(access.STARNIGHT_ENABLED).toBe(true);
    expect(access.EVENT_DETAILS_ENABLED).toBe(true);
    expect(access.TEAM_ENABLED).toBe(true);
  });

  it("uses a valid UUID for the site access audit log target id", () => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(SITE_ACCESS_AUDIT_TARGET_ID)).toBe(true);
  });
});

describe("Admin Site Access API Authorization", () => {
  beforeEach(() => {
    clearSiteAccessCache();
    vi.restoreAllMocks();
  });

  it("rejects unauthorized users from GET /api/admin/site-access", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      error: "Unauthorized",
      status: 401,
    } as any);

    const req = new Request("http://localhost:3000/api/admin/site-access");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns site access configuration for authorized admin", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com" } as any,
      status: 200,
    } as any);
    vi.spyOn(serverLib, "isPrimaryMaster").mockReturnValue(true);

    const req = new Request("http://localhost:3000/api/admin/site-access");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.isPrimary).toBe(true);
    expect(data.siteAccess).toBeDefined();
  });

  it("rejects unauthenticated requests from PATCH /api/admin/site-access", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      error: "Unauthorized",
      status: 401,
    } as any);

    const req = new Request("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "STARNIGHT_ENABLED", enabled: false }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("strictly rejects non-primary master admin from PATCH /api/admin/site-access with 403", async () => {
    vi.spyOn(serverLib, "requirePrimaryMasterAdmin").mockResolvedValue({
      error: "Super Master Admin access required",
      status: 403,
    } as any);

    const req = new Request("http://localhost:3000/api/admin/site-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "STARNIGHT_ENABLED", enabled: false }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe(
      "Access denied. Only Primary Master Admins have authorization to lock or unlock site pages."
    );
  });
});

