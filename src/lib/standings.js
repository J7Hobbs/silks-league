import { supabase } from './supabase'

// Read-only ranking helpers for the Home page. Ties break the same way the
// League page does: points, then number of winning picks, then name.

async function allProfileIds() {
  const { data } = await supabase.from('profiles').select('id')
  return (data || []).map(p => p.id)
}

async function namesFor(ids) {
  if (!ids.length) return {}
  const { data } = await supabase.rpc('get_user_names', { user_ids: ids })
  const map = {}
  ;(data || []).forEach(p => { map[p.id] = p.username || p.full_name || '' })
  return map
}

// Page through a table: Supabase returns at most 1000 rows per request.
async function fetchAll(makeQuery) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().order('id').range(from, from + 999)
    if (error || !data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

function tally(rows, totals, wins) {
  for (const r of rows) {
    if (!(r.user_id in totals)) totals[r.user_id] = 0
    totals[r.user_id] += r.total_points || 0
    if (r.position_achieved === 1) wins[r.user_id] = (wins[r.user_id] || 0) + 1
  }
}

// { rank, total, points } for userId, or null when they are not in `totals`.
export function rankOf(totals, wins, names, userId) {
  if (!(userId in totals)) return null
  const ids = Object.keys(totals)
  ids.sort((a, b) =>
    totals[b] - totals[a] ||
    (wins[b] || 0) - (wins[a] || 0) ||
    (names[a] || '').localeCompare(names[b] || ''))
  return { rank: ids.indexOf(userId) + 1, total: ids.length, points: totals[userId] }
}

async function raceIdsForSeasons(seasonIds) {
  if (!seasonIds.length) return []
  const { data: weeks } = await supabase.from('race_weeks').select('id').in('season_id', seasonIds)
  if (!weeks?.length) return []
  const { data: races } = await supabase.from('races').select('id').in('race_week_id', weeks.map(w => w.id))
  return (races || []).map(r => r.id)
}

function scoresForRaces(raceIds) {
  if (!raceIds.length) return Promise.resolve([])
  return fetchAll(() => supabase.from('scores')
    .select('id, user_id, total_points, position_achieved').in('race_id', raceIds))
}

// Rank across one or more seasons (a single season, or every season in a year).
// Every registered player is included, so 0-point players still count.
export async function seasonsRank(userId, seasonIds) {
  const [ids, raceIds] = await Promise.all([allProfileIds(), raceIdsForSeasons(seasonIds)])
  const everyone = [...new Set([...ids, userId])]
  const [scores, names] = await Promise.all([scoresForRaces(raceIds), namesFor(everyone)])
  const totals = {}
  everyone.forEach(id => { totals[id] = 0 })
  const wins = {}
  tally(scores, totals, wins)
  return rankOf(totals, wins, names, userId)
}

// Rank for one race week, among players who scored that week.
export async function weekRank(userId, raceIds) {
  const scores = await scoresForRaces(raceIds)
  const totals = {}
  const wins = {}
  tally(scores, totals, wins)
  if (!(userId in totals)) return null
  const names = await namesFor(Object.keys(totals))
  return rankOf(totals, wins, names, userId)
}

// Rank in a festival, among entrants (starting points included). Null if not entered.
export async function festivalRank(userId, festivalId) {
  const { data: entries } = await supabase
    .from('festival_entries').select('user_id, starting_points').eq('festival_id', festivalId)
  if (!entries?.some(e => e.user_id === userId)) return null

  const { data: days } = await supabase.from('festival_days').select('id').eq('festival_id', festivalId)
  let raceIds = []
  if (days?.length) {
    const { data: races } = await supabase
      .from('festival_races').select('id').in('festival_day_id', days.map(d => d.id))
    raceIds = (races || []).map(r => r.id)
  }
  const scores = raceIds.length
    ? await fetchAll(() => supabase.from('festival_scores')
        .select('id, user_id, total_points, position_achieved').in('festival_race_id', raceIds))
    : []

  const totals = {}
  entries.forEach(e => { totals[e.user_id] = e.starting_points || 0 })
  const wins = {}
  tally(scores.filter(s => s.user_id in totals), totals, wins)
  const names = await namesFor(Object.keys(totals))
  return rankOf(totals, wins, names, userId)
}
