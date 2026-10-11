-- Migration: 20261013000000_safe_accommodation_deletion.sql
-- Description: Replaces the destructive accommodation deletion RPC with a safe soft-cancellation workflow.
-- It preserves allocation history, financial records, and audit trails while freeing up room capacity.

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
BEGIN
    -- 1. Authorization: Admin must have accommodation_access = true OR role = 'master'
    IF NOT EXISTS (
        SELECT 1 FROM public.admins
        WHERE user_id = p_admin_id AND (role = 'master' OR accommodation_access = true)
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Accommodation admin privileges required' USING errcode = '42501';
    END IF;

    -- 2. Fetch accommodation record with participant metadata and lock row
    SELECT pa.*, p.name as participant_name, p.email as participant_email, p.participant_id as perma_id
    INTO v_acc
    FROM public.participant_accommodations pa
    JOIN public.participants p ON p.id = pa.participant_id
    WHERE pa.id = p_accommodation_id
    FOR UPDATE OF pa;

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
            'cancelled_at', now()
        )
    );

    -- 4. Soft-cancel any active allocation to release capacity
    UPDATE public.accommodation_allocations
    SET status = 'cancelled',
        deallocated_at = now(),
        reason = 'Accommodation cancelled by administrator'
    WHERE participant_accommodation_id = p_accommodation_id
      AND status = 'active';

    -- 5. Soft-cancel the accommodation record itself
    UPDATE public.participant_accommodations
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_accommodation_id;

    -- 6. Note: We strictly PRESERVE all payment_orders and payment_order_items. 
    -- The financial history and its links to this accommodation are untouched.

    RETURN jsonb_build_object('success', true, 'action', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_accommodation_permanently(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_accommodation_permanently(uuid, uuid) TO service_role;
