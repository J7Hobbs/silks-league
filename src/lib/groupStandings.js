// Group standings for the Groups page ("You're 2nd of 9").
//
// These follow the same rules as the group table on the Leaderboard page (Season view):
// the active monthly season, every member counted (0 points included), ranked by points,
// then winning picks, then name. Reading only; nothing is written.
import { supabase } from './supabase'
import { orderIds } from './standings.js'
import { weekRaces, weekScores } from './weekSource.js'

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
  const { data: weeks } = await supabase.from('race_weeks').select('id, festival_day_id').eq('season_id', season.id)
  if (!weeks?.length) return []
  // A week linked to a festival day has that day's races and points (weekSource.js).
  const races = await weekRaces(weeks).catch(() => [])
  if (!races.length) return []
  return weekScores(races, { cols: ['id', 'user_id', 'race_id', 'total_points', 'position_achieved'] }).catch(() => [])
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
