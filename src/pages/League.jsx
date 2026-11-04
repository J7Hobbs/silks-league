/**
 * Silks League — Leaderboard Page
 * One set of competition pills: Saturday League, running festivals, your groups.
 * Points, standings and rankings are calculated exactly as before (the loaders
 * below are unchanged); the layout lives in src/components/league and
 * src/styles/league.css.
 */

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCompetition } from '../context/competition.js'
import { localDateStr } from '../lib/format.js'
import { runningFestivals, selectedFestival } from '../lib/picksView.js'
import {
  seasonMonth, weekSubLine, festSubLine, winnersLine, positionLine, allZero,
  weekRowsForAll, weekRowsForGroup,
} from '../lib/leagueView.js'
import PlayerPicksModal from '../components/PlayerPicksModal.jsx'
import CompetitionPills from '../components/picks/CompetitionPills.jsx'
import ViewToggle from '../components/league/ViewToggle.jsx'
import PositionCard from '../components/league/PositionCard.jsx'
import NotInCard from '../components/league/NotInCard.jsx'
import StandingsRow from '../components/league/StandingsRow.jsx'
import { LeagueSkeleton, StandingsRowsSkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/league.css'

// The 2026 annual table is hidden for now. Set to true to bring its pill back;
// its query (loadAnnualLeague) and table (AnnualLeagueTable) are still here.
const SHOW_ANNUAL = false

const VIEWS = [{ key: 'week', label: 'This week' }, { key: 'season', label: 'Season' }]
const MSG_SEASON = 'No points yet – the table fills up after the first race week'
const MSG_WEEK = 'No points yet this week – the table fills up after the first race'
const MSG_FEST = 'No points yet – the table fills up after the first race'

export default function League() {
  const navigate = useNavigate()
  const location = useLocation()
  const { competition, setCompetition } = useCompetition()

  // ── Core ──────────────────────────────────────────────────────
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  // ── Saturday League ───────────────────────────────────────────
  const [season,         setSeason]         = useState(null)
  const [currentWeek,    setCurrentWeek]    = useState(null)
  const [satRows,        setSatRows]        = useState([])
  const [weekRows,       setWeekRows]       = useState([])
  const [completedWeeks, setCompletedWeeks] = useState([])  // weeks with results, asc

  // ── Competitions ──────────────────────────────────────────────
  const [festivals,  setFestivals]  = useState([])
  const [myGroups,   setMyGroups]   = useState([])
  const [view,       setView]       = useState('season')   // 'week' | 'season' (Saturday and groups)
  const [annualOn,   setAnnualOn]   = useState(false)

  // ── Festival leaderboards (lazy, keyed by fest.id) ────────────
  const [festData, setFestData] = useState({})

  // ── Group data (lazy, keyed by group.id) ─────────────────────
  const [groupData, setGroupData] = useState({})

  // ── Picks modal ───────────────────────────────────────────────
  const [picksModal, setPicksModal] = useState(null)

  // ── Annual League ─────────────────────────────────────────────
  const [annualRows,    setAnnualRows]    = useState([])
  const [annualSeasons, setAnnualSeasons] = useState([])
  const [annualLoading, setAnnualLoading] = useState(false)

  // What's on screen. A festival that has finished, or a group you're not in,
  // shows the Saturday League without changing the saved selection.
  const selFest  = selectedFestival(competition, festivals)
  const selGroup = competition.type === 'group' ? myGroups.find(g => g.id === competition.id) || null : null
  const annualShown = SHOW_ANNUAL && annualOn && !selFest && !selGroup
  const selFestId  = selFest?.id ?? null
  const selGroupId = selGroup?.id ?? null

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { navigate('/auth'); return }
    setUser(u)

    const [, loadedFestivals] = await Promise.all([
      loadSaturdayLeague(u.id),
      loadFestivals(),
      loadMyGroups(u.id),
    ])
    setLoading(false)

    // Older links navigate here with { festivalTab } (e.g. "Full leaderboard" on Home).
    const wantedTab = location.state?.festivalTab
    if (wantedTab && (loadedFestivals || []).some(f => f.id === wantedTab)) setCompetition('festival', wantedTab)
  }

  // Load the festival / group / annual data when its pill is first shown.
  useEffect(() => {
    if (loading || !user) return
    if (selFestId) loadTab(selFestId)
    else if (selGroupId) loadTab(selGroupId)
    else if (annualShown) loadTab('annual')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, selFestId, selGroupId, annualShown])

  // ── Saturday League ───────────────────────────────────────────
  async function loadSaturdayLeague(myUserId, seasonId) {
    // Every registered user appears even with 0 pts, so the names don't wait on the season.
    const namesLoaded = (async () => {
      const { data: allProfileData } = await supabase.from('profiles').select('id')
      const ids = [...new Set([...(allProfileData || []).map(p => p.id), myUserId])]
      const { data: profData } = await supabase.rpc('get_user_names', { user_ids: ids })
      return { allProfileIds: ids, profData }
    })()

    let s
    if (seasonId) {
      const { data } = await supabase.from('seasons').select('id, name, status, is_active').eq('id', seasonId).single()
      s = data
    } else {
      const { data } = await supabase.from('seasons').select('id, name, status, is_active').eq('is_active', true).single()
      s = data
    }
    if (!s) return
    setSeason(s)

    const { data: weeks } = await supabase
      .from('race_weeks').select('id, week_number, saturday_date')
      .eq('season_id', s.id).order('saturday_date', { ascending: false })
    const latestWeek = weeks?.[0] || null
    setCurrentWeek(latestWeek)

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

    // The player's own scores and everyone's scores are independent reads.
    let ownScores = []
    let allScores = []
    if (allRaceIds.length) {
      const [{ data: od }, { data: everyone, error: evErr }] = await Promise.all([
        supabase.from('scores').select('user_id, race_id, total_points')
          .eq('user_id', myUserId).in('race_id', allRaceIds),
        supabase.from('scores').select('user_id, race_id, total_points, position_achieved').in('race_id', allRaceIds),
      ])
      ownScores = od || []
      if (!evErr && everyone?.length) allScores = everyone
    }
    // else: no races in this season yet — all scores stay []

    // Count 1st-place finishes per user for tiebreaker (season)
    const satWinsByUser = {}
    allScores.forEach(sc => {
      if (sc.position_achieved === 1) satWinsByUser[sc.user_id] = (satWinsByUser[sc.user_id] || 0) + 1
    })
    // Count 1st-place finishes per user for tiebreaker (this week)
    const weekWinsByUser = {}
    allScores.filter(sc => weekRaceIds.includes(sc.race_id)).forEach(sc => {
      if (sc.position_achieved === 1) weekWinsByUser[sc.user_id] = (weekWinsByUser[sc.user_id] || 0) + 1
    })

    const { allProfileIds, profData } = await namesLoaded
    const nameMap = {}
    profData?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

    // ── Compute completed weeks (weeks with ≥1 score) ─────────
    const weekHasScores = new Set()
    allScores.forEach(sc => {
      const wId = raceWeekMap[sc.race_id]
      if (wId) weekHasScores.add(wId)
    })
    const completedWeekList = (weeks || [])
      .filter(w => weekHasScores.has(w.id))
      .sort((a, b) => (a.week_number || 0) - (b.week_number || 0))
    setCompletedWeeks(completedWeekList)

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
      if (weekRaceIds.includes(sc.race_id)) byUser[sc.user_id].weekPoints += (sc.total_points || 0)
    })

    const seasonSorted = Object.values(byUser)
      .sort((a, b) => b.seasonTotal - a.seasonTotal || (satWinsByUser[b.user_id] || 0) - (satWinsByUser[a.user_id] || 0) || a.name.localeCompare(b.name))
      .map((u, i) => ({ ...u, rank: i + 1, weeksPlayed: u.weeksPlayed.size, weekPts: u.weekPts || {} }))
    setSatRows(seasonSorted)

    const weekByUser = {}
    allScores.filter(sc => weekRaceIds.includes(sc.race_id)).forEach(sc => {
      if (!weekByUser[sc.user_id]) {
        weekByUser[sc.user_id] = {
          user_id: sc.user_id,
          name: nameMap[sc.user_id] || 'Player',
          isMe: sc.user_id === myUserId, weekPoints: 0, racesScored: 0,
          winners: weekWinsByUser[sc.user_id] || 0,
        }
      }
      weekByUser[sc.user_id].weekPoints  += (sc.total_points || 0)
      weekByUser[sc.user_id].racesScored += 1
    })
    if (!weekByUser[myUserId] && ownScores?.length) {
      const myWeekScores = ownScores.filter(sc => weekRaceIds.includes(sc.race_id))
      if (myWeekScores.length) {
        weekByUser[myUserId] = {
          user_id: myUserId, name: nameMap[myUserId] || 'Player', isMe: true,
          weekPoints: myWeekScores.reduce((s, sc) => s + (sc.total_points || 0), 0),
          winners: weekWinsByUser[myUserId] || 0,
          racesScored: myWeekScores.length,
        }
      }
    }
    const weekSorted = Object.values(weekByUser)
      .sort((a, b) => b.weekPoints - a.weekPoints || (weekWinsByUser[b.user_id] || 0) - (weekWinsByUser[a.user_id] || 0) || a.name.localeCompare(b.name))
      .map((u, i) => ({ ...u, rank: i + 1 }))
    setWeekRows(weekSorted)
  }

  // ── Festivals ─────────────────────────────────────────────────
  // Only festivals that are switched on and not yet finished get a pill.
  async function loadFestivals() {
    const { data } = await supabase
      .from('festivals').select('*').eq('is_active', true).order('start_date')
    const running = runningFestivals(data, localDateStr())
    setFestivals(running)
    return running
  }

  // ── My Groups ─────────────────────────────────────────────────
  async function loadMyGroups(userId) {
    const { data: memberships } = await supabase
      .from('group_members')
      .select('is_founder, groups(id, name, invite_code, created_by)')
      .eq('user_id', userId)
    if (!memberships?.length) { setMyGroups([]); return }
    const enriched = await Promise.all(
      memberships.map(async m => {
        const g = m.groups
        const { count } = await supabase
          .from('group_members').select('id', { count: 'exact', head: true }).eq('group_id', g.id)
        return { ...g, memberCount: count || 0, isFounder: m.is_founder }
      })
    )
    setMyGroups(enriched)
  }

  // ── Festival leaderboard helper ───────────────────────────────
  // Returns { rows, festDays } where rows include dayPts: { [dayNumber]: pts }
  async function fetchFestivalRows(fest, memberIds, myUserId) {
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

    // Count 1st-place finishes per user for tiebreaker
    const winsByUser = {}
    for (const s of scoresData) {
      if (s.position_achieved === 1) winsByUser[s.user_id] = (winsByUser[s.user_id] || 0) + 1
    }

    // Build day-points lookup: { userId: { dayNumber: pts } }
    const dayPtsMap = {}
    for (const dp of dayPointsData) {
      if (!dayPtsMap[dp.user_id]) dayPtsMap[dp.user_id] = {}
      dayPtsMap[dp.user_id][dp.day_number] = dp.points
    }

    const totals = {}
    for (const e of entries) totals[e.user_id] = (e.starting_points || 0)
    for (const s of scoresData) {
      if (totals[s.user_id] !== undefined) totals[s.user_id] += (s.total_points || 0)
    }

    const nameMap = {}
    profiles?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

    const rows = Object.entries(totals)
      .sort((a, b) => b[1] - a[1] || (winsByUser[b[0]] || 0) - (winsByUser[a[0]] || 0))
      .map(([uid, pts], i) => ({
        rank: i + 1, userId: uid, points: pts,
        wins: winsByUser[uid] || 0,
        name: nameMap[uid] || 'Player',
        isMe: uid === myUserId,
        dayPts: dayPtsMap[uid] || {},
      }))

    return { rows, festDays: daysData }
  }

  // ── Group Saturday helper ─────────────────────────────────────
  async function fetchGroupSatRows(memberIds, myUserId) {
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

    if (!weekIds.length) return memberIds.map((uid, i) => ({
      rank: i + 1, userId: uid, points: 0, weekPts: {},
      name: groupNameMap[uid] || 'Player', isMe: uid === myUserId,
    }))
    const { data: races } = await supabase
      .from('races').select('id, race_week_id').in('race_week_id', weekIds)
    const raceIds = (races || []).map(r => r.id)
    const raceWeekMap = {}
    races?.forEach(r => { raceWeekMap[r.id] = r.race_week_id })

    if (!raceIds.length) return memberIds.map((uid, i) => ({
      rank: i + 1, userId: uid, points: 0, weekPts: {},
      name: groupNameMap[uid] || 'Player', isMe: uid === myUserId,
    }))

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

    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1] || (groupSatWins[b[0]] || 0) - (groupSatWins[a[0]] || 0) || (groupNameMap[a[0]] || '').localeCompare(groupNameMap[b[0]] || ''))
      .map(([uid, pts], i) => ({
        rank: i + 1, userId: uid, points: pts,
        weekPts: weekPtsMap[uid] || {},
        name: groupNameMap[uid] || 'Player',
        isMe: uid === myUserId,
      }))
  }

  // ── Load the data behind a pill ───────────────────────────────────────────
  async function loadTab(tabId) {
    const myUserId = user?.id
    if (tabId === 'saturday') return
    if (tabId === 'annual') {
      if (!annualRows.length && !annualLoading) {
        setAnnualLoading(true)
        await loadAnnualLeague(myUserId)
        setAnnualLoading(false)
      }
      return
    }

    // Festival tab
    const fest = festivals.find(f => f.id === tabId)
    if (fest) {
      if (!festData[tabId]?.loaded && !festData[tabId]?.loading) {
        setFestData(prev => ({ ...prev, [tabId]: { rows: [], festDays: [], loading: true, loaded: false } }))
        const { rows, festDays } = await fetchFestivalRows(fest, null, myUserId)
        setFestData(prev => ({ ...prev, [tabId]: { rows, festDays, loading: false, loaded: true } }))
      }
      return
    }

    // Group tab
    const group = myGroups.find(g => g.id === tabId)
    if (group && !groupData[tabId]?.loaded && !groupData[tabId]?.loading) {
      setGroupData(prev => ({ ...prev, [tabId]: { loading: true, loaded: false, subTab: 'saturday', satRows: [], festRows: {} } }))
      const { data: members } = await supabase
        .from('group_members').select('user_id').eq('group_id', group.id)
      const memberIds = (members || []).map(m => m.user_id)

      const [gSatRows, ...festRowsArr] = await Promise.all([
        fetchGroupSatRows(memberIds, myUserId),
        ...festivals.map(f => fetchFestivalRows(f, memberIds, myUserId)),
      ])
      const gFestRows = {}
      festivals.forEach((f, i) => {
        gFestRows[f.id] = {
          rows:     (festRowsArr[i]?.rows)     || [],
          festDays: (festRowsArr[i]?.festDays) || [],
        }
      })

      setGroupData(prev => ({
        ...prev,
        [tabId]: { loading: false, loaded: true, subTab: 'saturday', satRows: gSatRows, festRows: gFestRows, memberIds },
      }))
    }
  }

  // ── Annual League ────────────────────────────────────────────
  async function loadAnnualLeague(myUserId) {
    const { data: seasons26 } = await supabase
      .from('seasons').select('id, name, start_date')
      .eq('year', 2026)
      .order('start_date', { ascending: true })
    if (!seasons26?.length) { setAnnualRows([]); setAnnualSeasons([]); return }
    setAnnualSeasons(seasons26)

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
    // Count 1st-place finishes per user for tiebreaker
    const annualWinsByUser = {}
    for (const sc of allScores) {
      if (!byUser[sc.user_id]) byUser[sc.user_id] = { user_id: sc.user_id, total: 0, seasonPts: {} }
      byUser[sc.user_id].total += (sc.total_points || 0)
      const sId = raceSeasonMap[sc.race_id]
      if (sId) byUser[sc.user_id].seasonPts[sId] = (byUser[sc.user_id].seasonPts[sId] || 0) + (sc.total_points || 0)
      if (sc.position_achieved === 1) annualWinsByUser[sc.user_id] = (annualWinsByUser[sc.user_id] || 0) + 1
    }

    const sorted = Object.values(byUser)
      .sort((a, b) => b.total - a.total || (annualWinsByUser[b.user_id] || 0) - (annualWinsByUser[a.user_id] || 0) || (nameMap[a.user_id] || '').localeCompare(nameMap[b.user_id] || ''))
      .map((u, i) => ({
        rank: i + 1, userId: u.user_id, name: nameMap[u.user_id] || 'Player',
        isMe: u.user_id === myUserId, total: u.total, seasonPts: u.seasonPts,
      }))
    setAnnualRows(sorted)
  }

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return <LeagueSkeleton />
  }

  // ── Rows for whatever is selected ─────────────────────────────
  const month = seasonMonth(season)
  const weekLabel = currentWeek?.week_number ? `Week ${currentWeek.week_number}` : 'This week'
  const gd = selGroup ? groupData[selGroup.id] : null
  const fd = selFest ? festData[selFest.id] : null
  const showToggle = !selFest && !annualShown

  let rows = []
  let caption = ''
  let message = MSG_SEASON
  let busy = false

  if (selFest) {
    busy = !fd || !!fd.loading
    caption = selFest.display_name || selFest.name
    message = MSG_FEST
    rows = (fd?.rows || []).map(r => ({
      id: r.userId, rank: r.rank, name: r.name, isMe: r.isMe, points: r.points,
      sub: festSubLine(r.dayPts, fd.festDays || []),
      modal: { userId: r.userId, name: r.name, pts: r.points, rank: r.rank, festivalId: selFest.id, festivalName: caption },
    }))
  } else if (selGroup) {
    busy = !gd || !!gd.loading
    const groupRows = gd?.satRows || []
    if (view === 'week') {
      caption = `${selGroup.name} · ${weekLabel}`
      message = MSG_WEEK
      rows = weekRowsForGroup(weekRows, groupRows).map(r => ({
        id: r.user_id, rank: r.rank, name: r.name, isMe: r.isMe, points: r.weekPoints,
        sub: winnersLine(r.winners || 0),
        modal: { userId: r.user_id, name: r.name, pts: r.weekPoints, rank: r.rank },
      }))
    } else {
      caption = `${selGroup.name} · ${month}`
      rows = groupRows.map(r => ({
        id: r.userId, rank: r.rank, name: r.name, isMe: r.isMe, points: r.points,
        sub: weekSubLine(r.weekPts, completedWeeks),
        modal: { userId: r.userId, name: r.name, pts: r.points, rank: r.rank },
      }))
    }
  } else if (view === 'week') {
    caption = month ? `${weekLabel} · ${month}` : weekLabel
    message = MSG_WEEK
    rows = weekRowsForAll(weekRows, satRows).map(r => ({
      id: r.user_id, rank: r.rank, name: r.name, isMe: r.isMe, points: r.weekPoints,
      sub: winnersLine(r.winners || 0),
      modal: { userId: r.user_id, name: r.name, pts: r.weekPoints, rank: r.rank },
    }))
  } else {
    caption = month ? `${month} season` : ''
    rows = satRows.map(r => ({
      id: r.user_id, rank: r.rank, name: r.name, isMe: r.isMe, points: r.seasonTotal,
      sub: weekSubLine(r.weekPts, completedWeeks),
      modal: { userId: r.user_id, name: r.name, pts: r.seasonTotal, rank: r.rank },
    }))
  }
  if (selGroup && view === 'season' && !month) caption = selGroup.name

  const me = rows.find(r => r.isMe)
  const empty = allZero(rows)
  const pillItems = [
    { key: 'saturday', label: 'Saturday League' },
    ...(SHOW_ANNUAL ? [{ key: 'annual', label: '2026 Annual' }] : []),
    ...festivals.map(f => ({ key: f.id, label: f.display_name || f.name })),
    ...myGroups.map(g => ({ key: g.id, label: g.name })),
  ]
  const activeKey = annualShown ? 'annual' : selFest?.id || selGroup?.id || 'saturday'

  function pickCompetition(item) {
    setAnnualOn(item.key === 'annual')
    if (item.key === 'annual') return
    if (item.key === 'saturday') setCompetition('saturday')
    else if (festivals.some(f => f.id === item.key)) setCompetition('festival', item.key)
    else setCompetition('group', item.key)
  }

  function makePicks() {
    setCompetition('festival', selFest.id)
    navigate('/picks')
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="app-page lg">
      <main className="lg__main">
        <h1 className="lg-title">Leaderboard</h1>

        {pillItems.length > 1 && (
          <CompetitionPills items={pillItems} activeKey={activeKey} onSelect={pickCompetition} />
        )}

        {annualShown ? (
          annualLoading ? (
            <StandingsRowsSkeleton />
          ) : (
            <AnnualLeagueTable
              rows={annualRows}
              seasons={annualSeasons}
              onPlayerClick={row => setPicksModal({ userId: row.userId, name: row.name, pts: row.total, rank: row.rank })}
            />
          )
        ) : (
          <>
            {showToggle && <ViewToggle items={VIEWS} value={view} onChange={setView} />}

            {busy ? (
              <StandingsRowsSkeleton />
            ) : (
              <>
                {selFest && !me ? (
                  <NotInCard onMakePicks={makePicks} />
                ) : me && !empty ? (
                  <PositionCard rank={me.rank} points={me.points} line={positionLine(me, rows)} caption={caption} />
                ) : (
                  caption && <div className="lg-caption">{caption}</div>
                )}

                {(empty || !rows.length) && <p className="lg-msg">{rows.length || !selFest ? message : 'No one has entered yet.'}</p>}

                {rows.length > 0 && (
                  <div className="lg-list">
                    {rows.map(row => (
                      <StandingsRow
                        key={row.id}
                        row={row}
                        top={!empty && row.rank <= 3}
                        onClick={() => setPicksModal(row.modal)}
                      />
                    ))}
                  </div>
                )}

                {selGroup && selGroup.memberCount === 1 && (
                  <p className="lg-msg">Invite your mates from Groups in the account menu</p>
                )}
                {rows.length > 0 && <p className="lg-foot">Tap any player to see their picks</p>}
              </>
            )}
          </>
        )}
      </main>


      {/* ── Player picks modal ── */}
      {picksModal && (
        <PlayerPicksModal
          userId={picksModal.userId}
          viewerUserId={user?.id}
          displayName={picksModal.name}
          seasonPoints={picksModal.pts}
          seasonRank={picksModal.rank}
          festivalId={picksModal.festivalId || null}
          festivalName={picksModal.festivalName || null}
          onClose={() => setPicksModal(null)}
        />
      )}
    </div>
  )
}

