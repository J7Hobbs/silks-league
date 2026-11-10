-- ════════════════════════════════════════════════════════════════════════
--  Silks League — race-day agent foundations
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  What this adds
--    1. agent_drafts   what the agent has collected and needs you to review: a racecard,
--                      a morning check (non-runners, jockey changes, inspections) or results.
--    2. agent_log      every action taken automatically (or by an admin on a draft),
--                      shown as "Agent activity" in Admin.
--    3. owner_silks    the owner silks library, keyed by Racing Post owner ID, so a new
--                      runner for a known owner gets its silks without anyone picking them.
--    4. runners.owner_id / owner_name and festival_runners.owner_id / owner_name.
--
--  Who can do what (RLS)
--    agent_drafts  admins read and update (approve / reject). Rows are CREATED only by
--                  the agent-api Edge Function, which uses the service-role key and so
--                  bypasses RLS. Nobody else, players included, can see any of this.
--    agent_log     admins read and add rows (so Admin can log "racecard approved",
--                  "race replaced"). The Edge Function writes the agent's own rows.
--    owner_silks   admins read, add and change rows. Players do not read it: the silks
--                  a player sees are the ones copied onto the runner.
--
--  Purely additive. Nothing existing is changed, scoring is untouched, and the app that
--  is live today keeps working. Safe to run before the new code is deployed, and safe
--  to run twice.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. Agent drafts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('racecard', 'morning_check', 'results')),

  -- Which race day. A Saturday that has no race week yet has only race_date (the draft's
  -- payload carries the week to create); a linked Saturday is its festival day.
  race_date        date,
  race_day_kind    text CHECK (race_day_kind IN ('week', 'festival')),
  race_week_id     uuid REFERENCES race_weeks(id)    ON DELETE SET NULL,
  festival_day_id  uuid REFERENCES festival_days(id) ON DELETE SET NULL,

  payload          jsonb NOT NULL,                       -- exactly what the agent sent
  flags            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- what needs a human look: [{ type, severity, message, ... }]

  -- pending -> approved (you pressed approve) -> applied (changes made); or rejected.
  -- superseded: a newer draft for the same race day replaced this one before it was reviewed.
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'superseded')),

  run_id           text,                                 -- the agent's id for this submission, so a retry is not a duplicate
  note             text,                                 -- why it was rejected, or what went wrong applying it
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at       timestamptz
);

-- A retry of the same submission is recognised, not stored twice.
CREATE UNIQUE INDEX IF NOT EXISTS agent_drafts_run_uidx ON agent_drafts (kind, run_id) WHERE run_id IS NOT NULL;
-- "What is waiting for me?" and "drafts for this race day".
CREATE INDEX IF NOT EXISTS agent_drafts_pending_idx ON agent_drafts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_drafts_day_idx     ON agent_drafts (kind, race_date);

ALTER TABLE agent_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_drafts_admin_select" ON agent_drafts;
DROP POLICY IF EXISTS "agent_drafts_admin_update" ON agent_drafts;
DROP POLICY IF EXISTS "agent_drafts_admin_delete" ON agent_drafts;

CREATE POLICY "agent_drafts_admin_select" ON agent_drafts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "agent_drafts_admin_update" ON agent_drafts
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "agent_drafts_admin_delete" ON agent_drafts
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ── 2. Agent activity log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  actor            text NOT NULL DEFAULT 'agent' CHECK (actor IN ('agent', 'admin')),
  action           text NOT NULL,        -- result_entered, non_runner, jockey_change, draft_received, draft_applied,
                                         -- draft_rejected, owners_backfilled, race_replaced, error ...
  summary          text NOT NULL,        -- the sentence Admin shows: "Race 3 result entered (weighed in)"
  ok               boolean NOT NULL DEFAULT true,
  detail           jsonb,                -- the facts behind it (sources, horses, picks moved ...)
  race_date        date,
  race_week_id     uuid REFERENCES race_weeks(id)    ON DELETE SET NULL,
  festival_day_id  uuid REFERENCES festival_days(id) ON DELETE SET NULL,
  draft_id         uuid REFERENCES agent_drafts(id)  ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS agent_log_created_idx ON agent_log (created_at DESC);

ALTER TABLE agent_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_log_admin_select" ON agent_log;
DROP POLICY IF EXISTS "agent_log_admin_insert" ON agent_log;

CREATE POLICY "agent_log_admin_select" ON agent_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "agent_log_admin_insert" ON agent_log
  FOR INSERT TO authenticated
  WITH CHECK (actor = 'admin' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ── 3. Owner silks library ───────────────────────────────────────────────
-- One row per owner, keyed by the Racing Post owner ID. The colours use the same values the
-- Admin silk picker saves on a runner (runners.silk_colour / silk_colour_secondary / silk_pattern).
CREATE TABLE IF NOT EXISTS owner_silks (
  owner_id               text PRIMARY KEY,
  owner_name             text,
  silk_colour            text,
  silk_colour_secondary  text,
  silk_pattern           text,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE owner_silks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner_silks_admin_select" ON owner_silks;
DROP POLICY IF EXISTS "owner_silks_admin_insert" ON owner_silks;
DROP POLICY IF EXISTS "owner_silks_admin_update" ON owner_silks;

CREATE POLICY "owner_silks_admin_select" ON owner_silks
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "owner_silks_admin_insert" ON owner_silks
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "owner_silks_admin_update" ON owner_silks
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ── 4. Owner on each runner ──────────────────────────────────────────────
ALTER TABLE runners
  ADD COLUMN IF NOT EXISTS owner_id   text,
  ADD COLUMN IF NOT EXISTS owner_name text;
ALTER TABLE festival_runners
  ADD COLUMN IF NOT EXISTS owner_id   text,
  ADD COLUMN IF NOT EXISTS owner_name text;

CREATE INDEX IF NOT EXISTS runners_owner_idx          ON runners (owner_id)          WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS festival_runners_owner_idx ON festival_runners (owner_id) WHERE owner_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════
--  Checks to run afterwards (read-only)
-- ════════════════════════════════════════════════════════════════════════
--  -- the three new tables exist: expect 3 rows
--  select table_name from information_schema.tables
--   where table_schema = 'public' and table_name in ('agent_drafts', 'agent_log', 'owner_silks') order by 1;
--
--  -- the owner columns exist: expect 4 rows
--  select table_name, column_name from information_schema.columns
--   where table_schema = 'public' and table_name in ('runners', 'festival_runners') and column_name in ('owner_id', 'owner_name') order by 1, 2;
--
--  -- the policies exist: expect 8 rows (3 drafts, 2 log, 3 owner_silks)
--  select tablename, policyname, cmd from pg_policies
--   where tablename in ('agent_drafts', 'agent_log', 'owner_silks') order by 1, 2;


-- ── To undo (nothing else depends on these) ──────────────────────────────
--    DROP TABLE IF EXISTS agent_log;
--    DROP TABLE IF EXISTS agent_drafts;
--    DROP TABLE IF EXISTS owner_silks;
--    DROP INDEX IF EXISTS runners_owner_idx;
--    DROP INDEX IF EXISTS festival_runners_owner_idx;
--    ALTER TABLE runners          DROP COLUMN IF EXISTS owner_id, DROP COLUMN IF EXISTS owner_name;
--    ALTER TABLE festival_runners DROP COLUMN IF EXISTS owner_id, DROP COLUMN IF EXISTS owner_name;
