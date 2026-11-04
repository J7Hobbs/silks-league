// Supabase reads for the Results page. Read-only: points come from scores /
// festival_scores exactly as stored, and nothing here writes.
import { supabase } from './supabase'

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

// Race weeks (every season), their races, and which races have a result in.
export async function loadWeekIndex() {
  const [weeks, races, winners] = await Promise.all([
    supabase.from('race_weeks').select('id, week_number, saturday_date').then(must),
    fetchAll(() => supabase.from('races').select('id, race_week_id').order('id')),
    fetchAll(() => supabase.from('results').select('race_id').eq('position', 1).order('id')),
  ])
  return { weeks, races, won: new Set(winners.map(r => r.race_id)) }
}

// Festivals, their days and races, and which races have a result in.
export async function loadFestivalIndex() {
  const [festivals, days, races, winners] = await Promise.all([
    supabase.from('festivals').select('id, name, display_name, start_date, end_date, venue').then(must),
    supabase.from('festival_days').select('id, festival_id, day_number, race_date').then(must),
    fetchAll(() => supabase.from('festival_races').select('id, festival_day_id').order('id')),
    fetchAll(() => supabase.from('festival_results').select('festival_race_id').eq('position', 1).order('id')),
  ])
  return { festivals, days, races, won: new Set(winners.map(r => r.festival_race_id)) }
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

// Everything one Saturday race week needs for the signed-in player.
export async function loadWeekPeriod(userId, period) {
  const { races, rest } = await fetchPeriod(
    period.raceIds,
    () => supabase
      .from('races').select('id, race_number, race_time, venue, race_name')
      .eq('race_week_id', period.id).order('race_number').then(must),
    ids => Promise.all([
      supabase.from('results').select('race_id, position, horse_name, starting_price_display').in('race_id', ids).then(must),
      supabase.from('picks').select('race_id, runner_id, was_replaced').eq('user_id', userId).in('race_id', ids).then(must),
      supabase.from('scores')
        .select('race_id, total_points, position_achieved, bet_type, place_token_points')
        .eq('user_id', userId).in('race_id', ids).then(must),
    ]),
  )
  if (!rest) return { races, results: [], picks: [], runners: [], scores: [] }
  const [results, picks, scores] = rest
  const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
  const runners = runnerIds.length
    ? must(await supabase.from('runners')
        .select('id, horse_name, silk_colour, silk_colour_secondary, is_withdrawn').in('id', runnerIds))
    : []
  return { races, results, picks, runners, scores }
}

// The same for one festival day. Rows are mapped to the shape the weekly ones have.
export async function loadFestivalPeriod(userId, period) {
  const { races, rest } = await fetchPeriod(
    period.raceIds,
    () => supabase
      .from('festival_races').select('id, race_number, race_time, venue, race_name')
      .eq('festival_day_id', period.id).order('race_number').then(must),
    ids => Promise.all([
      supabase.from('festival_results').select('festival_race_id, position, horse_name, starting_price_display')
        .in('festival_race_id', ids).then(must),
      supabase.from('festival_picks').select('festival_race_id, runner_id, was_replaced')
        .eq('user_id', userId).in('festival_race_id', ids).then(must),
      supabase.from('festival_scores')
        .select('festival_race_id, total_points, position_achieved, bet_type, place_token_points')
        .eq('user_id', userId).in('festival_race_id', ids).then(must),
    ]),
  )
  if (!rest) return { races, results: [], picks: [], runners: [], scores: [] }
  const [results, picks, scores] = rest
  const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
  const runners = runnerIds.length
    ? must(await supabase.from('festival_runners')
        .select('id, horse_name, silk_colour, silk_colour_secondary, is_withdrawn').in('id', runnerIds))
    : []
  const toRace = ({ festival_race_id, ...rest }) => ({ race_id: festival_race_id, ...rest })
  return { races, results: results.map(toRace), picks: picks.map(toRace), runners, scores: scores.map(toRace) }
}
