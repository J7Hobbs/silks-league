-- ════════════════════════════════════════════════════════════════════════
--  Silks League — picks lock 30 minutes before the first race
--
--  Saturday League : race_weeks.picks_deadline
--  Festivals       : festival_days.picks_deadline
--
--  Rule: deadline = (earliest race_time on the race day, UK local time) − 30 min.
--  Race times are text 'HH:MM' in UK local time; Europe/London handles GMT/BST.
--
--  • A week/day with no race that has a valid HH:MM time keeps its current
--    picks_deadline.
--  • A deadline that has ALREADY PASSED is never changed (so deleting or editing
--    races after the lock cannot reopen picks, and nothing rewrites history).
--    A deadline that is NULL or still in the future is kept in step with the races.
--  • Admin can still write picks_deadline (week form, "Regenerate Days", festival
--    date edit); once races exist the trigger overrides it — unless it has passed,
--    in which case the old value is kept.
--
--  RUN IN FOUR SEPARATE STEPS in the Supabase SQL editor, in this order:
--    STEP 0  read-only checks           (look at the results before going on)
--    PART A  functions + triggers
--    PREVIEW read-only: what Part B would change
--    PART B  one-off recalculation (future deadlines only)
--  Then run VERIFY (read-only).
-- ════════════════════════════════════════════════════════════════════════


-- ===== STEP 0 — read-only checks ========================================

select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_table in ('races','race_weeks','festival_races','festival_days');

select tablename, policyname, cmd, qual, with_check from pg_policies
where coalesce(qual,'') ilike '%deadline%' or coalesce(with_check,'') ilike '%deadline%';

select proname from pg_proc
where prosrc ilike '%picks_deadline%' and pronamespace = 'public'::regnamespace;

select table_name, column_name, data_type from information_schema.columns
where (table_name, column_name) in (('races','race_time'),('festival_races','race_time'),
  ('race_weeks','picks_deadline'),('festival_days','picks_deadline'),
  ('race_weeks','saturday_date'),('festival_days','race_date'));


-- ===== PART A — functions and triggers ==================================

-- ── Saturday League ──

-- Lock moment for a week: first valid race time on p_date (UK local) minus 30 min.
-- NULL when the week has no race with a valid HH:MM time.
CREATE OR REPLACE FUNCTION public.week_lock_time(p_week_id uuid, p_date date)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ((p_date + m.first_race) AT TIME ZONE 'Europe/London') - interval '30 minutes'
  FROM (
    SELECT min(CASE WHEN btrim(r.race_time) ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
                    THEN btrim(r.race_time)::time END) AS first_race
    FROM races r
    WHERE r.race_week_id = p_week_id
  ) m
  WHERE m.first_race IS NOT NULL AND p_date IS NOT NULL;
$$;

