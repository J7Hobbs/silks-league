-- ════════════════════════════════════════════════════════════════════════
--  Silks League — app settings (the "Automatic results" switch)
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  What this adds
--    app_settings   small key/value settings. The first row, 'agent_auto_apply', is the
--                   Admin switch for the race-day agent's automatic mode. It replaces the
--                   AGENT_AUTO_APPLY secret, which agent-api now only uses if this row is missing.
--
--  Who can do what (RLS)
--    Admins can read and update rows. Nobody else can see or change them, players included.
--    agent-api reads it with the service-role key, which bypasses RLS.
--
--  The row is created OFF. If you had set AGENT_AUTO_APPLY=true as a secret, running this
--  turns automatic mode OFF until you flip the switch in Admin (the secret is only a fallback
--  for a missing row). Purely additive, nothing existing is changed, safe to run twice
--  (a second run does not reset the switch).
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_settings_admin_select" ON app_settings;
DROP POLICY IF EXISTS "app_settings_admin_update" ON app_settings;

CREATE POLICY "app_settings_admin_select" ON app_settings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "app_settings_admin_update" ON app_settings
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- The switch, OFF. Running this again leaves it as it is.
INSERT INTO app_settings (key, value) VALUES ('agent_auto_apply', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- ── Check (run after; expect 1 row, value false, and 2 policies) ──────────
--  select key, value from app_settings;
--  select policyname, cmd from pg_policies where tablename = 'app_settings';
