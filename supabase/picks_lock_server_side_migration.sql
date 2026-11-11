-- ════════════════════════════════════════════════════════════════════════
--  Silks League — server-side picks lock
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  The problem
--    The app hides the pick buttons after the lock, but the database never checked: a signed-in player
--    could still insert, change or delete their own row in picks / festival_picks (browser dev tools).
--
--  What this adds
--    BEFORE INSERT / UPDATE / DELETE triggers on picks and festival_picks. For an ordinary player they refuse the
--    write with "Picks are locked for this race day" once now() is at or after the race day's picks_deadline
--    (race_weeks through the race; festival_days through the festival race) or the day is flagged is_locked.
--    If a day has no picks_deadline the lock is 12:00 UK on the race day, the same fallback the app uses.
--
--    For an ordinary player they also refuse:
--      - touching a row that is not theirs (belt and braces on top of RLS),
--      - moving a pick to a different race,
--      - pointing a pick at a horse that is not in that race, or one that is withdrawn.
--
--  Who is let straight through (no lock, no checks)
--      - admins                       profiles.is_admin for auth.uid()  (Admin screens, withdrawals, Replace race ...)
--      - the service role / trusted server code with no signed-in user: agent-api, Edge Functions, the SQL editor,
--        pg_cron, other triggers. That is "auth.uid() is null and the role is not anon". Anonymous visitors are NOT let
--        through: they have no uid and the 'anon' role, so they are refused like any player.
--      - a cascade delete (a profile being removed deletes its picks): trigger depth > 1, DELETE only.
--
--  Existing write paths (all checked, all still work; see the report): player saves (Picks, Festival picks, set_banker),
--  Admin withdrawals / reinstating / Rule 4 re-scoring / lock-time each-way conversion / abandon / Replace race, agent-api's
--  automatic non-runner moves, delete-user, and the festival_picks_auto_enter and race_day_id triggers.
--
--  Purely additive: no table or column changes, nothing existing is dropped. Safe to run twice.
--  The existing picks_guard_banker / festival_picks_guard_banker triggers stay as they are.
--
--  After running: run the checks at the bottom (read-only), then picks_lock_selftest.sql (it changes nothing).
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. Who is trusted ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.picks_trusted_caller()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'anon')
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
$$;


