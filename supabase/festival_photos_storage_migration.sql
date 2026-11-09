-- ════════════════════════════════════════════════════════════════════════
--  Silks League — festival photos (Supabase Storage)
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  Admin → Setup → Festivals → "Change photo" uploads an image to a storage bucket and
--  saves its public URL in festivals.banner_url, the column the app already reads for
--  the festival photo (Home, Festivals, Results, Picks). Nothing about the festivals
--  table changes.
--
--  What this adds
--    1. A public storage bucket "festival-photos"
--         - public: anyone can view a photo by its URL (the app shows them to everyone,
--           including people who are not signed in yet on the landing page)
--         - 5 MB limit per file, JPEG / PNG / WebP only
--           (Admin shrinks a photo to about 1600px wide before uploading, so real
--            uploads are far smaller than this)
--    2. Policies on storage.objects for that bucket only
--         - SELECT  anyone
--         - INSERT / UPDATE / DELETE  admins only (profiles.is_admin = true)
--
--  Purely additive, and it touches no other bucket or table. Safe to run before the new
--  front end is deployed, and safe to run twice.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. The bucket ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'festival-photos', 'festival-photos', true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];


-- ── 2. Who can do what ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "festival_photos_read"         ON storage.objects;
DROP POLICY IF EXISTS "festival_photos_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "festival_photos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "festival_photos_admin_delete" ON storage.objects;

CREATE POLICY "festival_photos_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'festival-photos');

CREATE POLICY "festival_photos_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'festival-photos'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "festival_photos_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'festival-photos'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    bucket_id = 'festival-photos'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "festival_photos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'festival-photos'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );


-- ════════════════════════════════════════════════════════════════════════
--  Checks to run afterwards (read-only)
-- ════════════════════════════════════════════════════════════════════════
--  -- the bucket exists and is public: expect 1 row, public = true
--  select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'festival-photos';
--
--  -- the four policies exist: expect 4 rows
--  select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and policyname like 'festival_photos_%'
--   order by policyname;


-- ── To undo (only if no festival uses a photo from this bucket yet) ──────
--    DROP POLICY IF EXISTS "festival_photos_read"         ON storage.objects;
--    DROP POLICY IF EXISTS "festival_photos_admin_insert" ON storage.objects;
--    DROP POLICY IF EXISTS "festival_photos_admin_update" ON storage.objects;
--    DROP POLICY IF EXISTS "festival_photos_admin_delete" ON storage.objects;
--    DELETE FROM storage.buckets WHERE id = 'festival-photos';   -- empty the bucket first in the dashboard