-- Recalculate one week. Only touches a deadline that is NULL or still in the future.
CREATE OR REPLACE FUNCTION public.refresh_week_deadline(p_week_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE race_weeks w
     SET picks_deadline = t.v
    FROM (SELECT public.week_lock_time(id, saturday_date) AS v FROM race_weeks WHERE id = p_week_id) t
   WHERE w.id = p_week_id
     AND t.v IS NOT NULL
     AND w.picks_deadline IS DISTINCT FROM t.v
     AND (w.picks_deadline IS NULL OR w.picks_deadline > now());
$$;

-- After a race is added or deleted, or its time or week changes.
CREATE OR REPLACE FUNCTION public.races_sync_week_deadline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM public.refresh_week_deadline(NEW.race_week_id); END IF;
  IF TG_OP = 'DELETE' THEN PERFORM public.refresh_week_deadline(OLD.race_week_id); END IF;
  IF TG_OP = 'UPDATE' AND OLD.race_week_id IS DISTINCT FROM NEW.race_week_id THEN
    PERFORM public.refresh_week_deadline(OLD.race_week_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS races_sync_week_deadline ON races;
CREATE TRIGGER races_sync_week_deadline
  AFTER INSERT OR DELETE OR UPDATE OF race_time, race_week_id ON races
  FOR EACH ROW EXECUTE FUNCTION public.races_sync_week_deadline();

-- A manual edit of the week (Admin's week form) can't undo the rule once races exist.
-- If the old deadline has already passed it is kept exactly as it was.
CREATE OR REPLACE FUNCTION public.race_weeks_enforce_deadline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v timestamptz;
BEGIN
  IF OLD.picks_deadline IS NOT NULL AND OLD.picks_deadline <= now() THEN
    NEW.picks_deadline := OLD.picks_deadline;
  ELSE
    v := public.week_lock_time(NEW.id, NEW.saturday_date);
    IF v IS NOT NULL THEN NEW.picks_deadline := v; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS race_weeks_enforce_deadline ON race_weeks;
CREATE TRIGGER race_weeks_enforce_deadline
  BEFORE UPDATE OF picks_deadline, saturday_date ON race_weeks
  FOR EACH ROW EXECUTE FUNCTION public.race_weeks_enforce_deadline();

-- ── Festivals ──

CREATE OR REPLACE FUNCTION public.festival_day_lock_time(p_day_id uuid, p_date date)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ((p_date + m.first_race) AT TIME ZONE 'Europe/London') - interval '30 minutes'
  FROM (
    SELECT min(CASE WHEN btrim(r.race_time) ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
                    THEN btrim(r.race_time)::time END) AS first_race
    FROM festival_races r
    WHERE r.festival_day_id = p_day_id
  ) m
  WHERE m.first_race IS NOT NULL AND p_date IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.refresh_festival_day_deadline(p_day_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE festival_days d
     SET picks_deadline = t.v
    FROM (SELECT public.festival_day_lock_time(id, race_date) AS v FROM festival_days WHERE id = p_day_id) t
   WHERE d.id = p_day_id
     AND t.v IS NOT NULL
     AND d.picks_deadline IS DISTINCT FROM t.v
     AND (d.picks_deadline IS NULL OR d.picks_deadline > now());
$$;

CREATE OR REPLACE FUNCTION public.festival_races_sync_day_deadline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM public.refresh_festival_day_deadline(NEW.festival_day_id); END IF;
  IF TG_OP = 'DELETE' THEN PERFORM public.refresh_festival_day_deadline(OLD.festival_day_id); END IF;
  IF TG_OP = 'UPDATE' AND OLD.festival_day_id IS DISTINCT FROM NEW.festival_day_id THEN
    PERFORM public.refresh_festival_day_deadline(OLD.festival_day_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS festival_races_sync_day_deadline ON festival_races;
CREATE TRIGGER festival_races_sync_day_deadline
  AFTER INSERT OR DELETE OR UPDATE OF race_time, festival_day_id ON festival_races
  FOR EACH ROW EXECUTE FUNCTION public.festival_races_sync_day_deadline();

-- Admin's "Regenerate Days" / festival date edit write 11:30 UTC; once races exist the rule wins.
-- If the old deadline has already passed it is kept exactly as it was.
CREATE OR REPLACE FUNCTION public.festival_days_enforce_deadline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v timestamptz;
BEGIN
  IF OLD.picks_deadline IS NOT NULL AND OLD.picks_deadline <= now() THEN
    NEW.picks_deadline := OLD.picks_deadline;
  ELSE
    v := public.festival_day_lock_time(NEW.id, NEW.race_date);
    IF v IS NOT NULL THEN NEW.picks_deadline := v; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS festival_days_enforce_deadline ON festival_days;
CREATE TRIGGER festival_days_enforce_deadline
  BEFORE UPDATE OF picks_deadline, race_date ON festival_days
  FOR EACH ROW EXECUTE FUNCTION public.festival_days_enforce_deadline();

-- ── Security: none of these should be callable through the API ──
-- The triggers still fire (a trigger doesn't need the caller to hold EXECUTE) and run
-- as the function owner. Trigger functions can't be called directly at all, but the
-- privilege is revoked as well.
REVOKE EXECUTE ON FUNCTION public.week_lock_time(uuid, date)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_week_deadline(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.festival_day_lock_time(uuid, date)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_festival_day_deadline(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.races_sync_week_deadline()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.race_weeks_enforce_deadline()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.festival_races_sync_day_deadline()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.festival_days_enforce_deadline()      FROM PUBLIC, anon, authenticated;


-- ===== PREVIEW — read-only: what PART B would change ====================

select 'week' as kind, ('Week ' || w.week_number) as label, w.saturday_date as race_day,
       w.picks_deadline at time zone 'Europe/London' as current_lock_uk,
       public.week_lock_time(w.id, w.saturday_date) at time zone 'Europe/London' as new_lock_uk,
       case when w.picks_deadline is not distinct from public.week_lock_time(w.id, w.saturday_date) then 'already correct'
            when w.picks_deadline is null or w.picks_deadline > now() then 'WILL CHANGE'
            else 'skipped (already passed)' end as action
from race_weeks w
where public.week_lock_time(w.id, w.saturday_date) is not null
union all
select 'festival day', coalesce(d.label, 'Day ' || d.day_number), d.race_date,
       d.picks_deadline at time zone 'Europe/London',
       public.festival_day_lock_time(d.id, d.race_date) at time zone 'Europe/London',
       case when d.picks_deadline is not distinct from public.festival_day_lock_time(d.id, d.race_date) then 'already correct'
            when d.picks_deadline is null or d.picks_deadline > now() then 'WILL CHANGE'
            else 'skipped (already passed)' end
from festival_days d
where public.festival_day_lock_time(d.id, d.race_date) is not null
order by 3 desc;


-- ===== PART B — one-off recalculation (future / empty deadlines only) ===

UPDATE race_weeks w
   SET picks_deadline = public.week_lock_time(w.id, w.saturday_date)
 WHERE public.week_lock_time(w.id, w.saturday_date) IS NOT NULL
   AND w.picks_deadline IS DISTINCT FROM public.week_lock_time(w.id, w.saturday_date)
   AND (w.picks_deadline IS NULL OR w.picks_deadline > now());

UPDATE festival_days d
   SET picks_deadline = public.festival_day_lock_time(d.id, d.race_date)
 WHERE public.festival_day_lock_time(d.id, d.race_date) IS NOT NULL
   AND d.picks_deadline IS DISTINCT FROM public.festival_day_lock_time(d.id, d.race_date)
   AND (d.picks_deadline IS NULL OR d.picks_deadline > now());


-- ===== VERIFY — read-only, run last ======================================
-- Every row should show false / false.

select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('week_lock_time','refresh_week_deadline','festival_day_lock_time','refresh_festival_day_deadline',
                    'races_sync_week_deadline','race_weeks_enforce_deadline',
                    'festival_races_sync_day_deadline','festival_days_enforce_deadline')
order by p.proname;
