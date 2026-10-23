import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const migrationFilePath = path.resolve(
  __dirname,
  "../../supabase/migrations/20261021010000_fix_registration_member_college_and_rpc_resilience.sql"
);

describe("SAVISKAR 2026 — Pending Migration 20261021010000 Resilience & Invariants", () => {
  const sqlContent = fs.readFileSync(migrationFilePath, "utf8");

  describe("1. Structural & Security Invariants", () => {
    it("A. Migration file exists and has substantial content", () => {
      expect(fs.existsSync(migrationFilePath)).toBe(true);
      expect(sqlContent.length).toBeGreaterThan(10000);
    });

    it("B. Retains draft safety header preventing accidental unapproved deployment", () => {
      expect(sqlContent).toContain("Status: DRAFT / LOCAL ONLY — DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT APPROVAL");
    });

    it("C. Preserves exact 11-parameter RPC signature matching application route", () => {
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

    it("D. Preserves SECURITY DEFINER and search_path TO 'public'", () => {
      expect(sqlContent).toContain("SECURITY DEFINER");
      expect(sqlContent).toContain("SET \"search_path\" TO 'public'");
    });

    it("E. Preserves strict permission grants (service_role only, revoked from PUBLIC/anon/authenticated)", () => {
      expect(sqlContent).toContain('REVOKE ALL ON FUNCTION "public"."register_participant_events"');
      expect(sqlContent).toContain("FROM PUBLIC, anon, authenticated");
      expect(sqlContent).toContain('GRANT ALL ON FUNCTION "public"."register_participant_events"');
      expect(sqlContent).toContain('TO "service_role"');
    });
  });

  describe("2. Elimination of PostgreSQL 42702 Ambiguity Defects", () => {
    it("A. Explicitly qualifies participants.id and participants.participant_id in main participant INSERT", () => {
      expect(sqlContent).toMatch(
        /returning\s+participants\.id,\s+participants\.participant_id\s+into\s+v_participant_uuid,\s+v_participant_public_id/i
      );
    });

    it("B. Explicitly qualifies participants.id and participants.participant_id in team member INSERT", () => {
      expect(sqlContent).toMatch(
        /returning\s+participants\.id,\s+participants\.participant_id\s+into\s+v_member_uuid,\s+v_member_public_id/i
      );
    });

    it("C. Explicitly qualifies participants.id and participants.participant_id in faculty INSERT", () => {
      expect(sqlContent).toMatch(
        /returning\s+participants\.id,\s+participants\.participant_id\s+into\s+v_faculty_uuid,\s+v_faculty_public_id/i
      );
    });

    it("D. Contains ZERO instances of unqualified 'returning id, participant_id' on participants table", () => {
      expect(sqlContent).not.toMatch(/returning\s+id,\s+participant_id\s+into/i);
    });
  });

  describe("3. Participant ID Lookup & Input Compatibility", () => {
    it("A. Uses nullif(trim(p_participant_id), '') to properly handle blank, empty, and whitespace IDs", () => {
      expect(sqlContent).toContain("if nullif(trim(p_participant_id), '') is not null then");
    });

    it("B. Uses case-insensitive comparison upper(trim(p.participant_id)) = upper(trim(p_participant_id))", () => {
      expect(sqlContent).toContain("upper(trim(p.participant_id)) = upper(trim(p_participant_id))");
    });

    it("C. Unconditionally locks the resolved participant row with FOR UPDATE", () => {
      expect(sqlContent).toContain("perform 1 from public.participants where id = v_participant_uuid for update;");
    });

    it("D. Validates all personal details for new participants with error code SVK01", () => {
      expect(sqlContent).toContain("All personal details are required for new participants");
      expect(sqlContent).toContain("using errcode = 'SVK01'");
    });

    it("E. Validates email matching for supplied participant ID with error code SVK02", () => {
      expect(sqlContent).toContain("Supplied email does not match the registered participant");
      expect(sqlContent).toContain("using errcode = 'SVK02'");
    });
  });

  describe("4. Accommodation Paid-Overlap Established Behavior", () => {
    it("A. Gracefully skips accommodation booking for team member who is already fully covered", () => {
      // Must have v_is_fully_covered check under v_acc_participant_uuid <> v_participant_uuid followed by continue;
      const memberOverlapBlock = sqlContent.substring(
        sqlContent.indexOf("if v_overlapping_paid_count > 0 then"),
        sqlContent.indexOf("5b-i. PESSIMISTICALLY EVALUATE OVERLAPPING")
      );
      expect(memberOverlapBlock).toContain("v_acc_participant_uuid <> v_participant_uuid");
      expect(memberOverlapBlock).toContain("if v_is_fully_covered then");
      expect(memberOverlapBlock).toContain("continue;");
    });

    it("B. Rejects partial overlap for team members with SVK11", () => {
      const memberOverlapBlock = sqlContent.substring(
        sqlContent.indexOf("if v_overlapping_paid_count > 0 then"),
        sqlContent.indexOf("5b-i. PESSIMISTICALLY EVALUATE OVERLAPPING")
      );
      expect(memberOverlapBlock).toContain("partially overlaps with an existing booking");
      expect(memberOverlapBlock).toContain("using errcode = 'SVK11'");
    });

    it("C. Rejects overlapping accommodation for primary participant with SVK11", () => {
      const memberOverlapBlock = sqlContent.substring(
        sqlContent.indexOf("if v_overlapping_paid_count > 0 then"),
        sqlContent.indexOf("5b-i. PESSIMISTICALLY EVALUATE OVERLAPPING")
      );
      expect(memberOverlapBlock).toContain("Participant already has a confirmed accommodation booking covering dates");
      expect(memberOverlapBlock).toContain("using errcode = 'SVK11'");
    });

    it("D. Preserves advisory locks and stale hold evaluation", () => {
      expect(sqlContent).toContain("hashtext('participant_accommodation:' ||");
      expect(sqlContent).toContain("v_has_active_checkout");
      expect(sqlContent).toContain("interval '1 hour'");
    });
  });

  describe("5. Event Duplicate & Cancelled Event Handling", () => {
    it("A. Duplicate check ignores cancelled registrations when identifying active events", () => {
      expect(sqlContent).toContain("and pe.registration_status <> 'cancelled'");
    });

    it("B. Explicitly detects previously cancelled registrations and raises SVK05 rather than 23505 unique constraint", () => {
      expect(sqlContent).toContain("pe.registration_status = 'cancelled'");
      expect(sqlContent).toContain("was previously cancelled. Please contact support.");
      expect(sqlContent).toContain("using errcode = 'SVK05'");
    });

    it("C. Uses consistent 'participant_id' key in v_results for table unpacking", () => {
      expect(sqlContent).not.toContain("'participant_public_id', v_participant_public_id");
      expect(sqlContent).toContain("'participant_id', v_participant_public_id");
      expect(sqlContent).toContain("participant_id := v_res->>'participant_id';");
    });

    it("D. Verifies exact actionable wording for cancelled registration exception", () => {
      expect(sqlContent).toMatch(
        /raise exception 'Registration for % was previously cancelled\. Please contact support\.', v_event_row\.name using errcode = 'SVK05';/
      );
    });
  });

  describe("6. Intended Resilience Improvements", () => {
    it("A. Team member college fallback through member -> existing participant -> registrant", () => {
      expect(sqlContent).toMatch(
        /v_member_college\s*:=\s*coalesce\(\s*nullif\(trim\(v_member->>'college'\),\s*''\),\s*v_existing_participant\.college,\s*nullif\(trim\(p_college\),\s*''\)\s*\);/
      );
    });

    it("B. Faculty college fallback through faculty -> existing participant -> registrant", () => {
      expect(sqlContent).toMatch(
        /v_faculty_college\s*:=\s*coalesce\(\s*nullif\(trim\(p_faculty->>'college'\),\s*''\),\s*v_existing_participant\.college,\s*nullif\(trim\(p_college\),\s*''\)\s*\);/
      );
    });

    it("C. Supports both camelCase and snake_case for member idCardStoragePath", () => {
      expect(sqlContent).toContain("v_member->>'idCardStoragePath'");
      expect(sqlContent).toContain("v_member->>'id_card_storage_path'");
    });

    it("D. Supports both camelCase and snake_case for member isTeamHead", () => {
      expect(sqlContent).toContain("(v_event->>'isTeamHead')::boolean");
      expect(sqlContent).toContain("(v_event->>'is_team_head')::boolean");
    });

    it("E. Supports both camelCase and snake_case for faculty idCardStoragePath", () => {
      expect(sqlContent).toContain("p_faculty->>'idCardStoragePath'");
      expect(sqlContent).toContain("p_faculty->>'id_card_storage_path'");
    });

    it("F. Uses proper SVK06 error code for team member name and email validation", () => {
      expect(sqlContent).toContain("Team member name and email required' using errcode = 'SVK06'");
    });
  });
});
