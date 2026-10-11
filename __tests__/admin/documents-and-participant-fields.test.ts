import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/registrations/route";
import { POST as postSignedUrl } from "@/app/api/admin/documents/signed-url/route";
import * as serverLib from "@/lib/supabase/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

// Test state controller for mock DB and Storage
let mockParticipantsDb: any[] = [];
let mockParticipantEventsDb: any[] = [];
let mockFacultyDb: any[] = [];
let mockStorageFiles: Set<string> = new Set();
let storageShouldError = false;

function createMockAdminClient() {
  return {
    from: (table: string) => {
      if (table === "participant_events") {
        const builder: any = {
          select: () => builder,
          order: () => builder,
          range: (from: number, to: number) => {
            const paged = mockParticipantEventsDb.slice(from, to + 1);
            return Promise.resolve({
              data: paged,
              count: mockParticipantEventsDb.length,
              error: null,
            });
          },
        };
        return builder;
      }

      if (table === "participants") {
        return {
          select: (cols?: string) => ({
            in: (field: string, ids: string[]) => {
              const matched = mockParticipantsDb.filter((p) => ids.includes(p.id));
              return Promise.resolve({ data: matched, error: null });
            },
            eq: (field: string, val: string) => ({
              limit: (n: number) => {
                const matched = mockParticipantsDb.filter((p) => p[field] === val).slice(0, n);
                return Promise.resolve({ data: matched, error: null });
              },
            }),
          }),
        };
      }

      if (table === "events") {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [{ id: "evt-1", name: "Hackathon", category: "Technical" }],
                error: null,
              }),
          }),
        };
      }

      if (table === "participant_event_members") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }

      if (table === "payment_order_items") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }

      if (table === "faculty_incharges") {
        return {
          select: () => ({
            in: (field: string, groupIds: string[]) => {
              const matched = mockFacultyDb.filter((f) => groupIds.includes(f.registration_group_id));
              return Promise.resolve({ data: matched, error: null });
            },
          }),
        };
      }

      return {
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: vi.fn((filePath: string, expiresIn: number) => {
          if (storageShouldError || !mockStorageFiles.has(filePath)) {
            return Promise.resolve({
              data: null,
              error: { message: "Object not found" },
            });
          }
          return Promise.resolve({
            data: {
              signedUrl: `https://example.supabase.co/storage/v1/object/sign/${bucket}/${filePath}?token=test-signed-token`,
            },
            error: null,
          });
        }),
      }),
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => createMockAdminClient(),
}));

describe("Admin Registrations - Participant Gender, State & ID Card Fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageShouldError = false;
    mockStorageFiles = new Set(["aman@test.com/id_card.jpg", "faculty/verma.jpg"]);

    mockParticipantsDb = [
      {
        id: "part-1",
        participant_id: "SVK26-11111111",
        name: "Aman Sharma",
        college: "ABC College",
        email: "aman@test.com",
        phone: "9876543210",
        photo_url: "https://example.com/photo.jpg",
        gender: "male",
        state: "Punjab",
        id_card_storage_path: "aman@test.com/id_card.jpg",
        created_at: "2026-09-01T10:00:00Z",
      },
    ];

    mockParticipantEventsDb = [
      {
        id: "pe-1",
        participant_id: "part-1",
        event_id: "evt-1",
        registration_status: "confirmed",
        payment_status: "paid",
        payment_amount: 500,
        payment_id: "pay-1",
        team_name: null,
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
        registration_group_id: "grp-1",
        is_archived: false,
        created_at: "2026-09-01T10:00:00Z",
      },
    ];

    mockFacultyDb = [
      {
        id: "fac-1",
        registration_group_id: "grp-1",
        participant_id: "part-fac",
        participants: {
          id: "part-fac",
          name: "Prof. Verma",
          email: "verma@test.com",
          phone: "9876500000",
          college: "ABC College",
          gender: "male",
          state: "Punjab",
          id_card_storage_path: "faculty/verma.jpg",
        },
      },
    ];

    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      supabase: {},
      user: { id: "admin-uuid", email: "admin@example.com" },
      role: "master",
      error: null,
      status: 200,
    } as unknown as Awaited<ReturnType<typeof serverLib.requireAdmin>>);
  });

  it("returns gender, state, and id_card_storage_path in participant data without overwriting populated values", async () => {
    const req = new Request("https://localhost/api/admin/registrations");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.registrations).toHaveLength(1);

    const reg = json.registrations[0];
    expect(reg.participant.gender).toBe("male");
    expect(reg.participant.state).toBe("Punjab");
    expect(reg.participant.id_card_storage_path).toBe("aman@test.com/id_card.jpg");
    expect(reg.participant.photo_url).toBe("https://example.com/photo.jpg");

    // Faculty details mapped
    expect(reg.faculty).not.toBeNull();
    expect(reg.faculty.name).toBe("Prof. Verma");
    expect(reg.faculty.id_card_storage_path).toBe("faculty/verma.jpg");
  });

  it("handles null id_card_storage_path gracefully without error", async () => {
    mockParticipantsDb[0].id_card_storage_path = null;
    const req = new Request("https://localhost/api/admin/registrations");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.registrations[0].participant.id_card_storage_path).toBeNull();
  });
});

