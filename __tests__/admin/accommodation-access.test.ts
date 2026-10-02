import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/admin/admins/[userId]/accommodation-access/route";
import * as serverLib from "@/lib/supabase/server";

// Mock environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

type QueryBuilderMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then?: (resolve: (value: { data: unknown; error: unknown }) => void) => void;
  [key: string]: unknown;
};

const mockBuilder: QueryBuilderMock = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
};

mockBuilder.then = function (resolve: (value: { data: unknown; error: unknown }) => void) {
  resolve({ data: null, error: null });
};

const mockServerClient = {
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: "sm-id", email: "jashan082006@gmail.com", last_sign_in_at: new Date().toISOString() } },
      error: null,
    }),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
        data: { currentLevel: "aal2" },
        error: null,
      }),
    },
    signOut: vi.fn().mockResolvedValue({ error: null }),
  },
  from: vi.fn().mockReturnValue(mockBuilder),
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => mockServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: vi.fn(), setAll: vi.fn() }),
}));

const mockFrom = vi.fn((table?: string) => {
  void table;
  return mockBuilder;
});

vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: () => ({
      from: mockFrom,
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { id: "target-user", email: "target@example.com" } },
          }),
        },
      },
    }),
  };
});

describe("Accommodation Permission Management API (Phase 2C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PRIMARY_ADMIN_USER_ID;
    delete process.env.PRIMARY_ADMIN_EMAIL;

    // Reset default mockBuilder chainable behavior
    mockBuilder.select = vi.fn().mockReturnThis();
    mockBuilder.insert = vi.fn().mockReturnThis();
    mockBuilder.update = vi.fn().mockReturnThis();
    mockBuilder.eq = vi.fn().mockReturnThis();
    mockBuilder.maybeSingle = vi.fn().mockResolvedValue({
      data: { user_id: "normal-admin-id", role: "admin", accommodation_access: false },
      error: null,
    });
    mockBuilder.single = vi.fn().mockResolvedValue({
      data: { user_id: "normal-admin-id", role: "admin", accommodation_access: false },
      error: null,
    });
    mockBuilder.then = function (resolve: (value: { data: unknown; error: unknown }) => void) {
      resolve({ data: null, error: null });
    };
  });

  const createMockRequest = (body?: unknown) => {
    return {
      method: "PATCH",
      headers: new Headers(),
      json: async () => {
        if (body === "MALFORMED_JSON") {
          throw new Error("Unexpected token");
        }
        return body;
      },
    } as unknown as Request;
  };

  const createParams = (userId: string) => ({
    params: Promise.resolve({ userId }),
  });

  type MasterAdminAuthResult = Awaited<ReturnType<typeof serverLib.requireMasterAdmin>>;

  const mockAsPrimaryMaster = (id = "sm-id", email = "primarymaster@example.com") => {
    process.env.PRIMARY_ADMIN_USER_ID = id;
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: { id, email },
      role: "master",
      accommodation_access: true,
      error: null,
      status: 200,
    } as unknown as MasterAdminAuthResult);
  };

  const mockAsOtherMaster = (id = "other-master-id", email = "othermaster@example.com") => {
    process.env.PRIMARY_ADMIN_USER_ID = "sm-id";
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: { id, email },
      role: "master",
      accommodation_access: true,
      error: null,
      status: 200,
    } as unknown as MasterAdminAuthResult);
  };

  const mockAsNormalAdmin = (id = "normal-admin-id", email = "normal@example.com") => {
    process.env.PRIMARY_ADMIN_USER_ID = "sm-id";
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: { id, email },
      role: "admin",
      accommodation_access: false,
      error: "Master Admin access required",
      status: 403,
    } as unknown as MasterAdminAuthResult);
  };

  const mockAsUnauthenticated = () => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: null,
      role: null,
      accommodation_access: false,
      error: "Unauthorized",
      status: 401,
    } as unknown as MasterAdminAuthResult);
  };

  // 1. Primary Master can grant access to normal admin
  it("1. Primary Master can grant accommodation access to normal admin", async () => {
    mockAsPrimaryMaster();
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: { user_id: "target-normal", role: "admin", accommodation_access: false },
      error: null,
    });
    mockBuilder.update.mockReturnValueOnce(mockBuilder);

    const req = createMockRequest({ accommodationAccess: true });
    const res = await PATCH(req, createParams("target-normal"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.accommodationAccess).toBe(true);
    expect(mockBuilder.update).toHaveBeenCalledWith({ accommodation_access: true });
  });

  // 2. Primary Master can revoke access from normal admin
  it("2. Primary Master can revoke accommodation access from normal admin", async () => {
    mockAsPrimaryMaster();
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: { user_id: "target-normal", role: "admin", accommodation_access: true },
      error: null,
    });

    const req = createMockRequest({ accommodationAccess: false });
    const res = await PATCH(req, createParams("target-normal"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.accommodationAccess).toBe(false);
    expect(mockBuilder.update).toHaveBeenCalledWith({ accommodation_access: false });
  });

  // 3. Master Admin can grant access to normal admin
  it("3. Master Admin can grant access to normal admin", async () => {
    mockAsOtherMaster();
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: { user_id: "target-normal", role: "admin", accommodation_access: false },
      error: null,
    });

    const req = createMockRequest({ accommodationAccess: true });
    const res = await PATCH(req, createParams("target-normal"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.accommodationAccess).toBe(true);
    expect(mockBuilder.update).toHaveBeenCalledWith({ accommodation_access: true });
  });

  // 4. Master Admin can revoke access from normal admin
  it("4. Master Admin can revoke access from normal admin", async () => {
    mockAsOtherMaster();
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: { user_id: "target-normal", role: "admin", accommodation_access: true },
      error: null,
    });

    const req = createMockRequest({ accommodationAccess: false });
    const res = await PATCH(req, createParams("target-normal"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.accommodationAccess).toBe(false);
    expect(mockBuilder.update).toHaveBeenCalledWith({ accommodation_access: false });
  });

  // 5. Normal Admin cannot grant access
  it("5. Normal Admin cannot grant access (rejected with 403)", async () => {
    mockAsNormalAdmin();
    const req = createMockRequest({ accommodationAccess: true });
    const res = await PATCH(req, createParams("other-user-id"));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Master Admin access required");
  });

  // 6. Normal Admin cannot revoke access
  it("6. Normal Admin cannot revoke access (rejected with 403)", async () => {
    mockAsNormalAdmin();
    const req = createMockRequest({ accommodationAccess: false });
    const res = await PATCH(req, createParams("other-user-id"));

    expect(res.status).toBe(403);
  });

  // 7. Normal Admin cannot grant access to themselves
  it("7. Normal Admin cannot grant access to themselves", async () => {
    mockAsNormalAdmin("self-id", "self@example.com");
    const req = createMockRequest({ accommodationAccess: true });
    const res = await PATCH(req, createParams("self-id"));

    expect(res.status).toBe(403);
  });

  // 8. Normal Admin cannot revoke access from themselves
  it("8. Normal Admin cannot revoke access from themselves", async () => {
    mockAsNormalAdmin("self-id", "self@example.com");
    const req = createMockRequest({ accommodationAccess: false });
    const res = await PATCH(req, createParams("self-id"));

    expect(res.status).toBe(403);
  });

  // 9. Normal Admin cannot modify another admin
  it("9. Normal Admin cannot modify another admin", async () => {
    mockAsNormalAdmin("normal-id", "normal@example.com");
    const req = createMockRequest({ accommodationAccess: true });
    const res = await PATCH(req, createParams("target-id"));

    expect(res.status).toBe(403);
  });

  // 10. Master Admin cannot modify Primary Master
  it("10. Master Admin cannot modify Primary Master (returns 403)", async () => {
    mockAsOtherMaster();
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: { user_id: "sm-id", role: "master", accommodation_access: true },
      error: null,
    });

    const req = createMockRequest({ accommodationAccess: false });
    const res = await PATCH(req, createParams("sm-id"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Primary Master");
  });

  // 11. Primary Master protection remains intact (Primary Master cannot be modified by anyone)
  it("11. Primary Master accommodation access is protected even from self-revocation", async () => {
    mockAsPrimaryMaster("sm-id");
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: { user_id: "sm-id", role: "master", accommodation_access: true },
      error: null,
    });

    const req = createMockRequest({ accommodationAccess: false });
    const res = await PATCH(req, createParams("sm-id"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain("Primary Master accommodation access is protected");
  });

  // 12. Invalid target admin returns appropriate error
  it("12. Invalid target admin returns 404", async () => {
    mockAsPrimaryMaster();
    mockBuilder.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createMockRequest({ accommodationAccess: true });
    const res = await PATCH(req, createParams("non-existent-id"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("Administrator not found");
  });

  // 13. Invalid request body returns 400
  it("13. Invalid request body returns 400", async () => {
    mockAsPrimaryMaster();

    // Missing field
    let req = createMockRequest({});
    let res = await PATCH(req, createParams("target-normal"));
    expect(res.status).toBe(400);

    // Non-boolean field
    req = createMockRequest({ accommodationAccess: "true" });
    res = await PATCH(req, createParams("target-normal"));
    expect(res.status).toBe(400);

    // Malformed JSON
    req = createMockRequest("MALFORMED_JSON");
    res = await PATCH(req, createParams("target-normal"));
    expect(res.status).toBe(400);
  });

  // 14. Unauthenticated request returns 401
  it("14. Unauthenticated request returns 401", async () => {
    mockAsUnauthenticated();
    const req = createMockRequest({ accommodationAccess: true });
    const res = await PATCH(req, createParams("target-normal"));

    expect(res.status).toBe(401);
  });

  // 15. Server uses database-backed role/permission rather than client-provided role
  it("15. Server strictly ignores client claims and uses database-backed authorization", async () => {
    // Caller attempts to spoof master role in client headers or body, but server auth evaluates role
    mockAsNormalAdmin();
    const req = createMockRequest({
      accommodationAccess: true,
      role: "master",
      email: "primarymaster@example.com",
    });
    const res = await PATCH(req, createParams("target-normal"));

    // Server rejects caller because server-side DB session role is admin
    expect(res.status).toBe(403);
  });

  // 16. Existing accommodation access behavior:
  describe("Existing requireAccommodationAdmin behavior", () => {
    it("allows access when accommodation_access is true", async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "sm-id", role: "admin", accommodation_access: true },
        error: null,
      });

      const auth = await serverLib.requireAccommodationAdmin();
      expect(auth.error).toBeNull();
      expect(auth.accommodation_access).toBe(true);
      expect(auth.status).toBe(200);
    });

    it("denies access when accommodation_access is false", async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "sm-id", role: "admin", accommodation_access: false },
        error: null,
      });

      const auth = await serverLib.requireAccommodationAdmin();
      expect(auth.error).toBe("Accommodation access required");
      expect(auth.status).toBe(403);
    });
  });
});
