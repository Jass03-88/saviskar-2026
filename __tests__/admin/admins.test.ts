import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE, PATCH } from "@/app/api/admin/admins/route";
import * as serverLib from "@/lib/supabase/server";

// Mock environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

// Mock the Supabase server utils by importing and spying
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

mockBuilder.then = function(resolve: any) {
  resolve({ data: null, error: null });
};

// For requireSuperMasterAdmin testing
const mockServerClient = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { email: "jashan082006@gmail.com" } }, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: "aal2" }, error: null }) }
  },
  from: vi.fn().mockReturnValue(mockBuilder)
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => mockServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: vi.fn(), setAll: vi.fn() })
}));

const mockFrom = vi.fn((table: string) => mockBuilder);

const mockGetUserById = vi.fn().mockResolvedValue({ data: { user: { email: "test@example.com" } } });
const mockListUsers = vi.fn().mockResolvedValue({ data: { users: [] }, error: null });
const mockInviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: "new" } }, error: null });
const mockDeleteUser = vi.fn();

// Mock Supabase JS client
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: () => {
      return {
        from: mockFrom,
        auth: {
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

describe("Admin Management API Authorization & Rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(serverLib, "requireMasterAdmin");
    vi.spyOn(serverLib, "requireSuperMasterAdmin");
  });

  const createMockRequest = (method: string, body?: any, url = "http://localhost/api/admin/admins") => {
    return {
      method,
      url,
      json: async () => body,
    } as unknown as Request;
  };

  describe("Super Master Authority & Identification", () => {
    it("14. Case/whitespace-normalized Super Master identity is handled correctly", async () => {
      // Overwrite the mock to return a messy email
      mockServerClient.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: "test", email: "  jAshan082006@Gmail.cOm " } },
        error: null,
      });
      // Mock requireMasterAdmin's db check
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { role: "master" }, error: null });

      const auth = await serverLib.requireSuperMasterAdmin();
      expect(auth.error).toBe(null);
      expect(auth.user?.email).toBe("  jAshan082006@Gmail.cOm ");
    });

    it("13. Forged email in request body cannot grant Super Master authority", async () => {
      // Setup authenticated as normal admin, but sending super master email in body
      vi.mocked(serverLib.requireSuperMasterAdmin).mockResolvedValue({
        supabase: {} as any,
        user: { id: "2", email: "attacker@gmail.com" } as any,
        role: "admin",
        error: "Super Master Admin access required",
        status: 403,
      } as any);

      const res = await POST(createMockRequest("POST", { email: "jashan082006@gmail.com", role: "master" }));
      expect(res.status).toBe(403);
    });

    it("15. Unauthorized direct API requests return 403", async () => {
      vi.mocked(serverLib.requireSuperMasterAdmin).mockResolvedValue({
        error: "Forbidden",
        status: 403,
      } as any);

      const res = await PATCH(createMockRequest("PATCH", { userId: "123", newRole: "master" }));
      expect(res.status).toBe(403);
    });
  });

  describe("Role Access Control (7-12)", () => {
    const methods = [
      { name: "POST", handler: () => POST(createMockRequest("POST", { email: "test@example.com" })) },
      { name: "PATCH", handler: () => PATCH(createMockRequest("PATCH", { userId: "123", newRole: "master" })) },
      { name: "DELETE", handler: () => DELETE(createMockRequest("DELETE", null, "http://localhost/api?userId=123")) },
    ];

    describe("Other Master Admin Restrictions", () => {
      beforeEach(() => {
        vi.mocked(serverLib.requireSuperMasterAdmin).mockResolvedValue({
          supabase: {} as any,
          user: { id: "2", email: "othermaster@gmail.com" } as any,
          role: "master",
          error: "Super Master Admin access required",
          status: 403,
        } as any);
      });

      methods.forEach(({ name, handler }) => {
        it(`7,8,9: Other Master Admin cannot ${name}`, async () => {
          const res = await handler();
          expect(res.status).toBe(403);
        });
      });
    });

    describe("Normal Admin Restrictions", () => {
      beforeEach(() => {
        vi.mocked(serverLib.requireSuperMasterAdmin).mockResolvedValue({
          supabase: {} as any,
          user: { id: "3", email: "normal@gmail.com" } as any,
          role: "admin",
          error: "Super Master Admin access required",
          status: 403,
        } as any);
      });

      methods.forEach(({ name, handler }) => {
        it(`10,11,12: Normal Admin cannot ${name}`, async () => {
          const res = await handler();
          expect(res.status).toBe(403);
        });
      });
    });
  });

  describe("Super Master Privileged Operations", () => {
    beforeEach(() => {
      vi.mocked(serverLib.requireSuperMasterAdmin).mockResolvedValue({
        supabase: {} as any,
        user: { id: "sm-id", email: "jashan082006@gmail.com" } as any,
        role: "master",
        error: null,
        status: 200,
      });
      // Reset builder methods
      Object.keys(mockBuilder).forEach(key => {
        if (typeof mockBuilder[key].mockClear === "function") {
          mockBuilder[key].mockClear();
        }
      });
    });

    it("1. Super Master can promote Normal -> Master", async () => {
      // For the first query: .select().maybeSingle() -> returns the target user
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { user_id: "target-1", role: "admin" }, error: null });
      // For the second query: .update().eq() -> returns success
      // We can just let .then() return the default { error: null }
      
      const res = await PATCH(createMockRequest("PATCH", { userId: "target-1", newRole: "master" }));
      expect(res.status).toBe(200);
      expect(mockFrom).toHaveBeenCalledWith("admins");
      expect(mockBuilder.update).toHaveBeenCalledWith({ role: "master" });
      
      // 21. Correct audit log
      expect(mockBuilder.insert).toHaveBeenCalledWith({
        admin_id: "sm-id",
        action_type: "PROMOTE_ADMIN",
        target_id: "target-1",
        details: { previous_role: "admin", new_role: "master" }
      });
    });

    it("2. Super Master can demote Master -> Normal", async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { user_id: "target-2", role: "master" }, error: null });
      
      const res = await PATCH(createMockRequest("PATCH", { userId: "target-2", newRole: "admin" }));
      expect(res.status).toBe(200);
      expect(mockBuilder.update).toHaveBeenCalledWith({ role: "admin" });

      // 21. Correct audit log
      expect(mockBuilder.insert).toHaveBeenCalledWith({
        admin_id: "sm-id",
        action_type: "DEMOTE_ADMIN",
        target_id: "target-2",
        details: { previous_role: "master", new_role: "admin" }
      });
    });

    it("3. Super Master can remove Normal Admin", async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { user_id: "target-3", role: "admin" }, error: null });
      
      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api?userId=target-3"));
      expect(res.status).toBe(200);
      expect(mockBuilder.delete).toHaveBeenCalled();
      
      // 21. Correct audit log
      expect(mockBuilder.insert).toHaveBeenCalledWith({
        admin_id: "sm-id",
        action_type: "REMOVE_ADMIN",
        target_id: "target-3",
        details: { previous_role: "admin" }
      });
    });

    it("4. Super Master can remove another Master Admin", async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { user_id: "target-4", role: "master" }, error: null });
      
      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api?userId=target-4"));
      expect(res.status).toBe(200);
      expect(mockBuilder.delete).toHaveBeenCalled();
      
      // 21. Correct audit log
      expect(mockBuilder.insert).toHaveBeenCalledWith({
        admin_id: "sm-id",
        action_type: "REMOVE_MASTER_ADMIN",
        target_id: "target-4",
        details: { previous_role: "master" }
      });
    });

    it("5. Super Master cannot remove itself", async () => {
      const res = await DELETE(createMockRequest("DELETE", null, "http://localhost/api?userId=sm-id"));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("You cannot remove yourself.");
    });

    it("6. Super Master cannot demote itself", async () => {
      const res = await PATCH(createMockRequest("PATCH", { userId: "sm-id", newRole: "admin" }));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("You cannot change your own role.");
    });

    it("16, 17, 18, 19, 20. Removing an admin does NOT touch auth, participants, payments, or events", async () => {
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { user_id: "target-delete", role: "master" }, error: null });
      
      await DELETE(createMockRequest("DELETE", null, "http://localhost/api?userId=target-delete"));
      
      // 16. Removes only admins mapping
      expect(mockBuilder.delete).toHaveBeenCalled();
      const tablesAccessed = mockFrom.mock.calls.map(call => call[0]);
      expect(tablesAccessed).toContain("admins");
      expect(tablesAccessed).toContain("admin_audit_logs");
      
      // 18, 19, 20. Does not touch other tables
      expect(tablesAccessed).not.toContain("participants");
      expect(tablesAccessed).not.toContain("payment_orders");
      expect(tablesAccessed).not.toContain("events");

      // 17. Supabase Auth is NOT deleted
      expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it("22. Repeated/double role-management requests cannot create inconsistent role state", async () => {
      // Target is already an admin
      mockBuilder.maybeSingle.mockResolvedValueOnce({ data: { user_id: "target-double", role: "admin" }, error: null });
      
      // Try to demote to admin again
      const res = await PATCH(createMockRequest("PATCH", { userId: "target-double", newRole: "admin" }));
      const data = await res.json();
      
      expect(res.status).toBe(400);
      expect(data.error).toBe("Administrator already has this role.");
      expect(mockBuilder.update).not.toHaveBeenCalled(); // Ensure no DB update was made
    });
  });
});
