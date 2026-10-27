-- Migration: 20261027030000_broadcast_worker_lease_and_status_guard.sql
-- Description:
--   1. Create broadcast_worker_leases table and atomic lease RPCs for connection-pooled Next.js environments
--   2. Update claim_broadcast_deliveries to join broadcast_campaigns and enforce that only
--      deliveries belonging to campaigns in 'queued' or 'processing' status can ever be claimed.
--      Inactive campaigns ('paused', 'cancelled', 'completed', 'failed', 'draft') are strictly excluded.

-- ============================================================================
-- 1. Database-Backed Concurrency Control: broadcast_worker_leases
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.broadcast_worker_leases (
    lock_key text PRIMARY KEY,
    owner_token text NOT NULL,
    acquired_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Secure the lease table: strictly service_role only
REVOKE ALL ON public.broadcast_worker_leases FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.broadcast_worker_leases TO service_role;

-- Atomic Lease Acquisition RPC
CREATE OR REPLACE FUNCTION public.acquire_broadcast_worker_lease(
    p_lock_key text,
    p_owner_token text,
    p_lease_seconds integer DEFAULT 30
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
    v_acquired boolean := false;
BEGIN
    INSERT INTO public.broadcast_worker_leases (lock_key, owner_token, acquired_at, expires_at, updated_at)
    VALUES (
        p_lock_key,
        p_owner_token,
        clock_timestamp(),
        clock_timestamp() + (p_lease_seconds || ' seconds')::interval,
        clock_timestamp()
    )
    ON CONFLICT (lock_key) DO UPDATE
    SET
        owner_token = EXCLUDED.owner_token,
        acquired_at = EXCLUDED.acquired_at,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at
    WHERE public.broadcast_worker_leases.expires_at < clock_timestamp();

    SELECT (owner_token = p_owner_token AND expires_at > clock_timestamp()) INTO v_acquired
    FROM public.broadcast_worker_leases
    WHERE lock_key = p_lock_key;

    RETURN COALESCE(v_acquired, false);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_broadcast_worker_lease(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_broadcast_worker_lease(text, text, integer) TO service_role;

-- Atomic Lease Release RPC (Safe from releasing a newer owner's lease)
CREATE OR REPLACE FUNCTION public.release_broadcast_worker_lease(
    p_lock_key text,
    p_owner_token text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
    v_released_count integer := 0;
BEGIN
    DELETE FROM public.broadcast_worker_leases
    WHERE lock_key = p_lock_key
      AND owner_token = p_owner_token;

    GET DIAGNOSTICS v_released_count = ROW_COUNT;
    RETURN (v_released_count > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.release_broadcast_worker_lease(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_broadcast_worker_lease(text, text) TO service_role;

-- ============================================================================
-- 2. Update claim_broadcast_deliveries: Atomically Enforce Campaign Status
-- ============================================================================
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
    UPDATE public.broadcast_deliveries d
    SET
        status = 'manual_review',
        error_message = 'Worker lease expired after reaching maximum dispatch attempts. Held for manual review.',
        error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
        locked_at = NULL,
        locked_by = NULL,
        updated_at = clock_timestamp()
    WHERE d.status = 'sending'
      AND (p_campaign_id IS NULL OR d.campaign_id = p_campaign_id)
      AND d.locked_at < (clock_timestamp() - (p_lease_seconds || ' seconds')::interval)
      AND d.attempts >= d.max_attempts;

    -- 2. Select queued deliveries or expired sending leases (FOR UPDATE OF d SKIP LOCKED)
    -- Crucial safeguard: Join broadcast_campaigns and filter strictly on eligible campaign statuses:
    -- 'queued' or 'processing'. Deliveries belonging to 'paused', 'cancelled', 'completed', 'failed',
    -- or 'draft' campaigns are NEVER claimed.
    SELECT array_agg(d.id) INTO v_claimed_ids
    FROM (
        SELECT d.id
        FROM public.broadcast_deliveries d
        JOIN public.broadcast_campaigns c ON c.id = d.campaign_id
        WHERE (
            d.status = 'queued'
            OR (d.status = 'sending' AND d.locked_at < (clock_timestamp() - (p_lease_seconds || ' seconds')::interval))
        )
        AND c.status IN ('queued', 'processing')
        AND (p_campaign_id IS NULL OR d.campaign_id = p_campaign_id)
        AND d.attempts < d.max_attempts
        ORDER BY d.created_at ASC
        LIMIT p_batch_size
        FOR UPDATE OF d SKIP LOCKED
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
