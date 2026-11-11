// The festival wrap-up ("Final" page): is it available, and the reads behind it.
// Read-only. Nothing here scores anything: totals are the festival Leaderboard's own numbers (fetchFestivalRows in
// leagueData.js: starting points + festival_scores, bonuses included), and the player's own pick figures come from the
// same rows the Results page shows (resultsData.js + buildResultRows). The places, scopes and figures are built by the pure
// functions in finalTable.js.
import { supabase } from './supabase'
import { loadFestival, fetchFestivalRows, loadMyGroups } from './leagueData.js'
import { loadMembers } from './groupStandings.js'
import { loadFestivalPeriod } from './resultsData.js'
import { buildResultRows } from './resultsView.js'
import { lastDayDone, scopesFor, myFigures } from './finalTable.js'

export { finalPath } from './finalTable.js'

// { final, days, lastDay } for one festival. `days` are its festival_days rows (id, day_number, race_date) in order.
export async function festivalFinalStatus(festivalId) {
  const { data: days } = await supabase.from('festival_days')
    .select('id, day_number, race_date').eq('festival_id', festivalId).order('day_number')
  const list = days || []
  const lastDay = list[list.length - 1] || null
  if (!lastDay) return { final: false, days: list, lastDay: null }
  const { data: races } = await supabase.from('festival_races').select('id, is_abandoned').eq('festival_day_id', lastDay.id)
  if (!races?.length) return { final: false, days: list, lastDay }
  const { data: results } = await supabase.from('festival_results').select('festival_race_id').in('festival_race_id', races.map(r => r.id))
  return { final: lastDayDone(races, (results || []).map(r => r.festival_race_id)), days: list, lastDay }
}

// ── Loading ────────────────────────────────────────────────────────────────────────────────────────────────────
// { state: 'missing' } | { state: 'pending', festival } | { state: 'final', festival, entrants, groups, scopes, me }
//   entrants  players with at least one pick: [{ id, name, points, wins }]  (the Leaderboard's totals)
//   me        null when the player did not enter, else their figures { points, winners, picked, best, bestDay }
export async function loadFestivalFinal(festivalId, userId) {
  const festival = await loadFestival(festivalId)
  if (!festival) return { state: 'missing' }
  const status = await festivalFinalStatus(festivalId)
  if (!status.final) return { state: 'pending', festival }

  const { rows, scoredIds } = await fetchFestivalRows(festival, null, userId)
  // Only players with at least one pick count. A pick always has a score row (0 points still has one).
  const picked = new Set(scoredIds || [])
  const entrants = rows.filter(r => picked.has(r.userId)).map(r => ({ id: r.userId, name: r.name, points: r.points, wins: r.wins, dayPts: r.dayPts }))

  const groups = await loadMyGroups(userId).catch(() => [])
  const members = groups.length ? await loadMembers(groups.map(g => g.id)).catch(() => ({})) : {}
  const scopes = scopesFor(entrants, groups, members)

  const mine = entrants.find(e => e.id === userId)
  let me = null
  if (mine) {
    const { data: races } = await supabase.from('festival_races').select('id, festival_day_id').in('festival_day_id', status.days.map(d => d.id))
    const days = await Promise.all(status.days.map(async d => {
      const raceIds = (races || []).filter(r => r.festival_day_id === d.id).map(r => r.id)
      const period = await loadFestivalPeriod(userId, { id: d.id, raceIds }).catch(() => null)
      return { dayNumber: d.day_number, rows: period?.races?.length ? buildResultRows(period) : [] }
    }))
    me = { points: mine.points, ...myFigures(days, mine.dayPts) }
  }
  return { state: 'final', festival, entrants, groups, scopes, me, days: status.days }
}

