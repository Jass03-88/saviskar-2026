import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE, PATCH } from "@/app/api/admin/admins/route";
import { POST as RESET_POST } from "@/app/api/admin/admins/reset-password/route";
import { POST as FORGOT_PASSWORD_POST } from "@/app/api/admin/auth/forgot-password/route";
import { POST as SELF_RESET_PASSWORD_POST } from "@/app/api/admin/auth/reset-password/route";
import { GET as getEvents } from "@/app/api/admin/events/route";
import * as serverLib from "@/lib/supabase/server";

// Mock environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

type QueryBuilderMock = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then?: (resolve: (value: { data: unknown; error: unknown }) => void) => void;
  [key: string]: unknown;
};

const mockBuilder: QueryBuilderMock = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
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

const mockGetUserById = vi.fn().mockResolvedValue({
  data: { user: { id: "target-user", email: "test@example.com" } },
});
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "target-user", email: "test@example.com" } },
  error: null,
});
const mockUpdateUserById = vi.fn().mockResolvedValue({
  data: { user: { id: "target-user" } },
  error: null,
});
const mockListUsers = vi.fn().mockResolvedValue({ data: { users: [] }, error: null });
const mockInviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: "new" } }, error: null });
const mockDeleteUser = vi.fn();
const mockResetPasswordForEmail = vi.fn().mockResolvedValue({ data: {}, error: null });

// Mock Supabase JS admin client
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: () => {
      return {
        from: mockFrom,
        auth: {
          getUser: mockGetUser,
          resetPasswordForEmail: mockResetPasswordForEmail,
          admin: {
            getUserById: mockGetUserById,
            getUser: mockGetUser,
            updateUserById: mockUpdateUserById,
            listUsers: mockListUsers,
            inviteUserByEmail: mockInviteUserByEmail,
            deleteUser: mockDeleteUser,
          },
        },
      };
    },
  };
});

