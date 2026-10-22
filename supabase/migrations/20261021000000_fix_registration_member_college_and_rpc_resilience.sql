-- ============================================================
-- SAVISKAR 2026 — REGISTRATION RPC RESILIENCE & MEMBER COLLEGE FIX
-- Migration: 20261021000000_fix_registration_member_college_and_rpc_resilience.sql
-- Status: DRAFT / LOCAL ONLY — DO NOT APPLY TO PRODUCTION WITHOUT EXPLICIT APPROVAL
-- ============================================================
-- 1. Updates register_participant_events RPC:
--    - Fixes team member college fallback:
--        coalesce(nullif(trim(v_member->>'college'), ''), v_existing_participant.college, nullif(trim(p_college), ''))
--      Prevents Postgres 23502 NOT NULL violation when new participants register teams.
--    - Fixes faculty college fallback:
--        coalesce(nullif(trim(p_faculty->>'college'), ''), v_existing_participant.college, nullif(trim(p_college), ''))
--    - Fixes key naming parity for team members and event headers:
--        * Accepts both camelCase (idCardStoragePath) and snake_case (id_card_storage_path)
--        * Accepts both camelCase (isTeamHead) and snake_case (is_team_head)
--    - Corrects error code for team member validation from SVK11 (accommodation) to SVK06.
--    - Hardens duplicate event detection to inspect participant_events unconditionally,
--      preventing 23505 unique constraint violations on cancelled/retried rows.
--    - Preserves all atomic in-RPC accommodation expiration logic, advisory locks,
--      and checkout invariants.
-- ============================================================

