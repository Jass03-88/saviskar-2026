-- ============================================================================
-- Migration: Master Admin Email Broadcast & Participation Certificate System
-- Author: Saviskar 2026 Core Engineering
-- Description:
--   Creates durable data model for:
--     1. broadcast_campaigns
--     2. participation_certificates
--     3. broadcast_deliveries
--     4. broadcast_delivery_attachments
--   Provides atomic queue claim RPC: claim_broadcast_deliveries (FOR UPDATE SKIP LOCKED)
--   Strictly grants permissions only to service_role, revoking from PUBLIC/anon/authenticated.
-- ============================================================================

-- 1. broadcast_campaigns
CREATE TABLE IF NOT EXISTS public.broadcast_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    body_text text NOT NULL,
    campaign_type text NOT NULL CHECK (campaign_type IN ('general', 'certificate')),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'processing', 'completed', 'paused', 'cancelled', 'failed')),
    target_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
    total_recipients integer NOT NULL DEFAULT 0,
    total_deliveries integer NOT NULL DEFAULT 0,
    sent_count integer NOT NULL DEFAULT 0,
    delivered_count integer NOT NULL DEFAULT 0,
    failed_count integer NOT NULL DEFAULT 0,
    created_by uuid REFERENCES public.admins(user_id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

-- 2. participation_certificates
CREATE TABLE IF NOT EXISTS public.participation_certificates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_number text NOT NULL UNIQUE,
    issue_source_key text NOT NULL UNIQUE,
    original_participant_event_id uuid NOT NULL,
    original_member_row_id uuid,
    original_participant_id uuid,
    participant_event_id uuid REFERENCES public.participant_events(id) ON DELETE SET NULL,
    participant_event_member_id uuid REFERENCES public.participant_event_members(id) ON DELETE SET NULL,
    participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
    event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
    recipient_name text NOT NULL,
    recipient_email text,
    event_name text NOT NULL,
    team_name text,
    template_version text NOT NULL DEFAULT 'v1',
    template_hash text NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. broadcast_deliveries
CREATE TABLE IF NOT EXISTS public.broadcast_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.broadcast_campaigns(id) ON DELETE CASCADE,
    recipient_email text NOT NULL,
    recipient_name text,
    channel text NOT NULL CHECK (channel IN ('general', 'individual', 'team_backup')),
    part_number integer NOT NULL DEFAULT 1,
    total_parts integer NOT NULL DEFAULT 1,
    subject text NOT NULL,
    body_html text NOT NULL,
    body_text text NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'manual_review', 'cancelled')),
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    provider_message_id text,
    idempotency_key text NOT NULL UNIQUE,
    locked_at timestamptz,
    locked_by text,
    error_message text,
    error_code text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. broadcast_delivery_attachments
CREATE TABLE IF NOT EXISTS public.broadcast_delivery_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id uuid NOT NULL REFERENCES public.broadcast_deliveries(id) ON DELETE CASCADE,
    certificate_id uuid NOT NULL REFERENCES public.participation_certificates(id) ON DELETE RESTRICT,
    filename text NOT NULL,
    size_bytes integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance and isolation
CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_status ON public.broadcast_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_campaign ON public.broadcast_deliveries(campaign_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_status ON public.broadcast_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_locked ON public.broadcast_deliveries(locked_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_recipient ON public.broadcast_deliveries(recipient_email);
CREATE INDEX IF NOT EXISTS idx_participation_certificates_pe_id ON public.participation_certificates(original_participant_event_id);
CREATE INDEX IF NOT EXISTS idx_participation_certificates_email ON public.participation_certificates(recipient_email);
CREATE INDEX IF NOT EXISTS idx_broadcast_delivery_attachments_delivery ON public.broadcast_delivery_attachments(delivery_id);

-- Enable RLS
ALTER TABLE public.broadcast_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participation_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_delivery_attachments ENABLE ROW LEVEL SECURITY;

-- Revoke all permissions from PUBLIC, anon, authenticated
REVOKE ALL ON public.broadcast_campaigns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.participation_certificates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.broadcast_deliveries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.broadcast_delivery_attachments FROM PUBLIC, anon, authenticated;

-- Grant permissions strictly to service_role
GRANT ALL ON public.broadcast_campaigns TO service_role;
GRANT ALL ON public.participation_certificates TO service_role;
GRANT ALL ON public.broadcast_deliveries TO service_role;
GRANT ALL ON public.broadcast_delivery_attachments TO service_role;

-- 5. Atomic batch claim RPC for worker processing
CREATE OR REPLACE FUNCTION public.claim_broadcast_deliveries(
    p_batch_size integer,
    p_worker_id text,
    p_lease_seconds integer DEFAULT 300
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
REVOKE ALL ON FUNCTION public.claim_broadcast_deliveries(integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_deliveries(integer, text, integer) TO service_role;
