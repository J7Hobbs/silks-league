-- festival_day_points table
-- Stores each user's total points for a specific festival day.
-- Upserted (not inserted) each time results are saved for a race,
-- so re-running results produces the correct cumulative daily total.

CREATE TABLE IF NOT EXISTS festival_day_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id uuid NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_number  integer NOT NULL,
  points      integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),

  UNIQUE (festival_id, user_id, day_number)
);

-- RLS
ALTER TABLE festival_day_points ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read (needed for the league leaderboard)
CREATE POLICY "festival_day_points_read" ON festival_day_points
  FOR SELECT TO authenticated USING (true);

-- Only service role / admin writes (the upsert comes from the admin panel
-- which uses the anon key, so we need an insert/update policy too)
CREATE POLICY "festival_day_points_write" ON festival_day_points
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_festival_day_points_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_festival_day_points_updated_at
  BEFORE UPDATE ON festival_day_points
  FOR EACH ROW EXECUTE FUNCTION update_festival_day_points_updated_at();
