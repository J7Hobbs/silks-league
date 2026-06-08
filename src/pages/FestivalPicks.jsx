import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import RunnerCard from '../components/RunnerCard.jsx'

export default function FestivalPicks() {
  const navigate = useNavigate()
  const [user,       setUser]       = useState(null)
  const [festival,   setFestival]   = useState(null)
  const [entry,      setEntry]      = useState(null)
  const [days,       setDays]       = useState([])
  const [activeDay,  setActiveDay]  = useState(null)
  const [races,      setRaces]      = useState([])
  const [runners,    setRunners]    = useState({})  // { raceId: [...] }
  const [picks,      setPicks]      = useState({})  // { raceId: runnerId }
  const [scores,     setScores]     = useState({})  // { raceId: score }
  const [results,    setResults]    = useState({})  // { raceId: [...] }
  const [saving,     setSaving]     = useState({})  // { raceId: bool }
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setUser(user)
      await load(user.id)
    })
  }, [])

  async function load(userId) {
    setLoading(true)
    try {
      // Find active festival
      const { data: fest } = await supabase
        .from('festivals').select('*').eq('is_active', true).single()
      if (!fest) { setLoading(false); return }
      setFestival(fest)

      // Check entry
      const { data: myEntry } = await supabase
        .from('festival_entries').select('*').eq('festival_id', fest.id).eq('user_id', userId).single()
      setEntry(myEntry || null)

      // Load days
      const { data: daysData } = await supabase
        .from('festival_days').select('*').eq('festival_id', fest.id).order('day_number')
      setDays(daysData || [])

      // Default to today's day, or closest upcoming, or first day
      if (daysData?.length) {
        const todayStr = new Date().toISOString().split('T')[0]
        const today = daysData.find(d => d.race_date === todayStr)
        const upcoming = daysData.find(d => d.race_date >= todayStr)
        const targetDay = today || upcoming || daysData[0]
        setActiveDay(targetDay)
        if (myEntry) await loadDayData(targetDay, userId)
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadDayData(day, userId) {
    if (!day) return
    // Load races for this day
    const { data: racesData } = await supabase
      .from('festival_races').select('*').eq('festival_day_id', day.id).order('race_number')
    setRaces(racesData || [])
    if (!racesData?.length) return

    const raceIds = racesData.map(r => r.id)

    // Load runners for each race
    const allRunners = {}
    for (const race of racesData) {
      const { data: runnersData } = await supabase
        .from('festival_runners').select('*').eq('festival_race_id', race.id).order('horse_number')
      allRunners[race.id] = runnersData || []
    }
    setRunners(allRunners)

    // Load this user's picks for these races
    const { data: picksData } = await supabase
      .from('festival_picks').select('festival_race_id, runner_id').eq('user_id', userId).in('festival_race_id', raceIds)
    const picksMap = {}
    picksData?.forEach(p => { picksMap[p.festival_race_id] = p.runner_id })
    setPicks(picksMap)

    // Load results
    const { data: resultsData } = await supabase
      .from('festival_results').select('*').in('festival_race_id', raceIds).order('position')
    const resultsMap = {}
    resultsData?.forEach(r => {
      if (!resultsMap[r.festival_race_id]) resultsMap[r.festival_race_id] = []
      resultsMap[r.festival_race_id].push(r)
    })
    setResults(resultsMap)

    // Load scores
    const { data: scoresData } = await supabase
      .from('festival_scores').select('*').eq('user_id', userId).in('festival_race_id', raceIds)
    const scoresMap = {}
    scoresData?.forEach(s => { scoresMap[s.festival_race_id] = s })
    setScores(scoresMap)
  }

  async function switchDay(day) {
    if (day.id === activeDay?.id) return
    setActiveDay(day)
    setRaces([])
    setRunners({})
    setPicks({})
    setScores({})
    setResults({})
    if (entry && user) await loadDayData(day, user.id)
  }

  async function joinFestival() {
    if (!festival || !user) return
    const { error } = await supabase.from('festival_entries').insert({
      festival_id: festival.id,
      user_id: user.id,
      starting_points: 0,
    })
    if (!error) await load(user.id)
  }

  async function savePick(raceId, runnerId) {
    if (!user) return
    const deadline = activeDay?.picks_deadline
    if (deadline && new Date() > new Date(deadline)) return  // deadline passed

    setSaving(p => ({ ...p, [raceId]: true }))
    await supabase.from('festival_picks').upsert({
      festival_race_id: raceId,
      user_id: user.id,
      runner_id: runnerId,
      picked_at: new Date().toISOString(),
    }, { onConflict: 'festival_race_id,user_id' })
    setPicks(p => ({ ...p, [raceId]: runnerId }))
    setSaving(p => ({ ...p, [raceId]: false }))
  }

  const isDeadlinePassed = (day) => {
    if (!day?.picks_deadline) return false
    return new Date() > new Date(day.picks_deadline)
  }

  const dayDeadlinePassed = isDeadlinePassed(activeDay)

  const totalPts = (() => {
    const base = entry?.starting_points || 0
    return base + Object.values(scores).reduce((s, sc) => s + (sc?.total_points || 0), 0)
  })()

  if (loading) {
    return (
      <div style={st.loadingPage}>
        <div style={st.loadingDot} />
      </div>
    )
  }

  if (!festival) {
    return (
      <div style={st.page}>
        <nav style={st.nav}><div style={st.navInner}>
          <button style={st.backBtn} onClick={() => navigate('/dashboard')}>← Dashboard</button>
          <div style={st.navLogo}>Silks League</div>
        </div></nav>
        <main style={st.main}>
          <div style={st.emptyCard}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏇</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem', color: '#c9a84c', marginBottom: '0.35rem' }}>No Active Festival</div>
            <div style={{ fontSize: '0.875rem', color: '#5a8a5a' }}>There's no active festival tournament right now. Check back soon.</div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div style={st.page}>
      {/* Nav */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <button style={st.backBtn} onClick={() => navigate('/dashboard')}>← Dashboard</button>
          <div style={st.navLogo}>Silks League</div>
          <button style={{ ...st.backBtn, marginLeft: 'auto', color: '#c9a84c' }} onClick={() => navigate('/festival-leaderboard')}>Leaderboard →</button>
        </div>
      </nav>

      {/* Festival header */}
      <div style={{ background: festival.banner_colour || '#1a6b3a', padding: '1rem 1.25rem' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: '0.15rem' }}>Festival Tournament</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: '#fff', letterSpacing: '0.04em', lineHeight: 1 }}>{festival.display_name || festival.name}</div>
          </div>
          {entry && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', color: '#fff', lineHeight: 1 }}>{totalPts}</div>
              <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>total pts</div>
            </div>
          )}
        </div>
      </div>

      <main style={st.main}>

        {/* Join prompt */}
        {!entry && (
          <div style={st.joinCard}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: '#c9a84c', marginBottom: '0.35rem' }}>Join the Festival</div>
            <div style={{ fontSize: '0.875rem', color: '#5a8a5a', marginBottom: '1rem', lineHeight: 1.5 }}>
              Enter the {festival.display_name || festival.name} tournament to start making picks and competing on the festival leaderboard.
            </div>
            <button style={st.btnGold} onClick={joinFestival}>Join Festival →</button>
          </div>
        )}

        {/* Day tabs */}
        {days.length > 0 && (
          <div style={st.dayTabBar}>
            {days.map(day => {
              const passed = isDeadlinePassed(day)
              return (
                <button key={day.id}
                  style={{ ...st.dayTab, ...(day.id === activeDay?.id ? st.dayTabActive : {}), ...(passed ? { color: '#4ade80' } : {}) }}
                  onClick={() => switchDay(day)}>
                  {day.label}
                  {passed && <span style={{ marginLeft: '4px', fontSize: '0.7em' }}>✓</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* Day info */}
        {activeDay && (
          <div style={st.dayInfo}>
            <span style={{ color: '#5a8a5a', fontSize: '0.82rem' }}>{activeDay.race_date}</span>
            {dayDeadlinePassed ? (
              <span style={st.deadlineBadgePast}>Picks closed</span>
            ) : activeDay.picks_deadline ? (
              <span style={st.deadlineBadge}>
                Picks close {new Date(activeDay.picks_deadline).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
          </div>
        )}

        {/* Race cards */}
        {!entry ? null : races.length === 0 ? (
          <div style={st.emptyMsg}>No races set up for this day yet.</div>
        ) : races.map(race => {
          const raceRunners  = runners[race.id] || []
          const pickedId     = picks[race.id]
          const score        = scores[race.id]
          const raceResults  = results[race.id] || []
          const hasResult    = raceResults.length > 0
          const isSaving     = saving[race.id]

          return (
            <div key={race.id} style={st.raceCard}>
              {/* Race header */}
              <div style={st.raceHead}>
                <span style={st.raceNum}>Race {race.race_number}</span>
                <span style={st.raceMeta}>
                  {race.race_time && <strong style={{ color: '#e8f0e8' }}>{race.race_time}</strong>}
                  {race.venue && <span style={{ color: '#c9a84c' }}> · {race.venue}</span>}
                  {race.race_name && <span style={{ color: '#5a8a5a' }}> · {race.race_name}</span>}
                </span>
                <div style={{ marginLeft: 'auto' }}>
                  {score ? (
                    <span style={st.ptsChip}>{score.total_points} pts</span>
                  ) : pickedId ? (
                    <span style={st.savedChip}>✓ Saved</span>
                  ) : (
                    <span style={st.pendingChip}>Pick required</span>
                  )}
                </div>
              </div>

              {/* Results banner */}
              {hasResult && (
                <div style={st.resultBanner}>
                  {raceResults.slice(0, 3).map(r => (
                    <span key={r.position} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ fontWeight: '700', color: r.position===1?'#c9a84c':r.position===2?'#9ca3af':'#b45309', fontSize: '0.75rem' }}>
                        {r.position===1?'1st':r.position===2?'2nd':'3rd'}
                      </span>
                      <span style={{ color: '#e8f0e8', fontSize: '0.82rem' }}>{r.horse_name}</span>
                      {r.starting_price_display && <span style={{ color: '#5a8a5a', fontSize: '0.72rem' }}>{r.starting_price_display}</span>}
                    </span>
                  ))}
                </div>
              )}

              {/* Runner selection */}
              <div style={st.runnersWrap}>
                {raceRunners.length === 0 ? (
                  <div style={st.emptyMsg}>Runners not yet available</div>
                ) : raceRunners.map(runner => {
                  const isPicked   = pickedId === runner.id
                  const isWinner   = hasResult && raceResults.find(r => r.position === 1 && r.horse_name === runner.horse_name)
                  const isPlaced   = hasResult && raceResults.find(r => r.position <= 3 && r.horse_name === runner.horse_name)

                  return (
                    <button
                      key={runner.id}
                      disabled={dayDeadlinePassed || isSaving || runner.is_withdrawn}
                      onClick={() => !dayDeadlinePassed && savePick(race.id, runner.id)}
                      style={{
                        ...st.runnerBtn,
                        ...(isPicked ? st.runnerBtnPicked : {}),
                        ...(runner.is_withdrawn ? st.runnerBtnWD : {}),
                        ...(isWinner ? st.runnerBtnWinner : isPlaced ? st.runnerBtnPlaced : {}),
                      }}>
                      {runner.silk_colour && (
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: runner.silk_colour, border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0 }} />
                      )}
                      <span style={{ minWidth: '18px', textAlign: 'center', fontFamily: "'Bebas Neue', sans-serif", color: isPicked ? '#0a1a08' : '#c9a84c', fontSize: '0.9rem' }}>{runner.horse_number}</span>
                      <span style={{ flex: 1, textAlign: 'left', fontWeight: '600', fontSize: '0.875rem', color: runner.is_withdrawn ? '#5a8a5a' : isPicked ? '#0a1a08' : '#e8f0e8', textDecoration: runner.is_withdrawn ? 'line-through' : 'none' }}>{runner.horse_name}</span>
                      {runner.odds_fractional && (
                        <span style={{ fontSize: '0.72rem', color: runner.is_withdrawn ? '#5a8a5a' : isPicked ? '#0a1a08' : '#5a8a5a' }}>{runner.odds_fractional}</span>
                      )}
                      {runner.is_withdrawn && <span style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: '600' }}>WD</span>}
                      {isPicked && !runner.is_withdrawn && <span style={{ fontSize: '0.75rem', color: '#0a1a08', fontWeight: '700' }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </main>
    </div>
  )
}

const st = {
  page:        { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '3rem' },
  loadingPage: { minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loadingDot:  { width: '12px', height: '12px', borderRadius: '50%', background: '#c9a84c' },
  nav:         { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)' },
  navInner:    { maxWidth: '600px', margin: '0 auto', padding: '0 1.25rem', height: '56px', display: 'flex', alignItems: 'center', gap: '1rem' },
  navLogo:     { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: '#c9a84c', letterSpacing: '0.1em' },
  backBtn:     { background: 'none', border: 'none', color: '#5a8a5a', cursor: 'pointer', fontSize: '0.875rem', fontFamily: "'DM Sans', sans-serif", padding: 0 },
  main:        { maxWidth: '600px', margin: '0 auto', padding: '1.5rem 1.25rem' },
  emptyCard:   { textAlign: 'center', background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '16px', padding: '3rem 2rem', marginTop: '2rem' },
  joinCard:    { background: '#162a1a', border: '1px solid rgba(201,168,76,0.3)', borderLeft: '4px solid #c9a84c', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.25rem' },
  btnGold:     { background: '#c9a84c', color: '#0a1a08', fontWeight: '700', fontSize: '0.875rem', padding: '0.65rem 1.4rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  dayTabBar:   { display: 'flex', gap: '0.25rem', flexWrap: 'wrap', background: '#0d1f0d', borderRadius: '8px', padding: '0.4rem 0.5rem', marginBottom: '0.85rem', border: '1px solid rgba(201,168,76,0.1)' },
  dayTab:      { background: 'none', border: 'none', borderRadius: '5px', borderBottom: '2px solid transparent', padding: '0.4rem 0.75rem', fontSize: '0.78rem', fontWeight: '500', color: '#5a8a5a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  dayTabActive:{ color: '#c9a84c', background: 'rgba(201,168,76,0.08)', borderRadius: '5px', borderBottom: '2px solid #c9a84c' },
  dayInfo:     { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' },
  deadlineBadge:      { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '999px', padding: '0.2rem 0.65rem', fontSize: '0.72rem', fontWeight: '600', color: '#c9a84c' },
  deadlineBadgePast:  { background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: '999px', padding: '0.2rem 0.65rem', fontSize: '0.72rem', fontWeight: '600', color: '#4ade80' },
  emptyMsg:    { color: '#5a8a5a', textAlign: 'center', padding: '1.5rem', fontSize: '0.875rem' },
  raceCard:    { background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '12px', marginBottom: '0.85rem', overflow: 'hidden' },
  raceHead:    { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.75rem 1rem', borderBottom: '1px solid rgba(201,168,76,0.08)', flexWrap: 'wrap' },
  raceNum:     { fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 },
  raceMeta:    { fontSize: '0.82rem', flex: 1 },
  ptsChip:     { background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.78rem', fontWeight: '700', color: '#c9a84c' },
  savedChip:   { background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.75rem', fontWeight: '600', color: '#4ade80' },
  pendingChip: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.75rem', color: '#5a8a5a' },
  resultBanner:{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '0.55rem 1rem', background: 'rgba(74,222,128,0.05)', borderBottom: '1px solid rgba(74,222,128,0.1)' },
  runnersWrap: { padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  runnerBtn:   { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem', background: '#ffffff', border: '2px solid #c9a84c', borderRadius: '10px', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s' },
  runnerBtnPicked: { background: '#c9a84c', border: '2px solid #c9a84c' },
  runnerBtnWD:     { background: 'rgba(255,255,255,0.03)', border: '2px solid rgba(239,68,68,0.3)', cursor: 'not-allowed' },
  runnerBtnWinner: { background: '#fff', border: '2px solid #4ade80' },
  runnerBtnPlaced: { background: '#fff', border: '2px solid #9ca3af' },
}