CREATE OR REPLACE FUNCTION "public"."register_participant_events"(
    "p_participant_id" "text" DEFAULT NULL::"text",
    "p_name" "text" DEFAULT NULL::"text",
    "p_college" "text" DEFAULT NULL::"text",
    "p_email" "text" DEFAULT NULL::"text",
    "p_phone" "text" DEFAULT NULL::"text",
    "p_events" "jsonb" DEFAULT '[]'::"jsonb",
    "p_accommodations" "jsonb" DEFAULT '[]'::"jsonb",
    "p_faculty" "jsonb" DEFAULT NULL::"jsonb",
    "p_gender" "text" DEFAULT NULL::"text",
    "p_state" "text" DEFAULT NULL::"text",
    "p_id_card_storage_path" "text" DEFAULT NULL::"text"
) RETURNS TABLE(
    "participant_id" "text",
    "participant_event_id" "uuid",
    "event_id" "uuid",
    "event_name" "text",
    "status" "text",
    "payment_order_id" "uuid"
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
    v_member_id_card_path text;
    v_is_team_head boolean;

    v_current_reg_count integer;
    v_attempt integer;

    -- For atomic payment order creation
    v_new_pe_ids uuid[] := array[]::uuid[];
    v_new_event_ids uuid[] := array[]::uuid[];
    v_new_amounts integer[] := array[]::integer[];
    v_total_paid_amount integer := 0;
    v_order_reference text;
    v_payment_order_id uuid := null;
    v_idx integer;

    -- Accommodation variables
    v_accommodation jsonb;
    v_acc_email text;
    v_acc_slug text;
    v_acc_participant_uuid uuid;
    v_acc_plan record;
    v_acc_base_start_date date;
    v_acc_start_date date;
    v_acc_end_date date;
    v_overlapping_paid_count integer;
    v_is_fully_covered boolean;
    v_pa_id uuid;
    v_new_pa_ids uuid[] := array[]::uuid[];
    v_new_pa_amounts integer[] := array[]::integer[];
    v_lock_pid uuid;

    -- In-RPC Expiration Evaluation Variables
    v_existing_pa record;
    v_po record;
    v_has_active_checkout boolean;
    v_stale_pa_ids uuid[];

    -- Faculty variables
    v_faculty_email text;
    v_faculty_participant record;
    v_faculty_uuid uuid;
    v_faculty_public_id text;
    v_faculty_name text;
    v_faculty_college text;

    -- Result accumulator
    v_results jsonb := '[]'::jsonb;
    v_res jsonb;

    -- Registration Grouping
    v_group_ids jsonb := '{}'::jsonb;
    v_group_key text;
    v_current_group_id uuid;
    v_primary_group_id uuid := null;

begin
    -- =====================================================
    -- 1. Parameter Validation
    -- =====================================================

    if p_participant_id is null and (
        p_name is null or trim(p_name) = '' or
        p_college is null or trim(p_college) = '' or
        p_email is null or trim(p_email) = '' or
        p_phone is null or trim(p_phone) = ''
    ) then
        raise exception 'All personal details are required for new participants' using errcode = 'SVK01';
    end if;

    if p_participant_id is not null and (p_email is null or trim(p_email) = '') then
        raise exception 'Email is required when supplying a Participant ID' using errcode = 'SVK02';
    end if;

    if (p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0) and
       (p_accommodations is null or jsonb_typeof(p_accommodations) <> 'array' or jsonb_array_length(p_accommodations) = 0) then
        raise exception 'Please select at least one event or accommodation' using errcode = 'SVK03';
    end if;

    -- =====================================================
    -- 2. Lock & Resolve Main Participant Profile
    -- =====================================================

    if p_participant_id is not null then
        select p.id, p.participant_id, p.name, p.college, p.email, p.phone
        into v_existing_participant
        from public.participants p
        where p.participant_id = trim(p_participant_id)
        limit 1
        for update;

        if v_existing_participant.id is null then
            raise exception 'Participant ID was not found' using errcode = 'SVK01';
        end if;

        if lower(trim(v_existing_participant.email)) <> lower(trim(p_email)) then
            raise exception 'The provided email does not match this Participant ID' using errcode = 'SVK02';
        end if;

        v_participant_uuid := v_existing_participant.id;
        v_participant_public_id := v_existing_participant.participant_id;

        update public.participants
        set id_card_storage_path = coalesce(nullif(trim(p_id_card_storage_path), ''), id_card_storage_path),
            id_card_uploaded_at = case when nullif(trim(p_id_card_storage_path), '') is not null then now() else id_card_uploaded_at end,
            gender = coalesce(nullif(trim(p_gender), ''), gender),
            state = coalesce(nullif(trim(p_state), ''), state)
        where id = v_participant_uuid;

    else
        perform pg_advisory_xact_lock(hashtext(lower(trim(p_email))));

        select
            p.id,
            p.participant_id,
            p.name,
            p.college,
            p.email,
            p.phone
        into v_existing_participant
        from public.participants p
        where lower(trim(p.email)) = lower(trim(p_email))
        limit 1;

        if v_existing_participant.id is not null then
            v_participant_uuid := v_existing_participant.id;
            v_participant_public_id := v_existing_participant.participant_id;

            update public.participants
            set id_card_storage_path = coalesce(nullif(trim(p_id_card_storage_path), ''), id_card_storage_path),
                id_card_uploaded_at = case when nullif(trim(p_id_card_storage_path), '') is not null then now() else id_card_uploaded_at end,
                gender = coalesce(nullif(trim(p_gender), ''), gender),
                state = coalesce(nullif(trim(p_state), ''), state)
            where id = v_participant_uuid;

        else
            v_participant_uuid := null;
            v_participant_public_id := null;

            v_attempt := 0;
            while v_attempt < 3 and v_participant_uuid is null loop
                v_attempt := v_attempt + 1;
                v_participant_public_id := 'SVK26-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

                begin
                    insert into public.participants (
                        participant_id,
                        name,
                        college,
                        email,
                        phone,
                        gender,
                        state,
                        id_card_storage_path,
                        id_card_uploaded_at
                    ) values (
                        v_participant_public_id,
                        trim(p_name),
                        trim(p_college),
                        lower(trim(p_email)),
                        trim(p_phone),
                        nullif(trim(p_gender), ''),
                        nullif(trim(p_state), ''),
                        nullif(trim(p_id_card_storage_path), ''),
                        case when nullif(trim(p_id_card_storage_path), '') is not null then now() else null end
                    )
                    returning participants.id, participants.participant_id
                    into v_participant_uuid, v_participant_public_id;
                exception
                    when unique_violation then
                        select p.id, p.participant_id, p.name, p.college, p.email, p.phone
                        into v_existing_participant
                        from public.participants p
                        where lower(trim(p.email)) = lower(trim(p_email))
                        limit 1;

                        if v_existing_participant.id is not null then
                            v_participant_uuid := v_existing_participant.id;
                            v_participant_public_id := v_existing_participant.participant_id;
                            exit;
                        end if;

                        if v_attempt >= 3 then
                            raise exception 'Failed to generate unique Participant ID after 3 attempts' using errcode = 'SVK11';
                        end if;
                end;
            end loop;

        end if;

    end if;

    -- =====================================================
    -- 3. Process events loop
    -- =====================================================

    for v_event in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop

        v_event_id := coalesce(nullif(v_event->>'eventId', '')::uuid, nullif(v_event->>'event_id', '')::uuid);

        if v_event_id is null then
            raise exception 'Event ID is required' using errcode = 'SVK03';
        end if;

        select *
        into v_event_row
        from public.events
        where id = v_event_id
        for update;

        if v_event_row.id is null then
            raise exception 'Event not found' using errcode = 'SVK04';
        end if;

        if not v_event_row.active then
            raise exception 'Event is not active: %', v_event_row.name using errcode = 'SVK05';
        end if;

        -- Capacity check
        if v_event_row.registration_limit is not null then
            select count(distinct pe.participant_id)
            into v_current_reg_count
            from public.participant_events pe
            where pe.event_id = v_event_id
              and pe.registration_status <> 'cancelled'
              and (pe.payment_status is null or pe.payment_status <> 'failed');

            if v_current_reg_count >= v_event_row.registration_limit then
                raise exception 'Event capacity reached: %', v_event_row.name using errcode = 'SVK07';
            end if;
        end if;

        v_team := nullif(trim(v_event->>'team'), '');
        v_members := coalesce(v_event->'members', '[]'::jsonb);
        v_member_count := jsonb_array_length(v_members);
        v_total_participants := 1 + v_member_count;

        v_registration_type := coalesce(v_event_row.registration_type, 'individual');
        v_min_team_size := coalesce(v_event_row.min_team_size, 1);
        v_max_team_size := coalesce(v_event_row.max_team_size, 1);

        if v_registration_type = 'team' then
            if v_team is null then
                raise exception 'Team name required for: %', v_event_row.name using errcode = 'SVK06';
            end if;

            if v_total_participants < v_min_team_size then
                raise exception 'Team too small for % (min: %)', v_event_row.name, v_min_team_size using errcode = 'SVK08';
            end if;

            if v_total_participants > v_max_team_size then
                raise exception 'Team too large for % (max: %)', v_event_row.name, v_max_team_size using errcode = 'SVK09';
            end if;
        else
            if v_member_count > 0 then
                raise exception 'Individual event cannot have team members: %', v_event_row.name using errcode = 'SVK10';
            end if;
            v_team := null;
        end if;

        -- Duplicate check across participant_events (unconditionally checks table)
        select exists(
            select 1
            from public.participant_events pe
            where pe.participant_id = v_participant_uuid
              and pe.event_id = v_event_id
        ) into v_existing_event;

        if v_existing_event then
            select pe.id
            into v_participant_event_id
            from public.participant_events pe
            where pe.participant_id = v_participant_uuid
              and pe.event_id = v_event_id
            limit 1;

            v_results := v_results || jsonb_build_object(
                'participant_public_id', v_participant_public_id,
                'participant_event_id', v_participant_event_id,
                'event_id', v_event_row.id,
                'event_name', v_event_row.name,
                'status', 'already_registered'
            );
            continue;
        end if;

        -- Registration Group
        v_group_key := coalesce(v_team, v_participant_uuid::text);
        if v_group_ids ? v_group_key then
            v_current_group_id := (v_group_ids->>v_group_key)::uuid;
        else
            v_current_group_id := gen_random_uuid();
            v_group_ids := jsonb_set(v_group_ids, array[v_group_key], to_jsonb(v_current_group_id::text));
            if v_primary_group_id is null then
                v_primary_group_id := v_current_group_id;
            end if;
        end if;

        -- Price Calculation
        if v_event_row.payment_type = 'paid' then
            if coalesce(v_event_row.payment_unit, 'per_student') = 'per_team' then
                v_payment_amount := coalesce(v_event_row.registration_fee, 0);
            else
                v_payment_amount := coalesce(v_event_row.registration_fee, 0) * v_total_participants;
            end if;
        else
            v_payment_amount := 0;
        end if;

        insert into public.participant_events (
            participant_id,
            event_id,
            team_name,
            registration_status,
            payment_status,
            payment_amount,
            checked_in,
            registration_group_id
        ) values (
            v_participant_uuid,
            v_event_id,
            v_team,
            'confirmed',
            case when v_payment_amount > 0 then 'pending' else 'confirmed' end,
            v_payment_amount,
            false,
            v_current_group_id
        )
        returning id into v_participant_event_id;

        if v_payment_amount > 0 then
            v_new_pe_ids := array_append(v_new_pe_ids, v_participant_event_id);
            v_new_event_ids := array_append(v_new_event_ids, v_event_id);
            v_new_amounts := array_append(v_new_amounts, v_payment_amount);
            v_total_paid_amount := v_total_paid_amount + v_payment_amount;
        end if;

        -- Lead member record
        v_is_team_head := coalesce((v_event->>'isTeamHead')::boolean, (v_event->>'is_team_head')::boolean, true);
        insert into public.participant_event_members (
            participant_event_id,
            participant_id,
            name,
            email,
            phone,
            is_team_leader
        ) values (
            v_participant_event_id,
            v_participant_uuid,
            coalesce(v_existing_participant.name, trim(p_name)),
            coalesce(v_existing_participant.email, lower(trim(p_email))),
            coalesce(v_existing_participant.phone, trim(p_phone)),
            v_is_team_head
        );

        -- Teammates
        if v_registration_type = 'team' and v_member_count > 0 then
            for v_member in select * from jsonb_array_elements(v_members) loop
                v_member_name := nullif(trim(v_member->>'name'), '');
                v_member_email := nullif(lower(trim(v_member->>'email')), '');
                -- Robust member college fallback: member college -> existing participant college -> registrant college
                v_member_college := coalesce(
                    nullif(trim(v_member->>'college'), ''),
                    v_existing_participant.college,
                    nullif(trim(p_college), '')
                );

                v_member_id_card_path := coalesce(
                    nullif(trim(v_member->>'idCardStoragePath'), ''),
                    nullif(trim(v_member->>'id_card_storage_path'), '')
                );

                if v_member_name is null or v_member_email is null then
                    raise exception 'Team member name and email required' using errcode = 'SVK06';
                end if;

                select p.id, p.participant_id
                into v_member_participant
                from public.participants p
                where lower(trim(p.email)) = v_member_email
                limit 1;

                if v_member_participant.id is not null then
                    v_member_uuid := v_member_participant.id;
                    v_member_public_id := v_member_participant.participant_id;

                    update public.participants
                    set id_card_storage_path = coalesce(v_member_id_card_path, id_card_storage_path),
                        id_card_uploaded_at = case when v_member_id_card_path is not null then now() else id_card_uploaded_at end,
                        gender = coalesce(nullif(trim(v_member->>'gender'), ''), gender),
                        state = coalesce(nullif(trim(v_member->>'state'), ''), state)
                    where id = v_member_uuid;
                else
                    v_member_uuid := null;
                    v_member_public_id := null;
                    v_attempt := 0;

                    while v_attempt < 3 and v_member_uuid is null loop
                        v_attempt := v_attempt + 1;
                        v_member_public_id := 'SVK26-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

                        begin
                            insert into public.participants (
                                participant_id, name, college, email, phone, gender, state, id_card_storage_path, id_card_uploaded_at
                            ) values (
                                v_member_public_id,
                                v_member_name,
                                v_member_college,
                                v_member_email,
                                nullif(trim(v_member->>'phone'), ''),
                                nullif(trim(v_member->>'gender'), ''),
                                nullif(trim(v_member->>'state'), ''),
                                v_member_id_card_path,
                                case when v_member_id_card_path is not null then now() else null end
                            )
                            returning id, participant_id
                            into v_member_uuid, v_member_public_id;
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
                ) values (
                    v_participant_event_id,
                    v_member_uuid,
                    v_member_name,
                    v_member_email,
                    nullif(trim(v_member->>'phone'), ''),
                    false
                );
            end loop;
        end if;

        v_results := v_results || jsonb_build_object(
            'participant_public_id', v_participant_public_id,
            'participant_event_id', v_participant_event_id,
            'event_id', v_event_row.id,
            'event_name', v_event_row.name,
            'status', 'added'
        );

    end loop;

    -- =====================================================
    -- 4. FACULTY IN-CHARGE REGISTRATION
    -- =====================================================

    if p_faculty is not null and jsonb_typeof(p_faculty) = 'object' and p_faculty <> '{}'::jsonb then
        v_faculty_email := lower(trim(p_faculty->>'email'));
        if v_faculty_email is null or v_faculty_email = '' then raise exception 'Faculty email is required' using errcode = 'SVK11'; end if;

        select p.id, p.participant_id into v_faculty_participant from public.participants p where lower(trim(p.email)) = v_faculty_email limit 1;

        if v_faculty_participant.id is not null then
            v_faculty_uuid := v_faculty_participant.id;
            v_faculty_public_id := v_faculty_participant.participant_id;

            update public.participants
            set id_card_storage_path = coalesce(nullif(trim(p_faculty->>'id_card_storage_path'), ''), id_card_storage_path),
                id_card_uploaded_at = case when nullif(trim(p_faculty->>'id_card_storage_path'), '') is not null then now() else id_card_uploaded_at end,
                gender = coalesce(nullif(trim(p_faculty->>'gender'), ''), gender),
                state = coalesce(nullif(trim(p_faculty->>'state'), ''), state)
            where id = v_faculty_uuid;
        else
            v_faculty_name := nullif(trim(p_faculty->>'name'), '');
            v_faculty_college := coalesce(
                nullif(trim(p_faculty->>'college'), ''),
                v_existing_participant.college,
                nullif(trim(p_college), '')
            );
            if v_faculty_name is null then raise exception 'Faculty name is required' using errcode = 'SVK11'; end if;

            v_faculty_uuid := null;
            v_faculty_public_id := null;
            v_attempt := 0;

            while v_attempt < 3 and v_faculty_uuid is null loop
                v_attempt := v_attempt + 1;
                v_faculty_public_id := 'SVK26-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

                begin
                    insert into public.participants (
                        participant_id, name, college, email, phone, gender, state, id_card_storage_path, id_card_uploaded_at
                    ) values (
                        v_faculty_public_id,
                        v_faculty_name,
                        v_faculty_college,
                        v_faculty_email,
                        nullif(trim(p_faculty->>'phone'), ''),
                        nullif(trim(p_faculty->>'gender'), ''),
                        nullif(trim(p_faculty->>'state'), ''),
                        nullif(trim(p_faculty->>'id_card_storage_path'), ''),
                        case when nullif(trim(p_faculty->>'id_card_storage_path'), '') is not null then now() else null end
                    )
                    returning id, participant_id into v_faculty_uuid, v_faculty_public_id;
                exception
                    when unique_violation then
                        select p.id, p.participant_id into v_faculty_participant from public.participants p where lower(trim(p.email)) = v_faculty_email limit 1;
                        if v_faculty_participant.id is not null then
                            v_faculty_uuid := v_faculty_participant.id;
                            v_faculty_public_id := v_faculty_participant.participant_id;
                            exit;
                        end if;
                        if v_attempt >= 3 then raise exception 'Failed to generate unique Participant ID for faculty' using errcode = 'SVK11'; end if;
                end;
            end loop;
        end if;

        insert into public.faculty_incharges (participant_id, registration_group_id)
        values (v_faculty_uuid, coalesce(v_primary_group_id, v_current_group_id, gen_random_uuid()))
        on conflict (registration_group_id) do nothing;
    end if;

    -- =====================================================
    -- 5. ATOMIC ACCOMMODATION SELECTIONS (SHARED ADVISORY LOCKING & IN-RPC EXPIRATION)
    -- =====================================================

    if p_accommodations is not null and jsonb_typeof(p_accommodations) = 'array' and jsonb_array_length(p_accommodations) > 0 then
        -- 5a. Pre-lock all accommodation delegates in canonical UUID order to guarantee deadlock-free concurrency
        for v_lock_pid in
            select distinct p.id
            from public.participants p
            where lower(trim(p.email)) in (
                select lower(trim(acc->>'email'))
                from jsonb_array_elements(p_accommodations) acc
                where nullif(trim(acc->>'email'), '') is not null
            )
            order by p.id asc
        loop
            perform 1 from public.participants where id = v_lock_pid for update;
            perform pg_advisory_xact_lock(hashtext('participant_accommodation:' || v_lock_pid::text));
        end loop;

        -- 5b. Evaluate each stay under guaranteed mutual exclusion
        for v_accommodation in select * from jsonb_array_elements(p_accommodations) loop
            v_acc_email := lower(trim(v_accommodation->>'email'));
            v_acc_slug := trim(v_accommodation->>'plan_slug');

            if v_acc_email is null or v_acc_email = '' then raise exception 'Accommodation delegate email is required' using errcode = 'SVK11'; end if;
            if v_acc_slug is null or v_acc_slug = '' then raise exception 'Accommodation plan is required' using errcode = 'SVK11'; end if;

            select p.id into v_acc_participant_uuid from public.participants p where lower(trim(p.email)) = v_acc_email order by p.created_at desc limit 1;
            if v_acc_participant_uuid is null then raise exception 'Participant with email % not found for accommodation', v_acc_email using errcode = 'SVK01'; end if;

            -- Row lock participant record and acquire shared participant advisory lock (re-entrant if pre-locked)
            perform 1 from public.participants where id = v_acc_participant_uuid for update;
            perform pg_advisory_xact_lock(hashtext('participant_accommodation:' || v_acc_participant_uuid::text));

            select ap.id, ap.name, ap.duration, ap.price, ap.currency into v_acc_plan from public.accommodation_plans ap where ap.slug = v_acc_slug and ap.is_active = true limit 1;
            if v_acc_plan.id is null then raise exception 'Invalid or inactive accommodation plan: %', v_acc_slug using errcode = 'SVK11'; end if;

            -- Determine exact stay dates
            select coalesce(fc.accommodation_start_date, '2026-10-28'::date) into v_acc_base_start_date from public.festival_config fc where fc.id = 'current' limit 1;
            if v_acc_base_start_date is null then v_acc_base_start_date := '2026-10-28'::date; end if;

            v_acc_start_date := v_acc_base_start_date;
            if (v_accommodation->>'selected_date') is not null and (v_accommodation->>'selected_date') ~ '^\d{4}-\d{2}-\d{2}$' then
                v_acc_start_date := (v_accommodation->>'selected_date')::date;
            end if;
            v_acc_end_date := (v_acc_start_date + v_acc_plan.duration);

            -- Check for overlapping confirmed (paid) accommodation bookings
            select count(*),
                   bool_or(pa.start_date <= v_acc_start_date and pa.end_date >= v_acc_end_date)
            into v_overlapping_paid_count, v_is_fully_covered
            from public.participant_accommodations pa
            where pa.participant_id = v_acc_participant_uuid
              and pa.status = 'paid'
              and pa.start_date < v_acc_end_date
              and pa.end_date > v_acc_start_date;

            if v_overlapping_paid_count > 0 then
                if v_is_fully_covered then
                    raise exception 'Accommodation is already confirmed for these dates (% to %).', v_acc_start_date, v_acc_end_date using errcode = 'SVK11';
                end if;

                if v_acc_participant_uuid <> v_participant_uuid then
                    if v_overlapping_paid_count = 1 and (
                        exists (select 1 from public.participant_accommodations pa where pa.participant_id = v_acc_participant_uuid and pa.status = 'paid' and pa.start_date = v_acc_start_date and pa.end_date = (v_acc_start_date + 1)) or
                        exists (select 1 from public.participant_accommodations pa where pa.participant_id = v_acc_participant_uuid and pa.status = 'paid' and pa.start_date = (v_acc_end_date - 1) and pa.end_date = v_acc_end_date)
                    ) then
                        raise exception 'Accommodation for % partially overlaps with an existing booking. Please select only the uncovered date for this member, or choose No Accommodation.', v_acc_email using errcode = 'SVK11';
                    else
                        raise exception 'Accommodation for % partially overlaps with an existing booking. Please select only the uncovered date for this member, or choose No Accommodation.', v_acc_email using errcode = 'SVK11';
                    end if;
                else
                    raise exception 'Participant already has a confirmed accommodation booking covering dates (% to %)', v_acc_start_date, v_acc_end_date using errcode = 'SVK11';
                end if;
            end if;

            -- =====================================================
            -- 5b-i. PESSIMISTICALLY EVALUATE OVERLAPPING PENDING/UNPAID HOLDS
            -- =====================================================
            v_has_active_checkout := false;
            v_stale_pa_ids := '{}'::uuid[];

            for v_existing_pa in
                select pa.*
                from public.participant_accommodations pa
                where pa.participant_id = v_acc_participant_uuid
                  and pa.status in ('pending', 'unpaid')
                  and pa.start_date < v_acc_end_date
                  and pa.end_date > v_acc_start_date
                order by pa.id asc
                for update
            loop
                -- Retrieve associated payment order
                v_po := null;
                if v_existing_pa.payment_order_id is not null then
                    select * into v_po from public.payment_orders where id = v_existing_pa.payment_order_id;
                else
                    select po.* into v_po
                    from public.payment_orders po
                    join public.payment_order_items poi on poi.payment_order_id = po.id
                    where poi.participant_accommodation_id = v_existing_pa.id
                    order by (po.status = 'paid') desc, po.updated_at desc
                    limit 1;
                end if;

                -- Authoritative Staleness Evaluation
                if v_po.id is not null and v_po.status in ('paid', 'refunded') then
                    v_has_active_checkout := true;

                elsif v_po.id is not null
                      and v_po.gateway_payment_id is not null
                      and trim(v_po.gateway_payment_id) != '' then
                    v_has_active_checkout := true;

                elsif v_po.id is not null and v_po.status = 'failed' then
                    v_stale_pa_ids := array_append(v_stale_pa_ids, v_existing_pa.id);

                elsif greatest(
                        coalesce(v_existing_pa.updated_at, v_existing_pa.created_at, '-infinity'::timestamptz),
                        coalesce(v_po.updated_at, v_po.created_at, '-infinity'::timestamptz)
                      ) >= (now() - interval '1 hour') then
                    v_has_active_checkout := true;

                else
                    v_stale_pa_ids := array_append(v_stale_pa_ids, v_existing_pa.id);
                end if;
            end loop;

            -- 5b-ii. Reject immediately if ANY active checkout in progress exists
            if v_has_active_checkout then
                raise exception 'Active checkout in progress for these dates (% to %). Please complete it or wait for it to expire.',
                    v_acc_start_date, v_acc_end_date using errcode = 'SVK11';
            end if;

            -- 5b-iii. Atomically cancel verified stale holds
            if coalesce(array_length(v_stale_pa_ids, 1), 0) > 0 then
                update public.participant_accommodations pa
                set status = 'cancelled', updated_at = now()
                where pa.id = any(v_stale_pa_ids)
                  and pa.status in ('pending', 'unpaid');
            end if;

            -- 5b-iv. Insert new pending accommodation booking
            insert into public.participant_accommodations (
                participant_id, accommodation_plan_id, start_date, end_date, duration_days, amount, currency, status
            ) values (
                v_acc_participant_uuid, v_acc_plan.id, v_acc_start_date, v_acc_end_date, v_acc_plan.duration, v_acc_plan.price, coalesce(v_acc_plan.currency, 'INR'), 'pending'
            ) returning id into v_pa_id;

            v_new_pa_ids := array_append(v_new_pa_ids, v_pa_id);
            v_new_pa_amounts := array_append(v_new_pa_amounts, v_acc_plan.price);
            v_total_paid_amount := v_total_paid_amount + v_acc_plan.price;
        end loop;
    end if;

    -- =====================================================
    -- 6. ATOMIC PAYMENT ORDER CREATION
    -- =====================================================

    if v_total_paid_amount > 0 and (cardinality(v_new_pe_ids) > 0 or cardinality(v_new_pa_ids) > 0) then
        v_order_reference := 'SVK-' || v_participant_public_id || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6));

        insert into public.payment_orders (
            order_reference, payer_participant_id, amount, currency, status
        ) values (
            v_order_reference, v_participant_uuid, v_total_paid_amount, 'INR', 'pending'
        ) returning id into v_payment_order_id;

        if cardinality(v_new_pe_ids) > 0 then
            for v_idx in 1..cardinality(v_new_pe_ids) loop
                insert into public.payment_order_items (
                    payment_order_id, participant_id, participant_event_id, event_id, item_type, participant_accommodation_id, amount
                ) values (
                    v_payment_order_id, v_participant_uuid, v_new_pe_ids[v_idx], v_new_event_ids[v_idx], 'event', null, v_new_amounts[v_idx]
                );
            end loop;
        end if;

        if cardinality(v_new_pa_ids) > 0 then
            for v_idx in 1..cardinality(v_new_pa_ids) loop
                insert into public.payment_order_items (
                    payment_order_id, participant_id, participant_event_id, event_id, item_type, participant_accommodation_id, amount
                ) values (
                    v_payment_order_id, v_participant_uuid, null, null, 'accommodation', v_new_pa_ids[v_idx], v_new_pa_amounts[v_idx]
                );

                update public.participant_accommodations pa
                set payment_order_id = v_payment_order_id, updated_at = now()
                where pa.id = v_new_pa_ids[v_idx];
            end loop;
        end if;
    end if;

    -- Return cached results
    for v_res in select * from jsonb_array_elements(v_results) loop
        participant_id := v_res->>'participant_public_id';
        participant_event_id := (v_res->>'participant_event_id')::uuid;
        event_id := (v_res->>'event_id')::uuid;
        event_name := v_res->>'event_name';
        status := v_res->>'status';
        payment_order_id := v_payment_order_id;
        return next;
    end loop;

    -- Accommodation-only fallback return
    if jsonb_array_length(v_results) = 0 and v_payment_order_id is not null then
        participant_id := v_participant_public_id;
        participant_event_id := null;
        event_id := null;
        event_name := null;
        status := 'accommodation_only';
        payment_order_id := v_payment_order_id;
        return next;
    end if;

    return;
end;
$$;

ALTER FUNCTION "public"."register_participant_events"("text", "text", "text", "text", "text", "jsonb", "jsonb", "jsonb", "text", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."register_participant_events"("text", "text", "text", "text", "text", "jsonb", "jsonb", "jsonb", "text", "text", "text") FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION "public"."register_participant_events"("text", "text", "text", "text", "text", "jsonb", "jsonb", "jsonb", "text", "text", "text") TO "service_role";
