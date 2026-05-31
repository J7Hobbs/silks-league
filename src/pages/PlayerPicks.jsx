import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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
                    <div style={st.pickCard}>
                      {/* Silk badge */}
                      <div style={{ width: '50px', minWidth: '50px', height: '56px', borderRadius: '8px', background: silkBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '4px 3px 5px', overflow: 'hidden', flexShrink: 0 }}>
                        <svg style={{ flex: 1, width: '100%' }} viewBox="0 0 874 874" xmlns="http://www.w3.org/2000/svg">
                          <g transform="translate(137, 80) scale(0.68)">
                            <path d="M18.78 847.71 c0 -1.37 1.54 -10.93 3.33 -21.17 1.88 -10.24 6.91 -38.49 11.18 -62.65 4.27 -24.15 9.64 -54.54 11.95 -67.43 2.30 -12.89 6.15 -34.57 8.54 -48.22 2.39 -13.57 6.23 -35.34 8.54 -48.22 4.44 -24.92 14.25 -80.91 25.52 -145.52 3.76 -21.59 8.79 -50.36 11.18 -64.01 13.14 -74.77 23.90 -137.59 23.90 -139.72 0 -1.54 0.60 -2.65 1.96 -3.33 1.88 -1.11 97.90 -64.36 160.89 -106.09 l34.31 -22.70 0 -34.14 0 -34.14 112.24 0 112.24 0 0 33.20 0 33.29 11.35 7.34 c13.06 8.54 34.82 22.62 45.58 29.53 4.18 2.65 20.40 13.06 36.10 23.13 30.47 19.55 94.91 60.77 97.64 62.48 1.28 0.77 2.13 3.50 3.67 11.27 6.91 35.25 57.70 307.78 81.77 438.62 22.70 123.76 26.12 142.62 26.63 148.34 l0.51 5.72 -57.61 0 -57.61 0 -8.19 -27.91 c-11.10 -37.55 -17.84 -60.26 -26.03 -87.31 -3.76 -12.46 -11.18 -36.79 -16.39 -54.20 -24.24 -80.06 -35.34 -115.99 -35.59 -115.05 -0.34 1.11 -7 37.64 -40.71 223.45 l-7.94 43.53 -75.88 0.51 c-41.74 0.26 -117.87 0.85 -169.08 1.19 l-93.29 0.68 0 -2.05 c0 -1.88 -2.48 -18.18 -12.80 -83.99 -9.22 -58.72 -29.28 -182.23 -29.53 -181.97 -0.34 0.34 -20.40 70.42 -30.21 105.58 -4.78 17.16 -11.69 41.91 -15.36 55.05 -9.05 32.18 -17.92 64.27 -27.31 98.15 -4.27 15.53 -7.94 28.85 -8.19 29.70 -0.43 1.37 -4.01 1.45 -58.89 1.45 l-58.38 0 0 -2.39z"
                              fill={silkBg} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            <path d="M330.31 90.13 l0 -28.42 32.18 -0.51 c17.67 -0.34 63.59 -0.60 102 -0.60 l69.82 0 0 28.08 0 28.08 -41.99 0.51 c-23.13 0.26 -69.05 0.68 -102 0.85 l-60 0.43 0 -28.42z"
                              fill="white" />
                          </g>
                        </svg>
                        {pick.horse_number != null && (
                          <span style={{ fontSize: '9px', fontWeight: '700', color: 'white', lineHeight: 1 }}>{pick.horse_number}</span>
                        )}
                      </div>

                      {/* Horse name + score */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '15px', fontWeight: '700', color: '#0d1a08', lineHeight: 1.2 }}>
                          {pick.horse_name}
                        </div>
                        {pick.odds_fractional && (
                          <div style={{ fontSize: '11px', color: '#c9a84c', fontWeight: '700', marginTop: '2px' }}>{pick.odds_fractional}</div>
                        )}
                        {isWD && (
                          <div style={{ fontSize: '10px', color: '#f87171', fontWeight: '700', marginTop: '2px', letterSpacing: '0.05em' }}>WITHDRAWN — average pts awarded</div>
                        )}
                        {!hasResult && !isWD && (
                          <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>Pending result</div>
                        )}
                        {hasResult && score && !isWD && (
                          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
                            {score.position_achieved
                              ? `${posLabel(score.position_achieved)} · ${score.base_points} base${score.bonus_points > 0 ? ` + ${score.bonus_points} bonus` : ''}`
                              : 'Unplaced · 0 pts'}
                          </div>
                        )}
                      </div>

                      {/* Odds */}
                      {pick.odds_fractional && (
                        <div style={{ fontSize: '20px', fontWeight: '700', color: '#c9a84c', fontFamily: 'Georgia, serif', flexShrink: 0 }}>
                          {pick.odds_fractional}
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
