// Pure helpers for the Leaderboard page, kept apart from Supabase so they are easy to test.
import { monthLong } from './format.js'

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
