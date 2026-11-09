// The Players tab: who has picked, who is drifting, who has notifications off. Pure functions over rows already
// read from Supabase; no database and no screen in here.
import { ukDateStr, lockMs, daysBetween } from './format.js'

const DAY_MS = 86400000

// "JH" from a username or name ("jack_h" -> "JH", "Amy" -> "A", "Amy Rose" -> "AR").
export function initials(name) {
  const parts = String(name || '').trim().split(/[\s._-]+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0][0] : parts[0][0] + parts[1][0]).toUpperCase()
}

export const displayName = p => p?.username || p?.full_name || 'Player'

// The race day players can pick for now: the first one dated today (UK) or later.
export function currentRaceDay(days, nowMs = Date.now()) {
  const today = ukDateStr(nowMs)
  return days.find(d => d.date >= today) || null
}

// Race days whose picks have locked, most recent first. `pickedByDay` is { dayKey: Set(userId) }. A locked day nobody picked
// on is skipped: it tells us nothing about who is playing.
export function lockedRaceDays(days, pickedByDay, nowMs = Date.now()) {
  return days
    .filter(d => nowMs >= lockMs(d.deadline, d.date) && (pickedByDay[d.key]?.size || 0) > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
}

// One row per player.
//   profiles     [{ id, username, full_name, email, created_at, is_admin, notifications_enabled, notifications_updated_at }]
//   days         race days that have races (adminToday.buildRaceDays rows), any order
//   pickedByDay  { 'week:<id>' | 'festival:<id>': Set(userId) }
// Returns { rows, current, last, recent }:  current = the race day to pick for, last = the latest locked race day,
// recent = the two latest locked race days.
export function buildPlayers({ profiles, days, pickedByDay }, nowMs = Date.now()) {
  const today = ukDateStr(nowMs)
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const current = currentRaceDay(sorted, nowMs)
  const locked = lockedRaceDays(sorted, pickedByDay, nowMs)
  const recent = locked.slice(0, 2)
  const played = id => sorted.filter(d => d.date <= today && pickedByDay[d.key]?.has(id))

  const rows = profiles.map(p => {
    const mine = played(p.id)
    const lastDay = mine.length ? mine[mine.length - 1] : null
    const joined = p.created_at ? ukDateStr(Date.parse(p.created_at)) : null
    const inRecent = recent.some(d => pickedByDay[d.key]?.has(p.id))
    return {
      id: p.id, name: displayName(p), username: p.username || '', fullName: p.full_name || '', email: p.email || '', isAdmin: !!p.is_admin,
      joined, joinedMs: p.created_at ? Date.parse(p.created_at) : null,
      lastPlayed: lastDay ? { date: lastDay.date, title: lastDay.title, key: lastDay.key } : null,
      picked: current ? !!pickedByDay[current.key]?.has(p.id) : null,
      notifications: p.notifications_enabled === true ? true : p.notifications_enabled === false ? false : null,
      notificationsAt: p.notifications_updated_at || null,
      drifting: !!lastDay && recent.length > 0 && !inRecent && daysBetween(lastDay.date, today) <= 30,
      isNew: !!p.created_at && nowMs - Date.parse(p.created_at) <= 7 * DAY_MS && nowMs >= Date.parse(p.created_at),
    }
  }).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  return { rows, current, last: locked[0] || null, recent }
}

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'notpicked', label: 'Not picked' },
  { id: 'notifoff', label: 'Notifications off' },
  { id: 'drifting', label: 'Drifting' },
  { id: 'new', label: 'New' },
]

const TESTS = {
  all: () => true,
  notpicked: r => r.picked === false,
  notifoff: r => r.notifications === false,
  drifting: r => r.drifting,
  new: r => r.isNew,
}

export const filterPlayers = (rows, filter) => rows.filter(TESTS[filter] || TESTS.all)

// The search box: every word typed has to appear in the player's name, username or email (any case). An empty
// search keeps everyone.
export function searchPlayers(rows, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return rows
  return rows.filter(r => {
    const hay = `${r.name} ${r.username} ${r.fullName} ${r.email}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}
export const filterCounts = rows => Object.fromEntries(FILTERS.map(f => [f.id, rows.filter(TESTS[f.id]).length]))

// The three tiles.
export function summarise(rows, current) {
  return {
    total: rows.length,
    picked: rows.filter(r => r.picked === true).length,
    hasCurrent: !!current,
    off: rows.filter(r => r.notifications === false).length,
    unknown: rows.filter(r => r.notifications === null).length,
  }
}

// Groups: one row each with the creator, member count and how many members picked on the last race day.
//   groups   [{ id, name, invite_code, created_by, created_at }]
//   members  [{ group_id, user_id, is_founder, joined_at }]
//   names    { userId: display name }
export function buildGroups({ groups, members, names, pickedByDay }, last) {
  const byGroup = {}
  members.forEach(m => { (byGroup[m.group_id] ||= []).push(m) })
  return groups.map(g => {
    const list = byGroup[g.id] || []
    const picked = last ? list.filter(m => pickedByDay[last.key]?.has(m.user_id)).length : null
    return {
      id: g.id, name: g.name, code: g.invite_code, createdAt: g.created_at, creatorId: g.created_by,
      creatorName: g.created_by ? names[g.created_by] || 'Unknown player' : 'No creator',
      memberCount: list.length, picked, memberIds: list.map(m => m.user_id),
    }
  }).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}
