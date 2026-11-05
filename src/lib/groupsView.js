// Pure wording helpers for the Groups page.
import { initialsFor } from './leagueView.js'

// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 22 -> "22nd"
export function ordinal(n) {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

// "You're 2nd of 9", or "No points yet this month" until anyone in the group has scored.
// '' while the standings are still loading.
export function standingLine(info) {
  if (!info) return ''
  if (info.failed) return 'See the group table'
  if (!info.anyPoints || !info.me) return 'No points yet this month'
  return `You’re ${ordinal(info.me.rank)} of ${info.me.total}`
}

export function playersLine(count, isFounder) {
  return `${count} ${count === 1 ? 'player' : 'players'}${isFounder ? ' · You started it' : ''}`
}

// Up to `max` initial circles: the current user first (gold), then the others in table order.
export function circlesFor(info, myId, max = 4) {
  if (!info?.order) return []
  const ids = [myId, ...info.order.filter(id => id !== myId)].filter(id => info.order.includes(id))
  return ids.slice(0, max).map(id => ({ id, isMe: id === myId, initials: initialsFor(info.names[id]) || '?' }))
}
