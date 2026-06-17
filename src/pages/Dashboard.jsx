import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ProfileDropdown from '../components/ProfileDropdown.jsx'
import PlayerPicksModal from '../components/PlayerPicksModal.jsx'
import { Home, Target, Trophy, BarChart2, Users } from 'lucide-react'

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser]                       = useState(null)
  const [isAdmin, setIsAdmin]                 = useState(false)
  const [loading, setLoading]                 = useState(true)
  const [races, setRaces]                     = useState([])
  const [seasonPoints, setSeasonPoints]       = useState(null)
  const [leaderboard, setLeaderboard]         = useState([])
  const [weekLeaderboard, setWeekLeaderboard] = useState([])
  const [leaderboardTab, setLeaderboardTab]   = useState('season')
  const [currentWeekNum, setCurrentWeekNum]   = useState(null)
  const [now, setNow]                         = useState(new Date())
  const [thisWeekPicks, setThisWeekPicks]     = useState({})
  const [lastWeekData, setLastWeekData]       = useState([])
  const [festival, setFestival]               = useState(null)
  const [festivalEntry, setFestivalEntry]     = useState(null)
  const [festivalPoints, setFestivalPoints]   = useState(null)
  const [joiningFestival, setJoiningFestival] = useState(false)
  const [myGroup, setMyGroup]                 = useState(null)
  const [picksModal, setPicksModal]           = useState(null) // { userId, name, pts, rank }
  const [totalUserCount, setTotalUserCount]   = useState(0)
  const [festLeaderboard, setFestLeaderboard] = useState([])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        navigate('/auth')
      } else {
        setUser(user)
        const { data: profile } = await supabase
          .from('profiles').select('is_admin').eq('id', user.id).single()
        setIsAdmin(profile?.is_admin || false)
        await Promise.all([
          loadRaces(user.id),
          loadStats(user.id),
          loadLeaderboard(user.id),
          loadWeekLeaderboard(user.id),
          loadLastWeekData(user.id),
          loadFestival(user.id),
          loadMyGroup(user.id),
        ])
        setLoading(false)
      }
    })
  }, [navigate])

  // ── Data loaders ────────────────────────────────────────────────────────────

  async function loadRaces(userId) {
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return

    const { data: weeks } = await supabase
      .from('race_weeks').select('id, week_number, saturday_date')
      .eq('season_id', season.id)
      .order('saturday_date', { ascending: false })
      .limit(1)
    const week = weeks?.[0]
    if (!week) return
    setCurrentWeekNum(week.week_number)

    const { data: raceData } = await supabase
      .from('races')
      .select('id, race_number, race_time, venue, race_name, runners(count)')
      .eq('race_week_id', week.id)
      .order('race_number')
    if (!raceData) return

    const raceIds = raceData.map(r => r.id)

    const { data: picksData } = await supabase
      .from('picks')
      .select('race_id, runner_id, runners(horse_name, silk_colour)')
      .eq('user_id', userId)
      .in('race_id', raceIds)

    const picksMap = {}
    picksData?.forEach(p => {
      picksMap[p.race_id] = {
        horseName:  p.runners?.horse_name || '',
        silkColour: p.runners?.silk_colour || '#888',
      }
    })
    setThisWeekPicks(picksMap)

    setRaces(raceData.map(r => ({
      id:      r.id,
      number:  r.race_number,
      time:    r.race_time,
      course:  r.venue,
      race:    r.race_name,
      runners: parseInt(r.runners?.[0]?.count ?? 0),
    })))
  }

  async function loadLastWeekData(userId) {
    if (!userId) return
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return

    const today = new Date().toISOString().split('T')[0]
    const { data: weeks } = await supabase
      .from('race_weeks').select('id, week_number, saturday_date')
      .eq('season_id', season.id)
      .lt('saturday_date', today)
      .order('saturday_date', { ascending: false })
      .limit(1)
    const lastWeek = weeks?.[0]
    if (!lastWeek) return

    const { data: raceData } = await supabase
      .from('races').select('id, race_number, race_time, venue, race_name')
      .eq('race_week_id', lastWeek.id)
      .order('race_number')
    if (!raceData?.length) return

    const raceIds = raceData.map(r => r.id)

    const [{ data: picksData }, { data: scoresData }] = await Promise.all([
      supabase.from('picks')
        .select('race_id, runner_id')
        .eq('user_id', userId).in('race_id', raceIds),
      supabase.from('scores')
        .select('race_id, total_points, position_achieved')
        .eq('user_id', userId).in('race_id', raceIds),
    ])

    // Fetch runner details separately (avoids FK join issues)
    const runnerIds = [...new Set((picksData || []).map(p => p.runner_id).filter(Boolean))]
    const runnerMap = {}
    if (runnerIds.length) {
      const { data: runnersData } = await supabase
        .from('runners').select('id, horse_name, silk_colour')
        .in('id', runnerIds)
      runnersData?.forEach(r => { runnerMap[r.id] = r })
    }

    const picksMap = {}
    picksData?.forEach(p => {
      const runner = p.runner_id ? runnerMap[p.runner_id] : null
      picksMap[p.race_id] = {
        horseName:  runner?.horse_name  || '—',
        silkColour: runner?.silk_colour || '#888',
      }
    })
    const scoresMap = {}
    scoresData?.forEach(s => { scoresMap[s.race_id] = s })

    setLastWeekData(raceData.map(r => ({
      race:  r,
      pick:  picksMap[r.id]  || null,
      score: scoresMap[r.id] || null,
    })))
  }

  async function loadStats(userId) {
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) { setSeasonPoints(0); return }

    const { data: weeks } = await supabase
      .from('race_weeks').select('id').eq('season_id', season.id)
    if (!weeks?.length) { setSeasonPoints(0); return }

    const weekIds = weeks.map(w => w.id)
    const { data: allRaces } = await supabase
      .from('races').select('id').in('race_week_id', weekIds)
    if (!allRaces?.length) { setSeasonPoints(0); return }

    const allRaceIds = allRaces.map(r => r.id)
    const { data: seasonScores } = await supabase
      .from('scores').select('total_points').eq('user_id', userId).in('race_id', allRaceIds)
    setSeasonPoints(seasonScores?.reduce((s, r) => s + (r.total_points || 0), 0) ?? 0)
  }

  async function loadLeaderboard(myUserId) {
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return

    const { data: weeks } = await supabase
      .from('race_weeks').select('id').eq('season_id', season.id)
    const weekIds = weeks?.map(w => w.id) || []

    let allRaceIds = []
    if (weekIds.length) {
      const { data: allRaces } = await supabase
        .from('races').select('id').in('race_week_id', weekIds)
      allRaceIds = allRaces?.map(r => r.id) || []
    }

    // Fetch all app profiles so 0-point players still appear
    const { data: allProfileData } = await supabase
      .from('profiles').select('id')
    const allProfileIds = (allProfileData || []).map(p => p.id)
    setTotalUserCount(allProfileIds.length)
    const { data: profiles } = await supabase
      .rpc('get_user_names', { user_ids: allProfileIds.length ? allProfileIds : [myUserId] })

    // Initialise every player at 0
    const byUser = {}
    profiles?.forEach(p => {
      byUser[p.id] = { user_id: p.id, total: 0, name: p.username || p.full_name || null }
    })

    // Add scores for this season only
    const seasonWinsByUser = {}
    if (allRaceIds.length) {
      const { data: allScores, error } = await supabase
        .from('scores').select('user_id, total_points, position_achieved').in('race_id', allRaceIds)
      if (!error) {
        (allScores || []).forEach(s => {
          if (!byUser[s.user_id]) byUser[s.user_id] = { user_id: s.user_id, total: 0, name: null }
          byUser[s.user_id].total += (s.total_points || 0)
          if (s.position_achieved === 1) seasonWinsByUser[s.user_id] = (seasonWinsByUser[s.user_id] || 0) + 1
        })
      }
    }

    const sorted = Object.values(byUser)
      .sort((a, b) => b.total - a.total || (seasonWinsByUser[b.user_id] || 0) - (seasonWinsByUser[a.user_id] || 0))
      .slice(0, 5)
      .map((u, i) => ({
        rank:      i + 1,
        userId:    u.user_id,
        name:      u.name || 'Player',
        points:    u.total,
        isMe:      u.user_id === myUserId,
        midSeason: false,
      }))
    setLeaderboard(sorted)
  }

  async function loadWeekLeaderboard(myUserId) {
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return

    const { data: weekArr } = await supabase
      .from('race_weeks').select('id')
      .eq('season_id', season.id)
      .order('saturday_date', { ascending: false })
      .limit(1)
    const week = weekArr?.[0]
    if (!week) return

    const { data: raceArr } = await supabase
      .from('races').select('id').eq('race_week_id', week.id)
    if (!raceArr?.length) return
    const raceIds = raceArr.map(r => r.id)

    const { data: scores } = await supabase
      .from('scores').select('user_id, total_points, position_achieved').in('race_id', raceIds)
    if (!scores?.length) return

    const byUser = {}
    const weekWinsByUser = {}
    scores.forEach(s => {
      if (!byUser[s.user_id]) byUser[s.user_id] = 0
      byUser[s.user_id] += (s.total_points || 0)
      if (s.position_achieved === 1) weekWinsByUser[s.user_id] = (weekWinsByUser[s.user_id] || 0) + 1
    })

    const weekProfileIds = [...new Set([...Object.keys(byUser), myUserId])]
    const { data: profiles } = await supabase
      .rpc('get_user_names', { user_ids: weekProfileIds })
    const nameMap = {}
    profiles?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

    const sorted = Object.entries(byUser)
      .map(([uid, pts]) => ({
        userId: uid,
        points: pts,
        wins:   weekWinsByUser[uid] || 0,
        name:   nameMap[uid] || 'Player',
        isMe:   uid === myUserId,
      }))
      .sort((a, b) => b.points - a.points || b.wins - a.wins)
      .slice(0, 5)
      .map((u, i) => ({ ...u, rank: i + 1 }))
    setWeekLeaderboard(sorted)
  }

  async function loadFestivalLeaderboard(myUserId, festivalId) {
    const { data: entries } = await supabase
      .from('festival_entries')
      .select('user_id, starting_points')
      .eq('festival_id', festivalId)
    if (!entries?.length) return

    const { data: days } = await supabase
      .from('festival_days').select('id').eq('festival_id', festivalId)
    const dayIds = days?.map(d => d.id) || []

    let scoresByUser = {}
    let winsByUser   = {}
    if (dayIds.length) {
      const { data: fRaces } = await supabase
        .from('festival_races').select('id').in('festival_day_id', dayIds)
      const raceIds = fRaces?.map(r => r.id) || []
      if (raceIds.length) {
        const { data: scores } = await supabase
          .from('festival_scores').select('user_id, total_points, position_achieved')
          .in('festival_race_id', raceIds)
        scores?.forEach(s => {
          scoresByUser[s.user_id] = (scoresByUser[s.user_id] || 0) + (s.total_points || 0)
          if (s.position_achieved === 1) winsByUser[s.user_id] = (winsByUser[s.user_id] || 0) + 1
        })
      }
    }

    const userIds = entries.map(e => e.user_id)
    const { data: profiles } = await supabase
      .rpc('get_user_names', { user_ids: userIds })
    const nameMap = {}
    profiles?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

    const sorted = entries
      .map(e => ({
        userId: e.user_id,
        points: (scoresByUser[e.user_id] || 0) + (e.starting_points || 0),
        wins:   winsByUser[e.user_id] || 0,
        name:   nameMap[e.user_id] || 'Player',
        isMe:   e.user_id === myUserId,
      }))
      .sort((a, b) => b.points - a.points || b.wins - a.wins)
      .slice(0, 5)
      .map((u, i) => ({ ...u, rank: i + 1 }))

    setFestLeaderboard(sorted)
  }

  async function loadFestival(userId) {
    let fest = null

    // Try active festival first
    const { data: activeFest } = await supabase
      .from('festivals').select('*').eq('is_active', true).maybeSingle()
    if (activeFest) {
      fest = activeFest
      setLeaderboardTab('festival')
      await loadFestivalLeaderboard(userId, activeFest.id)
    } else {
      // Look for upcoming within 30 days
      const todayStr = new Date().toISOString().split('T')[0]
      const in30 = new Date()
      in30.setDate(in30.getDate() + 30)
      const in30Str = in30.toISOString().split('T')[0]
      const { data: upcoming } = await supabase
        .from('festivals').select('*')
        .gte('start_date', todayStr)
        .lte('start_date', in30Str)
        .order('start_date', { ascending: true })
        .limit(1)
        .maybeSingle()
      fest = upcoming || null
    }
    if (!fest) return
    setFestival(fest)

    const { data: entry } = await supabase
      .from('festival_entries').select('*')
      .eq('festival_id', fest.id).eq('user_id', userId).maybeSingle()
    setFestivalEntry(entry || null)

    if (entry) {
      const { data: days } = await supabase
        .from('festival_days').select('id').eq('festival_id', fest.id)
      if (!days?.length) return
      const { data: festRaces } = await supabase
        .from('festival_races').select('id')
        .in('festival_day_id', days.map(d => d.id))
      if (!festRaces?.length) return
      const { data: fscores } = await supabase
        .from('festival_scores').select('total_points')
        .eq('user_id', userId)
        .in('festival_race_id', festRaces.map(r => r.id))
      const total = (fscores?.reduce((s, r) => s + (r.total_points || 0), 0) ?? 0) + (entry.starting_points || 0)
      setFestivalPoints(total)
    }
  }

  async function joinFestival() {
    if (!festival || !user || joiningFestival) return
    setJoiningFestival(true)
    const { error } = await supabase.from('festival_entries').insert({
      festival_id: festival.id,
      user_id:     user.id,
      starting_points: 0,
    })
    setJoiningFestival(false)
    if (!error) await loadFestival(user.id)
  }

  async function loadMyGroup(userId) {
    if (!userId) return
    const { data } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name)')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (!data?.groups) return

    const { count } = await supabase
      .from('group_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', data.group_id)

    setMyGroup({ id: data.group_id, name: data.groups.name, memberCount: count || 0 })
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const getFirstName = () => {
    const full = user?.user_metadata?.full_name || user?.email || ''
    return full.split(' ')[0] || 'there'
  }

  const getCountdownStatus = () => {
    const day  = now.getDay()
    const hour = now.getHours()
    const daysUntilSat = day === 6 ? 0 : (6 - day)
    const nextSat = new Date(now)
    nextSat.setDate(now.getDate() + daysUntilSat)
    nextSat.setHours(12, 0, 0, 0)
    if (day === 6 && hour >= 12) return { mode: 'live' }
    const totalSecs = Math.floor((nextSat - now) / 1000)
    const days  = Math.floor(totalSecs / 86400)
    const hours = Math.floor((totalSecs % 86400) / 3600)
    const mins  = Math.floor((totalSecs % 3600) / 60)
    const secs  = totalSecs % 60
    if (days >= 6) {
      const dateStr = nextSat.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      return { mode: 'date', label: `Race day ${dateStr}` }
    }
    let label
    if (days > 0)       label = `${days}d ${hours}h ${mins}m`
    else if (hours > 0) label = `${hours}h ${mins}m ${secs}s`
    else                label = `${mins}m ${secs}s`
    return { mode: 'countdown', label, sublabel: 'to picks deadline' }
  }

  const fmtDate = (ds) => {
    if (!ds) return ''
    try {
      const d = new Date(ds + 'T12:00:00')
      return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
    } catch { return ds }
  }

  // ── Loading screen ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={s.loadingPage}>
        <div style={s.loadingDot} />
      </div>
    )
  }

  // ── Computed values ──────────────────────────────────────────────────────────

  const countdown         = getCountdownStatus()
  const myRank            = leaderboard.find(r => r.isMe)?.rank ?? null
  const isRaceDay         = races.length > 0 // show this week whenever races are set up
  const festIsLive        = festival?.is_active === true
  const festStartDate     = festival ? new Date(festival.start_date + 'T00:00:00') : null
  const festDaysUntil     = festStartDate ? Math.ceil((festStartDate - now) / 86400000) : null

  // Festival stat strip computations
  const festTotalDays    = (festival && festival.end_date)
    ? Math.round((new Date(festival.end_date + 'T00:00:00') - new Date(festival.start_date + 'T00:00:00')) / 86400000) + 1
    : null
  const beforeFestival   = festStartDate ? now < festStartDate : false
  // TODAY label — if before festival show "Day 1 · <start weekday>", else show current day
  const festDayLabel = (() => {
    if (!festStartDate || !festTotalDays) return '—'
    if (beforeFestival) {
      const startWeekday = festStartDate.toLocaleDateString('en-GB', { weekday: 'long' })
      return `Day 1 of ${festTotalDays} · ${startWeekday}`
    }
    const dayNum = Math.min(Math.max(Math.floor((now - festStartDate) / 86400000) + 1, 1), festTotalDays)
    return `Day ${dayNum} of ${festTotalDays} · ${now.toLocaleDateString('en-GB', { weekday: 'long' })}`
  })()
  const festDayLabelShort = (() => {
    if (!festStartDate || !festTotalDays) return '—'
    if (beforeFestival) {
      const startWeekday = festStartDate.toLocaleDateString('en-GB', { weekday: 'short' })
      return `Day 1 · ${startWeekday}`
    }
    const dayNum = Math.min(Math.max(Math.floor((now - festStartDate) / 86400000) + 1, 1), festTotalDays)
    return `Day ${dayNum} · ${now.toLocaleDateString('en-GB', { weekday: 'short' })}`
  })()
  // PICKS CLOSE — count down to 12:00pm on the next relevant festival day
  const picksDeadline = (() => {
    const target = beforeFestival ? new Date(festStartDate) : new Date(now)
    target.setHours(12, 0, 0, 0)
    return target
  })()
  const msToClose      = picksDeadline - now
  const picksClosed    = msToClose <= 0
  const picksCloseH    = picksClosed ? 0 : Math.floor(msToClose / 3600000)
  const picksCloseM    = picksClosed ? 0 : Math.floor((msToClose % 3600000) / 60000)
  const picksCloseLabel = picksClosed
    ? 'Closed'
    : picksCloseH > 0 ? `${picksCloseH}h ${picksCloseM}m` : `${picksCloseM}m`

  // Countdown blocks
  const getNextSat = () => {
    const d = new Date(now)
    const day = d.getDay()
    const skip = day === 6 ? (now.getHours() >= 12 ? 7 : 0) : (6 - day)
    d.setDate(d.getDate() + skip)
    d.setHours(12, 0, 0, 0)
    return d
  }
  const nextSatDt    = getNextSat()
  const msToSat      = Math.max(0, nextSatDt - now)
  const secsToSat    = Math.floor(msToSat / 1000)
  const cdDays       = Math.floor(secsToSat / 86400)
  const cdHours      = Math.floor((secsToSat % 86400) / 3600)
  const cdMins       = Math.floor((secsToSat % 3600) / 60)
  const nextSatLabel = nextSatDt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })

  const shownLeaderboard = leaderboardTab === 'season'   ? leaderboard
    : leaderboardTab === 'week'     ? weekLeaderboard
    : festLeaderboard

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>

      {/* ── Top nav ── */}
      <nav style={s.nav}>
        <div style={s.navInner}>
          <a href="/" style={s.navLogo}>Silks League</a>
          <div style={s.navLinks} className="app-nav-links">
            <a href="/dashboard" style={{ ...s.navLink, ...s.navLinkActive }}>Dashboard</a>
            <a href="/picks"     style={s.navLink}>My Picks</a>
            <a href="/league"    style={s.navLink}>League</a>
            <a href="/results"   style={s.navLink}>Results</a>
          </div>
          <div style={s.navRight}>
            <ProfileDropdown user={user} isAdmin={isAdmin} />
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main style={s.main} className="app-main-pad">

        {/* Greeting */}
        <section style={s.welcomeRow}>
          <div>
            <h1 style={s.welcomeHeading}>{getGreeting()}, {getFirstName()}.</h1>
            <p style={s.welcomeSub}>Here's what's happening in the league today.</p>
          </div>
        </section>

        {/* Festival banner */}
        {festival && (
          <section style={s.festBanner}>
            <div style={s.festShimmer} />
            <div style={s.festInner}>
              <div style={s.festLeft}>
                <div style={s.festLabel}>
                  {festIsLive
                    ? '👑 Festival Tournament · Live Now'
                    : `👑 Festival Tournament · Starting in ${festDaysUntil} day${festDaysUntil !== 1 ? 's' : ''}`}
                </div>
                <div style={s.festName}>{festival.display_name || festival.name}</div>
                <div style={s.festDates}>{fmtDate(festival.start_date)} — {fmtDate(festival.end_date)}</div>
              </div>
              <div style={s.festRight}>
                {festIsLive && !festivalEntry && (
                  <button style={s.festJoinBtn} onClick={joinFestival} disabled={joiningFestival}>
                    {joiningFestival ? 'Joining…' : 'Join Tournament'}
                  </button>
                )}
                <button
                  style={s.festViewBtn}
                  onClick={() => navigate(festIsLive ? '/picks' : '/festival-leaderboard', festIsLive ? { state: { festivalTab: festival?.id } } : undefined)}>
                  {festIsLive ? 'Make Picks →' : 'View Festival →'}
                </button>
              </div>
            </div>
            {festIsLive && (
              <>
                <div style={s.festStripDivider} />
                <div style={s.festStrip}>
                  <div style={s.festStripCol}>
                    <div style={s.festStripLabel}>RACE DAY</div>
                    <div style={{ ...s.festStripVal, color: '#e8f0e8' }}>
                      <span className="league-desktop-only">{festDayLabel}</span>
                      <span className="league-mobile-only">{festDayLabelShort}</span>
                    </div>
                  </div>
                  <div style={s.festStripSep} />
                  <div style={s.festStripCol}>
                    <div style={s.festStripLabel}>PICKS CLOSE</div>
                    <div style={{ ...s.festStripVal, color: picksClosed ? 'rgba(232,240,232,0.35)' : '#c9a84c' }}>
                      {picksCloseLabel}
                    </div>
                  </div>
                  <div style={s.festStripSep} />
                  <div style={s.festStripCol}>
                    <div style={s.festStripLabel}>YOUR POINTS</div>
                    <div style={{ ...s.festStripVal, color: '#c9a84c' }}>
                      {festivalPoints !== null ? `${festivalPoints} pts` : '0 pts'}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* Leaderboard — sits between festival banner and countdown */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Leaderboard</span>
            <div style={s.tabRow}>
              {festIsLive && (
                <button
                  style={{ ...s.tab, ...(leaderboardTab === 'festival' ? s.tabActive : {}) }}
                  onClick={() => setLeaderboardTab('festival')}>
                  {festival.display_name || festival.name}
                </button>
              )}
              <button
                style={{ ...s.tab, ...(leaderboardTab === 'week' ? s.tabActive : {}) }}
                onClick={() => setLeaderboardTab('week')}>
                This Week
              </button>
              <button
                style={{ ...s.tab, ...(leaderboardTab === 'season' ? s.tabActive : {}) }}
                onClick={() => setLeaderboardTab('season')}>
                Season
              </button>
            </div>
          </div>
          <div style={s.leaderList}>
            {shownLeaderboard.length === 0
              ? <div style={s.emptyMsg}>No scores yet — results appear here once submitted.</div>
              : shownLeaderboard.map(row => (
                  <div key={row.rank} style={{ ...s.leaderRow, ...(row.isMe ? s.leaderRowMe : {}) }}>
                    <div style={{ ...s.leaderRank, ...(row.rank > 3 ? { color: '#5a8a5a', fontSize: '0.82rem' } : {}) }}>
                      {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank}
                    </div>
                    <div
                      style={{ ...s.leaderName, cursor: 'pointer', textDecorationLine: 'underline', textDecorationStyle: 'dotted', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      onClick={() => setPicksModal({
                        userId: row.userId,
                        name:   row.name,
                        pts:    row.points,
                        rank:   row.rank,
                        ...(leaderboardTab === 'festival' && festival
                          ? { festivalId: festival.id, festivalName: festival.display_name || festival.name }
                          : {}),
                      })}>
                      {row.name}
                      {row.isMe && <span style={s.youBadge}>You</span>}
                      {row.midSeason && leaderboardTab === 'season' && (
                        <span style={{ fontSize: '0.58rem', fontWeight: '700', letterSpacing: '0.06em', color: '#5a8a5a', background: 'rgba(90,138,90,0.12)', padding: '0.1rem 0.4rem', borderRadius: '3px', whiteSpace: 'nowrap' }}>mid-season</span>
                      )}
                    </div>
                    <div style={s.leaderPoints}>{row.points} pts</div>
                  </div>
                ))
            }
          </div>
          <button
            style={s.viewAllBtn}
            onClick={() => leaderboardTab === 'festival' && festival
              ? navigate('/league', { state: { festivalTab: festival.id } })
              : navigate('/league')
            }>
            Full leaderboard →
          </button>
        </div>

        {/* Next race day countdown */}
        <style>{`@media(min-width:768px){.nrd-mb{display:none !important}.nrd-dt{display:flex !important}}@media(max-width:767px){.dash-two-col{grid-template-columns:1fr!important;width:100%}.dash-two-col>*{min-width:0;width:100%}}`}</style>
        <div style={s.card}>

          {/* ── Mobile layout — completely unchanged ── */}
          <div className="nrd-mb" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={s.cardHeader}>
              <span style={s.cardTitle}>SATURDAY LEAGUE · NEXT RACE DAY</span>
              <span style={s.cardBadge}>{nextSatLabel}</span>
            </div>
            {msToSat === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#4ade80', fontSize: '0.9rem', fontWeight: '600', padding: '0.75rem 0' }}>
                <span style={s.liveDot} />Races are live — good luck!
              </div>
            ) : (
              <div style={s.cdRow}>
                <div style={s.cdBlock}><div style={s.cdNum}>{String(cdDays).padStart(2, '0')}</div><div style={s.cdUnit}>DAYS</div></div>
                <div style={s.cdSep}>:</div>
                <div style={s.cdBlock}><div style={s.cdNum}>{String(cdHours).padStart(2, '0')}</div><div style={s.cdUnit}>HRS</div></div>
                <div style={s.cdSep}>:</div>
                <div style={s.cdBlock}><div style={s.cdNum}>{String(cdMins).padStart(2, '0')}</div><div style={s.cdUnit}>MIN</div></div>
              </div>
            )}
            <button style={s.goldBtn} onClick={() => navigate('/picks')}>MAKE PICKS →</button>
          </div>

          {/* ── Desktop layout — horizontal three-column row ── */}
          <div className="nrd-dt" style={{ display: 'none', alignItems: 'center', width: '100%', gap: '1.5rem' }}>

            {/* Left third — label + date + deadline */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', fontWeight: '700', letterSpacing: '2px', color: '#c9a84c', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                SATURDAY LEAGUE · NEXT RACE DAY
              </div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#e8f0e8', marginBottom: '0.25rem' }}>
                {nextSatDt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(232,240,232,0.35)' }}>
                Picks close at 12pm
              </div>
            </div>

            {/* Centre third — countdown blocks */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              {msToSat === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#4ade80', fontSize: '0.9rem', fontWeight: '600' }}>
                  <span style={s.liveDot} />Races are live!
                </div>
              ) : (
                <div style={s.cdRow}>
                  <div style={s.cdBlock}><div style={s.cdNum}>{String(cdDays).padStart(2, '0')}</div><div style={s.cdUnit}>DAYS</div></div>
                  <div style={s.cdSep}>:</div>
                  <div style={s.cdBlock}><div style={s.cdNum}>{String(cdHours).padStart(2, '0')}</div><div style={s.cdUnit}>HRS</div></div>
                  <div style={s.cdSep}>:</div>
                  <div style={s.cdBlock}><div style={s.cdNum}>{String(cdMins).padStart(2, '0')}</div><div style={s.cdUnit}>MIN</div></div>
                </div>
              )}
            </div>

            {/* Right third — button */}
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
              <button style={{ ...s.goldBtn, width: '100%', maxWidth: '180px' }} onClick={() => navigate('/picks')}>
                MAKE PICKS →
              </button>
            </div>

          </div>

        </div>

        {/* Stat pills */}
        <section style={s.pillsRow}>
          <div style={s.pill}>
            <span style={s.pillIcon}>⭐</span>
            <div>
              <div style={s.pillValue}>{seasonPoints !== null ? seasonPoints : '—'}</div>
              <div style={s.pillLabel}>My Points this season</div>
            </div>
          </div>
          <div style={s.pill}>
            <span style={s.pillIcon}>🏆</span>
            <div>
              <div style={s.pillValue}>
                {myRank ? `#${myRank}` : '—'}
                {myRank && totalUserCount > 0 && (
                  <span style={s.pillValueSub}> / {totalUserCount}</span>
                )}
              </div>
              <div style={s.pillLabel}>League Rank</div>
            </div>
          </div>
        </section>

        {/* Smart race card — full width at bottom */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>
              {isRaceDay ? "THIS WEEK'S RACES" : 'LAST WEEK'}
            </span>
            <span style={s.cardBadge}>
              {isRaceDay
                ? `${races.length} race${races.length !== 1 ? 's' : ''}`
                : 'Performance'}
            </span>
          </div>

          {/* State A — Race day */}
          {isRaceDay && (
            <div style={s.raceList}>
              {races.length === 0
                ? <div style={s.emptyMsg}>No races set up yet — check back soon.</div>
                : races.map(r => {
                    const picked = thisWeekPicks[r.id]
                    return (
                      <div key={r.id} style={s.raceRow}>
                        <div style={s.raceTime}>{r.time || '—'}</div>
                        <div style={s.raceInfo}>
                          <div style={s.raceCourse}>{r.course}</div>
                          <div style={s.raceName}>{r.race || 'Race'}</div>
                        </div>
                        {picked
                          ? <div style={s.pickedBadge}>✓ Picked</div>
                          : <button style={s.pickBtn} onClick={() => navigate('/picks')}>Pick →</button>
                        }
                      </div>
                    )
                  })
              }
            </div>
          )}

          {/* State B — Mid-week / Last week */}
          {!isRaceDay && (
            <div style={s.raceList}>
              {lastWeekData.length === 0
                ? <div style={s.emptyMsg}>No results available for last week yet.</div>
                : lastWeekData.map(({ race, pick, score }) => {
                    const pos = score?.position_achieved
                    const pts = score?.total_points ?? null
                    const posBadge = pos === 1 ? s.posBadgeGreen : (pos === 2 || pos === 3) ? s.posBadgeGold : s.posBadgeGrey
                    const ptsPill  = pos === 1 ? s.ptsPillGreen  : (pos === 2 || pos === 3) ? s.ptsPillGold  : s.ptsPillGrey
                    const posLabel = pos === 1 ? '1st' : pos === 2 ? '2nd' : pos === 3 ? '3rd' : pos ? `${pos}th` : '—'
                    return (
                      <div key={race.id} style={s.raceRow}>
                        <div style={s.raceTime}>{race.race_time || '—'}</div>
                        <div style={s.raceInfo}>
                          <div style={s.raceCourse}>{race.venue}</div>
                          {pick
                            ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.1rem' }}>
                                {pick.silkColour && (
                                  <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: pick.silkColour, display: 'inline-block', flexShrink: 0, border: '1px solid rgba(255,255,255,0.25)' }} />
                                )}
                                <span style={s.raceName}>{pick.horseName}</span>
                              </div>
                            )
                            : <div style={s.raceName}>No pick</div>
                          }
                        </div>
                        <div style={posBadge}>{posLabel}</div>
                        {pts !== null && (
                          <div style={ptsPill}>{pts > 0 ? `+${pts}` : pts} pts</div>
                        )}
                      </div>
                    )
                  })
              }
            </div>
          )}
        </div>


      </main>

      {/* ── Mobile bottom bar ── */}
      <nav style={s.mobileBar} className="app-mobile-bar">
        <a href="/dashboard" style={{ ...s.mobileItem, ...s.mobileItemActive }}>
          <Home size={22} strokeWidth={1.5} />
          <span style={s.mobileLabel}>Home</span>
          <span style={s.mobileDot} />
        </a>
        <a href="/picks" style={s.mobileItem}>
          <Target size={22} strokeWidth={1.5} />
          <span style={s.mobileLabel}>Picks</span>
        </a>
        <a href="/league" style={s.mobileItem}>
          <Trophy size={22} strokeWidth={1.5} />
          <span style={s.mobileLabel}>League</span>
        </a>
        <a href="/results" style={s.mobileItem}>
          <BarChart2 size={22} strokeWidth={1.5} />
          <span style={s.mobileLabel}>Results</span>
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

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page: {
    minHeight: '100vh', background: '#0a1a08',
    fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '5rem',
  },
  loadingPage: {
    minHeight: '100vh', background: '#0a1a08',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  loadingDot: { width: '12px', height: '12px', borderRadius: '50%', background: '#c9a84c' },

  // Nav
  nav: { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  navInner: { maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem', height: '60px', display: 'flex', alignItems: 'center', gap: '2rem' },
  navLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0 },
  navLinks: { display: 'flex', gap: '0.25rem', flex: 1 },
  navLink: { padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: '500', color: '#5a8a5a', textDecoration: 'none' },
  navLinkActive: { color: '#e8f0e8', background: 'rgba(201,168,76,0.1)' },
  navRight: { marginLeft: 'auto', position: 'relative' },

  // Main
  main: { maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' },

  // Greeting
  welcomeRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' },
  welcomeHeading: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.6rem', color: '#e8f0e8', letterSpacing: '0.03em', margin: 0, lineHeight: 1 },
  welcomeSub: { marginTop: '0.4rem', fontSize: '0.9rem', color: '#5a8a5a' },
  statusPill: { padding: '0.4rem 1rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: '600', letterSpacing: '0.03em', flexShrink: 0, alignSelf: 'flex-start', marginTop: '0.25rem', background: 'rgba(201,168,76,0.12)', color: '#c9a84c' },
  countdownPill: { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: '10px', padding: '0.5rem 1.1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, alignSelf: 'flex-start', marginTop: '0.1rem', minWidth: '110px' },
  countdownValue: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem', color: '#c9a84c', letterSpacing: '0.06em', lineHeight: 1 },
  countdownSublabel: { fontSize: '0.62rem', color: '#5a8a5a', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.15rem' },
  livePill: { display: 'flex', alignItems: 'center', gap: '0.45rem', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: '999px', padding: '0.4rem 1rem', color: '#4ade80', fontWeight: '700', fontSize: '0.85rem', letterSpacing: '0.1em', flexShrink: 0, alignSelf: 'flex-start', marginTop: '0.25rem' },
  liveDot: { width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', flexShrink: 0 },

  // Festival banner
  festBanner: {
    position: 'relative',
    background: "linear-gradient(to right, rgba(10,26,8,0.93) 0%, rgba(10,26,8,0.6) 55%, rgba(10,26,8,0.2) 100%), url('https://images.unsplash.com/photo-1597651482572-9957ddaacfab?w=1400&q=85&fit=crop&crop=center') center 35% / cover no-repeat",
    border: '1.5px solid #c9a84c',
    borderRadius: '12px',
    overflow: 'hidden',
    minHeight: '110px',
  },
  festShimmer: { position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, transparent 0%, #c9a84c 30%, #f5d98b 50%, #c9a84c 70%, transparent 100%)' },
  festInner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem 2rem', gap: '1.5rem', flexWrap: 'wrap' },
  festLeft: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  festLabel: { fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c9a84c' },
  festName: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#fff', letterSpacing: '0.05em', lineHeight: 1.1 },
  festDates: { fontSize: '0.77rem', color: 'rgba(232,240,232,0.6)', marginTop: '0.1rem' },
  festRight: { display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' },
  festPts: { textAlign: 'center' },
  festPtsVal: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.4rem', color: '#c9a84c', lineHeight: 1 },
  festPtsLbl: { fontSize: '0.63rem', color: 'rgba(201,168,76,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  festJoinBtn: { background: 'rgba(201,168,76,0.15)', border: '1.5px solid #c9a84c', color: '#c9a84c', borderRadius: '8px', padding: '0.55rem 1.2rem', fontFamily: "'DM Sans', sans-serif", fontWeight: '600', fontSize: '0.875rem', cursor: 'pointer', whiteSpace: 'nowrap' },
  festViewBtn:      { background: '#c9a84c', border: 'none', color: '#0a1a08', borderRadius: '8px', padding: '0.55rem 1.2rem', fontFamily: "'DM Sans', sans-serif", fontWeight: '700', fontSize: '0.875rem', cursor: 'pointer', whiteSpace: 'nowrap' },
  festStripDivider: { height: '1px', background: 'rgba(201,168,76,0.25)' },
  festStrip:        { display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '0.85rem 2rem' },
  festStripCol:     { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', padding: '0 0.5rem' },
  festStripLabel:   { fontSize: '0.62rem', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(232,240,232,0.45)', fontFamily: "'DM Sans', sans-serif" },
  festStripVal:     { fontSize: '14px', fontWeight: '700', fontFamily: "'DM Sans', sans-serif" },
  festStripSep:     { width: '1px', height: '36px', background: 'rgba(201,168,76,0.25)' },

  // Stat pills
  pillsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  pill: { background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' },
  pillIcon: { fontSize: '1.6rem', flexShrink: 0 },
  pillValue: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.2rem', color: '#c9a84c', letterSpacing: '0.03em', lineHeight: 1 },
  pillValueSub: { fontFamily: "'DM Sans', sans-serif", fontSize: '1.1rem', color: '#5a8a5a', fontWeight: '400' },
  pillLabel: { fontSize: '0.78rem', color: '#e8f0e8', fontWeight: '500', marginTop: '0.2rem' },

  // Cards
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  card: { background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' },
  cardTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.1rem', color: '#e8f0e8', letterSpacing: '0.08em' },
  cardBadge: { background: 'rgba(201,168,76,0.12)', color: '#c9a84c', fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '999px', whiteSpace: 'nowrap' },
  emptyMsg: { color: '#5a8a5a', fontSize: '0.83rem', padding: '0.25rem 0' },

  // Race rows
  raceList: { display: 'flex', flexDirection: 'column', gap: '0.55rem' },
  raceRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.75rem', background: 'rgba(201,168,76,0.04)', borderRadius: '6px', border: '1px solid rgba(201,168,76,0.14)' },
  raceTime: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '0.92rem', color: '#c9a84c', letterSpacing: '0.05em', minWidth: '36px' },
  raceInfo: { flex: 1, minWidth: 0 },
  raceCourse: { fontSize: '0.82rem', fontWeight: '600', color: '#e8f0e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  raceName: { fontSize: '0.71rem', color: '#5a8a5a', marginTop: '0.08rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  pickedBadge: { background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', borderRadius: '6px', padding: '0.28rem 0.55rem', fontSize: '0.73rem', fontWeight: '700', whiteSpace: 'nowrap', flexShrink: 0 },
  pickBtn: { background: '#c9a84c', color: '#0a1a08', border: 'none', borderRadius: '6px', padding: '0.28rem 0.6rem', fontSize: '0.73rem', fontWeight: '700', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 },
  posBadgeGreen: { background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', borderRadius: '5px', padding: '0.22rem 0.45rem', fontSize: '0.7rem', fontWeight: '700', flexShrink: 0, whiteSpace: 'nowrap' },
  posBadgeGold:  { background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', borderRadius: '5px', padding: '0.22rem 0.45rem', fontSize: '0.7rem', fontWeight: '700', flexShrink: 0, whiteSpace: 'nowrap' },
  posBadgeGrey:  { background: 'rgba(90,138,90,0.08)', border: '1px solid rgba(90,138,90,0.2)', color: '#5a8a5a', borderRadius: '5px', padding: '0.22rem 0.45rem', fontSize: '0.7rem', fontWeight: '700', flexShrink: 0, whiteSpace: 'nowrap' },
  ptsPillGreen: { background: 'rgba(74,222,128,0.1)', color: '#4ade80', borderRadius: '4px', padding: '0.18rem 0.4rem', fontSize: '0.7rem', fontWeight: '700', flexShrink: 0, whiteSpace: 'nowrap' },
  ptsPillGold:  { background: 'rgba(201,168,76,0.1)', color: '#c9a84c', borderRadius: '4px', padding: '0.18rem 0.4rem', fontSize: '0.7rem', fontWeight: '700', flexShrink: 0, whiteSpace: 'nowrap' },
  ptsPillGrey:  { background: 'rgba(90,138,90,0.08)', color: '#5a8a5a', borderRadius: '4px', padding: '0.18rem 0.4rem', fontSize: '0.7rem', fontWeight: '700', flexShrink: 0, whiteSpace: 'nowrap' },

  // Leaderboard tabs
  tabRow: { display: 'flex', gap: '0.35rem' },
  tab: { background: 'none', border: '1px solid rgba(201,168,76,0.2)', color: '#5a8a5a', borderRadius: '6px', padding: '0.28rem 0.65rem', fontSize: '0.73rem', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  tabActive: { background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.4)', color: '#c9a84c' },
  leaderList: { display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  leaderRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.7rem', borderRadius: '6px', background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.14)' },
  leaderRowMe: { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.4)' },
  leaderRank: { fontSize: '0.9rem', minWidth: '24px', textAlign: 'center' },
  leaderName: { flex: 1, fontSize: '0.84rem', fontWeight: '500', color: '#e8f0e8', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  leaderPoints: { fontSize: '0.84rem', fontWeight: '600', color: '#c9a84c' },
  viewAllBtn: { background: 'none', border: '1px solid rgba(201,168,76,0.2)', color: '#c9a84c', borderRadius: '8px', padding: '0.55rem 1rem', fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", width: '100%', textAlign: 'center', marginTop: 'auto' },
  youBadge: { fontSize: '0.55rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0a1a08', background: '#c9a84c', padding: '0.1rem 0.35rem', borderRadius: '3px', whiteSpace: 'nowrap', textDecorationLine: 'none' },

  // Countdown blocks
  cdRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.25rem 0' },
  cdBlock: { background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.22)', borderRadius: '8px', padding: '0.7rem 0.9rem', textAlign: 'center', minWidth: '60px' },
  cdNum: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.2rem', color: '#c9a84c', letterSpacing: '0.06em', lineHeight: 1 },
  cdUnit: { fontSize: '0.58rem', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#5a8a5a', marginTop: '0.2rem' },
  cdSep: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.8rem', color: 'rgba(201,168,76,0.35)', lineHeight: 1, paddingBottom: '0.4rem' },
  goldBtn: { background: '#c9a84c', border: 'none', color: '#0a1a08', borderRadius: '8px', padding: '0.65rem 1.25rem', fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', letterSpacing: '0.08em', cursor: 'pointer', width: '100%', textAlign: 'center', marginTop: 'auto' },

  // Mobile bar
  mobileBar: { display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)', padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around' },
  mobileItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '0.3rem 0', color: 'rgba(232,220,200,0.4)', textDecoration: 'none', flex: 1 },
  mobileItemActive: { color: '#c9a84c' },
  mobileLabel: { fontSize: '10px', fontWeight: '500' },
  mobileDot: { width: '4px', height: '4px', borderRadius: '50%', background: '#c9a84c', marginTop: '1px' },
}
