// Who the scheduled reminders go to, and when each one is due. Pure functions with no imports and no database, so the
// picks-deadline-reminder Edge Function and the tests use the same code. The wording is in notifyCopy.js.

const MIN = 60 * 1000

// Race days from this date have bonuses, so a banker can be set. Keep this the same as BONUS_RULES.startDate in
// src/lib/bonuses.js. Earlier race days have no bankers, so "no banker set" is never said for them.
export const BANKER_START_DATE = '2026-11-13'
export const bankersApply = date => !!date && String(date).slice(0, 10) >= BANKER_START_DATE

// Which notices are due for a race day whose picks lock at `deadlineIso`. The scheduler runs every 5 minutes, and each
// notice is logged once it has gone, so these are windows rather than exact moments:
//   two_hour   from 2 hours before the lock until 1h30 before
//   last_call  from 30 minutes before the lock until 15 minutes before
// Returns a list of 'two_hour' / 'last_call' (empty when neither is due).
export function dueKinds(deadlineIso, nowMs) {
  const t = new Date(deadlineIso).getTime()
  if (Number.isNaN(t)) return []
  const left = t - nowMs
  const out = []
  if (left <= 120 * MIN && left > 90 * MIN) out.push('two_hour')
  if (left <= 30 * MIN && left > 15 * MIN) out.push('last_call')
  return out
}

// Picks closing soon: every player who has not picked every race, grouped so everyone who gets the same message goes
// out in one send.
//   raceIds     the day's races        picks  [{ user_id, race_id, is_banker }]       playerIds  everyone
//   bankers     whether this race day has bankers (bankersApply)
// Returns [{ remaining, noBanker, userIds }].
export function planClosing({ raceIds, picks, playerIds, bankers }) {
  const total = raceIds.length
  if (!total) return []
  const picked = new Map(), banker = new Set()
  for (const p of picks) {
    if (!picked.has(p.user_id)) picked.set(p.user_id, new Set())
    picked.get(p.user_id).add(p.race_id)
    if (p.is_banker) banker.add(p.user_id)
  }
  const groups = new Map()
  for (const id of playerIds) {
    const remaining = total - (picked.get(id)?.size || 0)
    if (remaining <= 0) continue
    const noBanker = !!bankers && !banker.has(id)
    const key = `${remaining}|${noBanker}`
    if (!groups.has(key)) groups.set(key, { remaining, noBanker, userIds: [] })
    groups.get(key).userIds.push(id)
  }
  return [...groups.values()]
}

// Last call: only players with no picks at all for the race day.
export function planLastCall({ raceIds, picks, playerIds }) {
  if (!raceIds.length) return []
  const any = new Set(picks.map(p => p.user_id))
  return playerIds.filter(id => !any.has(id))
}
