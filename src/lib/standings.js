import { supabase } from './supabase'
import { weekRaces, weekScores, weekPicks } from './weekSource.js'
import { orderIds } from './ranking.js'

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

// Player ids best first: points, then number of winning picks, then name. The one ranking rule lives in ranking.js.
export { orderIds }

// { rank, total, points } for userId, or null when they are not in `totals`.
export function rankOf(totals, wins, names, userId) {
  if (!(userId in totals)) return null
  const ids = orderIds(totals, wins, names)
  return { rank: ids.indexOf(userId) + 1, total: ids.length, points: totals[userId] }
}

// The races of these seasons' weeks. A week linked to a festival day has that day's races
// (weekSource.js), so a linked Saturday counts like any other week.
async function raceIdsForSeasons(seasonIds) {
  if (!seasonIds.length) return []
  const { data: weeks } = await supabase.from('race_weeks').select('id, festival_day_id').in('season_id', seasonIds)
  if (!weeks?.length) return []
  return weekRaces(weeks).catch(() => [])
}

// Score rows for races (race rows from weekRaces, or plain ids; festival races read festival_scores).
function scoresForRaces(races) {
  if (!races.length) return Promise.resolve([])
  return weekScores(races, { cols: ['id', 'race_id', 'user_id', 'total_points', 'position_achieved'] }).catch(() => [])
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
    const { data: weeks } = await supabase.from('race_weeks').select('id, saturday_date, festival_day_id').eq('season_id', seasonId)
    if (!weeks?.length) return { weeks: [], races: [], scores: [] }
    const races = await weekRaces(weeks).catch(() => [])
    const scores = await scoresForRaces(races)
    return { weeks, races, scores }
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

// Festival totals and winning picks per entrant: starting points plus festival scores. Shared by
// festivalRank (Results, Home) and the Leaderboard's festival tables, so both rank identically
// (order them with orderIds).
export function festivalTotals(entries, scoreRows) {
  const totals = {}
  entries.forEach(e => { totals[e.user_id] = e.starting_points || 0 })
  const wins = {}
  tally(scoreRows.filter(s => s.user_id in totals), totals, wins)
  return { totals, wins }
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

  const { totals, wins } = festivalTotals(entries, scores)
  const names = await namesFor(Object.keys(totals))
  return rankOf(totals, wins, names, userId)
}

// One race day's standings among everyone who made at least one pick that day (including players
// who scored 0). Points come from the day's score rows; ties break as everywhere else: points,
// then winning picks, then name. Anyone with a score row is counted too, so the list is never
// shorter than what the Leaderboard shows. { order, totals, wins, names } (order = ids, best first).
async function dayStanding(pickRows, scoreRows) {
  const totals = {}
  const wins = {}
  pickRows.forEach(r => { totals[r.user_id] = 0 })
  tally(scoreRows, totals, wins)
  const names = await namesFor(Object.keys(totals))
  return { order: orderIds(totals, wins, names), totals, wins, names }
}

// A Saturday League race week, or one festival day. The Results hero and the Leaderboard's
// "This week" table both read these.
export async function weekDayStanding(raceIds) {
  if (!raceIds?.length) return { order: [], totals: {}, wins: {}, names: {} }
  const [pickRows, scoreRows] = await Promise.all([
    weekPicks(raceIds, { cols: ['id', 'user_id'] }).catch(() => []),
    scoresForRaces(raceIds),
  ])
  return dayStanding(pickRows, scoreRows)
}

export async function festivalDayStanding(raceIds) {
  if (!raceIds?.length) return { order: [], totals: {}, wins: {}, names: {} }
  const [pickRows, scoreRows] = await Promise.all([
    fetchAll(() => supabase.from('festival_picks').select('id, user_id').in('festival_race_id', raceIds)),
    fetchAll(() => supabase.from('festival_scores')
      .select('id, user_id, total_points, position_achieved').in('festival_race_id', raceIds)),
  ])
  return dayStanding(pickRows, scoreRows)
}

// { rank, total, points } for userId on that day, or null if they did not pick.
const dayRankOf = (st, userId) => rankOf(st.totals, st.wins, st.names, userId)
export async function weekDayRank(userId, raceIds) { return dayRankOf(await weekDayStanding(raceIds), userId) }
export async function festivalDayRank(userId, raceIds) { return dayRankOf(await festivalDayStanding(raceIds), userId) }
