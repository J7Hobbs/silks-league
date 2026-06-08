-- ─────────────────────────────────────────────────────────────────────────────
-- Silks League — Festival Tournament Migration
-- Run this in the Supabase SQL editor for project wfytwcwletznzyayjkrv
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Part 1: Monthly seasons display name ─────────────────────────────────────
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS display_name TEXT;

-- ── Part 2: Mid-season joining points ────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS season_starting_points INTEGER DEFAULT 0;

-- ── Part 3: Festival tournament tables ───────────────────────────────────────

-- Festivals (e.g. "Cheltenham Festival 2025")
CREATE TABLE IF NOT EXISTS festivals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id     UUID REFERENCES seasons(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,                        -- internal name
  display_name  TEXT,                                 -- shown to players
  banner_colour TEXT DEFAULT '#1a6b3a',              -- hex for banner bg
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual days within a festival (e.g. "Day 1 — Tuesday")
CREATE TABLE IF NOT EXISTS festival_days (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id   UUID NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  day_number    INTEGER NOT NULL,                     -- 1, 2, 3 …
  race_date     DATE NOT NULL,
  label         TEXT,                                 -- e.g. "Day 1 — Tuesday"
  picks_deadline TIMESTAMPTZ,                         -- deadline for that day's picks
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(festival_id, day_number)
);

-- Races within a festival day (up to 10 per day)
CREATE TABLE IF NOT EXISTS festival_races (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_day_id UUID NOT NULL REFERENCES festival_days(id) ON DELETE CASCADE,
  race_number     INTEGER NOT NULL,
  race_time       TEXT,
  venue           TEXT,
  race_name       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(festival_day_id, race_number)
);

-- Runners for festival races
CREATE TABLE IF NOT EXISTS festival_runners (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_race_id UUID NOT NULL REFERENCES festival_races(id) ON DELETE CASCADE,
  horse_name       TEXT NOT NULL,
  horse_number     INTEGER,
  silk_colour      TEXT,
  odds_fractional  TEXT,
  odds_decimal     NUMERIC(8,2),
  is_withdrawn     BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Results for festival races
CREATE TABLE IF NOT EXISTS festival_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_race_id UUID NOT NULL REFERENCES festival_races(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  horse_name       TEXT NOT NULL,
  starting_price_display TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Festival entries — who has joined a festival
CREATE TABLE IF NOT EXISTS festival_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_id   UUID NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entry_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
  starting_points INTEGER NOT NULL DEFAULT 0,         -- points awarded for mid-festival joining
  UNIQUE(festival_id, user_id)
);

-- Festival picks — one per race per user
CREATE TABLE IF NOT EXISTS festival_picks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_race_id UUID NOT NULL REFERENCES festival_races(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  runner_id        UUID REFERENCES festival_runners(id) ON DELETE SET NULL,
  picked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(festival_race_id, user_id)
);

-- Festival scores — one per race per user (written by admin when entering results)
CREATE TABLE IF NOT EXISTS festival_scores (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_race_id UUID NOT NULL REFERENCES festival_races(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  base_points      INTEGER NOT NULL DEFAULT 0,
  bonus_points     INTEGER NOT NULL DEFAULT 0,
  total_points     INTEGER NOT NULL DEFAULT 0,
  position_achieved INTEGER,
  score_note       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(festival_race_id, user_id)
);

-- ── RLS Policies ─────────────────────────────────────────────────────────────

-- Enable RLS on all festival tables
ALTER TABLE festivals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_days     ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_races    ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_runners  ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_picks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE festival_scores   ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can READ festival catalogue data
CREATE POLICY "Auth users read festivals"
  ON festivals FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth users read festival_days"
  ON festival_days FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth users read festival_races"
  ON festival_races FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth users read festival_runners"
  ON festival_runners FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth users read festival_results"
  ON festival_results FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth users read festival_scores"
  ON festival_scores FOR SELECT TO authenticated USING (true);

-- Users can read their own entries
CREATE POLICY "Users read own festival_entries"
  ON festival_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Users can INSERT their own entry (join a festival)
CREATE POLICY "Users join festivals"
  ON festival_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can read their own picks
CREATE POLICY "Users read own festival_picks"
  ON festival_picks FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Users can upsert their own picks (before deadline)
CREATE POLICY "Users insert own festival_picks"
  ON festival_picks FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own festival_picks"
  ON festival_picks FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- Admins can do everything (checked via profiles.is_admin)
CREATE POLICY "Admins full access festivals"
  ON festivals FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins full access festival_days"
  ON festival_days FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins full access festival_races"
  ON festival_races FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins full access festival_runners"
  ON festival_runners FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins full access festival_results"
  ON festival_results FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins full access festival_entries"
  ON festival_entries FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins full access festival_picks"
  ON festival_picks FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins full access festival_scores"
  ON festival_scores FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
