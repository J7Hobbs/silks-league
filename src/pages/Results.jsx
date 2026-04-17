import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Results() {
  const navigate = useNavigate()
  const [user, setUser]         = useState(null)
  const [isAdmin, setIsAdmin]   = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [weekLoading, setWeekLoading] = useState(false)

  // Week navigation
  const [weeks, setWeeks]         = useState([])
  const [weekIndex, setWeekIndex] = useState(0)

  // Week data
  const [races, setRaces]           = useState([])
  const [results, setResults]       = useState({})  // { race_id: [{position, horse_name, sp_display}] }
  const [myPicks, setMyPicks]       = useState({})  // { race_id: { horse_name, silk_colour, jockey, trainer } }
  const [myScores, setMyScores]     = useState({})  // { race_id: { base_points, bonus_points, total_points, position_achieved } }
  const [weeklyPosition, setWeeklyPosition] = useState(null)
  const [totalPlayers, setTotalPlayers]     = useState(0)

  // UI
  const [expandedRaces, setExpandedRaces] = useState(new Set())

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setUser(user)
      const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', user.id).single()
      setIsAdmin(profile?.is_admin || false)
      await init(user.id)
      setPageLoading(false)
    })
  }, [navigate])

  // ── Init: load all weeks, pick the default ──────────────────
  async function init(userId) {
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return

    const { data: weeksData } = await supabase
      .from('race_weeks')
      .select('id, week_number, saturday_date')
      .eq('season_id', season.id)
      .order('saturday_date', { ascending: false })
    if (!weeksData?.length) return

    // Find most recent week that has at least one result (efficiently)
    const allWeekIds = weeksData.map(w => w.id)
    const { data: allRaces } = await supabase
      .from('races').select('id, race_week_id').in('race_week_id', allWeekIds)

    let defaultIdx = 0
    if (allRaces?.length) {
      const { data: anyResults } = await supabase
        .from('results').select('race_id').in('race_id', allRaces.map(r => r.id))
      if (anyResults?.length) {
        const raceWeekMap = {}
        allRaces.forEach(r => { raceWeekMap[r.id] = r.race_week_id })
        const weeksWithResults = new Set(anyResults.map(r => raceWeekMap[r.race_id]))
        for (let i = 0; i < weeksData.length; i++) {
          if (weeksWithResults.has(weeksData[i].id)) { defaultIdx = i; break }
        }
      }
    }

    setWeeks(weeksData)
    setWeekIndex(defaultIdx)
    await loadWeekData(userId, weeksData[defaultIdx])
  }

  // ── Load all data for a specific week ───────────────────────
  async function loadWeekData(userId, week) {
    if (!week) return
    setWeekLoading(true)
    setExpandedRaces(new Set())

    // Races for this week
    const { data: racesData } = await supabase
      .from('races')
      .select('id, race_number, race_time, venue, race_name')
      .eq('race_week_id', week.id)
      .order('race_number')

    setRaces(racesData || [])

    if (!racesData?.length) {
      setResults({}); setMyPicks({}); setMyScores({})
      setWeeklyPosition(null); setTotalPlayers(0)
      setWeekLoading(false); return
    }

    const raceIds = racesData.map(r => r.id)

    // Results
    const { data: resultsData } = await supabase
      .from('results')
      .select('race_id, position, horse_name, starting_price_display, starting_price_decimal')
      .in('race_id', raceIds)
    const resultsMap = {}
    resultsData?.forEach(r => {
      if (!resultsMap[r.race_id]) resultsMap[r.race_id] = []
      resultsMap[r.race_id].push(r)
    })
    Object.values(resultsMap).forEach(arr => arr.sort((a, b) => a.position - b.position))
    setResults(resultsMap)

    // User's picks → runner details (no FK join — fetch separately)
    const { data: picksData } = await supabase
      .from('picks').select('race_id, runner_id').eq('user_id', userId).in('race_id', raceIds)
    const picksMap = {}
    if (picksData?.length) {
      const runnerIds = [...new Set(picksData.map(p => p.runner_id).filter(Boolean))]
      const { data: runnersData } = await supabase
        .from('runners').select('id, horse_name, silk_colour, jockey, trainer').in('id', runnerIds)
      const runnerMap = {}
      runnersData?.forEach(r => { runnerMap[r.id] = r })
      picksData.forEach(p => {
        if (p.runner_id && runnerMap[p.runner_id]) picksMap[p.race_id] = runnerMap[p.runner_id]
      })
    }
    setMyPicks(picksMap)

    // User's scores
    const { data: scoresData } = await supabase
      .from('scores')
      .select('race_id, base_points, bonus_points, total_points, position_achieved')
      .eq('user_id', userId).in('race_id', raceIds)
    const scoresMap = {}
    scoresData?.forEach(s => { scoresMap[s.race_id] = s })
    setMyScores(scoresMap)

    // Weekly position — compare my total against all users
    const { data: allScores } = await supabase
      .from('scores').select('user_id, total_points').in('race_id', raceIds)
    if (allScores?.length) {
      const byUser = {}
      allScores.forEach(s => { byUser[s.user_id] = (byUser[s.user_id] || 0) + (s.total_points || 0) })
      const myTotal = byUser[userId] || 0
      const myPos = Object.values(byUser).filter(t => t > myTotal).length + 1
      setWeeklyPosition(myPos)
      setTotalPlayers(Object.keys(byUser).length)
    } else {
      setWeeklyPosition(null); setTotalPlayers(0)
    }

    // Auto-expand first race that has results
    const firstResultRaceId = racesData.find(r => resultsMap[r.id]?.length > 0)?.id
    if (firstResultRaceId) setExpandedRaces(new Set([firstResultRaceId]))

    setWeekLoading(false)
  }

  // ── Week navigation ──────────────────────────────────────────
  async function goToWeek(newIdx) {
    if (newIdx < 0 || newIdx >= weeks.length || !user) return
    setWeekIndex(newIdx)
    await loadWeekData(user.id, weeks[newIdx])
  }

  // ── Helpers ──────────────────────────────────────────────────
  function formatWeekLabel(week) {
    if (!week) return ''
    const date = new Date(week.saturday_date + 'T12:00:00') // noon avoids TZ issues
    const dayStr = date.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
    const q = `Q${Math.ceil((date.getMonth() + 1) / 3)} ${date.getFullYear()}`
    return `Week ${week.week_number} · ${dayStr} · ${q}`
  }

  function circleStyle(raceId) {
    const sc = myScores[raceId]
    if (!sc) return { bg: 'rgba(90,138,90,0.15)', color: '#5a8a5a', border: '2px solid rgba(90,138,90,0.2)' }
    if (sc.position_achieved === 1) return { bg: '#c9a84c', color: '#0a1a08', border: '2px solid #c9a84c' }
    if (sc.position_achieved === 2 || sc.position_achieved === 3)
      return { bg: 'rgba(201,168,76,0.22)', color: '#e8c96a', border: '2px solid rgba(201,168,76,0.4)' }
    return { bg: 'rgba(90,138,90,0.1)', color: '#5a8a5a', border: '2px solid rgba(90,138,90,0.15)' }
  }

  function positionDisplay(pos) {
    if (!pos) return null
    if (pos === 1) return { label: '1st', color: '#c9a84c', medal: '🥇' }
    if (pos === 2) return { label: '2nd', color: '#b0bec5', medal: '🥈' }
    if (pos === 3) return { label: '3rd', color: '#cd9060', medal: '🥉' }
    return { label: 'Unplaced', color: '#5a8a5a', medal: null }
  }

  function toggleRace(raceId) {
    setExpandedRaces(prev => {
      const next = new Set(prev)
      if (next.has(raceId)) next.delete(raceId); else next.add(raceId)
      return next
    })
  }

  const handleSignOut = async () => { await supabase.auth.signOut(); navigate('/auth') }
  const getFirstName = () => {
    const full = user?.user_metadata?.full_name || user?.email || ''
    return full.split(' ')[0] || 'there'
  }

  // ── Summary stats ────────────────────────────────────────────
  const weekScoreValues = Object.values(myScores)
  const totalWeekPts = weekScoreValues.reduce((s, sc) => s + (sc.total_points || 0), 0)
  const horsesPlaced = weekScoreValues.filter(sc => sc.position_achieved && sc.position_achieved <= 3).length
  const bonusTotal   = weekScoreValues.reduce((s, sc) => s + (sc.bonus_points || 0), 0)
  const hasAnyResults = Object.keys(results).length > 0

  if (pageLoading) {
    return (
      <div style={st.loadingPage}>
        <div style={st.loadingDot} />
      </div>
    )
  }

  const selectedWeek = weeks[weekIndex]

  return (
    <div style={st.page}>

      {/* ── Nav ── */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>
          <div style={st.navLinks}>
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={st.navLink}>My Picks</a>
            <a href="/league"    style={st.navLink}>League</a>
            <a href="/races"     style={st.navLink}>Races</a>
            <a href="/results"   style={{ ...st.navLink, ...st.navLinkActive }}>Results</a>
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

        {/* Back + heading */}
        <div style={st.pageTop}>
          <button style={st.backBtn} onClick={() => navigate('/dashboard')}>← Dashboard</button>
          <h1 style={st.heading}>My Results</h1>
          <p style={st.sub}>How your picks performed each week</p>
        </div>

        {/* Week selector */}
        {weeks.length === 0 ? (
          <div style={st.emptyCard}>No race weeks set up yet.</div>
        ) : (
          <>
            <div style={st.weekSelector}>
              <button
                style={{ ...st.arrowBtn, ...(weekIndex >= weeks.length - 1 ? st.arrowBtnDisabled : {}) }}
                onClick={() => goToWeek(weekIndex + 1)}
                disabled={weekIndex >= weeks.length - 1}
              >
                ←
              </button>
              <div style={st.weekLabel}>
                {weekLoading ? 'Loading…' : formatWeekLabel(selectedWeek)}
              </div>
              <button
                style={{ ...st.arrowBtn, ...(weekIndex <= 0 ? st.arrowBtnDisabled : {}) }}
                onClick={() => goToWeek(weekIndex - 1)}
                disabled={weekIndex <= 0}
              >
                →
              </button>
            </div>

            {/* Week content */}
            {weekLoading ? (
              <div style={st.weekSpinner}>
                <div style={st.loadingDot} />
              </div>
            ) : !hasAnyResults ? (
              <div style={st.emptyCard}>
                <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏇</div>
                <div style={{ fontWeight: '600', color: '#e8f0e8', marginBottom: '0.35rem' }}>No results yet for this week</div>
                <div style={{ fontSize: '0.85rem', color: '#5a8a5a' }}>Check back after race day once results have been entered.</div>
              </div>
            ) : (
              <>
                {/* ── Summary strip ── */}
                <section style={st.summaryStrip}>
                  {[
                    { icon: '⭐', value: totalWeekPts,  label: 'Points',   sub: 'this week' },
                    { icon: '🏆', value: weeklyPosition ? `#${weeklyPosition}` : '—', label: 'Position', sub: totalPlayers ? `of ${totalPlayers}` : 'this week' },
                    { icon: '🎯', value: `${horsesPlaced}/${races.length}`, label: 'Placed', sub: 'horses in top 3' },
                    { icon: '✨', value: bonusTotal,    label: 'Bonus pts', sub: 'earned this week' },
                  ].map(card => (
                    <div key={card.label} style={st.summaryCard}>
                      <div style={st.summaryIcon}>{card.icon}</div>
                      <div style={st.summaryValue}>{card.value}</div>
                      <div style={st.summaryLabel}>{card.label}</div>
                      <div style={st.summarySub}>{card.sub}</div>
                    </div>
                  ))}
                </section>

                {/* ── Race cards ── */}
                <section style={st.raceList}>
                  {races.map(race => {
                    const raceResults = results[race.id] || []
                    const pick        = myPicks[race.id]
                    const score       = myScores[race.id]
                    const isExpanded  = expandedRaces.has(race.id)
                    const hasResults  = raceResults.length > 0
                    const cs          = circleStyle(race.id)
                    const racePoints  = score?.total_points ?? 0
                    const posDsp      = score?.position_achieved ? positionDisplay(score.position_achieved) : null

                    return (
                      <div key={race.id} style={st.raceCard}>

                        {/* ── Card header (always visible) ── */}
                        <div style={st.raceCardHeader} onClick={() => toggleRace(race.id)}>

                          {/* Number circle */}
                          <div style={{
                            ...st.raceCircle,
                            background: cs.bg, color: cs.color, border: cs.border,
                          }}>
                            {race.race_number}
                          </div>

                          {/* Venue + time */}
                          <div style={st.raceHeaderInfo}>
                            <div style={st.raceVenue}>{race.venue}</div>
                            <div style={st.raceTimeName}>
                              {race.race_time}{race.race_name ? ` · ${race.race_name}` : ''}
                            </div>
                          </div>

                          {/* Points + chevron */}
                          <div style={st.raceHeaderRight}>
                            {hasResults ? (
                              <div style={racePoints > 0 ? st.racePointsGold : st.racePointsGrey}>
                                {racePoints} <span style={{ fontSize: '0.65em', opacity: 0.7 }}>pts</span>
                              </div>
                            ) : (
                              <span style={st.pendingBadge}>Pending</span>
                            )}
                            <span style={{
                              ...st.chevron,
                              transform: isExpanded ? 'rotate(180deg)' : 'none',
                            }}>▾</span>
                          </div>
                        </div>

                        {/* ── Expanded body ── */}
                        {isExpanded && (
                          <div style={st.raceCardBody}>

                            {/* MY PICK */}
                            <div style={st.pickSection}>
                              <div style={st.sectionLabel}>MY PICK</div>
                              {pick ? (
                                <div style={st.pickRow}>
                                  {/* Silk colour bar */}
                                  <div style={{
                                    ...st.silkBar,
                                    background: pick.silk_colour || '#1a3a10',
                                  }} />

                                  {/* Horse info */}
                                  <div style={st.pickInfo}>
                                    <div style={st.pickHorseName}>{pick.horse_name}</div>
                                    <div style={st.pickMeta}>
                                      {pick.jockey  && <span>J: {pick.jockey}</span>}
                                      {pick.trainer && <span>T: {pick.trainer}</span>}
                                    </div>
                                  </div>

                                  {/* Position + points */}
                                  <div style={st.pickRight}>
                                    {!hasResults ? (
                                      <span style={st.awaitingText}>Awaiting result</span>
                                    ) : posDsp ? (
                                      <>
                                        <div style={{ ...st.positionLabel, color: posDsp.color }}>
                                          {posDsp.medal && <span style={{ marginRight: '0.25rem' }}>{posDsp.medal}</span>}
                                          {posDsp.label}
                                        </div>
                                        <div style={st.pointsChips}>
                                          {racePoints > 0 ? (
                                            <>
                                              <span style={st.baseChip}>{score.base_points} base</span>
                                              {score.bonus_points > 0 && (
                                                <span style={st.bonusChip}>+{score.bonus_points} bonus</span>
                                              )}
                                            </>
                                          ) : (
                                            <span style={st.zeroChip}>0 pts</span>
                                          )}
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div style={{ ...st.positionLabel, color: '#5a8a5a' }}>Unplaced</div>
                                        <div style={st.pointsChips}>
                                          <span style={st.zeroChip}>0 pts</span>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div style={st.noPickNote}>No pick made for this race</div>
                              )}
                            </div>

                            {/* TOP 3 FINISHERS */}
                            {hasResults && (
                              <div style={st.finishersSection}>
                                <div style={st.sectionLabel}>TOP 3 FINISHERS</div>
                                {raceResults.map(r => {
                                  const isMyPick  = pick?.horse_name === r.horse_name
                                  const posD      = positionDisplay(r.position)
                                  return (
                                    <div
                                      key={r.position}
                                      style={{
                                        ...st.finisherRow,
                                        ...(isMyPick ? st.finisherRowMyPick : {}),
                                      }}
                                    >
                                      <span style={{ ...st.finisherPosBadge, color: posD?.color }}>
                                        {posD?.label}
                                      </span>
                                      <span style={st.finisherName}>{r.horse_name}</span>
                                      {isMyPick && <span style={st.yourPickBadge}>Your pick</span>}
                                      <span style={st.finisherSP}>{r.starting_price_display}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                          </div>
                        )}
                      </div>
                    )
                  })}
                </section>
              </>
            )}
          </>
        )}
      </main>

      {/* ── Mobile bar ── */}
      <nav style={st.mobileBar}>
        <a href="/dashboard" style={st.mobileBarItem}>
          <span>🏠</span><span style={st.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={st.mobileBarItem}>
          <span>🎯</span><span style={st.mobileBarLabel}>Picks</span>
        </a>
        <a href="/league" style={st.mobileBarItem}>
          <span>🏆</span><span style={st.mobileBarLabel}>League</span>
        </a>
        <a href="/races" style={st.mobileBarItem}>
          <span>🐴</span><span style={st.mobileBarLabel}>Races</span>
        </a>
        <a href="/results" style={{ ...st.mobileBarItem, ...st.mobileBarItemActive }}>
          <span>📊</span><span style={st.mobileBarLabel}>Results</span>
        </a>
      </nav>

    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────
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
  weekSpinner: {
    display: 'flex', justifyContent: 'center', padding: '3rem',
  },

  // Nav
  nav: {
    background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)',
    position: 'sticky', top: 0, zIndex: 100,
  },
  navInner: {
    maxWidth: '900px', margin: '0 auto', padding: '0 1.5rem',
    height: '60px', display: 'flex', alignItems: 'center', gap: '1.5rem',
  },
  navLogo: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem',
    color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0,
  },
  navLinks: { display: 'flex', gap: '0.2rem', flex: 1 },
  navLink: {
    padding: '0.4rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem',
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
  pageTop: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  backBtn: {
    background: 'none', border: 'none', color: '#5a8a5a', fontSize: '0.82rem',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: 0,
    textAlign: 'left', width: 'fit-content', marginBottom: '0.35rem',
  },
  heading: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.6rem',
    color: '#e8f0e8', letterSpacing: '0.03em', margin: 0, lineHeight: 1,
  },
  sub: { color: '#5a8a5a', fontSize: '0.9rem', margin: 0 },

  // Week selector
  weekSelector: {
    display: 'flex', alignItems: 'center', gap: '1rem',
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '0.85rem 1.25rem',
  },
  arrowBtn: {
    background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)',
    color: '#c9a84c', borderRadius: '8px', width: '36px', height: '36px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontSize: '1rem', fontWeight: '700',
    flexShrink: 0, fontFamily: "'DM Sans', sans-serif",
  },
  arrowBtnDisabled: {
    opacity: 0.3, cursor: 'not-allowed',
  },
  weekLabel: {
    flex: 1, textAlign: 'center', fontSize: '0.9rem', fontWeight: '600',
    color: '#e8f0e8', letterSpacing: '0.01em',
  },

  // Empty / error states
  emptyCard: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '3rem 2rem', textAlign: 'center',
    color: '#5a8a5a', fontSize: '0.9rem',
  },

  // Summary strip
  summaryStrip: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem',
  },
  summaryCard: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '1.1rem 1rem',
    display: 'flex', flexDirection: 'column', gap: '0.2rem',
  },
  summaryIcon:  { fontSize: '1.2rem', marginBottom: '0.2rem' },
  summaryValue: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem',
    color: '#c9a84c', letterSpacing: '0.03em', lineHeight: 1,
  },
  summaryLabel: {
    fontSize: '0.75rem', fontWeight: '700', color: '#e8f0e8',
    letterSpacing: '0.05em', textTransform: 'uppercase',
  },
  summarySub: { fontSize: '0.7rem', color: '#5a8a5a' },

  // Race cards
  raceList: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  raceCard: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', overflow: 'hidden',
  },

  // Card header
  raceCardHeader: {
    display: 'flex', alignItems: 'center', gap: '1rem',
    padding: '1.1rem 1.5rem', cursor: 'pointer', userSelect: 'none',
  },
  raceCircle: {
    width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.1rem', letterSpacing: '0.03em',
  },
  raceHeaderInfo: { flex: 1 },
  raceVenue:    { fontSize: '0.95rem', fontWeight: '600', color: '#e8f0e8' },
  raceTimeName: { fontSize: '0.78rem', color: '#5a8a5a', marginTop: '0.1rem' },
  raceHeaderRight: {
    display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0,
  },
  racePointsGold: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem',
    color: '#c9a84c', letterSpacing: '0.03em', lineHeight: 1,
  },
  racePointsGrey: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem',
    color: '#5a8a5a', letterSpacing: '0.03em', lineHeight: 1,
  },
  pendingBadge: {
    fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.55rem',
    borderRadius: '999px', background: 'rgba(90,138,90,0.12)', color: '#5a8a5a',
  },
  chevron: {
    fontSize: '0.75rem', color: '#5a8a5a',
    transition: 'transform 0.2s', flexShrink: 0,
  },

  // Expanded body
  raceCardBody: {
    borderTop: '1px solid rgba(201,168,76,0.1)',
    padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem',
  },
  sectionLabel: {
    fontSize: '0.65rem', fontWeight: '800', letterSpacing: '0.1em',
    textTransform: 'uppercase', color: '#5a8a5a', marginBottom: '0.65rem',
  },

  // Pick section
  pickSection: {},
  pickRow: {
    display: 'flex', alignItems: 'center', gap: '1rem',
    background: 'rgba(201,168,76,0.05)', borderRadius: '6px',
    padding: '0.9rem 1rem', border: '1px solid rgba(201,168,76,0.25)',
  },
  silkBar: {
    width: '10px', height: '52px', borderRadius: '4px', flexShrink: 0,
    border: '1px solid rgba(255,255,255,0.1)',
  },
  pickInfo: { flex: 1 },
  pickHorseName: { fontSize: '1rem', fontWeight: '700', color: '#e8f0e8' },
  pickMeta: {
    fontSize: '0.75rem', color: '#5a8a5a', marginTop: '0.2rem',
    display: 'flex', gap: '0.75rem',
  },
  pickRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' },
  positionLabel: {
    fontSize: '0.9rem', fontWeight: '700', display: 'flex', alignItems: 'center',
  },
  pointsChips: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' },
  baseChip: {
    fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.55rem',
    borderRadius: '5px', background: 'rgba(90,138,90,0.2)', color: '#e8f0e8',
  },
  bonusChip: {
    fontSize: '0.72rem', fontWeight: '700', padding: '0.2rem 0.55rem',
    borderRadius: '5px', background: 'rgba(201,168,76,0.18)', color: '#c9a84c',
  },
  zeroChip: {
    fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.55rem',
    borderRadius: '5px', background: 'rgba(90,138,90,0.1)', color: '#5a8a5a',
  },
  awaitingText: { fontSize: '0.78rem', color: '#5a8a5a' },
  noPickNote: {
    fontSize: '0.85rem', color: '#5a8a5a', padding: '0.75rem 0',
    fontStyle: 'italic',
  },

  // Top 3 finishers
  finishersSection: {},
  finisherRow: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.65rem 0.85rem', borderRadius: '6px',
    background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.2)',
    marginBottom: '0.4rem',
  },
  finisherRowMyPick: {
    background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.4)',
  },
  finisherPosBadge: {
    fontSize: '0.8rem', fontWeight: '700', minWidth: '48px',
  },
  finisherName: { flex: 1, fontSize: '0.875rem', fontWeight: '500', color: '#e8f0e8' },
  yourPickBadge: {
    fontSize: '0.65rem', fontWeight: '700', padding: '0.15rem 0.45rem',
    borderRadius: '4px', background: 'rgba(201,168,76,0.18)', color: '#c9a84c',
    whiteSpace: 'nowrap',
  },
  finisherSP: { fontSize: '0.78rem', color: '#5a8a5a', minWidth: '36px', textAlign: 'right' },

  // Mobile bar
  mobileBar: {
    display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0,
    background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)',
    padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around',
  },
  mobileBarItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
    color: '#5a8a5a', textDecoration: 'none', fontSize: '1rem', padding: '0.25rem 0.5rem',
  },
  mobileBarItemActive: { color: '#c9a84c' },
  mobileBarLabel: { fontSize: '0.6rem', fontWeight: '500' },
}
