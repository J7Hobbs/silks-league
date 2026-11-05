// Group standings for the Groups page ("You're 2nd of 9").
//
// These follow the same rules as the group table on the Leaderboard page (Season view):
// the active monthly season, every member counted (0 points included), ranked by points,
// then winning picks, then name. Reading only; nothing is written.
import { supabase } from './supabase'
import { orderIds } from './standings.js'

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

// { [groupId]: [userId, …] } for these groups.
export async function loadMembers(groupIds) {
  const members = {}
  groupIds.forEach(id => { members[id] = [] })
  if (!groupIds.length) return members
  const { data } = await supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds)
  ;(data || []).forEach(r => { if (members[r.group_id]) members[r.group_id].push(r.user_id) })
  return members
}

// The active season's scores as { totals(userId), wins(userId) } maps, or empty ones when
// there is no active season or no races yet.
async function seasonScores() {
  const { data: season } = await supabase.from('seasons').select('id').eq('is_active', true).single()
  if (!season) return []
  const { data: weeks } = await supabase.from('race_weeks').select('id').eq('season_id', season.id)
  const weekIds = (weeks || []).map(w => w.id)
  if (!weekIds.length) return []
  const { data: races } = await supabase.from('races').select('id').in('race_week_id', weekIds)
  const raceIds = (races || []).map(r => r.id)
  if (!raceIds.length) return []
  return fetchAll(() => supabase.from('scores').select('id, user_id, total_points, position_achieved').in('race_id', raceIds))
}

// Standing of every group in `members` ({ groupId: [userIds] }), for `userId`.
// -> { [groupId]: { order, names, points, me, anyPoints } }
//    order     member ids, best first
//    points    { userId: points this season }
//    me        { rank, total, points } or null if userId isn't a member
//    anyPoints true once anyone in the group has scored
export async function loadStandings(userId, members) {
  const everyone = [...new Set([userId, ...Object.values(members).flat()])]
  const [scores, namesRes] = await Promise.all([
    seasonScores(),
    supabase.rpc('get_user_names', { user_ids: everyone }),
  ])
  const names = {}
  ;(namesRes.data || []).forEach(p => { names[p.id] = p.username || p.full_name || '' })

  const result = {}
  for (const [groupId, ids] of Object.entries(members)) {
    const inGroup = new Set(ids)
    const totals = {}
    const wins = {}
    ids.forEach(id => { totals[id] = 0 })
    for (const s of scores) {
      if (!inGroup.has(s.user_id)) continue
      totals[s.user_id] += s.total_points || 0
      if (s.position_achieved === 1) wins[s.user_id] = (wins[s.user_id] || 0) + 1
    }
    const order = orderIds(totals, wins, names)
    const idx = order.indexOf(userId)
    result[groupId] = {
      order,
      names,
      points: totals,
      me: idx < 0 ? null : { rank: idx + 1, total: order.length, points: totals[userId] },
      anyPoints: order.some(id => totals[id] > 0),
    }
  }
  return result
}
