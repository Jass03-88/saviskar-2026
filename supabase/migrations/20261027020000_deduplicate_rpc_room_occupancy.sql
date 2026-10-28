-- ============================================================
-- SAVISKAR 2026 — DEDUPLICATE ROOM OCCUPANCY IN ALLOCATION RPC
-- Migration: 20261027020000_deduplicate_rpc_room_occupancy.sql
-- ============================================================
-- 1. Updates allocate_accommodation to count DISTINCT physical participants per room.
-- 2. Prevents multi-order participants (e.g. 1-day + 2-day consecutive stays) from
--    consuming multiple beds in the same room.
-- 3. Enables multi-order participants to be assigned to capacity-1 rooms for all their stay days.
-- 4. Preserves atomic concurrency locking (FOR UPDATE on hostel_rooms and participant_accommodations).
-- 5. Preserves all security definer authorization and role checks (auth.uid() in public.admins).

CREATE OR REPLACE FUNCTION public.allocate_accommodation(
    p_participant_accommodation_id uuid,
    p_hostel_id uuid,
    p_room_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_admin_user_id uuid;
    v_is_admin boolean;
    v_has_access boolean;
    v_room record;
    v_floor record;
    v_hostel record;
    v_pa record;
    v_participant record;
    v_is_room_full_any_night boolean := false;
    v_existing_allocation record;
    v_new_allocation_id uuid;
BEGIN
    -- 1. Authorization Check
    v_admin_user_id := auth.uid();
    IF v_admin_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;

    SELECT (role = 'master' OR role = 'admin'), accommodation_access
    INTO v_is_admin, v_has_access
    FROM public.admins
    WHERE user_id = v_admin_user_id;

    IF NOT coalesce(v_is_admin, false) OR NOT coalesce(v_has_access, false) THEN
        RAISE EXCEPTION 'FORBIDDEN: Accommodation access required' USING ERRCODE = '42501';
    END IF;

    -- 2. Lock Room for Atomic Capacity Check
    SELECT * INTO v_room
    FROM public.hostel_rooms
    WHERE id = p_room_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_room.is_active THEN
        RAISE EXCEPTION 'ROOM_INACTIVE' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Fetch Floor and validate hierarchy
    SELECT * INTO v_floor
    FROM public.hostel_floors
    WHERE id = v_room.floor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FLOOR_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_floor.is_active THEN
        RAISE EXCEPTION 'FLOOR_INACTIVE' USING ERRCODE = 'P0001';
    END IF;

    IF v_floor.hostel_id <> p_hostel_id THEN
        RAISE EXCEPTION 'FLOOR_HOSTEL_MISMATCH: Floor does not belong to selected hostel' USING ERRCODE = 'P0001';
    END IF;

    IF v_room.hostel_id <> p_hostel_id THEN
        RAISE EXCEPTION 'ROOM_HOSTEL_MISMATCH: Room does not belong to selected hostel' USING ERRCODE = 'P0001';
    END IF;

    -- 4. Fetch Hostel and validate
    SELECT * INTO v_hostel
    FROM public.hostels
    WHERE id = p_hostel_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'HOSTEL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_hostel.is_active THEN
        RAISE EXCEPTION 'HOSTEL_INACTIVE' USING ERRCODE = 'P0001';
    END IF;

    -- 5. Fetch Participant Accommodation and lock it
    SELECT * INTO v_pa
    FROM public.participant_accommodations
    WHERE id = p_participant_accommodation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_pa.status <> 'paid' THEN
        RAISE EXCEPTION 'BOOKING_NOT_ELIGIBLE: Status must be paid, currently %', v_pa.status USING ERRCODE = 'P0001';
    END IF;

    IF v_pa.start_date IS NULL OR v_pa.end_date IS NULL OR v_pa.start_date >= v_pa.end_date THEN
        RAISE EXCEPTION 'INVALID_BOOKING_DATES: start_date must be before end_date' USING ERRCODE = 'P0001';
    END IF;

    -- 6. Fetch Participant for Gender Check
    SELECT * INTO v_participant
    FROM public.participants
    WHERE id = v_pa.participant_id;

    IF v_participant.gender IS NULL THEN
        RAISE EXCEPTION 'MISSING_GENDER: Participant gender must be specified before allocation' USING ERRCODE = 'P0001';
    END IF;

    -- Gender Eligibility Check
    IF lower(trim(v_participant.gender)) = 'other' THEN
        RAISE EXCEPTION 'UNSUPPORTED_GENDER: No defined allocation policy for "other" gender.' USING ERRCODE = 'P0001';
    END IF;

    IF v_hostel.gender_eligibility = 'male' AND lower(trim(v_participant.gender)) <> 'male' THEN
        RAISE EXCEPTION 'GENDER_MISMATCH: Hostel is for males only' USING ERRCODE = 'P0001';
    ELSIF v_hostel.gender_eligibility = 'female' AND lower(trim(v_participant.gender)) <> 'female' THEN
        RAISE EXCEPTION 'GENDER_MISMATCH: Hostel is for females only' USING ERRCODE = 'P0001';
    ELSIF v_hostel.gender_eligibility NOT IN ('male', 'female', 'mixed', 'any') THEN
        RAISE EXCEPTION 'INVALID_HOSTEL_ELIGIBILITY' USING ERRCODE = 'P0001';
    END IF;

    -- 7. Check for Self-Reallocation (Same Room)
    SELECT * INTO v_existing_allocation
    FROM public.accommodation_allocations
    WHERE participant_accommodation_id = p_participant_accommodation_id
    AND status = 'active';

    IF v_existing_allocation.id IS NOT NULL AND v_existing_allocation.room_id = p_room_id THEN
        -- No-op: Participant is already actively allocated to this exact room
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Already allocated to this room'
        );
    END IF;

    -- 8. Check Current Room Occupancy (Date-Aware: per-night within stay interval [start_date, end_date))
    -- Room capacity must be evaluated on every night of the requested booking.
    -- Stays meet at checkout/check-in without overlapping (start_date <= stay_night < end_date).
    -- Excludes the participant being allocated/reallocated (pa.participant_id <> v_pa.participant_id)
    -- so multi-order bookings for the same participant do not consume duplicate beds.
    SELECT EXISTS (
        SELECT 1
        FROM generate_series(v_pa.start_date, v_pa.end_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_night(night_date)
        WHERE (
            SELECT count(DISTINCT pa.participant_id)
            FROM public.accommodation_allocations aa
            JOIN public.participant_accommodations pa ON pa.id = aa.participant_accommodation_id
            WHERE aa.room_id = p_room_id
              AND aa.status = 'active'
              AND pa.participant_id <> v_pa.participant_id
              AND pa.start_date <= stay_night.night_date
              AND pa.end_date > stay_night.night_date
        ) >= v_room.capacity
    ) INTO v_is_room_full_any_night;

    IF v_is_room_full_any_night THEN
        RAISE EXCEPTION 'ROOM_FULL: Capacity exceeded' USING ERRCODE = 'P0001';
    END IF;

    -- 9. Handle Existing Allocation (Reallocation to different room)
    IF v_existing_allocation.id IS NOT NULL THEN
        UPDATE public.accommodation_allocations
        SET status = 'reassigned',
            deallocated_at = now(),
            reason = coalesce(p_reason, 'Reallocated to another room'),
            updated_at = now()
        WHERE id = v_existing_allocation.id;
    END IF;

    -- 10. Insert New Allocation
    INSERT INTO public.accommodation_allocations (
        participant_accommodation_id,
        hostel_id,
        room_id,
        status,
        allocated_by,
        reason
    ) VALUES (
        p_participant_accommodation_id,
        p_hostel_id,
        p_room_id,
        'active',
        v_admin_user_id,
        coalesce(p_reason, 'Initial allocation')
    ) RETURNING id INTO v_new_allocation_id;

    -- 11. Update Participant Accommodation
    UPDATE public.participant_accommodations
    SET hostel_id = p_hostel_id,
        room_id = p_room_id,
        updated_at = now()
    WHERE id = p_participant_accommodation_id;

    RETURN jsonb_build_object(
        'success', true,
        'allocation_id', v_new_allocation_id,
        'room_id', p_room_id,
        'floor_id', v_floor.id,
        'hostel_id', p_hostel_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_accommodation(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_accommodation(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_accommodation(uuid, uuid, uuid, text) TO service_role;
