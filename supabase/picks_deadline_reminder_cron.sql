-- ════════════════════════════════════════════════════════════════
--  Silks League — Picks Deadline Reminder: Scheduling
--  Run in the Supabase SQL Editor, AFTER notifications_migration.sql
--  (safe to re-run: it replaces the existing job).
--
--  Schedules picks-deadline-reminder to run EVERY 5 MINUTES via pg_cron + pg_net.
--  Each run sends, once per race day:
--    - the "Picks closing soon" reminder, from 2 hours before the lock
--    - the "Last call", from 30 minutes before the lock
--  Running every 5 minutes (it used to be every 20) is what makes "30 minutes
--  before" accurate.
--
--  BEFORE RUNNING: replace YOUR_SERVICE_ROLE_KEY below (keep the word Bearer and
--  the space) with the project's service_role key:
--    Supabase Dashboard -> project wfytwcwletznzyayjkrv -> Project Settings (cog,
--    bottom left) -> API Keys -> the "Legacy anon, service_role API keys" tab ->
--    service_role -> Reveal -> Copy. It is a long string starting "eyJ".
--  Use that legacy service_role key, not the anon key and not an "sb_secret_" key:
--  the gateway checks it (JWT verification stays on) and the function checks x-cron-secret.
--  Never share it or commit it to the repo: it can read and change everything.
--  ALSO replace YOUR_CRON_SECRET with the value of the CRON_SECRET secret (at least 16 characters; set it first with
--    npx supabase@latest secrets set CRON_SECRET=<long random string> --project-ref wfytwcwletznzyayjkrv).
--    The function checks that header itself; the legacy JWT in Authorization only gets the request past the gateway.
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

-- 3. Schedule the run — every 5 minutes, any time of day.
SELECT cron.schedule(
  'picks-deadline-reminder',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wfytwcwletznzyayjkrv.supabase.co/functions/v1/picks-deadline-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'x-cron-secret', 'YOUR_CRON_SECRET'
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
