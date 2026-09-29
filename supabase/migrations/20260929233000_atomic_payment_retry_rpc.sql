-- Migration: 20260929233000_atomic_payment_retry_rpc.sql
-- Description: Adds atomic create_payment_retry_attempt RPC to guarantee safe payment retries
-- without race conditions, duplicate active attempts, or orphaned/partial records.

CREATE OR REPLACE FUNCTION public.create_payment_retry_attempt(
    p_payment_order_id uuid,
    p_new_order_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_order record;
    v_new_order_id uuid;
    v_pe_ids uuid[];
    v_existing_active_id uuid;
    v_items_count integer;
    v_result jsonb;
BEGIN
    -- 1. Validate inputs
    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_payment_order_id is required' USING ERRCODE = '22023';
    END IF;

    IF p_new_order_reference IS NULL OR trim(p_new_order_reference) = '' THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: p_new_order_reference is required' USING ERRCODE = '22023';
    END IF;

    -- 2. Lock the original payment order row
    SELECT * INTO v_old_order
    FROM public.payment_orders
    WHERE id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Original payment order % not found', p_payment_order_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Check if original order is already paid
    IF v_old_order.status = 'paid' THEN
        RAISE EXCEPTION 'ALREADY_PAID: Payment order % is already completed', p_payment_order_id USING ERRCODE = '23505';
    END IF;

    -- 4. Collect and lock relevant participant event IDs in sorted order to prevent deadlocks
    SELECT array_agg(DISTINCT poi.participant_event_id ORDER BY poi.participant_event_id)
    INTO v_pe_ids
    FROM public.payment_order_items poi
    WHERE poi.payment_order_id = p_payment_order_id
      AND poi.participant_event_id IS NOT NULL;

    IF v_pe_ids IS NOT NULL AND cardinality(v_pe_ids) > 0 THEN
        -- Lock participant events rows
        PERFORM 1
        FROM public.participant_events pe
        WHERE pe.id = ANY(v_pe_ids)
        ORDER BY pe.id
        FOR UPDATE;

        -- Verify none of the participant events have already been marked paid
        IF EXISTS (
            SELECT 1
            FROM public.participant_events pe
            WHERE pe.id = ANY(v_pe_ids)
              AND pe.payment_status = 'paid'
        ) THEN
            RAISE EXCEPTION 'EVENT_ALREADY_PAID: One or more participant events are already marked paid' USING ERRCODE = '23505';
        END IF;

        -- Check if any other active pending payment order exists for these participant events
        SELECT po.id INTO v_existing_active_id
        FROM public.payment_order_items poi
        JOIN public.payment_orders po ON po.id = poi.payment_order_id
        WHERE poi.participant_event_id = ANY(v_pe_ids)
          AND po.id <> p_payment_order_id
          AND po.status = 'pending'
        LIMIT 1;

        IF v_existing_active_id IS NOT NULL THEN
            RAISE EXCEPTION 'ACTIVE_ATTEMPT_EXISTS: An active pending payment order (%) already exists for this registration', v_existing_active_id USING ERRCODE = '40001';
        END IF;
    END IF;

    -- 5. Verify the original order actually has line items to copy
    SELECT count(*) INTO v_items_count
    FROM public.payment_order_items
    WHERE payment_order_id = p_payment_order_id;

    IF v_items_count = 0 THEN
        RAISE EXCEPTION 'EMPTY_ORDER_ITEMS: Original payment order % has no line items', p_payment_order_id USING ERRCODE = 'P0002';
    END IF;

    -- 6. Mark old order as failed (preserving original gateway_order_id for audit history)
    UPDATE public.payment_orders
    SET status = 'failed',
        updated_at = now()
    WHERE id = p_payment_order_id;

    -- 7. Insert new pending payment order
    INSERT INTO public.payment_orders (
        order_reference,
        payer_participant_id,
        amount,
        currency,
        status
    )
    VALUES (
        trim(p_new_order_reference),
        v_old_order.payer_participant_id,
        v_old_order.amount,
        COALESCE(v_old_order.currency, 'INR'),
        'pending'
    )
    RETURNING id INTO v_new_order_id;

    -- 8. Atomically copy all line items from old order to new order
    INSERT INTO public.payment_order_items (
        payment_order_id,
        participant_id,
        participant_event_id,
        participant_event_member_id,
        event_id,
        amount
    )
    SELECT
        v_new_order_id,
        poi.participant_id,
        poi.participant_event_id,
        poi.participant_event_member_id,
        poi.event_id,
        poi.amount
    FROM public.payment_order_items poi
    WHERE poi.payment_order_id = p_payment_order_id;

    -- 9. Build and return result object
    v_result := jsonb_build_object(
        'success', true,
        'old_order_id', p_payment_order_id,
        'new_order_id', v_new_order_id,
        'order_reference', trim(p_new_order_reference),
        'payer_participant_id', v_old_order.payer_participant_id,
        'amount', v_old_order.amount,
        'currency', COALESCE(v_old_order.currency, 'INR'),
        'status', 'pending',
        'items_count', v_items_count
    );

    RETURN v_result;
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.create_payment_retry_attempt(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_retry_attempt(uuid, text) TO service_role;
