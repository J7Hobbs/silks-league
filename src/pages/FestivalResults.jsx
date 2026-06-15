import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ProfileDropdown from '../components/ProfileDropdown.jsx'
import { Home, Target, Trophy, BarChart2 } from 'lucide-react'

export default function FestivalResults() {
  const navigate               = useNavigate()
  const { festivalId }         = useParams()
  const [user, setUser]        = useState(null)
  const [isAdmin, setIsAdmin]  = useState(false)
  const [loading, setLoading]  = useState(true)

  // Festival meta
  const [festival, setFestival] = useState(null)
  const [userTotal, setUserTotal] = useState(0)
  const [userRank,  setUserRank]  = useState(null)
  const [totalEntrants, setTotalEntrants] = useState(0)

  // Days + picks
  const [days, setDays]           = useState([])   // [{ id, day_number, race_date }]
  const [activeDay, setActiveDay] = useState(null)  // day_number

  // Per-day race data (loaded lazily)
  const [dayCache, setDayCache] = useState({})  // { dayNumber: [...raceRows] }
  const [dayLoading, setDayLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setUser(user)
      const { data: profile } = await supabase
        .from('profiles').select('is_admin').eq('id', user.id).single()
      setIsAdmin(profile?.is_admin || false)
      await loadFestival(user.id)
      setLoading(false)
    })
  }, [festivalId])

  async function loadFestival(userId) {
    // Festival details
    const { data: fest } = await supabase
      .from('festivals').select('*').eq('id', festivalId).single()
    if (!fest) return
    setFestival(fest)

    // Days
    const { data: daysData } = await supabase
      .from('festival_days').select('id, day_number, race_date')
      .eq('festival_id', festivalId).order('day_number')
    setDays(daysData || [])
    if (daysData?.length) setActiveDay(daysData[0].day_number)

    // User's entry
    const { data: entry } = await supabase
      .from('festival_entries').select('starting_points')
      .eq('festival_id', festivalId).eq('user_id', userId).maybeSingle()
    if (!entry) return  // not entered

    // Compute user total + rank
    const dayIds  = (daysData || []).map(d => d.id)
    let total     = entry.starting_points || 0
    let rank      = 1
    let entrants  = 1

    if (dayIds.length) {
      const { data: races } = await supabase
        .from('festival_races').select('id').in('festival_day_id', dayIds)
      const raceIds = (races || []).map(r => r.id)

      if (raceIds.length) {
        const [{ data: myScores }, { data: allEntries }, { data: allScores }] = await Promise.all([
          supabase.from('festival_scores').select('total_points').eq('user_id', userId).in('festival_race_id', raceIds),
          supabase.from('festival_entries').select('user_id, starting_points').eq('festival_id', festivalId),
          supabase.from('festival_scores').select('user_id, total_points').in('festival_race_id', raceIds),
        ])
        total += (myScores || []).reduce((s, sc) => s + (sc.total_points || 0), 0)

        const byUser = {}
        ;(allEntries || []).forEach(e => { byUser[e.user_id] = e.starting_points || 0 })
        ;(allScores  || []).forEach(s => { if (byUser[s.user_id] !== undefined) byUser[s.user_id] += s.total_points || 0 })
        entrants = Object.keys(byUser).length
        rank     = Object.values(byUser).filter(t => t > total).length + 1
      }
    }

    setUserTotal(total)
    setUserRank(rank)
    setTotalEntrants(entrants)
  }

  async function loadDayRaces(dayObj, userId) {
    if (dayCache[dayObj.day_number]) return  // already cached
    setDayLoading(true)
    try {
      // Races for this day
      const { data: racesData } = await supabase
        .from('festival_races').select('id, race_number, race_time, race_name')
        .eq('festival_day_id', dayObj.id).order('race_number')
      if (!racesData?.length) { setDayCache(p => ({ ...p, [dayObj.day_number]: [] })); return }

      const raceIds = racesData.map(r => r.id)

      // User's picks for these races
      const { data: picksData } = await supabase
        .from('festival_picks').select('festival_race_id, runner_id')
        .eq('user_id', userId).in('festival_race_id', raceIds)

      // Runner names
      const runnerIds = [...new Set((picksData || []).map(p => p.runner_id).filter(Boolean))]
      let nameMap = {}
      if (runnerIds.length) {
        const { data: runners } = await supabase
          .from('festival_runners').select('id, horse_name').in('id', runnerIds)
        runners?.forEach(r => { nameMap[r.id] = r.horse_name })
      }

      // Scores
      const { data: scoresData } = await supabase
        .from('festival_scores')
        .select('festival_race_id, base_points, bonus_points, total_points, position_achieved')
        .eq('user_id', userId).in('festival_race_id', raceIds)
      const scoreMap = {}
      scoresData?.forEach(s => { scoreMap[s.festival_race_id] = s })

      // Results exist check
      const { data: resultsData } = await supabase
        .from('festival_results').select('festival_race_id')
        .in('festival_race_id', raceIds)
      const hasResults = new Set((resultsData || []).map(r => r.festival_race_id))

      const pickMap = {}
      ;(picksData || []).forEach(p => { pickMap[p.festival_race_id] = nameMap[p.runner_id] || '—' })

      const rows = racesData.map(race => ({
        id:        race.id,
        number:    race.race_number,
        time:      race.race_time,
        name:      race.race_name,
        horseName: pickMap[race.id] || null,
        score:     scoreMap[race.id] || null,
        hasResults: hasResults.has(race.id),
      }))

      setDayCache(p => ({ ...p, [dayObj.day_number]: rows }))
    } finally {
      setDayLoading(false)
    }
  }

  // Load day data whenever activeDay changes
  useEffect(() => {
    if (!user || !activeDay) return
    const dayObj = days.find(d => d.day_number === activeDay)
    if (dayObj) loadDayRaces(dayObj, user.id)
  }, [activeDay, user, days])

  // ── Helpers ──────────────────────────────────────────────────
  function fmtDate(ds) {
    if (!ds) return ''
    try {
      return new Date(ds + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    } catch { return ds }
  }

  function dayLabel(d) {
    if (!d.race_date) return `Day ${d.day_number}`
    try {
      return new Date(d.race_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })
    } catch { return `Day ${d.day_number}` }
  }

  function posLabel(pos) {
    if (!pos) return null
    if (pos === 1) return { text: '1st 🥇', color: '#c9a84c' }
    if (pos === 2) return { text: '2nd 🥈', color: '#b0bec5' }
    if (pos === 3) return { text: '3rd 🥉', color: '#cd9060' }
    return { text: 'Unplaced', color: '#5a8a5a' }
  }

  if (loading) {
    return (
      <div style={st.loadingPage}>
        <div style={st.loadingDot} />
      </div>
    )
  }

  if (!festival) {
    return (
      <div style={st.loadingPage}>
        <div style={{ color: '#5a8a5a', fontFamily: "'DM Sans', sans-serif" }}>Festival not found.</div>
      </div>
    )
  }

  const activeDayObj  = days.find(d => d.day_number === activeDay)
  const activeDayRows = dayCache[activeDay] || null

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
            <a href="/results"   style={{ ...st.navLink, ...st.navLinkActive }}>Results</a>
          </div>
          <div style={st.navRight}>
            <ProfileDropdown user={user} isAdmin={isAdmin} />
          </div>
        </div>
      </nav>

      <main style={st.main} className="app-main-pad">

        {/* Back button */}
        <button style={st.backBtn} onClick={() => navigate('/results')}>← My Results</button>

        {/* Festival header card */}
        <section style={st.headerCard}>
          <div style={st.headerShimmer} />
          <div style={st.headerInner}>
            <div style={st.headerLeft}>
              <div style={st.headerBadge}>
                👑 Festival Tournament · {festival.is_active ? 'Live Now' : 'Completed'}
              </div>
              <div style={st.headerName}>{festival.display_name || festival.name}</div>
              <div style={st.headerDates}>{fmtDate(festival.start_date)} — {fmtDate(festival.end_date)}</div>
            </div>
            <div style={st.headerRight}>
              <div style={st.statBlock}>
                <div style={st.statVal}>{userTotal}</div>
                <div style={st.statLbl}>pts</div>
              </div>
              {userRank && (
                <>
                  <div style={st.statDivider} />
                  <div style={st.statBlock}>
                    <div style={st.statVal}>#{userRank}</div>
                    <div style={st.statLbl}>of {totalEntrants}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Day tabs */}
        {days.length > 0 && (
          <div style={st.dayTabRow}>
            {days.map(d => (
              <button
                key={d.day_number}
                style={{ ...st.dayTab, ...(activeDay === d.day_number ? st.dayTabActive : {}) }}
                onClick={() => setActiveDay(d.day_number)}>
                {dayLabel(d)}
              </button>
            ))}
          </div>
        )}

        {/* Day content */}
        {activeDayObj ? (
          dayLoading && !activeDayRows ? (
            <div style={st.spinner}><div style={st.loadingDot} /></div>
          ) : !activeDayRows || activeDayRows.length === 0 ? (
            <div style={st.emptyCard}>No picks made on this day.</div>
          ) : (
            <div style={st.raceList}>
              {activeDayRows.map(race => {
                const pos = race.score ? posLabel(race.score.position_achieved) : null
                const noPick = !race.horseName
                const pending = !noPick && !race.hasResults

                return (
                  <div key={race.id} style={st.raceCard}>
                    {/* Race header */}
                    <div style={st.raceHeader}>
                      <div style={st.raceNumBadge}>Race {race.number}</div>
                      {race.time && <div style={st.raceTime}>{race.time}</div>}
                      <div style={st.raceName}>{race.name || '—'}</div>
                    </div>

                    {/* Pick + result */}
                    <div style={st.raceBody}>
                      {noPick ? (
                        <div style={st.noPick}>No pick made</div>
                      ) : pending ? (
                        <div style={st.pendingRow}>
                          <span style={st.horseChip}>{race.horseName}</span>
                          <span style={st.pendingText}>Results pending</span>
                        </div>
                      ) : (
                        <div style={st.resultRow}>
                          <div style={st.resultLeft}>
                            <span style={st.horseChip}>{race.horseName}</span>
                            {pos && (
                              <span style={{ ...st.posBadge, color: pos.color }}>{pos.text}</span>
                            )}
                          </div>
                          {race.score && (
                            <div style={st.pointsRow}>
                              <div style={st.ptItem}>
                                <span style={st.ptLbl}>Base</span>
                                <span style={st.ptVal}>{race.score.base_points ?? 0}</span>
                              </div>
                              <div style={st.ptDivider} />
                              <div style={st.ptItem}>
                                <span style={st.ptLbl}>Bonus</span>
                                <span style={st.ptVal}>{race.score.bonus_points ?? 0}</span>
                              </div>
                              <div style={st.ptDivider} />
                              <div style={st.ptItem}>
                                <span style={st.ptLbl}>Total</span>
                                <span style={{ ...st.ptVal, ...st.ptTotal }}>{race.score.total_points ?? 0}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <div style={st.emptyCard}>No race days found for this festival.</div>
        )}

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
        <a href="/league" style={st.mobileBarItem}>
          <Trophy size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>League</span>
        </a>
        <a href="/results" style={{ ...st.mobileBarItem, ...st.mobileBarItemActive }}>
          <BarChart2 size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Results</span>
          <span style={st.mobileDot} />
        </a>
      </nav>

    </div>
  )
}

// ── Styles ───────────────────────────────────────────────────────
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
  spinner: { display: 'flex', justifyContent: 'center', padding: '3rem' },

  // Nav
  nav: { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  navInner: { maxWidth: '900px', margin: '0 auto', padding: '0 1.5rem', height: '60px', display: 'flex', alignItems: 'center', gap: '1.5rem' },
  navLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0 },
  navLinks: { display: 'flex', gap: '0.2rem', flex: 1 },
  navLink: { padding: '0.4rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '500', color: '#5a8a5a', textDecoration: 'none' },
  navLinkActive: { color: '#e8f0e8', background: 'rgba(201,168,76,0.1)' },
  navRight: { marginLeft: 'auto', position: 'relative' },

  // Layout
  main: { maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  backBtn: {
    background: 'none', border: 'none', color: '#5a8a5a', fontSize: '0.82rem',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: 0,
    textAlign: 'left', width: 'fit-content',
  },

  // Festival header
  headerCard: {
    position: 'relative',
    background: "linear-gradient(to right, rgba(10,26,8,0.95) 0%, rgba(10,26,8,0.7) 60%, rgba(10,26,8,0.3) 100%), url('https://images.unsplash.com/photo-1597651482572-9957ddaacfab?w=1200&q=80&fit=crop&crop=center') center 35% / cover no-repeat",
    border: '1.5px solid #c9a84c', borderRadius: '12px', overflow: 'hidden',
  },
  headerShimmer: { position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, transparent 0%, #c9a84c 30%, #f5d98b 50%, #c9a84c 70%, transparent 100%)' },
  headerInner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem 2rem', gap: '1.5rem', flexWrap: 'wrap' },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  headerBadge: { fontSize: '0.68rem', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c9a84c' },
  headerName: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#fff', letterSpacing: '0.05em', lineHeight: 1.1 },
  headerDates: { fontSize: '0.77rem', color: 'rgba(232,240,232,0.55)', marginTop: '0.1rem' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '1.25rem' },
  statBlock: { textAlign: 'center' },
  statVal: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.4rem', color: '#c9a84c', lineHeight: 1 },
  statLbl: { fontSize: '0.62rem', color: 'rgba(201,168,76,0.65)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  statDivider: { width: '1px', height: '44px', background: 'rgba(201,168,76,0.25)' },

  // Day tabs
  dayTabRow: { display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '2px', scrollbarWidth: 'none' },
  dayTab: {
    padding: '0.5rem 1.1rem', borderRadius: '8px', border: '1px solid rgba(201,168,76,0.2)',
    background: 'rgba(201,168,76,0.06)', color: '#5a8a5a', fontSize: '0.82rem',
    fontWeight: '600', fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
    whiteSpace: 'nowrap', letterSpacing: '0.03em',
  },
  dayTabActive: { background: '#c9a84c', color: '#0a1a08', border: '1px solid #c9a84c' },

  // Race list
  raceList: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  raceCard: {
    background: '#162a1a', border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '10px', overflow: 'hidden',
  },
  raceHeader: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.75rem 1.25rem',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
    background: 'rgba(0,0,0,0.1)',
  },
  raceNumBadge: {
    fontSize: '0.65rem', fontWeight: '700', letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#c9a84c',
    background: 'rgba(201,168,76,0.1)', borderRadius: '4px',
    padding: '0.2rem 0.5rem', flexShrink: 0,
  },
  raceTime: { fontSize: '0.82rem', color: 'rgba(232,240,232,0.5)', flexShrink: 0 },
  raceName: { fontSize: '0.9rem', fontWeight: '600', color: '#e8f0e8', flex: 1 },

  raceBody: { padding: '0.9rem 1.25rem' },

  // States
  noPick: { fontSize: '0.85rem', color: '#5a8a5a', fontStyle: 'italic' },
  pendingRow: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' },
  pendingText: { fontSize: '0.82rem', color: '#5a8a5a', fontStyle: 'italic' },

  // Result row
  resultRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' },
  resultLeft: { display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' },
  horseChip: {
    fontSize: '0.9rem', fontWeight: '600', color: '#e8f0e8',
    background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '6px', padding: '0.25rem 0.65rem',
  },
  posBadge: { fontSize: '0.82rem', fontWeight: '700' },

  // Points breakdown
  pointsRow: {
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.5rem 0.85rem',
    flexShrink: 0,
  },
  ptItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem', minWidth: '40px' },
  ptLbl: { fontSize: '0.58rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(232,240,232,0.35)' },
  ptVal: { fontSize: '1rem', fontWeight: '700', color: '#e8f0e8' },
  ptTotal: { color: '#c9a84c', fontSize: '1.1rem' },
  ptDivider: { width: '1px', height: '28px', background: 'rgba(201,168,76,0.15)', flexShrink: 0 },

  // Empty
  emptyCard: {
    background: '#162a1a', border: '1px solid rgba(201,168,76,0.15)',
    borderRadius: '10px', padding: '2.5rem', textAlign: 'center',
    color: '#5a8a5a', fontSize: '0.9rem',
  },

  // Mobile bar
  mobileBar: { display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)', padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around' },
  mobileBarItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '0.3rem 0', color: 'rgba(232,220,200,0.4)', textDecoration: 'none', flex: 1 },
  mobileBarItemActive: { color: '#c9a84c' },
  mobileBarLabel: { fontSize: '10px', fontWeight: '500' },
  mobileDot: { width: '4px', height: '4px', borderRadius: '50%', background: '#c9a84c', marginTop: '1px' },
}
