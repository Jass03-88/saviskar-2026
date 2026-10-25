-- ============================================================
-- SAVISKAR 2026 — SEED OFFICIAL 3-DAY AND 4-DAY ACCOMMODATION PLANS
-- Migration: 20261025000000_seed_official_3_and_4_day_accommodation_plans.sql
-- ============================================================
--
-- Safety and Idempotency Invariants:
-- 1. Checks that proposed deterministic UUIDs are not taken by conflicting plans.
-- 2. Checks that if '3_days' or '4_days' slug already exists, its configuration
--    matches official specs (3_days: 1498 INR, 3 days; 4_days: 1997 INR, 4 days).
-- 3. If conflicting configuration exists, raises an explicit exception.
-- 4. Never touches 1_day (499 INR) or 2_days (999 INR).
-- 5. Never modifies or deletes any participant_accommodations or payment_orders.
-- ============================================================

DO $$
DECLARE
    v_plan record;
    v_id_3day uuid := 'a1000000-0000-4000-8000-000000000003'::uuid;
    v_id_4day uuid := 'a1000000-0000-4000-8000-000000000004'::uuid;
BEGIN
    -- 1. Verify 3_days plan
    SELECT * INTO v_plan FROM public.accommodation_plans WHERE slug = '3_days';
    IF v_plan.id IS NOT NULL THEN
        -- If it exists, verify all official attributes match
        IF v_plan.duration <> 3 OR v_plan.price <> 1498 OR v_plan.currency <> 'INR' THEN
            RAISE EXCEPTION 'Plan 3_days exists with conflicting configuration: duration=%, price=%, currency=%',
                v_plan.duration, v_plan.price, v_plan.currency;
        END IF;
    ELSE
        -- Verify ID is not used by any other plan
        IF EXISTS (SELECT 1 FROM public.accommodation_plans WHERE id = v_id_3day) THEN
            RAISE EXCEPTION 'Proposed UUID % for 3_days plan is already associated with another plan', v_id_3day;
        END IF;

        INSERT INTO public.accommodation_plans (id, slug, name, duration, price, currency, is_active)
        VALUES (v_id_3day, '3_days', '3 Days Accommodation', 3, 1498, 'INR', true);
    END IF;

    -- 2. Verify 4_days plan
    SELECT * INTO v_plan FROM public.accommodation_plans WHERE slug = '4_days';
    IF v_plan.id IS NOT NULL THEN
        -- If it exists, verify all official attributes match
        IF v_plan.duration <> 4 OR v_plan.price <> 1997 OR v_plan.currency <> 'INR' THEN
            RAISE EXCEPTION 'Plan 4_days exists with conflicting configuration: duration=%, price=%, currency=%',
                v_plan.duration, v_plan.price, v_plan.currency;
        END IF;
    ELSE
        -- Verify ID is not used by any other plan
        IF EXISTS (SELECT 1 FROM public.accommodation_plans WHERE id = v_id_4day) THEN
            RAISE EXCEPTION 'Proposed UUID % for 4_days plan is already associated with another plan', v_id_4day;
        END IF;

        INSERT INTO public.accommodation_plans (id, slug, name, duration, price, currency, is_active)
        VALUES (v_id_4day, '4_days', '4 Days Accommodation', 4, 1997, 'INR', true);
    END IF;

    -- 3. Confirm 1_day and 2_days plans are untouched and have correct official prices
    SELECT * INTO v_plan FROM public.accommodation_plans WHERE slug = '1_day';
    IF v_plan.price <> 499 OR v_plan.duration <> 1 THEN
        RAISE EXCEPTION 'Invariant violation: 1_day plan price/duration modified';
    END IF;

    SELECT * INTO v_plan FROM public.accommodation_plans WHERE slug = '2_days';
    IF v_plan.price <> 999 OR v_plan.duration <> 2 THEN
        RAISE EXCEPTION 'Invariant violation: 2_days plan price/duration modified';
    END IF;
END $$;
