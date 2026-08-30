-- ============================================================
-- SAVISKAR 2026 — PHASE 2B: DATA INTEGRITY & API SAFETY
-- ============================================================
--
-- 1. Unique Participant Email:
--    Add unique index on lower(trim(email)) to prevent duplicate
--    participant identities across concurrent registrations.
--
-- 2. Participant ID Collision Retry & Structured Error Codes:
--    Update register_participant_events with:
--    - 3-attempt bounded retry on Participant ID collision.
--    - Structured error codes (SVK01 - SVK11).
--    - Preserved FOR UPDATE capacity locking and atomic payment orders.
--
-- 3. Master Admin Permanent Deletion Safety:
--    Update delete_registration_permanently to NEVER delete
--    payment_orders or financial records with status = 'paid'.
-- ============================================================

-- 1. Unique index on lower(trim(email))
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_lower_email
    ON public.participants (lower(trim(email)));


-- 2. Update register_participant_events function
CREATE OR REPLACE FUNCTION "public"."register_participant_events"(
    "p_participant_id" "text" DEFAULT NULL::"text",
    "p_name" "text" DEFAULT NULL::"text",
    "p_college" "text" DEFAULT NULL::"text",
    "p_email" "text" DEFAULT NULL::"text",
    "p_phone" "text" DEFAULT NULL::"text",
    "p_events" "jsonb" DEFAULT '[]'::"jsonb"
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
    -- 3. Process every selected event
    -- =====================================================

    for v_event in
        select value
        from jsonb_array_elements(p_events)
    loop

        -- -------------------------------------------------
        -- Validate event UUID
        -- -------------------------------------------------

        begin
            v_event_id :=
                (v_event->>'event_id')::uuid;
        exception
            when others then
                raise exception 'Invalid event ID' using errcode = 'SVK11';
        end;


        -- -------------------------------------------------
        -- Get event with row-level lock (FOR UPDATE)
        -- to prevent concurrent oversubscription races
        -- -------------------------------------------------

        select
            e.id,
            e.name,
            e.active,
            e.registration_open,
            e.registration_type,
            e.min_team_size,
            e.max_team_size,
            e.payment_type,
            e.registration_fee,
            e.payment_unit,
            e.registration_limit
        into v_event_row
        from public.events e
        where e.id = v_event_id
        for update;


        if v_event_row.id is null then
            raise exception 'Selected event was not found' using errcode = 'SVK03';
        end if;


        -- -------------------------------------------------
        -- Active check
        -- -------------------------------------------------

        if not coalesce(v_event_row.active, false) then
            raise exception
                'Event "%" is currently unavailable',
                v_event_row.name
                using errcode = 'SVK03';
        end if;


        -- -------------------------------------------------
        -- Registration open check
        -- -------------------------------------------------

        if not coalesce(
            v_event_row.registration_open,
            false
        ) then
            raise exception
                'Registration for "%" is currently closed',
                v_event_row.name
                using errcode = 'SVK04';
        end if;


        -- -------------------------------------------------
        -- Check duplicate participant/event
        -- -------------------------------------------------

        select exists (
            select 1
            from public.participant_events pe
            where pe.participant_id =
                  v_participant_uuid
              and pe.event_id =
                  v_event_row.id
        )
        into v_existing_event;


        if v_existing_event then

            return query
            select
                v_participant_public_id,
                pe.id,
                pe.event_id,
                v_event_row.name,
                'already_registered'::text

            from public.participant_events pe

            where pe.participant_id =
                  v_participant_uuid

              and pe.event_id =
                  v_event_row.id;

            continue;

        end if;


        -- -------------------------------------------------
        -- Registration Limit Enforcement (Race-Safe)
        -- Count only active (non-archived) registrations.
        -- -------------------------------------------------

        if v_event_row.registration_limit is not null and v_event_row.registration_limit > 0 then

            select count(*)
            into v_current_reg_count
            from public.participant_events pe
            where pe.event_id = v_event_row.id
              and coalesce(pe.is_archived, false) = false;

            if v_current_reg_count >= v_event_row.registration_limit then
                raise exception
                    'Registration limit reached for event "%"',
                    v_event_row.name
                    using errcode = 'SVK05';
            end if;

        end if;


        -- =================================================
        -- 4. EVENT-SPECIFIC TEAM DATA
        -- =================================================

        v_registration_type :=
            lower(
                trim(
                    coalesce(
                        v_event_row.registration_type,
                        ''
                    )
                )
            );

        v_team :=
            nullif(
                trim(
                    coalesce(
                        v_event->>'team',
                        ''
                    )
                ),
                ''
            );

        v_is_team_head :=
            coalesce(
                (v_event->>'is_team_head')::boolean,
                false
            );

        v_members :=
            case
                when jsonb_typeof(
                    v_event->'members'
                ) = 'array'
                then v_event->'members'
                else '[]'::jsonb
            end;


        -- =================================================
        -- 5. INDIVIDUAL EVENT
        -- =================================================

        if v_registration_type <> 'team' then

            if jsonb_array_length(v_members) > 0 then
                raise exception
                    'Team members cannot be added to individual event "%"',
                    v_event_row.name
                    using errcode = 'SVK11';
            end if;

            v_team := null;
            v_total_participants := 1;


        -- =================================================
        -- 6. TEAM EVENT
        -- =================================================

        else

            if v_team is null then
                raise exception
                    'Please enter your team name for "%"',
                    v_event_row.name
                    using errcode = 'SVK06';
            end if;


            v_member_count :=
                jsonb_array_length(v_members);

            -- Team leader counts as member 1.
            v_total_participants :=
                v_member_count + 1;

            v_min_team_size :=
                greatest(
                    1,
                    coalesce(
                        v_event_row.min_team_size,
                        1
                    )
                );

            v_max_team_size :=
                greatest(
                    v_min_team_size,
                    coalesce(
                        v_event_row.max_team_size,
                        v_min_team_size
                    )
                );


            -- Minimum
            if v_total_participants < v_min_team_size then
                raise exception
                    'Event "%" requires at least % team members including the team leader',
                    v_event_row.name,
                    v_min_team_size
                    using errcode = 'SVK07';
            end if;

            -- Maximum
            if v_total_participants > v_max_team_size then
                raise exception
                    'Event "%" allows a maximum of % team members including the team leader',
                    v_event_row.name,
                    v_max_team_size
                    using errcode = 'SVK08';
            end if;


            -- Validate every team member
            for v_member in
                select value
                from jsonb_array_elements(v_members)
            loop

                if nullif(trim(coalesce(v_member->>'name', '')), '') is null then
                    raise exception
                        'Every team member must have a name for "%"',
                        v_event_row.name
                        using errcode = 'SVK09';
                end if;

                if nullif(trim(coalesce(v_member->>'college', '')), '') is null then
                    raise exception
                        'Every team member must have a college for "%"',
                        v_event_row.name
                        using errcode = 'SVK09';
                end if;

                if nullif(trim(coalesce(v_member->>'email', '')), '') is null then
                    raise exception
                        'Every team member must have an email for "%"',
                        v_event_row.name
                        using errcode = 'SVK09';
                end if;

                if nullif(trim(coalesce(v_member->>'phone', '')), '') is null then
                    raise exception
                        'Every team member must have a phone number for "%"',
                        v_event_row.name
                        using errcode = 'SVK09';
                end if;

                -- Check member email against leader
                if lower(trim(coalesce(v_member->>'email', ''))) =
                   lower(trim(coalesce(p_email, v_existing_participant.email, '')))
                then
                    raise exception
                        'Each team member must use a different email address'
                        using errcode = 'SVK10';
                end if;

            end loop;


            -- Check duplicate emails between team members
            if exists (
                select 1
                from (
                    select
                        lower(trim(value->>'email')) as email
                    from jsonb_array_elements(v_members)
                ) emails
                group by email
                having count(*) > 1
            )
            then
                raise exception
                    'Each team member must use a different email address'
                    using errcode = 'SVK10';
            end if;

        end if;


        -- =================================================
        -- 7. PAYMENT AMOUNT
        -- =================================================

        if coalesce(v_event_row.payment_type, 'free') <> 'paid' then
            v_payment_amount := 0;
        elsif coalesce(v_event_row.payment_unit, 'per_student') = 'per_team' then
            v_payment_amount := coalesce(v_event_row.registration_fee, 0);
        else
            v_payment_amount := coalesce(v_event_row.registration_fee, 0) * v_total_participants;
        end if;


        -- =================================================
        -- 8. CREATE PARTICIPANT EVENT
        -- =================================================

        insert into public.participant_events (
            participant_id,
            event_id,
            registration_status,
            payment_status,
            payment_amount,
            payment_id,
            team_name,
            checked_in,
            checked_in_at
        )
        values (
            v_participant_uuid,
            v_event_row.id,
            'pending',
            case
                when v_payment_amount > 0
                then 'pending'
                else 'not_required'
            end,
            v_payment_amount,
            null,
            v_team,
            false,
            null
        )
        ON CONFLICT ON CONSTRAINT participant_events_unique_event
        do nothing
        returning id
        into v_participant_event_id;


        if v_participant_event_id is null then
            select pe.id
            into v_participant_event_id
            from public.participant_events pe
            where pe.participant_id = v_participant_uuid
              and pe.event_id = v_event_row.id
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


        -- Track for atomic payment order creation
        if v_payment_amount > 0 then
            v_new_pe_ids := array_append(v_new_pe_ids, v_participant_event_id);
            v_new_event_ids := array_append(v_new_event_ids, v_event_row.id);
            v_new_amounts := array_append(v_new_amounts, v_payment_amount);
            v_total_paid_amount := v_total_paid_amount + v_payment_amount;
        end if;


        -- =================================================
        -- 9. CREATE TEAM MEMBERS
        -- =================================================

        if v_registration_type = 'team' then

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
                coalesce(nullif(trim(p_name), ''), v_existing_participant.name),
                lower(coalesce(nullif(trim(p_email), ''), v_existing_participant.email)),
                coalesce(nullif(trim(p_phone), ''), v_existing_participant.phone),
                v_is_team_head
            );


            for v_member in
                select value
                from jsonb_array_elements(v_members)
            loop

                v_member_email := lower(trim(v_member->>'email'));
                v_member_college := trim(v_member->>'college');

                select
                    p.id,
                    p.participant_id,
                    p.name,
                    p.college,
                    p.email,
                    p.phone
                into v_member_participant
                from public.participants p
                where lower(trim(p.email)) = v_member_email
                limit 1;


                if v_member_participant.id is not null then
                    v_member_uuid := v_member_participant.id;
                    v_member_public_id := v_member_participant.participant_id;
                else
                    -- Bounded retry loop for member participant ID
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
                                trim(v_member->>'name'),
                                v_member_college,
                                v_member_email,
                                trim(v_member->>'phone')
                            )
                            returning id
                            into v_member_uuid;

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
    -- 11. ATOMIC PAYMENT ORDER CREATION
    -- =====================================================

    if v_total_paid_amount > 0 and cardinality(v_new_pe_ids) > 0 then

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

        for v_idx in 1..cardinality(v_new_pe_ids) loop
            insert into public.payment_order_items (
                payment_order_id,
                participant_id,
                participant_event_id,
                event_id,
                amount
            )
            values (
                v_payment_order_id,
                v_participant_uuid,
                v_new_pe_ids[v_idx],
                v_new_event_ids[v_idx],
                v_new_amounts[v_idx]
            );
        end loop;

    end if;

    return;

