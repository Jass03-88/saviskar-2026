-- ============================================================
-- SAVISKAR 2026 — ACCOMMODATION DATABASE FOUNDATION
-- Migration: 20261002020000_accommodation_database_foundation.sql
-- ============================================================
--
-- This migration establishes the database foundation for the
-- modular accommodation system, participant-level gender and state
-- fields, hostel inventory, and room allocation history.
--
-- INVARIANTS & SAFETY:
-- 1. Accommodation is participant-level (independent per delegate).
-- 2. Configuration prices: 1 Day = 499 INR, 2 Days = 999 INR.
-- 3. Exactly one active accommodation booking allowed per participant.
-- 4. Reassignment preserves allocation history in accommodation_allocations.
-- 5. Accommodation check-in/out is separate from main/event check-in.
-- 6. No backfilling or modification of legacy participant rows.
-- 7. All accommodation tables are protected by RLS with service_role access.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PARTICIPANT SCHEMA ENHANCEMENTS (GENDER & STATE)
-- ------------------------------------------------------------

-- Add nullable gender and state columns without altering existing data or constraints
ALTER TABLE public.participants
    ADD COLUMN IF NOT EXISTS gender text,
    ADD COLUMN IF NOT EXISTS state text;

-- Constrain gender to valid canonical values while permitting NULL for historical/uncollected delegates
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'participants_gender_check'
    ) THEN
        ALTER TABLE public.participants
            ADD CONSTRAINT participants_gender_check
            CHECK (gender IS NULL OR lower(trim(gender)) IN ('male', 'female', 'other'));
    END IF;
END $$;

-- ------------------------------------------------------------
-- 2. ACCOMMODATION PLANS CONFIGURATION TABLE
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accommodation_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    name text NOT NULL,
    duration integer NOT NULL CHECK (duration > 0),
    price integer NOT NULL CHECK (price >= 0),
    currency text NOT NULL DEFAULT 'INR',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Seed official Saviskar 2026 accommodation plans with stable deterministic IDs
INSERT INTO public.accommodation_plans (id, slug, name, duration, price, currency, is_active)
VALUES
    ('a1000000-0000-4000-8000-000000000001'::uuid, '1_day', '1 Day Accommodation', 1, 499, 'INR', true),
    ('a1000000-0000-4000-8000-000000000002'::uuid, '2_days', '2 Days Accommodation', 2, 999, 'INR', true)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    duration = EXCLUDED.duration,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- ------------------------------------------------------------
-- 3. HOSTEL INVENTORY FOUNDATION
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hostels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    gender_eligibility text NOT NULL DEFAULT 'mixed' CHECK (gender_eligibility IN ('male', 'female', 'mixed', 'any')),
    is_active boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hostel_rooms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
    room_number text NOT NULL,
    capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT uq_hostel_room UNIQUE (hostel_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_hostel_rooms_hostel_id
    ON public.hostel_rooms(hostel_id);

-- ------------------------------------------------------------
-- 4. PARTICIPANT ACCOMMODATIONS (BOOKINGS)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.participant_accommodations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    accommodation_plan_id uuid NOT NULL REFERENCES public.accommodation_plans(id) ON DELETE RESTRICT,
    
    -- Booked dates snapshotted to preserve contract integrity against future event calendar changes
    start_date date NOT NULL,
    end_date date NOT NULL,
    duration_days integer NOT NULL CHECK (duration_days > 0),

    -- Financial attributes
    amount integer NOT NULL DEFAULT 0 CHECK (amount >= 0),
    currency text NOT NULL DEFAULT 'INR',
    status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'pending', 'paid', 'failed', 'cancelled')),

    -- Payment relationship (nullable for future order linkage)
    payment_order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,

    -- Hostel and Room assignments (current snapshot)
    hostel_id uuid REFERENCES public.hostels(id) ON DELETE SET NULL,
    room_id uuid REFERENCES public.hostel_rooms(id) ON DELETE SET NULL,

    -- Dedicated accommodation check-in/out lifecycle (independent from event & main registration check-in)
    checked_in boolean NOT NULL DEFAULT false,
    checked_in_at timestamp with time zone,
    checked_out boolean NOT NULL DEFAULT false,
    checked_out_at timestamp with time zone,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- STRICT CONSTRAINT: Exactly ONE active booking per participant (status NOT IN 'cancelled', 'failed').
