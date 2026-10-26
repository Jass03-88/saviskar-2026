-- Migration: 20261026000002_scope_broadcast_claim_deliveries.sql
-- Description: Update claim_broadcast_deliveries to support campaign-scoped batch claiming
--              via optional p_campaign_id parameter, preventing cross-campaign queue dispatch.

-- Drop the previous 3-parameter function signature
DROP FUNCTION IF EXISTS public.claim_broadcast_deliveries(integer, text, integer);

-- Create updated function with optional p_campaign_id parameter
CREATE OR REPLACE FUNCTION public.claim_broadcast_deliveries(
    p_batch_size integer,
    p_worker_id text,
    p_lease_seconds integer DEFAULT 300,
    p_campaign_id uuid DEFAULT NULL
) RETURNS SETOF public.broadcast_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
    v_claimed_ids uuid[];
BEGIN
    -- 1. Sweep permanently expired sending leases that reached max_attempts into manual_review
    UPDATE public.broadcast_deliveries
    SET
        status = 'manual_review',
        error_message = 'Worker lease expired after reaching maximum dispatch attempts. Held for manual review.',
        error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
        locked_at = NULL,
        locked_by = NULL,
        updated_at = clock_timestamp()
    WHERE status = 'sending'
      AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
      AND locked_at < (clock_timestamp() - (p_lease_seconds || ' seconds')::interval)
      AND attempts >= max_attempts;

    -- 2. Select queued deliveries or expired sending leases (FOR UPDATE SKIP LOCKED)
    SELECT array_agg(d.id) INTO v_claimed_ids
    FROM (
        SELECT id
        FROM public.broadcast_deliveries
        WHERE (
            status = 'queued'
            OR (status = 'sending' AND locked_at < (clock_timestamp() - (p_lease_seconds || ' seconds')::interval))
        )
        AND (p_campaign_id IS NULL OR campaign_id = p_campaign_id)
        AND attempts < max_attempts
        ORDER BY created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    ) d;

    IF v_claimed_ids IS NULL OR array_length(v_claimed_ids, 1) = 0 THEN
        RETURN;
    END IF;

    -- 3. Atomically update status and lease
    RETURN QUERY
    UPDATE public.broadcast_deliveries
    SET
        status = 'sending',
        locked_at = clock_timestamp(),
        locked_by = p_worker_id,
        attempts = attempts + 1,
        updated_at = clock_timestamp()
    WHERE id = ANY(v_claimed_ids)
    RETURNING *;
END;
$$;

-- Secure the RPC
REVOKE ALL ON FUNCTION public.claim_broadcast_deliveries(integer, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_deliveries(integer, text, integer, uuid) TO service_role;
