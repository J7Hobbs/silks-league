// Pure helpers for the Leaderboard page, kept apart from Supabase so they are easy to test.
import { monthLong, daysBetween } from './format.js'

// "obarratt" -> "OB", "Jack Hobbs" -> "JH", "Jack" -> "JA". Empty when there is no name.
export function initialsFor(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Line under the points on the position card. `rows` are ranked, best first.
export function positionLine(me, rows) {
  const leader = rows[0]
  if (!me || !leader) return ''
  if (me.rank === 1) return "You're top of the table"
  if (me.points === leader.points) return 'Level with the leader'
  return `${leader.points - me.points} behind ${leader.name}`
}

// "November season" from the season's start date; falls back to its name.
export function seasonMonth(season) {
  if (!season) return ''
  return season.start_date ? monthLong(season.start_date) : (season.name || '')
}

// "Wk1 48 · Wk2 33" for the weeks that have scores; "–" where the player missed one.
export function weekSubLine(weekPts, completedWeeks) {
  return completedWeeks
    .map(w => `Wk${w.week_number} ${weekPts?.[w.id] ?? '–'}`)
    .join(' · ')
}

// "Fri 34 · Sat 12", one entry per festival day; "–" where there are no points.
export function dayLabel(day) {
  if (!day.race_date) return `D${day.day_number}`
  return new Date(day.race_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
}
export function festSubLine(dayPts, festDays) {
  return festDays.map(d => `${dayLabel(d)} ${dayPts?.[d.day_number] ?? '–'}`).join(' · ')
}

export function winnersLine(n) {
  return `${n} ${n === 1 ? 'winner' : 'winners'}`
}

export function allZero(rows) {
  return rows.every(r => !r.points)
}

const byName = (a, b) => (a.name || '').localeCompare(b.name || '')
const ranked = rows => rows.map((r, i) => ({ ...r, rank: i + 1 }))

// This week for the whole Saturday League: players with points first (in the
// order the page already ranks them), then everyone else on 0.
export function weekRowsForAll(weekRows, seasonRows) {
  const scored = new Set(weekRows.map(r => r.user_id))
  const rest = seasonRows
    .filter(r => !scored.has(r.user_id))
    .map(r => ({ user_id: r.user_id, name: r.name, isMe: r.isMe, weekPoints: 0, racesScored: 0, winners: 0 }))
    .sort(byName)
  return ranked([...weekRows, ...rest])
}

// This week for one group: its members only, same order as the full table.
export function weekRowsForGroup(weekRows, groupRows) {
  const members = new Set(groupRows.map(r => r.userId))
  const scored = weekRows.filter(r => members.has(r.user_id))
  const done = new Set(scored.map(r => r.user_id))
  const rest = groupRows
    .filter(r => !done.has(r.userId))
    .map(r => ({ user_id: r.userId, name: r.name, isMe: r.isMe, weekPoints: 0, racesScored: 0, winners: 0 }))
    .sort(byName)
  return ranked([...scored, ...rest])
}


// ═══ The Leaderboard hub ═══

// The festival the hub shows a card for: switched on, started, and either still running or
// finished within the last 7 days (the latest such one; a running one wins). Null when none.
//   -> { festival, live } where live is true until its last day is over.
export function hubFestival(festivals, today) {
  let best = null
  for (const f of festivals || []) {
    if (!f.is_active || !f.start_date || f.start_date > today) continue
    const end = f.end_date || f.start_date
    if (daysBetween(end, today) > 7) continue
    const live = end >= today
    if (!best || (live && !best.live) || (live === best.live && f.start_date > best.festival.start_date)) best = { festival: f, live }
  }
  return best
}

// "November · after week 2", or "November · no results yet".
export function satHubSub(season, completedWeeks) {
  const month = seasonMonth(season)
  const last = completedWeeks[completedWeeks.length - 1]
  return [month, last ? `after week ${last.week_number}` : 'no results yet'].filter(Boolean).join(' · ')
}

// "After day 2 of 4", "Final table" once it is over, or "4 days · no results yet" before day 1 is scored.
export function festHubSub(rows, festDays, live) {
  if (!live) return 'Final table'
  const scored = rows.flatMap(r => Object.keys(r.dayPts || {}).map(Number))
  const done = scored.length ? Math.max(...scored) : 0
  return done ? `After day ${done} of ${festDays.length}` : `${festDays.length} ${festDays.length === 1 ? 'day' : 'days'} · no results yet`
}

// The top of a table for a hub card: the first `size` rows, plus the player's own row when
// they are outside them (it is pinned under the list).
export function previewRows(rows, size = 5) {
  const me = rows.find(r => r.isMe)
  return { top: rows.slice(0, size), pinned: me && me.rank > size ? me : null }
}
