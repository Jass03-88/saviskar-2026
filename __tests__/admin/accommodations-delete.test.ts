import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE } from "@/app/api/admin/accommodations/route";
import { NextRequest } from "next/server";

const mockRequireAccommodationAdmin = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  requireAccommodationAdmin: () => mockRequireAccommodationAdmin(),
}));

const mockRpc = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: mockRpc,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SECRET_KEY = "test_secret_key";
});

describe("DELETE /api/admin/accommodations", () => {
  it("rejects unauthorized access when not accommodation admin", async () => {
    mockRequireAccommodationAdmin.mockResolvedValueOnce({
      error: "Accommodation access required",
      status: 403,
    });

    const req = new NextRequest("http://localhost:3000/api/admin/accommodations?id=acc-1", {
      method: "DELETE",
    });

    const res = await DELETE(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 if accommodation ID is missing", async () => {
    mockRequireAccommodationAdmin.mockResolvedValueOnce({
      user: { id: "admin-1" },
      role: "master",
      accommodation_access: true,
      status: 200,
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/admin/accommodations", {
      method: "DELETE",
    });

    const res = await DELETE(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("handles atomic soft-cancellation via RPC when payment history exists", async () => {
    mockRequireAccommodationAdmin.mockResolvedValueOnce({
      user: { id: "admin-1" },
      role: "admin",
      accommodation_access: true,
      status: 200,
      error: null,
    });

    mockRpc.mockResolvedValueOnce({
      data: { success: true, action: "cancelled" },
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/admin/accommodations?id=acc-123", {
      method: "DELETE",
    });

    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("Financial history preserved");
    
    expect(mockRpc).toHaveBeenCalledWith("delete_accommodation_permanently", {
      p_accommodation_id: "acc-123",
      p_admin_id: "admin-1",
    });
  });

  it("handles atomic soft-cancellation via RPC even when no payment history exists", async () => {
    mockRequireAccommodationAdmin.mockResolvedValueOnce({
      user: { id: "admin-1" },
      role: "admin",
      accommodation_access: true,
      status: 200,
      error: null,
    });

    mockRpc.mockResolvedValueOnce({
      data: { success: true, action: "cancelled" },
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/admin/accommodations?id=acc-123", {
      method: "DELETE",
    });

    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("Accommodation cancelled and room released. Financial history preserved.");
    
    expect(mockRpc).toHaveBeenCalledWith("delete_accommodation_permanently", {
      p_accommodation_id: "acc-123",
      p_admin_id: "admin-1",
    });
  });

  it("returns 500 when RPC fails (e.g. rollback occurred or constraint violated)", async () => {
    mockRequireAccommodationAdmin.mockResolvedValueOnce({
      user: { id: "admin-1" },
      role: "admin",
      accommodation_access: true,
      status: 200,
      error: null,
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Database transaction failed", code: "P0001" },
    });

    const req = new NextRequest("http://localhost:3000/api/admin/accommodations?id=acc-123", {
      method: "DELETE",
    });

    const res = await DELETE(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("DELETE_FAILED");
    expect(body.error.message).toBe("Database transaction failed");
  });
});