describe("Admin Documents - Signed URL Security & Functionality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageShouldError = false;
    mockStorageFiles = new Set(["valid_participant@test.com/id_card.jpg"]);
    mockParticipantsDb = [
      {
        id: "p-1",
        id_card_storage_path: "valid_participant@test.com/id_card.jpg",
      },
    ];
  });

  it("rejects unauthenticated requests with 401", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: null,
      error: "Authentication required.",
      status: 401,
    } as any);

    const req = new Request("https://localhost/api/admin/documents/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "valid_participant@test.com/id_card.jpg" }),
    });

    const res = await postSignedUrl(req as any);
    expect(res.status).toBe(401);
  });

  it("rejects missing or empty path with 400", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: { id: "admin-1" },
      role: "admin",
      status: 200,
    } as any);

    const req = new Request("https://localhost/api/admin/documents/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "   " }),
    });

    const res = await postSignedUrl(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/required/i);
  });

  it("rejects path traversal attempts with 400", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: { id: "admin-1" },
      role: "admin",
      status: 200,
    } as any);

    const req = new Request("https://localhost/api/admin/documents/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../../../etc/passwd" }),
    });

    const res = await postSignedUrl(req as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("rejects arbitrary paths not present in database participants with 403", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: { id: "admin-1" },
      role: "admin",
      status: 200,
    } as any);

    const req = new Request("https://localhost/api/admin/documents/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "arbitrary_user@test.com/id_card.jpg" }),
    });

    const res = await postSignedUrl(req as any);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/unauthorized/i);
  });

  it("generates short-lived signed URL for valid registered participant path", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: { id: "admin-1" },
      role: "admin",
      status: 200,
    } as any);

    const req = new Request("https://localhost/api/admin/documents/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "valid_participant@test.com/id_card.jpg" }),
    });

    const res = await postSignedUrl(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.signedUrl).toContain("valid_participant@test.com/id_card.jpg");
    expect(json.signedUrl).toContain("token=test-signed-token");
  });

  it("returns 404 when file is registered in DB but missing from storage", async () => {
    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: { id: "admin-1" },
      role: "admin",
      status: 200,
    } as any);

    mockParticipantsDb = [{ id: "p-2", id_card_storage_path: "missing@test.com/id.jpg" }];
    // File not added to mockStorageFiles

    const req = new Request("https://localhost/api/admin/documents/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "missing@test.com/id.jpg" }),
    });

    const res = await postSignedUrl(req as any);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/missing or inaccessible/i);
  });
});
