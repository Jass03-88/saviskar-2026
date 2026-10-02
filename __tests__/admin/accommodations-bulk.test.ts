import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as bulkCheckIn } from "../../app/api/admin/accommodations/bulk-check-in/route";
import { POST as bulkCheckOut } from "../../app/api/admin/accommodations/bulk-check-out/route";
import { POST as autoAllocate } from "../../app/api/admin/accommodations/auto-allocate/route";
import { requireAccommodationAdmin } from "../../lib/supabase/server";

vi.mock("../../lib/supabase/server", () => ({
  requireAccommodationAdmin: vi.fn(),
}));

// Mock process.env to ensure getSupabaseAdmin initializes
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

// We'll mock the supabase client
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
      };
      return {
        from: vi.fn().mockReturnValue(mockQuery),
        rpc: vi.fn().mockResolvedValue({ error: null }),
      };
    },
  };
});

describe("Phase 3D: Accommodation Bulk Workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Bulk Check-in rejects unauthorized users", async () => {
    vi.mocked(requireAccommodationAdmin).mockResolvedValue({ error: "Unauthorized", status: 401 } as any);
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ participantAccommodationIds: ["1", "2"] })
    });
    const res = await bulkCheckIn(req);
    expect(res.status).toBe(401);
  });

  it("2. Bulk Check-out rejects unauthorized users", async () => {
    vi.mocked(requireAccommodationAdmin).mockResolvedValue({ error: "Unauthorized", status: 401 } as any);
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ participantAccommodationIds: ["1", "2"] })
    });
    const res = await bulkCheckOut(req);
    expect(res.status).toBe(401);
  });

  it("3. Bulk Auto-Allocate rejects unauthorized users", async () => {
    vi.mocked(requireAccommodationAdmin).mockResolvedValue({ error: "Unauthorized", status: 401 } as any);
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ participantAccommodationIds: ["1", "2"] })
    });
    const res = await autoAllocate(req);
    expect(res.status).toBe(401);
  });

  it("4. Bulk Check-in validates input format", async () => {
    vi.mocked(requireAccommodationAdmin).mockResolvedValue({ user: { id: "admin-123" } } as any);
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ somethingElse: "invalid" })
    });
    const res = await bulkCheckIn(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toMatch(/required/);
  });

  it("5. Bulk operations enforce idempotency limits (max 500)", async () => {
    vi.mocked(requireAccommodationAdmin).mockResolvedValue({ user: { id: "admin-123" } } as any);
    
    const hugeArray = Array.from({ length: 501 }).map((_, i) => String(i));
    const req = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ participantAccommodationIds: hugeArray })
    });
    const res = await bulkCheckIn(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("LIMIT_EXCEEDED");
  });
});
