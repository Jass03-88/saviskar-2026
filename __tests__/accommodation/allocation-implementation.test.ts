import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Phase 2B Allocation Implementation", () => {
  const allocatePath = path.join(process.cwd(), "app", "api", "admin", "accommodations", "allocate", "route.ts");
  const autoAllocatePath = path.join(process.cwd(), "app", "api", "admin", "accommodations", "auto-allocate", "route.ts");
  const reallocatePath = path.join(process.cwd(), "app", "api", "admin", "accommodations", "reallocate", "route.ts");
  const historyPath = path.join(process.cwd(), "app", "api", "admin", "accommodations", "history", "route.ts");
  const dashboardPath = path.join(process.cwd(), "app", "api", "admin", "accommodations", "dashboard", "route.ts");

  const allocateContent = fs.readFileSync(allocatePath, "utf-8");
  const autoAllocateContent = fs.readFileSync(autoAllocatePath, "utf-8");
  const reallocateContent = fs.readFileSync(reallocatePath, "utf-8");
  const historyContent = fs.readFileSync(historyPath, "utf-8");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8");

  describe("API Authorization & Rules", () => {
    it("ensures requireAccommodationAdmin is used on all endpoints", () => {
      expect(allocateContent).toContain("requireAccommodationAdmin()");
      expect(autoAllocateContent).toContain("requireAccommodationAdmin()");
      expect(reallocateContent).toContain("requireAccommodationAdmin()");
      expect(historyContent).toContain("requireAccommodationAdmin()");
      expect(dashboardContent).toContain("requireAccommodationAdmin()");
    });

    it("verifies manual allocate uses the secure RPC", () => {
      expect(allocateContent).toContain('supabaseAdmin.rpc("allocate_accommodation"');
    });

    it("verifies auto allocate uses the secure RPC", () => {
      expect(autoAllocateContent).toContain('supabaseAdmin.rpc("allocate_accommodation"');
    });

    it("verifies reallocate uses the secure RPC and requires a reason", () => {
      expect(reallocateContent).toContain('supabaseAdmin.rpc("allocate_accommodation"');
      expect(reallocateContent).toContain('Reason is required for reallocation');
    });

    it("calculates occupancy purely from accommodation_allocations active status", () => {
      expect(dashboardContent).toContain('from("accommodation_allocations")');
      expect(dashboardContent).toContain('eq("status", "active")');
      expect(dashboardContent).not.toContain('from("participant_accommodations")\n      .select("hostel_id, room_id")');
    });

    it("auto allocator skips other gender", () => {
      expect(autoAllocateContent).toContain('gender === "other"');
      expect(autoAllocateContent).toContain("UNSUPPORTED_GENDER");
    });

    it("auto allocator skips missing gender", () => {
      expect(autoAllocateContent).toContain("MISSING_GENDER");
    });

    it("auto allocator filters for active hostels and rooms", () => {
      expect(autoAllocateContent).toContain('from("hostels")');
      expect(autoAllocateContent).toContain('eq("is_active", true)');
      expect(autoAllocateContent).toContain('from("hostel_rooms")');
      expect(autoAllocateContent).toContain('eq("is_active", true)');
    });

    it("auto allocator selects only unallocated, paid participants", () => {
      expect(autoAllocateContent).toContain('eq("status", "paid")');
      expect(autoAllocateContent).toContain('is("hostel_id", null)');
    });
  });
});
