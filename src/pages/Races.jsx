import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Races() {
  const navigate = useNavigate()
  const [user, setUser]         = useState(null)
  const [isAdmin, setIsAdmin]   = useState(false)
  const [loading, setLoading]   = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [races, setRaces]       = useState([])
  const [expandedRace, setExpandedRace] = useState(null)
  const [myPicks, setMyPicks]   = useState({})   // { race_id: runner_id }
  const [results, setResults]   = useState({})   // { race_id: [{ position, horse_name, sp }] }
  const [weekLabel, setWeekLabel] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setUser(user)
      const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', user.id).single()
      setIsAdmin(profile?.is_admin || false)
      await loadRaces(user.id)
      setLoading(false)
    })
  }, [navigate])

  async function loadRaces(userId) {
    // Active season
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return

    // Most recent race week
    const { data: weeks } = await supabase
      .from('race_weeks').select('id, week_number, saturday_date')
      .eq('season_id', season.id)
      .order('saturday_date', { ascending: false })
      .limit(1)
    const week = weeks?.[0]
    if (!week) return

    const dateStr = new Date(week.saturday_date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    setWeekLabel(`Week ${week.week_number} · ${dateStr}`)

    // Races with runners
    const { data: raceData } = await supabase
      .from('races')
      .select('id, race_number, race_time, venue, race_name')
      .eq('race_week_id', week.id)
      .order('race_number')
    if (!raceData?.length) return

    const raceIds = raceData.map(r => r.id)

    // All runners for these races
    const { data: runners } = await supabase
      .from('runners')
      .select('id, race_id, horse_number, horse_name, jockey, trainer, silk_colour')
      .in('race_id', raceIds)
      .order('horse_number', { ascending: true })

    // User's picks for these races
    const { data: picks } = await supabase
      .from('picks').select('race_id, runner_id').eq('user_id', userId).in('race_id', raceIds)
    const picksMap = {}
    picks?.forEach(p => { picksMap[p.race_id] = p.runner_id })
    setMyPicks(picksMap)

    // Results if any
    const { data: resultsData } = await supabase
      .from('results').select('race_id, position, horse_name, starting_price_display').in('race_id', raceIds)
    const resultsMap = {}
    resultsData?.forEach(r => {
      if (!resultsMap[r.race_id]) resultsMap[r.race_id] = []
      resultsMap[r.race_id].push(r)
    })
    // Sort positions within each race
    Object.values(resultsMap).forEach(arr => arr.sort((a, b) => a.position - b.position))
    setResults(resultsMap)

    // Attach runners to races
    const runnersMap = {}
    runners?.forEach(r => {
      if (!runnersMap[r.race_id]) runnersMap[r.race_id] = []
      runnersMap[r.race_id].push(r)
    })

    setRaces(raceData.map(r => ({
      id:       r.id,
      number:   r.race_number,
      time:     r.race_time,
      course:   r.venue,
      name:     r.race_name,
      runners:  runnersMap[r.id] || [],
    })))

    // Auto-expand first race
    if (raceData.length > 0) setExpandedRace(raceData[0].id)
  }

  const toggleRace = (id) => setExpandedRace(prev => (prev === id ? null : id))

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  const getFirstName = () => {
    const full = user?.user_metadata?.full_name || user?.email || ''
    return full.split(' ')[0] || 'there'
  }

  const positionMedal = (pos) =>
    pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `${pos}th`

  if (loading) {
    return (
      <div style={st.loadingPage}>
        <div style={st.loadingDot} />
      </div>
    )
  }

  return (
    <div style={st.page}>

      {/* ── Nav ── */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>
          <div style={st.navLinks} className="app-nav-links">
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={st.navLink}>My Picks</a>
            <a href="/league"    style={st.navLink}>League</a>
            <a href="/races"     style={{ ...st.navLink, ...st.navLinkActive }}>Races</a>
            <a href="/results"   style={st.navLink}>Results</a>
            {isAdmin && <a href="/admin" style={{ ...st.navLink, color: '#c9a84c' }}>Admin</a>}
          </div>
          <div style={st.navRight}>
            <div style={st.avatar} onClick={() => navigate('/profile')} title="View profile">
              {getFirstName().charAt(0).toUpperCase()}
            </div>
            {menuOpen && (
              <div style={st.dropdownMenu}>
                <div style={st.dropdownEmail}>{user?.email}</div>
                <hr style={st.dropdownDivider} />
                <button style={st.dropdownItem} onClick={() => { setMenuOpen(false); navigate('/profile') }}>My Profile</button>
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
      <main style={st.main} className="app-main-pad">

        {/* Header */}
        <section style={st.header}>
          <div>
            <h1 style={st.heading}>This Week's Races</h1>
            <p style={st.sub}>{weekLabel}</p>
          </div>
          <button style={st.picksBtn} onClick={() => navigate('/picks')}>
            Make picks →
          </button>
        </section>

        {/* Race list */}
        {races.length === 0 ? (
          <div style={st.emptyCard}>
            No races set up yet — check back soon.
          </div>
        ) : (
          races.map(race => {
            const isOpen     = expandedRace === race.id
            const myPickId   = myPicks[race.id]
            const raceResult = results[race.id]
            const hasResult  = !!raceResult

            return (
              <div key={race.id} style={st.raceCard}>

                {/* Race header — click to expand */}
                <div style={st.raceHeader} onClick={() => toggleRace(race.id)}>
                  <div style={st.raceHeaderLeft}>
                    <div style={st.raceNum}>Race {race.number}</div>
                    <div style={st.raceTime}>{race.time}</div>
                  </div>
                  <div style={st.raceHeaderMid}>
                    <div style={st.raceCourse}>{race.course}</div>
                    <div style={st.raceName}>{race.name}</div>
                  </div>
                  <div style={st.raceHeaderRight}>
                    {myPickId && (
                      <span style={st.pickedBadge}>Picked ✓</span>
                    )}
                    {hasResult && (
                      <span style={st.resultBadge}>Results in</span>
                    )}
                    <span style={{ ...st.runnerCount }}>
                      {race.runners.length} runner{race.runners.length !== 1 ? 's' : ''}
                    </span>
                    <span style={{ ...st.chevron, transform: isOpen ? 'rotate(180deg)' : 'none' }}>
                      ▼
                    </span>
                  </div>
                </div>

                {/* Results banner (if available) */}
                {isOpen && hasResult && (
                  <div style={st.resultsBanner}>
                    <div style={st.resultsBannerTitle}>Race Result</div>
                    <div style={st.resultsRow}>
                      {raceResult.map(r => (
                        <div key={r.position} style={st.resultItem}>
                          <span style={st.resultPos}>{positionMedal(r.position)}</span>
                          <span style={st.resultHorse}>{r.horse_name}</span>
                          <span style={st.resultSP}>{r.starting_price_display}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Runner list */}
                {isOpen && (
                  <div style={st.runnerList}>
                    {race.runners.length === 0 ? (
                      <div style={st.noRunners}>No runners added yet.</div>
                    ) : (
                      race.runners.map(runner => {
                        const isMyPick    = runner.id === myPickId
                        // Check if this runner placed in results
                        const resultPos   = raceResult?.find(r => r.horse_name === runner.horse_name)
                        const silkBg      = runner.silk_colour || '#1a2e1a'

                        return (
                          <div
                            key={runner.id}
                            style={{
                              ...st.runnerRow,
                              ...(isMyPick ? st.runnerRowPicked : {}),
                            }}
                          >
                            {/* Silk swatch */}
                            <div style={{ ...st.silkSwatch, background: silkBg }} />

                            {/* Horse number */}
                            <div style={st.horseNum}>{runner.horse_number || '—'}</div>

                            {/* Main info */}
                            <div style={st.runnerInfo}>
                              <div style={st.horseName}>
                                {runner.horse_name}
                                {isMyPick && <span style={st.myPickTag}>My Pick</span>}
                                {resultPos && (
                                  <span style={st.finishedTag}>
                                    {positionMedal(resultPos.position)} {resultPos.starting_price_display}
                                  </span>
                                )}
                              </div>
                              <div style={st.runnerMeta}>
                                {runner.jockey && <span>J: {runner.jockey}</span>}
                                {runner.trainer && <span>T: {runner.trainer}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}

                    {/* Pick button */}
                    {!hasResult && (
                      <button style={st.pickRaceBtn} onClick={() => navigate('/picks')}>
                        {myPickId ? 'Change pick →' : 'Pick a runner →'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </main>

      {/* ── Mobile bar ── */}
      <nav style={st.mobileBar} className="app-mobile-bar">
        <a href="/dashboard" style={st.mobileBarItem}>
          <span>🏠</span><span style={st.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={st.mobileBarItem}>
          <span>🎯</span><span style={st.mobileBarLabel}>Picks</span>
        </a>
        <a href="/league" style={st.mobileBarItem}>
          <span>🏆</span><span style={st.mobileBarLabel}>League</span>
        </a>
        <a href="/races" style={{ ...st.mobileBarItem, ...st.mobileBarItemActive }}>
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

  main: {
    maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem',
    display: 'flex', flexDirection: 'column', gap: '1rem',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: '0.5rem',
  },
  heading: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.6rem',
    color: '#e8f0e8', letterSpacing: '0.03em', margin: 0, lineHeight: 1,
  },
  sub: { marginTop: '0.4rem', fontSize: '0.9rem', color: '#5a8a5a' },
  picksBtn: {
    background: '#c9a84c', color: '#0a1a08', border: 'none', borderRadius: '8px',
    padding: '0.6rem 1.25rem', fontSize: '0.875rem', fontWeight: '700',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
    alignSelf: 'flex-start', marginTop: '0.25rem',
  },

  emptyCard: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '3rem 2rem', textAlign: 'center',
    color: '#5a8a5a', fontSize: '0.9rem',
  },

  // Race card
  raceCard: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', overflow: 'hidden',
  },
  raceHeader: {
    display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.1rem 1.5rem',
    cursor: 'pointer', userSelect: 'none',
  },
  raceHeaderLeft: { display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: '60px' },
  raceNum:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '0.75rem', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase' },
  raceTime: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#c9a84c', letterSpacing: '0.05em', lineHeight: 1 },
  raceHeaderMid: { flex: 1 },
  raceCourse: { fontSize: '0.95rem', fontWeight: '600', color: '#e8f0e8' },
  raceName:   { fontSize: '0.78rem', color: '#5a8a5a', marginTop: '0.15rem' },
  raceHeaderRight: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 },
  pickedBadge: {
    fontSize: '0.7rem', fontWeight: '700', padding: '0.2rem 0.6rem', borderRadius: '999px',
    background: 'rgba(74,222,128,0.12)', color: '#4ade80',
  },
  resultBadge: {
    fontSize: '0.7rem', fontWeight: '700', padding: '0.2rem 0.6rem', borderRadius: '999px',
    background: 'rgba(201,168,76,0.12)', color: '#c9a84c',
  },
  runnerCount: { fontSize: '0.78rem', color: '#5a8a5a' },
  chevron: { fontSize: '0.65rem', color: '#5a8a5a', transition: 'transform 0.2s' },

  // Results banner
  resultsBanner: {
    background: 'rgba(201,168,76,0.06)', borderTop: '1px solid rgba(201,168,76,0.15)',
    borderBottom: '1px solid rgba(201,168,76,0.1)', padding: '0.85rem 1.5rem',
  },
  resultsBannerTitle: {
    fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#c9a84c', marginBottom: '0.5rem',
  },
  resultsRow: { display: 'flex', gap: '1.5rem', flexWrap: 'wrap' },
  resultItem: { display: 'flex', alignItems: 'center', gap: '0.4rem' },
  resultPos:   { fontSize: '1rem' },
  resultHorse: { fontSize: '0.85rem', fontWeight: '600', color: '#e8f0e8' },
  resultSP:    { fontSize: '0.78rem', color: '#5a8a5a' },

  // Runner list
  runnerList: {
    padding: '0.75rem 1.5rem 1.25rem',
    borderTop: '1px solid rgba(201,168,76,0.08)',
    display: 'flex', flexDirection: 'column', gap: '0.5rem',
  },
  noRunners: { color: '#5a8a5a', fontSize: '0.85rem', padding: '0.5rem 0' },
  runnerRow: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.75rem', borderRadius: '6px',
    background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.2)',
  },
  runnerRowPicked: {
    background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.45)',
  },
  silkSwatch: {
    width: '16px', height: '28px', borderRadius: '4px', flexShrink: 0,
    border: '1px solid rgba(255,255,255,0.1)',
  },
  horseNum: {
    minWidth: '24px', textAlign: 'center',
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.1rem', color: '#5a8a5a',
  },
  runnerInfo: { flex: 1 },
  horseName: {
    fontSize: '0.9rem', fontWeight: '600', color: '#e8f0e8',
    display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap',
  },
  myPickTag: {
    fontSize: '0.65rem', fontWeight: '700', padding: '0.15rem 0.45rem', borderRadius: '4px',
    background: 'rgba(74,222,128,0.12)', color: '#4ade80',
  },
  finishedTag: {
    fontSize: '0.7rem', fontWeight: '600', padding: '0.15rem 0.5rem', borderRadius: '4px',
    background: 'rgba(201,168,76,0.12)', color: '#c9a84c',
  },
  runnerMeta: { fontSize: '0.75rem', color: '#5a8a5a', marginTop: '0.15rem', display: 'flex', gap: '0.75rem' },
  pickRaceBtn: {
    marginTop: '0.5rem', background: 'none', border: '1px solid rgba(201,168,76,0.25)',
    color: '#c9a84c', borderRadius: '8px', padding: '0.6rem 1rem',
    fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif", width: '100%',
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
