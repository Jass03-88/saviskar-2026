import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Phase 2B Pre-Allocation Correction: Floor Inventory Layer", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20261002060000_hostel_floors_inventory.sql"
  );
  const floorsRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "admin",
    "accommodations",
    "floors",
    "route.ts"
  );
  const roomsRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "admin",
    "accommodations",
    "rooms",
    "route.ts"
  );
  const dashboardRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "admin",
    "accommodations",
    "dashboard",
    "route.ts"
  );
  const autoAllocateRoutePath = path.join(
    process.cwd(),
    "app",
    "api",
    "admin",
    "accommodations",
    "auto-allocate",
    "route.ts"
  );
  const pageUiPath = path.join(
    process.cwd(),
    "app",
    "admin",
    "accommodations",
    "page.tsx"
  );

  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  const floorsRoute = fs.readFileSync(floorsRoutePath, "utf-8");
  const roomsRoute = fs.readFileSync(roomsRoutePath, "utf-8");
  const dashboardRoute = fs.readFileSync(dashboardRoutePath, "utf-8");
  const autoAllocateRoute = fs.readFileSync(autoAllocateRoutePath, "utf-8");
  const pageUi = fs.readFileSync(pageUiPath, "utf-8");

  describe("1. Database Schema & Migration Invariants", () => {
    it("creates public.hostel_floors table with required columns and constraints", () => {
      expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.hostel_floors");
      expect(migrationSql).toContain("hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE RESTRICT");
      expect(migrationSql).toContain("floor_number integer NOT NULL CHECK (floor_number >= 0)");
      expect(migrationSql).toContain("name text");
      expect(migrationSql).toContain("is_active boolean NOT NULL DEFAULT true");
      expect(migrationSql).toContain("CONSTRAINT uq_hostel_floor UNIQUE (hostel_id, floor_number)");
    });

    it("enforces uniqueness of floor_number within hostel while allowing same floor in different hostels", () => {
      // The compound constraint (hostel_id, floor_number) ensures floor 1 in Hostel A != floor 1 in Hostel B
      expect(migrationSql).toContain("UNIQUE (hostel_id, floor_number)");
    });

    it("adds floor_id to public.hostel_rooms referencing hostel_floors", () => {
      expect(migrationSql).toContain("ALTER TABLE public.hostel_rooms");
      expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS floor_id uuid REFERENCES public.hostel_floors(id)");
    });

    it("changes room uniqueness to be scoped per floor (uq_floor_room)", () => {
      expect(migrationSql).toContain("uq_floor_room UNIQUE (floor_id, room_number)");
      expect(migrationSql).toContain("DROP CONSTRAINT IF EXISTS uq_hostel_room");
    });

    it("enforces RLS on hostel_floors with service_role permissions only", () => {
      expect(migrationSql).toContain("ALTER TABLE public.hostel_floors ENABLE ROW LEVEL SECURITY;");
      expect(migrationSql).toContain("REVOKE ALL ON TABLE public.hostel_floors FROM PUBLIC, anon, authenticated;");
      expect(migrationSql).toContain("GRANT ALL ON TABLE public.hostel_floors TO service_role;");
    });
  });

  describe("2. Allocation RPC Validation (Hostel -> Floor -> Room)", () => {
    it("validates room is active", () => {
      expect(migrationSql).toContain("IF NOT v_room.is_active THEN");
      expect(migrationSql).toContain("ROOM_INACTIVE");
    });

    it("validates floor exists and is active", () => {
      expect(migrationSql).toContain("SELECT * INTO v_floor");
      expect(migrationSql).toContain("FROM public.hostel_floors");
      expect(migrationSql).toContain("WHERE id = v_room.floor_id;");
      expect(migrationSql).toContain("FLOOR_NOT_FOUND");
      expect(migrationSql).toContain("IF NOT v_floor.is_active THEN");
      expect(migrationSql).toContain("FLOOR_INACTIVE");
    });

    it("validates floor belongs to the selected hostel", () => {
      expect(migrationSql).toContain("IF v_floor.hostel_id <> p_hostel_id THEN");
      expect(migrationSql).toContain("FLOOR_HOSTEL_MISMATCH");
    });

    it("validates room belongs to the selected hostel", () => {
      expect(migrationSql).toContain("IF v_room.hostel_id <> p_hostel_id THEN");
      expect(migrationSql).toContain("ROOM_HOSTEL_MISMATCH");
    });

    it("preserves payment status validation (strictly paid only)", () => {
      expect(migrationSql).toContain("IF v_pa.status <> 'paid' THEN");
      expect(migrationSql).toContain("BOOKING_NOT_ELIGIBLE: Status must be paid");
    });

    it("preserves other gender rejection", () => {
      expect(migrationSql).toContain("lower(trim(v_participant.gender)) = 'other'");
      expect(migrationSql).toContain("UNSUPPORTED_GENDER");
    });

    it("preserves same-room allocation no-op", () => {
      expect(migrationSql).toContain("v_existing_allocation.room_id = p_room_id");
      expect(migrationSql).toContain("Already allocated to this room");
    });

    it("preserves atomic row locking and capacity checks", () => {
      expect(migrationSql).toContain("FOR UPDATE");
      expect(migrationSql).toContain("IF v_current_occupancy >= v_room.capacity THEN");
      expect(migrationSql).toContain("ROOM_FULL: Capacity exceeded");
    });

    it("preserves reallocation history tracking in accommodation_allocations", () => {
      expect(migrationSql).toContain("status = 'reassigned'");
      expect(migrationSql).toContain("deallocated_at = now()");
    });
  });

  describe("3. API Endpoints & Authorization", () => {
    it("protects floors API with requireAccommodationAdmin", () => {
      expect(floorsRoute).toContain("requireAccommodationAdmin()");
    });

    it("floors API prevents deletion if rooms exist on the floor", () => {
      expect(floorsRoute).toContain("Cannot delete floor with existing rooms");
    });

    it("floors API prevents deactivation if active allocations exist", () => {
      expect(floorsRoute).toContain("Cannot deactivate a floor that currently has active participant allocations");
    });

    it("rooms API validates floor belongs to hostel and floor is active", () => {
      expect(roomsRoute).toContain("Selected floor does not belong to the chosen hostel");
      expect(roomsRoute).toContain("Cannot create rooms on an inactive floor");
    });

    it("rooms API checks floor-scoped uniqueness constraint code 23505", () => {
      expect(roomsRoute).toContain("Room number already exists on this floor");
    });

    it("dashboard API returns floors and calculates floorOccupancy", () => {
      expect(dashboardRoute).toContain('from("hostel_floors")');
      expect(dashboardRoute).toContain("floorOccupancy");
      expect(dashboardRoute).toContain("roomOccupancy");
      expect(dashboardRoute).toContain("hostelOccupancy");
    });

    it("auto-allocate traverses hierarchy as Hostel -> Floor -> Room", () => {
      expect(autoAllocateRoute).toContain('from("hostel_floors")');
      expect(autoAllocateRoute).toContain("hostelFloors");
      expect(autoAllocateRoute).toContain("floorRooms");
    });
  });

  describe("4. Admin UI Structure", () => {
    it("includes floors tab in accommodation navigation", () => {
      expect(pageUi).toContain('"floors"');
    });

    it("displays floor details, capacity, and occupancy", () => {
      expect(pageUi).toContain("Floor Number");
      expect(pageUi).toContain("Floor Name / Label");
      expect(pageUi).toContain("Add Floor");
      expect(pageUi).toContain("Save Floor");
    });

    it("provides clear hostel and floor selection in Add Room modal", () => {
      expect(pageUi).toContain("-- Select Hostel --");
      expect(pageUi).toContain("-- Select Floor --");
    });

    it("ensures dark text on light backgrounds for input and select controls", () => {
      expect(pageUi).toContain("text-black bg-white");
    });
  });
});
