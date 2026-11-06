// Supabase reads for the Leaderboard pages. These are the loaders that used to live inside
// pages/League.jsx, moved here so the hub and the full-table pages share them. Read-only: points
// come from scores / festival_scores as stored, and nothing here writes.
//
// Ranking uses the shared helpers in standings.js (orderIds, festivalTotals, weekDayStanding), the
// same ones the Results page and Home use, so a player's position matches everywhere.
import { supabase } from './supabase'
import { monthLong } from './format.js'
import { orderIds, festivalTotals, weekDayStanding } from './standings.js'

// ── Saturday League ───────────────────────────────────────────
// { season, currentWeek, satRows, weekRows, completedWeeks }, or null when there is no active season.
//   satRows        every registered player, season table, best first
//   weekRows       the latest week: everyone who picked or scored, best first (needs withWeek)
//   completedWeeks weeks with at least one score, oldest first
export async function loadSaturdayLeague(myUserId, { withWeek = true, seasonId = null } = {}) {
  // Every registered user appears even with 0 pts, so the names don't wait on the season.
  const namesLoaded = (async () => {
    const { data: allProfileData } = await supabase.from('profiles').select('id')
    const ids = [...new Set([...(allProfileData || []).map(p => p.id), myUserId])]
    const { data: profData } = await supabase.rpc('get_user_names', { user_ids: ids })
    return { allProfileIds: ids, profData }
  })()

  // The active season, or a past one by id (the Past pages).
  const seasonQ = supabase.from('seasons').select('id, name, start_date, status, is_active')
  const { data: s } = await (seasonId ? seasonQ.eq('id', seasonId) : seasonQ.eq('is_active', true)).single()
  if (!s) return null

  const { data: weeks } = await supabase
    .from('race_weeks').select('id, week_number, saturday_date')
    .eq('season_id', s.id).order('saturday_date', { ascending: false })
  const latestWeek = weeks?.[0] || null

  const weekIds = (weeks || []).map(w => w.id)
  let allRaceIds = [], weekRaceIds = [], raceWeekMap = {}
  if (weekIds.length) {
    const { data: allRaces } = await supabase
      .from('races').select('id, race_week_id').in('race_week_id', weekIds)
    if (allRaces?.length) {
      allRaceIds  = allRaces.map(r => r.id)
      weekRaceIds = latestWeek
        ? allRaces.filter(r => r.race_week_id === latestWeek.id).map(r => r.id)
        : []
      allRaces.forEach(r => { raceWeekMap[r.id] = r.race_week_id })
    }
  }

  let allScores = []
  if (allRaceIds.length) {
    const { data: everyone, error: evErr } = await supabase
      .from('scores').select('user_id, race_id, total_points, position_achieved').in('race_id', allRaceIds)
    if (!evErr && everyone?.length) allScores = everyone
  }
  // else: no races in this season yet — all scores stay []

  // Count 1st-place finishes per user for tiebreaker (season)
  const satWinsByUser = {}
  allScores.forEach(sc => {
    if (sc.position_achieved === 1) satWinsByUser[sc.user_id] = (satWinsByUser[sc.user_id] || 0) + 1
  })

  const { allProfileIds, profData } = await namesLoaded
  const nameMap = {}
  profData?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

  // Weeks with at least one score
  const weekHasScores = new Set()
  allScores.forEach(sc => {
    const wId = raceWeekMap[sc.race_id]
    if (wId) weekHasScores.add(wId)
  })
  const completedWeeks = (weeks || [])
    .filter(w => weekHasScores.has(w.id))
    .sort((a, b) => (a.week_number || 0) - (b.week_number || 0))

  // Init every registered user at 0, then layer scores on top
  const byUser = {}
  allProfileIds.forEach(uid => {
    byUser[uid] = {
      user_id: uid,
      name: nameMap[uid] || 'Player',
      isMe: uid === myUserId,
      seasonTotal: 0, weeksPlayed: new Set(), weekPoints: 0,
      weekPts: {},
    }
  })
  allScores.forEach(sc => {
    if (!byUser[sc.user_id]) return
    byUser[sc.user_id].seasonTotal += (sc.total_points || 0)
    const wId = raceWeekMap[sc.race_id]
    if (wId) {
      byUser[sc.user_id].weeksPlayed.add(wId)
      if (weekHasScores.has(wId)) {
        byUser[sc.user_id].weekPts[wId] = (byUser[sc.user_id].weekPts[wId] || 0) + (sc.total_points || 0)
      }
    }
  })

  // Season order: points, then winning picks, then name (orderIds, as in standings.js).
  const totals = {}
  const names = {}
  Object.values(byUser).forEach(u => { totals[u.user_id] = u.seasonTotal; names[u.user_id] = nameMap[u.user_id] || '' })
  const satRows = orderIds(totals, satWinsByUser, names)
    .map((uid, i) => ({ ...byUser[uid], rank: i + 1, weeksPlayed: byUser[uid].weeksPlayed.size }))

  // The latest week, ranked among everyone who picked that week (the Results ranking).
  let weekRows = []
  if (withWeek && weekRaceIds.length) {
    const st = await weekDayStanding(weekRaceIds)
    weekRows = st.order.map((uid, i) => ({
      user_id: uid, name: st.names[uid] || 'Player', isMe: uid === myUserId,
      weekPoints: st.totals[uid] || 0, winners: st.wins[uid] || 0, rank: i + 1,
    }))
  }

  return { season: s, currentWeek: latestWeek, satRows, weekRows, completedWeeks }
}

