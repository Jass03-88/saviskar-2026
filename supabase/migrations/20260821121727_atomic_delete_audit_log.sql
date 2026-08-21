-- Create admin_audit_logs table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id uuid REFERENCES auth.users(id),
    action_type text NOT NULL,
    target_id uuid NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- RLS for admin_audit_logs (only viewable by master admins)
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master admins can view admin_audit_logs"
ON public.admin_audit_logs FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.admins
        WHERE user_id = auth.uid() AND role = 'master'
    )
);

-- Delete RPC function
CREATE OR REPLACE FUNCTION delete_registration_permanently(
    p_participant_event_id uuid,
    p_admin_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_registration record;
    v_payment_order_id uuid;
    v_payment_order_ids uuid[];
BEGIN
    -- 1. Database-level Master Admin Authorization Check
    IF NOT EXISTS (
        SELECT 1 FROM public.admins
        WHERE user_id = p_admin_id AND role = 'master'
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Master admin privileges required';
    END IF;

    -- 2. Capture metadata
    SELECT pe.*, p.participant_id as perma_id
    INTO v_registration
    FROM participant_events pe
    JOIN participants p ON p.id = pe.participant_id
    WHERE pe.id = p_participant_event_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration not found';
    END IF;

    -- 3. Audit log MUST be in the same transaction
    INSERT INTO admin_audit_logs (admin_id, action_type, target_id, details)
    VALUES (
        p_admin_id,
        'DELETE_REGISTRATION',
        p_participant_event_id,
        jsonb_build_object(
            'participant_id', v_registration.perma_id,
            'event_id', v_registration.event_id,
            'payment_status', v_registration.payment_status,
            'team_name', v_registration.team_name,
            'deleted_at', now()
        )
    );

    -- 4. Gather all associated payment orders before deleting items
    SELECT array_agg(DISTINCT payment_order_id) INTO v_payment_order_ids
    FROM payment_order_items 
    WHERE participant_event_id = p_participant_event_id AND payment_order_id IS NOT NULL;

    -- 5. Delete payment order items and members
    DELETE FROM payment_order_items WHERE participant_event_id = p_participant_event_id;
    DELETE FROM participant_event_members WHERE participant_event_id = p_participant_event_id;

    -- 6. Delete ALL empty payment orders that have no other items remain
    IF v_payment_order_ids IS NOT NULL THEN
        FOREACH v_payment_order_id IN ARRAY v_payment_order_ids LOOP
            IF NOT EXISTS (SELECT 1 FROM payment_order_items WHERE payment_order_id = v_payment_order_id) THEN
                DELETE FROM payment_orders WHERE id = v_payment_order_id;
            END IF;
        END LOOP;
    END IF;

    -- 7. Delete the participant event
    DELETE FROM participant_events WHERE id = p_participant_event_id;

    -- Note: Participants row is intentionally NOT deleted to preserve the permanent participant identity.

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Secure the function: Revoke public access
REVOKE ALL ON FUNCTION delete_registration_permanently(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION delete_registration_permanently(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION delete_registration_permanently(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION delete_registration_permanently(uuid, uuid) TO service_role;
