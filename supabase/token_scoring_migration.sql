-- ════════════════════════════════════════════════════════════════
--  Silks League — Token-Based Scoring Migration
--  Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--
--  Adds support for the new 2-tokens-per-race Win / Each-way scoring
--  system alongside the existing fixed-tier system. Existing rows are
--  untouched — bet_type is NULL on every historical pick/score, and
--  the app treats NULL bet_type as "score with the legacy formula".
--  runner_count_at_lock is populated by the admin's "Lock Picks" step
--  (or, as a safety net, at results-entry time) and drives each-way
--  eligibility + place terms at scoring time.
-- ════════════════════════════════════════════════════════════════

-- ── picks / festival_picks: which bet type the player chose ───────
ALTER TABLE picks
  ADD COLUMN IF NOT EXISTS bet_type TEXT CHECK (bet_type IN ('win', 'each_way'));

ALTER TABLE festival_picks
  ADD COLUMN IF NOT EXISTS bet_type TEXT CHECK (bet_type IN ('win', 'each_way'));

-- ── scores / festival_scores: token breakdown ──────────────────────
-- base_points/bonus_points remain for legacy rows; total_points keeps
-- working as the single aggregate column for both systems.
ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS bet_type          TEXT,
  ADD COLUMN IF NOT EXISTS win_token_points  INTEGER,
  ADD COLUMN IF NOT EXISTS place_token_points INTEGER;

ALTER TABLE festival_scores
  ADD COLUMN IF NOT EXISTS bet_type          TEXT,
  ADD COLUMN IF NOT EXISTS win_token_points  INTEGER,
  ADD COLUMN IF NOT EXISTS place_token_points INTEGER;

-- ── races / festival_races: field size snapshot at picks lock ─────
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS runner_count_at_lock INTEGER;

ALTER TABLE festival_races
  ADD COLUMN IF NOT EXISTS runner_count_at_lock INTEGER;
