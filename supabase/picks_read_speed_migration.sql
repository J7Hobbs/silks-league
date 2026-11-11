-- ════════════════════════════════════════════════════════════════════════
--  Silks League — faster picks reads, and the indexes the app's queries need
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--  Needs picks_lock_server_side_migration.sql and rls_hardening_migration.sql to have been run first (they have).
--
--  One transaction. If any check fails it raises "Nothing changed: ..." and the whole thing is rolled back.
--  If you ever see an error from this script, nothing was changed.
--
--  1. picks_select / festival_picks_select, rewritten for speed. SAME behaviour:
--       your own rows always, an admin all, everyone else's only once the race day is locked, logged-out visitors nothing.
--     Before: the lock was worked out once per ROW (a function call for every pick read). That is fine today, but at about
--     21,000 pick rows the whole-season Leaderboard read took ~475 ms instead of ~45 ms.
--     Now: the list of locked races is worked out ONCE per query (picks_locked_race_ids), and each pick is just looked up in
--     it. That list is built by calling the very same picks_day_locked() the write triggers use, so the read rule and the write
--     rule cannot drift apart: deadline passed, 12:00 UK on the race day when there is no deadline, or the day flagged is_locked.
--  2. Indexes. For each column the app filters on, an index is added ONLY IF no index already starts with that column
--     (a UNIQUE constraint counts), so nothing is duplicated. Names are <table>_<column>_idx.
--
--  Nothing else changes: no table, column, other policy, trigger or data. Safe to run twice.
--  The old per-row helper picks_race_visible() is left in place (unused by the policies now); it can be dropped later.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Checks before changing anything ──────────────────────────────────────
DO $$
DECLARE
  t    text;
  want text[];
  have text[];
BEGIN
  IF to_regprocedure('public.picks_day_locked(text, uuid)') IS NULL OR to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Nothing changed: picks_day_locked / is_admin not found (run the earlier migrations first)';
  END IF;
  FOR t, want IN VALUES
    ('picks',          ARRAY['picks_admin_all', 'picks_delete_own', 'picks_insert_own', 'picks_select', 'picks_update_own']),
    ('festival_picks', ARRAY['festival_picks_admin_all', 'festival_picks_insert_own', 'festival_picks_select', 'festival_picks_update_own'])
  LOOP
    SELECT coalesce(array_agg(policyname::text ORDER BY policyname), '{}') INTO have
      FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF have IS DISTINCT FROM want THEN
      RAISE EXCEPTION 'Nothing changed: % has policies % but expected % (has rls_hardening_migration.sql been run?)', t, have, want;
    END IF;
  END LOOP;
END $$;


-- ── 1. The locked-races list, worked out once per query ──────────────────
-- p_kind: 'week' (races) or 'festival' (festival_races). Built from picks_day_locked, the one definition of "locked".
CREATE OR REPLACE FUNCTION public.picks_locked_race_ids(p_kind text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id FROM races r WHERE p_kind = 'week' AND public.picks_day_locked('week', r.id)
  UNION ALL
  SELECT r.id FROM festival_races r WHERE p_kind = 'festival' AND public.picks_day_locked('festival', r.id)
$$;

REVOKE ALL ON FUNCTION public.picks_locked_race_ids(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picks_locked_race_ids(text) TO authenticated;


-- ── The two read policies ────────────────────────────────────────────────
DROP POLICY picks_select ON picks;
CREATE POLICY picks_select ON picks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR (SELECT public.is_admin())
         OR race_id IN (SELECT public.picks_locked_race_ids('week')));

DROP POLICY festival_picks_select ON festival_picks;
CREATE POLICY festival_picks_select ON festival_picks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR (SELECT public.is_admin())
         OR festival_race_id IN (SELECT public.picks_locked_race_ids('festival')));


