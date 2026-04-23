-- ════════════════════════════════════════════════════════════════
--  Silks League — Fix Signup: Trigger + RLS Policies
--  Run once in the Supabase SQL Editor
--
--  HOW PROFILE CREATION WORKS AFTER THIS:
--  1. User signs up via supabase.auth.signUp() in the frontend
--  2. Supabase creates a row in auth.users
--  3. The trigger on_auth_user_created fires automatically
--  4. The trigger calls handle_new_user() which inserts a row
--     into public.profiles with id, full_name, is_admin=false,
--     has_onboarded=false
--  5. The frontend never manually inserts into profiles — the
--     trigger handles it 100% of the time, even if the frontend
--     crashes or the user closes the tab
-- ════════════════════════════════════════════════════════════════


-- ── PART 1: Database trigger ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, is_admin, has_onboarded)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    false,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── PART 2: RLS Policies ─────────────────────────────────────────

-- Drop all existing policies cleanly first
DROP POLICY IF EXISTS "Users can view own profile"      ON profiles;
DROP POLICY IF EXISTS "Users can update own profile"    ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile"    ON profiles;
DROP POLICY IF EXISTS "Allow profile creation on signup" ON profiles;
DROP POLICY IF EXISTS "Anyone can view profiles"        ON profiles;
DROP POLICY IF EXISTS "Service role can insert profiles" ON profiles;
DROP POLICY IF EXISTS "profiles_select"                 ON profiles;
DROP POLICY IF EXISTS "profiles_insert"                 ON profiles;
DROP POLICY IF EXISTS "profiles_update"                 ON profiles;

-- Any authenticated user can read all profiles (needed for leaderboards, name lookups)
CREATE POLICY "Anyone can view profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can only update their own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Only the service role (i.e. the DB trigger) can insert profiles
-- The trigger runs as SECURITY DEFINER so it bypasses RLS entirely —
-- this policy is a safety net for any direct service_role inserts
CREATE POLICY "Service role can insert profiles"
  ON profiles FOR INSERT
  TO service_role
  WITH CHECK (true);
