-- ════════════════════════════════════════════════════════════════════════
--  Silks League — agent watchdog: "already sent" table
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  What this adds
--    agent_watchdog_log   one row per watchdog alert already sent to the admins, so the same alert is never sent twice.
--                         alert_key looks like 'racecard:2026-11-14', 'morning:2026-11-14', 'result:<race id>',
--                         'approval:<draft id>'. The watchdog claims the key (insert) BEFORE it pushes; if the push fails
--                         it deletes the claim so the next 10-minute run tries again.
--
--  Who can do what
--    Only the agent-watchdog Edge Function (service role, which bypasses RLS) reads and writes it.
--    RLS is on with no policies, so players and admins in the app cannot see or change it.
--
--  Purely additive. Nothing existing is changed. Safe to run twice.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_watchdog_log (
  alert_key  text PRIMARY KEY,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  summary    text
);

ALTER TABLE agent_watchdog_log ENABLE ROW LEVEL SECURITY;

-- Checks (read-only):
--   select to_regclass('public.agent_watchdog_log');                                   -- expect the table name
--   select count(*) from pg_policies where tablename = 'agent_watchdog_log';           -- expect 0
--
-- To undo:   DROP TABLE IF EXISTS agent_watchdog_log;
