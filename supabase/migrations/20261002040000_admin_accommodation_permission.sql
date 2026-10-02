-- ============================================================
-- SAVISKAR 2026 — ADMIN ACCOMMODATION PERMISSION
-- Migration: 20261002040000_admin_accommodation_permission.sql
-- ============================================================

ALTER TABLE public.admins
    ADD COLUMN IF NOT EXISTS accommodation_access boolean NOT NULL DEFAULT false;

-- Auto-grant accommodation_access to existing master admins to prevent lockout
UPDATE public.admins
SET accommodation_access = true
WHERE role = 'master';
