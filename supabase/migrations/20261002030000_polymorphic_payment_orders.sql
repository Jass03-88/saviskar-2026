-- ============================================================
-- SAVISKAR 2026 — POLYMORPHIC PAYMENT ORDERS & ACCOMMODATION INTEGRATION
-- Migration: 20261002030000_polymorphic_payment_orders.sql
-- ============================================================
--
-- This migration establishes polymorphic line items on payment_order_items
-- so a single payment order can safely represent event registrations,
-- accommodation bookings, or both.
--
-- INVARIANTS:
-- 1. item_type must be either 'event' or 'accommodation'.
-- 2. When item_type = 'event', event_id is NOT NULL and participant_accommodation_id is NULL.
-- 3. When item_type = 'accommodation', participant_accommodation_id is NOT NULL and event_id is NULL.
-- 4. Existing event line items remain 100% valid with item_type = 'event'.
-- 5. Atomic retry RPC create_payment_retry_attempt is extended to handle both event
--    and accommodation items without creating duplicate active bookings.
-- 6. Atomic registration RPC register_participant_events is extended to accept
--    p_accommodations jsonb and calculate grand total atomically.
-- ============================================================

-- ------------------------------------------------------------
-- 0. FESTIVAL DATES & ACCOMMODATION CONFIGURATION
-- ------------------------------------------------------------
-- Centralized configuration for festival and accommodation dates.
-- Avoids hardcoding dates in RPC functions while ensuring historical
-- bookings snapshot their dates immutably.
CREATE TABLE IF NOT EXISTS public.festival_config (
    id text PRIMARY KEY DEFAULT 'current',
    festival_name text NOT NULL DEFAULT 'Saviskar 2026',
    event_start_date date NOT NULL DEFAULT '2026-10-28',
    event_end_date date NOT NULL DEFAULT '2026-10-29',
    accommodation_start_date date NOT NULL DEFAULT '2026-10-28',
    accommodation_end_date date NOT NULL DEFAULT '2026-10-30',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed initial festival config if not exists
INSERT INTO public.festival_config (
    id,
    festival_name,
    event_start_date,
    event_end_date,
    accommodation_start_date,
    accommodation_end_date
) VALUES (
    'current',
    'Saviskar 2026',
    '2026-10-28',
    '2026-10-29',
    '2026-10-28',
    '2026-10-30'
) ON CONFLICT (id) DO NOTHING;

-- RLS for festival_config (Restricted strictly to administrators and server-side RPC)
ALTER TABLE public.festival_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- Drop overly permissive public read policy if it exists
    IF EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'festival_config' AND policyname = 'Public can read festival config'
    ) THEN
        DROP POLICY "Public can read festival config" ON public.festival_config;
    END IF;

    -- Admin-only read policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'festival_config' AND policyname = 'Admins can read festival config'
    ) THEN
        CREATE POLICY "Admins can read festival config"
            ON public.festival_config FOR SELECT
            TO authenticated
            USING (public.is_admin());
    END IF;

    -- Admin-only update policy
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'festival_config' AND policyname = 'Admins can update festival config'
    ) THEN
        CREATE POLICY "Admins can update festival config"
            ON public.festival_config FOR UPDATE
            TO authenticated
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;
END $$;

-- Explicitly revoke access from public and anon; grant service_role and authenticated
REVOKE ALL ON TABLE public.festival_config FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.festival_config TO authenticated;
GRANT ALL ON TABLE public.festival_config TO service_role;


-- ------------------------------------------------------------
-- 1. SCHEMA ENHANCEMENT: POLYMORPHIC payment_order_items
-- ------------------------------------------------------------

-- A. Allow event_id to be NULL for non-event line items (e.g. accommodation)
ALTER TABLE public.payment_order_items
    ALTER COLUMN event_id DROP NOT NULL;

-- B. Add item_type with default 'event' for complete backward compatibility
ALTER TABLE public.payment_order_items
    ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'event';

-- C. Add participant_accommodation_id referencing participant_accommodations
ALTER TABLE public.payment_order_items
    ADD COLUMN IF NOT EXISTS participant_accommodation_id uuid;

