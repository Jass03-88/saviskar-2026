


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."add_events_to_participant"("p_participant_id" "text", "p_event_ids" "uuid"[]) RETURNS TABLE("participant_id" "text", "event_id" "uuid", "event_name" "text", "status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

declare
    v_participant uuid;
    v_event_id uuid;
    v_event record;
    v_existing boolean;
begin

    -- -----------------------------------------------------
    -- 1. Validate participant ID
    -- -----------------------------------------------------

    if nullif(trim(p_participant_id), '') is null then
        raise exception 'Participant ID is required';
    end if;

    -- -----------------------------------------------------
    -- 2. Find existing participant
    -- -----------------------------------------------------

    select p.id
    into v_participant
    from public.participants p
    where upper(trim(p.participant_id))
        = upper(trim(p_participant_id))
    limit 1;

    if v_participant is null then
        raise exception 'Participant not found';
    end if;

    -- -----------------------------------------------------
    -- 3. Validate event list
    -- -----------------------------------------------------

    if p_event_ids is null
       or cardinality(p_event_ids) = 0 then
        raise exception 'At least one event must be selected';
    end if;

    -- -----------------------------------------------------
    -- 4. Process each selected event
    -- -----------------------------------------------------

    foreach v_event_id in array p_event_ids
    loop

        -- Find active/open event
        select
            e.id,
            e.name,
            e.registration_fee,
            e.registration_open,
            e.active
        into v_event
        from public.events e
        where e.id = v_event_id
        limit 1;

        if v_event.id is null then
            raise exception 'Event not found: %', v_event_id;
        end if;

        if coalesce(v_event.active, false) = false then
            raise exception
                'Event "%" is not active',
                v_event.name;
        end if;

        if coalesce(v_event.registration_open, false) = false then
            raise exception
                'Registration for "%" is closed',
                v_event.name;
        end if;

        -- -------------------------------------------------
        -- 5. Check whether participant already has event
        -- -------------------------------------------------

        select exists (
            select 1
            from public.participant_events pe
            where pe.participant_id = v_participant
              and pe.event_id = v_event.id
        )
        into v_existing;

        if v_existing then

            -- Existing registration is preserved.
            -- Do NOT reset payment/check-in/etc.

            return query
            select
                upper(trim(p_participant_id)),
                v_event.id,
                v_event.name,
                'already_registered'::text;

        else

            -- -------------------------------------------------
            -- 6. Add NEW participant-event registration
            -- -------------------------------------------------

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
                v_participant,
                v_event.id,
                'pending',
                'not_required',
                coalesce(v_event.registration_fee, 0),
                null,
                null,
                false,
                null
            )
            on conflict (participant_id, event_id)
            do nothing;

            -- -------------------------------------------------
            -- 7. Return result
            -- -------------------------------------------------

            return query
            select
                upper(trim(p_participant_id)),
                v_event.id,
                v_event.name,
                'added'::text;

        end if;

    end loop;

end;
$$;


