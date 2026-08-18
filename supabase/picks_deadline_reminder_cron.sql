-- ════════════════════════════════════════════════════════════════
--  Silks League — Picks Deadline Reminder: Scheduling
--  Run once in the Supabase SQL Editor, AFTER reminder_log_migration.sql
--
--  Schedules picks-deadline-reminder to run every 20 minutes via
--  pg_cron + pg_net (Postgres-native scheduled HTTP calls — no
--  external scheduler needed).
--
--  BEFORE RUNNING: replace YOUR_SERVICE_ROLE_KEY below with the real
--  value from Project Settings → API → service_role key (NOT the anon
--  key). This lets the cron job authenticate to both this function's
--  own JWT check and, internally, to send-notification.
-- ════════════════════════════════════════════════════════════════

-- 1. Enable required extensions (safe to re-run if already enabled).
--    If either of these errors with a permissions message, enable them
--    instead via Dashboard → Database → Extensions (search "pg_cron"
--    and "pg_net", toggle each on), then re-run from step 2.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- 2. Remove any previous version of this job before (re-)scheduling.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'picks-deadline-reminder';

-- 3. Schedule the run — every 20 minutes, any time of day.
SELECT cron.schedule(
  'picks-deadline-reminder',
  '*/20 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wfytwcwletznzyayjkrv.supabase.co/functions/v1/picks-deadline-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- 4. Confirm it's scheduled:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'picks-deadline-reminder';

-- 5. To check recent run history/results later:
-- SELECT * FROM cron.job_run_details
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'picks-deadline-reminder')
-- ORDER BY start_time DESC LIMIT 10;
