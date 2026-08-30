-- ============================================================
-- SAVISKAR 2026 — PHASE 2A: P1 CORRECTNESS & RELIABILITY
-- ============================================================
--
-- 1. Receipt Claim Recovery:
--    Add receipt_email_claimed_at timestamp to payment_orders
--    for stale-claim detection (>10 min recovery).
--
-- 2. Registration Limit Enforcement:
--    Update register_participant_events to row-lock event records
--    with FOR UPDATE and enforce registration_limit against active
--    (is_archived = false) registrations.
--
-- 3. Registration + Payment Order Transactional Consistency:
--    Atomically create payment_orders and payment_order_items inside
--    the same register_participant_events PL/pgSQL transaction
--    when newly added events require payment.
-- ============================================================

-- 1. Add receipt_email_claimed_at column to payment_orders
ALTER TABLE public.payment_orders
    ADD COLUMN IF NOT EXISTS receipt_email_claimed_at timestamp with time zone;

-- Index for efficient claim checking
CREATE INDEX IF NOT EXISTS payment_orders_receipt_claim_idx
    ON public.payment_orders(receipt_email_claim_id, receipt_email_claimed_at)
    WHERE receipt_email_sent_at IS NULL;


-- 2. Update register_participant_events function with:
--    - FOR UPDATE event lock
--    - registration_limit capacity enforcement
--    - atomic payment_orders and payment_order_items creation
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
        raise exception 'At least one event must be selected';
    end if;


    -- =====================================================
    -- 2. Find existing participant
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
            raise exception 'Participant ID was not found';
        end if;

        if lower(trim(v_existing_participant.email)) <> lower(trim(p_email)) then
            raise exception 'The provided email does not match this Participant ID';
        end if;

        v_participant_uuid := v_existing_participant.id;
        v_participant_public_id :=
            v_existing_participant.participant_id;

    else

        if nullif(trim(p_name), '') is null then
            raise exception 'Name is required';
        end if;

        if nullif(trim(p_college), '') is null then
            raise exception 'College is required';
        end if;

        if nullif(trim(p_email), '') is null then
            raise exception 'Email is required';
        end if;

        if nullif(trim(p_phone), '') is null then
            raise exception 'Phone is required';
        end if;


        -- -------------------------------------------------
        -- Existing participant with same email?
        --
        -- If yes, reuse that participant instead of creating
        -- a second participant identity.
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
            -- Generate permanent participant ID
            -- -------------------------------------------------

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


            -- -------------------------------------------------
            -- Create participant
            -- -------------------------------------------------

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
                raise exception 'Invalid event ID';
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
            raise exception 'Selected event was not found';
        end if;


        -- -------------------------------------------------
        -- Active check
        -- -------------------------------------------------

        if not coalesce(v_event_row.active, false) then
            raise exception
                'Event "%" is currently unavailable',
                v_event_row.name;
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
                v_event_row.name;
        end if;


        -- -------------------------------------------------
        -- Check duplicate participant/event
        --
        -- Existing records are NOT changed.
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
        --
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
                    v_event_row.name;
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
                    v_event_row.name;
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
                    v_event_row.name;
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


            -- -------------------------------------------------
            -- Minimum
            -- -------------------------------------------------

            if v_total_participants <
               v_min_team_size
            then
                raise exception
                    'Event "%" requires at least % team members including the team leader',
                    v_event_row.name,
                    v_min_team_size;
            end if;


            -- -------------------------------------------------
            -- Maximum
            -- -------------------------------------------------

            if v_total_participants >
               v_max_team_size
            then
                raise exception
                    'Event "%" allows a maximum of % team members including the team leader',
                    v_event_row.name,
                    v_max_team_size;
            end if;


            -- -------------------------------------------------
            -- Validate every team member
            -- -------------------------------------------------

            for v_member in
                select value
                from jsonb_array_elements(v_members)
            loop

                if nullif(
                    trim(
                        coalesce(
                            v_member->>'name',
                            ''
                        )
                    ),
                    ''
                ) is null
                then
                    raise exception
                        'Every team member must have a name for "%"',
                        v_event_row.name;
                end if;


                if nullif(
                    trim(
                        coalesce(
                            v_member->>'college',
                            ''
                        )
                    ),
                    ''
                ) is null
                then
                    raise exception
                        'Every team member must have a college for "%"',
                        v_event_row.name;
                end if;


                if nullif(
                    trim(
                        coalesce(
                            v_member->>'email',
                            ''
                        )
                    ),
                    ''
                ) is null
                then
                    raise exception
                        'Every team member must have an email for "%"',
                        v_event_row.name;
                end if;


                if nullif(
                    trim(
                        coalesce(
                            v_member->>'phone',
                            ''
                        )
                    ),
                    ''
                ) is null
                then
                    raise exception
                        'Every team member must have a phone number for "%"',
                        v_event_row.name;
                end if;


                -- -------------------------------------------------
                -- Check member email against leader
                -- -------------------------------------------------

                if lower(
                    trim(
                        coalesce(
                            v_member->>'email',
                            ''
                        )
                    )
                ) =
                   lower(
                       trim(
                           coalesce(
                               p_email,
                               v_existing_participant.email,
                               ''
                           )
                       )
                   )
                then
                    raise exception
                        'Each team member must use a different email address';
                end if;

            end loop;


            -- -------------------------------------------------
            -- Check duplicate emails between team members
            -- -------------------------------------------------

            if exists (
                select 1
                from (
                    select
                        lower(
                            trim(
                                value->>'email'
                            )
                        ) as email
                    from jsonb_array_elements(v_members)
                ) emails
                group by email
                having count(*) > 1
            )
            then
                raise exception
                    'Each team member must use a different email address';
            end if;

        end if;


        -- =================================================
        -- 7. PAYMENT AMOUNT
        --
        -- per_team:
        --     fee once
        --
        -- per_student:
        --     fee × number of participants
        --
        -- free:
        --     0
        -- =================================================

        if coalesce(
            v_event_row.payment_type,
            'free'
        ) <> 'paid'
        then

            v_payment_amount := 0;

        elsif coalesce(
            v_event_row.payment_unit,
            'per_student'
        ) = 'per_team'
        then

            v_payment_amount :=
                coalesce(
                    v_event_row.registration_fee,
                    0
                );

        else

            v_payment_amount :=
                coalesce(
                    v_event_row.registration_fee,
                    0
                )
                * v_total_participants;

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


        -- -------------------------------------------------
        -- Race-condition protection
        --
        -- If another request inserted the same event between
        -- our duplicate check and insert, return existing row.
        -- -------------------------------------------------

        if v_participant_event_id is null then

            select pe.id
            into v_participant_event_id
            from public.participant_events pe
            where pe.participant_id =
                  v_participant_uuid
              and pe.event_id =
                  v_event_row.id
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

        if v_registration_type = 'team'
        then

            -- The person submitting the registration is also a real
            -- team member and keeps their permanent participant ID.

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
                coalesce(
                    nullif(trim(p_name), ''),
                    v_existing_participant.name
                ),
                lower(
                    coalesce(
                        nullif(trim(p_email), ''),
                        v_existing_participant.email
                    )
                ),
                coalesce(
                    nullif(trim(p_phone), ''),
                    v_existing_participant.phone
                ),
                v_is_team_head
            );


            -- Every additional member gets a permanent participant
            -- identity. Existing identities are reused by email.

            for v_member in
                select value
                from jsonb_array_elements(v_members)
            loop

                v_member_email :=
                    lower(
                        trim(
                            v_member->>'email'
                        )
                    );

                v_member_college :=
                    trim(
                        v_member->>'college'
                    );


                select
                    p.id,
                    p.participant_id,
                    p.name,
                    p.college,
                    p.email,
                    p.phone
                into v_member_participant
                from public.participants p
                where lower(trim(p.email))
                      = v_member_email
                limit 1;


                if v_member_participant.id is not null then

                    v_member_uuid :=
                        v_member_participant.id;

                    v_member_public_id :=
                        v_member_participant.participant_id;

                else

                    v_member_public_id :=
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
    --
    -- If any newly added events require payment, create
    -- payment_orders and payment_order_items inside this
    -- exact same database transaction.
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

-- Maintain permissions
ALTER FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") FROM anon;
REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") FROM authenticated;
GRANT ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") TO "service_role";