// ── Festivals ──
// (Which festival is live or recent: loadCurrentFestival in festivalData.js.)
// ── Past leagues and festivals (the hub's "Past" sheet) ──
// Festivals that have finished and have at least one race, newest first, each with the winner of
// its final table (the same table as the festival page). `excludeId` is the one the hub shows.
export async function loadPastFestivals(today, excludeId, myUserId) {
  const { data } = await supabase.from('festivals').select('*').order('end_date', { ascending: false })
  const ended = (data || []).filter(f => (f.end_date || f.start_date) < today && f.id !== excludeId)
  const list = await Promise.all(ended.map(async f => {
    const { data: days } = await supabase.from('festival_days').select('id').eq('festival_id', f.id)
    if (!days?.length) return null
    const { count } = await supabase.from('festival_races')
      .select('id', { count: 'exact', head: true }).in('festival_day_id', days.map(d => d.id))
    if (!count) return null
    const { rows } = await fetchFestivalRows(f, null, myUserId)
    const top = rows[0]
    return { festival: f, winner: top && top.points > 0 ? top.name : null }
  }))
  return list.filter(Boolean)
}

// Every season except the active one, newest first, with the winner of its final table (the same
// season ranking as the Saturday page). Seasons with no scores are left out.
export async function loadPastSeasons(myUserId) {
  const { data } = await supabase.from('seasons').select('id, name, start_date, is_active').order('start_date', { ascending: false })
  const past = (data || []).filter(s => !s.is_active)
  const list = await Promise.all(past.map(async s => {
    const d = await loadSaturdayLeague(myUserId, { withWeek: false, seasonId: s.id })
    if (!d || !d.completedWeeks.length) return null
    const top = d.satRows[0]
    return { season: d.season, winner: top && top.seasonTotal > 0 ? top.name : null }
  }))
  return list.filter(Boolean)
}

// "October 2026" for a season (its start date), or its name when it has none.
export function seasonLabel(season) {
  return season?.start_date ? `${monthLong(season.start_date)} ${season.start_date.slice(0, 4)}` : (season?.name || '')
}

// One festival by id, whatever its dates (the full table keeps working after it finishes).
export async function loadFestival(id) {
  const { data } = await supabase.from('festivals').select('*').eq('id', id).maybeSingle()
  return data || null
}

