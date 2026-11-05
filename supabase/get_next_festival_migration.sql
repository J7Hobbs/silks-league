-- ─────────────────────────────────────────────────────────────────────────────
-- Silks League — public "next festival" for the logged-out landing page
-- Run in the Supabase SQL editor for project wfytwcwletznzyayjkrv ("Dashboard").
--
-- festivals is readable by signed-in users only. This adds ONE function that
-- returns a single festival (name, display_name, venue, dates, banner) to anyone,
-- without touching any existing table, policy or grant.
--   • the festival that is live today (UK date), if there is one
--   • otherwise the next one that starts after today
--   • is_active is NOT considered
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- STEP 0 — read-only. Check the column types the function returns.
-- Expect: text for name, display_name, venue, banner_url, banner_position;
--         date for start_date and end_date.
-- If anything differs, stop and tell me before running Part A.
-- ═════════════════════════════════════════════════════════════════════════════
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'festivals'
  AND column_name IN ('name','display_name','venue','start_date','end_date','banner_url','banner_position')
ORDER BY column_name;


-- ═════════════════════════════════════════════════════════════════════════════
-- PART A — the function
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_next_festival()
RETURNS TABLE (
  name            text,
  display_name    text,
  venue           text,
  start_date      date,
  end_date        date,
  banner_url      text,
  banner_position text,
  is_live         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.name, f.display_name, f.venue, f.start_date, f.end_date,
         f.banner_url, f.banner_position,
         (f.start_date <= t.today) AS is_live
  FROM public.festivals f
  CROSS JOIN (SELECT (now() AT TIME ZONE 'Europe/London')::date AS today) t
  WHERE f.end_date >= t.today                      -- live today, or still to come
  ORDER BY (f.start_date <= t.today) DESC,         -- a live festival first
           f.start_date ASC                        -- then the soonest
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_next_festival() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_festival() TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY — read-only. Expect one row back (or none if no festival is live or
-- upcoming), and anon_can_run = true.
-- ═════════════════════════════════════════════════════════════════════════════
SELECT * FROM public.get_next_festival();

SELECT has_function_privilege('anon', 'public.get_next_festival()', 'EXECUTE') AS anon_can_run;
