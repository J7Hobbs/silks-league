-- ════════════════════════════════════════════════════════════════
--  Silks League — Festival Picks Withdrawal Migration
--  Run once in the Supabase SQL Editor
--
--  Adds the same replacement-tracking columns to festival_picks
--  that the Saturday League picks table already has, so festival
--  runners can be withdrawn and picks auto-replaced with the
--  race favourite.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE festival_picks
  ADD COLUMN IF NOT EXISTS was_replaced       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_runner_id UUID    REFERENCES festival_runners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replacement_reason TEXT;
