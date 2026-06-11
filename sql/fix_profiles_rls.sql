-- Fix: Allow all authenticated users to read all profiles
-- This is required for leaderboards to resolve usernames for other players.
-- Without this, Supabase RLS may restrict profile reads to own-row-only,
-- causing all other players to display as 'Player'.

-- Drop any existing restrictive read policy on profiles
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Allow individual read access" ON profiles;

-- Allow any authenticated user to read all profiles (usernames, display names)
CREATE POLICY "Authenticated users can read all profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Keep the existing write policies (users can only update their own row)
-- These should already exist — do not drop them.
-- Example of what they typically look like:
-- CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
-- CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
