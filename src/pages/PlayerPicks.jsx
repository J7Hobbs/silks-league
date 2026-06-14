import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import RunnerCard from '../components/RunnerCard.jsx'

// ── Deadline: 12:00pm each Saturday ──────────────────────────────────────────
function isAfterDeadline() {
  const now = new Date()
  const day  = now.getDay()   // 6 = Saturday
  const hour = now.getHours()
  return day === 6 && hour >= 12
}

export default function PlayerPicks() {
  const { userId }   = useParams()
  const navigate     = useNavigate()

  const [myUserId,   setMyUserId]   = useState(null)
  const [profile,    setProfile]    = useState(null)
  const [races,      setRaces]      = useState([])
  const [picks,      setPicks]      = useState({})
  const [scores,     setScores]     = useState({})
  const [results,    setResults]    = useState({})
  const [loading,    setLoading]    = useState(true)
  const [deadlinePassed, setDeadlinePassed] = useState(false)
  const [isOwnPicks, setIsOwnPicks] = useState(false)

  // ── Season / week navigation ──────────────────────────────────
  const [allSeasons,       setAllSeasons]       = useState([])
  const [viewSeason,       setViewSeason]       = useState(null)
  const [allWeeks,         setAllWeeks]         = useState([])
  const [selectedWeek,     setSelectedWeek]     = useState(null)
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setMyUserId(user.id)
      const own = user.id === userId
      setIsOwnPicks(own)
      setDeadlinePassed(own || isAfterDeadline())
      init(user.id)
    })
  }, [userId])

  async function init(myId) {
    setLoading(true)
    try {
      const { data: prof } = await supabase
        .from('profiles').select('id, username, full_name').eq('id', userId).single()
      setProfile(prof)

      // Load all seasons for the selector
      const { data: seasonsData } = await supabase
        .from('seasons').select('id, name, status, is_active, quarter, year')
        .order('start_date', { ascending: false })
      setAllSeasons(seasonsData || [])

      // Default to the active season
      const { data: activeSeason } = await supabase
        .from('seasons').select('id, name, status, is_active').eq('is_active', true).single()
      if (!activeSeason) return
      setViewSeason(activeSeason)

      await loadSeasonWeeks(activeSeason, myId, null)
    } finally {
      setLoading(false)
    }
  }

  async function loadSeasonWeeks(season, myId, weekId) {
    const { data: weeks } = await supabase
      .from('race_weeks').select('*').eq('season_id', season.id)
      .order('saturday_date', { ascending: false })
    setAllWeeks(weeks || [])
    const targetWeek = weekId
      ? (weeks || []).find(w => w.id === weekId)
      : (weeks || [])[0]
    if (!targetWeek) return
    setSelectedWeek(targetWeek)
    await loadWeekData(targetWeek, myId)
  }

  async function loadWeekData(week, myId) {
    setRaces([]); setPicks({}); setScores({}); setResults({})
    const { data: racesData } = await supabase
      .from('races').select('*').eq('race_week_id', week.id).order('race_number')
    if (!racesData?.length) return
    setRaces(racesData)
    const raceIds = racesData.map(r => r.id)

    const { data: picksData } = await supabase
      .from('picks').select('race_id, runner_id, was_replaced, original_runner_id')
      .eq('user_id', userId).in('race_id', raceIds)
    const runnerIds = (picksData || []).map(p => p.runner_id).filter(Boolean)
    const { data: runnersData } = runnerIds.length
      ? await supabase.from('runners').select('id, horse_name, silk_colour, silk_colour_secondary, horse_number, odds_fractional').in('id', runnerIds)
      : { data: [] }
    const runnerMap = {}
    runnersData?.forEach(r => { runnerMap[r.id] = r })
    const picksMap = {}
    picksData?.forEach(p => {
      if (p.runner_id && runnerMap[p.runner_id]) {
        picksMap[p.race_id] = {
          ...runnerMap[p.runner_id],
          was_replaced: p.was_replaced,
          original_runner_id: p.original_runner_id,
        }
      }
    })
    setPicks(picksMap)

    const { data: resultsData } = await supabase
      .from('results').select('race_id, position, horse_name, starting_price_display').in('race_id', raceIds)
    const resultsMap = {}
    resultsData?.forEach(r => {
      if (!resultsMap[r.race_id]) resultsMap[r.race_id] = []
      resultsMap[r.race_id].push(r)
    })
    setResults(resultsMap)

    const { data: scoresData } = await supabase
      .from('scores').select('race_id, base_points, bonus_points, total_points, position_achieved, score_note')
      .eq('user_id', userId).in('race_id', raceIds)
    const scoresMap = {}
    scoresData?.forEach(s => { scoresMap[s.race_id] = s })
    setScores(scoresMap)
  }

  async function switchSeason(s) {
    setSeasonPickerOpen(false)
    if (s.id === viewSeason?.id) return
    setLoading(true)
    setViewSeason(s)
    setAllWeeks([])
    setSelectedWeek(null)
    await loadSeasonWeeks(s, myUserId, null)
    setLoading(false)
  }

  async function switchWeek(week) {
    if (week.id === selectedWeek?.id) return
    setSelectedWeek(week)
    setLoading(true)
    await loadWeekData(week, myUserId)
    setLoading(false)
  }

  const displayName = profile?.username || profile?.full_name || 'Player'
  const totalPts = Object.values(scores).reduce((sum, s) => sum + (s?.total_points || 0), 0)
  const weekDateStr = selectedWeek?.saturday_date
    ? new Date(selectedWeek.saturday_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''
  const isPastSeason = viewSeason && !viewSeason.is_active

  const posLabel = (p) => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : null

  return (
    <div style={st.page} onClick={() => seasonPickerOpen && setSeasonPickerOpen(false)}>

      {/* Nav */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <button style={st.backBtn} onClick={() => navigate(-1)}>← Back</button>
          <div style={st.navLogo}>Silks League</div>
        </div>
      </nav>

      <main style={st.main}>
        {loading ? (
          <div style={st.loading}>Loading picks…</div>
        ) : !deadlinePassed ? (
          <div style={st.lockedCard}>
            <div style={st.lockIcon}>🔒</div>
            <div style={st.lockTitle}>Picks not yet revealed</div>
            <div style={st.lockSub}>Picks are revealed at 12:00pm Saturday — come back then.</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={st.header}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                <h1 style={st.title}>{isOwnPicks ? 'My picks' : `${displayName}'s picks`}</h1>

                {/* Season selector */}
                {allSeasons.length > 1 && (
                  <div style={{ position: 'relative', flexShrink: 0, marginTop: '0.2rem' }}>
                    <button
                      style={st.seasonPill}
                      onClick={e => { e.stopPropagation(); setSeasonPickerOpen(v => !v) }}>
                      {viewSeason?.name || 'Season'} ▾
                    </button>
                    {seasonPickerOpen && (
                      <div style={st.seasonDropdown}>
                        {allSeasons.map(s => (
                          <button
                            key={s.id}
                            onClick={e => { e.stopPropagation(); switchSeason(s) }}
                            style={{ ...st.seasonDropdownItem, ...(s.id === viewSeason?.id ? st.seasonDropdownItemActive : {}) }}>
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

              {/* Past season banner */}
              {isPastSeason && (
                <div style={st.pastSeasonBanner}>
                  Viewing {viewSeason.name} — final standings
                </div>
              )}

              {weekDateStr && <div style={st.weekLabel}>{weekDateStr}</div>}

              {Object.keys(scores).length > 0 && (
                <div style={st.totalPts}>
                  <span style={st.totalNum}>{totalPts}</span>
                  <span style={st.totalLabel}>pts total</span>
                </div>
              )}

              {/* Week navigator — show when season has multiple weeks */}
              {allWeeks.length > 1 && (
                <div style={st.weekNav}>
                  {[...allWeeks].reverse().map(w => (
                    <button
                      key={w.id}
                      style={{ ...st.weekNavBtn, ...(w.id === selectedWeek?.id ? st.weekNavBtnActive : {}) }}
                      onClick={() => switchWeek(w)}>
                      Wk {w.week_number}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Race cards */}
            {races.length === 0 ? (
              <div style={st.emptyMsg}>No races set up for this week yet.</div>
            ) : races.map(race => {
              const pick        = picks[race.id]
              const score       = scores[race.id]
              const raceResults = results[race.id] || []
              const hasResult   = raceResults.length > 0
              const wasReplaced = !!pick?.was_replaced

              return (
                <div key={race.id} style={st.raceCard}>
                  {/* Race header */}
                  <div style={st.raceHead}>
                    <span style={st.raceNum}>Race {race.race_number}</span>
                    <span style={st.raceMeta}>
                      <strong style={{ color: '#e8f0e8' }}>{race.race_time}</strong>
                      {' · '}<span style={{ color: '#c9a84c' }}>{race.venue}</span>
                      {race.race_name && <span style={{ color: '#5a8a5a' }}>{' · '}{race.race_name}</span>}
                    </span>
                    {/* Points chip */}
                    <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                      {score ? (
                        <span style={st.ptsChip}>{score.total_points} pts</span>
                      ) : (
                        <span style={st.pendingChip}>Pending</span>
                      )}
                    </div>
                  </div>

                  {/* Pick card */}
                  {pick ? (
                    <div style={{ padding: '10px' }}>
                      <RunnerCard
                        runner={pick}
                        rightContent={
                          <div style={{ textAlign: 'right' }}>
                            {!hasResult ? (
                              <span style={{ fontSize: '0.75rem', color: '#5a8a5a' }}>Pending</span>
                            ) : score ? (
                              <>
                                <div style={{ fontSize: '14px', fontWeight: '700', color: score.position_achieved ? '#c9a84c' : '#9ca3af', fontFamily: 'Georgia, serif' }}>
                                  {score.position_achieved ? posLabel(score.position_achieved) : 'Unplaced'}
                                </div>
                                <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                                  {score.total_points} pts
                                </div>
                              </>
                            ) : null}
                          </div>
                        }
                      />
                      {wasReplaced && (
                        <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.3rem', paddingLeft: '0.25rem', fontStyle: 'italic' }}>
                          Auto-replaced — original pick scratched
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={st.noPick}>No pick made for this race</div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </main>
    </div>
  )
}

const st = {
  page:    { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '3rem' },
  nav:     { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)' },
  navInner:{ maxWidth: '600px', margin: '0 auto', padding: '0 1.25rem', height: '56px', display: 'flex', alignItems: 'center', gap: '1rem' },
  navLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: '#c9a84c', letterSpacing: '0.1em', marginLeft: 'auto' },
  backBtn: { background: 'none', border: 'none', color: '#5a8a5a', cursor: 'pointer', fontSize: '0.875rem', fontFamily: "'DM Sans', sans-serif", padding: 0 },
  main:    { maxWidth: '600px', margin: '0 auto', padding: '1.5rem 1.25rem' },
  loading: { textAlign: 'center', color: '#5a8a5a', padding: '3rem', fontSize: '0.9rem' },
  lockedCard: { textAlign: 'center', background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '16px', padding: '3rem 2rem', marginTop: '2rem' },
  lockIcon:   { fontSize: '2.5rem', marginBottom: '1rem' },
  lockTitle:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.8rem', color: '#c9a84c', letterSpacing: '0.05em', marginBottom: '0.5rem' },
  lockSub:    { fontSize: '0.9rem', color: '#5a8a5a', lineHeight: 1.5 },
  header:  { marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  title:   { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#e8f0e8', letterSpacing: '0.04em', margin: 0 },
  weekLabel: { fontSize: '0.8rem', color: '#5a8a5a' },
  totalPts:  { display: 'inline-flex', alignItems: 'baseline', gap: '0.35rem', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '8px', padding: '0.4rem 0.9rem' },
  totalNum:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', color: '#c9a84c', lineHeight: 1 },
  totalLabel:{ fontSize: '0.75rem', color: '#5a8a5a' },
  emptyMsg:  { color: '#5a8a5a', textAlign: 'center', padding: '2rem', fontSize: '0.9rem' },
  raceCard:  { background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '12px', marginBottom: '0.85rem', overflow: 'hidden' },
  raceHead:  { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.75rem 1rem', borderBottom: '1px solid rgba(201,168,76,0.08)', flexWrap: 'wrap' },
  raceNum:   { fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 },
  raceMeta:  { fontSize: '0.82rem', flex: 1 },
  ptsChip:   { background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.78rem', fontWeight: '700', color: '#c9a84c' },
  pendingChip: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: '#5a8a5a' },
  noPick:    { padding: '0.85rem 1rem', fontSize: '0.85rem', color: '#5a8a5a', fontStyle: 'italic' },
  // Season selector
  seasonPill: { border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c', background: 'rgba(201,168,76,0.06)', borderRadius: '20px', padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' },
  seasonDropdown: { position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '10px', minWidth: '170px', zIndex: 200, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' },
  seasonDropdownItem: { display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 1rem', background: 'transparent', color: '#e8f0e8', border: 'none', borderBottom: '1px solid rgba(201,168,76,0.07)', fontSize: '0.8rem', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  seasonDropdownItemActive: { background: 'rgba(201,168,76,0.1)', color: '#c9a84c' },
  pastSeasonBanner: { background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '7px', padding: '0.45rem 0.85rem', fontSize: '0.78rem', color: 'rgba(201,168,76,0.65)', fontStyle: 'italic' },
  // Week navigator
  weekNav: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap' },
  weekNavBtn: { border: '1px solid rgba(201,168,76,0.2)', color: '#5a8a5a', background: 'transparent', borderRadius: '6px', padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  weekNavBtnActive: { border: '1px solid #c9a84c', color: '#c9a84c', background: 'rgba(201,168,76,0.08)' },
}
