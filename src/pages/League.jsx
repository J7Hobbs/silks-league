/**
 * Silks League — League Page
 * Multi-tab leaderboard: Saturday · Festival(s) · Group(s)
 */

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ProfileDropdown from '../components/ProfileDropdown.jsx'
import PlayerPicksModal from '../components/PlayerPicksModal.jsx'
import { Home, Target, Trophy, BarChart2 } from 'lucide-react'

export default function League() {
  const navigate = useNavigate()
  const location = useLocation()

  // ── Core ──────────────────────────────────────────────────────
  const [user,    setUser]    = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  // ── Season selector ───────────────────────────────────────────
  const [allSeasons,      setAllSeasons]      = useState([])   // all seasons, desc
  const [viewSeason,      setViewSeason]      = useState(null) // currently displayed season
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false)
  const [seasonLoading,   setSeasonLoading]   = useState(false)

  // ── Saturday League ───────────────────────────────────────────
  const [season,         setSeason]         = useState(null)
  const [currentWeek,    setCurrentWeek]    = useState(null)
  const [satRows,        setSatRows]        = useState([])
  const [weekRows,       setWeekRows]       = useState([])
  const [satSubTab,      setSatSubTab]      = useState('season')
  const [completedWeeks, setCompletedWeeks] = useState([])  // weeks with results, asc

  // ── Tab state ─────────────────────────────────────────────────
  const [mainTab,    setMainTab]    = useState('saturday')
  const [festivals,  setFestivals]  = useState([])
  const [myGroups,   setMyGroups]   = useState([])

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

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { navigate('/auth'); return }
    setUser(u)
    const { data: profile } = await supabase
      .from('profiles').select('is_admin').eq('id', u.id).single()
    setIsAdmin(profile?.is_admin || false)

    // Load all seasons for the selector
    const { data: seasonsData } = await supabase
      .from('seasons').select('id, name, status, is_active')
      .order('start_date', { ascending: false })
    setAllSeasons(seasonsData || [])

    const [, loadedFestivals] = await Promise.all([
      loadSaturdayLeague(u.id),
      loadFestivals(),
      loadMyGroups(u.id),
    ])
    setLoading(false)

    // Pre-select tab from navigation state (e.g. "Full leaderboard →" on Dashboard)
    const wantedTab = location.state?.festivalTab
    if (wantedTab) {
      setMainTab(wantedTab)
      // Directly trigger the festival data fetch — handleMainTab() isn't called
      // here so we use the returned festivals list from loadFestivals()
      const fest = (loadedFestivals || []).find(f => f.id === wantedTab)
      if (fest) {
        setFestData(prev => ({ ...prev, [wantedTab]: { rows: [], festDays: [], loading: true, loaded: false } }))
        const { rows, festDays } = await fetchFestivalRows(fest, null, u.id)
        setFestData(prev => ({ ...prev, [wantedTab]: { rows, festDays, loading: false, loaded: true } }))
      }
    }
  }

  // ── Saturday League ───────────────────────────────────────────
  async function loadSaturdayLeague(myUserId, seasonId) {
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
    setViewSeason(s)

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

    let ownScores = []
    if (allRaceIds.length) {
      const { data: od } = await supabase
        .from('scores').select('user_id, race_id, total_points')
        .eq('user_id', myUserId).in('race_id', allRaceIds)
      ownScores = od || []
    }

    let allScores = []
    if (allRaceIds.length) {
      const { data: everyone, error: evErr } = await supabase
        .from('scores').select('user_id, race_id, total_points').in('race_id', allRaceIds)
      if (!evErr && everyone?.length) allScores = everyone
    }
    // else: no races in this season yet — all scores stay []

    // Fetch all profiles — every registered user appears even with 0 pts
    const { data: allProfileData } = await supabase.from('profiles').select('id')
    const allProfileIds = [...new Set([...(allProfileData || []).map(p => p.id), myUserId])]
    const { data: profData } = await supabase.rpc('get_user_names', { user_ids: allProfileIds })
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
      .sort((a, b) => b.seasonTotal - a.seasonTotal || a.name.localeCompare(b.name))
      .map((u, i) => ({ ...u, rank: i + 1, weeksPlayed: u.weeksPlayed.size, weekPts: u.weekPts || {} }))
    setSatRows(seasonSorted)

    const weekByUser = {}
    allScores.filter(sc => weekRaceIds.includes(sc.race_id)).forEach(sc => {
      if (!weekByUser[sc.user_id]) {
        weekByUser[sc.user_id] = {
          user_id: sc.user_id,
          name: nameMap[sc.user_id] || 'Player',
          isMe: sc.user_id === myUserId, weekPoints: 0, racesScored: 0,
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
          racesScored: myWeekScores.length,
        }
      }
    }
    const weekSorted = Object.values(weekByUser)
      .sort((a, b) => b.weekPoints - a.weekPoints || a.name.localeCompare(b.name))
      .map((u, i) => ({ ...u, rank: i + 1 }))
    setWeekRows(weekSorted)
  }

  // ── Festivals ─────────────────────────────────────────────────
  async function loadFestivals() {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const { data } = await supabase
      .from('festivals').select('*')
      .or(`is_active.eq.true,end_date.gte.${cutoff}`)
      .order('start_date')
    setFestivals(data || [])
    return data || []
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
    const { data: daysData } = await supabase
      .from('festival_days').select('id, day_number, race_date').eq('festival_id', fest.id).order('day_number')
    if (!daysData?.length) return { rows: [], festDays: [] }
    const { data: races } = await supabase
      .from('festival_races').select('id').in('festival_day_id', daysData.map(d => d.id))
    const raceIds = (races || []).map(r => r.id)

    let entriesQ = supabase.from('festival_entries')
      .select('user_id, starting_points').eq('festival_id', fest.id)
    if (memberIds?.length) entriesQ = entriesQ.in('user_id', memberIds)
    const { data: entries } = await entriesQ
    if (!entries?.length) return { rows: [], festDays: daysData }

    const entryUserIds = entries.map(e => e.user_id)

    // Fetch race scores (for totals + tiebreaker wins)
    let scoresData = []
    if (raceIds.length) {
      const { data: sc } = await supabase
        .from('festival_scores').select('user_id, total_points, position_achieved')
        .in('festival_race_id', raceIds).in('user_id', entryUserIds)
      scoresData = sc || []
    }

    // Count 1st-place finishes per user for tiebreaker
    const winsByUser = {}
    for (const s of scoresData) {
      if (s.position_achieved === 1) winsByUser[s.user_id] = (winsByUser[s.user_id] || 0) + 1
    }

    // Fetch day-by-day points from festival_day_points
    let dayPointsData = []
    if (memberIds?.length) {
      const { data: dp } = await supabase
        .from('festival_day_points').select('user_id, day_number, points')
        .eq('festival_id', fest.id).in('user_id', memberIds)
      dayPointsData = dp || []
    } else {
      const { data: dp } = await supabase
        .from('festival_day_points').select('user_id, day_number, points')
        .eq('festival_id', fest.id).in('user_id', entryUserIds)
      dayPointsData = dp || []
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

    const festProfileIds = [...new Set([...entryUserIds, myUserId])]
    const { data: profiles } = await supabase
      .rpc('get_user_names', { user_ids: festProfileIds })
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
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return []
    const { data: weeks } = await supabase
      .from('race_weeks').select('id').eq('season_id', season.id)
    const weekIds = (weeks || []).map(w => w.id)
    // Fetch names for all group members regardless of whether they have scores
    const groupProfileIds = [...new Set([...memberIds, myUserId])]
    const { data: groupProfiles } = await supabase.rpc('get_user_names', { user_ids: groupProfileIds })
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
      .from('scores').select('user_id, race_id, total_points')
      .in('race_id', raceIds).in('user_id', memberIds)

    const totals = {}
    const weekPtsMap = {}
    for (const uid of memberIds) { totals[uid] = 0; weekPtsMap[uid] = {} }
    for (const s of (scores || [])) {
      totals[s.user_id] = (totals[s.user_id] || 0) + s.total_points
      const wId = raceWeekMap[s.race_id]
      if (wId) {
        if (!weekPtsMap[s.user_id]) weekPtsMap[s.user_id] = {}
        weekPtsMap[s.user_id][wId] = (weekPtsMap[s.user_id][wId] || 0) + s.total_points
      }
    }

    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1] || (groupNameMap[a[0]] || '').localeCompare(groupNameMap[b[0]] || ''))
      .map(([uid, pts], i) => ({
        rank: i + 1, userId: uid, points: pts,
        weekPts: weekPtsMap[uid] || {},
        name: groupNameMap[uid] || 'Player',
        isMe: uid === myUserId,
      }))
  }

  // ── Main tab click ────────────────────────────────────────────
  async function handleMainTab(tabId) {
    setMainTab(tabId)
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

  // ── Helpers ───────────────────────────────────────────────────
  function festStatus(fest) {
    const now = new Date()
    const end = new Date(fest.end_date + 'T23:59:59')
    return now <= end ? 'Live' : 'Completed'
  }

  function formatDateRange(fest) {
    const opts = { day: 'numeric', month: 'short' }
    const s = new Date(fest.start_date + 'T12:00:00').toLocaleDateString('en-GB', opts)
    const e = new Date(fest.end_date   + 'T12:00:00').toLocaleDateString('en-GB', opts)
    return `${s} – ${e}`
  }

  async function switchSeason(s) {
    setSeasonPickerOpen(false)
    if (s.id === viewSeason?.id) return
    setSeasonLoading(true)
    setSatRows([]); setWeekRows([]); setCompletedWeeks([])
    setFestData({}); setGroupData({})
    await loadSaturdayLeague(user?.id, s.id)
    setSeasonLoading(false)
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
        .from('scores').select('user_id, race_id, total_points').in('race_id', allRaceIds)
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
    for (const sc of allScores) {
      if (!byUser[sc.user_id]) byUser[sc.user_id] = { user_id: sc.user_id, total: 0, seasonPts: {} }
      byUser[sc.user_id].total += (sc.total_points || 0)
      const sId = raceSeasonMap[sc.race_id]
      if (sId) byUser[sc.user_id].seasonPts[sId] = (byUser[sc.user_id].seasonPts[sId] || 0) + (sc.total_points || 0)
    }

    const sorted = Object.values(byUser)
      .sort((a, b) => b.total - a.total || (nameMap[a.user_id] || '').localeCompare(nameMap[b.user_id] || ''))
      .map((u, i) => ({
        rank: i + 1, userId: u.user_id, name: nameMap[u.user_id] || 'Player',
        isMe: u.user_id === myUserId, total: u.total, seasonPts: u.seasonPts,
      }))
    setAnnualRows(sorted)
  }

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={st.loadingPage}>
        <div style={st.loadingInner}>
          <div style={st.loadingLogo}>Silks League</div>
          <div style={st.loadingText}>Loading league…</div>
        </div>
      </div>
    )
  }

  // ── Computed active tab data ───────────────────────────────────
  const isSatTab    = mainTab === 'saturday'
  const isAnnualTab = mainTab === 'annual'
  const activeFest  = festivals.find(f => f.id === mainTab)
  const activeGroup = myGroups.find(g => g.id === mainTab)
  const currentGroupData = activeGroup ? groupData[activeGroup.id] : null

  // Group display rows
  let groupDisplayRows = []
  let groupFestDays    = []
  let isGroupSatSubTab = false
  if (currentGroupData?.loaded) {
    const gSubTab = currentGroupData.subTab
    isGroupSatSubTab = gSubTab === 'saturday'
    if (gSubTab === 'saturday') {
      groupDisplayRows = currentGroupData.satRows || []
    } else {
      groupDisplayRows = currentGroupData.festRows?.[gSubTab]?.rows     || []
      groupFestDays    = currentGroupData.festRows?.[gSubTab]?.festDays || []
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={st.page} onClick={() => seasonPickerOpen && setSeasonPickerOpen(false)}>

      {/* ── Nav ── */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>
          <div style={st.navLinks} className="app-nav-links">
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={st.navLink}>My Picks</a>
            <a href="/league"    style={{ ...st.navLink, ...st.navLinkActive }}>League</a>
            <a href="/results"   style={st.navLink}>Results</a>
          </div>
          <div style={st.navRight}>
            <ProfileDropdown user={user} isAdmin={isAdmin} />
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main style={st.main} className="app-main-pad">

        {/* Page heading */}
        <div style={st.pageHeadRow}>
          <div>
            <h1 style={st.heading}>League</h1>
            <p style={st.sub}>{viewSeason?.name || season?.name || 'Current Season'}</p>
          </div>
          {/* Season selector pill — hidden on Annual tab */}
          {allSeasons.length > 1 && !isAnnualTab && (
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                style={{ border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c', background: 'rgba(201,168,76,0.06)', borderRadius: '20px', padding: '0.35rem 0.85rem', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={e => { e.stopPropagation(); setSeasonPickerOpen(v => !v) }}>
                {viewSeason?.name || 'Season'} ▾
              </button>
              {seasonPickerOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '10px', minWidth: '180px', zIndex: 200, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                  {allSeasons.map(s => (
                    <button
                      key={s.id}
                      onClick={e => { e.stopPropagation(); switchSeason(s) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 1rem', background: s.id === viewSeason?.id ? 'rgba(201,168,76,0.1)' : 'transparent', color: s.id === viewSeason?.id ? '#c9a84c' : '#e8f0e8', border: 'none', borderBottom: '1px solid rgba(201,168,76,0.07)', fontSize: '0.82rem', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                      {s.name}
                      {s.status === 'completed' && <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: '#4ade80', opacity: 0.7 }}>✓</span>}
                      {s.is_active && <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: '#c9a84c' }}>●</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Past season banner — only on completed seasons, not on Annual tab */}
        {viewSeason && !viewSeason.is_active && !isAnnualTab && (
          <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '8px', padding: '0.55rem 1rem', fontSize: '0.8rem', color: 'rgba(201,168,76,0.65)', fontStyle: 'italic' }}>
            Viewing {viewSeason.name} — final standings
          </div>
        )}

        {/* Season loading state */}
        {seasonLoading && (
          <div style={{ textAlign: 'center', color: '#5a8a5a', padding: '2rem', fontSize: '0.875rem' }}>Loading season…</div>
        )}

        {/* ── Outer scrollable tab bar ── */}
        <div style={st.outerTabBar}>
          <button
            style={{ ...st.outerTab, ...(mainTab === 'saturday' ? st.outerTabActive : {}) }}
            onClick={() => handleMainTab('saturday')}>
            🏇 Saturday League
          </button>
          <button
            style={{ ...st.outerTab, ...(isAnnualTab ? st.outerTabActive : {}) }}
            onClick={() => handleMainTab('annual')}>
            📅 2026 Annual
          </button>
          {festivals.map(fest => (
            <button
              key={fest.id}
              style={{ ...st.outerTab, ...(mainTab === fest.id ? st.outerTabActive : {}) }}
              onClick={() => handleMainTab(fest.id)}>
              👑 {fest.display_name || fest.name}
            </button>
          ))}
          {myGroups.map(group => (
            <button
              key={group.id}
              style={{ ...st.outerTab, ...(mainTab === group.id ? st.outerTabActive : {}) }}
              onClick={() => handleMainTab(group.id)}>
              {group.name}
            </button>
          ))}
        </div>

        {/* ══════════════ SATURDAY LEAGUE TAB ══════════════ */}
        {isSatTab && (
          <>
            <div style={st.innerTabRow}>
              <button
                style={{ ...st.innerTab, ...(satSubTab === 'season' ? st.innerTabActive : {}) }}
                onClick={() => setSatSubTab('season')}>
                Season Standings
              </button>
              <button
                style={{ ...st.innerTab, ...(satSubTab === 'week' ? st.innerTabActive : {}) }}
                onClick={() => setSatSubTab('week')}>
                This Week{currentWeek?.week_number ? ` · Wk ${currentWeek.week_number}` : ''}
              </button>
            </div>

            {satSubTab === 'season' ? (
              <LeaderboardTable
                rows={satRows}
                completedWeeks={completedWeeks}
                onPlayerClick={row => setPicksModal({
                  userId: row.user_id,
                  name: row.name,
                  pts: row.seasonTotal,
                  rank: row.rank,
                })}
              />
            ) : (
              <WeekLeaderboardCard
                rows={weekRows}
                onPlayerClick={row => setPicksModal({
                  userId: row.user_id,
                  name: row.name,
                  pts: row.weekPoints,
                  rank: row.rank,
                })}
              />
            )}
          </>
        )}

        {/* ══════════════ ANNUAL LEAGUE TAB ══════════════ */}
        {isAnnualTab && (
          <>
            {annualLoading ? (
              <div style={st.loadingInline}>Loading 2026 Annual…</div>
            ) : (
              <AnnualLeagueTable
                rows={annualRows}
                seasons={annualSeasons}
                onPlayerClick={row => setPicksModal({
                  userId: row.userId,
                  name: row.name,
                  pts: row.total,
                  rank: row.rank,
                })}
              />
            )}
          </>
        )}

        {/* ══════════════ FESTIVAL TAB ══════════════ */}
        {activeFest && (
          <>
            <div style={st.festBanner}>
              <div style={st.festBannerLeft}>
                <div style={st.festBannerName}>
                  👑 {(activeFest.display_name || activeFest.name).toUpperCase()}
                </div>
                <div style={st.festBannerDates}>{formatDateRange(activeFest)}</div>
              </div>
              <div style={{
                ...st.festStatusPill,
                ...(festStatus(activeFest) === 'Live' ? st.festStatusLive : st.festStatusDone),
              }}>
                {festStatus(activeFest) === 'Live' ? '● Live' : 'Completed'}
              </div>
            </div>

            {festData[activeFest.id]?.loading ? (
              <div style={st.loadingInline}>Loading standings…</div>
            ) : (
              <FestivalDayTable
                rows={festData[activeFest.id]?.rows || []}
                festDays={festData[activeFest.id]?.festDays || []}
                onPlayerClick={row => setPicksModal({
                  userId: row.userId,
                  name: row.name,
                  pts: row.points,
                  rank: row.rank,
                  festivalId: activeFest.id,
                  festivalName: activeFest.display_name || activeFest.name,
                })}
              />
            )}
          </>
        )}

        {/* ══════════════ GROUP TAB ══════════════ */}
        {activeGroup && (
          <>
            <div style={st.groupHeader}>
              <div style={st.groupHeaderLeft}>
                <div style={st.groupName}>{activeGroup.name}</div>
                <div style={st.groupMeta}>{activeGroup.memberCount} member{activeGroup.memberCount !== 1 ? 's' : ''}</div>
              </div>
              <button style={st.manageLink} onClick={() => navigate('/groups')}>
                Manage →
              </button>
            </div>

            {currentGroupData?.loading ? (
              <div style={st.loadingInline}>Loading group standings…</div>
            ) : currentGroupData?.loaded ? (
              <>
                <div style={st.innerTabRow}>
                  <button
                    style={{ ...st.innerTab, ...(currentGroupData.subTab === 'saturday' ? st.innerTabActive : {}) }}
                    onClick={() => setGroupData(prev => ({
                      ...prev,
                      [activeGroup.id]: { ...prev[activeGroup.id], subTab: 'saturday' },
                    }))}>
                    Saturday
                  </button>
                  {festivals.map(fest => (
                    <button
                      key={fest.id}
                      style={{ ...st.innerTab, ...(currentGroupData.subTab === fest.id ? st.innerTabActive : {}) }}
                      onClick={() => setGroupData(prev => ({
                        ...prev,
                        [activeGroup.id]: { ...prev[activeGroup.id], subTab: fest.id },
                      }))}>
                      {fest.display_name || fest.name} 👑
                    </button>
                  ))}
                </div>

                {isGroupSatSubTab ? (
                  <LeaderboardTable
                    rows={groupDisplayRows}
                    completedWeeks={completedWeeks}
                    onPlayerClick={row => setPicksModal({
                      userId: row.userId,
                      name: row.name,
                      pts: row.points,
                      rank: row.rank,
                    })}
                  />
                ) : (
                  <FestivalDayTable
                    rows={groupDisplayRows}
                    festDays={groupFestDays}
                    onPlayerClick={row => {
                      const gSubTab = currentGroupData.subTab
                      const clickedFest = festivals.find(f => f.id === gSubTab)
                      setPicksModal({
                        userId: row.userId,
                        name: row.name,
                        pts: row.points,
                        rank: row.rank,
                        festivalId: clickedFest?.id || null,
                        festivalName: clickedFest ? (clickedFest.display_name || clickedFest.name) : null,
                      })
                    }}
                  />
                )}
              </>
            ) : null}
          </>
        )}

        {/* CTA */}
        <div style={st.ctaStrip}>
          <button style={st.ctaBtn} onClick={() => navigate('/picks')}>
            Make your picks →
          </button>
        </div>

      </main>

      {/* ── Mobile bar ── */}
      <nav style={st.mobileBar} className="app-mobile-bar">
        <a href="/dashboard" style={st.mobileBarItem}>
          <Home size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={st.mobileBarItem}>
          <Target size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Picks</span>
        </a>
        <a href="/league" style={{ ...st.mobileBarItem, ...st.mobileBarItemActive }}>
          <Trophy size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>League</span>
          <span style={st.mobileDot} />
        </a>
        <a href="/results" style={st.mobileBarItem}>
          <BarChart2 size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Results</span>
        </a>
      </nav>

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

// ── Unified leaderboard table ─────────────────────────────────
// Season standings (with per-week columns) + festival/group totals
// Desktop: table with week columns; Mobile: card-per-player with week pills
function LeaderboardTable({ rows, completedWeeks = [], onPlayerClick }) {
  // Normalise Saturday rows (user_id / seasonTotal) vs festival/group rows (userId / points)
  const norm = rows.map(r => ({
    id:      r.user_id || r.userId,
    rank:    r.rank,
    name:    r.name,
    isMe:    r.isMe,
    total:   r.seasonTotal !== undefined ? r.seasonTotal : r.points,
    weekPts: r.weekPts || {},
    _raw:    r,
  }))

  if (!norm.length) {
    return (
      <div style={st.card}>
        <div style={st.empty}>No scores yet — check back after results are in.</div>
      </div>
    )
  }

  return (
    <div style={st.card}>

      {/* ── Desktop table (hidden on mobile via CSS) ── */}
      <div className="league-desktop-only" style={{ overflowX: 'auto' }}>
        {/* Header */}
        <div style={st.tableHeader} className="league-row">
          <span style={{ minWidth: '40px' }}>#</span>
          <span style={{ flex: 1 }}>Player</span>
          {completedWeeks.map(w => (
            <span key={w.id} style={st.colRight} className="league-col-data">
              Wk {w.week_number}
            </span>
          ))}
          <span style={st.colRight} className="league-col-data">Total</span>
        </div>
        {/* Rows */}
        {norm.map((row, idx) => (
          <div
            key={row.id}
            className="league-row"
            style={{ ...st.row, ...(row.isMe ? st.rowMe : {}), ...(idx < norm.length - 1 ? {} : st.rowLast) }}>
            <div style={st.rankCell}>
              {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
                <span style={st.rankNum}>{row.rank}</span>
              )}
            </div>
            <div style={st.nameCell}>
              <span
                style={{ ...st.playerName, ...(row.isMe ? st.playerNameMe : {}), cursor: 'pointer', textDecoration: 'underline dotted' }}
                onClick={() => onPlayerClick(row._raw)}>
                {row.name}
              </span>
              {row.isMe && <span style={st.youBadge}>You</span>}
            </div>
            {completedWeeks.map(w => (
              <div key={w.id} style={st.dataCell} className="league-col-data">
                {row.weekPts[w.id] !== undefined
                  ? row.weekPts[w.id]
                  : <span style={{ color: 'rgba(90,138,90,0.3)' }}>—</span>}
              </div>
            ))}
            <div style={{ ...st.dataCell, ...st.totalCell }} className="league-col-data">
              {row.total}
            </div>
          </div>
        ))}
      </div>

      {/* ── Mobile cards (hidden on desktop via CSS) ── */}
      <div className="league-mobile-only">
        {norm.map((row, idx) => (
          <div
            key={row.id}
            style={{
              ...st.mobileCard,
              ...(row.isMe ? st.mobileCardMe : {}),
              ...(idx < norm.length - 1 ? {} : { borderBottom: 'none' }),
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
                  onClick={() => onPlayerClick(row._raw)}>
                  {row.name}
                </span>
                {row.isMe && <span style={st.youBadge}>You</span>}
              </div>
              {completedWeeks.length > 0 && (
                <div style={st.mobilePillsRow}>
                  {completedWeeks.map(w => (
                    <span key={w.id} style={st.mobilePill}>
                      Wk{w.week_number}&nbsp;
                      <span style={st.mobilePillVal}>
                        {row.weekPts[w.id] !== undefined ? row.weekPts[w.id] : '—'}
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

// ── This Week leaderboard (Races + Points, no week columns) ───
function WeekLeaderboardCard({ rows, onPlayerClick }) {
  if (!rows.length) {
    return (
      <div style={st.card}>
        <div style={st.empty}>No scores this week yet — check back after results are in.</div>
      </div>
    )
  }
  return (
    <div style={st.card}>
      <div style={st.tableHeader} className="league-row">
        <span style={{ minWidth: '40px' }}>#</span>
        <span style={{ flex: 1 }}>Player</span>
        <span style={st.colRight} className="league-col-data">Races</span>
        <span style={st.colRight} className="league-col-data">Points</span>
      </div>
      {rows.map((row, idx) => (
        <div
          key={row.user_id}
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
              onClick={() => onPlayerClick(row)}>
              {row.name}
            </span>
            {row.isMe && <span style={st.youBadge}>You</span>}
          </div>
          <div style={st.dataCell} className="league-col-data">{row.racesScored}</div>
          <div style={{ ...st.dataCell, ...st.totalCell }} className="league-col-data">{row.weekPoints}</div>
        </div>
      ))}
    </div>
  )
}

// ── Festival day-by-day leaderboard table ────────────────────
// Shows # · Player · Day1 · Day2 · … · Total (desktop)
// Mobile: card per player with day pills
function FestivalDayTable({ rows, festDays = [], onPlayerClick }) {
  // Derive short day labels from race_date (e.g. "TUE", "WED")
  const dayLabels = festDays.map(d => {
    if (!d.race_date) return `D${d.day_number}`
    try {
      return new Date(d.race_date + 'T12:00:00')
        .toLocaleDateString('en-GB', { weekday: 'short' })
        .toUpperCase()
    } catch { return `D${d.day_number}` }
  })

  const dash = <span style={{ color: 'rgba(90,138,90,0.3)' }}>—</span>

  if (!rows.length) {
    return (
      <div style={st.card}>
        <div style={st.empty}>No entries yet — check back after results are in.</div>
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
          {dayLabels.map((lbl, i) => (
            <span key={i} style={st.colRight} className="league-col-data">{lbl}</span>
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
                onClick={() => onPlayerClick(row)}>
                {row.name}
              </span>
              {row.isMe && <span style={st.youBadge}>You</span>}
            </div>
            {festDays.map(d => (
              <div key={d.day_number} style={st.dataCell} className="league-col-data">
                {row.dayPts?.[d.day_number] !== undefined ? row.dayPts[d.day_number] : dash}
              </div>
            ))}
            <div style={{ ...st.dataCell, ...st.totalCell }} className="league-col-data">
              {row.points}
            </div>
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
                  onClick={() => onPlayerClick(row)}>
                  {row.name}
                </span>
                {row.isMe && <span style={st.youBadge}>You</span>}
              </div>
              {festDays.length > 0 && (
                <div style={st.mobilePillsRow}>
                  {festDays.map((d, i) => (
                    <span key={d.day_number} style={st.mobilePill}>
                      {dayLabels[i]}&nbsp;
                      <span style={st.mobilePillVal}>
                        {row.dayPts?.[d.day_number] !== undefined ? row.dayPts[d.day_number] : '—'}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ ...st.totalCell, fontSize: '1.4rem' }}>{row.points}</div>
          </div>
        ))}
      </div>

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

// ── Styles ────────────────────────────────────────────────────
const st = {
  page: { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '5rem' },
  loadingPage: { minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loadingInner: { textAlign: 'center' },
  loadingLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#c9a84c', letterSpacing: '0.12em', marginBottom: '0.5rem' },
  loadingText: { color: '#5a8a5a', fontSize: '0.9rem' },
  loadingInline: { textAlign: 'center', color: '#5a8a5a', padding: '2.5rem 1rem', fontSize: '0.875rem' },

  // Nav
  nav: { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  navInner: { maxWidth: '900px', margin: '0 auto', padding: '0 1.5rem', height: '60px', display: 'flex', alignItems: 'center', gap: '2rem' },
  navLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0 },
  navLinks: { display: 'flex', gap: '0.25rem', flex: 1 },
  navLink: { padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: '500', color: '#5a8a5a', textDecoration: 'none' },
  navLinkActive: { color: '#e8f0e8', background: 'rgba(201,168,76,0.1)' },
  navRight: { marginLeft: 'auto', position: 'relative' },

  // Main
  main: { maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  pageHeadRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  heading: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.6rem', color: '#e8f0e8', letterSpacing: '0.03em', margin: 0, lineHeight: 1 },
  sub: { marginTop: '0.4rem', fontSize: '0.9rem', color: '#5a8a5a' },

  // Outer tab bar
  outerTabBar: {
    display: 'flex', gap: '0.4rem',
    overflowX: 'auto', paddingBottom: '2px',
    scrollbarWidth: 'none', msOverflowStyle: 'none',
  },
  outerTab: {
    flexShrink: 0, padding: '0.5rem 1.1rem', borderRadius: '20px',
    fontSize: '0.85rem', fontWeight: '600',
    background: 'rgba(255,255,255,0.04)',
    border: '1.5px solid rgba(201,168,76,0.15)',
    color: 'rgba(232,240,232,0.4)',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap', transition: 'all 0.15s',
  },
  outerTabActive: {
    background: 'rgba(201,168,76,0.12)',
    border: '1.5px solid #c9a84c',
    color: '#c9a84c',
  },

  // Inner tabs
  innerTabRow: { display: 'flex', gap: '0.35rem', overflowX: 'auto', scrollbarWidth: 'none' },
  innerTab: {
    padding: '0.45rem 1rem', borderRadius: '7px', fontSize: '0.82rem', fontWeight: '600',
    background: 'none', border: '1px solid rgba(201,168,76,0.12)', color: '#5a8a5a',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap', transition: 'all 0.15s',
  },
  innerTabActive: {
    background: 'rgba(201,168,76,0.1)',
    border: '1px solid rgba(201,168,76,0.3)',
    color: '#c9a84c',
  },

  // Festival banner
  festBanner: {
    background: 'linear-gradient(135deg, #1a3512 0%, #0f2a0a 100%)',
    border: '1.5px solid rgba(201,168,76,0.4)',
    borderRadius: '8px', padding: '0.9rem 1.25rem',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
  },
  festBannerLeft: {},
  festBannerName: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.1rem', color: '#e8f0e8', letterSpacing: '0.05em', lineHeight: 1,
  },
  festBannerDates: { fontSize: '0.78rem', color: 'rgba(232,240,232,0.5)', marginTop: '0.2rem' },
  festStatusPill: {
    fontSize: '0.72rem', fontWeight: '700', padding: '0.25rem 0.6rem',
    borderRadius: '20px', letterSpacing: '0.04em', flexShrink: 0,
  },
  festStatusLive: { background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' },
  festStatusDone: { background: 'rgba(201,168,76,0.1)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.3)' },

  // Group header
  groupHeader: {
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    border: '1.5px solid rgba(201,168,76,0.3)',
    borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1rem 1.25rem',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  groupHeaderLeft: {},
  groupName: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#e8f0e8', letterSpacing: '0.04em', lineHeight: 1 },
  groupMeta: { fontSize: '0.78rem', color: '#5a8a5a', marginTop: '0.2rem' },
  manageLink: {
    background: 'none', border: '1px solid rgba(201,168,76,0.25)',
    color: '#c9a84c', fontSize: '0.82rem', fontWeight: '600',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    padding: '0.4rem 0.75rem', borderRadius: '6px',
  },

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

  // CTA
  ctaStrip: { display: 'flex' },
  ctaBtn: {
    flex: 1, padding: '0.85rem', background: '#c9a84c', color: '#0a1a08',
    border: 'none', borderRadius: '10px', fontSize: '0.9rem', fontWeight: '700',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },

  // Mobile bar
  mobileBar: { display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)', padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around' },
  mobileBarItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '0.3rem 0', color: 'rgba(232,220,200,0.4)', textDecoration: 'none', flex: 1 },
  mobileBarItemActive: { color: '#c9a84c' },
  mobileBarLabel: { fontSize: '10px', fontWeight: '500' },
  mobileDot: { width: '4px', height: '4px', borderRadius: '50%', background: '#c9a84c', marginTop: '1px' },
}
