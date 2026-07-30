-- ════════════════════════════════════════════════════════════════
--  Silks League — Fix results/festival_results position check
--  Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--
--  Both results tables have a pre-existing CHECK constraint limiting
--  position to 1-3, from before the token scoring system added an
--  optional 4th-place capture (needed for each-way scoring in 16+
--  runner fields). Without this fix, ANY results submission for a
--  race with a 4th place selected fails outright — Postgres rejects
--  the whole multi-row insert, not just the 4th row.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE results DROP CONSTRAINT IF EXISTS results_position_check;
ALTER TABLE results ADD CONSTRAINT results_position_check CHECK (position BETWEEN 1 AND 4);

ALTER TABLE festival_results DROP CONSTRAINT IF EXISTS festival_results_position_check;
ALTER TABLE festival_results ADD CONSTRAINT festival_results_position_check CHECK (position BETWEEN 1 AND 4);
