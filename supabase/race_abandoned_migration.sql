-- ════════════════════════════════════════════════════════════════════════
--  Silks League — Abandoned races
--  Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  Admin can mark a race as abandoned (void). Every pick on it then scores 0, the
--  banker included, and the app shows "Abandoned" on the race in Picks and Results.
--
--  What this adds
--    races.is_abandoned / festival_races.is_abandoned   true once the race is abandoned
--    races.abandoned_at / festival_races.abandoned_at   when Admin did it
--
--  Nothing here changes existing rows: every race that exists today gets
--  is_abandoned = false. No scoring formula, trigger or policy changes. Admin
--  already has write access to both tables (it writes runner_count_at_lock), and
--  every signed-in player can already read them, so no new policy is needed.
--  The score rows (all 0) and the day's bonuses are written by Admin, not here.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS is_abandoned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS abandoned_at timestamptz;

ALTER TABLE festival_races
  ADD COLUMN IF NOT EXISTS is_abandoned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS abandoned_at timestamptz;

-- ── Check (read-only): expect 2 rows, each with the two columns ─────────
-- SELECT table_name, column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name IN ('races', 'festival_races')
--    AND column_name IN ('is_abandoned', 'abandoned_at')
--  ORDER BY table_name, column_name;
--   → 4 rows: abandoned_at and is_abandoned for each table.

-- ── To undo (only if nothing has been abandoned yet) ────────────────────
--    ALTER TABLE races          DROP COLUMN IF EXISTS is_abandoned, DROP COLUMN IF EXISTS abandoned_at;
--    ALTER TABLE festival_races DROP COLUMN IF EXISTS is_abandoned, DROP COLUMN IF EXISTS abandoned_at;
