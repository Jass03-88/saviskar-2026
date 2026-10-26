-- ==============================================================================
-- Saviskar 2026: Phase 2 Temporary Registration-Form Lock Migration
-- Migration: 20261027010000_registration_lock_atomic_guard.sql
--
-- Extends the Site Page Access & Lock Control architecture with:
-- 1. Dual Advisory Locking in update_site_page_locks for both
--    ACCOMMODATION_ENABLED and REGISTRATION_ENABLED.
-- 2. Index coverage on admin_audit_logs for instant lock lookups.
-- 3. Atomic transaction boundary for admin lock transitions.
-- ==============================================================================

-- 1. Ensure lookup index exists for site page lock audit records
CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_site_page_locks"
ON "public"."admin_audit_logs" ("action_type", "created_at" DESC)
WHERE "action_type" = 'SITE_PAGE_LOCKS_UPDATE';

-- 2. Atomic Site Page Lock Update RPC with Dual Advisory Locking
CREATE OR REPLACE FUNCTION "public"."update_site_page_locks"(
    "p_admin_id" uuid,
    "p_target_id" uuid,
    "p_details" jsonb
) RETURNS jsonb
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_audit_id uuid;
begin
    -- Acquire exclusive transaction lock on the accommodation lock synchronization boundary
    perform pg_advisory_xact_lock(hashtext('site_page_locks:ACCOMMODATION_ENABLED'));

    -- Acquire exclusive transaction lock on the registration lock synchronization boundary
    perform pg_advisory_xact_lock(hashtext('site_page_locks:REGISTRATION_ENABLED'));

    -- Persist audit log record atomically with transaction timestamp
    insert into public.admin_audit_logs (
        admin_id, action_type, target_id, details, created_at
    ) values (
        p_admin_id, 'SITE_PAGE_LOCKS_UPDATE', p_target_id, p_details, now()
    ) returning id into v_audit_id;

    return jsonb_build_object('success', true, 'audit_id', v_audit_id);
end;
$$;

ALTER FUNCTION "public"."update_site_page_locks"("uuid", "uuid", "jsonb") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."update_site_page_locks"("uuid", "uuid", "jsonb") FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION "public"."update_site_page_locks"("uuid", "uuid", "jsonb") TO "service_role";
