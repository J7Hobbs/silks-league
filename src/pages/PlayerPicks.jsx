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
  const [profile,    setProfile]    = useState(null)   // the target player's profile
  const [races,      setRaces]      = useState([])
  const [picks,      setPicks]      = useState({})     // { raceId: runner }
  const [scores,     setScores]     = useState({})     // { raceId: score }
  const [results,    setResults]    = useState({})     // { raceId: [...] }
  const [week,       setWeek]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [deadlinePassed, setDeadlinePassed] = useState(false)
  const [isOwnPicks, setIsOwnPicks] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setMyUserId(user.id)
      const own = user.id === userId
      setIsOwnPicks(own)
      setDeadlinePassed(own || isAfterDeadline())
      load(user.id)
    })
  }, [userId])

  async function load(myId) {
    setLoading(true)
    try {
      // Target player profile
      const { data: prof } = await supabase
        .from('profiles').select('id, username, full_name').eq('id', userId).single()
      setProfile(prof)

      // Current active week
      const { data: season } = await supabase
        .from('seasons').select('id').eq('is_active', true).single()
      if (!season) return

      const { data: weeks } = await supabase
        .from('race_weeks').select('*').eq('season_id', season.id)
        .order('saturday_date', { ascending: false }).limit(1)
      const currentWeek = weeks?.[0]
      if (!currentWeek) return
      setWeek(currentWeek)

      // Races for the week
      const { data: racesData } = await supabase
        .from('races').select('*').eq('race_week_id', currentWeek.id).order('race_number')
      if (!racesData?.length) return
      setRaces(racesData)

      const raceIds = racesData.map(r => r.id)

      // Target player's picks for these races
      const { data: picksData } = await supabase
        .from('picks').select('race_id, runner_id').eq('user_id', userId).in('race_id', raceIds)

      // Load runner details for picks
      const runnerIds = (picksData || []).map(p => p.runner_id).filter(Boolean)
      const { data: runnersData } = runnerIds.length
        ? await supabase.from('runners').select('id, horse_name, silk_colour, horse_number, odds_fractional').in('id', runnerIds)
        : { data: [] }
      const runnerMap = {}
      runnersData?.forEach(r => { runnerMap[r.id] = r })
      const picksMap = {}
      picksData?.forEach(p => { if (p.runner_id && runnerMap[p.runner_id]) picksMap[p.race_id] = runnerMap[p.runner_id] })
      setPicks(picksMap)

      // Results
      const { data: resultsData } = await supabase
        .from('results').select('race_id, position, horse_name, starting_price_display').in('race_id', raceIds)
      const resultsMap = {}
      resultsData?.forEach(r => {
        if (!resultsMap[r.race_id]) resultsMap[r.race_id] = []
        resultsMap[r.race_id].push(r)
      })
      setResults(resultsMap)

      // Scores for target player
      const { data: scoresData } = await supabase
        .from('scores').select('race_id, base_points, bonus_points, total_points, position_achieved, score_note')
        .eq('user_id', userId).in('race_id', raceIds)
      const scoresMap = {}
      scoresData?.forEach(s => { scoresMap[s.race_id] = s })
      setScores(scoresMap)

    } finally {
      setLoading(false)
    }
  }

  const displayName = profile?.username || profile?.full_name || 'Player'
  const totalPts = Object.values(scores).reduce((sum, s) => sum + (s?.total_points || 0), 0)
  const weekDateStr = week?.saturday_date
    ? new Date(week.saturday_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

  const posLabel = (p) => p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : null

  return (
    <div style={st.page}>

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
              <h1 style={st.title}>{isOwnPicks ? 'My picks' : `${displayName}'s picks`}</h1>
              {weekDateStr && <div style={st.weekLabel}>{weekDateStr}</div>}
              {Object.keys(scores).length > 0 && (
                <div style={st.totalPts}>
                  <span style={st.totalNum}>{totalPts}</span>
                  <span style={st.totalLabel}>pts total</span>
                </div>
              )}
            </div>

            {/* Race cards */}
            {races.length === 0 ? (
              <div style={st.emptyMsg}>No races set up for this week yet.</div>
            ) : races.map(race => {
              const pick   = picks[race.id]
              const score  = scores[race.id]
              const raceResults = results[race.id] || []
              const hasResult   = raceResults.length > 0
              const silkBg      = pick?.silk_colour || '#1a3a10'
              const isWD        = score?.score_note?.includes('withdrawn')

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
                      {isWD ? (
                        <span style={st.wdChip}>WD — {score?.total_points ?? 0} avg pts</span>
                      ) : score ? (
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
                            {isWD ? (
                              <div style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: '700' }}>WD — avg pts</div>
                            ) : !hasResult ? (
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
  header:  { marginBottom: '1.5rem' },
  title:   { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#e8f0e8', letterSpacing: '0.04em', marginBottom: '0.2rem' },
  weekLabel: { fontSize: '0.8rem', color: '#5a8a5a', marginBottom: '0.75rem' },
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
  wdChip:    { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.72rem', fontWeight: '600', color: '#f87171' },
  pickCard:  { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px 12px', background: '#ffffff', margin: '10px', borderRadius: '10px', border: '2px solid #c9a84c' },
  noPick:    { padding: '0.85rem 1rem', fontSize: '0.85rem', color: '#5a8a5a', fontStyle: 'italic' },
}
