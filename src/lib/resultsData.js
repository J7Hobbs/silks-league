// Supabase reads for the Results page. Read-only: points come from scores /
// festival_scores exactly as stored, and nothing here writes.
import { supabase } from './supabase'
import { weekDayRank, festivalRank, festivalDayRank } from './standings.js'
import { weekRaces } from './weekSource.js'

const PAGE = 1000

const must = ({ data, error }) => {
  if (error) throw error
  return data || []
}

// PostgREST caps a response at 1000 rows, so page through bigger tables.
async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const data = must(await build().range(from, from + PAGE - 1))
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

// What the page needs to choose a race day: the race weeks and festivals with their days and
// race ids (races only, no results), and each one's picks deadline.
export async function loadResultsIndex() {
  const weeksLoaded = supabase.from('race_weeks')
    .select('id, week_number, saturday_date, picks_deadline, festival_day_id').then(must)
  const [weeks, weekRaceRows, festivals, days, dayRaces] = await Promise.all([
    weeksLoaded,
    // A week linked to a festival day has that day's races (weekSource.js).
    weeksLoaded.then(ws => weekRaces(ws)),
    supabase.from('festivals').select('id, name, display_name, start_date, end_date, venue, banner_url, banner_position').then(must),
    supabase.from('festival_days').select('id, festival_id, day_number, race_date, picks_deadline').then(must),
    fetchAll(() => supabase.from('festival_races').select('id, festival_day_id').order('id')),
  ])
  return { weeks, weekRaces: weekRaceRows, festivals, days, dayRaces }
}

// The player's position among everyone who picked on the race day on screen (players who
// scored 0 included), ranked with the usual tiebreaks. Null if the player did not pick.
export const loadWeekStanding = (userId, raceIds) => weekDayRank(userId, raceIds)
export const loadFestivalDayStanding = (userId, raceIds) => festivalDayRank(userId, raceIds)

// The player's festival total and position overall, from the same function (festivalRank) that
// ranks the festival; the total includes any starting points. { total, rank } with nulls when
// the player is not in the festival.
export async function loadFestivalOverall(userId, festivalId) {
  const rank = await festivalRank(userId, festivalId).catch(() => null)
  return { total: rank ? rank.points : null, rank }
}

// The races of a period and the rows that hang off them (results, picks, scores) are fetched
// together, using the race ids the page's index already holds. If the races turn out to differ
// from the index (one added or removed since it loaded), the rest is fetched again for the
// actual races, so the data is the same as fetching them one after the other.
async function fetchPeriod(guessIds, fetchRaces, fetchRest) {
  const guess = guessIds || []
  let races, rest
  if (guess.length) {
    ;[races, rest] = await Promise.all([fetchRaces(), fetchRest(guess)])
    const same = races.length === guess.length && races.every(r => guess.includes(r.id))
    if (same) return { races, rest }
  } else {
    races = await fetchRaces()
  }
  const ids = races.map(r => r.id)
  return { races, rest: ids.length ? await fetchRest(ids) : null }
}

// The bonuses a player won on a race day (bonus_awards). An extra: if they can't be read the rest of the
// page still shows, with the points as stored.
async function loadBonuses(userId, dayCol, dayId) {
  try {
    return must(await supabase.from('bonus_awards')
      .select('bonus_type, points, race_id, festival_race_id').eq('user_id', userId).eq(dayCol, dayId))
  } catch { return [] }
}

// Everything one Saturday race week needs for the signed-in player.
export async function loadWeekPeriod(userId, period) {
  // A week linked to a festival day is that day: its races, picks and points are the festival's.
  if (period.festivalDayId) return loadFestivalPeriod(userId, { id: period.festivalDayId, raceIds: period.raceIds })
  const { races, rest } = await fetchPeriod(
    period.raceIds,
    () => supabase
      .from('races').select('id, race_number, race_time, venue, race_name, runner_count_at_lock, is_abandoned')
      .eq('race_week_id', period.id).order('race_number').then(must),
    ids => Promise.all([
      supabase.from('results').select('race_id, position, horse_name, starting_price_display').in('race_id', ids).then(must),
      supabase.from('picks').select('race_id, runner_id, bet_type, was_replaced, is_banker').eq('user_id', userId).in('race_id', ids).then(must),
      supabase.from('scores')
        .select('race_id, total_points, position_achieved, bet_type, place_token_points')
        .eq('user_id', userId).in('race_id', ids).then(must),
      loadBonuses(userId, 'race_week_id', period.id),
    ]),
  )
  if (!rest) return { races, results: [], picks: [], runners: [], scores: [], bonuses: [] }
  const [results, picks, scores, bonuses] = rest
  const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
  const runners = runnerIds.length
    ? must(await supabase.from('runners')
        .select('id, horse_name, odds_fractional, silk_colour, silk_colour_secondary, silk_pattern, is_withdrawn').in('id', runnerIds))
    : []
  return { races, results, picks, runners, scores, bonuses }
}

// The same for one festival day. Rows are mapped to the shape the weekly ones have.
export async function loadFestivalPeriod(userId, period) {
  const { races, rest } = await fetchPeriod(
    period.raceIds,
    () => supabase
      .from('festival_races').select('id, race_number, race_time, venue, race_name, runner_count_at_lock, is_abandoned')
      .eq('festival_day_id', period.id).order('race_number').then(must),
    ids => Promise.all([
      supabase.from('festival_results').select('festival_race_id, position, horse_name, starting_price_display')
        .in('festival_race_id', ids).then(must),
      supabase.from('festival_picks').select('festival_race_id, runner_id, bet_type, was_replaced, is_banker')
        .eq('user_id', userId).in('festival_race_id', ids).then(must),
      supabase.from('festival_scores')
        .select('festival_race_id, total_points, position_achieved, bet_type, place_token_points')
        .eq('user_id', userId).in('festival_race_id', ids).then(must),
      loadBonuses(userId, 'festival_day_id', period.id),
    ]),
  )
  if (!rest) return { races, results: [], picks: [], runners: [], scores: [], bonuses: [] }
  const [results, picks, scores, bonuses] = rest
  const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
  const runners = runnerIds.length
    ? must(await supabase.from('festival_runners')
        .select('id, horse_name, odds_fractional, silk_colour, silk_colour_secondary, silk_pattern, is_withdrawn').in('id', runnerIds))
    : []
  const toRace = ({ festival_race_id, ...rest }) => ({ race_id: festival_race_id, ...rest })
  return {
    races, results: results.map(toRace), picks: picks.map(toRace), runners, scores: scores.map(toRace),
    bonuses: bonuses.map(({ festival_race_id, ...b }) => ({ ...b, race_id: festival_race_id })),
  }
}
