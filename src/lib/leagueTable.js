// Pure builders for the Leaderboard tables with columns (one per race week or festival day).
// Display only: totals and order come from the existing ranking (the callers pass players already
// ranked); this adds the per-week / per-day cells, the best of each column and the movement arrows.
import { orderIds, festivalTotals } from './standings.js'
import { dayLabel } from './leagueView.js'

// "▲2" / "▼1" arrows need the position before the latest week or day. A player with no score rows
// before it is new, and gets no arrow, as does anyone who has not moved.
function moveOf(hadBefore, beforeRank, rank) {
  if (!hadBefore || !beforeRank) return null
  const m = beforeRank - rank
  return m || null
}

// Mark the highest score in each column that has results (ties all count; zero never does).
function markBest(rows, columns, hasResults) {
  columns.forEach(c => {
    if (!hasResults[c.key]) return
    const max = Math.max(0, ...rows.map(r => r.cells[c.key] ?? 0))
    if (max <= 0) return
    rows.forEach(r => { if (r.cells[c.key] === max) r.best[c.key] = true })
  })
}

// Saturday League season table.
//   players   [{ id, name, isMe, rank, total }] ranked, best first
//   weeks     the race weeks that have locked, oldest first: [{ id, week_number }]
//   raceWeek  { [raceId]: weekId }
//   scoreRows [{ user_id, race_id, total_points, position_achieved }]
//   pickRows  [{ user_id, race_id }]
//   names     { [id]: name } as the ranking sees them (for ties)
// -> { columns: [{ key, label }], rows: [{ id, rank, name, isMe, points, cells, best, move }] }
//    cells[weekId] is the week's points, or null when the player made no picks that week.
export function buildSatTable({ players, weeks, raceWeek, scoreRows, pickRows, names }) {
  const columns = weeks.map(w => ({ key: w.id, label: `W${w.week_number}` }))
  const shown = new Set(weeks.map(w => w.id))
  const pts = {}        // user -> week -> points
  const seen = new Set() // `${user}|${week}` the player picked or scored in
  const hasResults = {} // week -> any score row
  for (const s of scoreRows) {
    const w = raceWeek[s.race_id]
    if (!w) continue
    pts[s.user_id] = pts[s.user_id] || {}
    pts[s.user_id][w] = (pts[s.user_id][w] || 0) + (s.total_points || 0)
    seen.add(`${s.user_id}|${w}`)
    hasResults[w] = true
  }
  for (const p of pickRows) {
    const w = raceWeek[p.race_id]
    if (w) seen.add(`${p.user_id}|${w}`)
  }

  const rows = players.map(p => {
    const cells = {}
    weeks.forEach(w => { cells[w.id] = seen.has(`${p.id}|${w.id}`) ? (pts[p.id]?.[w.id] || 0) : null })
    return { id: p.id, rank: p.rank, name: p.name, isMe: p.isMe, points: p.total, cells, best: {}, move: null }
  })
  markBest(rows, columns, hasResults)

  // Movement: the ranking as it stood before the latest week that has scores.
  const scored = weeks.filter(w => hasResults[w.id])
  if (scored.length >= 2) {
    const latest = scored[scored.length - 1].id
    const totals = {}, wins = {}, had = new Set()
    players.forEach(p => { totals[p.id] = 0 })
    for (const s of scoreRows) {
      if (!(s.user_id in totals) || raceWeek[s.race_id] === latest || !shown.has(raceWeek[s.race_id])) continue
      totals[s.user_id] += s.total_points || 0
      had.add(s.user_id)
      if (s.position_achieved === 1) wins[s.user_id] = (wins[s.user_id] || 0) + 1
    }
    const before = {}
    orderIds(totals, wins, names).forEach((id, i) => { before[id] = i + 1 })
    rows.forEach(r => { r.move = moveOf(had.has(r.id), before[r.id], r.rank) })
  }
  return { columns, rows }
}

// Festival table.
//   players   [{ id, name, isMe, rank, total }] ranked, best first (total includes starting points)
//   days      [{ id, day_number, race_date }] in order
//   raceDay   { [festivalRaceId]: dayNumber }
//   dayPts    { [userId]: { [dayNumber]: points } } (festival_day_points)
//   scoreRows [{ user_id, festival_race_id, total_points, position_achieved }]
//   entries   [{ user_id, starting_points }]
// -> { columns: [{ key, label, dim }], rows: [...] } as buildSatTable. A day nobody has points for
//    yet is dim ("not raced yet").
export function buildFestTable({ players, days, raceDay, dayPts, scoreRows, entries, names }) {
  const raced = {}
  Object.values(dayPts).forEach(byDay => Object.keys(byDay).forEach(d => { raced[d] = true }))
  scoreRows.forEach(s => { const d = raceDay[s.festival_race_id]; if (d) raced[d] = true })
  const columns = days.map(d => ({ key: d.day_number, label: dayLabel(d), dim: !raced[d.day_number] }))

  // A player with score rows on a day but no festival_day_points row for it (all of them 0) still played.
  const scored = {}
  scoreRows.forEach(s => {
    const d = raceDay[s.festival_race_id]
    if (d) scored[`${s.user_id}|${d}`] = (scored[`${s.user_id}|${d}`] || 0) + (s.total_points || 0)
  })
  const rows = players.map(p => {
    const cells = {}
    days.forEach(d => {
      const stored = dayPts[p.id]?.[d.day_number]
      cells[d.day_number] = stored ?? (scored[`${p.id}|${d.day_number}`] === 0 ? 0 : null)
    })
    return { id: p.id, rank: p.rank, name: p.name, isMe: p.isMe, points: p.total, cells, best: {}, move: null }
  })
  markBest(rows, columns, raced)

  // Movement: the ranking as it stood before the latest day that has scores.
  const scoredDays = [...new Set(scoreRows.map(s => raceDay[s.festival_race_id]).filter(Boolean))].sort((a, b) => a - b)
  if (scoredDays.length >= 2) {
    const latest = scoredDays[scoredDays.length - 1]
    const earlier = scoreRows.filter(s => raceDay[s.festival_race_id] !== latest)
    const { totals, wins } = festivalTotals(entries, earlier)
    const had = new Set(earlier.map(s => s.user_id))
    const before = {}
    orderIds(totals, wins, names).forEach((id, i) => { before[id] = i + 1 })
    rows.forEach(r => { r.move = moveOf(had.has(r.id), before[r.id], r.rank) })
  }
  return { columns, rows }
}
