-- ════════════════════════════════════════════════════════════════════════
--  Silks League — bonus points (Banker x2, Lone winner +25, Treble +50)
--  NOT RUN. Run once in the Supabase SQL Editor on project wfytwcwletznzyayjkrv
--  (the "Dashboard" project, NOT the stale one named "Silks League").
--
--  Purely additive: new columns have safe defaults, nothing existing is rewritten
--  except the race_day_id backfill. The current app keeps working after this runs,
--  so run it BEFORE deploying the new front end.
--
--  What this adds
--    1. picks / festival_picks.is_banker      the banker flag (default false)
--    2. picks / festival_picks.race_day_id    the race day the pick belongs to
--                                             (race_week_id / festival_day_id), kept
--                                             by a trigger, so "one banker per race
--                                             day" can be a real unique index
--    3. one-banker-per-day unique indexes     enforced in the database
--    4. lock guard trigger                    the banker cannot be set, moved or
--                                             cleared after the picks deadline, even
--                                             by a direct API call (admins / SQL
--                                             editor excepted)
--    5. set_banker(kind, race_id, on)         moves the banker in ONE transaction
--    6. bonus_awards                          the ledger: one row per bonus won
--    7. profiles.bonus_intro_seen_at          the launch pop-up has been seen
--
--  How the points reach the tables (app side, not here)
--    scores.total_points / festival_scores.total_points will INCLUDE the bonus for
--    that race, so every existing total, ranking and group table is right without
--    being touched. win_token_points + place_token_points stay as the raw
--    calcTokenPoints figures, so total = win + place + that race's bonus_awards.
--    A linked Saturday has no scores of its own (weekSource.js), so a bonus is
--    stored once, against the festival day, and counts once everywhere.
--
--  The Cheltenham cut-off ("only from the November Meeting") is a date constant in
--  the app, not a column: nothing here changes earlier race days.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1 + 2. Columns ───────────────────────────────────────────────────────
ALTER TABLE picks
  ADD COLUMN IF NOT EXISTS is_banker   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS race_day_id uuid;          -- = races.race_week_id

ALTER TABLE festival_picks
  ADD COLUMN IF NOT EXISTS is_banker   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS race_day_id uuid;          -- = festival_races.festival_day_id


-- ── Keep race_day_id in step with the pick's race ────────────────────────
CREATE OR REPLACE FUNCTION public.picks_set_race_day()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  SELECT r.race_week_id INTO NEW.race_day_id FROM races r WHERE r.id = NEW.race_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS picks_set_race_day ON picks;
CREATE TRIGGER picks_set_race_day
  BEFORE INSERT OR UPDATE OF race_id ON picks
  FOR EACH ROW EXECUTE FUNCTION public.picks_set_race_day();

CREATE OR REPLACE FUNCTION public.festival_picks_set_race_day()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  SELECT r.festival_day_id INTO NEW.race_day_id FROM festival_races r WHERE r.id = NEW.festival_race_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS festival_picks_set_race_day ON festival_picks;
CREATE TRIGGER festival_picks_set_race_day
  BEFORE INSERT OR UPDATE OF festival_race_id ON festival_picks
  FOR EACH ROW EXECUTE FUNCTION public.festival_picks_set_race_day();

-- Backfill existing picks (the UPDATE OF race_id triggers above do not fire for these).
UPDATE picks p
   SET race_day_id = r.race_week_id
  FROM races r
 WHERE r.id = p.race_id AND p.race_day_id IS DISTINCT FROM r.race_week_id;

UPDATE festival_picks p
   SET race_day_id = r.festival_day_id
  FROM festival_races r
 WHERE r.id = p.festival_race_id AND p.race_day_id IS DISTINCT FROM r.festival_day_id;


-- ── 3. One banker per player per race day ────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS picks_one_banker_per_day
  ON picks (user_id, race_day_id) WHERE is_banker;

CREATE UNIQUE INDEX IF NOT EXISTS festival_picks_one_banker_per_day
  ON festival_picks (user_id, race_day_id) WHERE is_banker;


-- ── 4. The banker locks with the picks ───────────────────────────────────
-- Only fires when is_banker is being set to true on insert, or changed on update, so
-- ordinary pick saves and Admin's withdrawal re-pick (runner_id only) never touch it.
-- auth.uid() is null in the SQL editor and for the service role: allowed.
CREATE OR REPLACE FUNCTION public.picks_guard_banker()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  dl timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.is_banker IS NOT DISTINCT FROM OLD.is_banker THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NOT NEW.is_banker THEN RETURN NEW; END IF;

  IF auth.uid() IS NULL
     OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RETURN NEW;
  END IF;

  SELECT w.picks_deadline INTO dl
    FROM races r JOIN race_weeks w ON w.id = r.race_week_id
   WHERE r.id = NEW.race_id;

  IF dl IS NOT NULL AND now() >= dl THEN
    RAISE EXCEPTION 'Picks are locked: the banker can no longer be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS picks_guard_banker ON picks;
