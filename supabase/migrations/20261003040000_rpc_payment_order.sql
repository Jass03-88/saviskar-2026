-- ============================================================
-- SAVISKAR 2026 — RPC PAYMENT ORDER RETURN
-- Migration: 20261003040000_rpc_payment_order.sql
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
    v_primary_group_id uuid := null;

    -- Faculty
    v_faculty_email text;
    v_faculty_participant record;
    v_faculty_uuid uuid;
    v_faculty_public_id text;
    v_faculty_name text;
    v_faculty_college text;
    
    -- Result Table
    v_results jsonb := '[]'::jsonb;
    v_res jsonb;

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
        v_participant_public_id := v_existing_participant.participant_id;

        -- Update with new fields if provided
        update public.participants
        set id_card_storage_path = coalesce(p_id_card_storage_path, id_card_storage_path),
            id_card_uploaded_at = case when p_id_card_storage_path is not null then now() else id_card_uploaded_at end,
            gender = coalesce(trim(p_gender), gender),
            state = coalesce(trim(p_state), state)
        where id = v_participant_uuid;

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
            v_participant_uuid := v_existing_participant.id;
            v_participant_public_id := v_existing_participant.participant_id;

            update public.participants
            set id_card_storage_path = coalesce(p_id_card_storage_path, id_card_storage_path),
                id_card_uploaded_at = case when p_id_card_storage_path is not null then now() else id_card_uploaded_at end,
                gender = coalesce(trim(p_gender), gender),
                state = coalesce(trim(p_state), state)
            where id = v_participant_uuid;
        else
            v_attempt := 0;
            loop
                v_attempt := v_attempt + 1;
                v_participant_public_id := 'SVK26-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

                begin
                    insert into public.participants (
                        participant_id, name, college, email, phone, gender, state, id_card_storage_path, id_card_uploaded_at
                    ) values (
                        v_participant_public_id, trim(p_name), trim(p_college), lower(trim(p_email)), trim(p_phone),
                        trim(p_gender), trim(p_state), p_id_card_storage_path, case when p_id_card_storage_path is not null then now() else null end
                    ) returning id into v_participant_uuid;

                    exit;
                exception
                    when unique_violation then
                        select p.id, p.participant_id into v_existing_participant
                        from public.participants p
                        where lower(trim(p.email)) = lower(trim(p_email)) limit 1;

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
    -- 3. Loop over requested events
    -- =====================================================

    for v_event in
        select * from jsonb_array_elements(p_events)
    loop
        v_event_id := (v_event->>'event_id')::uuid;

        select e.id, e.name, e.category, e.registration_type, e.min_team_size, e.max_team_size,
               e.payment_type, e.registration_fee, e.payment_unit, e.registration_open,
               e.active, e.registration_limit
        into v_event_row
        from public.events e where e.id = v_event_id limit 1;

        if v_event_row.id is null then raise exception 'Event was not found' using errcode = 'SVK03'; end if;
        if not coalesce(v_event_row.active, true) then raise exception 'This event is currently unavailable' using errcode = 'SVK04'; end if;
        if not coalesce(v_event_row.registration_open, true) then raise exception 'Registration for this event is closed' using errcode = 'SVK05'; end if;

        if v_event_row.registration_limit is not null then
            -- ISSUE 5 FIX: qualify event_id
            perform 1 from public.events where id = v_event_id for update;
            select count(*) into v_current_reg_count from public.participant_events pe where pe.event_id = v_event_id and pe.is_archived = false;
            if v_current_reg_count >= v_event_row.registration_limit then
                raise exception 'Registration limit reached for %', v_event_row.name using errcode = 'SVK05';
            end if;
        end if;

        select exists (
            select 1 from public.participant_events pe
            where pe.participant_id = v_participant_uuid and pe.event_id = v_event_id
        ) into v_existing_event;

        if v_existing_event then
            select pe.id into v_participant_event_id
            from public.participant_events pe
            where pe.participant_id = v_participant_uuid and pe.event_id = v_event_id limit 1;
            
            v_results := v_results || jsonb_build_object(
                'participant_public_id', v_participant_public_id,
                'participant_event_id', v_participant_event_id,
                'event_id', v_event_row.id,
                'event_name', v_event_row.name,
                'status', 'already_registered'
            );
            continue;
        end if;

        v_team := nullif(trim(v_event->>'team'), '');
        v_is_team_head := coalesce((v_event->>'is_team_head')::boolean, false);
        v_members := coalesce(v_event->'members', '[]'::jsonb);
        v_member_count := jsonb_array_length(v_members);
        v_min_team_size := coalesce(v_event_row.min_team_size, 1);
        v_max_team_size := coalesce(v_event_row.max_team_size, case when v_event_row.registration_type = 'team' then 10 else 1 end);
        v_registration_type := coalesce(v_event_row.registration_type, 'individual');

        if v_registration_type = 'team' then
            if v_team is null then raise exception 'Please enter your team name' using errcode = 'SVK06'; end if;
            v_total_participants := v_member_count + 1;
            if v_total_participants < v_min_team_size then
                raise exception '% requires at least % team members.', v_event_row.name, v_min_team_size using errcode = 'SVK07';
            end if;
            if v_total_participants > v_max_team_size then
                raise exception '% allows a maximum of % team members.', v_event_row.name, v_max_team_size using errcode = 'SVK08';
            end if;
        else
            v_total_participants := 1;
        end if;

        v_payment_amount := 0;
        if v_event_row.payment_type = 'paid' then
            if coalesce(v_event_row.payment_unit, 'per_student') = 'per_team' then
                v_payment_amount := coalesce(v_event_row.registration_fee, 0);
            else
                v_payment_amount := coalesce(v_event_row.registration_fee, 0) * v_total_participants;
            end if;
        end if;

        if v_registration_type = 'team' then
            v_group_key := 'TEAM:' || lower(trim(v_team));
        else
            v_group_key := 'SOLO:' || v_participant_uuid::text;
        end if;

        if v_group_ids ? v_group_key then
            v_current_group_id := (v_group_ids->>v_group_key)::uuid;
        else
            v_current_group_id := gen_random_uuid();
            v_group_ids := jsonb_set(v_group_ids, array[v_group_key], to_jsonb(v_current_group_id::text));
        end if;

        if v_primary_group_id is null then
            v_primary_group_id := v_current_group_id;
        end if;

        insert into public.participant_events (
            participant_id, event_id, registration_status, payment_status, payment_amount, team_name, checked_in, registration_group_id
        ) values (
            v_participant_uuid, v_event_id, 'confirmed',
            case when v_payment_amount > 0 then 'pending' else 'not_required' end,
            v_payment_amount, v_team, false, v_current_group_id
        ) returning id into v_participant_event_id;

        if v_payment_amount > 0 then
            v_new_pe_ids := array_append(v_new_pe_ids, v_participant_event_id);
            v_new_event_ids := array_append(v_new_event_ids, v_event_id);
            v_new_amounts := array_append(v_new_amounts, v_payment_amount);
            v_total_paid_amount := v_total_paid_amount + v_payment_amount;
        end if;

        if v_registration_type = 'team' then
            insert into public.participant_event_members (
                participant_event_id, participant_id, name, email, phone, is_team_leader
            ) values (
                v_participant_event_id, v_participant_uuid, coalesce(v_existing_participant.name, trim(p_name)),
                lower(trim(coalesce(v_existing_participant.email, p_email))), coalesce(v_existing_participant.phone, trim(p_phone)), true
            );

            for v_member in select * from jsonb_array_elements(v_members) loop
                v_member_email := lower(trim(v_member->>'email'));
                if v_member_email is null or v_member_email = '' then raise exception 'Team member email is required' using errcode = 'SVK09'; end if;
                if v_member_email = lower(trim(coalesce(v_existing_participant.email, p_email))) then raise exception 'Team leader cannot be added as a team member' using errcode = 'SVK10'; end if;

                select p.id, p.participant_id into v_member_participant
                from public.participants p where lower(trim(p.email)) = v_member_email limit 1;

                if v_member_participant.id is not null then
                    v_member_uuid := v_member_participant.id;
                    v_member_public_id := v_member_participant.participant_id;

                    update public.participants
                    set id_card_storage_path = coalesce(id_card_storage_path, trim(v_member->>'id_card_storage_path')),
                        id_card_uploaded_at = case when id_card_storage_path is null and trim(v_member->>'id_card_storage_path') is not null then now() else id_card_uploaded_at end,
                        gender = coalesce(gender, trim(v_member->>'gender')),
                        state = coalesce(state, trim(v_member->>'state'))
                    where id = v_member_uuid;
                else
                    v_member_name := trim(v_member->>'name');
                    v_member_college := trim(coalesce(v_member->>'college', v_existing_participant.college, p_college));

                    v_attempt := 0;
                    loop
                        v_attempt := v_attempt + 1;
                        v_member_public_id := 'SVK26-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
                        begin
                            insert into public.participants (
                                participant_id, name, college, email, phone, gender, state, id_card_storage_path, id_card_uploaded_at
                            ) values (
                                v_member_public_id, v_member_name, v_member_college, v_member_email, trim(v_member->>'phone'),
                                trim(v_member->>'gender'), trim(v_member->>'state'), trim(v_member->>'id_card_storage_path'),
                                case when trim(v_member->>'id_card_storage_path') is not null then now() else null end
                            ) returning id into v_member_uuid;
                            exit;
                        exception
                            when unique_violation then
                                select p.id, p.participant_id into v_member_participant
                                from public.participants p where lower(trim(p.email)) = v_member_email limit 1;
                                if v_member_participant.id is not null then
                                    v_member_uuid := v_member_participant.id;
                                    v_member_public_id := v_member_participant.participant_id;
                                    exit;
                                end if;
                                if v_attempt >= 3 then raise exception 'Failed to generate unique Participant ID after 3 attempts' using errcode = 'SVK11'; end if;
                        end;
                    end loop;
                end if;

                insert into public.participant_event_members (
                    participant_event_id, participant_id, name, email, phone, is_team_leader
                ) values (
                    v_participant_event_id, v_member_uuid, trim(v_member->>'name'), v_member_email, trim(v_member->>'phone'), false
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
    -- 10.5. FACULTY PROCESSING
    -- =====================================================
    if p_faculty is not null then
        v_faculty_email := lower(trim(p_faculty->>'email'));
        if v_faculty_email is null or v_faculty_email = '' then raise exception 'Faculty email is required' using errcode = 'SVK11'; end if;

        select p.id, p.participant_id into v_faculty_participant
        from public.participants p
        where lower(trim(p.email)) = v_faculty_email
        limit 1;

        if v_faculty_participant.id is not null then
            v_faculty_uuid := v_faculty_participant.id;
            v_faculty_public_id := v_faculty_participant.participant_id;

            update public.participants
            set id_card_storage_path = coalesce(id_card_storage_path, trim(p_faculty->>'id_card_storage_path')),
                id_card_uploaded_at = case when id_card_storage_path is null and trim(p_faculty->>'id_card_storage_path') is not null then now() else id_card_uploaded_at end,
                gender = coalesce(gender, trim(p_faculty->>'gender')),
                state = coalesce(state, trim(p_faculty->>'state'))
            where id = v_faculty_uuid;
        else
            v_faculty_name := trim(p_faculty->>'name');
            v_faculty_college := trim(p_faculty->>'college');

            v_attempt := 0;
            loop
                v_attempt := v_attempt + 1;
                v_faculty_public_id := 'SVK26-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

                begin
                    insert into public.participants (
                        participant_id, name, college, email, phone, gender, state, id_card_storage_path, id_card_uploaded_at
                    ) values (
                        v_faculty_public_id, v_faculty_name, v_faculty_college, v_faculty_email, trim(p_faculty->>'phone'),
                        trim(p_faculty->>'gender'), trim(p_faculty->>'state'), trim(p_faculty->>'id_card_storage_path'),
                        case when trim(p_faculty->>'id_card_storage_path') is not null then now() else null end
                    ) returning id into v_faculty_uuid;
                    exit;
                exception
                    when unique_violation then
                        select p.id, p.participant_id into v_faculty_participant
                        from public.participants p where lower(trim(p.email)) = v_faculty_email limit 1;
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
        values (v_faculty_uuid, coalesce(v_primary_group_id, v_current_group_id))
        on conflict (registration_group_id) do nothing;
    end if;


    -- =====================================================
    -- 11. ATOMIC ACCOMMODATION SELECTIONS
    -- =====================================================

    if p_accommodations is not null and jsonb_typeof(p_accommodations) = 'array' and jsonb_array_length(p_accommodations) > 0 then
        for v_accommodation in select * from jsonb_array_elements(p_accommodations) loop
            v_acc_email := lower(trim(v_accommodation->>'email'));
            v_acc_slug := trim(v_accommodation->>'plan_slug');

            if v_acc_email is null or v_acc_email = '' then raise exception 'Accommodation delegate email is required' using errcode = 'SVK11'; end if;
            if v_acc_slug is null or v_acc_slug = '' then raise exception 'Accommodation plan is required' using errcode = 'SVK11'; end if;

            select p.id into v_acc_participant_uuid from public.participants p where lower(trim(p.email)) = v_acc_email order by p.created_at desc limit 1;
            if v_acc_participant_uuid is null then raise exception 'Participant with email % not found for accommodation' , v_acc_email using errcode = 'SVK01'; end if;

            select ap.id, ap.name, ap.duration, ap.price, ap.currency into v_acc_plan from public.accommodation_plans ap where ap.slug = v_acc_slug and ap.is_active = true limit 1;
            if v_acc_plan.id is null then raise exception 'Invalid or inactive accommodation plan: %', v_acc_slug using errcode = 'SVK11'; end if;

            if exists (
                select 1 from public.participant_accommodations pa
                where pa.participant_id = v_acc_participant_uuid and pa.status not in ('cancelled', 'failed')
            ) then
                raise exception 'Participant already has an active accommodation booking' using errcode = 'SVK11';
            end if;

            select coalesce(fc.accommodation_start_date, '2026-10-28'::date) into v_acc_base_start_date from public.festival_config fc where fc.id = 'current' limit 1;
            if v_acc_base_start_date is null then v_acc_base_start_date := '2026-10-28'::date; end if;

            v_acc_start_date := v_acc_base_start_date;
            v_acc_end_date := (v_acc_base_start_date + v_acc_plan.duration);

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
    -- 12. ATOMIC PAYMENT ORDER CREATION (EVENTS + ACCOMMODATION)
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

                update public.participant_accommodations
                set payment_order_id = v_payment_order_id, updated_at = now()
                where id = v_new_pa_ids[v_idx];
            end loop;
        end if;
    end if;

    -- Return the cached results and append the payment order ID
    for v_res in select * from jsonb_array_elements(v_results) loop
        participant_id := v_res->>'participant_public_id';
        participant_event_id := (v_res->>'participant_event_id')::uuid;
        event_id := (v_res->>'event_id')::uuid;
        event_name := v_res->>'event_name';
        status := v_res->>'status';
        payment_order_id := v_payment_order_id;
        return next;
    end loop;
    
    -- If there were no events but there WAS an accommodation, we must still return at least one row with the payment_order_id!
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

-- Secure function permissions
ALTER FUNCTION "public"."register_participant_events"("text", "text", "text", "text", "text", "jsonb", "jsonb", "jsonb", "text", "text", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."register_participant_events"("text", "text", "text", "text", "text", "jsonb", "jsonb", "jsonb", "text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."register_participant_events"("text", "text", "text", "text", "text", "jsonb", "jsonb", "jsonb", "text", "text", "text") FROM anon;
REVOKE ALL ON FUNCTION "public"."register_participant_events"("text", "text", "text", "text", "text", "jsonb", "jsonb", "jsonb", "text", "text", "text") FROM authenticated;
GRANT ALL ON FUNCTION "public"."register_participant_events"("text", "text", "text", "text", "text", "jsonb", "jsonb", "jsonb", "text", "text", "text") TO "service_role";