-- Prevents 1-day and 2-day plans from coexisting, and prevents duplicate active attempts during retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_accommodations_single_active
    ON public.participant_accommodations(participant_id)
    WHERE status NOT IN ('cancelled', 'failed');

CREATE INDEX IF NOT EXISTS idx_participant_accommodations_participant
    ON public.participant_accommodations(participant_id);

CREATE INDEX IF NOT EXISTS idx_participant_accommodations_payment_order
    ON public.participant_accommodations(payment_order_id);

CREATE INDEX IF NOT EXISTS idx_participant_accommodations_hostel
    ON public.participant_accommodations(hostel_id);

CREATE INDEX IF NOT EXISTS idx_participant_accommodations_room
    ON public.participant_accommodations(room_id);

CREATE INDEX IF NOT EXISTS idx_participant_accommodations_status
    ON public.participant_accommodations(status);

-- ------------------------------------------------------------
-- 5. ACCOMMODATION ALLOCATIONS (ASSIGNMENT & REASSIGNMENT HISTORY)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accommodation_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_accommodation_id uuid NOT NULL REFERENCES public.participant_accommodations(id) ON DELETE CASCADE,
    hostel_id uuid NOT NULL REFERENCES public.hostels(id) ON DELETE RESTRICT,
    room_id uuid NOT NULL REFERENCES public.hostel_rooms(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reassigned', 'deallocated', 'cancelled')),
    allocated_by uuid,
    allocated_at timestamp with time zone NOT NULL DEFAULT now(),
    deallocated_at timestamp with time zone,
    reason text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Ensure a participant accommodation has at most ONE active allocation at any given moment
CREATE UNIQUE INDEX IF NOT EXISTS idx_accommodation_allocations_active
    ON public.accommodation_allocations(participant_accommodation_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_accommodation_allocations_pa
    ON public.accommodation_allocations(participant_accommodation_id);

CREATE INDEX IF NOT EXISTS idx_accommodation_allocations_room
    ON public.accommodation_allocations(room_id);

CREATE INDEX IF NOT EXISTS idx_accommodation_allocations_hostel
    ON public.accommodation_allocations(hostel_id);

CREATE INDEX IF NOT EXISTS idx_accommodation_allocations_status
    ON public.accommodation_allocations(status);

-- ------------------------------------------------------------
-- 6. SECURITY & ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------

-- Enable Row Level Security on all accommodation tables to prevent accidental public/anonymous disclosure
ALTER TABLE public.accommodation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hostels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hostel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_accommodations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodation_allocations ENABLE ROW LEVEL SECURITY;

-- Revoke broad anonymous/public access (accommodation data is sensitive operational information)
REVOKE ALL ON TABLE public.accommodation_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hostels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hostel_rooms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.participant_accommodations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.accommodation_allocations FROM PUBLIC, anon, authenticated;

-- Explicitly grant full administrative operations to service_role (standard Saviskar backend pattern)
GRANT ALL ON TABLE public.accommodation_plans TO service_role;
GRANT ALL ON TABLE public.hostels TO service_role;
GRANT ALL ON TABLE public.hostel_rooms TO service_role;
GRANT ALL ON TABLE public.participant_accommodations TO service_role;
GRANT ALL ON TABLE public.accommodation_allocations TO service_role;

-- ------------------------------------------------------------
-- 7. OWNERSHIP
-- ------------------------------------------------------------

ALTER TABLE public.accommodation_plans OWNER TO postgres;
ALTER TABLE public.hostels OWNER TO postgres;
ALTER TABLE public.hostel_rooms OWNER TO postgres;
ALTER TABLE public.participant_accommodations OWNER TO postgres;
ALTER TABLE public.accommodation_allocations OWNER TO postgres;
