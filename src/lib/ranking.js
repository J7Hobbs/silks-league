// THE ranking rule for every table in the app (pure, no database): points, then number of winning picks, then name.
// standings.js re-exports orderIds, so the Leaderboard, Results, Home, groups and the festival Final page all order players with
// this one function and cannot drift apart.
import { ordinal } from '../../supabase/functions/_shared/format.js'

// Player ids best first: points, then number of winning picks, then name.
export function orderIds(totals, wins, names) {
  const ids = Object.keys(totals)
  ids.sort((a, b) =>
    totals[b] - totals[a] ||
    (wins[b] || 0) - (wins[a] || 0) ||
    (names[a] || '').localeCompare(names[b] || ''))
  return ids
}

// Rows [{ id, name, points, wins }] in that order, each with a place. The Leaderboard gives every row its own position (name is the
// last tie-break), so the ORDER is always the Leaderboard's. A place is shared only by players still level after the winning-picks
// tie-break (same points AND same winning picks), shown "=4th".
// -> [{ ...row, place, tied, label, mark }]  label "4th" / "=4th", mark "4" / "=4"
export function rankRows(rows) {
  const totals = {}, wins = {}, names = {}, byId = {}
  rows.forEach(r => { totals[r.id] = r.points; wins[r.id] = r.wins || 0; names[r.id] = r.name || ''; byId[r.id] = r })
  const order = orderIds(totals, wins, names)
  const level = (a, b) => totals[a] === totals[b] && wins[a] === wins[b]
  return order.map(id => {
    const place = 1 + order.filter(o => totals[o] > totals[id] || (totals[o] === totals[id] && wins[o] > wins[id])).length
    const tied = order.filter(o => level(o, id)).length > 1
    return { ...byId[id], place, tied, label: `${tied ? '=' : ''}${ordinal(place)}`, mark: `${tied ? '=' : ''}${place}` }
  })
}
