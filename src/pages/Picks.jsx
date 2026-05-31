/**
 * Silks League — Picks Page
 *
 * Lets users make their 5 picks for the current race week.
 * Loads race week, races, runners and existing picks from Supabase.
 * Picks lock automatically once the picks_deadline passes.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ProfileDropdown from '../components/ProfileDropdown.jsx'

// ── Helpers ───────────────────────────────────────────────────
function getUpcomingSaturday() {
  const now  = new Date()
  const day  = now.getDay()                        // 0 Sun … 6 Sat
  const diff = day === 6 ? 0 : (6 - day)
  const sat  = new Date(now)
  sat.setDate(now.getDate() + diff)
  return sat.toISOString().split('T')[0]           // YYYY-MM-DD
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

// ─────────────────────────────────────────────────────────────

export default function Picks() {
  const navigate = useNavigate()

  const [user,         setUser]         = useState(null)
  const [isAdmin,      setIsAdmin]      = useState(false)
  const [menuOpen,     setMenuOpen]     = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [noWeek,       setNoWeek]       = useState(false)
  const [currentWeek,  setCurrentWeek]  = useState(null)
  const [races,        setRaces]        = useState([])
  const [runners,      setRunners]      = useState({})   // { [raceId]: runner[] }
  const [userPicks,    setUserPicks]    = useState({})   // { [raceId]: pick row }
  const [expandedRace, setExpandedRace] = useState(null) // raceId | null
  const [selected,     setSelected]     = useState({})   // { [raceId]: runnerId }
  const [saving,       setSaving]       = useState(null) // raceId | null
  const [toast,        setToast]        = useState(null) // { text, type }
  const [now,          setNow]          = useState(new Date())

  // Tick every second for live countdown
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
  }

  async function loadData(u) {
    setLoading(true)

    // ── Active season ──
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) { setNoWeek(true); setLoading(false); return }

    // ── Race week — prefer this Saturday, fall back to most recent ──
    const satDate = getUpcomingSaturday()
    const { data: weeks } = await supabase
      .from('race_weeks').select('*')
      .eq('season_id', season.id)
      .order('saturday_date', { ascending: false })
      .limit(5)

    const week =
      weeks?.find(w => w.saturday_date === satDate) || weeks?.[0] || null

    if (!week) { setNoWeek(true); setLoading(false); return }
    setCurrentWeek(week)

    // ── Races ──
    const { data: raceData } = await supabase
      .from('races').select('*')
      .eq('race_week_id', week.id)
      .order('race_number')
    setRaces(raceData || [])

    if (!raceData?.length) { setLoading(false); return }

    // ── Runners (ordered by horse_number) ──
    const runnersMap = {}
    for (const race of raceData) {
      const { data: r } = await supabase
        .from('runners').select('*')
        .eq('race_id', race.id)
        .order('horse_number', { ascending: true })
      runnersMap[race.id] = r || []
    }
    setRunners(runnersMap)

    // ── User picks ──
    const raceIds = raceData.map(r => r.id)
    const { data: picks } = await supabase
      .from('picks').select('*')
      .eq('user_id', u.id)
      .in('race_id', raceIds)

    const picksMap = {}
    const selMap   = {}
    for (const p of (picks || [])) {
      picksMap[p.race_id] = p
      selMap[p.race_id]   = p.runner_id
    }
    setUserPicks(picksMap)
    setSelected(selMap)

    setLoading(false)
  }

  // ── Deadline / lock state ─────────────────────────────────────
  const deadline    = currentWeek?.picks_deadline ? new Date(currentWeek.picks_deadline) : null
  const isLocked    = deadline ? now >= deadline : false
  const msRemaining = deadline ? deadline - now : 0
  const countdown   = formatCountdown(msRemaining)

  // ── Progress ──────────────────────────────────────────────────
  const pickedCount = Object.keys(userPicks).length
  const allPicked   = races.length > 0 && pickedCount === races.length

  // ── Helpers ───────────────────────────────────────────────────
  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 2800)
  }

  function handleExpand(raceId) {
    setExpandedRace(prev => (prev === raceId ? null : raceId))
  }

  function handleSelect(raceId, runnerId) {
    if (isLocked) return
    // Don't allow selecting a withdrawn horse
    const raceRunners = runners[raceId] || []
    const runner = raceRunners.find(r => r.id === runnerId)
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
      // Update existing pick
      const res = await supabase
        .from('picks').update({ runner_id: runnerId }).eq('id', existing.id)
      error = res.error
    } else {
      // Insert new pick
      const res = await supabase
        .from('picks').insert({ user_id: user.id, race_id: raceId, runner_id: runnerId })
      error = res.error
    }

    setSaving(null)
    if (error) { showToast('Failed to save — ' + error.message, 'error'); return }

    setUserPicks(prev => ({
      ...prev,
      [raceId]: { ...(existing || {}), user_id: user.id, race_id: raceId, runner_id: runnerId },
    }))
    showToast(existing ? 'Pick updated!' : 'Pick saved!')
    setExpandedRace(null)
  }

  // ── Nav helpers ───────────────────────────────────────────────
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  const getFirstName = () => {
    const fullName = user?.user_metadata?.full_name || user?.email || ''
    return fullName.split(' ')[0] || '?'
  }

  // ── Loading screen ────────────────────────────────────────────
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

      {/* ── Nav ── */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>

          <div style={st.navLinks} className="app-nav-links">
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={{ ...st.navLink, ...st.navLinkActive }}>My Picks</a>
            <a href="/league"    style={st.navLink}>League</a>
            <a href="/races"     style={st.navLink}>Races</a>
            <a href="/results"   style={st.navLink}>Results</a>
            <a href="/groups"    style={st.navLink}>Groups</a>
            {isAdmin && (
              <a href="/admin" style={{ ...st.navLink, color: '#c9a84c' }}>Admin</a>
            )}
          </div>

          <div style={st.navRight}>
            <ProfileDropdown user={user} isAdmin={isAdmin} />
          </div>
        </div>
      </nav>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ ...st.toast, ...(toast.type === 'error' ? st.toastError : st.toastSuccess) }}>
          {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}
        </div>
      )}

      <main style={st.main} className="app-main-pad">

        {/* ── No week yet ── */}
        {noWeek && (
          <div style={st.emptyState}>
            <div style={st.emptyIcon}>🏇</div>
            <div style={st.emptyTitle}>Picks Not Open Yet</div>
            <div style={st.emptySub}>
              No race week has been set up for this Saturday yet.<br />
              Check back on Friday — picks will open once the races are confirmed.
            </div>
            <button style={st.btnGold} onClick={() => navigate('/dashboard')}>
              ← Back to Dashboard
            </button>
          </div>
        )}

        {currentWeek && (
          <>
            {/* ── Deadline banner ── */}
            {isLocked ? (
              <div style={st.lockedBanner}>
                <span style={{ fontSize: '1.4rem' }}>🔒</span>
                <div>
                  <div style={st.lockedTitle}>Picks Locked</div>
                  <div style={st.lockedSub}>
                    Locked at {deadline?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {currentWeek.saturday_date}
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
                      {deadline?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} on Saturday {currentWeek.saturday_date}
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

            {/* ── Progress card ── */}
            <div style={st.progressCard}>
              <div style={st.progressTop}>
                <div>
                  <div style={st.progressHeading}>
                    {allPicked
                      ? '🎉 All picks made!'
                      : `${pickedCount} of ${races.length} picked`}
                  </div>
                  {allPicked && (
                    <div style={st.congratsMsg}>
                      Your picks are in for Week {currentWeek.week_number}. Good luck!
                    </div>
                  )}
                </div>
                {allPicked && (
                  <button style={st.btnGold} onClick={() => navigate('/dashboard')}>
                    View Leaderboard →
                  </button>
                )}
              </div>
              <div style={st.progressBarWrap}>
                <div style={{
                  ...st.progressFill,
                  width: races.length ? `${(pickedCount / races.length) * 100}%` : '0%',
                }} />
              </div>
              {/* Pip indicators */}
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

            {/* ── Race rows ── */}
            <div style={st.raceList}>
              {races.map(race => {
                const pick          = userPicks[race.id]
                const isPicked      = !!pick
                const isExpanded    = expandedRace === race.id
                const raceRunners   = runners[race.id] || []
                const selRunnerId   = selected[race.id]
                const selRunner     = raceRunners.find(r => r.id === selRunnerId)
                const pickedRunner  = raceRunners.find(r => r.id === pick?.runner_id)

                return (
                  <div key={race.id}
                    style={{ ...st.raceOuter, ...(isPicked ? st.raceOuterPicked : {}) }}>

                    {/* ── Collapsed summary row ── */}
                    <button style={st.raceSummaryRow} onClick={() => handleExpand(race.id)}>

                      {/* Race number circle */}
                      <div style={{ ...st.raceNumCircle, ...(isPicked ? st.raceNumCirclePicked : {}) }}>
                        {race.race_number}
                      </div>

                      {/* Venue + time */}
                      <div style={st.raceSummaryInfo}>
                        <div style={st.raceSummaryVenue}>{race.venue}</div>
                        <div style={st.raceSummaryMeta}>{race.race_time} · {race.race_name}</div>
                      </div>

                      {/* Pick status + chevron */}
                      <div style={st.raceSummaryRight}>
                        {isPicked && pickedRunner ? (
                          pickedRunner.is_withdrawn ? (
                            <span style={{ ...st.pickedBadge, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                              ⚠ Withdrawn
                            </span>
                          ) : (
                            <span style={st.pickedBadge}>✓ {pickedRunner.horse_name}</span>
                          )
                        ) : (
                          <span style={st.notPickedText}>
                            {isLocked ? 'No pick' : 'Not picked yet'}
                          </span>
                        )}
                        <span style={{
                          ...st.chevron,
                          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        }}>›</span>
                      </div>
                    </button>

                    {/* ── Expanded runner cards ── */}
                    {isExpanded && (
                      <div style={st.expandedSection}>

                        {/* Withdrawn pick warning */}
                        {pickedRunner?.is_withdrawn && (
                          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.85rem', color: '#f87171', lineHeight: 1.5 }}>
                            <strong>⚠ Your pick ({pickedRunner.horse_name}) has been withdrawn.</strong>
                            <div style={{ marginTop: '0.25rem', color: '#fca5a5', fontSize: '0.8rem' }}>
                              You will automatically receive average points for this race.
                            </div>
                          </div>
                        )}

                        {raceRunners.length === 0 ? (
                          <p style={st.noRunners}>No runners added yet — check back soon.</p>
                        ) : (
                          <>
                            <div style={st.runnerGrid}>
                              {raceRunners.map(runner => {
                                const isSelected  = selRunnerId === runner.id
                                const isWithdrawn = !!runner.is_withdrawn
                                const silkBg      = runner.silk_colour || '#1a3a10'

                                return (
                                  <button
                                    key={runner.id}
                                    disabled={isLocked || isWithdrawn}
                                    onClick={() => handleSelect(race.id, runner.id)}
                                    style={{
                                      ...st.runnerCard,
                                      ...(isSelected  ? st.runnerCardSelected  : {}),
                                      ...(isLocked    ? st.runnerCardLocked    : {}),
                                      ...(isWithdrawn ? st.runnerCardWithdrawn : {}),
                                    }}
                                  >
                                    {/* ── Silk badge ── */}
                                    <div style={{
                                      width: '58px', minWidth: '58px', height: '64px',
                                      borderRadius: '8px', background: silkBg,
                                      display: 'flex', flexDirection: 'column',
                                      alignItems: 'center', justifyContent: 'center',
                                      gap: '2px', padding: '4px 3px 5px',
                                      overflow: 'hidden', flexShrink: 0,
                                      opacity: isWithdrawn ? 0.4 : 1,
                                    }}>
                                      <svg style={{ flex: 1, width: '100%' }} viewBox="0 0 874 874" xmlns="http://www.w3.org/2000/svg">
                                        <g transform="translate(137, 80) scale(0.68)">
                                          <path d="M18.78 847.71 c0 -1.37 1.54 -10.93 3.33 -21.17 1.88 -10.24 6.91 -38.49 11.18 -62.65 4.27 -24.15 9.64 -54.54 11.95 -67.43 2.30 -12.89 6.15 -34.57 8.54 -48.22 2.39 -13.57 6.23 -35.34 8.54 -48.22 4.44 -24.92 14.25 -80.91 25.52 -145.52 3.76 -21.59 8.79 -50.36 11.18 -64.01 13.14 -74.77 23.90 -137.59 23.90 -139.72 0 -1.54 0.60 -2.65 1.96 -3.33 1.88 -1.11 97.90 -64.36 160.89 -106.09 l34.31 -22.70 0 -34.14 0 -34.14 112.24 0 112.24 0 0 33.20 0 33.29 11.35 7.34 c13.06 8.54 34.82 22.62 45.58 29.53 4.18 2.65 20.40 13.06 36.10 23.13 30.47 19.55 94.91 60.77 97.64 62.48 1.28 0.77 2.13 3.50 3.67 11.27 6.91 35.25 57.70 307.78 81.77 438.62 22.70 123.76 26.12 142.62 26.63 148.34 l0.51 5.72 -57.61 0 -57.61 0 -8.19 -27.91 c-11.10 -37.55 -17.84 -60.26 -26.03 -87.31 -3.76 -12.46 -11.18 -36.79 -16.39 -54.20 -24.24 -80.06 -35.34 -115.99 -35.59 -115.05 -0.34 1.11 -7 37.64 -40.71 223.45 l-7.94 43.53 -75.88 0.51 c-41.74 0.26 -117.87 0.85 -169.08 1.19 l-93.29 0.68 0 -2.05 c0 -1.88 -2.48 -18.18 -12.80 -83.99 -9.22 -58.72 -29.28 -182.23 -29.53 -181.97 -0.34 0.34 -20.40 70.42 -30.21 105.58 -4.78 17.16 -11.69 41.91 -15.36 55.05 -9.05 32.18 -17.92 64.27 -27.31 98.15 -4.27 15.53 -7.94 28.85 -8.19 29.70 -0.43 1.37 -4.01 1.45 -58.89 1.45 l-58.38 0 0 -2.39z"
                                            fill={silkBg} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                                          <path d="M330.31 90.13 l0 -28.42 32.18 -0.51 c17.67 -0.34 63.59 -0.60 102 -0.60 l69.82 0 0 28.08 0 28.08 -41.99 0.51 c-23.13 0.26 -69.05 0.68 -102 0.85 l-60 0.43 0 -28.42z"
                                            fill="white" />
                                        </g>
                                      </svg>
                                      {runner.horse_number != null && (
                                        <span style={{ fontSize: '10px', fontWeight: '700', color: 'white', lineHeight: 1 }}>
                                          {runner.horse_number}
                                        </span>
                                      )}
                                    </div>

                                    {/* ── Content ── */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{
                                        fontSize: '15px', fontWeight: '700',
                                        color: isWithdrawn ? '#9ca3af' : '#0d1a08',
                                        lineHeight: 1.2,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        textDecoration: isWithdrawn ? 'line-through' : 'none',
                                      }}>
                                        {runner.horse_name}
                                      </div>
                                      {(runner.jockey || runner.trainer) && (
                                        <div style={{ fontSize: '9px', color: '#666', marginTop: '3px', lineHeight: 1.4 }}>
                                          {[runner.jockey && `J: ${runner.jockey}`, runner.trainer && `T: ${runner.trainer}`].filter(Boolean).join('  ·  ')}
                                        </div>
                                      )}
                                      {!isWithdrawn && runner.form_string && (
                                        <div style={{ fontSize: '9px', color: '#999', marginTop: '2px' }}>
                                          Form: {runner.form_string}
                                        </div>
                                      )}
                                      {isWithdrawn && (
                                        <div style={{ fontSize: '9px', color: '#f87171', marginTop: '3px', fontWeight: '700', letterSpacing: '0.05em' }}>WITHDRAWN</div>
                                      )}
                                      {isSelected && !isWithdrawn && (
                                        <div style={{ marginTop: '5px', display: 'inline-block', background: '#c9a84c', color: '#0a1a08', fontSize: '8px', fontWeight: '800', padding: '2px 7px', borderRadius: '3px', letterSpacing: '0.07em' }}>
                                          MY PICK
                                        </div>
                                      )}
                                    </div>

                                    {/* ── Right: odds + selection circle ── */}
                                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px' }}>
                                      {!isWithdrawn && runner.odds_fractional && (
                                        <div style={{ fontSize: '22px', fontWeight: '700', color: '#c9a84c', fontFamily: 'Georgia, serif', lineHeight: 1, whiteSpace: 'nowrap' }}>
                                          {runner.odds_fractional}
                                        </div>
                                      )}
                                      <div style={{
                                        width: '22px', height: '22px', borderRadius: '50%',
                                        border: `2px solid ${isWithdrawn ? 'rgba(239,68,68,0.3)' : '#c9a84c'}`,
                                        background: isSelected && !isWithdrawn ? '#c9a84c' : 'transparent',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        flexShrink: 0,
                                      }}>
                                        {isSelected && !isWithdrawn && (
                                          <span style={{ fontSize: '11px', fontWeight: '900', color: '#0a1a08', lineHeight: 1 }}>✓</span>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>

                            {/* Save / update row */}
                            {!isLocked && (
                              <div style={st.saveRow}>
                                <div style={st.selectedHint}>
                                  {selRunner
                                    ? <><span style={{ color: '#5a8a5a' }}>Selected: </span><strong style={{ color: '#e8f0e8' }}>{selRunner.horse_name}</strong></>
                                    : <span style={{ color: '#5a8a5a', fontStyle: 'italic' }}>Tap a runner to select</span>
                                  }
                                </div>
                                <button
                                  style={{
                                    ...st.saveBtn,
                                    ...(!selRunnerId || saving === race.id ? st.saveBtnDisabled : {}),
                                  }}
                                  onClick={() => handleSavePick(race.id)}
                                  disabled={!selRunnerId || saving === race.id}
                                >
                                  {saving === race.id
                                    ? 'Saving…'
                                    : isPicked ? 'Update Pick' : 'Save Pick'}
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

      </main>

      {/* ── Mobile bottom bar ── */}
      <nav style={st.mobileBar} className="app-mobile-bar">
        <a href="/dashboard" style={st.mobileBarItem}>
          <span>🏠</span><span style={st.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={{ ...st.mobileBarItem, color: '#c9a84c' }}>
          <span>🎯</span><span style={st.mobileBarLabel}>Picks</span>
        </a>
        <a href="/league" style={st.mobileBarItem}>
          <span>🏆</span><span style={st.mobileBarLabel}>League</span>
        </a>
        <a href="/races" style={st.mobileBarItem}>
          <span>🐴</span><span style={st.mobileBarLabel}>Races</span>
        </a>
        <a href="/results" style={st.mobileBarItem}>
          <span>📊</span><span style={st.mobileBarLabel}>Results</span>
        </a>
        <a href="/groups" style={st.mobileBarItem}>
          <span>👥</span><span style={st.mobileBarLabel}>Groups</span>
        </a>
      </nav>

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────
const st = {
  page: {
    minHeight: '100vh',
    background: '#0a1a08',
    fontFamily: "'DM Sans', sans-serif",
    color: '#e8f0e8',
    paddingBottom: '4rem',
  },

  // Loading
  loadingPage: {
    minHeight: '100vh', background: '#0a1a08',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  loadingInner: { textAlign: 'center' },
  loadingLogo: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem',
    color: '#c9a84c', letterSpacing: '0.12em', marginBottom: '0.5rem',
  },
  loadingText: { color: '#5a8a5a', fontSize: '0.9rem' },

  // Nav
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

  // Toast
  toast: {
    position: 'fixed', top: '1.25rem', right: '1.25rem',
    padding: '0.75rem 1.25rem', borderRadius: '9px',
    fontSize: '0.875rem', fontWeight: '500', zIndex: 9999,
    fontFamily: "'DM Sans', sans-serif", boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  toastSuccess: { background: '#0d1f0d', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' },
  toastError:   { background: '#0d1f0d', border: '1px solid rgba(239,68,68,0.4)',  color: '#f87171' },

  // Main
  main: {
    maxWidth: '700px', margin: '0 auto',
    padding: '1.5rem 1.25rem',
    display: 'flex', flexDirection: 'column', gap: '1rem',
  },

  // Empty / no week
  emptyState: {
    textAlign: 'center', padding: '4rem 2rem',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem',
  },
  emptyIcon:  { fontSize: '3rem' },
  emptyTitle: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem',
    color: '#e8f0e8', letterSpacing: '0.06em',
  },
  emptySub: { color: '#5a8a5a', fontSize: '0.9rem', lineHeight: 1.7, maxWidth: '360px' },

  // Buttons
  btnGold: {
    background: '#c9a84c', color: '#0a1a08', fontWeight: '700',
    fontSize: '0.875rem', padding: '0.65rem 1.4rem', borderRadius: '8px',
    border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap', flexShrink: 0,
  },

  // Deadline banner
  deadlineBanner: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '1rem 1.25rem',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '1rem', flexWrap: 'wrap',
  },
  deadlineLeft:  { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  deadlineLabel: { fontSize: '0.7rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.15rem' },
  deadlineTime:  { fontSize: '0.875rem', color: '#e8f0e8', fontWeight: '500' },
  countdownPill: {
    background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)',
    borderRadius: '8px', padding: '0.5rem 1rem',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    minWidth: '90px',
  },
  countdownValue: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem',
    color: '#c9a84c', letterSpacing: '0.06em', lineHeight: 1,
  },
  countdownLabel: { fontSize: '0.65rem', color: '#5a8a5a', textTransform: 'uppercase', letterSpacing: '0.08em' },

  // Locked banner
  lockedBanner: {
    background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)',
    borderLeft: '4px solid #f87171',
    borderRadius: '8px', padding: '1rem 1.25rem',
    display: 'flex', alignItems: 'center', gap: '0.85rem',
  },
  lockedTitle: { fontWeight: '700', color: '#f87171', fontSize: '0.9rem' },
  lockedSub:   { fontSize: '0.78rem', color: '#5a8a5a', marginTop: '0.1rem' },

  // Progress card
  progressCard: {
    background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '1.25rem 1.5rem',
    display: 'flex', flexDirection: 'column', gap: '0.85rem',
  },
  progressTop: {
    display: 'flex', alignItems: 'flex-start',
    justifyContent: 'space-between', gap: '1rem',
  },
  progressHeading: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem',
    color: '#e8f0e8', letterSpacing: '0.04em',
  },
  congratsMsg: { fontSize: '0.82rem', color: '#5a8a5a', marginTop: '0.2rem' },
  progressBarWrap: {
    height: '5px', background: 'rgba(0,0,0,0.35)',
    borderRadius: '999px', overflow: 'hidden',
  },
  progressFill: {
    height: '100%', background: 'linear-gradient(90deg, #c9a84c, #e8c96a)',
    borderRadius: '999px', transition: 'width 0.5s ease',
  },
  pipRow: { display: 'flex', gap: '0.4rem' },
  pip: {
    width: '32px', height: '32px', borderRadius: '6px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.8rem', fontWeight: '700',
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(201,168,76,0.15)',
    color: '#5a8a5a',
  },
  pipDone: {
    background: 'rgba(74,222,128,0.1)',
    border: '1px solid rgba(74,222,128,0.35)',
    color: '#4ade80',
  },

  // Race list
  raceList: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },

  raceOuter: {
    background: '#162a1a',
    border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', overflow: 'hidden',
    transition: 'border-color 0.2s',
  },
  raceOuterPicked: { borderColor: '#4ade80', borderLeftColor: '#4ade80' },

  raceSummaryRow: {
    display: 'flex', alignItems: 'center', gap: '0.85rem',
    padding: '0.9rem 1.1rem', width: '100%',
    background: 'none', border: 'none', cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif', color: '#e8f0e8",
    textAlign: 'left',
  },

  raceNumCircle: {
    width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', letterSpacing: '0.05em',
    background: 'rgba(255,255,255,0.06)',
    border: '1.5px solid rgba(255,255,255,0.12)',
    color: '#5a8a5a',
  },
  raceNumCirclePicked: {
    background: 'rgba(201,168,76,0.15)',
    border: '1.5px solid rgba(201,168,76,0.5)',
    color: '#c9a84c',
  },

  raceSummaryInfo: { flex: 1, minWidth: 0 },
  raceSummaryVenue: {
    fontSize: '0.9rem', fontWeight: '600', color: '#e8f0e8',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  raceSummaryMeta: { fontSize: '0.75rem', color: '#5a8a5a', marginTop: '0.1rem' },

  raceSummaryRight: {
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    flexShrink: 0,
  },
  pickedBadge: {
    background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
    color: '#4ade80', fontSize: '0.75rem', fontWeight: '600',
    padding: '0.2rem 0.6rem', borderRadius: '999px', whiteSpace: 'nowrap',
    maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  notPickedText: { fontSize: '0.78rem', color: '#5a8a5a', fontStyle: 'italic', whiteSpace: 'nowrap' },
  chevron: {
    fontSize: '1.3rem', color: '#5a8a5a', transition: 'transform 0.22s ease',
    display: 'inline-block', lineHeight: 1, userSelect: 'none',
  },

  // Expanded section
  expandedSection: {
    borderTop: '1px solid rgba(201,168,76,0.08)',
    padding: '1rem 1.1rem 1.1rem',
    display: 'flex', flexDirection: 'column', gap: '0.85rem',
  },
  noRunners: { color: '#5a8a5a', fontSize: '0.875rem', textAlign: 'center', padding: '1.5rem 0', margin: 0 },

  // Runner grid
  runnerGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },

  // Runner card — white card with gold border
  runnerCard: {
    width: '100%', padding: '10px 12px 10px 10px',
    borderRadius: '10px',
    border: '2px solid #c9a84c',
    background: '#ffffff',
    cursor: 'pointer', textAlign: 'left',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.15s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    display: 'flex', alignItems: 'center', gap: '10px',
    outline: 'none',
  },
  runnerCardSelected: {
    background: '#fffdf5',
    border: '2.5px solid #c9a84c',
    boxShadow: '0 3px 14px rgba(201,168,76,0.18)',
  },
  runnerCardLocked: { opacity: 0.7, cursor: 'default' },
  runnerCardWithdrawn: {
    opacity: 0.55, cursor: 'not-allowed',
    border: '2px solid rgba(239,68,68,0.3)',
    background: '#fff8f8',
  },

  // Save row
  saveRow: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', gap: '0.75rem',
    padding: '0.5rem 0 0',
  },
  selectedHint: { fontSize: '0.82rem', flex: 1 },

  saveBtn: {
    background: '#c9a84c', color: '#0a1a08', fontWeight: '700',
    fontSize: '0.9rem', padding: '0.75rem 1.75rem', borderRadius: '9px',
    border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap', flexShrink: 0,
    boxShadow: '0 4px 16px rgba(201,168,76,0.35)',
    transition: 'opacity 0.15s',
  },
  saveBtnDisabled: {
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.25)',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },

  lockedPickDisplay: {
    fontSize: '0.85rem', color: '#5a8a5a',
    padding: '0.5rem 0', textAlign: 'center',
  },

  // Mobile bottom bar
  mobileBar: {
    display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0,
    background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)',
    padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around',
  },
  mobileBarItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
    color: '#5a8a5a', textDecoration: 'none', fontSize: '1.1rem', padding: '0.25rem 0.75rem',
  },
  mobileBarLabel: { fontSize: '0.65rem', fontWeight: '500' },
}
