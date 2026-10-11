-- Migration: 20261011000000_atomic_payment_settlement.sql
-- Description: Atomic payment settlement RPCs and receipt uniqueness constraint.

-- NOTE: Before applying this migration, execute the following duplicate-detection query:
-- SELECT gateway_payment_id, COUNT(*) 
-- FROM public.payments 
-- WHERE gateway_payment_id IS NOT NULL 
-- GROUP BY gateway_payment_id 
-- HAVING COUNT(*) > 1;
-- If duplicates exist, manual reconciliation is required before applying the constraint.

-- 1. Enforce Receipt Uniqueness Per Order
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS uq_payments_gateway_payment_id;
ALTER TABLE public.payments ADD CONSTRAINT uq_payments_gateway_order_id UNIQUE (gateway_order_id);

-- 2. Atomic Settlement RPC
CREATE OR REPLACE FUNCTION public.process_payment_success(
    p_gateway_order_id text,
    p_gateway_payment_id text,
    p_amount_paise integer,
    p_currency text,
    p_gateway_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_order record;
    v_event_ids uuid[];
    v_first_event_id uuid;
    v_receipt record;
    v_receipt_count integer;
BEGIN
    -- 0. Serialize concurrent webhooks claiming the exact same gateway payment ID
    IF p_gateway_payment_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(p_gateway_payment_id));
    END IF;

    -- 1. Pessimistically lock the payment order
    SELECT * INTO v_order
    FROM public.payment_orders
    WHERE gateway_order_id = p_gateway_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    -- 1b. Check for cross-order gateway ID reuse
    IF p_gateway_payment_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_receipt_count 
        FROM public.payments 
        WHERE gateway_payment_id = p_gateway_payment_id 
          AND gateway_order_id != p_gateway_order_id;

        IF v_receipt_count > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Conflict: Gateway payment ID is already associated with a different order');
        END IF;
    END IF;

    -- 2. Handle Idempotency / Duplicate Callbacks
    IF v_order.status = 'paid' THEN
        -- 2a. Validate incoming gateway data against canonical order
        IF v_order.gateway_payment_id != p_gateway_payment_id 
           OR v_order.amount != p_amount_paise 
           OR p_currency IS NULL
           OR v_order.currency IS NULL
           OR upper(v_order.currency) != upper(p_currency) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Conflict: Order already paid with a different gateway payment ID, amount, or currency');
        END IF;

        -- 2b. Query canonical receipt count
        SELECT COUNT(*) INTO v_receipt_count FROM public.payments WHERE gateway_order_id = p_gateway_order_id;
        
        IF v_receipt_count != 1 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Reconciliation Error: Order is paid but has ' || v_receipt_count || ' receipts');
        END IF;

        -- 2c. Verify canonical receipt consistency
        SELECT * INTO v_receipt FROM public.payments WHERE gateway_order_id = p_gateway_order_id;

        IF v_receipt.participant_id != v_order.payer_participant_id
           OR v_receipt.gateway_payment_id != v_order.gateway_payment_id
           OR v_receipt.amount != v_order.amount THEN
            RETURN jsonb_build_object('success', false, 'error', 'Reconciliation Error: Receipt fields do not match canonical order');
        END IF;

        -- 2d. Exact match verified
        RETURN jsonb_build_object('success', true, 'action', 'already_paid');
    END IF;

    IF v_order.status = 'refunded' THEN
        RETURN jsonb_build_object('success', true, 'action', 'already_refunded');
    END IF;

    -- 3. Verify Amount and Currency
    IF v_order.amount * 100 != p_amount_paise THEN
        RETURN jsonb_build_object('success', false, 'error', 'Amount mismatch');
    END IF;

    IF upper(v_order.currency) != upper(p_currency) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Currency mismatch');
    END IF;

    -- 4. Enforce Receipt Invariant
    IF v_order.payer_participant_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot settle payment: payer_participant_id is missing, preventing receipt creation');
    END IF;

    -- 5. Insert Idempotency Token
    -- If this violates uq_processed_payment_event, it will automatically roll back the transaction,
    -- but our FOR UPDATE lock generally serializes this anyway.
    BEGIN
        INSERT INTO public.processed_payment_events (order_id, payment_id, event_type)
        VALUES (v_order.id, p_gateway_payment_id, 'payment.captured');
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', true, 'action', 'already_processed');
    END;

    -- 5. Update Payment Order
    UPDATE public.payment_orders
    SET status = 'paid',
        gateway_payment_id = p_gateway_payment_id,
        updated_at = now()
    WHERE id = v_order.id;

    -- 6. Collect Event IDs from Items
    SELECT array_agg(participant_event_id) INTO v_event_ids
    FROM public.payment_order_items
    WHERE payment_order_id = v_order.id AND participant_event_id IS NOT NULL;

    -- 7. Update Linked Events (if any)
    IF array_length(v_event_ids, 1) > 0 THEN
        UPDATE public.participant_events
        SET payment_status = 'paid',
            payment_id = p_gateway_payment_id,
            updated_at = now()
        WHERE id = ANY(v_event_ids);
        
        v_first_event_id := v_event_ids[1];
    ELSE
        v_first_event_id := NULL;
    END IF;

    -- 8. Update Linked Accommodations (Safely ignoring cancelled ones)
    UPDATE public.participant_accommodations
    SET status = 'paid',
        updated_at = now()
    WHERE payment_order_id = v_order.id
      AND status != 'cancelled';

    -- 10. Insert Canonical Receipt
    INSERT INTO public.payments (
        participant_id,
        participant_event_id,
        amount,
        status,
        gateway,
        gateway_payment_id,
        gateway_order_id
    ) VALUES (
        v_order.payer_participant_id,
        v_first_event_id,
        v_order.amount,
        'paid',
        p_gateway_name,
        p_gateway_payment_id,
        p_gateway_order_id
    );

    RETURN jsonb_build_object(
        'success', true, 
        'action', 'settled', 
        'payment_order_id', v_order.id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_payment_success(text, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_payment_success(text, text, integer, text, text) TO service_role;

-- 3. Atomic Failure RPC
CREATE OR REPLACE FUNCTION public.process_payment_failure(
    p_gateway_order_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_order record;
BEGIN
    SELECT * INTO v_order
    FROM public.payment_orders
    WHERE gateway_order_id = p_gateway_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF v_order.status IN ('paid', 'refunded') THEN
        RETURN jsonb_build_object('success', true, 'action', 'already_finalized');
    END IF;

    UPDATE public.payment_orders
    SET status = 'failed',
        updated_at = now()
    WHERE id = v_order.id;

    RETURN jsonb_build_object('success', true, 'action', 'failed', 'payment_order_id', v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.process_payment_failure(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_payment_failure(text) TO service_role;
