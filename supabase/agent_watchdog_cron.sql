-- ════════════════════════════════════════════════════════════════
--  Silks League — Agent watchdog: Scheduling
--  Run in the Supabase SQL Editor, AFTER agent_watchdog_migration.sql and AFTER the agent-watchdog function is deployed
--  (safe to re-run: it replaces the existing job).
--
--  Schedules agent-watchdog to run EVERY 10 MINUTES via pg_cron + pg_net. The function itself stays silent before 07:00 and
--  from 21:00 UK, so it is fine for the schedule to run all day.
--
--  BEFORE RUNNING: replace YOUR_SERVICE_ROLE_KEY below (keep the word Bearer and the space) with the project's service_role key:
--    Supabase Dashboard -> project wfytwcwletznzyayjkrv -> Project Settings (cog, bottom left) -> API Keys ->
--    the "Legacy anon, service_role API keys" tab -> service_role -> Reveal -> Copy. It is a long string starting "eyJ".
--  Use that legacy service_role key, not the anon key and not an "sb_secret_" key: the function checks the key it receives
--  against the one it runs with. Never share it or commit it to the repo: it can read and change everything.
-- ════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Remove any previous version of this job before (re-)scheduling.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'agent-watchdog';

SELECT cron.schedule(
  'agent-watchdog',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wfytwcwletznzyayjkrv.supabase.co/functions/v1/agent-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Confirm it's scheduled:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'agent-watchdog';

-- Recent runs (a 200 status means it ran; what it sent is in Admin > Agent activity, as "watchdog_alert"):
-- SELECT * FROM cron.job_run_details
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'agent-watchdog')
-- ORDER BY start_time DESC LIMIT 10;

-- Alerts already sent (to re-send one, delete its row):
-- SELECT * FROM agent_watchdog_log ORDER BY sent_at DESC;
