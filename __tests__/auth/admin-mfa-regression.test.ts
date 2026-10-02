import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../lib/supabase/server";
import { createServerClient } from "@supabase/ssr";

// Mock the dependencies
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: vi.fn(),
    setAll: vi.fn(),
  })),
}));

vi.mock("../../lib/supabase/admin-session", () => ({
  isAdminSessionExpired: vi.fn(() => false),
  getAdminSessionMaxAgeSeconds: vi.fn(),
  DEFAULT_ADMIN_SESSION_MAX_AGE_SECONDS: 3600,
  toAdminSessionCookieOptions: vi.fn(),
}));

describe("Admin MFA Regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("After successful MFA verification, the authenticated admin session remains valid when navigating to /admin and calling /api/admin/registrations.", async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user_123", email: "test@example.com" } },
          error: null,
        }),
        signOut: vi.fn().mockResolvedValue({}),
        mfa: {
          getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
            data: { currentLevel: "aal2" },
            error: null,
          }),
        },
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { user_id: "user_123", role: "master", accommodation_access: undefined },
          error: null,
        }),
      }),
    };

    vi.mocked(createServerClient).mockReturnValue(mockSupabase as any);

    const result = await requireAdmin();

    // Ensure we do NOT get a 403 Forbidden which would trigger a redirect to login.
    expect(result.status).toBe(200);
    expect(result.error).toBeNull();
    expect(result.role).toBe("master");
    
    // Check that we safely handled the undefined accommodation_access
    expect(result.accommodation_access).toBe(false);
  });
});
