-- ════════════════════════════════════════════════════════════════
--  Silks League — Odds Migration
--  Run once in the Supabase SQL Editor
--
--  Adds odds_fractional (e.g. "7/1") and odds_decimal (e.g. 8.00)
--  to the runners table so opening odds can be stored per runner.
--
--  After running this:
--  - Admin can enter opening odds when adding/editing runners
--  - The results form no longer requires SP input — it reads
--    odds_decimal from the runner record automatically
-- ════════════════════════════════════════════════════════════════

ALTER TABLE runners
  ADD COLUMN IF NOT EXISTS odds_fractional TEXT,
  ADD COLUMN IF NOT EXISTS odds_decimal    DECIMAL(10,2);