end;
$$;

-- Secure function permissions
ALTER FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") FROM anon;
REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") FROM authenticated;
GRANT ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") TO "service_role";


-- 3. Update delete_registration_permanently with paid record safety
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

    -- 4. Gather associated payment orders before cleaning up items
    SELECT array_agg(DISTINCT payment_order_id) INTO v_payment_order_ids
    FROM payment_order_items 
    WHERE participant_event_id = p_participant_event_id AND payment_order_id IS NOT NULL;

    -- 5. Delete team members for this registration
    DELETE FROM participant_event_members WHERE participant_event_id = p_participant_event_id;

    -- 6. For UNPAID / TEST payment records (status <> 'paid'):
    -- Clean up payment order items and delete empty uncompleted orders.
    DELETE FROM payment_order_items poi
    WHERE poi.participant_event_id = p_participant_event_id
      AND poi.payment_order_id IN (
          SELECT po.id FROM payment_orders po WHERE po.status <> 'paid'
      );

    IF v_payment_order_ids IS NOT NULL THEN
        FOREACH v_payment_order_id IN ARRAY v_payment_order_ids LOOP
            -- NEVER delete payment_orders with status = 'paid'
            DELETE FROM payment_orders
            WHERE id = v_payment_order_id
              AND status <> 'paid'
              AND NOT EXISTS (
                  SELECT 1 FROM payment_order_items WHERE payment_order_id = v_payment_order_id
              );
        END LOOP;
    END IF;

    -- 7. Delete the participant event
    -- For PAID orders, the FK payment_order_items_participant_event_id_fkey
    -- (ON DELETE SET NULL) automatically decouples participant_event_id to NULL,
    -- preserving the immutable paid line item and payment order financial record.
    DELETE FROM participant_events WHERE id = p_participant_event_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Secure delete function permissions
REVOKE ALL ON FUNCTION delete_registration_permanently(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION delete_registration_permanently(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION delete_registration_permanently(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION delete_registration_permanently(uuid, uuid) TO service_role;
