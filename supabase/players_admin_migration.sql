-- ════════════════════════════════════════════════════════════════════════
--  Silks League — Admin "Players" tab (notification status + group admin)
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  Purely additive. The current app keeps working after this runs, so run it
--  BEFORE deploying the new front end. Nothing existing is rewritten.
--
--  What this adds
--    1. profiles.notifications_enabled      true / false / NULL (NULL = not known yet)
--       profiles.notifications_updated_at   when the app last wrote it
--       The app writes these when a player turns notifications on or off, and each
--       time the app opens (from the current OneSignal state), so Admin can show a
--       bell per player and filter on "Notifications off". Players already update
--       their own profile row ("Users can update own profile"), so no new policy is
--       needed for that. A player who has not opened the app since this update shows
--       as "not known yet", not as "off".
--    2. Admin rights on groups
--       Today only a group's creator can rename or delete it, and a member can only
--       remove themselves. These policies let an admin (profiles.is_admin) rename or
--       delete any group and remove any member. They sit alongside the existing
--       policies; nothing is dropped or loosened for anyone else.
--
--  What this does NOT touch: scoring, picks, race days, bonuses, any other policy.
--  Deleting a player is not done here: it needs the auth user removed too, so it is
--  the delete-user Edge Function (supabase/functions/delete-user), deployed separately.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. Notification status ───────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notifications_enabled    boolean,
  ADD COLUMN IF NOT EXISTS notifications_updated_at timestamptz;


-- ── 2. Admin rights on groups ────────────────────────────────────────────
DROP POLICY IF EXISTS "groups_admin_update"        ON groups;
DROP POLICY IF EXISTS "groups_admin_delete"        ON groups;
DROP POLICY IF EXISTS "group_members_admin_delete" ON group_members;

CREATE POLICY "groups_admin_update" ON groups
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "groups_admin_delete" ON groups
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "group_members_admin_delete" ON group_members
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ════════════════════════════════════════════════════════════════════════
--  Checks to run afterwards (read-only)
-- ════════════════════════════════════════════════════════════════════════
--  -- the two columns exist: expect 2 rows
--  select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles'
--     and column_name in ('notifications_enabled', 'notifications_updated_at');
--
--  -- the three admin policies exist: expect 3 rows
--  select tablename, policyname, cmd from pg_policies
--   where policyname in ('groups_admin_update', 'groups_admin_delete', 'group_members_admin_delete');
--
--  -- every profile starts as "not known yet": notifications_enabled is NULL for all
--  select count(*) filter (where notifications_enabled is null) as unknown, count(*) as total from profiles;


-- ── To undo (nothing else depends on these) ──────────────────────────────
--    DROP POLICY IF EXISTS "groups_admin_update"        ON groups;
--    DROP POLICY IF EXISTS "groups_admin_delete"        ON groups;
--    DROP POLICY IF EXISTS "group_members_admin_delete" ON group_members;
--    ALTER TABLE profiles DROP COLUMN IF EXISTS notifications_enabled, DROP COLUMN IF EXISTS notifications_updated_at;