// The festival table: { rows, festDays }, rows best first and carrying dayPts { [dayNumber]: pts }.
// With memberIds, only those players (a group's table).
export async function fetchFestivalRows(fest, memberIds, myUserId) {
  // The days (then their races) and the entries are independent, so they load together.
  let entriesQ = supabase.from('festival_entries')
    .select('user_id, starting_points').eq('festival_id', fest.id)
  if (memberIds?.length) entriesQ = entriesQ.in('user_id', memberIds)
  const daysAndRaces = (async () => {
    const { data: daysData } = await supabase
      .from('festival_days').select('id, day_number, race_date').eq('festival_id', fest.id).order('day_number')
    if (!daysData?.length) return { daysData, raceIds: [] }
    const { data: races } = await supabase
      .from('festival_races').select('id').in('festival_day_id', daysData.map(d => d.id))
    return { daysData, raceIds: (races || []).map(r => r.id) }
  })()
  const [{ daysData, raceIds }, { data: entries }] = await Promise.all([daysAndRaces, entriesQ])
  if (!daysData?.length) return { rows: [], festDays: [] }
  if (!entries?.length) return { rows: [], festDays: daysData }

  const entryUserIds = entries.map(e => e.user_id)
  const festProfileIds = [...new Set([...entryUserIds, myUserId])]

  // Race scores (totals + tiebreaker wins), day-by-day points from festival_day_points, and
  // player names don't depend on each other, so they load together.
  const [scoresData, dayPointsData, profiles] = await Promise.all([
    raceIds.length
      ? supabase.from('festival_scores').select('user_id, total_points, position_achieved')
          .in('festival_race_id', raceIds).in('user_id', entryUserIds).then(({ data }) => data || [])
      : Promise.resolve([]),
    supabase.from('festival_day_points').select('user_id, day_number, points')
      .eq('festival_id', fest.id).in('user_id', memberIds?.length ? memberIds : entryUserIds)
      .then(({ data }) => data || []),
    supabase.rpc('get_user_names', { user_ids: festProfileIds }).then(({ data }) => data),
  ])

  // Day-points lookup: { userId: { dayNumber: pts } }
  const dayPtsMap = {}
  for (const dp of dayPointsData) {
    if (!dayPtsMap[dp.user_id]) dayPtsMap[dp.user_id] = {}
    dayPtsMap[dp.user_id][dp.day_number] = dp.points
  }

  const nameMap = {}
  profiles?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })
  const names = {}
  entryUserIds.forEach(id => { names[id] = nameMap[id] || '' })

  // The same totals and order festivalRank uses (Results, Home): starting points + festival
  // scores, then winning picks, then name.
  const { totals, wins } = festivalTotals(entries, scoresData)
  const rows = orderIds(totals, wins, names).map((uid, i) => ({
    rank: i + 1, userId: uid, points: totals[uid],
    wins: wins[uid] || 0,
    name: nameMap[uid] || 'Player',
    isMe: uid === myUserId,
    dayPts: dayPtsMap[uid] || {},
  }))

  return { rows, festDays: daysData }
}

// ── My groups ─────────────────────────────────────────────────
export async function loadMyGroups(userId) {
  const { data: memberships } = await supabase
    .from('group_members')
    .select('is_founder, groups(id, name, invite_code, created_by)')
    .eq('user_id', userId)
  const mine = (memberships || []).filter(m => m.groups)
  return Promise.all(
    mine.map(async m => {
      const g = m.groups
      const { count } = await supabase
        .from('group_members').select('id', { count: 'exact', head: true }).eq('group_id', g.id)
      return { ...g, memberCount: count || 0, isFounder: m.is_founder }
    })
  )
}

// A group's members and its Saturday season table (best first, 0-point members included).
export async function fetchGroupSatRows(memberIds, myUserId) {
  // Names for all group members regardless of whether they have scores; they don't wait on the season.
  const groupProfileIds = [...new Set([...memberIds, myUserId])]
  const namesLoaded = supabase.rpc('get_user_names', { user_ids: groupProfileIds })
  const { data: season } = await supabase
    .from('seasons').select('id').eq('is_active', true).single()
  if (!season) return []
  const { data: weeks } = await supabase
    .from('race_weeks').select('id').eq('season_id', season.id)
  const weekIds = (weeks || []).map(w => w.id)
  const { data: groupProfiles } = await namesLoaded
  const groupNameMap = {}
  groupProfiles?.forEach(p => { groupNameMap[p.id] = p.username || p.full_name || null })

  const emptyRows = () => memberIds.map((uid, i) => ({
    rank: i + 1, userId: uid, points: 0, weekPts: {},
    name: groupNameMap[uid] || 'Player', isMe: uid === myUserId,
  }))

  if (!weekIds.length) return emptyRows()
  const { data: races } = await supabase
    .from('races').select('id, race_week_id').in('race_week_id', weekIds)
  const raceIds = (races || []).map(r => r.id)
  const raceWeekMap = {}
  races?.forEach(r => { raceWeekMap[r.id] = r.race_week_id })

  if (!raceIds.length) return emptyRows()

  const { data: scores } = await supabase
    .from('scores').select('user_id, race_id, total_points, position_achieved')
    .in('race_id', raceIds).in('user_id', memberIds)

  const totals = {}
  const weekPtsMap = {}
  const groupSatWins = {}
  for (const uid of memberIds) { totals[uid] = 0; weekPtsMap[uid] = {} }
  for (const s of (scores || [])) {
    totals[s.user_id] = (totals[s.user_id] || 0) + s.total_points
    const wId = raceWeekMap[s.race_id]
    if (wId) {
      if (!weekPtsMap[s.user_id]) weekPtsMap[s.user_id] = {}
      weekPtsMap[s.user_id][wId] = (weekPtsMap[s.user_id][wId] || 0) + s.total_points
    }
    if (s.position_achieved === 1) groupSatWins[s.user_id] = (groupSatWins[s.user_id] || 0) + 1
  }

  const names = {}
  Object.keys(totals).forEach(uid => { names[uid] = groupNameMap[uid] || '' })
  return orderIds(totals, groupSatWins, names).map((uid, i) => ({
    rank: i + 1, userId: uid, points: totals[uid],
    weekPts: weekPtsMap[uid] || {},
    name: groupNameMap[uid] || 'Player',
    isMe: uid === myUserId,
  }))
}

