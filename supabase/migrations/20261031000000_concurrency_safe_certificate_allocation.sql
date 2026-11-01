-- ============================================================================
-- Migration: Concurrency-Safe Certificate Number Allocation and Issuance
-- Description:
--   1. Creates public.participation_certificate_number_seq for atomic number allocation.
--   2. Provides atomic RPC public.issue_or_get_participation_certificate to handle
--      certificate number collisions and concurrent worker requests safely.
--   3. Idempotently returns existing certificates without duplicate creation.
--   4. Strictly grants permissions only to service_role.
-- ============================================================================

-- 1. Create atomic sequence for guaranteed collision-free certificate numbers
CREATE SEQUENCE IF NOT EXISTS public.participation_certificate_number_seq
    START WITH 10001
    INCREMENT BY 1;

-- 2. Atomic issuance and retrieval RPC
CREATE OR REPLACE FUNCTION public.issue_or_get_participation_certificate(
    p_issue_source_key text,
    p_original_participant_event_id uuid,
    p_original_member_row_id uuid DEFAULT NULL,
    p_original_participant_id uuid DEFAULT NULL,
    p_participant_event_id uuid DEFAULT NULL,
    p_participant_event_member_id uuid DEFAULT NULL,
    p_participant_id uuid DEFAULT NULL,
    p_event_id uuid DEFAULT NULL,
    p_recipient_name text DEFAULT 'Participant',
    p_recipient_email text DEFAULT NULL,
    p_event_name text DEFAULT 'Saviskar 2026',
    p_team_name text DEFAULT NULL,
    p_template_version text DEFAULT 'v1-2026-cgc',
    p_template_hash text DEFAULT '7147721299ba3436899d85e94bde01339af23caea2009aaf5c7b272176ecb207'
)
RETURNS TABLE (
    id uuid,
    certificate_number text,
    issue_source_key text,
    is_new boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_id uuid;
    v_existing_number text;
    v_new_id uuid;
    v_cert_number text;
    v_seq bigint;
    v_hash text;
    v_attempts integer := 0;
BEGIN
    -- 1. Fast idempotent path: check if certificate already exists for this issue source key
    SELECT c.id, c.certificate_number
    INTO v_existing_id, v_existing_number
    FROM public.participation_certificates c
    WHERE c.issue_source_key = p_issue_source_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT v_existing_id, v_existing_number, p_issue_source_key, false;
        RETURN;
    END IF;

    -- 2. Base hash from issue source key using built-in md5
    v_hash := upper(substr(md5(p_issue_source_key), 1, 10));

    -- 3. Collision-free insertion loop
    WHILE v_attempts < 10 LOOP
        v_attempts := v_attempts + 1;

        IF v_attempts = 1 THEN
            -- First attempt uses standard deterministic hash
            v_cert_number := 'SAV26-CERT-' || v_hash;
        ELSE
            -- Subsequent attempts allocate guaranteed unique atomic sequence number
            v_seq := nextval('public.participation_certificate_number_seq');
            v_cert_number := 'SAV26-CERT-' || upper(substr(v_hash, 1, 6)) || lpad(v_seq::text, 4, '0');
        END IF;

        BEGIN
            INSERT INTO public.participation_certificates (
                certificate_number,
                issue_source_key,
                original_participant_event_id,
                original_member_row_id,
                original_participant_id,
                participant_event_id,
                participant_event_member_id,
                participant_id,
                event_id,
                recipient_name,
                recipient_email,
                event_name,
                team_name,
                template_version,
                template_hash
            ) VALUES (
                v_cert_number,
                p_issue_source_key,
                p_original_participant_event_id,
                p_original_member_row_id,
                p_original_participant_id,
                p_participant_event_id,
                p_participant_event_member_id,
                p_participant_id,
                p_event_id,
                p_recipient_name,
                p_recipient_email,
                p_event_name,
                p_team_name,
                p_template_version,
                p_template_hash
            )
            RETURNING public.participation_certificates.id, public.participation_certificates.certificate_number
            INTO v_new_id, v_cert_number;

            RETURN QUERY SELECT v_new_id, v_cert_number, p_issue_source_key, true;
            RETURN;

        EXCEPTION
            WHEN unique_violation THEN
                -- Check if concurrent process inserted the same issue_source_key
                SELECT c.id, c.certificate_number
                INTO v_existing_id, v_existing_number
                FROM public.participation_certificates c
                WHERE c.issue_source_key = p_issue_source_key
                LIMIT 1;

                IF v_existing_id IS NOT NULL THEN
                    RETURN QUERY SELECT v_existing_id, v_existing_number, p_issue_source_key, false;
                    RETURN;
                END IF;

                -- If conflict was on certificate_number, loop continues and uses sequence
                CONTINUE;
        END;
    END LOOP;

    RAISE EXCEPTION 'Failed to allocate unique certificate number for % after % attempts', p_recipient_name, v_attempts;
END;
$$;

-- 3. Permissions
REVOKE ALL ON FUNCTION public.issue_or_get_participation_certificate FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_or_get_participation_certificate TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.participation_certificate_number_seq TO service_role;

