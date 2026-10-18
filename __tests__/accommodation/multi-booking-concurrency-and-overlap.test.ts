import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  isDateBookedByParticipant,
  isPlanRangeConflicting,
} from "@/components/registration/RegistrationForm";
import { buildRegistrationCsvRow, CsvRegistrationItem, REGISTRATION_CSV_HEADERS } from "@/lib/admin/csv-export";

describe("SAVISKAR 2026: Multi-Booking Concurrency, Overlap Safeguards & Payment Integrity", () => {
  const rootDir = process.cwd();
  const migrationPath = path.join(
    rootDir,
    "supabase",
    "migrations",
    "20261018000000_allow_multiple_accommodation_bookings.sql"
  );
  const registerRoutePath = path.join(rootDir, "app", "api", "register", "route.ts");
  const recoverRoutePath = path.join(rootDir, "app", "api", "payments", "recover", "route.ts");
  const payuSuccessRoutePath = path.join(rootDir, "app", "api", "payments", "payu", "success", "route.ts");
  const webhookRoutePath = path.join(rootDir, "app", "api", "payments", "webhook", "route.ts");
  const adminRegistrationsPath = path.join(rootDir, "app", "api", "admin", "registrations", "route.ts");
  const csvExportPath = path.join(rootDir, "lib", "admin", "csv-export.ts");
  const registrationFormPath = path.join(rootDir, "components", "registration", "RegistrationForm.tsx");

  const migrationSql = fs.readFileSync(migrationPath, "utf-8");
  const registerRouteContent = fs.readFileSync(registerRoutePath, "utf-8");
  const recoverRouteContent = fs.readFileSync(recoverRoutePath, "utf-8");
  const payuSuccessContent = fs.readFileSync(payuSuccessRoutePath, "utf-8");
  const webhookContent = fs.readFileSync(webhookRoutePath, "utf-8");
  const adminRegistrationsContent = fs.readFileSync(adminRegistrationsPath, "utf-8");
  const csvExportContent = fs.readFileSync(csvExportPath, "utf-8");
  const registrationFormContent = fs.readFileSync(registrationFormPath, "utf-8");

  /* ====================================================================
     1. LOCAL MIGRATION INVARIANTS (UNAPPLIED MIGRATION VERIFICATION)
  ==================================================================== */
  describe("1. Local Database Migration Invariants", () => {
    it("A. Enables btree_gist extension for GiST exclusion constraints", () => {
      expect(migrationSql).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist;");
    });

    it("B. Drops obsolete single-active unique index", () => {
      expect(migrationSql).toContain(
        "DROP INDEX IF EXISTS public.idx_participant_accommodations_single_active;"
      );
    });

    it("C. Enforces participant_accommodations_no_overlap GiST exclusion constraint on half-open ranges", () => {
      expect(migrationSql).toContain("participant_accommodations_no_overlap");
      expect(migrationSql).toContain("EXCLUDE USING gist");
      expect(migrationSql).toContain("daterange(start_date, end_date, '[)') WITH &&");
      expect(migrationSql).toContain("WHERE (status NOT IN ('cancelled', 'failed'))");
    });

    it("D. Locks participant row with FOR UPDATE in register_participant_events for concurrency serialization", () => {
      expect(migrationSql).toContain("select p.id into v_acc_participant_uuid from public.participants");
      expect(migrationSql).toContain("perform 1 from public.participants where id = v_acc_participant_uuid for update;");
    });

    it("E. Supports team member skip logic when member already has full accommodation coverage", () => {
      expect(migrationSql).toContain("if v_is_fully_covered then");
      expect(migrationSql).toContain("continue;");
    });

    it("F. Rejects partial team member overlap with actionable error message", () => {
      expect(migrationSql).toContain("partially overlaps with an existing booking");
      expect(migrationSql).toContain("errcode = 'SVK11'");
    });

    it("G. Guards against active overlapping checkouts in progress (< 1 hour)", () => {
      expect(migrationSql).toContain("pa.status in ('pending', 'unpaid')");
      expect(migrationSql).toContain("pa.updated_at >= now() - interval '1 hour'");
      expect(migrationSql).toContain("Active checkout in progress for these dates");
    });

    it("H. Atomically links payment_order_id to new participant_accommodations rows", () => {
      expect(migrationSql).toContain("update public.participant_accommodations pa");
      expect(migrationSql).toContain("set payment_order_id = v_payment_order_id");
    });

    it("I. process_payment_success protects against late PayU callback date overlaps without breaking receipt idempotency", () => {
      expect(migrationSql).toContain("v_conflict_count := v_conflict_count + 1;");
      expect(migrationSql).toContain("status = 'cancelled'");
      expect(migrationSql).toContain("ACCOMMODATION_PAYMENT_OVERLAP_CONFLICT");
      expect(migrationSql).toContain("public.admin_audit_logs");
      expect(migrationSql).toContain("settled_with_accommodation_conflict");
      expect(migrationSql).toContain("INSERT INTO public.payments");
    });
  });

  /* ====================================================================
     2. DATE SEMANTICS & HALF-OPEN INTERVAL UNIT TESTS
  ==================================================================== */
  describe("2. Date Semantics & Half-Open Interval Validation", () => {
    function datesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
      return startA < endB && endA > startB;
    }

    it("A. Allows valid consecutive stays: [2026-10-28, 2026-10-29) and [2026-10-29, 2026-10-30)", () => {
      const stay1 = { start: "2026-10-28", end: "2026-10-29" };
      const stay2 = { start: "2026-10-29", end: "2026-10-30" };
      expect(datesOverlap(stay1.start, stay1.end, stay2.start, stay2.end)).toBe(false);
    });

    it("B. Disallows overlapping stays: [2026-10-28, 2026-10-30) and [2026-10-29, 2026-10-30)", () => {
      const stay1 = { start: "2026-10-28", end: "2026-10-30" };
      const stay2 = { start: "2026-10-29", end: "2026-10-30" };
      expect(datesOverlap(stay1.start, stay1.end, stay2.start, stay2.end)).toBe(true);
    });

    it("C. Disallows identical duplicate stays: [2026-10-28, 2026-10-29) and [2026-10-28, 2026-10-29)", () => {
      const stay1 = { start: "2026-10-28", end: "2026-10-29" };
      const stay2 = { start: "2026-10-28", end: "2026-10-29" };
      expect(datesOverlap(stay1.start, stay1.end, stay2.start, stay2.end)).toBe(true);
    });

    it("D. Correctly identifies booked dates using isDateBookedByParticipant helper", () => {
      const existingBookings = [
        { startDate: "2026-10-28", endDate: "2026-10-29", status: "paid" },
      ];

      expect(isDateBookedByParticipant("2026-10-28", existingBookings)).toBe(true);
      expect(isDateBookedByParticipant("2026-10-29", existingBookings)).toBe(false); // Checkout day
      expect(isDateBookedByParticipant("2026-10-27", existingBookings)).toBe(false);
    });

    it("E. Correctly identifies partial vs full overlap using isPlanRangeConflicting helper", () => {
      const existingBookings = [
        { startDate: "2026-10-28", endDate: "2026-10-29", status: "paid" },
      ];

      // 1-Day for Oct 28 is fully booked
      const oct28Plan = isPlanRangeConflicting("1_day", "2026-10-28", "none", existingBookings);
      expect(oct28Plan.hasConflict).toBe(true);
      expect(oct28Plan.isFullyBooked).toBe(true);

      // 1-Day for Oct 29 is available
      const oct29Plan = isPlanRangeConflicting("1_day", "2026-10-29", "none", existingBookings);
      expect(oct29Plan.hasConflict).toBe(false);
      expect(oct29Plan.isFullyBooked).toBe(false);

      // 2-Day (28 to 30) partially overlaps because 28 is booked, but 29 is free
      const twoDayPlan = isPlanRangeConflicting("2_days", undefined, "none", existingBookings);
      expect(twoDayPlan.hasConflict).toBe(true);
      expect(twoDayPlan.isFullyBooked).toBe(false);
    });
  });

  /* ====================================================================
     3. PAYMENT INTEGRITY & BACKEND ROUTES SAFEGUARDS
  ==================================================================== */
  describe("3. Payment Integrity & Backend Routes Invariants", () => {
    it("A. Scopes accommodation date updates to returnedPaymentOrderId in register route", () => {
      expect(registerRouteContent).toContain("returnedPaymentOrderId");
      expect(registerRouteContent).toContain('.eq("payment_order_id", returnedPaymentOrderId)');
    });

    it("B. Blocks payment recovery on cancelled bookings in recover route", () => {
      expect(recoverRouteContent).toContain('if (pa.status === "cancelled")');
      expect(recoverRouteContent).toContain("This accommodation booking has been cancelled and cannot be paid.");
    });

    it("C. Blocks payment recovery if another confirmed booking claimed overlapping dates", () => {
      expect(recoverRouteContent).toContain('.eq("status", "paid")');
      expect(recoverRouteContent).toContain('.lt("start_date", pa.end_date)');
      expect(recoverRouteContent).toContain('.gt("end_date", pa.start_date)');
      expect(recoverRouteContent).toContain("These accommodation dates are already covered by another confirmed booking.");
    });

    it("D. Handles settled_with_accommodation_conflict gracefully in PayU success callback", () => {
      expect(payuSuccessContent).toContain('rpcData?.action === "settled_with_accommodation_conflict"');
      expect(payuSuccessContent).toContain("settled with accommodation date conflict");
    });

    it("E. Handles settled_with_accommodation_conflict gracefully in PayU webhook route", () => {
      expect(webhookContent).toContain("conflictsCount: rpcData?.conflicts_count");
    });
  });

  /* ====================================================================
     4. ADMIN REPORTING & CSV EXPORT
  ==================================================================== */
  describe("4. Admin Reporting & Multi-Booking CSV Export", () => {
    it("A. Collects all accommodations per participant in admin registrations route", () => {
      expect(adminRegistrationsContent).toContain("allAccommodationsByParticipantId");
      expect(adminRegistrationsContent).toContain("accommodations: participantAccs");
      expect(adminRegistrationsContent).toContain("accommodations: memberAccs");
    });

    it("B. CSV export accurately summarizes multiple accommodations for a participant", () => {
      const mockItem: CsvRegistrationItem = {
        participant: {
          participant_id: "SVK26-ABC12345",
          name: "Jashan Jot",
          college: "Engineering College",
          email: "jashan@example.com",
          phone: "9876543210",
        },
        registration: {
          event_id: "ev-1",
          registration_status: "confirmed",
          payment_status: "paid",
          payment_amount: 500,
          created_at: "2026-10-15T10:00:00.000Z",
        },
        accommodation: {
          plan_name: "1-Day Accommodation",
          status: "paid",
          amount: 499,
          hostel_name: "Hostel A",
          room_number: "101",
        },
        accommodations: [
          {
            plan_name: "1-Day (28 Oct)",
            status: "paid",
            amount: 499,
            hostel_name: "Hostel A",
            room_number: "101",
          },
          {
            plan_name: "1-Day (29 Oct)",
            status: "paid",
            amount: 499,
            hostel_name: "Hostel A",
            room_number: "102",
          },
        ],
      };

      const row = buildRegistrationCsvRow(mockItem);
      const accPlanIdx = REGISTRATION_CSV_HEADERS.indexOf("Accommodation Type");
      const accStatusIdx = REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Status");
      const accAmountIdx = REGISTRATION_CSV_HEADERS.indexOf("Accommodation Payment Amount");
      const hostelIdx = REGISTRATION_CSV_HEADERS.indexOf("Hostel");
      const roomIdx = REGISTRATION_CSV_HEADERS.indexOf("Room Number");

      expect(row[accPlanIdx]).toBe("1-Day (28 Oct); 1-Day (29 Oct)");
      expect(row[accStatusIdx]).toBe("paid; paid");
      expect(row[accAmountIdx]).toBe(998);
      expect(row[hostelIdx]).toBe("Hostel A; Hostel A");
      expect(row[roomIdx]).toBe("101; 102");
    });
  });

  /* ====================================================================
     5. FRONTEND PARTICIPANT DASHBOARD & DATE BADGES
  ==================================================================== */
  describe("5. Frontend Participant Dashboard & Selection Safeguards", () => {
    it("A. Badges already-booked 1-Day date options and disables their selection", () => {
      expect(registrationFormContent).toContain('const is27Booked = isDateBookedByParticipant("2026-10-27", confirmedAccommodations);');
      expect(registrationFormContent).toContain('const is28Booked = isDateBookedByParticipant("2026-10-28", confirmedAccommodations);');
      expect(registrationFormContent).toContain('const is29Booked = isDateBookedByParticipant("2026-10-29", confirmedAccommodations);');
      expect(registrationFormContent).toContain('const is30Booked = isDateBookedByParticipant("2026-10-30", confirmedAccommodations);');
      expect(registrationFormContent).toContain("disabled={is28Booked}");
    });

    it("B. Badges plan cards with Booked and Overlap indicators", () => {
      expect(registrationFormContent).toContain("planStatus.isFullyBooked");
      expect(registrationFormContent).toContain("planStatus.hasConflict");
      expect(registrationFormContent).toContain("Booked");
      expect(registrationFormContent).toContain("Overlap");
    });

    it("C. Automatically shifts default 1-Day date if default date is already booked", () => {
      expect(registrationFormContent).toContain('mainAccommodationSlug === "1_day"');
      expect(registrationFormContent).toContain("isDateBookedByParticipant(mainAccommodationDate, confirmedAccommodations)");
      expect(registrationFormContent).toContain("setMainAccommodationDate(nextAvailable);");
    });
  });
});
