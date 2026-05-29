-- ════════════════════════════════════════════════════════════════
--  Silks League — Withdrawal Migration
--  Run once in the Supabase SQL Editor
--
--  1. Adds is_withdrawn to runners so horses can be marked WD
--  2. Adds score_note to scores so withdrawal avg scores are
--     labelled clearly and excluded from future averages
-- ════════════════════════════════════════════════════════════════

ALTER TABLE runners ADD COLUMN IF NOT EXISTS is_withdrawn BOOLEAN DEFAULT false;
ALTER TABLE scores  ADD COLUMN IF NOT EXISTS score_note   TEXT;
