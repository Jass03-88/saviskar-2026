-- ============================================================================
-- Migration: Unique Constraint for Broadcast Delivery Attachments
-- Description:
--   Guarantees that a delivery cannot be linked to the same certificate more
--   than once, preventing duplicate attachments during concurrent campaign
--   enqueue operations or parallel retries.
--   Enables ON CONFLICT (delivery_id, certificate_id) DO NOTHING in PostgREST.
--   Genuinely idempotent: preflights for existing duplicates, checks pg_constraint
--   with schema and table qualification, and creates no redundant indexes on rerun.
-- ============================================================================

DO $$
DECLARE
    v_duplicate_count integer;
BEGIN
    -- 1. Preflight check: Ensure no duplicate (delivery_id, certificate_id) pairs exist
    SELECT count(*)
    INTO v_duplicate_count
    FROM (
        SELECT delivery_id, certificate_id
        FROM public.broadcast_delivery_attachments
        GROUP BY delivery_id, certificate_id
        HAVING count(*) > 1
    ) dup;

    IF v_duplicate_count > 0 THEN
        RAISE EXCEPTION 'Cannot add unique constraint: found % duplicate (delivery_id, certificate_id) pairs in public.broadcast_delivery_attachments. Manual reconciliation required before applying this migration.', v_duplicate_count;
    END IF;

    -- 2. Add named unique constraint if not already present on public.broadcast_delivery_attachments
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'broadcast_delivery_attachments'
          AND c.conname = 'uq_broadcast_delivery_attachments_delivery_cert'
    ) THEN
        ALTER TABLE public.broadcast_delivery_attachments
        ADD CONSTRAINT uq_broadcast_delivery_attachments_delivery_cert
        UNIQUE (delivery_id, certificate_id);
    END IF;
END $$;