-- ── 2. Is this race's day locked? ────────────────────────────────────────
-- p_kind: 'week' (races -> race_weeks) or 'festival' (festival_races -> festival_days, which also covers a linked Saturday).
-- is_locked is read through to_jsonb so this still works on a table that has no such column.
CREATE OR REPLACE FUNCTION public.picks_day_locked(p_kind text, p_race_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  dl      timestamptz;
  flagged boolean;
BEGIN
  IF p_race_id IS NULL THEN RETURN false; END IF;

  IF p_kind = 'week' THEN
    SELECT coalesce(w.picks_deadline, (w.saturday_date + time '12:00') AT TIME ZONE 'Europe/London'),
           coalesce((to_jsonb(w) ->> 'is_locked')::boolean, false)
      INTO dl, flagged
      FROM races r JOIN race_weeks w ON w.id = r.race_week_id
     WHERE r.id = p_race_id;
  ELSE
    SELECT coalesce(d.picks_deadline, (d.race_date + time '12:00') AT TIME ZONE 'Europe/London'),
           coalesce((to_jsonb(d) ->> 'is_locked')::boolean, false)
      INTO dl, flagged
      FROM festival_races r JOIN festival_days d ON d.id = r.festival_day_id
     WHERE r.id = p_race_id;
  END IF;

  IF NOT FOUND THEN RETURN false; END IF;
  RETURN coalesce(flagged, false) OR (dl IS NOT NULL AND now() >= dl);
END;
$$;


-- ── 3. The check, shared by both tables ──────────────────────────────────
-- Raises, or returns. p_op is TG_OP. Old/new values are null where they do not exist (an INSERT has no old row).
CREATE OR REPLACE FUNCTION public.picks_guard_check(
  p_kind text, p_op text,
  p_old_user uuid, p_new_user uuid,
  p_old_race uuid, p_new_race uuid,
  p_old_runner uuid, p_new_runner uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  me        uuid := auth.uid();
  race      uuid := coalesce(p_new_race, p_old_race);
  withdrawn boolean;
  found_it  boolean;
BEGIN
  IF public.picks_trusted_caller() THEN RETURN; END IF;
  IF p_op = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN; END IF;     -- a cascade from deleting the profile

  IF me IS NULL THEN RAISE EXCEPTION 'You must be signed in to change picks'; END IF;

  -- Only your own row, and it stays yours.
  IF coalesce(p_old_user, p_new_user) IS DISTINCT FROM me OR (p_new_user IS NOT NULL AND p_new_user <> me) THEN
    RAISE EXCEPTION 'You can only change your own picks';
  END IF;
  IF p_op = 'UPDATE' AND p_new_race IS DISTINCT FROM p_old_race THEN
    RAISE EXCEPTION 'A pick cannot be moved to another race';
  END IF;

  -- The lock.
  IF public.picks_day_locked(p_kind, race) THEN
    RAISE EXCEPTION 'Picks are locked for this race day';
  END IF;

  -- The horse must be in this race and still running (only checked when it is new or changed).
  IF p_op <> 'DELETE' AND p_new_runner IS NOT NULL AND (p_op = 'INSERT' OR p_new_runner IS DISTINCT FROM p_old_runner) THEN
    IF p_kind = 'week' THEN
      SELECT true, coalesce(r.is_withdrawn, false) INTO found_it, withdrawn
        FROM runners r WHERE r.id = p_new_runner AND r.race_id = p_new_race;
    ELSE
      SELECT true, coalesce(r.is_withdrawn, false) INTO found_it, withdrawn
        FROM festival_runners r WHERE r.id = p_new_runner AND r.festival_race_id = p_new_race;
    END IF;
    IF NOT coalesce(found_it, false) THEN RAISE EXCEPTION 'That horse is not running in this race'; END IF;
    IF withdrawn THEN RAISE EXCEPTION 'That horse has been withdrawn'; END IF;
  END IF;
END;
$$;


-- ── 4. The triggers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.picks_lock_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.picks_guard_check('week', 'INSERT', NULL, NEW.user_id, NULL, NEW.race_id, NULL, NEW.runner_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.picks_guard_check('week', 'UPDATE', OLD.user_id, NEW.user_id, OLD.race_id, NEW.race_id, OLD.runner_id, NEW.runner_id);
    RETURN NEW;
  END IF;
  PERFORM public.picks_guard_check('week', 'DELETE', OLD.user_id, NULL, OLD.race_id, NULL, OLD.runner_id, NULL);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS picks_lock_guard ON picks;
CREATE TRIGGER picks_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON picks
  FOR EACH ROW EXECUTE FUNCTION public.picks_lock_guard();

CREATE OR REPLACE FUNCTION public.festival_picks_lock_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.picks_guard_check('festival', 'INSERT', NULL, NEW.user_id, NULL, NEW.festival_race_id, NULL, NEW.runner_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.picks_guard_check('festival', 'UPDATE', OLD.user_id, NEW.user_id, OLD.festival_race_id, NEW.festival_race_id, OLD.runner_id, NEW.runner_id);
    RETURN NEW;
  END IF;
  PERFORM public.picks_guard_check('festival', 'DELETE', OLD.user_id, NULL, OLD.festival_race_id, NULL, OLD.runner_id, NULL);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS festival_picks_lock_guard ON festival_picks;
CREATE TRIGGER festival_picks_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON festival_picks
  FOR EACH ROW EXECUTE FUNCTION public.festival_picks_lock_guard();


-- ── 5. Keep the helpers off the public API ───────────────────────────────
-- They are only called by the triggers (which run them as their owner), never directly by the app.
REVOKE ALL ON FUNCTION public.picks_trusted_caller() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.picks_day_locked(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.picks_guard_check(text, text, uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.picks_lock_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.festival_picks_lock_guard() FROM PUBLIC, anon, authenticated;


-- ── Checks (read-only; run after) ────────────────────────────────────────
-- 1. Both triggers exist on both tables (expect 3 rows each: INSERT, UPDATE, DELETE for the lock guard):
--  select event_object_table, trigger_name, event_manipulation, action_timing
--    from information_schema.triggers
--   where trigger_name in ('picks_lock_guard', 'festival_picks_lock_guard')
--   order by 1, 3;
--
-- 2. Who can touch picks today (look at every row: players should only ever be allowed their OWN rows, nothing for anon):
--  select tablename, policyname, cmd, roles, qual, with_check
--    from pg_policies where tablename in ('picks', 'festival_picks') order by tablename, cmd;
--
-- 3. Does race_weeks / festival_days have an is_locked column? (either answer is fine)
--  select table_name, column_name from information_schema.columns
--   where table_name in ('race_weeks', 'festival_days') and column_name in ('is_locked', 'picks_deadline');
