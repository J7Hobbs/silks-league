-- ════════════════════════════════════════════════════════════════════════
--  Silks League — notifications overhaul (reminder_log kinds)
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  Why
--    reminder_log records "this race day has already had its reminder", with one
--    row per race week / festival day. The overhaul needs three notices per race
--    day that must each go out once: the 2-hour reminder, the 30-minute "last
--    call", and the end-of-day message. So each row now says which notice it is.
--
--  What this changes
--    1. reminder_log.kind  'two_hour' (default) | 'last_call' | 'end_of_day'
--       Every existing row becomes 'two_hour', which is what it already was.
--    2. The one-row-per-day unique indexes become one row per day PER KIND, so a
--       second attempt at the same notice still fails instead of double-sending.
--    3. Admins (profiles.is_admin) may read, add and remove rows. The end-of-day
--       message is sent from the Admin screen the moment a day's last result is
--       saved, and it claims its row first so it can only go once even if two
--       admins save at the same time. If the send fails the row is removed again
--       so it can be retried. The scheduled reminders still write with the
--       service-role key, which bypasses RLS, exactly as now.
--
--  Safe to run before the new code is deployed: the reminder function that is live
--  today inserts rows without a kind, which now means 'two_hour', so it keeps
--  working. Nothing else is touched. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. The kind of notice ────────────────────────────────────────────────
ALTER TABLE reminder_log
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'two_hour';

ALTER TABLE reminder_log DROP CONSTRAINT IF EXISTS reminder_log_kind_check;
ALTER TABLE reminder_log
  ADD CONSTRAINT reminder_log_kind_check CHECK (kind IN ('two_hour', 'last_call', 'end_of_day'));


-- ── 2. One row per race day per kind ─────────────────────────────────────
DROP INDEX IF EXISTS reminder_log_race_week_uidx;
DROP INDEX IF EXISTS reminder_log_festival_day_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS reminder_log_race_week_kind_uidx
  ON reminder_log (race_week_id, kind) WHERE race_week_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reminder_log_festival_day_kind_uidx
  ON reminder_log (festival_day_id, kind) WHERE festival_day_id IS NOT NULL;


-- ── 3. Admins can claim and release the end-of-day row ───────────────────
DROP POLICY IF EXISTS "reminder_log_admin_select" ON reminder_log;
DROP POLICY IF EXISTS "reminder_log_admin_insert" ON reminder_log;
DROP POLICY IF EXISTS "reminder_log_admin_delete" ON reminder_log;

CREATE POLICY "reminder_log_admin_select" ON reminder_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "reminder_log_admin_insert" ON reminder_log
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "reminder_log_admin_delete" ON reminder_log
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ════════════════════════════════════════════════════════════════════════
--  Checks to run afterwards (read-only)
-- ════════════════════════════════════════════════════════════════════════
--  -- the column exists and old rows are 'two_hour': expect one row per kind that exists
--  select kind, count(*) from reminder_log group by kind;
--
--  -- the two new unique indexes exist (and the two old ones are gone): expect 2 rows
--  select indexname from pg_indexes
--   where tablename = 'reminder_log' and indexname like 'reminder_log_%_kind_uidx' order by indexname;
--
--  -- the three admin policies exist: expect 3 rows
--  select policyname, cmd from pg_policies where tablename = 'reminder_log' order by policyname;


-- ── To undo (only while no 'last_call' / 'end_of_day' rows exist) ────────
--    DROP POLICY IF EXISTS "reminder_log_admin_select" ON reminder_log;
--    DROP POLICY IF EXISTS "reminder_log_admin_insert" ON reminder_log;
--    DROP POLICY IF EXISTS "reminder_log_admin_delete" ON reminder_log;
--    DROP INDEX IF EXISTS reminder_log_race_week_kind_uidx;
--    DROP INDEX IF EXISTS reminder_log_festival_day_kind_uidx;
--    DELETE FROM reminder_log WHERE kind <> 'two_hour';
--    CREATE UNIQUE INDEX reminder_log_race_week_uidx    ON reminder_log (race_week_id)    WHERE race_week_id IS NOT NULL;
--    CREATE UNIQUE INDEX reminder_log_festival_day_uidx ON reminder_log (festival_day_id) WHERE festival_day_id IS NOT NULL;
--    ALTER TABLE reminder_log DROP CONSTRAINT IF EXISTS reminder_log_kind_check;
--    ALTER TABLE reminder_log DROP COLUMN IF EXISTS kind;
