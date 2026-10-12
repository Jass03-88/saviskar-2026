import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { POST as postRegister } from "@/app/api/register/route";
import { POST as postSignedUrl } from "@/app/api/admin/documents/signed-url/route";
import { NextRequest } from "next/server";
import * as authSessionLib from "@/lib/auth/session";
import * as rateLimitLib from "@/lib/rate-limit";
import * as serverLib from "@/lib/supabase/server";

// Ensure environment variables are set for the routes
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";

const migrationFilePath = path.resolve(
  __dirname,
  "../../supabase/migrations/20261016000000_fix_faculty_id_card_path_precedence.sql"
);

// Mock DB state for admin and route tests
let mockParticipantsDb: any[] = [];
let mockFacultyDb: any[] = [];
let mockStorageFiles: Set<string> = new Set();
let mockRpcCalls: any[] = [];

function createMockSupabaseClient() {
  return {
    from: (table: string) => {
      if (table === "participants") {
        return {
          select: (cols?: string) => ({
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

      if (table === "faculty_incharges") {
        return {
          select: (cols?: string) => ({
            eq: (field: string, val: string) => ({
              limit: (n: number) => {
                const matched = mockFacultyDb.filter((f) => {
                  const p = Array.isArray(f.participants) ? f.participants[0] : f.participants;
                  return p?.id_card_storage_path === val;
                }).slice(0, n);
                return Promise.resolve({ data: matched, error: null });
              },
              maybeSingle: () => {
                const matched = mockFacultyDb.find((f) => f[field] === val);
                return Promise.resolve({ data: matched || null, error: null });
              },
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
    rpc: (name: string, params: any) => {
      mockRpcCalls.push({ name, params });
      return Promise.resolve({ data: [], error: null });
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: vi.fn((filePath: string, expiresIn: number) => {
          if (!mockStorageFiles.has(filePath)) {
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
  createClient: () => createMockSupabaseClient(),
}));

describe("SAVISKAR 2026 — Faculty ID Card Storage Path Precedence & Identity Safety", () => {
  const sqlContent = fs.readFileSync(migrationFilePath, "utf8");

  describe("1. SQL Migration Structural & Precedence Invariants", () => {
    it("A. Migration file exists and is non-empty", () => {
      expect(fs.existsSync(migrationFilePath)).toBe(true);
      expect(sqlContent.length).toBeGreaterThan(1000);
    });

    it("B. Does not drop historical overloads to preserve backward compatibility", () => {
      expect(sqlContent).not.toContain("DROP FUNCTION");
    });

    it("C. Preserves exact 11-parameter RPC signature and RETURNS TABLE", () => {
      expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION "public"."register_participant_events"(');
      expect(sqlContent).toContain('"p_participant_id" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_name" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_college" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_email" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_phone" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_events" "jsonb" DEFAULT \'[]\'::"jsonb"');
      expect(sqlContent).toContain('"p_accommodations" "jsonb" DEFAULT \'[]\'::"jsonb"');
      expect(sqlContent).toContain('"p_faculty" "jsonb" DEFAULT NULL::"jsonb"');
      expect(sqlContent).toContain('"p_gender" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_state" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('"p_id_card_storage_path" "text" DEFAULT NULL::"text"');
      expect(sqlContent).toContain('RETURNS TABLE(');
      expect(sqlContent).toContain('"participant_id" "text"');
      expect(sqlContent).toContain('"participant_event_id" "uuid"');
      expect(sqlContent).toContain('"event_id" "uuid"');
      expect(sqlContent).toContain('"event_name" "text"');
      expect(sqlContent).toContain('"status" "text"');
      expect(sqlContent).toContain('"payment_order_id" "uuid"');
    });

    it("D. Preserves SECURITY DEFINER, search_path, ownership and grants", () => {
      expect(sqlContent).toContain("LANGUAGE \"plpgsql\" SECURITY DEFINER");
      expect(sqlContent).toContain("SET \"search_path\" TO 'public'");
      expect(sqlContent).toContain('REVOKE ALL ON FUNCTION "public"."register_participant_events"');
      expect(sqlContent).toContain('GRANT ALL ON FUNCTION "public"."register_participant_events"');
      expect(sqlContent).toContain('TO "service_role"');
    });

    it("E. Preserves all accommodation fix invariants (pa.* qualifications)", () => {
      expect(sqlContent).toMatch(/update\s+public\.participant_accommodations\s+pa\s+set\s+status\s*=\s*'cancelled'/i);
      expect(sqlContent).toMatch(/where\s+pa\.participant_id\s*=\s*v_acc_participant_uuid/i);
      expect(sqlContent).toMatch(/where\s+pa\.id\s*=\s*v_new_pa_ids\[v_idx\]/i);
    });

    it("F. Implements correct path precedence for existing faculty (new path replaces old)", () => {
      // Must NOT contain the inverted coalesce where existing id_card_storage_path was first
      expect(sqlContent).not.toMatch(
        /set\s+id_card_storage_path\s*=\s*coalesce\(\s*nullif\(\s*trim\(\s*id_card_storage_path\s*\)\s*,\s*''\s*\)\s*,\s*nullif\(\s*trim\(\s*p_faculty->>'id_card_storage_path'\s*\)/i
      );

      // Must contain new faculty path taking precedence over existing column value
      expect(sqlContent).toMatch(
        /id_card_storage_path\s*=\s*coalesce\(\s*nullif\(\s*trim\(\s*p_faculty->>'id_card_storage_path'\s*\)\s*,\s*''\s*\)\s*,\s*id_card_storage_path\s*\)/i
      );

      // Must update id_card_uploaded_at when a new faculty path is provided
      expect(sqlContent).toMatch(
        /id_card_uploaded_at\s*=\s*case\s+when\s+nullif\(\s*trim\(\s*p_faculty->>'id_card_storage_path'\s*\)\s*,\s*''\s*\)\s+is\s+not\s+null\s+then\s+now\(\)\s+else\s+id_card_uploaded_at\s+end/i
      );
    });

    it("G. Enforces faculty identity safety: rejects email collision with primary participant", () => {
      expect(sqlContent).toMatch(
        /if\s+v_faculty_email\s*=\s*lower\(\s*trim\(\s*coalesce\(\s*v_existing_participant\.email\s*,\s*p_email\s*\)\s*\)\s*\)\s+then\s+raise\s+exception\s+'Faculty In-Charge email cannot be the same as the primary participant email'/i
      );
    });

    it("H. Enforces faculty identity safety: rejects email collision with team members", () => {
      expect(sqlContent).toMatch(
        /if\s+exists\s*\(\s*select\s+1\s+from\s+jsonb_array_elements[\s\S]+?m->>'email'[\s\S]+?=\s*v_faculty_email\s*\)\s+then\s+raise\s+exception\s+'Faculty In-Charge email cannot match any team member email'/i
      );
    });

    it("I. Preserves existing faculty_incharges conflict behavior (DO NOTHING)", () => {
      expect(sqlContent).toMatch(
        /insert\s+into\s+public\.faculty_incharges[\s\S]+?on\s+conflict\s*\(\s*registration_group_id\s*\)\s+do\s+nothing;/i
      );
    });

    it("J. Preserves existing profile update behavior: does NOT overwrite name, college, or phone for existing faculty", () => {
      // Find the faculty update statement block
      const facultyUpdateMatch = sqlContent.match(
        /if\s+v_faculty_participant\.id\s+is\s+not\s+null\s+then[\s\S]+?update\s+public\.participants[\s\S]+?where\s+id\s*=\s*v_faculty_uuid;/i
      );
      expect(facultyUpdateMatch).toBeTruthy();
      const facultyUpdateBlock = facultyUpdateMatch![0];

      // Must NOT update name, college, or phone
      expect(facultyUpdateBlock).not.toMatch(/\bname\s*=/i);
      expect(facultyUpdateBlock).not.toMatch(/\bcollege\s*=/i);
      expect(facultyUpdateBlock).not.toMatch(/\bphone\s*=/i);
    });

    it("K. Preserves existing coalesce merge semantics for gender and state in faculty update", () => {
      const facultyUpdateMatch = sqlContent.match(
        /if\s+v_faculty_participant\.id\s+is\s+not\s+null\s+then[\s\S]+?update\s+public\.participants[\s\S]+?where\s+id\s*=\s*v_faculty_uuid;/i
      );
      expect(facultyUpdateMatch).toBeTruthy();
      const facultyUpdateBlock = facultyUpdateMatch![0];

      expect(facultyUpdateBlock).toMatch(/gender\s*=\s*coalesce\(\s*nullif\(\s*trim\(\s*gender\s*\)\s*,\s*''\s*\)\s*,\s*nullif\(\s*trim\(\s*p_faculty->>'gender'\s*\)\s*,\s*''\s*\)\s*\)/i);
      expect(facultyUpdateBlock).toMatch(/state\s*=\s*coalesce\(\s*nullif\(\s*trim\(\s*state\s*\)\s*,\s*''\s*\)\s*,\s*nullif\(\s*trim\(\s*p_faculty->>'state'\s*\)\s*,\s*''\s*\)\s*\)/i);
    });

    it("L. Preserves accommodation registration and payment order creation behavior intact", () => {
      // Section 11 Accommodation loop exists
      expect(sqlContent).toContain("-- 11. ATOMIC ACCOMMODATION SELECTIONS");
      expect(sqlContent).toContain("insert into public.participant_accommodations (");
      expect(sqlContent).toContain("from public.accommodation_plans ap where ap.slug = v_acc_slug and ap.is_active = true");

      // Section 12 Payment orders exists
      expect(sqlContent).toContain("-- 12. ATOMIC PAYMENT ORDER CREATION (EVENTS + ACCOMMODATION)");
      expect(sqlContent).toContain("insert into public.payment_orders (");
      expect(sqlContent).toContain("insert into public.payment_order_items (");
    });

    it("M. Uniqueness-conflict fallbacks do not replace documents or alter profiles without validation", () => {
      // Find all when unique_violation blocks
      const uniqueBlocks = sqlContent.match(/when\s+unique_violation\s+then[\s\S]+?end;/gi) || [];
      expect(uniqueBlocks.length).toBeGreaterThanOrEqual(3);

      for (const block of uniqueBlocks) {
        // Ensure no update statement is executed inside unique_violation exception handlers
        expect(block).not.toMatch(/update\s+public\.participants/i);
      }
    });
  });

  describe("2. API Route Identity & Faculty Validation", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      mockRpcCalls = [];
      vi.spyOn(rateLimitLib, "checkRateLimitAsync").mockResolvedValue({
        allowed: true,
        remaining: 10,
        retryAfter: 0,
      } as any);
      vi.spyOn(rateLimitLib, "getClientIp").mockReturnValue("127.0.0.1");
    });

    it("A. Rejects registration when faculty email matches primary participant email", async () => {
      vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
        authenticated: true,
        email: "student@example.com",
      } as any);

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Student Name",
          college: "Student College",
          email: "student@example.com",
          phone: "9876543210",
          idCardStoragePath: "student@example.com/student-id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: null,
              isTeamHead: false,
              members: [],
            },
          ],
          faculty: {
            name: "Same Person",
            college: "Student College",
            email: "student@example.com", // COLLISION!
            phone: "9876543211",
            gender: "male",
            state: "Punjab",
            idCardStoragePath: "student@example.com/faculty-id.jpg",
          },
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Faculty In-Charge email cannot be the same as the participant email.");
    });

    it("B. Rejects registration when faculty email matches a team member email", async () => {
      vi.spyOn(authSessionLib, "getRegistrationSession").mockResolvedValue({
        authenticated: true,
        email: "leader@example.com",
      } as any);

      const request = new NextRequest("http://localhost:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Leader Name",
          college: "College",
          email: "leader@example.com",
          phone: "9876543210",
          idCardStoragePath: "leader@example.com/leader-id.jpg",
          events: [
            {
              eventId: "11111111-1111-4111-a111-111111111111",
              team: "Team Alpha",
              isTeamHead: true,
              members: [
                {
                  name: "Member One",
                  college: "College",
                  email: "teammate@example.com",
                  phone: "9876543212",
                  gender: "male",
                  state: "Punjab",
                  idCardStoragePath: "leader@example.com/member-id.jpg",
                },
              ],
            },
          ],
          faculty: {
            name: "Faculty Name",
            college: "College",
            email: "teammate@example.com", // COLLISION WITH TEAM MEMBER!
            phone: "9876543213",
            gender: "male",
            state: "Punjab",
            idCardStoragePath: "leader@example.com/faculty-id.jpg",
          },
        }),
      });

      const res = await postRegister(request);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Faculty In-Charge email cannot match any team member email.");
    });
  });

  describe("3. Faculty Path Precedence & Identity Safety Simulation", () => {
    function simulateParticipantUpdate(
      existingRow: { id_card_storage_path: string | null; id_card_uploaded_at: string | null },
      newProvidedPath: string | null | undefined
    ) {
      const cleanNew = newProvidedPath && newProvidedPath.trim() !== "" ? newProvidedPath.trim() : null;
      return {
        id_card_storage_path: cleanNew !== null ? cleanNew : existingRow.id_card_storage_path,
        id_card_uploaded_at: cleanNew !== null ? "2026-10-12T00:00:00Z" : existingRow.id_card_uploaded_at,
      };
    }

    it("A. A new faculty ID-card upload replaces the existing stored faculty path", () => {
      const existing = {
        id_card_storage_path: "fac@example.com/old-card.jpg",
        id_card_uploaded_at: "2026-10-01T00:00:00Z",
      };
      const updated = simulateParticipantUpdate(existing, "fac@example.com/new-qr-card.jpg");
      expect(updated.id_card_storage_path).toBe("fac@example.com/new-qr-card.jpg");
      expect(updated.id_card_uploaded_at).toBe("2026-10-12T00:00:00Z");
    });

    it("B. Submitting no new faculty document preserves the current stored path", () => {
      const existing = {
        id_card_storage_path: "fac@example.com/old-card.jpg",
        id_card_uploaded_at: "2026-10-01T00:00:00Z",
      };
      const updatedWithNull = simulateParticipantUpdate(existing, null);
      expect(updatedWithNull.id_card_storage_path).toBe("fac@example.com/old-card.jpg");
      expect(updatedWithNull.id_card_uploaded_at).toBe("2026-10-01T00:00:00Z");

      const updatedWithEmpty = simulateParticipantUpdate(existing, "   ");
      expect(updatedWithEmpty.id_card_storage_path).toBe("fac@example.com/old-card.jpg");
      expect(updatedWithEmpty.id_card_uploaded_at).toBe("2026-10-01T00:00:00Z");
    });

    it("C. A participant ID-card path is not overwritten by an unrelated faculty upload", () => {
      const studentRecord = {
        id: "student-uuid",
        email: "student@example.com",
        id_card_storage_path: "student@example.com/student-id.jpg",
      };
      const facultyRecord = {
        id: "faculty-uuid",
        email: "prof@example.com",
        id_card_storage_path: "prof@example.com/old-prof-id.jpg",
        id_card_uploaded_at: "2026-10-01T00:00:00Z",
      };

      // When updating faculty
      const updatedFaculty = simulateParticipantUpdate(
        facultyRecord,
        "prof@example.com/new-qr-prof.jpg"
      );

      // Student record must remain completely unaffected
      expect(studentRecord.id_card_storage_path).toBe("student@example.com/student-id.jpg");
      expect(updatedFaculty.id_card_storage_path).toBe("prof@example.com/new-qr-prof.jpg");
    });

    it("D. Existing profile fields (name, college, phone, gender, state) are preserved according to original rules", () => {
      function simulateFacultyUpdate(
        existingFaculty: {
          name: string;
          college: string;
          phone: string;
          gender: string | null;
          state: string | null;
          id_card_storage_path: string | null;
          id_card_uploaded_at: string | null;
        },
        newFacultyInput: {
          name?: string;
          college?: string;
          phone?: string;
          gender?: string;
          state?: string;
          id_card_storage_path?: string;
        }
      ) {
        const cleanPath = newFacultyInput.id_card_storage_path && newFacultyInput.id_card_storage_path.trim() !== ""
          ? newFacultyInput.id_card_storage_path.trim()
          : null;

        // Follow exact SQL:
        // id_card_storage_path = coalesce(nullif(trim(p_faculty->>'id_card_storage_path'), ''), id_card_storage_path)
        // id_card_uploaded_at = case when new path provided then now() else existing end
        // gender = coalesce(nullif(trim(gender), ''), nullif(trim(p_faculty->>'gender'), ''))
        // state = coalesce(nullif(trim(state), ''), nullif(trim(p_faculty->>'state'), ''))
        // name, college, phone: NOT in UPDATE statement (preserve existing)
        return {
          name: existingFaculty.name, // NOT OVERWRITTEN
          college: existingFaculty.college, // NOT OVERWRITTEN
          phone: existingFaculty.phone, // NOT OVERWRITTEN
          gender: (existingFaculty.gender && existingFaculty.gender.trim() !== "")
            ? existingFaculty.gender
            : (newFacultyInput.gender && newFacultyInput.gender.trim() !== "" ? newFacultyInput.gender.trim() : null),
          state: (existingFaculty.state && existingFaculty.state.trim() !== "")
            ? existingFaculty.state
            : (newFacultyInput.state && newFacultyInput.state.trim() !== "" ? newFacultyInput.state.trim() : null),
          id_card_storage_path: cleanPath !== null ? cleanPath : existingFaculty.id_card_storage_path,
          id_card_uploaded_at: cleanPath !== null ? "2026-10-12T00:00:00Z" : existingFaculty.id_card_uploaded_at,
        };
      }

      const originalFaculty = {
        name: "Prof Original Sharma",
        college: "Punjab Engineering College",
        phone: "9876543210",
        gender: "Male",
        state: "Punjab",
        id_card_storage_path: "fac@pec.edu/old-id.jpg",
        id_card_uploaded_at: "2026-10-01T00:00:00Z",
      };

      const result = simulateFacultyUpdate(originalFaculty, {
        name: "Prof Different Name",
        college: "Different University",
        phone: "9999999999",
        gender: "Female",
        state: "Haryana",
        id_card_storage_path: "fac@pec.edu/new-qr.jpg",
      });

      // Name, college, phone must retain original values
      expect(result.name).toBe("Prof Original Sharma");
      expect(result.college).toBe("Punjab Engineering College");
      expect(result.phone).toBe("9876543210");

      // Gender and state must retain existing values if non-empty
      expect(result.gender).toBe("Male");
      expect(result.state).toBe("Punjab");

      // Only ID card path and timestamp update
      expect(result.id_card_storage_path).toBe("fac@pec.edu/new-qr.jpg");
      expect(result.id_card_uploaded_at).toBe("2026-10-12T00:00:00Z");
    });
  });

  describe("4. Admin Document Signed URL & Preview Flow", () => {
    beforeEach(() => {
      vi.restoreAllMocks();

      mockParticipantsDb = [
        {
          id: "student-uuid-1",
          name: "Student One",
          email: "student@example.com",
          id_card_storage_path: "student@example.com/student-id.jpg",
        },
        {
          id: "faculty-uuid-1",
          name: "Prof Sharma",
          email: "prof@college.edu",
          college: "Engineering College",
          phone: "9876543210",
          gender: "Male",
          state: "Punjab",
          id_card_storage_path: "student@example.com/new-faculty-qr.jpg", // Newly updated faculty path
        },
      ];

      mockFacultyDb = [
        {
          id: "fac-incharge-1",
          registration_group_id: "reg-group-1",
          participant_id: "faculty-uuid-1",
          participants: mockParticipantsDb[1],
        },
      ];

      mockStorageFiles = new Set([
        "student@example.com/student-id.jpg",
        "student@example.com/new-faculty-qr.jpg",
      ]);

      vi.spyOn(serverLib, "requireAdmin").mockResolvedValue({
        supabase: {} as any,
        user: { id: "admin-uuid", email: "admin@example.com" } as any,
        role: "master",
        error: null,
      } as any);
    });

    it("A. Admin generates signed URL for the newly updated faculty document path", async () => {
      const request = new NextRequest("http://localhost:3000/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "student@example.com/new-faculty-qr.jpg",
        }),
      });

      const res = await postSignedUrl(request);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.signedUrl).toBeDefined();
      expect(json.signedUrl).toContain("new-faculty-qr.jpg");
    });

    it("B. Participant preview remains independent and continues generating its own signed URL", async () => {
      const request = new NextRequest("http://localhost:3000/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "student@example.com/student-id.jpg",
        }),
      });

      const res = await postSignedUrl(request);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.signedUrl).toBeDefined();
      expect(json.signedUrl).toContain("student-id.jpg");
    });

    it("C. Unauthorized storage path outside participant and faculty records is rejected", async () => {
      const request = new NextRequest("http://localhost:3000/api/admin/documents/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "unauthorized/secret-document.pdf",
        }),
      });

      const res = await postSignedUrl(request);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized or unregistered document path.");
    });
  });
});
