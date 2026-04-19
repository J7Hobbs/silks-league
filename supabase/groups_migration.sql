-- ════════════════════════════════════════════════════════════════
--  Silks League — Groups Migration
--  Run once in the Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ── Groups table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL,
  invite_code text UNIQUE DEFAULT substring(gen_random_uuid()::text, 1, 8),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

-- ── Group members table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id   uuid REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  is_founder boolean DEFAULT false,
  joined_at  timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- ── Enable RLS ──────────────────────────────────────────────────
ALTER TABLE groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- ── Drop any existing policies (safe to re-run) ─────────────────
DROP POLICY IF EXISTS "groups_select"         ON groups;
DROP POLICY IF EXISTS "groups_insert"         ON groups;
DROP POLICY IF EXISTS "groups_update"         ON groups;
DROP POLICY IF EXISTS "groups_delete"         ON groups;
DROP POLICY IF EXISTS "group_members_select"  ON group_members;
DROP POLICY IF EXISTS "group_members_insert"  ON group_members;
DROP POLICY IF EXISTS "group_members_delete"  ON group_members;

-- Also drop legacy wide-open policies if they exist
DROP POLICY IF EXISTS "groups_all"        ON groups;
DROP POLICY IF EXISTS "group_members_all" ON group_members;

-- ── Groups policies ─────────────────────────────────────────────
-- Any authenticated user can read all groups (needed for join-by-code lookup)
CREATE POLICY "groups_select" ON groups
  FOR SELECT USING (auth.role() = 'authenticated');

-- Any authenticated user can create a group
CREATE POLICY "groups_insert" ON groups
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Only the founder can update their group
CREATE POLICY "groups_update" ON groups
  FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Only the founder can delete their group
CREATE POLICY "groups_delete" ON groups
  FOR DELETE USING (auth.uid() = created_by);

-- ── Group members policies ──────────────────────────────────────
-- Any authenticated user can see all members (for leaderboard queries)
CREATE POLICY "group_members_select" ON group_members
  FOR SELECT USING (auth.role() = 'authenticated');

-- A user can add themselves to a group
CREATE POLICY "group_members_insert" ON group_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- A user can remove themselves from a group
CREATE POLICY "group_members_delete" ON group_members
  FOR DELETE USING (auth.uid() = user_id);
