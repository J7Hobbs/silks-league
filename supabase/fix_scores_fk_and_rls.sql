-- ════════════════════════════════════════════════════════════════
--  Silks League — Fix scores FK + profiles RLS
--  Run once in the Supabase SQL Editor
--
--  WHY:
--  PostgREST (the Supabase API layer) uses foreign key constraints to
--  resolve embedded/joined selects like profiles(username).
--  If scores.user_id references auth.users instead of profiles, the
--  inline join cannot be resolved and the query silently returns null
--  for the profiles embed — causing "Player" for all leaderboard names.
--
--  This migration:
--  1. Re-points scores.user_id → profiles(id) so PostgREST can resolve
--     the inline join.  profiles.id == auth.users.id (same UUIDs), so
--     this is functionally equivalent.
--  2. Ensures the "Anyone can view profiles" RLS policy exists so
--     authenticated users can read other players' usernames.
-- ════════════════════════════════════════════════════════════════


-- ── PART 1: Re-point scores.user_id FK to profiles(id) ───────────

DO $$
DECLARE
  r record;
BEGIN
  -- Drop any existing FK constraints on scores.user_id
  FOR r IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name   = 'scores'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'user_id'
  LOOP
    EXECUTE 'ALTER TABLE public.scores DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    RAISE NOTICE 'Dropped FK: %', r.constraint_name;
  END LOOP;
END $$;

-- Add FK directly to profiles (enables PostgREST inline join)
ALTER TABLE public.scores
  ADD CONSTRAINT scores_user_id_profiles_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.profiles(id)
  ON DELETE CASCADE;


-- ── PART 2: Ensure profiles RLS allows all authenticated reads ────

-- Drop any conflicting restrictive policies
DROP POLICY IF EXISTS "Users can view own profile"       ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile"       ON public.profiles;
DROP POLICY IF EXISTS "Allow individual read access"     ON public.profiles;

-- Ensure the open read policy exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename  = 'profiles'
      AND schemaname = 'public'
      AND policyname = 'Anyone can view profiles'
  ) THEN
    CREATE POLICY "Anyone can view profiles"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (true);
    RAISE NOTICE 'Created "Anyone can view profiles" policy';
  ELSE
    RAISE NOTICE '"Anyone can view profiles" policy already exists — no change needed';
  END IF;
END $$;
