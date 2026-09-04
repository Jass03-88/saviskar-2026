import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE, PATCH } from "@/app/api/admin/admins/route";
import * as serverLib from "@/lib/supabase/server";
import { resetRateLimitStore } from "@/lib/rate-limit";

// Mock environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

const mockBuilder: any = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockReturnThis(),
};

mockBuilder.then = function (resolve: any) {
  resolve({ data: null, error: null });
};

const mockServerClient = {
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: "sm-id", email: "jashan082006@gmail.com" } },
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

const mockFrom = vi.fn((_table: string) => mockBuilder);

const mockGetUserById = vi.fn().mockResolvedValue({
  data: { user: { id: "target-user", email: "test@example.com" } },
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
          resetPasswordForEmail: mockResetPasswordForEmail,
          admin: {
            getUserById: mockGetUserById,
            listUsers: mockListUsers,
            inviteUserByEmail: mockInviteUserByEmail,
            deleteUser: mockDeleteUser,
          },
        },
      };
    },
  };
});

describe("Admin Management API Authorization & Hardened Rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    delete process.env.PRIMARY_ADMIN_USER_ID;
    delete process.env.PRIMARY_ADMIN_EMAIL;

    // Reset default builder behavior
    Object.keys(mockBuilder).forEach((key) => {
      if (typeof mockBuilder[key].mockClear === "function") {
        mockBuilder[key].mockClear();
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
    mockBuilder.then = function (resolve: any) {
      resolve({ data: null, error: null });
    };

    mockGetUserById.mockResolvedValue({
      data: { user: { id: "target-user", email: "test@example.com" } },
    });
  });

  const createMockRequest = (
    method: string,
    body?: any,
    url = "http://localhost/api/admin/admins"
  ) => {
    return {
      method,
      url,
      headers: new Headers(),
      json: async () => body,
    } as unknown as Request;
  };

  const mockAsPrimaryMaster = (id = "sm-id", email = "jashan082006@gmail.com") => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {} as any,
      user: { id, email } as any,
      role: "master",
      error: null,
      status: 200,
    });
  };

  const mockAsOtherMaster = (id = "other-master-id", email = "othermaster@example.com") => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {} as any,
      user: { id, email } as any,
      role: "master",
      error: null,
      status: 200,
    });
  };

  const mockAsNormalAdmin = (id = "normal-id", email = "normal@example.com") => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {} as any,
      user: { id, email } as any,
      role: "admin",
      error: "Master Admin access required" as const,
      status: 403,
    });
  };

  const mockAsUnauthenticated = () => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {} as any,
      user: null,
      role: null,
      error: "Unauthorized" as const,
      status: 401,
    });
  };

  const mockAsMfaRequired = (id = "mfa-id", email = "master-no-mfa@example.com") => {
    vi.spyOn(serverLib, "requireMasterAdmin").mockResolvedValue({
      supabase: {} as any,
      user: { id, email } as any,
      role: "master",
      error: "MFA_REQUIRED" as const,
      status: 403,
    });
  };

  /* =========================================================
     1. Primary Master Identity Determination
  ========================================================= */
  describe("Primary Master Identity Determination", () => {
    it("identifies Primary Master via email fallback with case/whitespace normalization when env var is unset", () => {
      expect(serverLib.isPrimaryMaster({ id: "any-id", email: "  jAshan082006@Gmail.cOm " })).toBe(true);
      expect(serverLib.isPrimaryMaster({ id: "any-id", email: "other@gmail.com" })).toBe(false);
      expect(serverLib.isPrimaryMaster(null)).toBe(false);
    });

    it("identifies Primary Master strictly via PRIMARY_ADMIN_USER_ID when configured", () => {
      process.env.PRIMARY_ADMIN_USER_ID = "immutable-primary-uuid";

      // Matching immutable user ID is primary regardless of email
      expect(
        serverLib.isPrimaryMaster({ id: "immutable-primary-uuid", email: "changed-email@domain.com" })
      ).toBe(true);

      // Wrong user ID even with old email is NOT primary
      expect(
        serverLib.isPrimaryMaster({ id: "impostor-uuid", email: "jashan082006@gmail.com" })
      ).toBe(false);
    });

    it("requireSuperMasterAdmin succeeds for Primary Master and rejects others", async () => {
      // Primary Master
      mockServerClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: "sm-id", email: "jashan082006@gmail.com" } },
        error: null,
      });
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { role: "master" }, error: null });
      const primaryAuth = await serverLib.requireSuperMasterAdmin();
      expect(primaryAuth.error).toBe(null);

      // Other Master
      mockServerClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: "other-id", email: "other@example.com" } },
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
      mockAsOtherMaster();
      mockBuilder.maybeSingle.mockResolvedValueOnce({
        data: { user_id: "primary-master-id", role: "master" },
        error: null,
      });
      mockGetUserById.mockResolvedValueOnce({
        data: { user: { id: "primary-master-id", email: "jashan082006@gmail.com" } },
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
});
