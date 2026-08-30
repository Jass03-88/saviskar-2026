-- ============================================================
-- SAVISKAR 2026 — P0 SECURITY HARDENING
-- ============================================================
--
-- P0-5: Revoke anon/authenticated EXECUTE on dangerous RPCs.
--       These SECURITY DEFINER functions should only be callable
--       via service_role (server-side API routes).
--
-- P0-6: Enable RLS on payment_orders and payment_order_items.
--       All application access goes through service_role which
--       bypasses RLS. This blocks direct anon/authenticated access.
--
-- NOTE: No functions are dropped in this migration.
--       Dead function cleanup will be a separate migration
--       after the hardened system is verified.
-- ============================================================


-- ============================================================
-- P0-5: REVOKE DANGEROUS ANON/AUTHENTICATED RPC GRANTS
-- ============================================================

-- register_participant_events — actively used via service_role
REVOKE EXECUTE ON FUNCTION public.register_participant_events(
    p_participant_id text,
    p_name text,
    p_college text,
    p_email text,
    p_phone text,
    p_events jsonb
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.register_participant_events(
    p_participant_id text,
    p_name text,
    p_college text,
    p_email text,
    p_phone text,
    p_events jsonb
) FROM authenticated;


-- add_events_to_participant — dead code, but not dropped yet
REVOKE EXECUTE ON FUNCTION public.add_events_to_participant(
    p_participant_id text,
    p_event_ids uuid[]
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.add_events_to_participant(
    p_participant_id text,
    p_event_ids uuid[]
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.add_events_to_participant(
    p_participant_id text,
    p_event_ids uuid[]
) FROM authenticated;


-- create_event_registration — dead code, but not dropped yet
REVOKE EXECUTE ON FUNCTION public.create_event_registration(
    p_event_id uuid,
    p_name text,
    p_college text,
    p_email text,
    p_phone text,
    p_team text,
    p_members jsonb
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.create_event_registration(
    p_event_id uuid,
    p_name text,
    p_college text,
    p_email text,
    p_phone text,
    p_team text,
    p_members jsonb
) FROM authenticated;


-- ============================================================
-- P0-6: ENABLE RLS ON PAYMENT TABLES
-- ============================================================

-- Enable RLS — with no anon/authenticated policies, these
-- tables are effectively blocked for non-service_role access.
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_order_items ENABLE ROW LEVEL SECURITY;

-- Explicit service_role grants (for clarity and defense-in-depth)
GRANT ALL ON TABLE public.payment_orders TO service_role;
GRANT ALL ON TABLE public.payment_order_items TO service_role;
