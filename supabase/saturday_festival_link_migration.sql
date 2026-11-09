-- ════════════════════════════════════════════════════════════════════════
--  Silks League — Saturday League ⇄ festival day link
--  Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  A Saturday that is part of a festival is linked to that festival day.
--  Players make ONE set of picks on the festival's races (festival_picks);
--  the points (festival_scores) count for the festival table AND for that
--  week of the Saturday League. Scoring formulas are not touched.
--
--  What this adds
--    1. race_weeks.festival_day_id   the link (one day can be linked to one week)
--    2. guard trigger on race_weeks  rules for a linked week, and its lock time
--                                    always follows the festival day
--    3. guard trigger on races       a linked week can never get races of its own
--    4. sync trigger on festival_days when the day's lock time moves (it follows
--                                    the first race), the linked week follows
--    5. trigger on festival_picks    the first pick on a linked day enters the
--                                    player in the festival (festival_entries)
--
--  Nothing here changes existing rows. Weeks and picks that exist today are
--  untouched, and no week is linked until Admin links it.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. The link ──────────────────────────────────────────────────────────
-- RESTRICT: a festival day that is linked to a week cannot be deleted by accident.
ALTER TABLE race_weeks
  ADD COLUMN IF NOT EXISTS festival_day_id uuid REFERENCES festival_days(id) ON DELETE RESTRICT;

-- One festival day belongs to at most one race week.
CREATE UNIQUE INDEX IF NOT EXISTS race_weeks_festival_day_unique
  ON race_weeks (festival_day_id) WHERE festival_day_id IS NOT NULL;


-- ── 2. Rules for a linked week ───────────────────────────────────────────
--  • the festival day must be on the week's Saturday
--  • a week that already has races of its own cannot be linked
--  • a link cannot be removed or changed once anyone has picked on the day
--  • the week's picks_deadline is always the festival day's (unless the week's own
--    deadline has already passed, which is never changed, as for any week)
-- Runs after the existing race_weeks_enforce_deadline trigger (alphabetical order),
-- which leaves a week with no races alone, so the festival day's time wins.
CREATE OR REPLACE FUNCTION public.race_weeks_guard_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d festival_days%ROWTYPE;
BEGIN
  -- Removing or changing an existing link
  IF TG_OP = 'UPDATE' THEN
    IF OLD.festival_day_id IS NOT NULL
       AND NEW.festival_day_id IS DISTINCT FROM OLD.festival_day_id THEN
      IF EXISTS (
        SELECT 1
          FROM festival_picks p
          JOIN festival_races r ON r.id = p.festival_race_id
         WHERE r.festival_day_id = OLD.festival_day_id
      ) THEN
        RAISE EXCEPTION 'Players have already picked on this festival day, so the week cannot be unlinked';
      END IF;
    END IF;
  END IF;

  IF NEW.festival_day_id IS NOT NULL THEN
    SELECT * INTO d FROM festival_days WHERE id = NEW.festival_day_id;

    IF d.id IS NULL OR d.race_date IS DISTINCT FROM NEW.saturday_date THEN
      RAISE EXCEPTION 'That festival day is not on this Saturday (%)', NEW.saturday_date;
    END IF;

    -- A new link: the week must have no races of its own
    IF TG_OP = 'INSERT' THEN
      -- a brand-new week has no races yet; nothing to check
      NULL;
    ELSIF OLD.festival_day_id IS DISTINCT FROM NEW.festival_day_id THEN
      IF EXISTS (SELECT 1 FROM races WHERE race_week_id = NEW.id) THEN
        RAISE EXCEPTION 'This week already has its own races; delete them before linking it to a festival day';
      END IF;
    END IF;

    -- Lock time comes from the festival day
    IF d.picks_deadline IS NOT NULL THEN
      IF TG_OP = 'INSERT' THEN
        NEW.picks_deadline := d.picks_deadline;
      ELSIF OLD.picks_deadline IS NULL OR OLD.picks_deadline > now() THEN
        NEW.picks_deadline := d.picks_deadline;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS race_weeks_guard_link ON race_weeks;