-- ── 2. Indexes (only where no index already starts with the column) ──────
DO $$
DECLARE
  spec text[];
  t    text;
  c    text;
  made text[] := '{}';
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['picks', 'race_id'], ['picks', 'user_id'],
    ['scores', 'race_id'], ['scores', 'user_id'],
    ['runners', 'race_id'], ['results', 'race_id'],
    ['races', 'race_week_id'], ['race_weeks', 'season_id'],
    ['festival_picks', 'festival_race_id'], ['festival_picks', 'user_id'],
    ['festival_scores', 'festival_race_id'], ['festival_scores', 'user_id'],
    ['festival_runners', 'festival_race_id'], ['festival_results', 'festival_race_id'],
    ['festival_races', 'festival_day_id'], ['festival_days', 'festival_id'],
    ['festival_entries', 'festival_id']
  ] LOOP
    t := spec[1]; c := spec[2];
    IF to_regclass('public.' || t) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t) AND attname = c AND NOT attisdropped) THEN
      RAISE EXCEPTION 'Nothing changed: %.% not found', t, c;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = to_regclass('public.' || t) AND a.attname = c AND i.indisvalid AND i.indpred IS NULL
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)', t || '_' || c || '_idx', t, c);
      made := made || (t || '.' || c);
    END IF;
  END LOOP;
  RAISE NOTICE 'Indexes added: %', CASE WHEN cardinality(made) = 0 THEN 'none (all already existed)' ELSE array_to_string(made, ', ') END;
END $$;


-- ── Checks after changing (any failure undoes everything) ────────────────
DO $$
DECLARE
  t    text;
  want text[];
  have text[];
BEGIN
  FOR t, want IN VALUES
    ('picks',          ARRAY['picks_admin_all', 'picks_delete_own', 'picks_insert_own', 'picks_select', 'picks_update_own']),
    ('festival_picks', ARRAY['festival_picks_admin_all', 'festival_picks_insert_own', 'festival_picks_select', 'festival_picks_update_own'])
  LOOP
    SELECT coalesce(array_agg(policyname::text ORDER BY policyname), '{}') INTO have
      FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF have IS DISTINCT FROM want THEN
      RAISE EXCEPTION 'Nothing changed: % has policies % but expected %', t, have, want;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'picks' AND policyname = 'picks_select' AND qual LIKE '%picks_locked_race_ids%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'festival_picks' AND policyname = 'festival_picks_select' AND qual LIKE '%picks_locked_race_ids%') THEN
    RAISE EXCEPTION 'Nothing changed: the new read policies are not in place';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('picks', 'festival_picks')
                AND (roles && ARRAY['public', 'anon']::name[])) THEN
    RAISE EXCEPTION 'Nothing changed: a picks policy applies to logged-out visitors';
  END IF;
  IF has_function_privilege('anon', 'public.picks_locked_race_ids(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Nothing changed: logged-out visitors can call picks_locked_race_ids';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.picks_locked_race_ids(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Nothing changed: logged-in users cannot call picks_locked_race_ids';
  END IF;
  IF has_table_privilege('anon', 'public.picks', 'SELECT') OR has_table_privilege('anon', 'public.festival_picks', 'SELECT') THEN
    RAISE EXCEPTION 'Nothing changed: logged-out visitors have table access';
  END IF;
END $$;

COMMIT;


-- ── Verification (read-only; run after) ──────────────────────────────────
-- 1. The two read policies (expect the new text, roles {authenticated}):
--  select tablename, policyname, roles, qual from pg_policies
--   where policyname in ('picks_select', 'festival_picks_select') order by 1;
--
-- 2. Every index on the tables the app reads (look for one starting with each column listed in this file):
--  select tablename, indexname, indexdef from pg_indexes
--   where schemaname = 'public'
--     and tablename in ('picks','scores','festival_picks','festival_scores','runners','results','races','race_weeks',
--                       'festival_runners','festival_results','festival_races','festival_days','festival_entries')
--   order by 1, 2;
--
-- 3. The speed check: as a normal player the plan should show a single "SubPlan" / "InitPlan" for picks_locked_race_ids, not
--    a function call per row. (Run in the SQL editor with the role switched; optional.)
--  explain select id, user_id, race_id from picks;
