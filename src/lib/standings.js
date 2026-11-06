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

// Player ids best first: points, then number of winning picks, then name.
export function orderIds(totals, wins, names) {
  const ids = Object.keys(totals)
  ids.sort((a, b) =>
    totals[b] - totals[a] ||
    (wins[b] || 0) - (wins[a] || 0) ||
    (names[a] || '').localeCompare(names[b] || ''))
  return ids
}

// { rank, total, points } for userId, or null when they are not in `totals`.
export function rankOf(totals, wins, names, userId) {
  if (!(userId in totals)) return null
  const ids = orderIds(totals, wins, names)
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
    .select('id, race_id, user_id, total_points, position_achieved').in('race_id', raceIds))
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

// The standings table for one season, for the Home card: every player ordered the
// way rankOf orders them, with each player's movement. Movement is the change in
// position since before `referenceWeekId` (default: the latest week with scores), so a
// positive number means they moved up. It is null where there is nothing to compare:
// the player had no points before that week.
export async function seasonTable(userId, seasonId, referenceWeekId = null) {
  const idsLoaded = allProfileIds()
  const weekScores = (async () => {
    const { data: weeks } = await supabase.from('race_weeks').select('id, saturday_date').eq('season_id', seasonId)
    if (!weeks?.length) return { weeks: [], races: [], scores: [] }
    const { data: races } = await supabase.from('races').select('id, race_week_id').in('race_week_id', weeks.map(w => w.id))
    const scores = await scoresForRaces((races || []).map(r => r.id))
    return { weeks, races: races || [], scores }
  })()
  const namesLoaded = idsLoaded.then(ids => namesFor([...new Set([...ids, userId])]))
  const [ids, { weeks, races, scores }, names] = await Promise.all([idsLoaded, weekScores, namesLoaded])

  const everyone = [...new Set([...ids, userId])]
  const weekOfRace = Object.fromEntries(races.map(r => [r.id, r.race_week_id]))

  let reference = referenceWeekId
  if (!reference) {
    const scored = new Set(scores.map(s => weekOfRace[s.race_id]))
    reference = weeks.filter(w => scored.has(w.id))
      .sort((a, b) => (a.saturday_date < b.saturday_date ? 1 : -1))[0]?.id || null
  }

  const totals = {}, wins = {}, beforeTotals = {}, beforeWins = {}
  everyone.forEach(id => { totals[id] = 0; beforeTotals[id] = 0 })
  tally(scores, totals, wins)
  tally(scores.filter(s => !reference || weekOfRace[s.race_id] !== reference), beforeTotals, beforeWins)

  const order = orderIds(totals, wins, names)
  const beforeRank = Object.fromEntries(orderIds(beforeTotals, beforeWins, names).map((id, i) => [id, i + 1]))
  const rows = order.map((id, i) => ({
    id,
    name: names[id] || '',
    points: totals[id],
    rank: i + 1,
    move: beforeTotals[id] > 0 ? beforeRank[id] - (i + 1) : null,
  }))
  return { rank: rankOf(totals, wins, names, userId), rows }
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

// Rank for one festival day, among players with points that day (festival_day_points, the
// table the Festival leaderboard shows day by day). Ties break as everywhere else: points,
// then winning picks on that day, then name. Null if the player has no points that day.
export async function festivalDayRank(userId, festivalId, dayNumber, raceIds) {
  const { data: rows } = await supabase
    .from('festival_day_points').select('user_id, points')
    .eq('festival_id', festivalId).eq('day_number', dayNumber)
  const totals = {}
  ;(rows || []).forEach(r => { totals[r.user_id] = (totals[r.user_id] || 0) + (r.points || 0) })
  if (!(userId in totals)) return null
  const scores = raceIds?.length
    ? await fetchAll(() => supabase.from('festival_scores')
        .select('id, user_id, total_points, position_achieved').in('festival_race_id', raceIds))
    : []
  const wins = {}
  scores.forEach(s => {
    if (s.position_achieved === 1 && s.user_id in totals) wins[s.user_id] = (wins[s.user_id] || 0) + 1
  })
  const names = await namesFor(Object.keys(totals))
  return rankOf(totals, wins, names, userId)
}
