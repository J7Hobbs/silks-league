-- ════════════════════════════════════════════════════════════════════════
--  Silks League — read/write policy hardening before Cheltenham
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--  Needs supabase/picks_lock_server_side_migration.sql to have been run first (it has).
--
--  One transaction. If any check fails it raises "Nothing changed: ..." and the whole thing is rolled back.
--  If you ever see an error from this script, nothing was changed.
--
--  Based on the live audit (docs/rls-audit.local.txt, 11 Nov 2026).
--
--  1. picks / festival_picks
--       Read:   your own row, OR an admin, OR the race day is locked (same lock as the triggers: picks_deadline passed,
--               12:00 UK on the race day when there is none, or is_locked). Nothing for logged-out visitors.
--               Was: any logged-in user could read every pick, any time.
--       Write:  exactly as today. picks: a player inserts, updates and deletes their own rows. festival_picks: a player
--               inserts and updates their own rows (no delete, as before). Admins everything. The lock triggers
--               still guard timing, the horse and ownership.
--  2. festival_day_points
--       Write:  admins only. Was: ANY logged-in user could write ANY row ("festival_day_points_write"), and
--               "Admin write" applied to logged-out visitors too.
--       Read:   logged-in users only. Was: "Public read" using=true let logged-out visitors read it.
--  3. scores
--       Write:  admins only. Was: "scores_insert_admin" / "scores_delete_admin" let ANY logged-in user insert and delete.
--       Read:   logged-in users (four overlapping SELECT policies become one).
--
--  Unaffected: the service role (agent-api, Edge Functions, pg_cron) bypasses RLS. Every write to scores, festival_scores
--  and festival_day_points comes from raceScoring.js, which only the Admin pages and the agent run, so no player screen
--  writes them.
--
--  Also revokes the table-level grants from the logged-out role (anon) on these four tables. RLS already gave anon
--  nothing; this is a second lock on the door.
--
--  To undo: there is no automatic undo (the old policies were the problem). The audit file lists them all.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Checks before changing anything ──────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['picks', 'festival_picks', 'festival_day_points', 'scores'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Nothing changed: table % not found (wrong project?)', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION 'Nothing changed: row level security is off on %', t;
    END IF;
  END LOOP;
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Nothing changed: is_admin() not found';
  END IF;
  IF to_regprocedure('public.picks_day_locked(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Nothing changed: picks_day_locked not found (run picks_lock_server_side_migration.sql first)';
  END IF;
END $$;


-- ── The visibility helper policies can call ──────────────────────────────
-- Returns only true/false: "is this race's day locked, so everyone's picks can be seen?". picks_day_locked itself stays
-- closed to players; this wrapper runs as its owner and is the only thing granted to logged-in users.
CREATE OR REPLACE FUNCTION public.picks_race_visible(p_kind text, p_race_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.picks_day_locked(p_kind, p_race_id) $$;

REVOKE ALL ON FUNCTION public.picks_race_visible(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picks_race_visible(text, uuid) TO authenticated;


-- ── Drop every existing policy on the four tables ────────────────────────
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename IN ('picks', 'festival_picks', 'festival_day_points', 'scores')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;


-- ── picks ────────────────────────────────────────────────────────────────
CREATE POLICY picks_select ON picks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()) OR public.picks_race_visible('week', race_id));
CREATE POLICY picks_insert_own ON picks FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY picks_update_own ON picks FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY picks_delete_own ON picks FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY picks_admin_all ON picks FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- ── festival_picks ───────────────────────────────────────────────────────
CREATE POLICY festival_picks_select ON festival_picks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()) OR public.picks_race_visible('festival', festival_race_id));
CREATE POLICY festival_picks_insert_own ON festival_picks FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY festival_picks_update_own ON festival_picks FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY festival_picks_admin_all ON festival_picks FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- ── festival_day_points ──────────────────────────────────────────────────
CREATE POLICY festival_day_points_select ON festival_day_points FOR SELECT TO authenticated
  USING (true);
CREATE POLICY festival_day_points_admin_all ON festival_day_points FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- ── scores ───────────────────────────────────────────────────────────────
CREATE POLICY scores_select ON scores FOR SELECT TO authenticated
  USING (true);
CREATE POLICY scores_admin_all ON scores FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- ── Logged-out visitors: no table access on these four at all ────────────
REVOKE ALL ON picks, festival_picks, festival_day_points, scores FROM anon;


-- ── Checks after changing (any failure undoes everything) ────────────────
DO $$
DECLARE
  t       text;
  want    text[];
  have    text[];
BEGIN
  FOR t, want IN VALUES
    ('picks',               ARRAY['picks_admin_all', 'picks_delete_own', 'picks_insert_own', 'picks_select', 'picks_update_own']),
    ('festival_picks',      ARRAY['festival_picks_admin_all', 'festival_picks_insert_own', 'festival_picks_select', 'festival_picks_update_own']),
    ('festival_day_points', ARRAY['festival_day_points_admin_all', 'festival_day_points_select']),
    ('scores',              ARRAY['scores_admin_all', 'scores_select'])
  LOOP
    SELECT coalesce(array_agg(policyname::text ORDER BY policyname), '{}') INTO have
      FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF have IS DISTINCT FROM want THEN
      RAISE EXCEPTION 'Nothing changed: % has policies % but expected %', t, have, want;
    END IF;
  END LOOP;

  -- No policy on these tables may apply to logged-out visitors, and none may be a bare "anyone logged in can write".
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename IN ('picks', 'festival_picks', 'festival_day_points', 'scores')
                AND (roles && ARRAY['public', 'anon']::name[])) THEN
    RAISE EXCEPTION 'Nothing changed: a policy still applies to logged-out visitors';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename IN ('festival_day_points', 'scores')
                AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE') AND policyname NOT LIKE '%admin_all') THEN
    RAISE EXCEPTION 'Nothing changed: a non-admin write policy is left on festival_day_points or scores';
  END IF;

  IF has_function_privilege('anon', 'public.picks_race_visible(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Nothing changed: logged-out visitors can call picks_race_visible';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.picks_race_visible(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Nothing changed: logged-in users cannot call picks_race_visible';
  END IF;
  IF has_table_privilege('anon', 'public.picks', 'SELECT') OR has_table_privilege('anon', 'public.scores', 'SELECT')
     OR has_table_privilege('anon', 'public.festival_picks', 'SELECT') OR has_table_privilege('anon', 'public.festival_day_points', 'SELECT') THEN
    RAISE EXCEPTION 'Nothing changed: logged-out visitors still have table access';
  END IF;
END $$;

COMMIT;


-- ── Checks to run afterwards (read-only) ─────────────────────────────────
-- select tablename, policyname, cmd, roles from pg_policies
--  where tablename in ('picks', 'festival_picks', 'festival_day_points', 'scores') order by 1, 2;
-- Expect 5 + 4 + 2 + 2 = 13 rows, every one with roles = {authenticated}.
