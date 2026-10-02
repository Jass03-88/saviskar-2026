-- ============================================================
-- SAVISKAR 2026 — ACCOMMODATION ALLOCATION RPC
-- Migration: 20261002050000_accommodation_allocation_rpc.sql
-- ============================================================

-- Atomic RPC for safe, race-free accommodation allocation.
-- Prevents exceeding room capacity and enforces gender eligibility.

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
    v_hostel record;
    v_pa record;
    v_participant record;
    v_current_occupancy integer;
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
    WHERE id = p_room_id AND hostel_id = p_hostel_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_room.is_active THEN
        RAISE EXCEPTION 'ROOM_INACTIVE' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Fetch Hostel and validate
    SELECT * INTO v_hostel
    FROM public.hostels
    WHERE id = p_hostel_id;

    IF NOT v_hostel.is_active THEN
        RAISE EXCEPTION 'HOSTEL_INACTIVE' USING ERRCODE = 'P0001';
    END IF;

    -- 4. Fetch Participant Accommodation and lock it
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

    -- 5. Fetch Participant for Gender Check
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

    -- 6. Check for Self-Reallocation (Same Room)
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

    -- 7. Check Current Room Occupancy
    SELECT count(*) INTO v_current_occupancy
    FROM public.accommodation_allocations
    WHERE room_id = p_room_id AND status = 'active';

    IF v_current_occupancy >= v_room.capacity THEN
        RAISE EXCEPTION 'ROOM_FULL: Capacity exceeded' USING ERRCODE = 'P0001';
    END IF;

    -- 8. Handle Existing Allocation (Reallocation to different room)
    IF v_existing_allocation.id IS NOT NULL THEN
        UPDATE public.accommodation_allocations
        SET status = 'reassigned',
            deallocated_at = now(),
            reason = coalesce(p_reason, 'Reallocated to another room'),
            updated_at = now()
        WHERE id = v_existing_allocation.id;
    END IF;

    -- 8. Insert New Allocation
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

    -- 9. Update Participant Accommodation
    UPDATE public.participant_accommodations
    SET hostel_id = p_hostel_id,
        room_id = p_room_id,
        updated_at = now()
    WHERE id = p_participant_accommodation_id;

    RETURN jsonb_build_object(
        'success', true,
        'allocation_id', v_new_allocation_id,
        'room_id', p_room_id,
        'hostel_id', p_hostel_id
    );
END;
$$;

-- Secure the RPC
REVOKE ALL ON FUNCTION public.allocate_accommodation(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_accommodation(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_accommodation(uuid, uuid, uuid, text) TO service_role;