-- D. Foreign Key Constraint for participant_accommodation_id (ON DELETE RESTRICT to protect financial history)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_order_items_participant_accommodation_id_fkey'
    ) THEN
        ALTER TABLE public.payment_order_items
            DROP CONSTRAINT payment_order_items_participant_accommodation_id_fkey;
    END IF;

    ALTER TABLE public.payment_order_items
        ADD CONSTRAINT payment_order_items_participant_accommodation_id_fkey
        FOREIGN KEY (participant_accommodation_id)
        REFERENCES public.participant_accommodations(id)
        ON DELETE RESTRICT;
END $$;

-- E. Constraint: item_type allowed values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_order_items_item_type_check'
    ) THEN
        ALTER TABLE public.payment_order_items
            ADD CONSTRAINT payment_order_items_item_type_check
            CHECK (item_type IN ('event', 'accommodation'));
    END IF;
END $$;

-- F. Strict Polymorphic Payload Check:
-- Event items MUST have event_id and NO accommodation_id.
-- Accommodation items MUST have participant_accommodation_id and NO event_id.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_order_items_payload_check'
    ) THEN
        ALTER TABLE public.payment_order_items
            ADD CONSTRAINT payment_order_items_payload_check
            CHECK (
                (item_type = 'event' AND event_id IS NOT NULL AND participant_accommodation_id IS NULL)
                OR
                (item_type = 'accommodation' AND event_id IS NULL AND participant_accommodation_id IS NOT NULL)
            );
    END IF;
END $$;

-- G. Indexes for fast polymorphic lookups
CREATE INDEX IF NOT EXISTS payment_order_items_pa_id_idx
    ON public.payment_order_items(participant_accommodation_id);

CREATE INDEX IF NOT EXISTS payment_order_items_item_type_idx
    ON public.payment_order_items(item_type);


-- ------------------------------------------------------------
-- 2. EXTEND ATOMIC PAYMENT RETRY RPC (create_payment_retry_attempt)
-- ------------------------------------------------------------

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
    v_pa_ids uuid[];
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

    -- 4A. Collect and lock relevant participant event IDs in sorted order to prevent deadlocks
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

    -- 4B. Collect and lock relevant accommodation booking IDs in sorted order
    SELECT array_agg(DISTINCT poi.participant_accommodation_id ORDER BY poi.participant_accommodation_id)
    INTO v_pa_ids
    FROM public.payment_order_items poi
    WHERE poi.payment_order_id = p_payment_order_id
      AND poi.participant_accommodation_id IS NOT NULL;

    IF v_pa_ids IS NOT NULL AND cardinality(v_pa_ids) > 0 THEN
        -- Lock participant accommodations rows
        PERFORM 1
        FROM public.participant_accommodations pa
        WHERE pa.id = ANY(v_pa_ids)
        ORDER BY pa.id
        FOR UPDATE;

        -- Verify none of the accommodations have already been marked paid
        IF EXISTS (
            SELECT 1
            FROM public.participant_accommodations pa
            WHERE pa.id = ANY(v_pa_ids)
              AND pa.status = 'paid'
        ) THEN
            RAISE EXCEPTION 'ACCOMMODATION_ALREADY_PAID: One or more accommodations are already marked paid' USING ERRCODE = '23505';
        END IF;

        -- Check if any other active pending payment order exists for these accommodations
        SELECT po.id INTO v_existing_active_id
        FROM public.payment_order_items poi
        JOIN public.payment_orders po ON po.id = poi.payment_order_id
        WHERE poi.participant_accommodation_id = ANY(v_pa_ids)
          AND po.id <> p_payment_order_id
          AND po.status = 'pending'
        LIMIT 1;

        IF v_existing_active_id IS NOT NULL THEN
            RAISE EXCEPTION 'ACTIVE_ATTEMPT_EXISTS: An active pending payment order (%) already exists for this accommodation', v_existing_active_id USING ERRCODE = '40001';
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

    -- 8. Atomically copy all line items from old order to new order (preserving item_type and accommodation links)
    INSERT INTO public.payment_order_items (
        payment_order_id,
        participant_id,
        participant_event_id,
        participant_event_member_id,
        event_id,
        item_type,
        participant_accommodation_id,
        amount
    )
    SELECT
        v_new_order_id,
        poi.participant_id,
        poi.participant_event_id,
        poi.participant_event_member_id,
        poi.event_id,
        COALESCE(poi.item_type, 'event'),
        poi.participant_accommodation_id,
        poi.amount
    FROM public.payment_order_items poi
    WHERE poi.payment_order_id = p_payment_order_id;

    -- 9. Repoint linked participant_accommodations to the new payment order
    IF v_pa_ids IS NOT NULL AND cardinality(v_pa_ids) > 0 THEN
        UPDATE public.participant_accommodations
        SET payment_order_id = v_new_order_id,
            updated_at = now()
        WHERE id = ANY(v_pa_ids);
    END IF;

    -- 10. Build and return result object
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

