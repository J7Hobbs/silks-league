-- ─────────────────────────────────────────────────────────────────────────────
-- Silks League — welcome flow + invite links
-- Run in the Supabase SQL editor for project wfytwcwletznzyayjkrv ("Dashboard"),
-- in this order: STEP 0, PART A, PART B, VERIFY.
--
--   PART A  profiles.onboarded_at: null = this player still has to see the welcome
--           flow. Everyone already in the database is marked as done (once only).
--   PART B  check_invite_code(): lets the logged-out /join page check a group code
--           and show the group's name. Returns the name only.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 0 — read-only. Before the change.
-- Query 1: how many profiles have done the old welcome (just for your information).
-- Query 2: should return NO ROWS now (the column doesn't exist yet).
-- ═════════════════════════════════════════════════════════════════════════════
SELECT has_onboarded, count(*) FROM public.profiles GROUP BY has_onboarded ORDER BY has_onboarded;

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'onboarded_at';


-- ═════════════════════════════════════════════════════════════════════════════
-- PART A — the column, and mark everyone who is already here as onboarded.
-- The backfill only runs when the column is first added, so running this again
-- later will NOT mark new sign-ups as onboarded.
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'onboarded_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN onboarded_at timestamptz;
    UPDATE public.profiles SET onboarded_at = now();
  END IF;
END
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- PART B — check an invite code without signing in.
-- Returns the group's name, or NULL when no group has that code. The groups table
-- itself stays readable by signed-in users only.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_invite_code(p_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.name FROM public.groups g WHERE g.invite_code = lower(btrim(p_code, E' \t\r\n')) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.check_invite_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_invite_code(text) TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY — read-only.
-- Query 1: the column now exists (1 row, data_type timestamp with time zone).
-- Query 2: profiles still waiting for the welcome flow. Expect 0 right after the
--          backfill (it rises as new people sign up).
-- Query 3: anon_can_run = true.
-- ═════════════════════════════════════════════════════════════════════════════
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'onboarded_at';

SELECT count(*) AS still_to_onboard FROM public.profiles WHERE onboarded_at IS NULL;

SELECT has_function_privilege('anon', 'public.check_invite_code(text)', 'EXECUTE') AS anon_can_run;