CREATE TRIGGER picks_guard_banker
  BEFORE INSERT OR UPDATE OF is_banker ON picks
  FOR EACH ROW EXECUTE FUNCTION public.picks_guard_banker();

CREATE OR REPLACE FUNCTION public.festival_picks_guard_banker()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  dl timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.is_banker IS NOT DISTINCT FROM OLD.is_banker THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NOT NEW.is_banker THEN RETURN NEW; END IF;

  IF auth.uid() IS NULL
     OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RETURN NEW;
  END IF;

  SELECT d.picks_deadline INTO dl
    FROM festival_races r JOIN festival_days d ON d.id = r.festival_day_id
   WHERE r.id = NEW.festival_race_id;

  IF dl IS NOT NULL AND now() >= dl THEN
    RAISE EXCEPTION 'Picks are locked: the banker can no longer be changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS festival_picks_guard_banker ON festival_picks;
CREATE TRIGGER festival_picks_guard_banker
  BEFORE INSERT OR UPDATE OF is_banker ON festival_picks
  FOR EACH ROW EXECUTE FUNCTION public.festival_picks_guard_banker();


-- ── 5. Move the banker in one transaction ────────────────────────────────
-- p_kind: 'week' (picks) or 'festival' (festival_picks, which also covers a linked Saturday).
-- p_on = true  : this race's pick becomes the banker; any other banker that day is cleared
-- p_on = false : this race's pick stops being the banker
-- SECURITY INVOKER: the caller's own RLS on picks applies, plus the lock guard above.
CREATE OR REPLACE FUNCTION public.set_banker(p_kind text, p_race_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  me  uuid := auth.uid();
  day uuid;
  n   integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  IF p_kind = 'week' THEN
    SELECT race_week_id INTO day FROM races WHERE id = p_race_id;
    IF p_on THEN
      UPDATE picks SET is_banker = false
       WHERE user_id = me AND race_day_id = day AND is_banker AND race_id <> p_race_id;
    END IF;
    UPDATE picks SET is_banker = p_on WHERE user_id = me AND race_id = p_race_id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSIF p_kind = 'festival' THEN
    SELECT festival_day_id INTO day FROM festival_races WHERE id = p_race_id;
    IF p_on THEN
      UPDATE festival_picks SET is_banker = false
       WHERE user_id = me AND race_day_id = day AND is_banker AND festival_race_id <> p_race_id;
    END IF;
    UPDATE festival_picks SET is_banker = p_on WHERE user_id = me AND festival_race_id = p_race_id;
    GET DIAGNOSTICS n = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Unknown kind %', p_kind;
  END IF;

  IF n = 0 THEN RAISE EXCEPTION 'Pick a horse in this race first'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_banker(text, uuid, boolean) TO authenticated;


-- ── 6. The bonus ledger ──────────────────────────────────────────────────
-- One row per bonus a player won. The same shape as scores / festival_scores: a Saturday
-- race day (race_week_id + race_id) or a festival day (festival_day_id + festival_race_id).
--   banker       points = the extra from doubling (the race's normal points again)
--   lone_winner  points = 25, on the race the player alone won
--   treble       points = 50, on the race that completed the run; detail has the three
--                race numbers, e.g. {"race_numbers":[2,3,4]}
-- notified_at is set when the "you won a bonus" push has gone, so a recalculation never
-- sends it twice.
CREATE TABLE IF NOT EXISTS bonus_awards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bonus_type       text NOT NULL CHECK (bonus_type IN ('banker', 'lone_winner', 'treble')),
  race_week_id     uuid REFERENCES race_weeks(id)     ON DELETE CASCADE,
  festival_day_id  uuid REFERENCES festival_days(id)  ON DELETE CASCADE,
  race_id          uuid REFERENCES races(id)          ON DELETE CASCADE,
  festival_race_id uuid REFERENCES festival_races(id) ON DELETE CASCADE,
  points           integer NOT NULL CHECK (points > 0),
  detail           jsonb   NOT NULL DEFAULT '{}'::jsonb,
  notified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bonus_awards_one_day  CHECK ((race_week_id IS NULL) <> (festival_day_id IS NULL)),
  CONSTRAINT bonus_awards_one_race CHECK ((race_id IS NULL) <> (festival_race_id IS NULL)),
  CONSTRAINT bonus_awards_race_matches_day CHECK ((race_id IS NULL) = (race_week_id IS NULL))
);

-- One award of each type per player per race ...
CREATE UNIQUE INDEX IF NOT EXISTS bonus_awards_week_race_type
  ON bonus_awards (user_id, bonus_type, race_id) WHERE race_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bonus_awards_festival_race_type
  ON bonus_awards (user_id, bonus_type, festival_race_id) WHERE festival_race_id IS NOT NULL;
-- ... and at most one treble per player per race day.
CREATE UNIQUE INDEX IF NOT EXISTS bonus_awards_one_treble_week
  ON bonus_awards (user_id, race_week_id) WHERE bonus_type = 'treble' AND race_week_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bonus_awards_one_treble_festival
  ON bonus_awards (user_id, festival_day_id) WHERE bonus_type = 'treble' AND festival_day_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bonus_awards_week_idx     ON bonus_awards (race_week_id);
CREATE INDEX IF NOT EXISTS bonus_awards_festival_idx ON bonus_awards (festival_day_id);
CREATE INDEX IF NOT EXISTS bonus_awards_user_idx     ON bonus_awards (user_id);

ALTER TABLE bonus_awards ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can read (the leaderboards and the player pop-up show other players' days).
-- Bonuses only exist once results are in, so nothing is revealed before a lock.
DROP POLICY IF EXISTS "Auth users read bonus_awards" ON bonus_awards;
CREATE POLICY "Auth users read bonus_awards"
  ON bonus_awards FOR SELECT TO authenticated USING (true);

-- Only admins write (results are scored from the Admin page).
DROP POLICY IF EXISTS "Admins full access bonus_awards" ON bonus_awards;
CREATE POLICY "Admins full access bonus_awards"
  ON bonus_awards FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));


