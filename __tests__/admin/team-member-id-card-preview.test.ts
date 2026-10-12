import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getRegistrations } from "@/app/api/admin/registrations/route";
import { POST as postSignedUrl } from "@/app/api/admin/documents/signed-url/route";
import * as serverLib from "@/lib/supabase/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

let mockParticipantsDb: any[] = [];
let mockParticipantEventsDb: any[] = [];
let mockMembersDb: any[] = [];
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
              maybeSingle: () => {
                const matched = mockParticipantsDb.find((p) => p[field] === val);
                return Promise.resolve({ data: matched || null, error: null });
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
                data: [{ id: "evt-team-1", name: "RoboWars 2026", category: "Robotics" }],
                error: null,
              }),
          }),
        };
      }

      if (table === "participant_event_members") {
        return {
          select: () => ({
            in: (field: string, ids: string[]) => {
              const matched = mockMembersDb.filter((m) => ids.includes(m.participant_event_id));
              return Promise.resolve({ data: matched, error: null });
            },
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
            in: () => Promise.resolve({ data: mockFacultyDb, error: null }),
            eq: (field: string, val: string) => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
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

describe("SAVISKAR 2026 — Team Member ID Card Viewing and Shared Preview Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageShouldError = false;

    mockStorageFiles = new Set([
      "leader@test.com/leader_id.png",
      "teammate1@test.com/member1_id.png",
      "teammate2@test.com/member2_id.jpg",
      "faculty/mentor_id.jpg",
    ]);

    mockParticipantsDb = [
      {
        id: "p-leader",
        participant_id: "SVK26-LEADER01",
        name: "Leader Arjun",
        college: "CGC Landran",
        email: "leader@test.com",
        phone: "9876543210",
        photo_url: "https://example.com/arjun.jpg",
        gender: "male",
        state: "Punjab",
        id_card_storage_path: "leader@test.com/leader_id.png",
        created_at: "2026-09-01T10:00:00Z",
      },
      {
        id: "p-member-1",
        participant_id: "SVK26-MEMBER01",
        name: "Teammate Bhavna",
        college: "CGC Landran",
        email: "teammate1@test.com",
        phone: "9876543211",
        photo_url: null,
        gender: "female",
        state: "Punjab",
        id_card_storage_path: "teammate1@test.com/member1_id.png",
        created_at: "2026-09-01T10:05:00Z",
      },
      {
        id: "p-member-2",
        participant_id: "SVK26-MEMBER02",
        name: "Teammate Chetan",
        college: "IIT Ropar",
        email: "teammate2@test.com",
        phone: "9876543212",
        photo_url: null,
        gender: "male",
        state: "Punjab",
        id_card_storage_path: "teammate2@test.com/member2_id.jpg",
        created_at: "2026-09-01T10:10:00Z",
      },
      {
        id: "p-member-3",
        participant_id: "SVK26-MEMBER03",
        name: "Teammate Divya",
        college: "Thapar University",
        email: "teammate3@test.com",
        phone: "9876543213",
        photo_url: null,
        gender: "female",
        state: "Punjab",
        id_card_storage_path: null, // No ID card uploaded
        created_at: "2026-09-01T10:15:00Z",
      },
    ];

    mockParticipantEventsDb = [
      {
        id: "pe-team-1",
        participant_id: "p-leader",
        event_id: "evt-team-1",
        registration_status: "confirmed",
        payment_status: "paid",
        payment_amount: 1000,
        payment_id: "pay-team-1",
        team_name: "RoboTitans",
        checked_in: false,
        checked_in_at: null,
        main_checked_in: false,
        main_checked_in_at: null,
        registration_group_id: "grp-team-1",
        is_archived: false,
        created_at: "2026-09-01T10:00:00Z",
      },
    ];

    mockMembersDb = [
      {
        id: "mem-1",
        participant_event_id: "pe-team-1",
        name: "Leader Arjun",
        email: "leader@test.com",
        phone: "9876543210",
        is_team_leader: true,
        participant_id: "p-leader",
        participants: {
          participant_id: "SVK26-LEADER01",
          college: "CGC Landran",
          id_card_storage_path: "leader@test.com/leader_id.png",
        },
      },
      {
        id: "mem-2",
        participant_event_id: "pe-team-1",
        name: "Teammate Bhavna",
        email: "teammate1@test.com",
        phone: "9876543211",
        is_team_leader: false,
        participant_id: "p-member-1",
        participants: {
          participant_id: "SVK26-MEMBER01",
          college: "CGC Landran",
          id_card_storage_path: "teammate1@test.com/member1_id.png",
        },
      },
      {
        id: "mem-3",
        participant_event_id: "pe-team-1",
        name: "Teammate Chetan",
        email: "teammate2@test.com",
        phone: "9876543212",
        is_team_leader: false,
        participant_id: "p-member-2",
        participants: [
          {
            participant_id: "SVK26-MEMBER02",
            college: "IIT Ropar",
            id_card_storage_path: "teammate2@test.com/member2_id.jpg",
          },
        ],
      },
      {
        id: "mem-4",
        participant_event_id: "pe-team-1",
        name: "Teammate Divya",
        email: "teammate3@test.com",
        phone: "9876543213",
        is_team_leader: false,
        participant_id: "p-member-3",
        participants: {
          participant_id: "SVK26-MEMBER03",
          college: "Thapar University",
          id_card_storage_path: null,
        },
      },
    ];

    vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com" },
      role: "master",
      status: 200,
      error: null,
    } as any);
  });

  it("1. Team member records include their own id_card_storage_path via the registrations API", async () => {
    const req = new Request("https://localhost/api/admin/registrations");
    const res = await getRegistrations(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    const members = json.registrations[0].members;
    expect(members).toHaveLength(4);

    const leader = members.find((m: any) => m.name === "Leader Arjun");
    const bhavna = members.find((m: any) => m.name === "Teammate Bhavna");
    const chetan = members.find((m: any) => m.name === "Teammate Chetan");
    const divya = members.find((m: any) => m.name === "Teammate Divya");

    expect(leader.id_card_storage_path).toBe("leader@test.com/leader_id.png");
    expect(bhavna.id_card_storage_path).toBe("teammate1@test.com/member1_id.png");
    expect(chetan.id_card_storage_path).toBe("teammate2@test.com/member2_id.jpg");
    expect(divya.id_card_storage_path).toBeNull();
  });

  it("2. Each teammate's path resolves to a valid signed URL through the signed-url endpoint", async () => {
    // Teammate Bhavna
    const res1 = await postSignedUrl(
      new Request("https://localhost/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "teammate1@test.com/member1_id.png" }),
      }) as any
    );
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.signedUrl).toContain("teammate1@test.com/member1_id.png");

    // Teammate Chetan
    const res2 = await postSignedUrl(
      new Request("https://localhost/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "teammate2@test.com/member2_id.jpg" }),
      }) as any
    );
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.signedUrl).toContain("teammate2@test.com/member2_id.jpg");

    // Leader Arjun
    const resLeader = await postSignedUrl(
      new Request("https://localhost/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "leader@test.com/leader_id.png" }),
      }) as any
    );
    expect(resLeader.status).toBe(200);
    const jsonLeader = await resLeader.json();
    expect(jsonLeader.signedUrl).toContain("leader@test.com/leader_id.png");
  });

  it("3. An unauthorized or non-existent storage path is rejected with 403", async () => {
    const res = await postSignedUrl(
      new Request("https://localhost/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "unauthorized_user@test.com/fake_id.png" }),
      }) as any
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/unauthorized/i);
  });

  it("4. Empty or whitespace path is rejected with 400", async () => {
    const res = await postSignedUrl(
      new Request("https://localhost/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "   " }),
      }) as any
    );
    expect(res.status).toBe(400);
  });

  it("5. Path traversal attempts are rejected with 400", async () => {
    const res = await postSignedUrl(
      new Request("https://localhost/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "../../../id_cards/secret.jpg" }),
      }) as any
    );
    expect(res.status).toBe(400);
  });

  it("6. Simulates shared preview switching: Teammate A -> Teammate B -> Leader with immediate clear and race condition safety", async () => {
    // Model state transitions matching handleViewDocument in app/admin/page.tsx
    let viewDocumentUrl: string | null = null;
    let activeDocumentLabel: string | null = null;
    let activeDocumentPath: string | null = null;
    let documentLoading = false;
    let documentError: string | null = null;
    let requestIdCounter = 0;

    async function handleViewDocument(path: string | null | undefined, label: string | null) {
      const requestId = ++requestIdCounter;
      // Step 1: Immediately clear previous image and error
      viewDocumentUrl = null;
      documentError = null;
      activeDocumentLabel = label;
      activeDocumentPath = path ?? null;

      if (!path || !path.trim()) {
        documentError = `No ID card document was uploaded for ${label || "this member"}.`;
        return;
      }

      documentLoading = true;

      const res = await postSignedUrl(
        new Request("https://localhost/api/admin/documents/signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        }) as any
      );

      const json = await res.json();

      // Discard if stale request
      if (requestId !== requestIdCounter) {
        return;
      }

      if (!res.ok) {
        documentError = json.error || "Failed to load document";
      } else {
        viewDocumentUrl = json.signedUrl;
      }
      documentLoading = false;
    }

    // A. Select Teammate Bhavna
    await handleViewDocument("teammate1@test.com/member1_id.png", "Teammate Bhavna (SVK26-MEMBER01)");
    expect(viewDocumentUrl).toContain("teammate1@test.com/member1_id.png");
    expect(activeDocumentLabel).toBe("Teammate Bhavna (SVK26-MEMBER01)");
    expect(activeDocumentPath).toBe("teammate1@test.com/member1_id.png");
    expect(documentLoading).toBe(false);
    expect(documentError).toBeNull();

    // B. Switch to Teammate Chetan: image must immediately replace in SAME preview area
    await handleViewDocument("teammate2@test.com/member2_id.jpg", "Teammate Chetan (SVK26-MEMBER02)");
    expect(viewDocumentUrl).toContain("teammate2@test.com/member2_id.jpg");
    expect(activeDocumentLabel).toBe("Teammate Chetan (SVK26-MEMBER02)");
    expect(activeDocumentPath).toBe("teammate2@test.com/member2_id.jpg");

    // C. Switch to Team Leader Arjun: restores leader's own image in SAME preview area
    await handleViewDocument("leader@test.com/leader_id.png", "Leader Arjun (Leader)");
    expect(viewDocumentUrl).toContain("leader@test.com/leader_id.png");
    expect(activeDocumentLabel).toBe("Leader Arjun (Leader)");
    expect(activeDocumentPath).toBe("leader@test.com/leader_id.png");

    // D. Missing ID card member (Divya) shows clear unavailable state without submitting to API
    await handleViewDocument(null, "Teammate Divya (SVK26-MEMBER03)");
    expect(viewDocumentUrl).toBeNull();
    expect(documentError).toBe("No ID card document was uploaded for Teammate Divya (SVK26-MEMBER03).");
    expect(documentLoading).toBe(false);
  });

  it("7. Stale out-of-order async responses are safely discarded", async () => {
    let viewDocumentUrl: string | null = null;
    let requestIdCounter = 0;

    let resolveSlowRequest: any = null;
    const slowPromise = new Promise((resolve) => {
      resolveSlowRequest = resolve;
    });

    async function handleSimulated(path: string, delayPromise?: Promise<any>) {
      const requestId = ++requestIdCounter;
      viewDocumentUrl = null;

      if (delayPromise) {
        await delayPromise;
      }

      if (requestId !== requestIdCounter) {
        // Discard stale
        return;
      }
      viewDocumentUrl = `signed-${path}`;
    }

    // Launch slow request for Member A
    const reqA = handleSimulated("member-A.png", slowPromise);

    // Promptly launch fast request for Member B
    const reqB = handleSimulated("member-B.png");
    await reqB;

    expect(viewDocumentUrl).toBe("signed-member-B.png");

    // Now resolve slow request A
    resolveSlowRequest();
    await reqA;

    // Must still be Member B! Stale Member A was discarded!
    expect(viewDocumentUrl).toBe("signed-member-B.png");
  });
});
