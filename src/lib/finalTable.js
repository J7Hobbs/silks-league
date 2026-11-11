// The festival wrap-up ("Final" page): places, scopes and the figures on it. Pure: plain rows in, plain rows out, no database
// and nothing festival-specific except finalPath, so a monthly season wrap-up can reuse the builders.
import { ordinal } from '../../supabase/functions/_shared/format.js'

export const finalPath = festivalId => `/festival/${festivalId}/final`

// ── Is the festival over? ──────────────────────────────────────────────────────────────────────────────────────
// Its wrap-up exists once every race on its LAST day has a result or is abandoned. Pure: the last day's races and the
// ids of the ones that have a result.
export function lastDayDone(races, resultRaceIds) {
  if (!races?.length) return false
  const have = new Set(resultRaceIds || [])
  return races.every(r => r.is_abandoned || have.has(r.id))
}

// ── Places ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Players with the same points share a place (1, 2, 2, 4). Rows are listed best first, and inside a tie in the order
// the Leaderboard uses (winning picks, then name). `rows`: [{ id, name, points, wins }].
// -> [{ id, name, points, wins, place, tied, label }]  label is "4th", or "=4th" for a tie.
export function placeRows(rows) {
  const sorted = [...rows].sort((a, b) =>
    b.points - a.points || (b.wins || 0) - (a.wins || 0) || (a.name || '').localeCompare(b.name || ''))
  return sorted.map(r => {
    const better = sorted.filter(o => o.points > r.points).length
    const same = sorted.filter(o => o.points === r.points).length
    return { ...r, place: better + 1, tied: same > 1, label: `${same > 1 ? '=' : ''}${ordinal(better + 1)}` }
  })
}

// ── Scopes ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Everyone, plus each of the player's groups that has at least two entrants. `entrants` are the players on the table
// (at least one pick). `groups`: [{ id, name }], `members`: { [groupId]: [userId] }.
// -> [{ key, label, ids|null }]  key is 'everyone' or the group id; ids is null for everyone.
export function scopesFor(entrants, groups, members) {
  const have = new Set(entrants.map(e => e.id))
  const out = [{ key: 'everyone', label: 'Everyone', ids: null }]
  for (const g of [...groups].sort((a, b) => a.name.localeCompare(b.name))) {
    const ids = [...new Set(members[g.id] || [])].filter(id => have.has(id))
    if (ids.length >= 2) out.push({ key: g.id, label: g.name, ids })
  }
  return out
}

// The placed table for one scope.
export const rowsInScope = (entrants, scope) => placeRows(scope?.ids ? entrants.filter(e => scope.ids.includes(e.id)) : entrants)

// Which chip to open on: the remembered one if it is still offered, otherwise Everyone.
export function openScope(scopes, remembered) {
  if (remembered?.kind === 'group') return scopes.find(s => s.key === remembered.id)?.key || 'everyone'
  return 'everyone'
}

// What the screen shows for one scope.
//   podium  the first three, as { slot: 'first' | 'second' | 'third', ...row } in display order (2nd, 1st, 3rd)
//   rest    4th downwards
//   visible the rows shown before "See full table": the first three of `rest`, plus the player's row when lower down
//   hidden  how many rows "See full table" adds
export function finalView(entrants, scope, meId, collapsedRows = 3) {
  const rows = rowsInScope(entrants, scope).map(r => ({ ...r, isMe: r.id === meId }))
  const top = rows.slice(0, 3)
  const bySlot = { first: top[0], second: top[1], third: top[2] }
  const podium = ['second', 'first', 'third'].filter(s => bySlot[s]).map(s => ({ slot: s, ...bySlot[s] }))
  const rest = rows.slice(3)
  const head = rest.slice(0, collapsedRows)
  const mine = rest.find(r => r.isMe)
  const visible = mine && !head.includes(mine) ? [...head, mine] : head
  return { rows, podium, rest, visible, hidden: rest.length - visible.length, me: rows.find(r => r.isMe) || null, total: rows.length }
}

// "Your meeting" positions: one per table the player is in, in chip order. The selected chip's is `current`.
// -> [{ key, label, place, total, current }]  place like "=4th"
export function meetingPositions(entrants, scopes, meId, selectedKey) {
  const out = []
  for (const s of scopes) {
    const rows = rowsInScope(entrants, s)
    const me = rows.find(r => r.id === meId)
    if (me) out.push({ key: s.key, label: s.label, place: me.label, total: rows.length, current: s.key === selectedKey })
  }
  return out
}

// ── The player's own figures ───────────────────────────────────────────────────────────────────────────────────
const outcomeOf = position => (position === 1 ? 'Won' : position >= 2 ? `Placed ${ordinal(position)}` : '')

// `days`: [{ dayNumber, rows }] where rows are buildResultRows() rows for that day. `dayPts`: { [dayNumber]: points }.
// -> { winners, picked, best, bestDay }
//    winners/picked  winning picks out of the races they picked in (an abandoned race is not a race they played)
//    best            the highest-scoring single pick (points as stored: banker and race bonuses included), or null
//    bestDay         { dayNumber, points } for the day with the most points, or null
export function myFigures(days, dayPts) {
  let winners = 0, picked = 0, best = null
  for (const d of days) {
    for (const r of d.rows) {
      if (!r.pick || r.abandoned) continue
      picked++
      if (r.played && r.position === 1) winners++
      if (r.played && r.points > 0 && (!best || r.points > best.points)) {
        best = { horse: r.pick.name, price: r.pick.price, outcome: outcomeOf(r.position) || 'Scored', dayNumber: d.dayNumber, points: r.points, banker: r.banker }
      }
    }
  }
  let bestDay = null
  for (const [n, pts] of Object.entries(dayPts || {})) {
    const dayNumber = Number(n)
    if (!bestDay || pts > bestDay.points || (pts === bestDay.points && dayNumber < bestDay.dayNumber)) bestDay = { dayNumber, points: pts }
  }
  return { winners, picked, best, bestDay }
}


// For the Leaderboard card and Home: the champion and the player's place, from rows fetchFestivalRows already read.
export function finalSummary(rows, scoredIds, meId) {
  const picked = new Set(scoredIds || [])
  const placed = placeRows(rows.filter(r => picked.has(r.userId)).map(r => ({ id: r.userId, name: r.name, points: r.points, wins: r.wins })))
  const champion = placed[0] || null
  const mine = placed.find(r => r.id === meId) || null
  return { champion, mine, total: placed.length }
}