-- ── 7. Launch pop-up: seen once per player ───────────────────────────────
-- Players already update their own profile row ("Users can update own profile").
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bonus_intro_seen_at timestamptz;


-- ════════════════════════════════════════════════════════════════════════
--  Checks to run afterwards (read-only)
-- ════════════════════════════════════════════════════════════════════════
--  -- every pick has its race day
--  select count(*) from picks          where race_day_id is null;   -- expect 0
--  select count(*) from festival_picks where race_day_id is null;   -- expect 0
--
--  -- triggers and the function exist
--  select event_object_table, trigger_name from information_schema.triggers
--   where trigger_name in ('picks_set_race_day','festival_picks_set_race_day',
--                          'picks_guard_banker','festival_picks_guard_banker');
--  select proname from pg_proc where proname = 'set_banker';
--
--  -- the live RLS on the pick tables (their policies are not in this repo): confirm players
--  -- can update their own rows and that other players' picks are hidden before the lock
--  select tablename, policyname, cmd, qual, with_check from pg_policies
--   where tablename in ('picks','festival_picks','scores','profiles');
--
--  -- after the first scored bonus day: totals match (expect no rows)
--  select s.id, s.total_points,
--         coalesce(s.win_token_points,0) + coalesce(s.place_token_points,0)
--           + coalesce((select sum(b.points) from bonus_awards b
--                        where b.user_id = s.user_id and b.race_id = s.race_id),0) as expected
--    from scores s
--   where s.bet_type is not null
--     and s.race_id in (select race_id from bonus_awards where race_id is not null)
--     and s.total_points <> coalesce(s.win_token_points,0) + coalesce(s.place_token_points,0)
--           + coalesce((select sum(b.points) from bonus_awards b
--                        where b.user_id = s.user_id and b.race_id = s.race_id),0);

--  To undo (before anyone has used it):
--    DROP FUNCTION IF EXISTS public.set_banker(text, uuid, boolean);
--    DROP TRIGGER IF EXISTS picks_guard_banker ON picks;
--    DROP TRIGGER IF EXISTS festival_picks_guard_banker ON festival_picks;
--    DROP TRIGGER IF EXISTS picks_set_race_day ON picks;
--    DROP TRIGGER IF EXISTS festival_picks_set_race_day ON festival_picks;
--    DROP TABLE IF EXISTS bonus_awards;
--    DROP INDEX IF EXISTS picks_one_banker_per_day, festival_picks_one_banker_per_day;
--    ALTER TABLE picks          DROP COLUMN IF EXISTS is_banker, DROP COLUMN IF EXISTS race_day_id;
--    ALTER TABLE festival_picks DROP COLUMN IF EXISTS is_banker, DROP COLUMN IF EXISTS race_day_id;
--    ALTER TABLE profiles       DROP COLUMN IF EXISTS bonus_intro_seen_at;