CREATE TRIGGER race_weeks_guard_link
  BEFORE INSERT OR UPDATE OF festival_day_id, saturday_date, picks_deadline ON race_weeks
  FOR EACH ROW EXECUTE FUNCTION public.race_weeks_guard_link();


-- ── 3. A linked week gets no races of its own ────────────────────────────
CREATE OR REPLACE FUNCTION public.races_block_linked_week()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM race_weeks WHERE id = NEW.race_week_id AND festival_day_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This week is linked to a festival day; add its races to the festival instead';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS races_block_linked_week ON races;
CREATE TRIGGER races_block_linked_week
  BEFORE INSERT OR UPDATE OF race_week_id ON races
  FOR EACH ROW EXECUTE FUNCTION public.races_block_linked_week();


-- ── 4. When the festival day's lock time moves, the linked week follows ───
-- (The day's deadline is set by the existing festival_races trigger from the first
-- race time. This copies it across. A deadline that has already passed is left alone.)
CREATE OR REPLACE FUNCTION public.festival_days_sync_linked_week()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE race_weeks w
     SET picks_deadline = NEW.picks_deadline
   WHERE w.festival_day_id = NEW.id
     AND NEW.picks_deadline IS NOT NULL
     AND w.picks_deadline IS DISTINCT FROM NEW.picks_deadline
     AND (w.picks_deadline IS NULL OR w.picks_deadline > now());
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS festival_days_sync_linked_week ON festival_days;
CREATE TRIGGER festival_days_sync_linked_week
  AFTER UPDATE OF picks_deadline ON festival_days
  FOR EACH ROW EXECUTE FUNCTION public.festival_days_sync_linked_week();


-- ── 5. The first pick on a linked day enters the player in the festival ──
-- Only for days linked to a Saturday League week. Other festival days keep the
-- existing "join" step. Starting points stay 0, as in the existing join code.
-- ON CONFLICT DO NOTHING: players already entered are left exactly as they are.
CREATE OR REPLACE FUNCTION public.festival_picks_auto_enter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  f uuid;
BEGIN
  SELECT d.festival_id INTO f
    FROM festival_races r
    JOIN festival_days d ON d.id = r.festival_day_id
    JOIN race_weeks w    ON w.festival_day_id = d.id
   WHERE r.id = NEW.festival_race_id
   LIMIT 1;

  IF f IS NOT NULL THEN
    INSERT INTO festival_entries (festival_id, user_id, starting_points)
    VALUES (f, NEW.user_id, 0)
    ON CONFLICT (festival_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS festival_picks_auto_enter ON festival_picks;
CREATE TRIGGER festival_picks_auto_enter
  AFTER INSERT ON festival_picks
  FOR EACH ROW EXECUTE FUNCTION public.festival_picks_auto_enter();


-- ════════════════════════════════════════════════════════════════════════
--  Checks to run afterwards (read-only)
-- ════════════════════════════════════════════════════════════════════════
--  select column_name, data_type from information_schema.columns
--   where table_name = 'race_weeks' and column_name = 'festival_day_id';
--
--  select event_object_table, trigger_name, event_manipulation
--    from information_schema.triggers
--   where trigger_name in ('race_weeks_guard_link', 'races_block_linked_week',
--                          'festival_days_sync_linked_week', 'festival_picks_auto_enter');
--
--  -- Cheltenham Sat 14 Nov: the festival day to link, and no week yet
--  select id, day_number, race_date, picks_deadline from festival_days
--   where id = '5dbd4a54-e674-4ff7-8c31-ea6f321200b1';
--  select * from race_weeks where saturday_date = '2026-11-14';
--
--  To undo (only while no week is linked):
--    DROP TRIGGER IF EXISTS festival_picks_auto_enter ON festival_picks;
--    DROP TRIGGER IF EXISTS festival_days_sync_linked_week ON festival_days;
--    DROP TRIGGER IF EXISTS races_block_linked_week ON races;
--    DROP TRIGGER IF EXISTS race_weeks_guard_link ON race_weeks;
--    DROP INDEX IF EXISTS race_weeks_festival_day_unique;
--    ALTER TABLE race_weeks DROP COLUMN IF EXISTS festival_day_id;