REVOKE ALL ON FUNCTION public.create_payment_retry_attempt(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_retry_attempt(uuid, text) TO service_role;


-- ------------------------------------------------------------
-- 3. EXTEND ATOMIC REGISTRATION RPC (register_participant_events)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."register_participant_events"(
    "p_participant_id" "text" DEFAULT NULL::"text",
    "p_name" "text" DEFAULT NULL::"text",
    "p_college" "text" DEFAULT NULL::"text",
    "p_email" "text" DEFAULT NULL::"text",
    "p_phone" "text" DEFAULT NULL::"text",
    "p_events" "jsonb" DEFAULT '[]'::"jsonb",
    "p_accommodations" "jsonb" DEFAULT '[]'::"jsonb"
) RETURNS TABLE(
    "participant_id" "text",
    "participant_event_id" "uuid",
    "event_id" "uuid",
    "event_name" "text",
    "status" "text"
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

declare
    v_participant_uuid uuid;
    v_participant_public_id text;

    v_event jsonb;
    v_member jsonb;

    v_event_id uuid;
    v_participant_event_id uuid;

    v_event_row record;

    v_existing_participant record;
    v_member_participant record;

    v_team text;
    v_members jsonb;

    v_member_count integer;
    v_total_participants integer;

    v_min_team_size integer;
    v_max_team_size integer;

    v_registration_type text;

    v_payment_amount integer;

    v_existing_event boolean;

    v_member_name text;
    v_member_email text;
    v_member_uuid uuid;
    v_member_public_id text;
    v_member_college text;
    v_is_team_head boolean;

    v_current_reg_count integer;
    v_attempt integer;

    -- For atomic payment order creation
    v_new_pe_ids uuid[] := array[]::uuid[];
    v_new_event_ids uuid[] := array[]::uuid[];
    v_new_amounts integer[] := array[]::integer[];
    v_total_paid_amount integer := 0;
    v_order_reference text;
    v_payment_order_id uuid;
    v_idx integer;

    -- Accommodation variables
    v_accommodation jsonb;
    v_acc_email text;
    v_acc_slug text;
    v_acc_plan record;
    v_acc_participant_uuid uuid;
    v_pa_id uuid;
    v_new_pa_ids uuid[] := array[]::uuid[];
    v_new_pa_amounts integer[] := array[]::integer[];
    v_acc_base_start_date date;
    v_acc_start_date date;
    v_acc_end_date date;

    -- Map to guarantee exactly one UUID per physical registration group/team
    v_group_ids jsonb := '{}'::jsonb;
    v_group_key text;
    v_current_group_id uuid;

begin

    -- =====================================================
    -- 1. Basic input validation
    -- =====================================================

    if p_events is null
       or jsonb_typeof(p_events) <> 'array'
       or jsonb_array_length(p_events) = 0
    then
        raise exception 'At least one event must be selected' using errcode = 'SVK11';
    end if;


    -- =====================================================
    -- 2. Find or Create participant
    --
    -- Priority:
    --   participant ID
    --   then email
    -- =====================================================

    if nullif(trim(p_participant_id), '') is not null then

        select
            p.id,
            p.participant_id,
            p.name,
            p.college,
            p.email,
            p.phone
        into v_existing_participant
        from public.participants p
        where upper(trim(p.participant_id))
              = upper(trim(p_participant_id))
        limit 1;

        if v_existing_participant.id is null then
            raise exception 'Participant ID was not found' using errcode = 'SVK01';
        end if;

        if lower(trim(v_existing_participant.email)) <> lower(trim(p_email)) then
            raise exception 'The provided email does not match this Participant ID' using errcode = 'SVK02';
        end if;

        v_participant_uuid := v_existing_participant.id;
        v_participant_public_id :=
            v_existing_participant.participant_id;

    else

        if nullif(trim(p_name), '') is null then
            raise exception 'Name is required' using errcode = 'SVK11';
        end if;

        if nullif(trim(p_college), '') is null then
            raise exception 'College is required' using errcode = 'SVK11';
        end if;

        if nullif(trim(p_email), '') is null then
            raise exception 'Email is required' using errcode = 'SVK11';
        end if;

        if nullif(trim(p_phone), '') is null then
            raise exception 'Phone is required' using errcode = 'SVK11';
        end if;


        -- -------------------------------------------------
        -- Existing participant with same email?
        --
        -- In Saviskar 2026, email represents the unique student identity.
        -- If yes, reuse that participant.
        -- -------------------------------------------------

        select
            p.id,
            p.participant_id,
            p.name,
            p.college,
            p.email,
            p.phone
        into v_existing_participant
        from public.participants p
        where lower(trim(p.email))
              = lower(trim(p_email))
        limit 1;


        if v_existing_participant.id is not null then

            v_participant_uuid :=
                v_existing_participant.id;

            v_participant_public_id :=
                v_existing_participant.participant_id;

        else

            -- -------------------------------------------------
            -- Create participant with collision-safe retry loop
            -- (Bounded to 3 attempts)
            -- -------------------------------------------------

            v_attempt := 0;
            loop
                v_attempt := v_attempt + 1;

                v_participant_public_id :=
                    'SVK26-' ||
                    upper(
                        substring(
                            replace(
                                gen_random_uuid()::text,
                                '-',
                                ''
                            ),
                            1,
                            8
                        )
                    );

                begin
                    insert into public.participants (
                        participant_id,
                        name,
                        college,
                        email,
                        phone
                    )
                    values (
                        v_participant_public_id,
                        trim(p_name),
                        trim(p_college),
                        lower(trim(p_email)),
                        trim(p_phone)
                    )
                    returning id
                    into v_participant_uuid;

                    exit; -- Successful insert

                exception
                    when unique_violation then
                        -- Check if conflict was on email due to a concurrent race
                        select
                            p.id,
                            p.participant_id
                        into v_existing_participant
                        from public.participants p
                        where lower(trim(p.email))
                              = lower(trim(p_email))
                        limit 1;

                        if v_existing_participant.id is not null then
                            v_participant_uuid := v_existing_participant.id;
                            v_participant_public_id := v_existing_participant.participant_id;
                            exit;
                        end if;

                        -- If conflict was on participant_id collision, retry up to 3 times
                        if v_attempt >= 3 then
                            raise exception 'Failed to generate unique Participant ID after 3 attempts' using errcode = 'SVK11';
                        end if;
                end;
            end loop;

        end if;

    end if;


    -- =====================================================
    -- 3. Loop over requested events
    -- =====================================================

    for v_event in
        select *
        from jsonb_array_elements(p_events)
    loop

        -- -------------------------------------------------
        -- Validate event exists
        -- -------------------------------------------------

        v_event_id :=
            (v_event->>'event_id')::uuid;

        select
            e.id,
            e.name,
            e.category,
            e.registration_type,
            e.min_team_size,
            e.max_team_size,
            e.payment_type,
            e.registration_fee,
            e.payment_unit,
            e.is_registration_open,
            e.is_active,
            e.max_registrations
        into v_event_row
        from public.events e
        where e.id = v_event_id
        limit 1;

        if v_event_row.id is null then
            raise exception 'Event was not found' using errcode = 'SVK03';
        end if;

        if not coalesce(v_event_row.is_active, true) then
            raise exception 'This event is currently unavailable' using errcode = 'SVK04';
        end if;

        if not coalesce(v_event_row.is_registration_open, true) then
            raise exception 'Registration for this event is closed' using errcode = 'SVK05';
        end if;

        -- -------------------------------------------------
        -- Capacity check with FOR UPDATE lock on events table
        -- -------------------------------------------------

        if v_event_row.max_registrations is not null then
            perform 1
            from public.events
            where id = v_event_id
            for update;

            select count(*)
            into v_current_reg_count
            from public.participant_events
            where event_id = v_event_id
              and is_archived = false;

            if v_current_reg_count >= v_event_row.max_registrations then
                raise exception 'Registration limit reached for %', v_event_row.name using errcode = 'SVK05';
            end if;
        end if;


        -- -------------------------------------------------
        -- Already registered? (Idempotent)
        -- -------------------------------------------------

        select exists (
            select 1
            from public.participant_events pe
            where pe.participant_id =
                  v_participant_uuid
              and pe.event_id =
                  v_event_id
        )
        into v_existing_event;

        if v_existing_event then

            select pe.id
            into v_participant_event_id
            from public.participant_events pe
            where pe.participant_id =
                  v_participant_uuid
              and pe.event_id =
                  v_event_id
            limit 1;

            return query
            select
                v_participant_public_id,
                v_participant_event_id,
                v_event_row.id,
                v_event_row.name,
                'already_registered'::text;

            continue;

        end if;


        -- =================================================
        -- 4. Event configuration
        -- =================================================

        v_team :=
            nullif(trim(v_event->>'team'), '');

        v_is_team_head :=
            coalesce((v_event->>'is_team_head')::boolean, false);

        v_members :=
            coalesce(v_event->'members', '[]'::jsonb);

        v_member_count :=
            jsonb_array_length(v_members);

        v_min_team_size :=
            coalesce(v_event_row.min_team_size, 1);

        v_max_team_size :=
            coalesce(
                v_event_row.max_team_size,
                case
                    when v_event_row.registration_type = 'team'
                    then 10
                    else 1
                end
            );

        v_registration_type :=
            coalesce(
                v_event_row.registration_type,
                'individual'
            );


        -- =================================================
        -- 5. Team validation
        -- =================================================

        if v_registration_type = 'team' then

            if v_team is null then
                raise exception 'Please enter your team name' using errcode = 'SVK06';
            end if;

            v_total_participants :=
                v_member_count + 1;

            if v_total_participants < v_min_team_size then
                raise exception '% requires at least % team members.',
                    v_event_row.name,
                    v_min_team_size using errcode = 'SVK07';
            end if;

            if v_total_participants > v_max_team_size then
                raise exception '% allows a maximum of % team members.',
                    v_event_row.name,
                    v_max_team_size using errcode = 'SVK08';
            end if;

        else

            v_total_participants := 1;

        end if;


        -- =================================================
        -- 6. Payment calculation
        -- =================================================

        v_payment_amount := 0;

        if v_event_row.payment_type = 'paid' then

            if coalesce(v_event_row.payment_unit, 'per_student') = 'per_team' then
                v_payment_amount :=
                    coalesce(v_event_row.registration_fee, 0);
            else
                v_payment_amount :=
                    coalesce(v_event_row.registration_fee, 0)
                    * v_total_participants;
            end if;

        end if;


        -- =================================================
        -- 7. Group ID resolution
        -- =================================================

        if v_registration_type = 'team' then
            v_group_key := 'TEAM:' || lower(trim(v_team));
        else
            v_group_key := 'SOLO:' || v_participant_uuid::text;
        end if;

        if v_group_ids ? v_group_key then
            v_current_group_id := (v_group_ids->>v_group_key)::uuid;
        else
            v_current_group_id := gen_random_uuid();
            v_group_ids := jsonb_set(
                v_group_ids,
                array[v_group_key],
                to_jsonb(v_current_group_id::text)
            );
        end if;


        -- =================================================
        -- 8. Create participant_event
        -- =================================================

        insert into public.participant_events (
            participant_id,
            event_id,
            registration_status,
            payment_status,
            payment_amount,
            team_name,
            checked_in,
            registration_group_id
        )
        values (
            v_participant_uuid,
            v_event_id,
            'confirmed',
            case
                when v_payment_amount > 0
                then 'pending'
                else 'not_required'
            end,
            v_payment_amount,
            v_team,
            false,
            v_current_group_id
        )
        returning id
        into v_participant_event_id;

        -- Accumulate for atomic payment order creation
        if v_payment_amount > 0 then
            v_new_pe_ids := array_append(v_new_pe_ids, v_participant_event_id);
            v_new_event_ids := array_append(v_new_event_ids, v_event_id);
            v_new_amounts := array_append(v_new_amounts, v_payment_amount);
            v_total_paid_amount := v_total_paid_amount + v_payment_amount;
        end if;


        -- =================================================
        -- 9. Team members handling
        -- =================================================

        if v_registration_type = 'team' then

            -- Insert team leader
            insert into public.participant_event_members (
                participant_event_id,
                participant_id,
                name,
                email,
                phone,
                is_team_leader
            )
            values (
                v_participant_event_id,
                v_participant_uuid,
                coalesce(v_existing_participant.name, trim(p_name)),
                lower(trim(coalesce(v_existing_participant.email, p_email))),
                coalesce(v_existing_participant.phone, trim(p_phone)),
                true
            );

            -- Loop over team members
            for v_member in
                select *
                from jsonb_array_elements(v_members)
            loop

                v_member_email :=
                    lower(trim(v_member->>'email'));

                if v_member_email is null or v_member_email = '' then
                    raise exception 'Team member email is required' using errcode = 'SVK09';
                end if;

                if v_member_email = lower(trim(coalesce(v_existing_participant.email, p_email))) then
                    raise exception 'Team leader cannot be added as a team member' using errcode = 'SVK10';
                end if;

                select
                    p.id,
                    p.participant_id
                into v_member_participant
                from public.participants p
                where lower(trim(p.email)) = v_member_email
                limit 1;

                if v_member_participant.id is not null then
                    v_member_uuid := v_member_participant.id;
                    v_member_public_id := v_member_participant.participant_id;
                else
                    v_member_name := trim(v_member->>'name');
                    v_member_college := trim(coalesce(v_member->>'college', v_existing_participant.college, p_college));

                    v_attempt := 0;
                    loop
                        v_attempt := v_attempt + 1;
                        v_member_public_id :=
                            'SVK26-' ||
                            upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

                        begin
                            insert into public.participants (
                                participant_id,
                                name,
                                college,
                                email,
                                phone
                            )
                            values (
                                v_member_public_id,
                                v_member_name,
                                v_member_college,
                                v_member_email,
                                trim(v_member->>'phone')
                            )
                            returning id into v_member_uuid;

                            exit;

                        exception
                            when unique_violation then
                                select p.id, p.participant_id
                                into v_member_participant
                                from public.participants p
                                where lower(trim(p.email)) = v_member_email
                                limit 1;

                                if v_member_participant.id is not null then
                                    v_member_uuid := v_member_participant.id;
                                    v_member_public_id := v_member_participant.participant_id;
                                    exit;
                                end if;

                                if v_attempt >= 3 then
                                    raise exception 'Failed to generate unique Participant ID after 3 attempts' using errcode = 'SVK11';
                                end if;
                        end;
                    end loop;
                end if;

                insert into public.participant_event_members (
                    participant_event_id,
                    participant_id,
                    name,
                    email,
                    phone,
                    is_team_leader
                )
                values (
                    v_participant_event_id,
                    v_member_uuid,
                    trim(v_member->>'name'),
                    v_member_email,
                    trim(v_member->>'phone'),
                    false
                );

            end loop;

        end if;


        -- =================================================
        -- 10. RETURN NEW REGISTRATION
        -- =================================================

        return query
        select
            v_participant_public_id,
            v_participant_event_id,
            v_event_row.id,
            v_event_row.name,
            'added'::text;

    end loop;


    -- =====================================================
    -- 11. ATOMIC ACCOMMODATION SELECTIONS
    -- =====================================================

    if p_accommodations is not null
       and jsonb_typeof(p_accommodations) = 'array'
       and jsonb_array_length(p_accommodations) > 0
    then

        for v_accommodation in
            select *
            from jsonb_array_elements(p_accommodations)
        loop

            v_acc_email := lower(trim(v_accommodation->>'email'));
            v_acc_slug := trim(v_accommodation->>'plan_slug');

            if v_acc_email is null or v_acc_email = '' then
                raise exception 'Accommodation delegate email is required' using errcode = 'SVK11';
            end if;

            if v_acc_slug is null or v_acc_slug = '' then
                raise exception 'Accommodation plan is required' using errcode = 'SVK11';
            end if;

            -- Resolve participant by email (matching either team leader or any team member created above)
            select p.id into v_acc_participant_uuid
            from public.participants p
            where lower(trim(p.email)) = v_acc_email
            order by p.created_at desc
            limit 1;

            if v_acc_participant_uuid is null then
                raise exception 'Participant with email % not found for accommodation' , v_acc_email using errcode = 'SVK01';
            end if;

            -- Verify active accommodation plan from accommodation_plans
            select ap.id, ap.name, ap.duration, ap.price, ap.currency
            into v_acc_plan
            from public.accommodation_plans ap
            where ap.slug = v_acc_slug
              and ap.is_active = true
            limit 1;

            if v_acc_plan.id is null then
                raise exception 'Invalid or inactive accommodation plan: %', v_acc_slug using errcode = 'SVK11';
            end if;

            -- Verify single active booking constraint
            if exists (
                select 1
                from public.participant_accommodations pa
                where pa.participant_id = v_acc_participant_uuid
                  and pa.status not in ('cancelled', 'failed')
            ) then
                raise exception 'Participant already has an active accommodation booking' using errcode = 'SVK11';
            end if;

            -- Sourced from configurable festival_config instead of hardcoded constants
            select coalesce(fc.accommodation_start_date, '2026-10-28'::date)
            into v_acc_base_start_date
            from public.festival_config fc
            where fc.id = 'current'
            limit 1;

            if v_acc_base_start_date is null then
                v_acc_base_start_date := '2026-10-28'::date;
            end if;

            -- Determine snapshotted dates from configuration and plan duration
            v_acc_start_date := v_acc_base_start_date;
            v_acc_end_date := (v_acc_base_start_date + v_acc_plan.duration);

            -- Create participant_accommodations row
            insert into public.participant_accommodations (
                participant_id,
                accommodation_plan_id,
                start_date,
                end_date,
                duration_days,
                amount,
                currency,
                status
            )
            values (
                v_acc_participant_uuid,
                v_acc_plan.id,
                v_acc_start_date,
                v_acc_end_date,
                v_acc_plan.duration,
                v_acc_plan.price,
                coalesce(v_acc_plan.currency, 'INR'),
                'pending'
            )
            returning id into v_pa_id;

            v_new_pa_ids := array_append(v_new_pa_ids, v_pa_id);
            v_new_pa_amounts := array_append(v_new_pa_amounts, v_acc_plan.price);
            v_total_paid_amount := v_total_paid_amount + v_acc_plan.price;

        end loop;

    end if;


    -- =====================================================
    -- 12. ATOMIC PAYMENT ORDER CREATION (EVENTS + ACCOMMODATION)
    -- =====================================================

    if v_total_paid_amount > 0 and (cardinality(v_new_pe_ids) > 0 or cardinality(v_new_pa_ids) > 0) then

        v_order_reference :=
            'SVK-' ||
            v_participant_public_id || '-' ||
            to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
            upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));

        insert into public.payment_orders (
            order_reference,
            payer_participant_id,
            amount,
            currency,
            status
        )
        values (
            v_order_reference,
            v_participant_uuid,
            v_total_paid_amount,
            'INR',
            'pending'
        )
        returning id into v_payment_order_id;

        -- Insert Event line items (item_type = 'event')
        if cardinality(v_new_pe_ids) > 0 then
            for v_idx in 1..cardinality(v_new_pe_ids) loop
                insert into public.payment_order_items (
                    payment_order_id,
                    participant_id,
                    participant_event_id,
                    event_id,
                    item_type,
                    participant_accommodation_id,
                    amount
                )
                values (
                    v_payment_order_id,
                    v_participant_uuid,
                    v_new_pe_ids[v_idx],
                    v_new_event_ids[v_idx],
                    'event',
                    null,
                    v_new_amounts[v_idx]
                );
            end loop;
        end if;

        -- Insert Accommodation line items (item_type = 'accommodation')
        if cardinality(v_new_pa_ids) > 0 then
            for v_idx in 1..cardinality(v_new_pa_ids) loop
                insert into public.payment_order_items (
                    payment_order_id,
                    participant_id,
                    participant_event_id,
                    event_id,
                    item_type,
                    participant_accommodation_id,
                    amount
                )
                values (
                    v_payment_order_id,
                    v_participant_uuid,
                    null,
                    null,
                    'accommodation',
                    v_new_pa_ids[v_idx],
                    v_new_pa_amounts[v_idx]
                );

                -- Link participant_accommodations to the payment order
                update public.participant_accommodations
                set payment_order_id = v_payment_order_id,
                    updated_at = now()
                where id = v_new_pa_ids[v_idx];
            end loop;
        end if;

    end if;

    return;

end;
$$;

-- Secure function permissions
ALTER FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb", "p_accommodations" "jsonb") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb", "p_accommodations" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb", "p_accommodations" "jsonb") FROM anon;
REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb", "p_accommodations" "jsonb") FROM authenticated;
GRANT ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb", "p_accommodations" "jsonb") TO "service_role";