ALTER FUNCTION "public"."add_events_to_participant"("p_participant_id" "text", "p_event_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_event_registration"("p_event_id" "uuid", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_team" "text", "p_members" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_registration_id uuid;
  v_event record;
  v_member jsonb;
  v_member_count integer;
  v_total_participants integer;
  v_email text;
  v_seen_emails text[];
begin
  /*
   * 1. Validate required participant fields.
   */
  if nullif(trim(p_name), '') is null then
    raise exception 'Participant name is required';
  end if;

  if nullif(trim(p_college), '') is null then
    raise exception 'College is required';
  end if;

  if nullif(trim(p_email), '') is null then
    raise exception 'Email is required';
  end if;

  if nullif(trim(p_phone), '') is null then
    raise exception 'Phone number is required';
  end if;

  /*
   * 2. Validate members payload.
   */
  if p_members is null then
    p_members := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_members) <> 'array' then
    raise exception 'Team members must be an array';
  end if;

  /*
   * 3. Load the authoritative event.
   */
  select
    id,
    active,
    registration_open,
    registration_type,
    min_team_size,
    max_team_size
  into v_event
  from public.events
  where id = p_event_id;

  if not found then
    raise exception 'Event not found';
  end if;

  if v_event.active is not true then
    raise exception 'Event is not active';
  end if;

  if v_event.registration_open is not true then
    raise exception 'Registration is closed';
  end if;

  v_member_count := jsonb_array_length(p_members);

  /*
   * 4. Enforce registration type.
   */
  if lower(trim(coalesce(v_event.registration_type, ''))) = 'team' then

    if nullif(trim(p_team), '') is null then
      raise exception 'Team name is required';
    end if;

    v_total_participants := v_member_count + 1;

    if v_total_participants <
       greatest(1, coalesce(v_event.min_team_size, 1)) then
      raise exception 'Team does not meet minimum size';
    end if;

    if v_total_participants >
       greatest(
         greatest(1, coalesce(v_event.min_team_size, 1)),
         coalesce(
           v_event.max_team_size,
           greatest(1, coalesce(v_event.min_team_size, 1))
         )
       ) then
      raise exception 'Team exceeds maximum size';
    end if;

  else

    if v_member_count > 0 then
      raise exception
        'Individual events cannot contain team members';
    end if;

  end if;

  /*
   * 5. Validate participant/member emails and prevent duplicates
   *    inside the submitted team.
   */
  v_email := lower(trim(p_email));

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid participant email';
  end if;

  v_seen_emails := array[v_email];

  for v_member in
    select value
    from jsonb_array_elements(p_members)
  loop

    if jsonb_typeof(v_member) <> 'object' then
      raise exception 'Invalid team member';
    end if;

    if nullif(trim(v_member->>'name'), '') is null then
      raise exception 'Team member name is required';
    end if;

    if nullif(trim(v_member->>'email'), '') is null then
      raise exception 'Team member email is required';
    end if;

    if nullif(trim(v_member->>'phone'), '') is null then
      raise exception 'Team member phone is required';
    end if;

    v_email := lower(trim(v_member->>'email'));

    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Invalid team member email';
    end if;

    if v_email = any(v_seen_emails) then
      raise exception
        'Each participant must use a different email address';
    end if;

    v_seen_emails :=
      array_append(v_seen_emails, v_email);

  end loop;

  /*
   * 6. Create parent registration.
   *
   * Your unique index on event_id + normalized email remains
   * the final race-safe duplicate-registration protection.
   */
  insert into public.registrations (
    event_id,
    name,
    college,
    email,
    phone,
    team,
    created_at
  )
  values (
    p_event_id,
    trim(p_name),
    trim(p_college),
    lower(trim(p_email)),
    trim(p_phone),

    case
      when lower(trim(coalesce(v_event.registration_type, ''))) = 'team'
      then nullif(trim(p_team), '')
      else null
    end,

    now()
  )
  returning id into v_registration_id;

  /*
   * 7. Create team members.
   *
   * This is still part of the same PostgreSQL transaction.
   */
  if lower(trim(coalesce(v_event.registration_type, ''))) = 'team' then

    for v_member in
      select value
      from jsonb_array_elements(p_members)
    loop

      insert into public.registration_members (
        registration_id,
        name,
        email,
        phone
      )
      values (
        v_registration_id,
        trim(v_member->>'name'),
        lower(trim(v_member->>'email')),
        trim(v_member->>'phone')
      );

    end loop;

  end if;

  return v_registration_id;
end;
$_$;


ALTER FUNCTION "public"."create_event_registration"("p_event_id" "uuid", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_team" "text", "p_members" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.admins
    where user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_participant_events"("p_participant_id" "text" DEFAULT NULL::"text", "p_name" "text" DEFAULT NULL::"text", "p_college" "text" DEFAULT NULL::"text", "p_email" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_events" "jsonb" DEFAULT '[]'::"jsonb") RETURNS TABLE("participant_id" "text", "participant_event_id" "uuid", "event_id" "uuid", "event_name" "text", "status" "text")
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
        order by (value->>'event_id')::uuid
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
        -- Get event
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
            e.payment_unit
        into v_event_row
        from public.events e
        where e.id = v_event_id
        limit 1;


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


    return;

end;
$$;


ALTER FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admins" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'admin'::"text" NOT NULL,
    CONSTRAINT "admins_role_check" CHECK (("role" = ANY (ARRAY['master'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "description" "text",
    "event_date" "date",
    "start_time" time without time zone,
    "venue" "text",
    "registration_type" "text" DEFAULT 'individual'::"text" NOT NULL,
    "min_team_size" integer,
    "max_team_size" integer,
    "registration_limit" integer,
    "registration_open" boolean DEFAULT true NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "registration_fee" integer DEFAULT 0 NOT NULL,
    "payment_unit" "text" DEFAULT 'free'::"text",
    "payment_type" "text",
    CONSTRAINT "events_payment_type_check" CHECK (("payment_type" = ANY (ARRAY['free'::"text", 'paid'::"text"]))),
    CONSTRAINT "events_payment_unit_check" CHECK ((("payment_unit" IS NULL) OR ("payment_unit" = ANY (ARRAY['per_student'::"text", 'per_team'::"text"])))),
    CONSTRAINT "events_registration_type_check" CHECK (("registration_type" = ANY (ARRAY['individual'::"text", 'team'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."participant_event_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participant_event_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "is_team_leader" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "participant_id" "uuid"
);


ALTER TABLE "public"."participant_event_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."participant_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "registration_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "payment_amount" integer DEFAULT 0 NOT NULL,
    "payment_id" "text",
    "team_name" "text",
    "checked_in" boolean DEFAULT false NOT NULL,
    "checked_in_at" timestamp with time zone,
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."participant_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participant_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "college" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "photo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "participant_event_id" "uuid",
    "amount" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "gateway" "text",
    "gateway_payment_id" "text",
    "gateway_order_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."registration_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "registration_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "is_team_leader" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."registration_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "event_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "college" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "team" "text",
    "checked_in" boolean DEFAULT false NOT NULL,
    "checked_in_at" timestamp with time zone,
    "confirmation_email_sent_at" timestamp with time zone,
    "confirmation_email_sending_at" timestamp with time zone,
    "payment_status" "text" DEFAULT 'not_required'::"text" NOT NULL,
    CONSTRAINT "registrations_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['not_required'::"text", 'pending'::"text", 'paid'::"text", 'failed'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."registrations" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."participant_event_members"
    ADD CONSTRAINT "participant_event_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."participant_events"
    ADD CONSTRAINT "participant_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."participant_events"
    ADD CONSTRAINT "participant_events_unique_event" UNIQUE ("participant_id", "event_id");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_participant_id_key" UNIQUE ("participant_id");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."registration_members"
    ADD CONSTRAINT "registration_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."registrations"
    ADD CONSTRAINT "registrations_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_participant_events_event" ON "public"."participant_events" USING "btree" ("event_id");



CREATE INDEX "idx_participant_events_participant" ON "public"."participant_events" USING "btree" ("participant_id");



CREATE INDEX "idx_participant_events_is_archived" ON "public"."participant_events" USING "btree" ("is_archived");



CREATE INDEX "idx_participant_events_payment" ON "public"."participant_events" USING "btree" ("payment_status");



CREATE INDEX "idx_participants_email" ON "public"."participants" USING "btree" ("email");



CREATE INDEX "idx_participants_participant_id" ON "public"."participants" USING "btree" ("participant_id");



CREATE INDEX "idx_participants_phone" ON "public"."participants" USING "btree" ("phone");



CREATE INDEX "idx_payments_event_registration" ON "public"."payments" USING "btree" ("participant_event_id");



CREATE INDEX "idx_payments_participant" ON "public"."payments" USING "btree" ("participant_id");



CREATE INDEX "idx_registrations_confirmation_email_sending" ON "public"."registrations" USING "btree" ("confirmation_email_sending_at") WHERE ("confirmation_email_sending_at" IS NOT NULL);



CREATE INDEX "registration_members_registration_id_idx" ON "public"."registration_members" USING "btree" ("registration_id");



CREATE UNIQUE INDEX "registrations_event_email_unique" ON "public"."registrations" USING "btree" ("event_id", "lower"(TRIM(BOTH FROM "email")));



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participant_event_members"
    ADD CONSTRAINT "participant_event_members_participant_event_id_fkey" FOREIGN KEY ("participant_event_id") REFERENCES "public"."participant_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participant_event_members"
    ADD CONSTRAINT "participant_event_members_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participant_events"
    ADD CONSTRAINT "participant_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."participant_events"
    ADD CONSTRAINT "participant_events_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_participant_event_id_fkey" FOREIGN KEY ("participant_event_id") REFERENCES "public"."participant_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."registration_members"
    ADD CONSTRAINT "registration_members_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete events" ON "public"."events" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete registration members" ON "public"."registration_members" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can delete registrations" ON "public"."registrations" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can insert events" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert registration members" ON "public"."registration_members" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert registrations" ON "public"."registrations" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can read all events" ON "public"."events" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read registration members" ON "public"."registration_members" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read registrations" ON "public"."registrations" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can update events" ON "public"."events" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update registration members" ON "public"."registration_members" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can update registrations" ON "public"."registrations" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Public can read active events" ON "public"."events" FOR SELECT TO "anon" USING (("active" = true));



CREATE POLICY "Users can check own admin status" ON "public"."admins" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."participant_event_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."participant_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."registration_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."registrations" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."add_events_to_participant"("p_participant_id" "text", "p_event_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."add_events_to_participant"("p_participant_id" "text", "p_event_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_events_to_participant"("p_participant_id" "text", "p_event_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_event_registration"("p_event_id" "uuid", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_team" "text", "p_members" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_event_registration"("p_event_id" "uuid", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_team" "text", "p_members" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_event_registration"("p_event_id" "uuid", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_team" "text", "p_members" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_event_registration"("p_event_id" "uuid", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_team" "text", "p_members" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_participant_events"("p_participant_id" "text", "p_name" "text", "p_college" "text", "p_email" "text", "p_phone" "text", "p_events" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."admins" TO "service_role";
GRANT SELECT ON TABLE "public"."admins" TO "authenticated";

GRANT ALL ON TABLE "public"."events" TO "service_role";
GRANT SELECT ON TABLE "public"."events" TO "anon";
GRANT SELECT ON TABLE "public"."events" TO "authenticated";

GRANT ALL ON TABLE "public"."participant_event_members" TO "service_role";

GRANT ALL ON TABLE "public"."participant_events" TO "service_role";

GRANT ALL ON TABLE "public"."participants" TO "service_role";

GRANT ALL ON TABLE "public"."payments" TO "service_role";

GRANT ALL ON TABLE "public"."registration_members" TO "service_role";

GRANT ALL ON TABLE "public"."registrations" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