// The member ids of one group.
export async function loadGroupMemberIds(groupId) {
  const { data } = await supabase.from('group_members').select('user_id').eq('group_id', groupId)
  return (data || []).map(m => m.user_id)
}

// ── Annual League (hidden for now; nothing on the Leaderboard calls this yet) ──
export async function loadAnnualLeague(myUserId) {
  const { data: seasons26 } = await supabase
    .from('seasons').select('id, name, start_date')
    .eq('year', 2026)
    .order('start_date', { ascending: true })
  if (!seasons26?.length) return { rows: [], seasons: [] }

  const seasonIds = seasons26.map(s => s.id)
  const { data: allWeeks } = await supabase
    .from('race_weeks').select('id, season_id').in('season_id', seasonIds)
  const weekIds = (allWeeks || []).map(w => w.id)

  const weekSeasonMap = {}
  allWeeks?.forEach(w => { weekSeasonMap[w.id] = w.season_id })

  let allRaceIds = []
  const raceSeasonMap = {}
  if (weekIds.length) {
    const { data: allRaces } = await supabase
      .from('races').select('id, race_week_id').in('race_week_id', weekIds)
    allRaceIds = (allRaces || []).map(r => r.id)
    allRaces?.forEach(r => { raceSeasonMap[r.id] = weekSeasonMap[r.race_week_id] })
  }

  let allScores = []
  if (allRaceIds.length) {
    const { data: scores } = await supabase
      .from('scores').select('user_id, race_id, total_points, position_achieved').in('race_id', allRaceIds)
    allScores = scores || []
  }

  // Fetch all profiles — every registered user appears even with 0 pts
  const { data: annualProfileData } = await supabase.from('profiles').select('id')
  const annualProfileIds = [...new Set([...(annualProfileData || []).map(p => p.id), myUserId])]
  const { data: profiles } = await supabase.rpc('get_user_names', { user_ids: annualProfileIds })
  const nameMap = {}
  profiles?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

  // Init every registered user at 0, then layer scores on top
  const byUser = {}
  annualProfileIds.forEach(uid => { byUser[uid] = { user_id: uid, total: 0, seasonPts: {} } })
  const annualWinsByUser = {}
  for (const sc of allScores) {
    if (!byUser[sc.user_id]) byUser[sc.user_id] = { user_id: sc.user_id, total: 0, seasonPts: {} }
    byUser[sc.user_id].total += (sc.total_points || 0)
    const sId = raceSeasonMap[sc.race_id]
    if (sId) byUser[sc.user_id].seasonPts[sId] = (byUser[sc.user_id].seasonPts[sId] || 0) + (sc.total_points || 0)
    if (sc.position_achieved === 1) annualWinsByUser[sc.user_id] = (annualWinsByUser[sc.user_id] || 0) + 1
  }

  const totals = {}
  const names = {}
  Object.values(byUser).forEach(u => { totals[u.user_id] = u.total; names[u.user_id] = nameMap[u.user_id] || '' })
  const rows = orderIds(totals, annualWinsByUser, names).map((uid, i) => ({
    rank: i + 1, userId: uid, name: nameMap[uid] || 'Player',
    isMe: uid === myUserId, total: byUser[uid].total, seasonPts: byUser[uid].seasonPts,
  }))
  return { rows, seasons: seasons26 }
}
