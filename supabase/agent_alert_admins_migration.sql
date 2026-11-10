-- ════════════════════════════════════════════════════════════════════════
--  Silks League — who gets the agent's admin alerts
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  What this adds
--    One row in app_settings: 'agent_alert_admins', a JSON array of user ids. The
--    "Silks League agent: …" pushes (racecard ready, results to approve, items to check,
--    automatic actions) go only to the admins listed here. Player pushes are not affected.
--    It is seeded with the one admin whose username is not 'obarratt' (that is you).
--    You can change the list any time from Admin → Today → "Alerts go to".
--
--  Needs the app_settings table (app_settings_migration.sql, already run). Purely
--  additive; safe to run twice (a second run does not change the list).
--
--  It STOPS with a message instead of guessing if it cannot find exactly one such
--  admin, so you never end up with an empty or wrong list without knowing.
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  found_ids jsonb;
  n integer;
BEGIN
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb), COUNT(*)
    INTO found_ids, n
    FROM profiles
   WHERE is_admin = true
     AND lower(COALESCE(username, '')) <> 'obarratt';

  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 admin whose username is not obarratt, found %. Nothing was inserted. Check: select id, username from profiles where is_admin;', n;
  END IF;

  INSERT INTO app_settings (key, value)
  VALUES ('agent_alert_admins', found_ids)
  ON CONFLICT (key) DO NOTHING;
END $$;


-- ── Check (run after; expect 1 row whose value is a one-item array, and that id is yours) ──
--  select a.value, p.username
--    from app_settings a
--    left join profiles p on a.value ? p.id::text
--   where a.key = 'agent_alert_admins';
