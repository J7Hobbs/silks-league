-- ════════════════════════════════════════════════════════════════
--  Silks League — Picks Open Notified Migration
--  Run once in the Supabase SQL Editor
--
--  Tracks whether the "Picks are open!" notification has already been
--  sent for a given race_week / festival_day, so the admin's explicit
--  "Notify: Picks Open" button can show its sent/not-sent state and
--  guard against accidental double-sends.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE race_weeks    ADD COLUMN IF NOT EXISTS picks_open_notified_at TIMESTAMPTZ;
ALTER TABLE festival_days ADD COLUMN IF NOT EXISTS picks_open_notified_at TIMESTAMPTZ;
