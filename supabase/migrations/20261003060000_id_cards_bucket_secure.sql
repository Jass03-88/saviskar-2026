-- ============================================================
-- SAVISKAR 2026 — ID CARDS BUCKET ENFORCEMENT
-- Migration: 20261003060000_id_cards_bucket_secure.sql
-- ============================================================

-- Ensure the bucket exists securely
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'id_cards', 
    'id_cards', 
    false, 
    2621440, -- 2.5MB in bytes
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']::text[]
)
ON CONFLICT (id) DO UPDATE SET 
    public = false,
    file_size_limit = 2621440,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']::text[];

-- Enable RLS
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Admins can view/select the files
DROP POLICY IF EXISTS "Admins can access ID cards" ON storage.objects;
CREATE POLICY "Admins can access ID cards"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'id_cards' AND public.is_admin());

-- Participants cannot select or list files publicly (API handles upload via service_role)
