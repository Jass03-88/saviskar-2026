import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Phase 0 + Accommodation Database Foundation Invariants", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20261002020000_accommodation_database_foundation.sql"
  );
  const footerPath = path.join(
    process.cwd(),
    "components",
    "ui",
    "Footer.tsx"
  );
  const registrationFormPath = path.join(
    process.cwd(),
    "components",
    "registration",
    "RegistrationForm.tsx"
  );

  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  const footerContent = fs.readFileSync(footerPath, "utf-8");
  const registrationFormContent = fs.readFileSync(registrationFormPath, "utf-8");

  describe("Phase 0A: Registration Identity Advisory", () => {
    it("includes the informational identity advisory in RegistrationForm.tsx", () => {
      expect(registrationFormContent).toContain("Important Advisory:");
      expect(registrationFormContent).toContain(
        "All participants must carry their valid college/university ID card and a valid identity proof with them at the event venue."
      );
      expect(registrationFormContent).toContain(
        "Participants may be required to present these documents for verification."
      );
    });

    it("places the advisory before the code of conduct and terms checkbox without adding a second checkbox", () => {
      const advisoryIndex = registrationFormContent.indexOf("REGISTRATION IDENTITY ADVISORY");
      const termsIndex = registrationFormContent.indexOf("CODE OF CONDUCT & TERMS AGREEMENT");
      expect(advisoryIndex).toBeGreaterThan(-1);
      expect(termsIndex).toBeGreaterThan(-1);
      expect(advisoryIndex).toBeLessThan(termsIndex);

      // Verify it does not introduce an additional input/checkbox in the advisory section
      const advisorySnippet = registrationFormContent.substring(advisoryIndex, termsIndex);
      expect(advisorySnippet).not.toContain("<input");
      expect(advisorySnippet).not.toContain("checkbox");
    });
  });

  describe("Phase 0B: Footer Credit", () => {
    it("credits Madhav Vashisht followed by Jashan Jot (Student Advisory Council)", () => {
      expect(footerContent).toContain("Made by");
      expect(footerContent).toContain("Madhav Vashisht");
      expect(footerContent).toContain("Jashan Jot");
      expect(footerContent).toContain("(Student Advisory Council)");

      const madhavIndex = footerContent.indexOf("Madhav Vashisht");
      const jashanIndex = footerContent.indexOf("Jashan Jot");
      expect(madhavIndex).toBeGreaterThan(-1);
      expect(jashanIndex).toBeGreaterThan(-1);
      expect(jashanIndex).toBeGreaterThan(madhavIndex);
    });

    it("preserves Madhav's website link and visual styling classes", () => {
      expect(footerContent).toContain('href="https://www.amadhav.com"');
      expect(footerContent).toContain("text-violet-300");
    });
  });

  describe("Accommodation Plans & Pricing Configuration", () => {
    it("1. Configures 1-Day plan at exactly ₹499 INR", () => {
      expect(migrationSql).toMatch(/'1_day',\s*'1 Day Accommodation',\s*1,\s*499,\s*'INR'/);
    });

    it("2. Configures 2-Day plan at exactly ₹999 INR", () => {
      expect(migrationSql).toMatch(/'2_days',\s*'2 Days Accommodation',\s*2,\s*999,\s*'INR'/);
    });

    it("3. No accommodation creates no database plan or booking row", () => {
      expect(migrationSql).not.toContain("'no_accommodation'");
      expect(migrationSql).not.toContain("'No Accommodation'");
      expect(migrationSql).not.toMatch(/price\s*=\s*0/i);
    });
  });

  describe("Database Constraints & Safety Invariants", () => {
    it("4. Enforces exactly ONE active accommodation booking per participant", () => {
      expect(migrationSql).toContain("idx_participant_accommodations_single_active");
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_accommodations_single_active\s+ON public\.participant_accommodations\(participant_id\)\s+WHERE status NOT IN \('cancelled', 'failed'\);/
      );
    });

    it("5. Historical participants safely support NULL accommodation (no backfill)", () => {
      // participant_accommodations is a separate table, not a mandatory column on participants
      expect(migrationSql).not.toContain("UPDATE public.participants SET");
      expect(migrationSql).not.toContain("UPDATE public.participant_events SET");
    });

    it("6. Historical participants can have NULL gender without validation error", () => {
      expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS gender text");
      expect(migrationSql).toContain("participants_gender_check");
      expect(migrationSql).toContain("gender IS NULL");
    });

    it("7. Historical participants can have NULL state without validation error", () => {
      expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS state text");
    });

    it("8. Accommodation dates (start_date, end_date, duration_days) are snapshotted on the booking", () => {
      expect(migrationSql).toContain("start_date date NOT NULL");
      expect(migrationSql).toContain("end_date date NOT NULL");
      expect(migrationSql).toContain("duration_days integer NOT NULL CHECK (duration_days > 0)");
    });

    it("9. Accommodation allocation history supports assignment and reassignment tracking", () => {
      expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.accommodation_allocations");
      expect(migrationSql).toContain("participant_accommodation_id uuid NOT NULL");
      expect(migrationSql).toContain("hostel_id uuid NOT NULL");
      expect(migrationSql).toContain("room_id uuid NOT NULL");
      expect(migrationSql).toContain("status text NOT NULL DEFAULT 'active'");
      expect(migrationSql).toContain("deallocated_at timestamp with time zone");
      expect(migrationSql).toContain("idx_accommodation_allocations_active");
    });

    it("10. Accommodation tables do not expose public anonymous access (strict RLS + service_role only)", () => {
      const expectedTables = [
        "accommodation_plans",
        "hostels",
        "hostel_rooms",
        "participant_accommodations",
        "accommodation_allocations",
      ];

      for (const table of expectedTables) {
        expect(migrationSql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
        expect(migrationSql).toContain(
          `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`
        );
        expect(migrationSql).toContain(
          `GRANT ALL ON TABLE public.${table} TO service_role;`
        );
      }
    });
  });
});
