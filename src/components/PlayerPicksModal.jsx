/**
 * PlayerPicksModal — full-screen modal showing any player's picks.
 * Opened by clicking a player name in the leaderboard or results screen.
 *
 * Props:
 *   userId        string        — target player
 *   viewerUserId  string        — logged-in user's id
 *   displayName   string        — optimistic name shown before profile loads
 *   seasonPoints  number?       — pre-loaded season total (from leaderboard row)
 *   seasonRank    number?       — pre-loaded season rank
 *   festivalId    string|null   — if set, show festival picks instead of Saturday League
 *   festivalName  string|null   — display name for the festival
 *   onClose       fn
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import RunnerCard from './RunnerCard.jsx'

// ── Shared helpers ────────────────────────────────────────────────────────────

function posLabel(p) {
  if (p === 1) return { text: '1st', color: '#c9a84c',  medal: '🥇' }
  if (p === 2) return { text: '2nd', color: '#b0bec5',  medal: '🥈' }
  if (p === 3) return { text: '3rd', color: '#cd9060',  medal: '🥉' }
  return             { text: 'Unplaced', color: '#5a8a5a', medal: null }
}

// ── Saturday League helpers ───────────────────────────────────────────────────

function isWeekRevealed(week) {
  if (!week) return false
  return new Date() >= new Date(week.saturday_date + 'T12:00:00')
}

function findDefaultWeekIndex(weeks) {
  const now = new Date()
  if (now.getDay() === 6 && now.getHours() >= 12) return 0
  for (let i = 0; i < weeks.length; i++) {
    if (now >= new Date(weeks[i].saturday_date + 'T12:00:00')) return i
  }
  return 0
}

function formatWeekLabel(week) {
  if (!week) return ''
  const d = new Date(week.saturday_date + 'T12:00:00')
  const dayStr   = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const monthStr = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  return `Week ${week.week_number} · ${dayStr} · ${monthStr}`
}

// ── Festival helpers ──────────────────────────────────────────────────────────

function isDayRevealed(day) {
  if (!day?.race_date) return false
  return new Date() >= new Date(day.race_date + 'T12:00:00')
}

function findDefaultDayIndex(days) {
  // Most recent revealed day; fall back to first if none revealed yet
  for (let i = days.length - 1; i >= 0; i--) {
    if (isDayRevealed(days[i])) return i
  }
  return 0
}

function dayTabLabel(day) {
  if (!day?.race_date) return `Day ${day.day_number}`
  try {
    return new Date(day.race_date + 'T12:00:00')
      .toLocaleDateString('en-GB', { weekday: 'short' })
      .toUpperCase()
  } catch { return `Day ${day.day_number}` }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function PlayerPicksModal({
  userId,
  viewerUserId,
  displayName,
  seasonPoints,
  seasonRank,
  festivalId   = null,
  festivalName = null,
  onClose,
}) {
  // ── Saturday League state ─────────────────────────────────────
  const [profile,     setProfile]     = useState(null)
  const [weeks,       setWeeks]       = useState([])
  const [weekIndex,   setWeekIndex]   = useState(0)
  const [races,       setRaces]       = useState([])
  const [picks,       setPicks]       = useState({})
  const [scores,      setScores]      = useState({})
  const [hasResults,  setHasResults]  = useState(false)
  const [initLoading, setInitLoading] = useState(false)
  const [weekLoading, setWeekLoading] = useState(false)

  // ── Festival state ────────────────────────────────────────────
  const [festDays,     setFestDays]     = useState([])
  const [dayIndex,     setDayIndex]     = useState(0)
  const [dayRaces,     setDayRaces]     = useState([])   // [{ id, race_number, race_time, race_name, pick, score }]
  const [dayLoading,   setDayLoading]   = useState(false)
  const [dayCache,     setDayCache]     = useState({})   // { dayNumber: raceRows[] }

  const isFestivalMode = !!festivalId

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = userId ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [!!userId])

  // Reload when userId or festivalId changes
  useEffect(() => {
    if (!userId) return
    // Reset all state
    setProfile(null)
    setWeeks([]); setRaces([]); setPicks({}); setScores({}); setHasResults(false)
    setFestDays([]); setDayRaces([]); setDayCache({})

    if (isFestivalMode) {
      loadFestivalInit()
    } else {
      loadSaturdayInit()
    }
  }, [userId, festivalId])

  // ── Saturday League loaders ───────────────────────────────────

  async function loadSaturdayInit() {
    setInitLoading(true)
    try {
      const [{ data: prof }, { data: season }] = await Promise.all([
        supabase.from('profiles').select('id, username, full_name, display_name').eq('id', userId).maybeSingle(),
        supabase.from('seasons').select('id').eq('is_active', true).maybeSingle(),
      ])
      setProfile(prof)
      if (!season) return

      const { data: weeksData } = await supabase
        .from('race_weeks').select('id, week_number, saturday_date')
        .eq('season_id', season.id)
        .order('saturday_date', { ascending: false })
      if (!weeksData?.length) return

      setWeeks(weeksData)
      const idx = findDefaultWeekIndex(weeksData)
      setWeekIndex(idx)
      await loadWeekData(weeksData[idx])
    } finally {
      setInitLoading(false)
    }
  }

  async function loadWeekData(week) {
    if (!week || !userId) return
    setWeekLoading(true)
    setRaces([]); setPicks({}); setScores({}); setHasResults(false)
    try {
      const { data: racesData } = await supabase
        .from('races').select('id, race_number, race_time, venue, race_name')
        .eq('race_week_id', week.id).order('race_number')
      if (!racesData?.length) return
      setRaces(racesData)

      const raceIds = racesData.map(r => r.id)

      const { data: picksData } = await supabase
        .from('picks').select('race_id, runner_id, was_replaced')
        .eq('user_id', userId).in('race_id', raceIds)
      if (picksData?.length) {
        const runnerIds = [...new Set(picksData.map(p => p.runner_id).filter(Boolean))]
        const { data: runnersData } = await supabase
          .from('runners').select('id, horse_name, silk_colour, silk_colour_secondary, horse_number, odds_fractional')
          .in('id', runnerIds)
        const runnerMap = {}
        runnersData?.forEach(r => { runnerMap[r.id] = r })
        const pm = {}
        picksData.forEach(p => {
          if (p.runner_id && runnerMap[p.runner_id]) {
            pm[p.race_id] = { ...runnerMap[p.runner_id], was_replaced: p.was_replaced }
          }
        })
        setPicks(pm)
      }

      const { data: scoresData } = await supabase
        .from('scores').select('race_id, base_points, bonus_points, total_points, position_achieved')
        .eq('user_id', userId).in('race_id', raceIds)
      const sm = {}
      scoresData?.forEach(s => { sm[s.race_id] = s })
      setScores(sm)
      setHasResults((scoresData?.length ?? 0) > 0)
    } finally {
      setWeekLoading(false)
    }
  }

  async function goToWeek(newIdx) {
    if (newIdx < 0 || newIdx >= weeks.length) return
    setWeekIndex(newIdx)
    await loadWeekData(weeks[newIdx])
  }

  // ── Festival loaders ──────────────────────────────────────────

  async function loadFestivalInit() {
    setInitLoading(true)
    try {
      const [{ data: prof }, { data: daysData }] = await Promise.all([
        supabase.from('profiles').select('id, username, full_name, display_name').eq('id', userId).maybeSingle(),
        supabase.from('festival_days').select('id, day_number, race_date')
          .eq('festival_id', festivalId).order('day_number'),
      ])
      setProfile(prof)
      if (!daysData?.length) return

      setFestDays(daysData)
      const idx = findDefaultDayIndex(daysData)
      setDayIndex(idx)
      // Only load if day is revealed
      if (isDayRevealed(daysData[idx])) {
        await loadDayData(daysData[idx])
      }
    } finally {
      setInitLoading(false)
    }
  }

  async function loadDayData(day) {
    if (!day || !userId) return
    // Use cache
    if (dayCache[day.day_number]) {
      setDayRaces(dayCache[day.day_number])
      return
    }
    setDayLoading(true)
    try {
      const { data: racesData } = await supabase
        .from('festival_races').select('id, race_number, race_time, race_name')
        .eq('festival_day_id', day.id).order('race_number')
      if (!racesData?.length) {
        setDayRaces([])
        setDayCache(p => ({ ...p, [day.day_number]: [] }))
        return
      }

      const raceIds = racesData.map(r => r.id)

      // Picks for this user on these races
      const { data: picksData } = await supabase
        .from('festival_picks').select('festival_race_id, runner_id, was_replaced')
        .eq('user_id', userId).in('festival_race_id', raceIds)

      // Runner names
      const runnerIds = [...new Set((picksData || []).map(p => p.runner_id).filter(Boolean))]
      const nameMap = {}
      if (runnerIds.length) {
        const { data: runners } = await supabase
          .from('festival_runners').select('id, horse_name').in('id', runnerIds)
        runners?.forEach(r => { nameMap[r.id] = r.horse_name })
      }

      // Scores
      const { data: scoresData } = await supabase
        .from('festival_scores').select('festival_race_id, base_points, bonus_points, total_points, position_achieved')
        .eq('user_id', userId).in('festival_race_id', raceIds)
      const scoreMap = {}
      scoresData?.forEach(s => { scoreMap[s.festival_race_id] = s })

      const pickMap = {}
      ;(picksData || []).forEach(p => {
        pickMap[p.festival_race_id] = { horseName: nameMap[p.runner_id] || null, was_replaced: p.was_replaced }
      })

      const rows = racesData.map(race => ({
        id:          race.id,
        number:      race.race_number,
        time:        race.race_time,
        name:        race.race_name,
        pick:        pickMap[race.id] || null,
        score:       scoreMap[race.id] || null,
      }))

      setDayRaces(rows)
      setDayCache(p => ({ ...p, [day.day_number]: rows }))
    } finally {
      setDayLoading(false)
    }
  }

  async function goToDay(newIdx) {
    if (newIdx < 0 || newIdx >= festDays.length) return
    setDayIndex(newIdx)
    const day = festDays[newIdx]
    if (isDayRevealed(day)) {
      await loadDayData(day)
    } else {
      setDayRaces([])
    }
  }

  // ── Render guard ──────────────────────────────────────────────
  if (!userId) return null

  const name = profile?.username || profile?.display_name || profile?.full_name || displayName || 'Player'

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.sheet} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={m.header}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={m.playerName}>{name}</div>
            {isFestivalMode ? (
              festivalName && (
                <div style={m.pills}>
                  <span style={m.pill}>👑 {festivalName}</span>
                  {seasonPoints != null && <span style={m.pill}>{seasonPoints} pts</span>}
                  {seasonRank   != null && <span style={m.pill}>#{seasonRank} ranked</span>}
                </div>
              )
            ) : (
              (seasonPoints != null || seasonRank != null) && (
                <div style={m.pills}>
                  {seasonPoints != null && <span style={m.pill}>{seasonPoints} pts this season</span>}
                  {seasonRank   != null && <span style={m.pill}>#{seasonRank} ranked</span>}
                </div>
              )
            )}
          </div>
          <button style={m.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ════════════════════════════════════════════════════════
            FESTIVAL MODE
            ════════════════════════════════════════════════════ */}
        {isFestivalMode ? (
          <>
            {/* Day tabs */}
            {festDays.length > 0 && (
              <div style={m.dayTabRow}>
                {festDays.map((day, idx) => (
                  <button
                    key={day.day_number}
                    style={{ ...m.dayTab, ...(idx === dayIndex ? m.dayTabActive : {}) }}
                    onClick={() => goToDay(idx)}>
                    {dayTabLabel(day)}
                  </button>
                ))}
              </div>
            )}

            {/* Day body */}
            <div style={m.content}>
              {initLoading ? (
                <div style={m.centreMsg}>Loading picks…</div>
              ) : festDays.length === 0 ? (
                <div style={m.centreMsg}>No race days found for this festival.</div>
              ) : !isDayRevealed(festDays[dayIndex]) ? (
                <div style={m.lockedBox}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔒</div>
                  <div style={m.lockedTitle}>Picks not yet revealed</div>
                  <div style={m.lockedSub}>Picks are locked at 12pm — come back then.</div>
                </div>
              ) : dayLoading ? (
                <div style={m.centreMsg}>Loading…</div>
              ) : dayRaces.length === 0 ? (
                <div style={m.centreMsg}>No races set up for this day yet.</div>
              ) : (
                <>
                  {dayRaces.map(race => {
                    const pick  = race.pick
                    const score = race.score
                    const pl    = score?.position_achieved ? posLabel(score.position_achieved) : null
                    const hasScore = !!score

                    return (
                      <div key={race.id} style={m.raceCard}>
                        {/* Race header */}
                        <div style={m.raceHead}>
                          <div style={m.raceNumBadge}>{race.number}</div>
                          <div style={m.raceInfo}>
                            <span style={m.raceVenue}>{race.name || `Race ${race.number}`}</span>
                            {race.time && <span style={m.raceMeta}>{race.time}</span>}
                          </div>
                          <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                            {score ? (
                              <span style={m.ptsChip}>{score.total_points} pts</span>
                            ) : null}
                          </div>
                        </div>

                        {/* Pick */}
                        <div style={m.pickBody}>
                          {!pick ? (
                            <div style={m.noPick}>No pick made</div>
                          ) : (
                            <div style={m.festPickRow}>
                              <div style={m.festHorseChip}>
                                {pick.horseName || '—'}
                                {pick.was_replaced && (
                                  <span style={m.replacedTag}>replaced</span>
                                )}
                              </div>
                              {hasScore && (
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                  {pl ? (
                                    <>
                                      <div style={{ fontSize: '0.85rem', fontWeight: '700', color: pl.color }}>
                                        {pl.medal && <span style={{ marginRight: '0.2rem' }}>{pl.medal}</span>}
                                        {pl.text}
                                      </div>
                                      <div style={{ fontSize: '0.75rem', color: '#c9a84c', marginTop: '2px', fontWeight: '600' }}>
                                        {score.total_points} pts
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#5a8a5a' }}>Unplaced</div>
                                      <div style={{ fontSize: '0.75rem', color: '#5a8a5a', marginTop: '2px' }}>0 pts</div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Day total */}
                  {dayRaces.some(r => r.score) && (
                    <div style={m.totalRow}>
                      <span style={m.totalLabel}>Day total</span>
                      <span style={m.totalPts}>
                        {dayRaces.reduce((s, r) => s + (r.score?.total_points || 0), 0)} pts
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          /* ════════════════════════════════════════════════════════
             SATURDAY LEAGUE MODE  (unchanged)
             ════════════════════════════════════════════════════ */
          <>
            {/* Week navigator */}
            {weeks.length > 0 && (
              <div style={m.weekNav}>
                <button
                  style={{ ...m.navArrow, ...(weekIndex >= weeks.length - 1 ? m.navArrowOff : {}) }}
                  onClick={() => goToWeek(weekIndex + 1)}
                  disabled={weekIndex >= weeks.length - 1}
                >←</button>
                <div style={m.weekNavLabel}>
                  {weekLoading ? '…' : formatWeekLabel(weeks[weekIndex])}
                </div>
                <button
                  style={{ ...m.navArrow, ...(weekIndex <= 0 ? m.navArrowOff : {}) }}
                  onClick={() => goToWeek(weekIndex - 1)}
                  disabled={weekIndex <= 0}
                >→</button>
              </div>
            )}

            {/* Body */}
            <div style={m.content}>
              {initLoading ? (
                <div style={m.centreMsg}>Loading picks…</div>
              ) : !weeks[weekIndex] ? (
                <div style={m.centreMsg}>No race weeks found.</div>
              ) : !isWeekRevealed(weeks[weekIndex]) ? (
                <div style={m.lockedBox}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔒</div>
                  <div style={m.lockedTitle}>Picks not yet revealed</div>
                  <div style={m.lockedSub}>Picks are locked at 12pm on Saturday — come back then.</div>
                </div>
              ) : weekLoading ? (
                <div style={m.centreMsg}>Loading…</div>
              ) : races.length === 0 ? (
                <div style={m.centreMsg}>No races set up for this week yet.</div>
              ) : (
                <>
                  {races.map(race => {
                    const pick  = picks[race.id]
                    const score = scores[race.id]
                    const pl    = score?.position_achieved ? posLabel(score.position_achieved) : null

                    return (
                      <div key={race.id} style={m.raceCard}>
                        <div style={m.raceHead}>
                          <div style={m.raceNumBadge}>{race.race_number}</div>
                          <div style={m.raceInfo}>
                            <span style={m.raceVenue}>{race.venue}</span>
                            <span style={m.raceMeta}>
                              {race.race_time}{race.race_name ? ` · ${race.race_name}` : ''}
                            </span>
                          </div>
                          <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                            {score ? (
                              <span style={m.ptsChip}>{score.total_points} pts</span>
                            ) : hasResults ? (
                              <span style={m.pendingChip}>0 pts</span>
                            ) : null}
                          </div>
                        </div>

                        <div style={m.pickBody}>
                          {pick ? (
                            <RunnerCard
                              runner={pick}
                              rightContent={
                                !hasResults ? undefined : (
                                  <div style={{ textAlign: 'right' }}>
                                    {pick.odds_fractional && (
                                      <div style={{ fontSize: '0.7rem', color: 'rgba(201,168,76,0.55)', marginBottom: '4px', whiteSpace: 'nowrap' }}>
                                        {pick.odds_fractional}
                                      </div>
                                    )}
                                    {pl ? (
                                      <>
                                        <div style={{ fontSize: '0.85rem', fontWeight: '700', color: pl.color }}>
                                          {pl.medal && <span style={{ marginRight: '0.2rem' }}>{pl.medal}</span>}
                                          {pl.text}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: '#c9a84c', marginTop: '2px', fontWeight: '600' }}>
                                          {score.total_points} pts
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#5a8a5a' }}>Unplaced</div>
                                        <div style={{ fontSize: '0.75rem', color: '#5a8a5a', marginTop: '2px' }}>0 pts</div>
                                      </>
                                    )}
                                  </div>
                                )
                              }
                            />
                          ) : (
                            <div style={m.noPick}>No pick</div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {hasResults && (
                    <div style={m.totalRow}>
                      <span style={m.totalLabel}>Week total</span>
                      <span style={m.totalPts}>
                        {Object.values(scores).reduce((s, sc) => s + (sc?.total_points || 0), 0)} pts
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const m = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10001,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '1rem', overflowY: 'auto',
  },
  sheet: {
    width: '100%', maxWidth: '620px',
    background: '#0a1a08',
    border: '1px solid rgba(201,168,76,0.25)',
    borderRadius: '16px',
    marginTop: '2rem', marginBottom: '2rem',
    fontFamily: "'DM Sans', sans-serif",
    overflow: 'hidden', flexShrink: 0,
  },

  // Header
  header: {
    display: 'flex', alignItems: 'flex-start', gap: '1rem',
    padding: '1.5rem 1.5rem 1.25rem',
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    borderBottom: '1px solid rgba(201,168,76,0.12)',
  },
  playerName: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '2rem', color: '#c9a84c', letterSpacing: '0.06em', lineHeight: 1,
    marginBottom: '0.45rem',
  },
  pills: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  pill: {
    fontSize: '0.72rem', fontWeight: '600',
    background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)',
    color: '#c9a84c', borderRadius: '999px', padding: '0.2rem 0.6rem',
  },
  closeBtn: {
    background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)',
    color: '#c9a84c', fontSize: '1rem', borderRadius: '8px',
    width: '34px', height: '34px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'DM Sans', sans-serif", flexShrink: 0, lineHeight: 1,
  },

  // Festival day tabs
  dayTabRow: {
    display: 'flex', gap: '0.4rem', padding: '0.75rem 1.25rem',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
    background: 'rgba(0,0,0,0.2)', overflowX: 'auto', scrollbarWidth: 'none',
  },
  dayTab: {
    padding: '0.35rem 0.9rem', borderRadius: '6px',
    border: '1px solid rgba(201,168,76,0.2)',
    background: 'rgba(201,168,76,0.05)', color: '#5a8a5a',
    fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.04em',
    fontFamily: "'DM Sans', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap',
  },
  dayTabActive: { background: '#c9a84c', color: '#0a1a08', border: '1px solid #c9a84c' },

  // Week navigator (Saturday League)
  weekNav: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.8rem 1.5rem',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
    background: 'rgba(0,0,0,0.2)',
  },
  navArrow: {
    background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.18)',
    color: '#c9a84c', borderRadius: '7px', width: '32px', height: '32px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontSize: '1rem', fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
  },
  navArrowOff: { opacity: 0.25, cursor: 'not-allowed' },
  weekNavLabel: {
    flex: 1, textAlign: 'center', fontSize: '0.8rem', fontWeight: '600',
    color: '#e8f0e8', letterSpacing: '0.01em',
  },

  // Content
  content: {
    padding: '1rem 1.25rem 1.5rem',
    display: 'flex', flexDirection: 'column', gap: '0.6rem',
  },
  centreMsg: {
    textAlign: 'center', color: '#5a8a5a', padding: '2.5rem 1rem', fontSize: '0.9rem',
  },

  // Locked state
  lockedBox: {
    textAlign: 'center', padding: '2.5rem 1.5rem',
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    border: '1px solid rgba(201,168,76,0.15)', borderRadius: '10px',
  },
  lockedTitle: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem',
    color: '#c9a84c', letterSpacing: '0.05em', marginBottom: '0.3rem',
  },
  lockedSub: { fontSize: '0.85rem', color: '#5a8a5a' },

  // Race cards
  raceCard: {
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '10px', overflow: 'hidden',
  },
  raceHead: {
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.6rem 0.9rem',
    borderBottom: '1px solid rgba(201,168,76,0.08)',
  },
  raceNumBadge: {
    width: '27px', height: '27px', borderRadius: '50%', flexShrink: 0,
    background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '0.9rem',
    color: '#c9a84c', letterSpacing: '0.03em',
  },
  raceInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 },
  raceVenue: { fontSize: '0.875rem', fontWeight: '600', color: '#e8f0e8' },
  raceMeta:  { fontSize: '0.72rem', color: '#5a8a5a' },
  ptsChip: {
    background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)',
    color: '#c9a84c', borderRadius: '999px', padding: '0.15rem 0.6rem',
    fontSize: '0.75rem', fontWeight: '700',
  },
  pendingChip: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    color: '#5a8a5a', borderRadius: '999px', padding: '0.15rem 0.6rem', fontSize: '0.75rem',
  },
  pickBody: { padding: '8px 10px' },
  noPick: {
    padding: '0.65rem 1rem', fontSize: '0.85rem',
    color: '#5a8a5a', fontStyle: 'italic',
  },

  // Festival pick row
  festPickRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
    padding: '0.35rem 0.25rem',
  },
  festHorseChip: {
    fontSize: '0.9rem', fontWeight: '600', color: '#e8f0e8',
    display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
  },
  replacedTag: {
    fontSize: '0.6rem', fontWeight: '700', letterSpacing: '0.06em',
    textTransform: 'uppercase', color: '#c9a84c',
    background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: '3px', padding: '0.1rem 0.35rem',
  },

  // Total footer
  totalRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.7rem 1.1rem',
    background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '8px', marginTop: '0.2rem',
  },
  totalLabel: {
    fontSize: '0.75rem', fontWeight: '700', color: '#5a8a5a',
    textTransform: 'uppercase', letterSpacing: '0.09em',
  },
  totalPts: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem',
    color: '#c9a84c', letterSpacing: '0.04em', lineHeight: 1,
  },
}
