import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser]                   = useState(null)
  const [isAdmin, setIsAdmin]             = useState(false)
  const [loading, setLoading]             = useState(true)
  const [menuOpen, setMenuOpen]           = useState(false)
  const [races, setRaces]                 = useState([])
  const [seasonPoints, setSeasonPoints]   = useState(null)
  const [weekPicksCount, setWeekPicksCount] = useState(null)
  const [leaderboard, setLeaderboard]     = useState([])
  const [currentWeekNum, setCurrentWeekNum] = useState(null)
  const [now, setNow] = useState(new Date())

  // Tick every second
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
        await loadRaces()
        await loadStats(user.id)
        await loadLeaderboard(user.id)
        setLoading(false)
      }
    })
  }, [navigate])

  async function loadRaces() {
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

    setRaces(raceData.map(r => ({
      id:      r.id,
      number:  r.race_number,
      time:    r.race_time,
      course:  r.venue,
      race:    r.race_name,
      runners: parseInt(r.runners?.[0]?.count ?? 0),
    })))
  }

  async function loadStats(userId) {
    // Active season
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) { setSeasonPoints(0); setWeekPicksCount(0); return }

    // All weeks in season
    const { data: weeks } = await supabase
      .from('race_weeks').select('id').eq('season_id', season.id)
    if (!weeks?.length) { setSeasonPoints(0); setWeekPicksCount(0); return }

    // Current week (most recent)
    const { data: currentWeekArr } = await supabase
      .from('race_weeks').select('id')
      .eq('season_id', season.id)
      .order('saturday_date', { ascending: false })
      .limit(1)
    const currentWeekId = currentWeekArr?.[0]?.id

    // All race IDs for the season
    const weekIds = weeks.map(w => w.id)
    const { data: allRaces } = await supabase
      .from('races').select('id, race_week_id').in('race_week_id', weekIds)
    if (!allRaces?.length) { setSeasonPoints(0); setWeekPicksCount(0); return }

    const allRaceIds  = allRaces.map(r => r.id)
    const weekRaceIds = currentWeekId
      ? allRaces.filter(r => r.race_week_id === currentWeekId).map(r => r.id)
      : []

    // Season total: sum scores for this user across all season races
    const { data: seasonScores } = await supabase
      .from('scores').select('total_points').eq('user_id', userId).in('race_id', allRaceIds)
    const total = seasonScores?.reduce((s, r) => s + (r.total_points || 0), 0) ?? 0
    setSeasonPoints(total)

    // Picks made this week = picks rows (saved before results come in)
    if (weekRaceIds.length) {
      const { data: weekPicks } = await supabase
        .from('picks').select('id').eq('user_id', userId).in('race_id', weekRaceIds)
      setWeekPicksCount(weekPicks?.length ?? 0)
    } else {
      setWeekPicksCount(0)
    }
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

    // Try all scores first; fall back to own scores if RLS blocks the query
    let scores = []
    if (allRaceIds.length) {
      const { data: allScores, error } = await supabase
        .from('scores').select('user_id, total_points').in('race_id', allRaceIds)
      if (!error && allScores?.length) scores = allScores
    }
    if (!scores.length) {
      const ownQ = supabase.from('scores').select('user_id, total_points').eq('user_id', myUserId)
      const { data: ownScores } = allRaceIds.length
        ? await ownQ.in('race_id', allRaceIds)
        : await ownQ
      scores = ownScores || []
    }
    if (!scores.length) return

    const byUser = {}
    scores.forEach(s => {
      if (!byUser[s.user_id]) byUser[s.user_id] = { user_id: s.user_id, total: 0 }
      byUser[s.user_id].total += (s.total_points || 0)
    })

    const { data: profiles } = await supabase
      .from('profiles').select('id, display_name, full_name').in('id', Object.keys(byUser))
    profiles?.forEach(p => {
      if (byUser[p.id]) byUser[p.id].name = p.display_name || p.full_name || null
    })

    const sorted = Object.values(byUser)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((u, i) => ({
        rank:   i + 1,
        name:   u.user_id === myUserId ? 'You' : (u.name || `Player ${i + 1}`),
        points: u.total,
        isMe:   u.user_id === myUserId,
      }))
    setLeaderboard(sorted)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const getFirstName = () => {
    const fullName = user?.user_metadata?.full_name || user?.email || ''
    return fullName.split(' ')[0] || 'there'
  }

  // ── Live countdown to next Saturday 11:00 picks deadline ────
  const getCountdownStatus = () => {
    const day  = now.getDay()   // 0 Sun … 6 Sat
    const hour = now.getHours()

    // Calculate next Saturday midnight
    const daysUntilSat = day === 6 ? 0 : (6 - day)
    const nextSat = new Date(now)
    nextSat.setDate(now.getDate() + daysUntilSat)
    nextSat.setHours(11, 0, 0, 0) // 11:00 deadline

    // If it's Saturday after 11am — show LIVE
    if (day === 6 && hour >= 11) {
      return { mode: 'live' }
    }

    const msLeft = nextSat - now
    const totalSecs = Math.floor(msLeft / 1000)
    const days  = Math.floor(totalSecs / 86400)
    const hours = Math.floor((totalSecs % 86400) / 3600)
    const mins  = Math.floor((totalSecs % 3600) / 60)
    const secs  = totalSecs % 60

    // More than 6 days away — just show the date
    if (days >= 6) {
      const dateStr = nextSat.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      return { mode: 'date', label: `Race day ${dateStr}` }
    }

    // Within 6 days — show countdown
    let label
    if (days > 0)       label = `${days}d ${hours}h ${mins}m`
    else if (hours > 0) label = `${hours}h ${mins}m ${secs}s`
    else                label = `${mins}m ${secs}s`

    return { mode: 'countdown', label, sublabel: 'to picks deadline' }
  }

  if (loading) {
    return (
      <div style={styles.loadingPage}>
        <div style={styles.loadingDot} />
      </div>
    )
  }

  const countdown = getCountdownStatus()

  const myLeaderboardRank = leaderboard.find(r => r.isMe)?.rank ?? null

  const statCards = [
    {
      label: 'My Points',
      value: seasonPoints !== null ? String(seasonPoints) : '—',
      sub:   'this season',
      icon:  '⭐',
    },
    {
      label: 'League Rank',
      value: myLeaderboardRank ? `#${myLeaderboardRank}` : '—',
      sub:   leaderboard.length ? `out of ${leaderboard.length} players` : 'this season',
      icon:  '🏆',
    },
    {
      label: 'Picks Made',
      value: weekPicksCount !== null ? String(weekPicksCount) : '—',
      sub:   'this week',
      icon:  '🎯',
    },
    {
      label: 'Win Rate',
      value: '—%',
      sub:   'all time',
      icon:  '📈',
    },
  ]

  return (
    <div style={styles.page}>

      {/* ── Top Nav ── */}
      <nav style={styles.nav}>
        <div style={styles.navInner}>
          <a href="/" style={styles.navLogo}>Silks League</a>

          <div style={styles.navLinks} className="app-nav-links">
            <a href="/dashboard" style={{ ...styles.navLink, ...styles.navLinkActive }}>Dashboard</a>
            <a href="/picks"     style={styles.navLink}>My Picks</a>
            <a href="/league"    style={styles.navLink}>League</a>
            <a href="/races"     style={styles.navLink}>Races</a>
            <a href="/results"   style={styles.navLink}>Results</a>
            <a href="/groups"    style={styles.navLink}>Groups</a>
            {/* Admin link — only shown to admin users */}
            {isAdmin && (
              <a href="/admin" style={{ ...styles.navLink, color: '#c9a84c' }}>Admin</a>
            )}
          </div>

          {/* Avatar + dropdown */}
          <div style={styles.navRight}>
            <div
              style={styles.avatar}
              onClick={() => navigate('/profile')}
              title="View profile"
            >
              {getFirstName().charAt(0).toUpperCase()}
            </div>

            {menuOpen && (
              <div style={styles.dropdownMenu}>
                <div style={styles.dropdownEmail}>{user?.email}</div>
                <hr style={styles.dropdownDivider} />
                <button style={styles.dropdownItem} onClick={() => { setMenuOpen(false); navigate('/profile') }}>My Profile</button>
                {isAdmin && (
                  <>
                    <hr style={styles.dropdownDivider} />
                    <button style={{ ...styles.dropdownItem, color: '#c9a84c' }}
                      onClick={() => { setMenuOpen(false); navigate('/admin') }}>
                      Admin Panel
                    </button>
                  </>
                )}
                <hr style={styles.dropdownDivider} />
                <button style={{ ...styles.dropdownItem, ...styles.dropdownSignOut }} onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Main content ── */}
      <main style={styles.main} className="app-main-pad">

        {/* Welcome header */}
        <section style={styles.welcomeRow}>
          <div>
            <h1 style={styles.welcomeHeading}>
              {getGreeting()}, {getFirstName()}.
            </h1>
            <p style={styles.welcomeSub}>Here's what's happening in the league today.</p>
          </div>
          {countdown.mode === 'live' && (
            <div style={styles.livePill}>
              <span style={styles.liveDot} />
              LIVE
            </div>
          )}
          {countdown.mode === 'date' && (
            <div style={styles.statusPill}>
              {countdown.label}
            </div>
          )}
          {countdown.mode === 'countdown' && (
            <div style={styles.countdownPill}>
              <span style={styles.countdownValue}>{countdown.label}</span>
              <span style={styles.countdownSublabel}>{countdown.sublabel}</span>
            </div>
          )}
        </section>

        {/* Stat cards */}
        <section style={styles.statsGrid} className="app-grid-4">
          {statCards.map((card) => (
            <div key={card.label} style={styles.statCard}>
              <div style={styles.statIcon}>{card.icon}</div>
              <div style={styles.statValue}>{card.value}</div>
              <div style={styles.statLabel}>{card.label}</div>
              <div style={styles.statSub}>{card.sub}</div>
            </div>
          ))}
        </section>

        {/* Two-column layout */}
        <section style={styles.twoCol} className="app-grid-2">

          {/* This Week's Races */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>This Week's Races</span>
              <span style={styles.cardBadge}>{races.length} / 5 races</span>
            </div>
            <div style={styles.raceList}>
              {races.length === 0 ? (
                <div style={{ color: '#5a8a5a', fontSize: '0.85rem', padding: '0.5rem 0' }}>
                  No races set up yet — check back soon.
                </div>
              ) : (
                races.map(r => (
                  <div key={r.id} style={styles.raceRow}>
                    <div style={styles.raceTime}>{r.time}</div>
                    <div style={styles.raceInfo}>
                      <div style={styles.raceCourse}>{r.course}</div>
                      <div style={styles.raceName}>{r.race}</div>
                    </div>
                    <div style={styles.raceRunners}>{r.runners} runner{r.runners !== 1 ? 's' : ''}</div>
                    <button style={styles.pickBtn} onClick={() => navigate('/picks')}>Pick →</button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Live Leaderboard */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>Live Leaderboard</span>
              {currentWeekNum && <span style={styles.cardBadge}>Week {currentWeekNum}</span>}
            </div>
            <div style={styles.leaderList}>
              {leaderboard.length === 0 ? (
                <div style={{ color: '#5a8a5a', fontSize: '0.85rem', padding: '0.5rem 0' }}>
                  No scores yet — results will appear here once races are submitted.
                </div>
              ) : (
                leaderboard.map((row) => (
                  <div
                    key={row.rank}
                    style={{ ...styles.leaderRow, ...(row.isMe ? styles.leaderRowMe : {}) }}
                  >
                    <div style={styles.leaderRank}>
                      {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                    </div>
                    <div style={styles.leaderName}>{row.name}</div>
                    <div style={styles.leaderPoints}>{row.points} pts</div>
                  </div>
                ))
              )}
            </div>
            <button style={styles.viewAllBtn} onClick={() => navigate('/league')}>Full leaderboard →</button>
          </div>
        </section>

        {/* Bottom strip */}
        <section style={styles.bottomStrip} className="app-grid-2">
          <div style={styles.bottomCard}>
            <div style={styles.bottomCardIcon}>👥</div>
            <div style={styles.bottomCardBody}>
              <div style={styles.bottomCardTitle}>My Group</div>
              <div style={styles.bottomCardSub}>The Somerset Silks · 6 members</div>
            </div>
            <button style={styles.bottomCardBtn}>View group →</button>
          </div>
          <div style={styles.bottomCard}>
            <div style={styles.bottomCardIcon}>📅</div>
            <div style={styles.bottomCardBody}>
              <div style={styles.bottomCardTitle}>Next Race Day</div>
              <div style={styles.bottomCardSub}>Picks close Saturday at 11am</div>
            </div>
            <button style={styles.bottomCardBtn} onClick={() => navigate('/picks')}>Make picks →</button>
          </div>
        </section>
      </main>

      {/* ── Mobile bottom bar ── */}
      <nav style={styles.mobileBar} className="app-mobile-bar">
        <a href="/dashboard" style={{ ...styles.mobileBarItem, ...styles.mobileBarItemActive }}>
          <span>🏠</span><span style={styles.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={styles.mobileBarItem}>
          <span>🎯</span><span style={styles.mobileBarLabel}>Picks</span>
        </a>
        <a href="/league" style={styles.mobileBarItem}>
          <span>🏆</span><span style={styles.mobileBarLabel}>League</span>
        </a>
        <a href="/races" style={styles.mobileBarItem}>
          <span>🐴</span><span style={styles.mobileBarLabel}>Races</span>
        </a>
        <a href="/results" style={styles.mobileBarItem}>
          <span>📊</span><span style={styles.mobileBarLabel}>Results</span>
        </a>
        <a href="/groups" style={styles.mobileBarItem}>
          <span>👥</span><span style={styles.mobileBarLabel}>Groups</span>
        </a>
      </nav>

    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh', background: '#0a1a08',
    fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '5rem',
  },
  loadingPage: {
    minHeight: '100vh', background: '#0a1a08',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  loadingDot: {
    width: '12px', height: '12px', borderRadius: '50%', background: '#c9a84c',
  },
  nav: {
    background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)',
    position: 'sticky', top: 0, zIndex: 100,
  },
  navInner: {
    maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem',
    height: '60px', display: 'flex', alignItems: 'center', gap: '2rem',
  },
  navLogo: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem',
    color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0,
  },
  navLinks: { display: 'flex', gap: '0.25rem', flex: 1 },
  navLink: {
    padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.875rem',
    fontWeight: '500', color: '#5a8a5a', textDecoration: 'none',
  },
  navLinkActive: { color: '#e8f0e8', background: 'rgba(201,168,76,0.1)' },
  navRight: { marginLeft: 'auto', position: 'relative' },
  avatar: {
    width: '36px', height: '36px', borderRadius: '50%', background: '#c9a84c',
    color: '#0a1a08', fontWeight: '700', fontSize: '0.9rem',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', userSelect: 'none',
  },
  dropdownMenu: {
    position: 'absolute', top: 'calc(100% + 0.5rem)', right: 0,
    background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '10px', padding: '0.5rem 0', minWidth: '200px',
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)', zIndex: 200,
  },
  dropdownEmail: { padding: '0.5rem 1rem 0.75rem', fontSize: '0.78rem', color: '#5a8a5a' },
  dropdownDivider: { border: 'none', borderTop: '1px solid rgba(201,168,76,0.1)', margin: '0.25rem 0' },
  dropdownItem: {
    display: 'block', width: '100%', padding: '0.55rem 1rem', textAlign: 'left',
    background: 'none', border: 'none', color: '#e8f0e8', fontSize: '0.875rem',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },
  dropdownSignOut: { color: '#f87171' },
  main: {
    maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem',
    display: 'flex', flexDirection: 'column', gap: '1.75rem',
  },
  welcomeRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: '1rem',
  },
  welcomeHeading: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.6rem',
    color: '#e8f0e8', letterSpacing: '0.03em', margin: 0, lineHeight: 1,
  },
  welcomeSub: { marginTop: '0.4rem', fontSize: '0.9rem', color: '#5a8a5a' },
  statusPill: {
    padding: '0.4rem 1rem', borderRadius: '999px', fontSize: '0.8rem',
    fontWeight: '600', letterSpacing: '0.03em', flexShrink: 0,
    alignSelf: 'flex-start', marginTop: '0.25rem',
    background: 'rgba(201,168,76,0.12)', color: '#c9a84c',
  },
  countdownPill: {
    background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)',
    borderRadius: '10px', padding: '0.5rem 1.1rem',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    flexShrink: 0, alignSelf: 'flex-start', marginTop: '0.1rem', minWidth: '110px',
  },
  countdownValue: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem',
    color: '#c9a84c', letterSpacing: '0.06em', lineHeight: 1,
  },
  countdownSublabel: {
    fontSize: '0.62rem', color: '#5a8a5a',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.15rem',
  },
  livePill: {
    display: 'flex', alignItems: 'center', gap: '0.45rem',
    background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
    borderRadius: '999px', padding: '0.4rem 1rem',
    color: '#4ade80', fontWeight: '700', fontSize: '0.85rem',
    letterSpacing: '0.1em', flexShrink: 0, alignSelf: 'flex-start', marginTop: '0.25rem',
  },
  liveDot: {
    width: '8px', height: '8px', borderRadius: '50%',
    background: '#4ade80', boxShadow: '0 0 6px #4ade80', flexShrink: 0,
  },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' },
  statCard: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '1.25rem',
    display: 'flex', flexDirection: 'column', gap: '0.3rem',
  },
  statIcon:  { fontSize: '1.3rem', marginBottom: '0.25rem' },
  statValue: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.2rem', color: '#c9a84c', letterSpacing: '0.03em', lineHeight: 1 },
  statLabel: { fontSize: '0.8rem', fontWeight: '600', color: '#e8f0e8', letterSpacing: '0.03em', textTransform: 'uppercase' },
  statSub:   { fontSize: '0.75rem', color: '#5a8a5a' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  card: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '1.5rem',
    display: 'flex', flexDirection: 'column', gap: '1rem',
  },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: '#e8f0e8', letterSpacing: '0.05em' },
  cardBadge:  { background: 'rgba(201,168,76,0.12)', color: '#c9a84c', fontSize: '0.75rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '999px' },
  raceList:   { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  raceRow: {
    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem',
    background: 'rgba(201,168,76,0.04)', borderRadius: '6px', border: '1px solid rgba(201,168,76,0.2)',
  },
  raceTime:    { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', color: '#c9a84c', letterSpacing: '0.05em', minWidth: '40px' },
  raceInfo:    { flex: 1 },
  raceCourse:  { fontSize: '0.875rem', fontWeight: '600', color: '#e8f0e8' },
  raceName:    { fontSize: '0.75rem', color: '#5a8a5a', marginTop: '0.1rem' },
  raceRunners: { fontSize: '0.75rem', color: '#5a8a5a', whiteSpace: 'nowrap' },
  pickBtn: {
    background: '#c9a84c', color: '#0a1a08', border: 'none', borderRadius: '6px',
    padding: '0.35rem 0.7rem', fontSize: '0.78rem', fontWeight: '600',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap',
  },
  viewAllBtn: {
    background: 'none', border: '1px solid rgba(201,168,76,0.2)', color: '#c9a84c',
    borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.85rem', fontWeight: '600',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", width: '100%', textAlign: 'center',
  },
  leaderList: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  leaderRow: {
    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.75rem',
    borderRadius: '6px', background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.2)',
  },
  leaderRowMe: { background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.4)' },
  leaderRank:   { fontSize: '1rem', minWidth: '28px', textAlign: 'center' },
  leaderName:   { flex: 1, fontSize: '0.875rem', fontWeight: '500', color: '#e8f0e8' },
  leaderPoints: { fontSize: '0.875rem', fontWeight: '600', color: '#c9a84c' },
  leaderChange: { fontSize: '0.75rem', color: '#5a8a5a', minWidth: '16px', textAlign: 'center' },
  bottomStrip: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  bottomCard: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '1.25rem 1.5rem',
    display: 'flex', alignItems: 'center', gap: '1rem',
  },
  bottomCardIcon: { fontSize: '1.8rem', flexShrink: 0 },
  bottomCardBody: { flex: 1 },
  bottomCardTitle: { fontWeight: '600', fontSize: '0.95rem', color: '#e8f0e8' },
  bottomCardSub:   { fontSize: '0.78rem', color: '#5a8a5a', marginTop: '0.15rem' },
  bottomCardBtn: {
    background: 'none', border: '1px solid rgba(201,168,76,0.25)', color: '#c9a84c',
    borderRadius: '7px', padding: '0.45rem 0.85rem', fontSize: '0.8rem', fontWeight: '600',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0,
  },
  mobileBar: {
    display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0,
    background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)',
    padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around',
  },
  mobileBarItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
    color: '#5a8a5a', textDecoration: 'none', fontSize: '1.1rem', padding: '0.25rem 0.75rem',
  },
  mobileBarItemActive: { color: '#c9a84c' },
  mobileBarLabel: { fontSize: '0.65rem', fontWeight: '500' },
}
