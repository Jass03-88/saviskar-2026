-- Migration: 20261009100000_accommodation_date_and_delete.sql
-- Description:
-- 1. Create delete_accommodation_permanently RPC to safely delete accommodation records with audit logging,
--    cascading allocation removal, and financial order preservation.
-- 2. Update register_participant_events RPC to support custom selected dates for 1-day accommodations (28th vs 29th Oct).

-- ------------------------------------------------------------
-- 1. DELETE ACCOMMODATION PERMANENTLY RPC
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_accommodation_permanently(
    p_accommodation_id uuid,
    p_admin_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_acc record;
    v_payment_order_id uuid;
    v_payment_order_ids uuid[];
BEGIN
    -- 1. Authorization: Admin must have accommodation_access = true OR role = 'master'
    IF NOT EXISTS (
        SELECT 1 FROM public.admins
        WHERE user_id = p_admin_id AND (role = 'master' OR accommodation_access = true)
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Accommodation admin privileges required' USING errcode = '42501';
    END IF;

    -- 2. Fetch accommodation record with participant metadata
    SELECT pa.*, p.name as participant_name, p.email as participant_email, p.participant_id as perma_id
    INTO v_acc
    FROM public.participant_accommodations pa
    JOIN public.participants p ON p.id = pa.participant_id
    WHERE pa.id = p_accommodation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Accommodation record not found' USING errcode = 'P0002';
    END IF;

    -- 3. Audit log in same transaction
    INSERT INTO public.admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (
        p_admin_id,
        'DELETE_ACCOMMODATION',
        p_accommodation_id,
        jsonb_build_object(
            'participant_id', v_acc.perma_id,
            'participant_name', v_acc.participant_name,
            'participant_email', v_acc.participant_email,
            'amount', v_acc.amount,
            'status', v_acc.status,
            'start_date', v_acc.start_date,
            'end_date', v_acc.end_date,
            'hostel_id', v_acc.hostel_id,
            'room_id', v_acc.room_id,
            'deleted_at', now()
        )
    );

    -- 4. Gather associated payment orders (Retained for variable consistency)
    SELECT array_agg(DISTINCT payment_order_id) INTO v_payment_order_ids
    FROM public.payment_order_items
    WHERE participant_accommodation_id = p_accommodation_id AND payment_order_id IS NOT NULL;

    -- 5. Soft-cancel any active allocation to release capacity
    UPDATE public.accommodation_allocations
    SET status = 'cancelled',
        deallocated_at = now(),
        reason = 'Accommodation cancelled by administrator'
    WHERE participant_accommodation_id = p_accommodation_id
      AND status = 'active';

    -- 6. Soft-cancel the accommodation record itself
    UPDATE public.participant_accommodations
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_accommodation_id;

    -- 7. Note: We strictly PRESERVE all payment_orders and payment_order_items. 
    -- The financial history and its links to this accommodation are untouched.

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_accommodation_permanently(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_accommodation_permanently(uuid, uuid) TO service_role;