describe("Admin Management API Security & RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PRIMARY_ADMIN_USER_ID;
    delete process.env.PRIMARY_ADMIN_EMAIL;

    // Reset default builder behavior
    Object.keys(mockBuilder).forEach((key) => {
      const val = mockBuilder[key];
      if (val && typeof val === "object" && "mockClear" in val && typeof (val as { mockClear: () => void }).mockClear === "function") {
        (val as { mockClear: () => void }).mockClear();
      }
    });

    // Reset default chainable builder behavior
    mockBuilder.select = vi.fn().mockReturnThis();
    mockBuilder.insert = vi.fn().mockReturnThis();
    mockBuilder.delete = vi.fn().mockReturnThis();
    mockBuilder.update = vi.fn().mockReturnThis();
    mockBuilder.eq = vi.fn().mockReturnThis();
    mockBuilder.order = vi.fn().mockReturnThis();
    mockBuilder.limit = vi.fn().mockReturnThis();
    mockBuilder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mockBuilder.single = vi.fn().mockResolvedValue({ data: null, error: null });
    mockBuilder.then = function (resolve: (value: { data: unknown; error: unknown }) => void) {
      resolve({ data: null, error: null });
    };

    mockGetUserById.mockResolvedValue({
      data: { user: { id: "target-user", email: "test@example.com" } },
    });
  });

  const createMockRequest = (
    method: string,
    body?: unknown,
    url = "http://localhost/api/admin/admins"
  ) => {
    return {
      method,
      url,
      headers: new Headers(),
      json: async () => body,
    } as unknown as Request;
  };

  type MasterAdminAuthResult = Awaited<ReturnType<typeof serverLib.requireMasterAdmin>>;

  const mockAsPrimaryMaster = (id = "sm-id", email = "primarymaster@example.com") => {
    process.env.PRIMARY_ADMIN_USER_ID = id;
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: { id, email },
      role: "master",
      error: null,
      status: 200,
    } as unknown as MasterAdminAuthResult);
  };

  const mockAsOtherMaster = (id = "other-master-id", email = "othermaster@example.com") => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: { id, email },
      role: "master",
      error: null,
      status: 200,
    } as unknown as MasterAdminAuthResult);
  };

  const mockAsNormalAdmin = (id = "normal-id", email = "normal@example.com") => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: { id, email },
      role: "admin",
      error: "Master Admin access required",
      status: 403,
    } as unknown as MasterAdminAuthResult);
  };

  const mockAsUnauthenticated = () => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: null,
      role: null,
      error: "Unauthorized",
      status: 401,
    } as unknown as MasterAdminAuthResult);
  };

  const mockAsMfaRequired = (id = "mfa-id", email = "master-no-mfa@example.com") => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {},
      user: { id, email },
      role: "master",
      error: "MFA_REQUIRED",
      status: 403,
    } as unknown as MasterAdminAuthResult);
  };

  /* =========================================================
     1. Primary Master Identity Determination
  ========================================================= */
  describe("Primary Master Identity Determination", () => {
    it("fails closed when PRIMARY_ADMIN_USER_ID is unset (no one is Primary Master)", () => {
      delete process.env.PRIMARY_ADMIN_USER_ID;
      delete process.env.PRIMARY_ADMIN_EMAIL;
      expect(serverLib.isPrimaryMaster({ id: "any-id", email: "jashan082006@gmail.com" })).toBe(false);
      expect(serverLib.isPrimaryMaster({ id: "any-id", email: "other@gmail.com" })).toBe(false);
      expect(serverLib.isPrimaryMaster(null)).toBe(false);
      expect(serverLib.isPrimaryMaster(undefined)).toBe(false);
      expect(serverLib.isPrimaryMaster({ email: "jashan082006@gmail.com" })).toBe(false);
    });

    it("identifies Primary Master strictly via PRIMARY_ADMIN_USER_ID when configured", () => {
      process.env.PRIMARY_ADMIN_USER_ID = "immutable-primary-uuid";

      // Matching immutable user ID is primary regardless of email
      expect(
        serverLib.isPrimaryMaster({ id: "immutable-primary-uuid", email: "changed-email@domain.com" })
      ).toBe(true);

      // Wrong user ID even with former primary email is NOT primary
      expect(
        serverLib.isPrimaryMaster({ id: "impostor-uuid", email: "jashan082006@gmail.com" })
      ).toBe(false);

      // User without ID is NOT primary
      expect(
        serverLib.isPrimaryMaster({ email: "changed-email@domain.com" })
      ).toBe(false);
    });

    it("requireSuperMasterAdmin succeeds for Primary Master and rejects others", async () => {
      process.env.PRIMARY_ADMIN_USER_ID = "sm-id";
      // Primary Master
      mockServerClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: "sm-id", email: "primary@example.com", last_sign_in_at: new Date().toISOString() } },
        error: null,
      });
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { role: "master" }, error: null });
      const primaryAuth = await serverLib.requireSuperMasterAdmin();
      expect(primaryAuth.error).toBe(null);

      // Other Master
      mockServerClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: "other-id", email: "other@example.com", last_sign_in_at: new Date().toISOString() } },
        error: null,
      });
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { role: "master" }, error: null });
      const otherAuth = await serverLib.requireSuperMasterAdmin();
      expect(otherAuth.status).toBe(403);
      expect(otherAuth.error).toBe("Super Master Admin access required");
    });
  });

  /* =========================================================
     2. Comprehensive 28 Security Matrix Verification
  ========================================================= */
  describe("Security Matrix Verification (28 Scenarios)", () => {
    // 1. Normal Admin POST role=admin -> DENY 403
    it("1. Normal Admin POST role=admin -> DENY (403)", async () => {
      mockAsNormalAdmin();
      const res = await POST(createMockRequest("POST", { email: "newadmin@example.com", role: "admin" }));
      expect(res.status).toBe(403);
    });

    // 2. Normal Admin POST role=master -> DENY 403
    it("2. Normal Admin POST role=master -> DENY (403)", async () => {
      mockAsNormalAdmin();
      const res = await POST(createMockRequest("POST", { email: "newmaster@example.com", role: "master" }));
      expect(res.status).toBe(403);
    });

    // 3. Normal Admin DELETE normal admin -> DENY 403
    it("3. Normal Admin DELETE normal admin -> DENY (403)", async () => {
      mockAsNormalAdmin();
      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-normal"));
      expect(res.status).toBe(403);
    });

    // 4. Normal Admin DELETE master -> DENY 403
    it("4. Normal Admin DELETE master -> DENY (403)", async () => {
      mockAsNormalAdmin();
      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-master"));
      expect(res.status).toBe(403);
    });

    // 5. Normal Admin PATCH promotion -> DENY 403
    it("5. Normal Admin PATCH promotion -> DENY (403)", async () => {
      mockAsNormalAdmin();
      const res = await PATCH(createMockRequest("PATCH", { userId: "target-normal", newRole: "master" }));
      expect(res.status).toBe(403);
    });

    // 6. Other Master POST role=admin -> ALLOW 201
    it("6. Other Master POST role=admin -> ALLOW (201)", async () => {
      mockAsOtherMaster();
      mockListUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
      mockBuilder.insert.mockResolvedValueOnce({ error: null });

      const res = await POST(createMockRequest("POST", { email: "newnormal@example.com", role: "admin" }));
      expect(res.status).toBe(201);
      expect(mockInviteUserByEmail).toHaveBeenCalledWith("newnormal@example.com", {
        data: { saviskar_role: "admin" },
        redirectTo: "http://localhost/admin/accept-invite",
      });
    });

    // 7. Other Master POST role=master -> DENY 403
    it("7. Other Master POST role=master -> DENY (403)", async () => {
      mockAsOtherMaster();
      const res = await POST(createMockRequest("POST", { email: "newmaster@example.com", role: "master" }));
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.error).toBe("Only the Primary Master Admin can create Master Admins.");
    });

    // 8. Other Master DELETE normal admin -> ALLOW 200
    it("8. Other Master DELETE normal admin -> ALLOW (200)", async () => {
      mockAsOtherMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-normal", role: "admin" },
        error: null,
      });

      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-normal"));
      expect(res.status).toBe(200);
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "REMOVE_ADMIN",
          target_id: "target-normal",
        })
      );
    });

    // 9. Other Master DELETE another Master -> DENY 403
    it("9. Other Master DELETE another Master -> DENY (403)", async () => {
      mockAsOtherMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-other-master", role: "master" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "target-other-master", email: "secondmaster@example.com" } },
      });

      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-other-master"));
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.error).toBe("Only the Primary Master Admin can remove Master Admins.");
      expect(mockBuilder.delete).not.toHaveBeenCalled();
    });

    // 10. Other Master DELETE Primary Master -> DENY 403
    it("10. Other Master DELETE Primary Master -> DENY (403)", async () => {
      process.env.PRIMARY_ADMIN_USER_ID = "primary-master-id";
      mockAsOtherMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "primary-master-id", role: "master" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "primary-master-id", email: "primary@example.com" } },
      });

      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=primary-master-id"));
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.error).toBe("The Primary Master administrator cannot be removed.");
      expect(mockBuilder.delete).not.toHaveBeenCalled();
    });

    // 11. Other Master PATCH normal -> master -> DENY 403
    it("11. Other Master PATCH normal -> master -> DENY (403)", async () => {
      mockAsOtherMaster();
      const res = await PATCH(createMockRequest("PATCH", { userId: "target-normal", newRole: "master" }));
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.error).toBe("Only the Primary Master Admin can promote or demote administrators.");
    });

    // 12. Other Master PATCH master -> normal -> DENY 403
    it("12. Other Master PATCH master -> normal -> DENY (403)", async () => {
      mockAsOtherMaster();
      const res = await PATCH(createMockRequest("PATCH", { userId: "target-master", newRole: "admin" }));
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.error).toBe("Only the Primary Master Admin can promote or demote administrators.");
    });

    // 13. Primary Master POST role=admin -> ALLOW 201
    it("13. Primary Master POST role=admin -> ALLOW (201)", async () => {
      mockAsPrimaryMaster();
      mockListUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
      mockBuilder.insert.mockResolvedValueOnce({ error: null });

      const res = await POST(createMockRequest("POST", { email: "deskadmin@example.com", role: "admin" }));
      expect(res.status).toBe(201);
    });

    // 14. Primary Master POST role=master -> ALLOW 201
    it("14. Primary Master POST role=master -> ALLOW (201)", async () => {
      mockAsPrimaryMaster();
      mockListUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
      mockBuilder.insert.mockResolvedValueOnce({ error: null });

      const res = await POST(createMockRequest("POST", { email: "secondmaster@example.com", role: "master" }));
      expect(res.status).toBe(201);
      expect(mockInviteUserByEmail).toHaveBeenCalledWith("secondmaster@example.com", {
        data: { saviskar_role: "master" },
        redirectTo: "http://localhost/admin/accept-invite",
      });
    });

    // 15 & 16. Primary Master can create 3rd, 4th, unlimited Masters (no 2-master limit)
    it("15 & 16. Primary Master can create 3rd, 4th, and unlimited Masters without limit error", async () => {
      mockAsPrimaryMaster();

      // Simulate 5 existing master admins already in the DB
      const fiveExistingMasters = [
        { user_id: "m1", role: "master" },
        { user_id: "m2", role: "master" },
        { user_id: "m3", role: "master" },
        { user_id: "m4", role: "master" },
        { user_id: "m5", role: "master" },
      ];

      // 3rd / 6th Master creation
      mockBuilder.select.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce({ data: fiveExistingMasters, error: null }),
      });
      mockListUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
      mockBuilder.insert.mockResolvedValueOnce({ error: null });

      const res3 = await POST(createMockRequest("POST", { email: "master3@example.com", role: "master" }));
      expect(res3.status).toBe(201);

      // 4th / 7th Master creation
      mockBuilder.select.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce({ data: fiveExistingMasters, error: null }),
      });
      mockListUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
      mockBuilder.insert.mockResolvedValueOnce({ error: null });

      const res4 = await POST(createMockRequest("POST", { email: "master4@example.com", role: "master" }));
      expect(res4.status).toBe(201);
    });

    // 17. Primary Master DELETE normal admin -> ALLOW 200
    it("17. Primary Master DELETE normal admin -> ALLOW (200)", async () => {
      mockAsPrimaryMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-normal", role: "admin" },
        error: null,
      });

      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-normal"));
      expect(res.status).toBe(200);
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "REMOVE_ADMIN",
          target_id: "target-normal",
        })
      );
    });

    // 18. Primary Master DELETE another Master -> ALLOW 200
    it("18. Primary Master DELETE another Master -> ALLOW (200)", async () => {
      mockAsPrimaryMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-master", role: "master" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "target-master", email: "othermaster@example.com" } },
      });

      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-master"));
      expect(res.status).toBe(200);
      expect(mockBuilder.delete).toHaveBeenCalled();
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "REMOVE_MASTER_ADMIN",
          target_id: "target-master",
        })
      );
    });

    // 19. Primary Master DELETE self -> DENY 400
    it("19. Primary Master DELETE self -> DENY (400)", async () => {
      mockAsPrimaryMaster("sm-id", "jashan082006@gmail.com");
      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=sm-id"));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("You cannot remove yourself.");
    });

    // 20. Primary Master PATCH another Master -> admin -> ALLOW 200
    it("20. Primary Master PATCH another Master -> admin -> ALLOW (200)", async () => {
      mockAsPrimaryMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-master-id", role: "master" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "target-master-id", email: "othermaster@example.com" } },
      });

      const res = await PATCH(createMockRequest("PATCH", { userId: "target-master-id", newRole: "admin" }));
      expect(res.status).toBe(200);
      expect(mockBuilder.update).toHaveBeenCalledWith({ role: "admin" });
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "DEMOTE_ADMIN",
          target_id: "target-master-id",
        })
      );
    });

    // 21. Primary Master PATCH normal -> master -> ALLOW 200
    it("21. Primary Master PATCH normal -> master -> ALLOW (200)", async () => {
      mockAsPrimaryMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-normal-id", role: "admin" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "target-normal-id", email: "normal@example.com" } },
      });

      const res = await PATCH(createMockRequest("PATCH", { userId: "target-normal-id", newRole: "master" }));
      expect(res.status).toBe(200);
      expect(mockBuilder.update).toHaveBeenCalledWith({ role: "master" });
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "PROMOTE_ADMIN",
          target_id: "target-normal-id",
        })
      );
    });

    // 22. Primary Master PATCH self -> admin -> DENY 400
    it("22. Primary Master PATCH self -> admin -> DENY (400)", async () => {
      mockAsPrimaryMaster("sm-id", "jashan082006@gmail.com");
      const res = await PATCH(createMockRequest("PATCH", { userId: "sm-id", newRole: "admin" }));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("You cannot change your own role.");
    });

    // 23. Unauthenticated POST -> DENY 401
    it("23. Unauthenticated POST -> DENY (401)", async () => {
      mockAsUnauthenticated();
      const res = await POST(createMockRequest("POST", { email: "test@example.com", role: "admin" }));
      expect(res.status).toBe(401);
    });

    // 24. Unauthenticated DELETE -> DENY 401
    it("24. Unauthenticated DELETE -> DENY (401)", async () => {
      mockAsUnauthenticated();
      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=123"));
      expect(res.status).toBe(401);
    });

    // 25. Unauthenticated PATCH -> DENY 401
    it("25. Unauthenticated PATCH -> DENY (401)", async () => {
      mockAsUnauthenticated();
      const res = await PATCH(createMockRequest("PATCH", { userId: "123", newRole: "admin" }));
      expect(res.status).toBe(401);
    });

    // 26. Master without required MFA/AAL2 -> DENY 403
    it("26. Master without required MFA/AAL2 -> DENY (403)", async () => {
      mockAsMfaRequired();
      const res = await POST(createMockRequest("POST", { email: "test@example.com", role: "admin" }));
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.error).toBe("Master Admin MFA verification required.");
    });

    // 27. Forged client role/isSuperMaster field in body -> MUST NOT bypass authorization
    it("27. Forged client role/isSuperMaster in body does not elevate permissions", async () => {
      mockAsOtherMaster();
      const res = await POST(
        createMockRequest("POST", {
          email: "target@example.com",
          role: "master",
          isSuperMaster: true,
          requesterRole: "master",
        })
      );
      expect(res.status).toBe(403);
    });

    // 28. Forged target role query parameter does not bypass server-side check
    it("28. Forged target role in query parameters does not bypass authoritative DB check", async () => {
      mockAsOtherMaster();
      // Server checks database: target is actually a master!
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-master", role: "master" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "target-master", email: "master@example.com" } },
      });

      // Attacker appends forged role=admin in query string
      const res = await DELETE(
        createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-master&role=admin&targetRole=admin")
      );
      expect(res.status).toBe(403);
      expect(mockBuilder.delete).not.toHaveBeenCalled();
    });
  });

  /* =========================================================
     3. Safety, Audit & Data Integrity
  ========================================================= */
  describe("Safety, Audit & Data Integrity", () => {
    it("removing an admin only deletes from admins table; does not touch auth, participants, or payments", async () => {
      mockAsPrimaryMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-del", role: "admin" },
        error: null,
      });

      await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-del"));

      expect(mockBuilder.delete).toHaveBeenCalled();
      const tables = mockFrom.mock.calls.map((c) => c[0]);
      expect(tables).toContain("admins");
      expect(tables).toContain("admin_audit_logs");
      expect(tables).not.toContain("participants");
      expect(tables).not.toContain("payment_orders");
      expect(tables).not.toContain("events");
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it("existing user re-invitation sends reset email and logs audit", async () => {
      mockAsPrimaryMaster();
      mockListUsers.mockResolvedValueOnce({
        data: { users: [{ id: "existing-u", email: "exist@example.com" }] },
        error: null,
      });
      mockBuilder.insert.mockResolvedValueOnce({ error: null });

      const res = await POST(createMockRequest("POST", { email: "exist@example.com", role: "admin" }));
      expect(res.status).toBe(201);
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith("exist@example.com", {
        redirectTo: "http://localhost/admin/reset-password",
      });
      expect(mockBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "ADD_ADMIN",
          target_id: "existing-u",
        })
      );
    });

    it("prevents re-adding an already configured administrator with 409 Conflict", async () => {
      mockAsPrimaryMaster();
      mockBuilder.select.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce({
          data: [{ user_id: "already-admin-id", role: "admin" }],
          error: null,
        }),
      });
      mockListUsers.mockResolvedValueOnce({
        data: { users: [{ id: "already-admin-id", email: "existing@example.com" }] },
        error: null,
      });

      const res = await POST(createMockRequest("POST", { email: "existing@example.com", role: "admin" }));
      expect(res.status).toBe(409);
    });

    it("GET endpoint returns admins list, isSuperMaster flag and explicit capabilities", async () => {
      mockAsPrimaryMaster();
      mockBuilder.order.mockResolvedValueOnce({
        data: [
          { user_id: "sm-id", role: "master", created_at: "2026-01-01" },
          { user_id: "u2", role: "admin", created_at: "2026-01-02" },
        ],
        error: null,
      });
      mockGetUserById.mockImplementation((id: string) => {
        if (id === "sm-id") {
          return Promise.resolve({ data: { user: { email: "jashan082006@gmail.com" } } });
        }
        return Promise.resolve({ data: { user: { email: "admin2@example.com" } } });
      });

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.isSuperMaster).toBe(true);
      expect(data.canCreateMaster).toBe(true);
      expect(data.canCreateNormal).toBe(true);
      expect(data.admins).toHaveLength(2);
      expect(data.admins[0].isPrimary).toBe(true);
      expect(data.admins[1].isPrimary).toBe(false);
    });
  });

  /* =========================================================
     4. Admin Permission Boundaries & Rate Limiting Hardening
  ========================================================= */
  describe("Admin Permission Boundaries & Rate Limiting Hardening", () => {
    // Gap 1: PATCH returns 400 when newRole matches targetAdmin.role
    it("PATCH returns 400 when newRole matches targetAdmin.role", async () => {
      mockAsPrimaryMaster("primary-id", "primary@example.com");
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-master-id", role: "master" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "target-master-id", email: "othermaster@example.com" } },
      });

      const res = await PATCH(
        createMockRequest("PATCH", { userId: "target-master-id", newRole: "master" })
      );
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("Administrator already has this role.");
      expect(mockBuilder.update).not.toHaveBeenCalled();
    });

    // Gap 2: Non-primary Master retains application access (/api/admin/events) but is denied role management (403)
    it("Non-primary Master retains application access (/api/admin/events) but is denied admin role management (403)", async () => {
      process.env.PRIMARY_ADMIN_USER_ID = "primary-uuid";
      mockAsOtherMaster("non-primary-uuid", "othermaster@example.com");

      // 1. Can access /api/admin/events (application capability)
      mockBuilder.order.mockReturnThis();
      const eventsRes = await getEvents();
      expect(eventsRes.status).toBe(200);

      // 2. Cannot create Master Admin via POST /api/admin/admins -> 403
      const postRes = await POST(
        createMockRequest("POST", { email: "candidate@example.com", role: "master" })
      );
      expect(postRes.status).toBe(403);
      const postData = await postRes.json();
      expect(postData.error).toBe("Only the Primary Master Admin can create Master Admins.");

      // 3. Cannot promote/demote via PATCH /api/admin/admins -> 403
      const patchRes = await PATCH(
        createMockRequest("PATCH", { userId: "some-user-id", newRole: "master" })
      );
      expect(patchRes.status).toBe(403);
      const patchData = await patchRes.json();
      expect(patchData.error).toBe("Only the Primary Master Admin can promote or demote administrators.");

      // 4. Cannot remove Master Admin via DELETE /api/admin/admins -> 403
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "target-master-id", role: "master" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "target-master-id", email: "target@example.com" } },
      });
      const deleteRes = await DELETE(
        createMockRequest("DELETE", null, "http://localhost/api/admin/admins?userId=target-master-id")
      );
      expect(deleteRes.status).toBe(403);
      const deleteData = await deleteRes.json();
      expect(deleteData.error).toBe("Only the Primary Master Admin can remove Master Admins.");
    });

    // Gap 3: Rate Limiting on POST, PATCH, and DELETE
    it("enforces rate limiting of 30 requests/minute on POST /api/admin/admins", async () => {
      mockAsPrimaryMaster("rate-post-id", "rate-post@example.com");

      // Fire 30 requests (allowed by rate limiter; fail validation with 400)
      for (let i = 0; i < 30; i++) {
        const res = await POST(createMockRequest("POST", { email: "" }));
        expect(res.status).toBe(400);
      }

      // Request 31 exceeds rate limit -> 429 Too Many Requests
      const res31 = await POST(createMockRequest("POST", { email: "" }));
      expect(res31.status).toBe(429);
      const data = await res31.json();
      expect(data.error).toBe("Too many admin requests. Please slow down.");
    });

    it("enforces rate limiting of 30 requests/minute on PATCH /api/admin/admins", async () => {
      mockAsPrimaryMaster("rate-patch-id", "rate-patch@example.com");

      // Fire 30 requests (allowed by rate limiter; fail validation with 400)
      for (let i = 0; i < 30; i++) {
        const res = await PATCH(createMockRequest("PATCH", { userId: "" }));
        expect(res.status).toBe(400);
      }

      // Request 31 exceeds rate limit -> 429 Too Many Requests
      const res31 = await PATCH(createMockRequest("PATCH", { userId: "" }));
      expect(res31.status).toBe(429);
      const data = await res31.json();
      expect(data.error).toBe("Too many admin requests. Please slow down.");
    });

    it("enforces rate limiting of 30 requests/minute on DELETE /api/admin/admins", async () => {
      mockAsPrimaryMaster("rate-del-id", "rate-del@example.com");

      // Fire 30 requests (allowed by rate limiter; fail validation with 400)
      for (let i = 0; i < 30; i++) {
        const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins"));
        expect(res.status).toBe(400);
      }

      // Request 31 exceeds rate limit -> 429 Too Many Requests
      const res31 = await DELETE(createMockRequest("DELETE", null, "http://localhost/api/admin/admins"));
      expect(res31.status).toBe(429);
      const data = await res31.json();
      expect(data.error).toBe("Too many admin requests. Please slow down.");
    });
  });

  describe("8. PASSWORD RESET (POST /api/admin/admins/reset-password)", () => {
    it("Allows Primary Master to reset a Master Admin", async () => {
      mockAsPrimaryMaster("primary-uuid", "primarymaster@example.com");
      mockBuilder.single.mockResolvedValueOnce({
        data: { user_id: "master-admin-uuid", role: "master" },
        error: null,
      });
      const res = await RESET_POST(
        createMockRequest("POST", { userId: "master-admin-uuid" })
      );
      expect(res.status).toBe(200);
    });

    it("Allows Primary Master to reset a Normal Admin", async () => {
      mockAsPrimaryMaster("primary-uuid", "primarymaster@example.com");
      mockBuilder.single.mockResolvedValueOnce({
        data: { user_id: "normal-admin-uuid", role: "admin" },
        error: null,
      });
      const res = await RESET_POST(
        createMockRequest("POST", { userId: "normal-admin-uuid" })
      );
      expect(res.status).toBe(200);
    });

    it("PREVENTS Master Admin from resetting Primary Master", async () => {
      mockAsOtherMaster("master-admin-uuid", "masteradmin@example.com");
      process.env.PRIMARY_ADMIN_USER_ID = "primary-uuid";
      mockBuilder.single.mockResolvedValueOnce({
        data: { user_id: "primary-uuid", role: "master" },
        error: null,
      });
      const res = await RESET_POST(
        createMockRequest("POST", { userId: "primary-uuid" })
      );
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Only the Primary Master");
    });

    it("Allows Master Admin to reset a Normal Admin", async () => {
      mockAsOtherMaster("master-admin-uuid", "masteradmin@example.com");
      mockBuilder.single.mockResolvedValueOnce({
        data: { user_id: "normal-admin-uuid", role: "admin" },
        error: null,
      });
      const res = await RESET_POST(
        createMockRequest("POST", { userId: "normal-admin-uuid" })
      );
      expect(res.status).toBe(200);
    });

    it("PREVENTS Normal Admin from resetting any admin", async () => {
      mockAsNormalAdmin();
      const res = await RESET_POST(
        createMockRequest("POST", { userId: "any-admin-uuid" })
      );
      expect(res.status).toBe(403);
    });
  });

  describe("9. SELF-SERVICE FORGOT PASSWORD (POST /api/admin/auth/forgot-password)", () => {
    it("Always returns success regardless of email validity (No Enumeration)", async () => {
      mockResetPasswordForEmail.mockResolvedValueOnce({
        data: {},
        error: null,
      });

      const res = await FORGOT_PASSWORD_POST(
        createMockRequest("POST", { email: "somebody@example.com" })
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toContain("If an administrator account exists for this email");
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        "somebody@example.com",
        expect.objectContaining({ redirectTo: expect.any(String) })
      );
    });

    it("Requires email parameter", async () => {
      const res = await FORGOT_PASSWORD_POST(
        createMockRequest("POST", {})
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("Email is required.");
    });
  });

  describe("10. SELF-SERVICE PASSWORD RESET UPDATE (POST /api/admin/auth/reset-password)", () => {
    it("Requires Bearer authorization header", async () => {
      const req = {
        headers: new Headers(),
        json: async () => ({ password: "ValidPassword123" }),
      } as unknown as Request;

      const res = await SELF_RESET_PASSWORD_POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Missing or invalid authorization session");
    });

    it("Rejects invalid recovery token", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: "Invalid token" },
      });

      const headers = new Headers();
      headers.set("Authorization", "Bearer invalid-token");
      const req = {
        headers,
        json: async () => ({ password: "ValidPassword123" }),
      } as unknown as Request;

      const res = await SELF_RESET_PASSWORD_POST(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("invalid or has expired");
    });

    it("Rejects user not in admins table", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: "non-admin-user", email: "nonadmin@example.com" } },
        error: null,
      });

      mockBuilder.single = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: "Not found" },
      });

      const headers = new Headers();
      headers.set("Authorization", "Bearer valid-token");
      const req = {
        headers,
        json: async () => ({ password: "ValidPassword123" }),
      } as unknown as Request;

      const res = await SELF_RESET_PASSWORD_POST(req);
      expect(res.status).toBe(403);
    });

    it("Validates password complexity", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: "admin-user", email: "admin@example.com" } },
        error: null,
      });

      mockBuilder.single = vi.fn().mockResolvedValueOnce({
        data: { user_id: "admin-user", role: "admin" },
        error: null,
      });

      const headers = new Headers();
      headers.set("Authorization", "Bearer valid-token");
      const req = {
        headers,
        json: async () => ({ password: "short" }),
      } as unknown as Request;

      const res = await SELF_RESET_PASSWORD_POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("at least 8 characters");
    });

    it("Successfully updates password for valid admin recovery session", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: "admin-user", email: "admin@example.com" } },
        error: null,
      });

      mockBuilder.single = vi.fn().mockResolvedValueOnce({
        data: { user_id: "admin-user", role: "admin" },
        error: null,
      });

      mockUpdateUserById.mockResolvedValueOnce({
        data: { user: { id: "admin-user" } },
        error: null,
      });

      const headers = new Headers();
      headers.set("Authorization", "Bearer valid-token");
      const req = {
        headers,
        json: async () => ({ password: "NewStrongPassword123" }),
      } as unknown as Request;

      const res = await SELF_RESET_PASSWORD_POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockUpdateUserById).toHaveBeenCalledWith(
        "admin-user",
        { password: "NewStrongPassword123" }
      );
    });

    it("Ignored client-provided userId/email and updates ONLY authenticated token user", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: "legitimate-token-user", email: "legit@example.com" } },
        error: null,
      });

      mockBuilder.single = vi.fn().mockResolvedValueOnce({
        data: { user_id: "legitimate-token-user", role: "admin" },
        error: null,
      });

      mockUpdateUserById.mockResolvedValueOnce({
        data: { user: { id: "legitimate-token-user" } },
        error: null,
      });

      const headers = new Headers();
      headers.set("Authorization", "Bearer valid-token");
      // Malicious caller tries to inject victim's user ID and email
      const req = {
        headers,
        json: async () => ({
          password: "NewStrongPassword123",
          userId: "victim-user-id",
          email: "victim@example.com",
        }),
      } as unknown as Request;

      const res = await SELF_RESET_PASSWORD_POST(req);
      expect(res.status).toBe(200);
      // Confirmed: ONLY updates the token's authenticated user ID, NOT victim-user-id!
      expect(mockUpdateUserById).toHaveBeenCalledWith(
        "legitimate-token-user",
        { password: "NewStrongPassword123" }
      );
      expect(mockUpdateUserById).not.toHaveBeenCalledWith(
        "victim-user-id",
        expect.anything()
      );
    });

    it("Rejects missing password in payload", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: "admin-user", email: "admin@example.com" } },
        error: null,
      });

      mockBuilder.single = vi.fn().mockResolvedValueOnce({
        data: { user_id: "admin-user", role: "admin" },
        error: null,
      });

      const headers = new Headers();
      headers.set("Authorization", "Bearer valid-token");
      const req = {
        headers,
        json: async () => ({}),
      } as unknown as Request;

      const res = await SELF_RESET_PASSWORD_POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe("New password is required.");
    });
  });
});
