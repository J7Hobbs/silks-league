/**
 * Silks League — Picks Page
 * Weekly picks + festival tab switcher.
 */

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ProfileDropdown from '../components/ProfileDropdown.jsx'
import RunnerCard from '../components/RunnerCard.jsx'
import { Home, Target, Trophy, BarChart2 } from 'lucide-react'

function fmtDeadlineDate(ds) {
  if (!ds) return ''
  const d = new Date(ds + 'T12:00:00')
  const day = d.getDate()
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
               : day === 2 || day === 22 ? 'nd'
               : day === 3 || day === 23 ? 'rd' : 'th'
  const month = d.toLocaleDateString('en-GB', { month: 'long' })
  return `${day}${suffix} ${month} ${d.getFullYear()}`
}

function formatCountdown(ms) {
  if (ms <= 0) return null
  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function Picks() {
  const navigate = useNavigate()
  const location  = useLocation()

  // ── Weekly state ──────────────────────────────────────────────
  const [user,          setUser]          = useState(null)
  const [isAdmin,       setIsAdmin]       = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [noWeek,        setNoWeek]        = useState(false)
  const [currentWeek,   setCurrentWeek]   = useState(null)
  const [races,         setRaces]         = useState([])
  const [runners,       setRunners]       = useState({})
  const [userPicks,     setUserPicks]     = useState({})
  const [expandedRace,  setExpandedRace]  = useState(null)
  const [selected,      setSelected]      = useState({})
  const [saving,        setSaving]        = useState(null)
  const [toast,         setToast]         = useState(null)
  const [now,           setNow]           = useState(new Date())
  const [origRunners,   setOrigRunners]   = useState({})

  // ── Festival state ────────────────────────────────────────────
  const [activeFestivals,  setActiveFestivals]  = useState([])
  const [selectedTab,      setSelectedTab]      = useState('week')
  const [festEntry,        setFestEntry]        = useState(null)
  const [festDays,         setFestDays]         = useState([])
  const [festDay,          setFestDay]          = useState(null)
  const [festRaces,        setFestRaces]        = useState([])
  const [festRunners,      setFestRunners]      = useState({})
  const [festPicks,        setFestPicks]        = useState({})
  const [festScores,       setFestScores]       = useState({})
  const [festExpandedRace, setFestExpandedRace] = useState(null)
  const [festSelected,     setFestSelected]     = useState({})
  const [festSaving,       setFestSaving]       = useState(null)
  const [festLoading,      setFestLoading]      = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/auth'); return }
    setUser(user)
    const { data: profile } = await supabase
      .from('profiles').select('is_admin').eq('id', user.id).single()
    setIsAdmin(profile?.is_admin || false)
    await loadData(user)
    const { data: fests } = await supabase
      .from('festivals').select('*').eq('is_active', true).order('start_date')
    setActiveFestivals(fests || [])
    // Auto-select festival tab if navigated here with festivalTab state (e.g. from Dashboard banner)
    const requestedTab = location.state?.festivalTab
    if (requestedTab && fests?.some(f => f.id === requestedTab)) {
      setSelectedTab(requestedTab)
    }
  }

  // ── Weekly loader ─────────────────────────────────────────────
  async function loadData(u) {
    setLoading(true)
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) { setNoWeek(true); setLoading(false); return }

    const nowDate = new Date()
    const { data: weeks } = await supabase
      .from('race_weeks').select('*')
      .eq('season_id', season.id)
      .order('saturday_date', { ascending: true })

    const week = weeks?.find(w => {
      const dl = w.picks_deadline ? new Date(w.picks_deadline) : new Date(w.saturday_date + 'T12:00:00')
      return nowDate < dl
    }) || (weeks?.length ? weeks[weeks.length - 1] : null)

    if (!week) { setNoWeek(true); setLoading(false); return }
    setCurrentWeek(week)

    const { data: raceData } = await supabase
      .from('races').select('*').eq('race_week_id', week.id).order('race_number')
    setRaces(raceData || [])
    if (!raceData?.length) { setLoading(false); return }

    const runnersMap = {}
    for (const race of raceData) {
      const { data: r } = await supabase
        .from('runners').select('*').eq('race_id', race.id).order('horse_number', { ascending: true })
      runnersMap[race.id] = r || []
    }
    setRunners(runnersMap)

    const raceIds = raceData.map(r => r.id)
    const { data: picks } = await supabase
      .from('picks').select('*').eq('user_id', u.id).in('race_id', raceIds)

    const picksMap = {}
    const selMap   = {}
    for (const p of (picks || [])) {
      picksMap[p.race_id] = p
      selMap[p.race_id]   = p.runner_id
    }
    setUserPicks(picksMap)
    setSelected(selMap)

    const origIds = (picks || []).filter(p => p.was_replaced && p.original_runner_id).map(p => p.original_runner_id)
    if (origIds.length) {
      const { data: origData } = await supabase.from('runners').select('id, horse_name').in('id', origIds)
      const origMap = {}
      origData?.forEach(r => { origMap[r.id] = r.horse_name })
      setOrigRunners(origMap)
    }
    setLoading(false)
  }

  // ── Festival loaders ──────────────────────────────────────────
  async function handleFestivalTabClick(fest) {
    if (selectedTab === fest.id) return
    setSelectedTab(fest.id)
    setFestEntry(null); setFestDays([]); setFestDay(null)
    setFestRaces([]); setFestRunners({}); setFestPicks({})
    setFestScores({}); setFestExpandedRace(null); setFestSelected({})
    await loadFestivalData(fest)
  }

  async function loadFestivalData(fest) {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) return
    setFestLoading(true)
    try {
      const { data: entryData } = await supabase
        .from('festival_entries').select('*')
        .eq('festival_id', fest.id).eq('user_id', u.id).maybeSingle()
      setFestEntry(entryData || null)

      const { data: daysData } = await supabase
        .from('festival_days').select('*').eq('festival_id', fest.id).order('day_number')
      setFestDays(daysData || [])

      if (daysData?.length) {
        const todayStr = new Date().toISOString().split('T')[0]
        const currentDay = daysData.find(d => d.race_date === todayStr)
          || daysData.find(d => d.race_date >= todayStr)
          || daysData[0]
        setFestDay(currentDay)
        if (entryData) await loadFestDayData(currentDay, u.id)
      }
    } finally {
      setFestLoading(false)
    }
  }

  async function loadFestDayData(day, userId) {
    if (!day || !userId) return
    const { data: racesData } = await supabase
      .from('festival_races').select('*').eq('festival_day_id', day.id).order('race_number')
    setFestRaces(racesData || [])
    if (!racesData?.length) return

    const raceIds = racesData.map(r => r.id)
    const runnersMap = {}
    for (const race of racesData) {
      const { data: rData } = await supabase
        .from('festival_runners').select('*').eq('festival_race_id', race.id).order('horse_number')
      runnersMap[race.id] = rData || []
    }
    setFestRunners(runnersMap)

    const { data: picksData } = await supabase
      .from('festival_picks').select('festival_race_id, runner_id')
      .eq('user_id', userId).in('festival_race_id', raceIds)
    const picksMap = {}
    picksData?.forEach(p => { picksMap[p.festival_race_id] = p.runner_id })
    setFestPicks(picksMap)
    setFestSelected(picksMap)

    const { data: scoresData } = await supabase
      .from('festival_scores').select('*').eq('user_id', userId).in('festival_race_id', raceIds)
    const scoresMap = {}
    scoresData?.forEach(s => { scoresMap[s.festival_race_id] = s })
    setFestScores(scoresMap)
  }

  async function handleFestDaySwitch(day) {
    if (day.id === festDay?.id) return
    setFestDay(day)
    setFestRaces([]); setFestRunners({}); setFestPicks({})
    setFestScores({}); setFestExpandedRace(null); setFestSelected({})
    if (festEntry) {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (u) await loadFestDayData(day, u.id)
    }
  }

  // ── Computed ──────────────────────────────────────────────────
  const deadline     = currentWeek?.picks_deadline ? new Date(currentWeek.picks_deadline) : null
  const isLocked     = deadline ? now >= deadline : false
  const msRemaining  = deadline ? deadline - now : 0
  const countdown    = formatCountdown(msRemaining)
  const pickedCount  = Object.keys(userPicks).length
  const allPicked    = races.length > 0 && pickedCount === races.length
  const festDayLocked = !!(festDay?.picks_deadline && now >= new Date(festDay.picks_deadline))
  const festTotalPts  = (festEntry?.starting_points || 0) +
    Object.values(festScores).reduce((s, sc) => s + (sc?.total_points || 0), 0)
  const activeFest   = activeFestivals.find(f => f.id === selectedTab)

  // ── Handlers ──────────────────────────────────────────────────
  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 2800)
  }

  function handleExpand(raceId) {
    setExpandedRace(prev => prev === raceId ? null : raceId)
  }

  function handleSelect(raceId, runnerId) {
    if (isLocked) return
    const runner = (runners[raceId] || []).find(r => r.id === runnerId)
    if (runner?.is_withdrawn) return
    setSelected(prev => ({ ...prev, [raceId]: runnerId }))
  }

  async function handleSavePick(raceId) {
    const runnerId = selected[raceId]
    if (!runnerId || !user) return
    setSaving(raceId)
    const existing = userPicks[raceId]
    let error
    if (existing?.id) {
      const res = await supabase.from('picks').update({ runner_id: runnerId }).eq('id', existing.id)
      error = res.error
    } else {
      const res = await supabase.from('picks').upsert({ user_id: user.id, race_id: raceId, runner_id: runnerId }, { onConflict: 'user_id,race_id' })
      error = res.error
    }
    setSaving(null)
    if (error) { showToast('Failed to save — ' + error.message, 'error'); return }
    setUserPicks(prev => ({ ...prev, [raceId]: { ...(existing || {}), user_id: user.id, race_id: raceId, runner_id: runnerId } }))
    showToast(existing ? 'Pick updated!' : 'Pick saved!')
    setExpandedRace(null)
  }

  function handleFestSelect(raceId, runnerId) {
    if (festDayLocked) return
    const runner = (festRunners[raceId] || []).find(r => r.id === runnerId)
    if (runner?.is_withdrawn) return
    setFestSelected(prev => ({ ...prev, [raceId]: runnerId }))
  }

  async function handleFestSavePick(raceId) {
    const runnerId = festSelected[raceId]
    if (!runnerId || !user || festDayLocked) return
    setFestSaving(raceId)
    await supabase.from('festival_picks').upsert({
      festival_race_id: raceId,
      user_id: user.id,
      runner_id: runnerId,
      picked_at: new Date().toISOString(),
    }, { onConflict: 'festival_race_id,user_id' })
    setFestSaving(null)
    const wasAlreadyPicked = !!festPicks[raceId]
    setFestPicks(prev => ({ ...prev, [raceId]: runnerId }))
    showToast(wasAlreadyPicked ? 'Pick updated!' : 'Pick saved!')
    setFestExpandedRace(null)
  }

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={st.loadingPage}>
        <div style={st.loadingInner}>
          <div style={st.loadingLogo}>Silks League</div>
          <div style={st.loadingText}>Loading picks…</div>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={st.page}>

      <style>{`@keyframes silksPulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>

      {/* Nav */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>
          <div style={st.navLinks} className="app-nav-links">
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={{ ...st.navLink, ...st.navLinkActive }}>My Picks</a>
            <a href="/league"    style={st.navLink}>League</a>
            <a href="/results"   style={st.navLink}>Results</a>
            <a href="/groups"    style={st.navLink}>Groups</a>
          </div>
          <div style={st.navRight}>
            <ProfileDropdown user={user} isAdmin={isAdmin} />
          </div>
        </div>
      </nav>

      {/* Toast */}
      {toast && (
        <div style={{ ...st.toast, ...(toast.type === 'error' ? st.toastError : st.toastSuccess) }}>
          {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}
        </div>
      )}

      <main style={st.main} className="app-main-pad">

        {/* ── Tab bar — only when at least one festival is active ── */}
        {activeFestivals.length > 0 && (
          <div style={st.tabBar}>
            <button
              style={{ ...st.tabBtn, ...(selectedTab === 'week' ? st.tabBtnActive : {}) }}
              onClick={() => setSelectedTab('week')}>
              This Week
            </button>
            {activeFestivals.map(fest => (
              <button
                key={fest.id}
                style={{ ...st.tabBtn, ...(selectedTab === fest.id ? st.tabBtnActive : {}) }}
                onClick={() => handleFestivalTabClick(fest)}>
                <span style={{
                  display: 'inline-block', width: '7px', height: '7px',
                  borderRadius: '50%', background: '#c9a84c',
                  marginRight: '6px', flexShrink: 0, verticalAlign: 'middle',
                  animation: 'silksPulse 2s ease-in-out infinite',
                }} />
                {fest.display_name || fest.name}
              </button>
            ))}
          </div>
        )}

        {/* ════════════════ WEEKLY TAB ════════════════ */}
        {selectedTab === 'week' && (
          <>
            {noWeek && (
              <div style={st.emptyState}>
                <div style={st.emptyIcon}>🏇</div>
                <div style={st.emptyTitle}>Picks Not Open Yet</div>
                <div style={st.emptySub}>
                  No race week has been set up for this Saturday yet.<br />
                  Check back on Friday — picks will open once the races are confirmed.
                </div>
                <button style={st.btnGold} onClick={() => navigate('/dashboard')}>← Back to Dashboard</button>
              </div>
            )}

            {currentWeek && (
              <>
                {/* Deadline / locked banner */}
                {isLocked ? (
                  <div style={st.lockedBanner}>
                    <span style={{ fontSize: '1.4rem' }}>🔒</span>
                    <div>
                      <div style={st.lockedTitle}>Picks Locked</div>
                      <div style={st.lockedSub}>
                        Locked at {deadline?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · Saturday {fmtDeadlineDate(currentWeek.saturday_date)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={st.deadlineBanner}>
                    <div style={st.deadlineLeft}>
                      <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>⏱</span>
                      <div>
                        <div style={st.deadlineLabel}>Picks deadline</div>
                        <div style={st.deadlineTime}>
                          {deadline?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} on Saturday {fmtDeadlineDate(currentWeek.saturday_date)}
                        </div>
                      </div>
                    </div>
                    {countdown && (
                      <div style={st.countdownPill}>
                        <span style={st.countdownValue}>{countdown}</span>
                        <span style={st.countdownLabel}>remaining</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Progress card */}
                <div style={st.progressCard}>
                  <div style={st.progressTop}>
                    <div>
                      <div style={st.progressHeading}>
                        {allPicked ? '🎉 All picks made!' : `${pickedCount} of ${races.length} picked`}
                      </div>
                      {allPicked && <div style={st.congratsMsg}>Your picks are in for Week {currentWeek.week_number}. Good luck!</div>}
                    </div>
                    {allPicked && (
                      <button style={st.btnGold} onClick={() => navigate('/dashboard')}>View Leaderboard →</button>
                    )}
                  </div>
                  <div style={st.progressBarWrap}>
                    <div style={{ ...st.progressFill, width: races.length ? `${(pickedCount / races.length) * 100}%` : '0%' }} />
                  </div>
                  <div style={st.pipRow}>
                    {races.map(race => {
                      const picked = !!userPicks[race.id]
                      return (
                        <div key={race.id} style={{ ...st.pip, ...(picked ? st.pipDone : {}) }}>
                          {picked ? '✓' : race.race_number}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Race rows */}
                <div style={st.raceList}>
                  {races.map(race => {
                    const pick         = userPicks[race.id]
                    const isPicked     = !!pick
                    const isExpanded   = expandedRace === race.id
                    const raceRunners  = runners[race.id] || []
                    const selRunnerId  = selected[race.id]
                    const selRunner    = raceRunners.find(r => r.id === selRunnerId)
                    const pickedRunner = raceRunners.find(r => r.id === pick?.runner_id)
                    return (
                      <div key={race.id} style={{ ...st.raceOuter, ...(isPicked ? st.raceOuterPicked : {}) }}>
                        <button style={st.raceSummaryRow} onClick={() => handleExpand(race.id)}>
                          <div style={{ ...st.raceNumCircle, ...(isPicked ? st.raceNumCirclePicked : {}) }}>
                            {race.race_number}
                          </div>
                          <div style={st.raceSummaryInfo}>
                            <div style={st.raceSummaryVenue}>{race.venue}</div>
                            <div style={st.raceSummaryMeta}>{race.race_time} · {race.race_name}</div>
                          </div>
                          <div style={st.raceSummaryRight}>
                            {isPicked && pickedRunner ? (
                              pick?.was_replaced ? (
                                <span style={{ ...st.pickedBadge, background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.4)', color: '#c9a84c' }}>⚠️ {pickedRunner.horse_name}</span>
                              ) : pickedRunner.is_withdrawn ? (
                                <span style={{ ...st.pickedBadge, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>⚠ Withdrawn</span>
                              ) : (
                                <span style={st.pickedBadge}>✓ {pickedRunner.horse_name}</span>
                              )
                            ) : (
                              <span style={st.notPickedText}>{isLocked ? 'No pick' : 'Not picked yet'}</span>
                            )}
                            <span style={{ ...st.chevron, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div style={st.expandedSection}>
                            {pick?.was_replaced && pick?.original_runner_id && (
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', background: 'rgba(201,168,76,0.15)', border: '1px solid #c9a84c', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                                <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>⚠️</span>
                                <div style={{ fontSize: '0.82rem', color: '#c9a84c' }}>
                                  Your original pick <strong style={{ color: '#e8c96e' }}>{origRunners[pick.original_runner_id] || 'your horse'}</strong> was scratched and has been automatically replaced with the race favourite <strong style={{ color: '#e8c96e' }}>{pickedRunner?.horse_name || '—'}</strong>.
                                </div>
                              </div>
                            )}
                            {pickedRunner?.is_withdrawn && !pick?.was_replaced && (
                              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.85rem', color: '#f87171', lineHeight: 1.5 }}>
                                <strong>⚠ Your pick ({pickedRunner.horse_name}) has been withdrawn.</strong>
                              </div>
                            )}
                            {raceRunners.length === 0 ? (
                              <p style={st.noRunners}>No runners added yet — check back soon.</p>
                            ) : (
                              <>
                                <div style={st.runnerGrid}>
                                  {raceRunners.map(runner => (
                                    <RunnerCard
                                      key={runner.id}
                                      runner={runner}
                                      selected={selRunnerId === runner.id}
                                      showCircle
                                      onClick={() => handleSelect(race.id, runner.id)}
                                      disabled={isLocked}
                                    />
                                  ))}
                                </div>
                                {!isLocked && (
                                  <div style={st.saveRow}>
                                    <div style={st.selectedHint}>
                                      {selRunner
                                        ? <><span style={{ color: '#5a8a5a' }}>Selected: </span><strong style={{ color: '#e8f0e8' }}>{selRunner.horse_name}</strong></>
                                        : <span style={{ color: '#5a8a5a', fontStyle: 'italic' }}>Tap a runner to select</span>}
                                    </div>
                                    <button
                                      style={{ ...st.saveBtn, ...(!selRunnerId || saving === race.id ? st.saveBtnDisabled : {}) }}
                                      onClick={() => handleSavePick(race.id)}
                                      disabled={!selRunnerId || saving === race.id}>
                                      {saving === race.id ? 'Saving…' : isPicked ? 'Update Pick' : 'Save Pick'}
                                    </button>
                                  </div>
                                )}
                                {isLocked && isPicked && pickedRunner && (
                                  <div style={st.lockedPickDisplay}>
                                    <span style={{ opacity: 0.6 }}>Your pick:</span>
                                    <strong style={{ color: '#c9a84c', marginLeft: '0.5rem' }}>{pickedRunner.horse_name}</strong>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ════════════════ FESTIVAL TAB ════════════════ */}
        {selectedTab !== 'week' && activeFest && (
          <>
            {festLoading ? (
              <div style={{ textAlign: 'center', color: '#5a8a5a', padding: '3rem 1rem', fontSize: '0.9rem' }}>
                Loading festival…
              </div>
            ) : (
              <>
                {/* Festival header card */}
                <div style={st.festHeader}>
                  <div style={st.festShimmer} />
                  <div style={st.festHeaderInner}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>👑</span>
                        <span style={st.festHeaderName}>
                          {(activeFest.display_name || activeFest.name).toUpperCase()}
                        </span>
                      </div>
                      <div style={st.festHeaderSub}>
                        {activeFest.start_date} → {activeFest.end_date}
                        {festDay && festDays.length > 0 && (
                          <span style={{ color: '#c9a84c', marginLeft: '0.5rem' }}>
                            · Day {festDay.day_number} of {festDays.length}
                          </span>
                        )}
                      </div>
                    </div>
                    {festEntry && (
                      <div style={st.festHeaderPts}>
                        <div style={st.festHeaderPtsNum}>{festTotalPts}</div>
                        <div style={st.festHeaderPtsLabel}>TOTAL PTS</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Join prompt */}
                {!festEntry && (
                  <div style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '0.9rem', color: '#e8f0e8', marginBottom: '0.15rem' }}>Join the {activeFest.display_name || activeFest.name}</div>
                      <div style={{ fontSize: '0.78rem', color: '#5a8a5a' }}>Enter the festival tournament to start making picks.</div>
                    </div>
                    <button style={st.btnGold} onClick={async () => {
                      await supabase.from('festival_entries').insert({ festival_id: activeFest.id, user_id: user.id, starting_points: 0 })
                      await loadFestivalData(activeFest)
                    }}>Join Festival →</button>
                  </div>
                )}

                {/* Day pills */}
                {festDays.length > 0 && (
                  <div style={st.dayPillRow}>
                    {festDays.map(day => {
                      const isActive    = day.id === festDay?.id
                      const isCompleted = !!(day.picks_deadline && now >= new Date(day.picks_deadline))
                      const d           = new Date(day.race_date + 'T12:00:00')
                      const shortDay    = d.toLocaleDateString('en-GB', { weekday: 'short' })
                      return (
                        <button
                          key={day.id}
                          style={{
                            ...st.dayPill,
                            ...(isActive ? st.dayPillActive : {}),
                            ...(isCompleted && !isActive ? st.dayPillCompleted : {}),
                            ...(!isActive && !isCompleted ? st.dayPillFuture : {}),
                          }}
                          onClick={() => handleFestDaySwitch(day)}>
                          {shortDay}
                          {isCompleted && <span style={{ marginLeft: '3px', fontSize: '9px' }}>✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Festival race list */}
                {festEntry && (
                  <div style={st.raceList}>
                    {festRaces.length === 0 ? (
                      <div style={{ color: '#5a8a5a', textAlign: 'center', padding: '1.5rem', fontSize: '0.875rem' }}>
                        No races set up for this day yet.
                      </div>
                    ) : festRaces.map(race => {
                      const pickedRunnerId = festPicks[race.id]
                      const isPicked       = !!pickedRunnerId
                      const isExpanded     = festExpandedRace === race.id
                      const raceRunners    = festRunners[race.id] || []
                      const selRunnerId    = festSelected[race.id]
                      const selRunner      = raceRunners.find(r => r.id === selRunnerId)
                      const pickedRunner   = raceRunners.find(r => r.id === pickedRunnerId)
                      return (
                        <div key={race.id} style={{ ...st.raceOuter, ...(isPicked ? st.raceOuterPicked : {}) }}>
                          <button style={st.raceSummaryRow} onClick={() => setFestExpandedRace(prev => prev === race.id ? null : race.id)}>
                            <div style={{ ...st.raceNumCircle, ...(isPicked ? st.raceNumCirclePicked : {}) }}>
                              {race.race_number}
                            </div>
                            <div style={st.raceSummaryInfo}>
                              <div style={st.raceSummaryVenue}>{race.venue}</div>
                              <div style={st.raceSummaryMeta}>{race.race_time}{race.race_name ? ` · ${race.race_name}` : ''}</div>
                            </div>
                            <div style={st.raceSummaryRight}>
                              {isPicked && pickedRunner ? (
                                <span style={st.pickedBadge}>✓ {pickedRunner.horse_name}</span>
                              ) : (
                                <span style={festDayLocked ? st.notPickedText : st.pickPrompt}>
                                  {festDayLocked ? 'No pick' : 'Pick →'}
                                </span>
                              )}
                              <span style={{ ...st.chevron, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
                            </div>
                          </button>
                          {isExpanded && (
                            <div style={st.expandedSection}>
                              {raceRunners.length === 0 ? (
                                <p style={st.noRunners}>No runners added yet — check back soon.</p>
                              ) : (
                                <>
                                  <div style={st.runnerGrid}>
                                    {raceRunners.map(runner => (
                                      <RunnerCard
                                        key={runner.id}
                                        runner={runner}
                                        selected={selRunnerId === runner.id}
                                        showCircle
                                        onClick={() => handleFestSelect(race.id, runner.id)}
                                        disabled={festDayLocked}
                                      />
                                    ))}
                                  </div>
                                  {!festDayLocked && (
                                    <div style={st.saveRow}>
                                      <div style={st.selectedHint}>
                                        {selRunner
                                          ? <><span style={{ color: '#5a8a5a' }}>Selected: </span><strong style={{ color: '#e8f0e8' }}>{selRunner.horse_name}</strong></>
                                          : <span style={{ color: '#5a8a5a', fontStyle: 'italic' }}>Tap a runner to select</span>}
                                      </div>
                                      <button
                                        style={{ ...st.saveBtn, ...(!selRunnerId || festSaving === race.id ? st.saveBtnDisabled : {}) }}
                                        onClick={() => handleFestSavePick(race.id)}
                                        disabled={!selRunnerId || festSaving === race.id}>
                                        {festSaving === race.id ? 'Saving…' : isPicked ? 'Update Pick' : 'Save Pick'}
                                      </button>
                                    </div>
                                  )}
                                  {festDayLocked && isPicked && pickedRunner && (
                                    <div style={st.lockedPickDisplay}>
                                      <span style={{ opacity: 0.6 }}>Your pick:</span>
                                      <strong style={{ color: '#c9a84c', marginLeft: '0.5rem' }}>{pickedRunner.horse_name}</strong>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

      </main>

      {/* Mobile bottom bar */}
      <nav style={st.mobileBar} className="app-mobile-bar">
        <a href="/dashboard" style={st.mobileBarItem}>
          <Home size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={{ ...st.mobileBarItem, ...st.mobileBarItemActive }}>
          <Target size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Picks</span>
          <span style={st.mobileDot} />
        </a>
        <a href="/league" style={st.mobileBarItem}>
          <Trophy size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>League</span>
        </a>
        <a href="/results" style={st.mobileBarItem}>
          <BarChart2 size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Results</span>
        </a>
      </nav>

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────
const st = {
  page: { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '4rem' },
  loadingPage: { minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loadingInner: { textAlign: 'center' },
  loadingLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#c9a84c', letterSpacing: '0.12em', marginBottom: '0.5rem' },
  loadingText: { color: '#5a8a5a', fontSize: '0.9rem' },

  // Nav
  nav: { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  navInner: { maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem', height: '60px', display: 'flex', alignItems: 'center', gap: '2rem' },
  navLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0 },
  navLinks: { display: 'flex', gap: '0.25rem', flex: 1 },
  navLink: { padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: '500', color: '#5a8a5a', textDecoration: 'none' },
  navLinkActive: { color: '#e8f0e8', background: 'rgba(201,168,76,0.1)' },
  navRight: { marginLeft: 'auto', position: 'relative' },

  // Toast
  toast: { position: 'fixed', top: '1.25rem', right: '1.25rem', padding: '0.75rem 1.25rem', borderRadius: '9px', fontSize: '0.875rem', fontWeight: '500', zIndex: 9999, fontFamily: "'DM Sans', sans-serif", boxShadow: '0 8px 32px rgba(0,0,0,0.4)' },
  toastSuccess: { background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.4)', color: '#c9a84c' },
  toastError:   { background: '#0d1f0d', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' },

  // Main
  main: { maxWidth: '700px', margin: '0 auto', padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' },

  // Tab bar
  tabBar: {
    display: 'flex', gap: '0.25rem', flexWrap: 'wrap',
    background: '#0d1f0d', borderRadius: '10px',
    padding: '0.4rem 0.5rem',
    border: '1px solid rgba(201,168,76,0.12)',
  },
  tabBtn: {
    display: 'flex', alignItems: 'center',
    background: 'none', border: 'none',
    borderRadius: '7px', borderBottom: '2px solid transparent',
    padding: '0.45rem 0.9rem',
    fontSize: '0.85rem', fontWeight: '500',
    color: '#5a8a5a', cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
    transition: 'color 0.15s',
  },
  tabBtnActive: {
    color: '#c9a84c',
    background: 'rgba(201,168,76,0.08)',
    borderBottom: '2px solid #c9a84c',
  },

  // Empty / no week
  emptyState: { textAlign: 'center', padding: '4rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' },
  emptyIcon:  { fontSize: '3rem' },
  emptyTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#e8f0e8', letterSpacing: '0.06em' },
  emptySub:   { color: '#5a8a5a', fontSize: '0.9rem', lineHeight: 1.7, maxWidth: '360px' },

  // Buttons
  btnGold: { background: '#c9a84c', color: '#0a1a08', fontWeight: '700', fontSize: '0.875rem', padding: '0.65rem 1.4rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 },

  // Deadline banner
  deadlineBanner: { background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' },
  deadlineLeft:  { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  deadlineLabel: { fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.15rem' },
  deadlineTime:  { fontSize: '0.875rem', color: '#e8f0e8', fontWeight: '500' },
  countdownPill: { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: '8px', padding: '0.5rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '90px' },
  countdownValue: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: '#c9a84c', letterSpacing: '0.06em', lineHeight: 1 },
  countdownLabel: { fontSize: '0.65rem', color: '#5a8a5a', textTransform: 'uppercase', letterSpacing: '0.08em' },

  // Locked banner
  lockedBanner: { background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderLeft: '4px solid #f87171', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.85rem' },
  lockedTitle: { fontWeight: '700', color: '#f87171', fontSize: '0.9rem' },
  lockedSub:   { fontSize: '0.78rem', color: '#5a8a5a', marginTop: '0.1rem' },

  // Progress card
  progressCard: { background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' },
  progressTop:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' },
  progressHeading: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: '#e8f0e8', letterSpacing: '0.04em' },
  congratsMsg: { fontSize: '0.82rem', color: '#5a8a5a', marginTop: '0.2rem' },
  progressBarWrap: { height: '5px', background: 'rgba(0,0,0,0.35)', borderRadius: '999px', overflow: 'hidden' },
  progressFill: { height: '100%', background: 'linear-gradient(90deg, #c9a84c, #e8c96a)', borderRadius: '999px', transition: 'width 0.5s ease' },
  pipRow: { display: 'flex', gap: '0.4rem' },
  pip: { width: '32px', height: '32px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: '700', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(201,168,76,0.15)', color: '#5a8a5a' },
  pipDone: { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.35)', color: '#c9a84c' },

  // Race list
  raceList: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  raceOuter: { background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)', border: '1px solid rgba(201,168,76,0.25)', borderLeft: '4px solid rgba(201,168,76,0.25)', borderRadius: '8px', overflow: 'hidden', transition: 'border-color 0.2s' },
  raceOuterPicked: { borderColor: '#c9a84c', borderLeftColor: '#c9a84c' },
  raceSummaryRow: { display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.9rem 1.1rem', width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', textAlign: 'left' },
  raceNumCircle: { width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', letterSpacing: '0.05em', background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.12)', color: '#5a8a5a' },
  raceNumCirclePicked: { background: 'rgba(201,168,76,0.15)', border: '1.5px solid rgba(201,168,76,0.5)', color: '#c9a84c' },
  raceSummaryInfo: { flex: 1, minWidth: 0 },
  raceSummaryVenue: { fontSize: '0.9rem', fontWeight: '600', color: '#e8f0e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  raceSummaryMeta: { fontSize: '0.75rem', color: '#5a8a5a', marginTop: '0.1rem' },
  raceSummaryRight: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 },
  pickedBadge: { background: 'rgba(201,168,76,0.15)', border: '1.5px solid #c9a84c', color: '#c9a84c', fontSize: '0.75rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '999px', whiteSpace: 'nowrap', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' },
  notPickedText: { fontSize: '0.78rem', color: '#5a8a5a', fontStyle: 'italic', whiteSpace: 'nowrap' },
  pickPrompt:   { fontSize: '0.78rem', color: '#c9a84c', fontWeight: '600', whiteSpace: 'nowrap' },
  chevron: { fontSize: '1.3rem', color: '#5a8a5a', transition: 'transform 0.22s ease', display: 'inline-block', lineHeight: 1, userSelect: 'none' },

  // Expanded section
  expandedSection: { borderTop: '1px solid rgba(201,168,76,0.08)', padding: '1rem 1.1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' },
  noRunners: { color: '#5a8a5a', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0', margin: 0 },
  runnerGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
  saveRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.5rem 0 0' },
  selectedHint: { fontSize: '0.82rem', flex: 1 },
  saveBtn: { background: '#c9a84c', color: '#0a1a08', fontWeight: '700', fontSize: '0.9rem', padding: '0.75rem 1.75rem', borderRadius: '9px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0, boxShadow: '0 4px 16px rgba(201,168,76,0.35)', transition: 'opacity 0.15s' },
  saveBtnDisabled: { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.25)', cursor: 'not-allowed', boxShadow: 'none' },
  lockedPickDisplay: { fontSize: '0.85rem', color: '#5a8a5a', padding: '0.5rem 0', textAlign: 'center' },

  // Festival header card
  festHeader: {
    position: 'relative',
    background: 'linear-gradient(135deg, #1a3512 0%, #0f2a0a 100%)',
    border: '1.5px solid #c9a84c',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  festShimmer: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
    background: 'linear-gradient(90deg, transparent 0%, #c9a84c 30%, #f5d98b 50%, #c9a84c 70%, transparent 100%)',
  },
  festHeaderInner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '1rem', padding: '1rem 1.25rem',
  },
  festHeaderName: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.3rem', color: '#fff',
    letterSpacing: '0.06em', lineHeight: 1,
  },
  festHeaderSub: {
    fontSize: '0.75rem', color: 'rgba(232,240,232,0.55)',
    marginTop: '0.2rem',
  },
  festHeaderPts: { textAlign: 'right', flexShrink: 0 },
  festHeaderPtsNum: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '2rem', color: '#c9a84c', lineHeight: 1,
  },
  festHeaderPtsLabel: {
    fontSize: '0.58rem', fontWeight: '700',
    color: 'rgba(201,168,76,0.6)',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    marginTop: '1px',
  },

  // Day pills
  dayPillRow: {
    display: 'flex', gap: '0.4rem', flexWrap: 'wrap',
  },
  dayPill: {
    display: 'flex', alignItems: 'center',
    borderRadius: '20px', padding: '6px 12px',
    fontSize: '11px', fontWeight: '600',
    cursor: 'pointer', border: '1px solid transparent',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.15s',
    background: 'rgba(255,255,255,0.04)',
    color: '#e8f0e8',
  },
  dayPillActive: {
    border: '1px solid #c9a84c',
    color: '#c9a84c',
    background: 'rgba(201,168,76,0.1)',
  },
  dayPillCompleted: {
    background: 'rgba(74,222,128,0.08)',
    border: '1px solid rgba(74,222,128,0.25)',
    color: '#4ade80',
  },
  dayPillFuture: {
    opacity: 0.4,
  },

  // Mobile bottom bar
  mobileBar: { display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)', padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around' },
  mobileBarItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '0.3rem 0', color: 'rgba(232,220,200,0.4)', textDecoration: 'none', flex: 1 },
  mobileBarItemActive: { color: '#c9a84c' },
  mobileBarLabel: { fontSize: '10px', fontWeight: '500' },
  mobileDot: { width: '4px', height: '4px', borderRadius: '50%', background: '#c9a84c', marginTop: '1px' },
}