// ── Annual League table ──────────────────────────────────────
function AnnualLeagueTable({ rows, seasons = [], onPlayerClick }) {
  function abbrev(name) {
    if (!name) return '?'
    return name.split(' ')[0].slice(0, 3)
  }

  if (!rows.length) {
    return (
      <div style={st.card}>
        <div style={st.empty}>No scores yet across 2026 seasons — check back after results are in.</div>
      </div>
    )
  }

  return (
    <div style={st.card}>
      {/* Desktop */}
      <div className="league-desktop-only" style={{ overflowX: 'auto' }}>
        <div style={st.tableHeader} className="league-row">
          <span style={{ minWidth: '40px' }}>#</span>
          <span style={{ flex: 1 }}>Player</span>
          {seasons.map(s => (
            <span key={s.id} style={st.colRight} className="league-col-data">{abbrev(s.name)}</span>
          ))}
          <span style={st.colRight} className="league-col-data">Total</span>
        </div>
        {rows.map((row, idx) => (
          <div
            key={row.userId}
            className="league-row"
            style={{ ...st.row, ...(row.isMe ? st.rowMe : {}), ...(idx < rows.length - 1 ? {} : st.rowLast) }}>
            <div style={st.rankCell}>
              {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
                <span style={st.rankNum}>{row.rank}</span>
              )}
            </div>
            <div style={st.nameCell}>
              <span
                style={{ ...st.playerName, ...(row.isMe ? st.playerNameMe : {}), cursor: 'pointer', textDecoration: 'underline dotted' }}
                onClick={() => onPlayerClick && onPlayerClick(row)}>
                {row.name}
              </span>
              {row.isMe && <span style={st.youBadge}>You</span>}
            </div>
            {seasons.map(s => (
              <div key={s.id} style={st.dataCell} className="league-col-data">
                {row.seasonPts[s.id] !== undefined
                  ? row.seasonPts[s.id]
                  : <span style={{ color: 'rgba(90,138,90,0.3)' }}>—</span>}
              </div>
            ))}
            <div style={{ ...st.dataCell, ...st.totalCell }} className="league-col-data">{row.total}</div>
          </div>
        ))}
      </div>

      {/* Mobile */}
      <div className="league-mobile-only">
        {rows.map((row, idx) => (
          <div
            key={row.userId}
            style={{
              ...st.mobileCard,
              ...(row.isMe ? st.mobileCardMe : {}),
              ...(idx < rows.length - 1 ? {} : { borderBottom: 'none' }),
            }}>
            <div style={st.mobileCardRank}>
              {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
                <span style={st.rankNum}>{row.rank}</span>
              )}
            </div>
            <div style={st.mobileCardMid}>
              <div style={st.mobileNameRow}>
                <span
                  style={{ ...st.playerName, ...(row.isMe ? st.playerNameMe : {}), cursor: 'pointer', textDecoration: 'underline dotted' }}
                  onClick={() => onPlayerClick && onPlayerClick(row)}>
                  {row.name}
                </span>
                {row.isMe && <span style={st.youBadge}>You</span>}
              </div>
              {seasons.length > 0 && (
                <div style={st.mobilePillsRow}>
                  {seasons.map(s => (
                    <span key={s.id} style={st.mobilePill}>
                      {abbrev(s.name)}&nbsp;
                      <span style={st.mobilePillVal}>
                        {row.seasonPts[s.id] !== undefined ? row.seasonPts[s.id] : '—'}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ ...st.totalCell, fontSize: '1.4rem' }}>{row.total}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Styles (used by the annual table) ──────────────────────────
const st = {
  loadingInline: { textAlign: 'center', color: '#5a8a5a', padding: '2.5rem 1rem', fontSize: '0.875rem' },

  // Leaderboard card
  card: {
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', overflow: 'hidden',
  },
  empty: { padding: '3rem 2rem', textAlign: 'center', color: '#5a8a5a', fontSize: '0.9rem' },
  tableHeader: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.75rem 1.5rem',
    background: 'rgba(0,0,0,0.25)',
    borderBottom: '1px solid rgba(201,168,76,0.2)',
    fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#5a8a5a',
  },
  colRight: { minWidth: '60px', textAlign: 'right' },
  row: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.9rem 1.5rem',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
    transition: 'background 0.15s',
  },
  rowLast: { borderBottom: 'none' },
  rowMe: {
    background: 'rgba(201,168,76,0.05)',
    borderLeft: '4px solid #c9a84c',
    paddingLeft: 'calc(1.5rem - 4px)',
  },
  rankCell: { minWidth: '40px', fontSize: '1.1rem', textAlign: 'center' },
  rankNum:  { fontSize: '0.85rem', color: '#5a8a5a', fontWeight: '600' },
  nameCell: { flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' },
  playerName: { fontSize: '0.95rem', fontWeight: '500', color: '#e8f0e8' },
  playerNameMe: { color: '#c9a84c' },
  youBadge: {
    fontSize: '0.62rem', fontWeight: '700', letterSpacing: '0.06em',
    background: 'rgba(201,168,76,0.15)', color: '#c9a84c',
    padding: '0.15rem 0.45rem', borderRadius: '4px',
  },
  dataCell: { minWidth: '60px', textAlign: 'right', fontSize: '0.9rem', color: '#5a8a5a' },
  totalCell: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem',
    color: '#c9a84c', letterSpacing: '0.03em',
  },

  // Mobile card layout
  mobileCard: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.85rem 1.1rem',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
  },
  mobileCardMe: {
    background: 'rgba(201,168,76,0.05)',
    borderLeft: '4px solid #c9a84c',
    paddingLeft: 'calc(1.1rem - 4px)',
  },
  mobileCardRank: {
    minWidth: '36px', fontSize: '1.1rem', textAlign: 'center', flexShrink: 0,
  },
  mobileCardMid: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0,
  },
  mobileNameRow: {
    display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap',
  },
  mobilePillsRow: {
    display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.1rem',
  },
  mobilePill: {
    fontSize: '0.7rem', fontWeight: '500',
    background: 'rgba(201,168,76,0.07)',
    border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: '4px', padding: '0.12rem 0.4rem',
    color: '#5a8a5a', whiteSpace: 'nowrap',
  },
  mobilePillVal: {
    color: '#c9a84c', fontWeight: '700',
  },
}
