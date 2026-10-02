-- ============================================================
-- SAVISKAR 2026 — HOSTEL FLOORS INVENTORY LAYER
-- Migration: 20261002060000_hostel_floors_inventory.sql
-- ============================================================
--
-- This migration introduces the Floor entity into the accommodation
-- inventory hierarchy:
-- Hostel -> Floor -> Room -> Participant
--
-- INVARIANTS:
-- 1. Floors belong to a specific hostel.
-- 2. Floor number is relative to the hostel (floor_number >= 0).
-- 3. (hostel_id, floor_number) is unique.
-- 4. Rooms belong to a specific floor and inherit/verify the hostel relationship.
-- 5. (floor_id, room_number) is unique.
-- 6. Strict RLS on hostel_floors (service_role only, no anon/public access).
-- 7. Allocation RPC validates hostel -> floor -> room consistency atomically.
-- ============================================================

-- ------------------------------------------------------------
-- 1. HOSTEL FLOORS TABLE
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hostel_floors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE RESTRICT,
    floor_number integer NOT NULL CHECK (floor_number >= 0),
    name text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT uq_hostel_floor UNIQUE (hostel_id, floor_number)
);

CREATE INDEX IF NOT EXISTS idx_hostel_floors_hostel_id
    ON public.hostel_floors(hostel_id);

CREATE INDEX IF NOT EXISTS idx_hostel_floors_is_active
    ON public.hostel_floors(is_active);

-- ------------------------------------------------------------
-- 2. UPDATE HOSTEL ROOMS RELATIONSHIP
-- ------------------------------------------------------------

-- Add floor_id column to hostel_rooms
ALTER TABLE public.hostel_rooms
    ADD COLUMN IF NOT EXISTS floor_id uuid REFERENCES public.hostel_floors(id) ON DELETE RESTRICT;

-- Drop old hostel-scoped room uniqueness constraint if it exists
ALTER TABLE public.hostel_rooms
    DROP CONSTRAINT IF EXISTS uq_hostel_room;

-- Create floor-scoped room uniqueness constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_floor_room'
    ) THEN
        ALTER TABLE public.hostel_rooms
            ADD CONSTRAINT uq_floor_room UNIQUE (floor_id, room_number);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hostel_rooms_floor_id
    ON public.hostel_rooms(floor_id);

-- Enforce NOT NULL on floor_id for all future rows
-- Since existing table has 0 rows, this is completely safe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.hostel_rooms WHERE floor_id IS NULL
    ) THEN
        ALTER TABLE public.hostel_rooms
            ALTER COLUMN floor_id SET NOT NULL;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) FOR HOSTEL FLOORS
-- ------------------------------------------------------------

ALTER TABLE public.hostel_floors ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hostel_floors FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.hostel_floors TO service_role;
ALTER TABLE public.hostel_floors OWNER TO postgres;

-- ------------------------------------------------------------
-- 4. UPDATE ALLOCATION RPC WITH FLOOR VALIDATION
-- ------------------------------------------------------------

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

    -- 8. Check Current Room Occupancy
    SELECT count(*) INTO v_current_occupancy
    FROM public.accommodation_allocations
    WHERE room_id = p_room_id AND status = 'active';

    IF v_current_occupancy >= v_room.capacity THEN
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
