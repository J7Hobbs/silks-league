import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function League() {
  const navigate = useNavigate()
  const [user, setUser]         = useState(null)
  const [isAdmin, setIsAdmin]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [rows, setRows]         = useState([])
  const [weekRows, setWeekRows] = useState([])
  const [season, setSeason]     = useState(null)
  const [currentWeek, setCurrentWeek] = useState(null)
  const [activeTab, setActiveTab] = useState('season') // 'season' | 'week'

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setUser(user)
      const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', user.id).single()
      setIsAdmin(profile?.is_admin || false)
      await loadLeaderboard(user.id)
      setLoading(false)
    })
  }, [navigate])

  async function loadLeaderboard(myUserId) {
    // Active season
    const { data: s } = await supabase
      .from('seasons').select('id, season_name').eq('is_active', true).single()
    if (!s) return
    setSeason(s)

    // All weeks in season
    const { data: weeks } = await supabase
      .from('race_weeks').select('id, week_number, saturday_date')
      .eq('season_id', s.id)
      .order('saturday_date', { ascending: false })
    if (!weeks?.length) return

    // Most recent week
    const latestWeek = weeks[0]
    setCurrentWeek(latestWeek)

    // All race IDs for the season
    const weekIds = weeks.map(w => w.id)
    const { data: allRaces } = await supabase
      .from('races').select('id, race_week_id').in('race_week_id', weekIds)
    if (!allRaces?.length) return

    const allRaceIds  = allRaces.map(r => r.id)
    const weekRaceIds = allRaces.filter(r => r.race_week_id === latestWeek.id).map(r => r.id)

    // Fetch all scores for the season
    const { data: scores } = await supabase
      .from('scores').select('user_id, race_id, total_points').in('race_id', allRaceIds)
    if (!scores?.length) return

    // Try to get display names — fall back gracefully if column doesn't exist
    const userIds = [...new Set(scores.map(s => s.user_id))]
    const { data: profiles } = await supabase
      .from('profiles').select('id, display_name, full_name').in('id', userIds)
    const nameMap = {}
    profiles?.forEach(p => {
      // Use display_name, then full_name, then nothing (we'll use email prefix below)
      nameMap[p.id] = p.display_name || p.full_name || null
    })

    // Season aggregation
    const byUser = {}
    let playerCounter = 1
    scores.forEach(sc => {
      if (!byUser[sc.user_id]) {
        const resolvedName = sc.user_id === myUserId
          ? 'You'
          : (nameMap[sc.user_id] || `Player ${playerCounter++}`)
        byUser[sc.user_id] = {
          user_id:      sc.user_id,
          name:         resolvedName,
          isMe:         sc.user_id === myUserId,
          seasonTotal:  0,
          weeksPlayed:  new Set(),
          weekPoints:   0,
        }
      }
      byUser[sc.user_id].seasonTotal += (sc.total_points || 0)
      // Track which weeks they scored in
      const weekId = allRaces.find(r => r.id === sc.race_id)?.race_week_id
      if (weekId) byUser[sc.user_id].weeksPlayed.add(weekId)
      // Current week points
      if (weekRaceIds.includes(sc.race_id)) {
        byUser[sc.user_id].weekPoints += (sc.total_points || 0)
      }
    })

    const seasonSorted = Object.values(byUser)
      .sort((a, b) => b.seasonTotal - a.seasonTotal || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map((u, i) => ({ ...u, rank: i + 1, weeksPlayed: u.weeksPlayed.size }))

    setRows(seasonSorted)

    // Current week only
    const weekByUser = {}
    let wCounter = 1
    scores
      .filter(sc => weekRaceIds.includes(sc.race_id))
      .forEach(sc => {
        if (!weekByUser[sc.user_id]) {
          weekByUser[sc.user_id] = {
            user_id:    sc.user_id,
            name:       sc.user_id === myUserId ? 'You' : (nameMap[sc.user_id] || byUser[sc.user_id]?.name || `Player ${wCounter++}`),
            isMe:       sc.user_id === myUserId,
            weekPoints: 0,
            racesScored: 0,
          }
        }
        weekByUser[sc.user_id].weekPoints   += (sc.total_points || 0)
        weekByUser[sc.user_id].racesScored  += 1
      })

    const weekSorted = Object.values(weekByUser)
      .sort((a, b) => b.weekPoints - a.weekPoints || a.name.localeCompare(b.name))
      .map((u, i) => ({ ...u, rank: i + 1 }))
    setWeekRows(weekSorted)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  const getFirstName = () => {
    const full = user?.user_metadata?.full_name || user?.email || ''
    return full.split(' ')[0] || 'there'
  }

  if (loading) {
    return (
      <div style={st.loadingPage}>
        <div style={st.loadingDot} />
      </div>
    )
  }

  const displayRows = activeTab === 'season' ? rows : weekRows

  return (
    <div style={st.page}>

      {/* ── Nav ── */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>
          <div style={st.navLinks}>
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={st.navLink}>My Picks</a>
            <a href="/league"    style={{ ...st.navLink, ...st.navLinkActive }}>League</a>
            <a href="/races"     style={st.navLink}>Races</a>
            <a href="/results"   style={st.navLink}>Results</a>
            {isAdmin && <a href="/admin" style={{ ...st.navLink, color: '#c9a84c' }}>Admin</a>}
          </div>
          <div style={st.navRight}>
            <div style={st.avatar} onClick={() => setMenuOpen(!menuOpen)}>
              {getFirstName().charAt(0).toUpperCase()}
            </div>
            {menuOpen && (
              <div style={st.dropdownMenu}>
                <div style={st.dropdownEmail}>{user?.email}</div>
                <hr style={st.dropdownDivider} />
                <button style={st.dropdownItem} onClick={() => setMenuOpen(false)}>Profile</button>
                <button style={st.dropdownItem} onClick={() => setMenuOpen(false)}>Settings</button>
                {isAdmin && (
                  <>
                    <hr style={st.dropdownDivider} />
                    <button style={{ ...st.dropdownItem, color: '#c9a84c' }}
                      onClick={() => { setMenuOpen(false); navigate('/admin') }}>
                      Admin Panel
                    </button>
                  </>
                )}
                <hr style={st.dropdownDivider} />
                <button style={{ ...st.dropdownItem, color: '#f87171' }} onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main style={st.main}>

        {/* Header */}
        <section style={st.header}>
          <div>
            <h1 style={st.heading}>League Table</h1>
            <p style={st.sub}>
              {season?.season_name || 'Current Season'} · {rows.length} player{rows.length !== 1 ? 's' : ''}
            </p>
          </div>
        </section>

        {/* Tabs */}
        <div style={st.tabs}>
          <button
            style={{ ...st.tab, ...(activeTab === 'season' ? st.tabActive : {}) }}
            onClick={() => setActiveTab('season')}
          >
            Season Standings
          </button>
          <button
            style={{ ...st.tab, ...(activeTab === 'week' ? st.tabActive : {}) }}
            onClick={() => setActiveTab('week')}
          >
            This Week {currentWeek?.week_number ? `· Wk ${currentWeek.week_number}` : ''}
          </button>
        </div>

        {/* Leaderboard card */}
        <div style={st.card}>
          {displayRows.length === 0 ? (
            <div style={st.empty}>
              No scores yet — check back after race results have been submitted.
            </div>
          ) : (
            <>
              {/* Table header */}
              <div style={st.tableHeader}>
                <span style={{ minWidth: '40px' }}>#</span>
                <span style={{ flex: 1 }}>Player</span>
                {activeTab === 'season' ? (
                  <>
                    <span style={st.colRight}>Wks</span>
                    <span style={st.colRight}>This Wk</span>
                    <span style={st.colRight}>Total</span>
                  </>
                ) : (
                  <>
                    <span style={st.colRight}>Races</span>
                    <span style={st.colRight}>Points</span>
                  </>
                )}
              </div>

              {/* Rows */}
              {displayRows.map((row, idx) => (
                <div
                  key={row.user_id}
                  style={{
                    ...st.row,
                    ...(row.isMe ? st.rowMe : {}),
                    ...(idx === 0 ? st.rowFirst : {}),
                  }}
                >
                  {/* Position medal / number */}
                  <div style={st.rankCell}>
                    {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
                      <span style={st.rankNum}>{row.rank}</span>
                    )}
                  </div>

                  {/* Name */}
                  <div style={st.nameCell}>
                    <span style={st.playerName}>{row.name}</span>
                    {row.isMe && <span style={st.youBadge}>You</span>}
                  </div>

                  {activeTab === 'season' ? (
                    <>
                      <div style={st.dataCell}>{row.weeksPlayed}</div>
                      <div style={st.dataCell}>{row.weekPoints > 0 ? `+${row.weekPoints}` : row.weekPoints}</div>
                      <div style={{ ...st.dataCell, ...st.totalCell }}>{row.seasonTotal}</div>
                    </>
                  ) : (
                    <>
                      <div style={st.dataCell}>{row.racesScored}</div>
                      <div style={{ ...st.dataCell, ...st.totalCell }}>{row.weekPoints}</div>
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {/* CTA strip */}
        <div style={st.ctaStrip}>
          <button style={st.ctaBtn} onClick={() => navigate('/picks')}>
            Make your picks →
          </button>
          <button style={st.ctaBtnGhost} onClick={() => navigate('/races')}>
            View this week's races →
          </button>
        </div>

      </main>

      {/* ── Mobile bar ── */}
      <nav style={st.mobileBar}>
        <a href="/dashboard" style={st.mobileBarItem}>
          <span>🏠</span><span style={st.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={st.mobileBarItem}>
          <span>🎯</span><span style={st.mobileBarLabel}>Picks</span>
        </a>
        <a href="/league" style={{ ...st.mobileBarItem, ...st.mobileBarItemActive }}>
          <span>🏆</span><span style={st.mobileBarLabel}>League</span>
        </a>
        <a href="/races" style={st.mobileBarItem}>
          <span>🐴</span><span style={st.mobileBarLabel}>Races</span>
        </a>
        <a href="/results" style={st.mobileBarItem}>
          <span>📊</span><span style={st.mobileBarLabel}>Results</span>
        </a>
      </nav>

    </div>
  )
}

const st = {
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
  nav: {
    background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)',
    position: 'sticky', top: 0, zIndex: 100,
  },
  navInner: {
    maxWidth: '900px', margin: '0 auto', padding: '0 1.5rem',
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
  dropdownEmail:   { padding: '0.5rem 1rem 0.75rem', fontSize: '0.78rem', color: '#5a8a5a' },
  dropdownDivider: { border: 'none', borderTop: '1px solid rgba(201,168,76,0.1)', margin: '0.25rem 0' },
  dropdownItem: {
    display: 'block', width: '100%', padding: '0.55rem 1rem', textAlign: 'left',
    background: 'none', border: 'none', color: '#e8f0e8', fontSize: '0.875rem',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },

  // Page layout
  main: {
    maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem',
    display: 'flex', flexDirection: 'column', gap: '1.5rem',
  },
  header:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  heading: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.6rem',
    color: '#e8f0e8', letterSpacing: '0.03em', margin: 0, lineHeight: 1,
  },
  sub: { marginTop: '0.4rem', fontSize: '0.9rem', color: '#5a8a5a' },

  // Tabs
  tabs: { display: 'flex', gap: '0.5rem' },
  tab: {
    padding: '0.55rem 1.25rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: '600',
    background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(201,168,76,0.12)',
    color: '#5a8a5a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.15s',
  },
  tabActive: {
    background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)',
    color: '#c9a84c',
  },

  // Table card
  card: {
    background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: '16px', overflow: 'hidden',
  },
  empty: {
    padding: '3rem 2rem', textAlign: 'center',
    color: '#5a8a5a', fontSize: '0.9rem',
  },
  tableHeader: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.75rem 1.5rem',
    background: 'rgba(0,0,0,0.25)',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
    fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#5a8a5a',
  },
  colRight: { minWidth: '60px', textAlign: 'right' },
  row: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid rgba(201,168,76,0.06)',
    transition: 'background 0.15s',
  },
  rowMe: {
    background: 'rgba(201,168,76,0.07)',
    borderLeft: '3px solid #c9a84c',
    paddingLeft: 'calc(1.5rem - 3px)',
  },
  rowFirst: {},
  rankCell: { minWidth: '40px', fontSize: '1.1rem', textAlign: 'center' },
  rankNum:  { fontSize: '0.85rem', color: '#5a8a5a', fontWeight: '600' },
  nameCell: { flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' },
  playerName: { fontSize: '0.95rem', fontWeight: '500', color: '#e8f0e8' },
  youBadge: {
    fontSize: '0.65rem', fontWeight: '700', letterSpacing: '0.06em',
    background: 'rgba(201,168,76,0.15)', color: '#c9a84c',
    padding: '0.15rem 0.45rem', borderRadius: '4px',
  },
  dataCell: {
    minWidth: '60px', textAlign: 'right',
    fontSize: '0.9rem', color: '#5a8a5a',
  },
  totalCell: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem',
    color: '#c9a84c', letterSpacing: '0.03em',
  },

  // CTAs
  ctaStrip: { display: 'flex', gap: '0.75rem' },
  ctaBtn: {
    flex: 1, padding: '0.85rem', background: '#c9a84c', color: '#0a1a08',
    border: 'none', borderRadius: '10px', fontSize: '0.9rem', fontWeight: '700',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.02em',
  },
  ctaBtnGhost: {
    flex: 1, padding: '0.85rem', background: 'none',
    border: '1px solid rgba(201,168,76,0.25)', color: '#c9a84c',
    borderRadius: '10px', fontSize: '0.9rem', fontWeight: '600',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },

  // Mobile bar
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
