-- ════════════════════════════════════════════════════════════════
--  Silks League — Reminder Log Migration
--  Run once in the Supabase SQL Editor
--
--  Tracks which race_week / festival_day picks-deadline reminders
--  have already been sent, so the picks-deadline-reminder Edge
--  Function (run on a schedule) doesn't re-notify users every time
--  it runs within the same reminder window.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reminder_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_week_id     UUID REFERENCES race_weeks(id),
  festival_day_id  UUID REFERENCES festival_days(id),
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reminder_log_exactly_one_ref CHECK (
    (race_week_id IS NOT NULL AND festival_day_id IS NULL) OR
    (race_week_id IS NULL AND festival_day_id IS NOT NULL)
  )
);

-- At most one log row per race_week / festival_day — a second attempt to
-- insert for the same deadline fails instead of silently double-sending.
CREATE UNIQUE INDEX IF NOT EXISTS reminder_log_race_week_uidx
  ON reminder_log(race_week_id) WHERE race_week_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reminder_log_festival_day_uidx
  ON reminder_log(festival_day_id) WHERE festival_day_id IS NOT NULL;

ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
-- Written only by the picks-deadline-reminder Edge Function via the
-- service-role key, which bypasses RLS — no policies needed for anon/
-- authenticated roles since nothing client-side reads or writes this table.
