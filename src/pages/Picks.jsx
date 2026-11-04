/**
 * Silks League — Picks Page
 * Saturday League and festival picks behind one set of competition pills.
 * Loading, saving, joining and deadline logic is unchanged; the layout
 * lives in the components in src/components/picks and src/styles/picks.css.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCompetition } from '../context/competition.js'
import { PICKS_CHANGED } from '../lib/navTabs.js'
import { isWinOnly, canOfferEachWay, calcTokenPoints } from '../lib/scoring.js'
import { daysBetween, localDateStr, lockLabel } from '../lib/format.js'
import {
  runningFestivals, selectedFestival, isDayOpen, defaultFestDay, hasLivePick, firstUnpickedIndex,
} from '../lib/picksView.js'
import CompetitionPills from '../components/picks/CompetitionPills.jsx'
import DaySwitch from '../components/picks/DaySwitch.jsx'
import RaceChips from '../components/picks/RaceChips.jsx'
import RaceHeader from '../components/picks/RaceHeader.jsx'
import RunnerRow from '../components/picks/RunnerRow.jsx'
import JoinCard from '../components/picks/JoinCard.jsx'
import EmptyState from '../components/picks/EmptyState.jsx'
import '../styles/picks.css'

// "If it places" preview always shows the 2nd-place figure (the best-case
// place payout) — exact taper depends on the actual finishing position.
function previewPoints(betType, oddsDecimal, runnerCount) {
  if (!oddsDecimal) return { win: null, place: null }
  const win = calcTokenPoints({ betType, position: 1, oddsDecimal, runnerCount }).totalPoints
  const place = betType === 'each_way'
    ? calcTokenPoints({ betType, position: 2, oddsDecimal, runnerCount }).totalPoints
    : null
  return { win, place }
}

export default function Picks() {
  const navigate = useNavigate()
  const location  = useLocation()
  const { competition, setCompetition } = useCompetition()

  // ── Weekly state ──────────────────────────────────────────────
  const [user,          setUser]          = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [noWeek,        setNoWeek]        = useState(false)
  const [currentWeek,   setCurrentWeek]   = useState(null)
  const [races,         setRaces]         = useState([])
  const [runners,       setRunners]       = useState({})
  const [userPicks,     setUserPicks]     = useState({})
  const [selected,      setSelected]      = useState({})
  const [betType,       setBetType]       = useState({})
  const [saving,        setSaving]        = useState(null)
  const [toast,         setToast]         = useState(null)
  const [now,           setNow]           = useState(new Date())
  const [weekIdx,       setWeekIdx]       = useState(0)

  // ── Festival state ────────────────────────────────────────────
  const [activeFestivals,  setActiveFestivals]  = useState([])
  const [festEntry,        setFestEntry]        = useState(null)
  const [festDays,         setFestDays]         = useState([])
  const [openDayIds,       setOpenDayIds]       = useState([])
  const [festDay,          setFestDay]          = useState(null)
  const [festRaces,        setFestRaces]        = useState([])
  const [festRunners,      setFestRunners]      = useState({})
  const [festPicks,        setFestPicks]        = useState({})
  const [festReplaced,     setFestReplaced]     = useState({})
  const [festSelected,     setFestSelected]     = useState({})
  const [festBetType,      setFestBetType]      = useState({})
  const [festSaving,       setFestSaving]       = useState(null)
  const [festLoading,      setFestLoading]      = useState(false)
  const [festIdx,          setFestIdx]          = useState(0)

  // Which runner's bet panel is open, per race.
  const [openRunner, setOpenRunner] = useState({})
  // Latest festival load; older ones are ignored if the player switches mid-load.
  const festReq = useRef(0)
  // Bet type last saved per festival race, to restore if a save fails.
  const festSavedBet = useRef({})

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/auth'); return }
    setUser(user)
    const { data: fests } = await supabase
      .from('festivals').select('*').eq('is_active', true).order('start_date')
    const running = runningFestivals(fests, localDateStr())
    setActiveFestivals(running)
    // Older links navigate here with { festivalTab } (e.g. a festival banner).
    const requestedTab = location.state?.festivalTab
    if (requestedTab && running.some(f => f.id === requestedTab)) setCompetition('festival', requestedTab)
    await loadData(user)
  }

  // The festival being looked at (null = Saturday League). A group id or a
  // festival that has finished shows the Saturday League without changing the
  // saved selection, so a Leaderboard group choice survives a visit here.
  const selFest = selectedFestival(competition, activeFestivals)
  const selFestId = selFest?.id ?? null

  useEffect(() => {
    if (!selFestId || !user) return
    setFestEntry(null); setFestDays([]); setOpenDayIds([]); setFestDay(null)
    setFestRaces([]); setFestRunners({}); setFestPicks({}); setFestReplaced({})
    setFestSelected({}); setFestBetType({}); setFestIdx(0)
    loadFestivalData(activeFestivals.find(f => f.id === selFestId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selFestId, user])

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

    const openWeek = weeks?.find(w => {
      const dl = w.picks_deadline ? new Date(w.picks_deadline) : new Date(w.saturday_date + 'T12:00:00')
      return nowDate < dl
    })
    const week = openWeek || (weeks?.length ? weeks[weeks.length - 1] : null)

    if (!week) { setNoWeek(true); setLoading(false); return }
    // Same rule as Home: no open week and the latest one is over two weeks old.
    if (!openWeek && daysBetween(week.saturday_date, localDateStr()) > 14) { setNoWeek(true); setLoading(false); return }
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
    const betMap   = {}
    for (const p of (picks || [])) {
      picksMap[p.race_id] = p
      selMap[p.race_id]   = p.runner_id
      betMap[p.race_id]   = p.bet_type || 'win'
    }
    setUserPicks(picksMap)
    setSelected(selMap)
    setBetType(betMap)
    setWeekIdx(firstUnpickedIndex(raceData, id => hasLivePick(picksMap[id]?.runner_id, runnersMap[id] || [])))
    setLoading(false)
  }

  // ── Festival loaders ──────────────────────────────────────────
  async function loadFestivalData(fest) {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) return
    const token = ++festReq.current
    const stale = () => token !== festReq.current
    setFestLoading(true)
    try {
      const { data: entryData } = await supabase
        .from('festival_entries').select('*')
        .eq('festival_id', fest.id).eq('user_id', u.id).maybeSingle()
      if (stale()) return
      setFestEntry(entryData || null)

      const { data: daysData } = await supabase
        .from('festival_days').select('*').eq('festival_id', fest.id).order('day_number')
      if (stale()) return
      setFestDays(daysData || [])

      if (daysData?.length) {
        // Days that still take picks: deadline not passed and races loaded.
        const { data: dayRaces } = await supabase
          .from('festival_races').select('festival_day_id').in('festival_day_id', daysData.map(d => d.id))
        if (stale()) return
        const withRaces = new Set((dayRaces || []).map(r => r.festival_day_id))
        const today = localDateStr()
        const nowMs = Date.now()
        const open = daysData.filter(d => withRaces.has(d.id) && isDayOpen(d, nowMs, today))
        setOpenDayIds(open.map(d => d.id))
        const currentDay = defaultFestDay(daysData, open, today)
        setFestDay(currentDay)
        // Races are readable by every signed-in player, so non-members see them too.
        await loadFestDayData(currentDay, u.id, token)
      }
    } finally {
      if (!stale()) setFestLoading(false)
    }
  }

  async function loadFestDayData(day, userId, token) {
    if (!day || !userId) return
    const stale = () => token !== festReq.current
    const { data: racesData } = await supabase
      .from('festival_races').select('*').eq('festival_day_id', day.id).order('race_number')
    if (stale()) return
    setFestRaces(racesData || [])
    if (!racesData?.length) return

    const raceIds = racesData.map(r => r.id)
    const runnersMap = {}
    for (const race of racesData) {
      const { data: rData } = await supabase
        .from('festival_runners').select('*').eq('festival_race_id', race.id).order('horse_number')
      runnersMap[race.id] = rData || []
    }
    if (stale()) return
    setFestRunners(runnersMap)

    const { data: picksData } = await supabase
      .from('festival_picks').select('festival_race_id, runner_id, bet_type, was_replaced, original_runner_id')
      .eq('user_id', userId).in('festival_race_id', raceIds)
    if (stale()) return
    const picksMap = {}
    const betMap   = {}
    const replacedMap = {}
    picksData?.forEach(p => {
      picksMap[p.festival_race_id] = p.runner_id
      betMap[p.festival_race_id] = p.bet_type || 'win'
      replacedMap[p.festival_race_id] = !!p.was_replaced
    })
    setFestPicks(picksMap)
    setFestSelected(picksMap)
    setFestBetType(betMap)
    festSavedBet.current = betMap
    setFestReplaced(replacedMap)
    setFestIdx(firstUnpickedIndex(racesData, id => hasLivePick(picksMap[id], runnersMap[id] || [])))
  }

  async function handleFestDaySwitch(day) {
    if (day.id === festDay?.id) return
    const token = ++festReq.current
    setFestDay(day)
    setFestRaces([]); setFestRunners({}); setFestPicks({}); setFestReplaced({})
    setFestSelected({}); setFestBetType({}); setFestIdx(0)
    const { data: { user: u } } = await supabase.auth.getUser()
    if (u) await loadFestDayData(day, u.id, token)
  }

  // ── Computed ──────────────────────────────────────────────────
  const deadline     = currentWeek?.picks_deadline ? new Date(currentWeek.picks_deadline) : null
  const isLocked     = deadline ? now >= deadline : false
  const festDayLocked = !!(festDay?.picks_deadline && now >= new Date(festDay.picks_deadline))

  // ── Handlers ──────────────────────────────────────────────────
  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 2800)
  }

  function closePanel(raceId) {
    setOpenRunner(prev => ({ ...prev, [raceId]: null }))
  }

  function handleSelect(raceId, runnerId) {
    if (isLocked) return
    const runner = (runners[raceId] || []).find(r => r.id === runnerId)
    if (runner?.is_withdrawn) return
    setSelected(prev => ({ ...prev, [raceId]: runnerId }))
    setBetType(prev => ({ ...prev, [raceId]: 'win' }))
  }

  function handleBetTypeChange(raceId, type) {
    setBetType(prev => ({ ...prev, [raceId]: type }))
  }

  async function handleSavePick(raceId) {
    const runnerId = selected[raceId]
    if (!runnerId || !user) return
    const raceRunners  = runners[raceId] || []
    const runner       = raceRunners.find(r => r.id === runnerId)
    const nonWithdrawn = raceRunners.filter(r => !r.is_withdrawn).length
    const effectiveBetType = canOfferEachWay(runner?.odds_decimal, nonWithdrawn) ? (betType[raceId] || 'win') : 'win'
    setSaving(raceId)
    const existing = userPicks[raceId]
    let error
    if (existing?.id) {
      const res = await supabase.from('picks').update({ runner_id: runnerId, bet_type: effectiveBetType }).eq('id', existing.id)
      error = res.error
    } else {
      const res = await supabase.from('picks').upsert({ user_id: user.id, race_id: raceId, runner_id: runnerId, bet_type: effectiveBetType }, { onConflict: 'user_id,race_id' })
      error = res.error
    }
    setSaving(null)
    if (error) { showToast('Failed to save — ' + error.message, 'error'); return }
    setUserPicks(prev => ({ ...prev, [raceId]: { ...(existing || {}), user_id: user.id, race_id: raceId, runner_id: runnerId, bet_type: effectiveBetType } }))
    showToast(existing ? 'Pick updated!' : 'Pick saved!')
    closePanel(raceId)
    window.dispatchEvent(new Event(PICKS_CHANGED))
  }

  function handleFestSelect(raceId, runnerId) {
    if (festDayLocked) return
    const runner = (festRunners[raceId] || []).find(r => r.id === runnerId)
    if (runner?.is_withdrawn) return
    setFestSelected(prev => ({ ...prev, [raceId]: runnerId }))
    setFestBetType(prev => ({ ...prev, [raceId]: 'win' }))
  }

  function handleFestBetTypeChange(raceId, type) {
    setFestBetType(prev => ({ ...prev, [raceId]: type }))
  }

  async function handleFestSavePick(raceId) {
    const runnerId = festSelected[raceId]
    if (!runnerId || !user || festDayLocked) return
    const raceRunners  = festRunners[raceId] || []
    const runner       = raceRunners.find(r => r.id === runnerId)
    const nonWithdrawn = raceRunners.filter(r => !r.is_withdrawn).length
    const effectiveBetType = canOfferEachWay(runner?.odds_decimal, nonWithdrawn) ? (festBetType[raceId] || 'win') : 'win'
    setFestSaving(raceId)
    const { error } = await supabase.from('festival_picks').upsert({
      festival_race_id: raceId,
      user_id: user.id,
      runner_id: runnerId,
      bet_type: effectiveBetType,
      picked_at: new Date().toISOString(),
    }, { onConflict: 'festival_race_id,user_id' })
    setFestSaving(null)
    if (error) {
      // Put the selection back to the last saved pick (or none).
      setFestSelected(prev => ({ ...prev, [raceId]: festPicks[raceId] }))
      setFestBetType(prev => ({ ...prev, [raceId]: festSavedBet.current[raceId] || 'win' }))
      showToast('Failed to save — ' + error.message, 'error')
      closePanel(raceId)
      return
    }
    const wasAlreadyPicked = !!festPicks[raceId]
    setFestPicks(prev => ({ ...prev, [raceId]: runnerId }))
    setFestBetType(prev => ({ ...prev, [raceId]: effectiveBetType }))
    festSavedBet.current = { ...festSavedBet.current, [raceId]: effectiveBetType }
    showToast(wasAlreadyPicked ? 'Pick updated!' : 'Pick saved!')
    closePanel(raceId)
  }

  async function handleJoin(activeFest) {
    await supabase.from('festival_entries').insert({ festival_id: activeFest.id, user_id: user.id, starting_points: 0 })
    await loadFestivalData(activeFest)
  }

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return <div className="pk-loading"><div className="pk-loading__dot" /></div>
  }

  // ── What's on screen: the Saturday League or the selected festival ──
  const isFest = !!selFest
  const view = isFest
    ? { races: festRaces, runners: festRunners, picks: festPicks, sel: festSelected, bet: festBetType,
        saving: festSaving, locked: festDayLocked, joined: !!festEntry, idx: festIdx, setIdx: setFestIdx }
    : { races, runners, picks: Object.fromEntries(Object.entries(userPicks).map(([id, p]) => [id, p.runner_id])),
        sel: selected, bet: betType, saving, locked: isLocked, joined: true, idx: weekIdx, setIdx: setWeekIdx }
  const wasReplaced = raceId => (isFest ? festReplaced[raceId] : userPicks[raceId]?.was_replaced)

  const noRaces = isFest ? (!festLoading && festRaces.length === 0) : (noWeek || races.length === 0)
  const lockIso = isFest ? festDay?.picks_deadline : currentWeek?.picks_deadline
  const lockText = noRaces ? null : view.locked ? 'Picks locked' : lockLabel(lockIso, now.getTime())

  const pillItems = [
    { key: 'saturday', label: 'Saturday League' },
    ...activeFestivals.map(f => ({ key: f.id, label: f.display_name || f.name })),
  ]
  const dayChoices = festDays.filter(d => openDayIds.includes(d.id))

  function pickCompetition(item) {
    if (item.key === 'saturday') setCompetition('saturday')
    else setCompetition('festival', item.key)
  }

  function tapRunner(raceId, runnerId) {
    if (view.sel[raceId] !== runnerId) (isFest ? handleFestSelect : handleSelect)(raceId, runnerId)
    setOpenRunner(prev => ({ ...prev, [raceId]: prev[raceId] === runnerId ? null : runnerId }))
  }

  const idx = Math.max(0, Math.min(view.idx, view.races.length - 1))
  const race = view.races[idx]
  const raceRunners = race ? (view.runners[race.id] || []) : []
  const nonWithdrawn = raceRunners.filter(r => !r.is_withdrawn).length
  const isLastRace = idx >= view.races.length - 1
  const pickedId = race ? view.picks[race.id] : undefined
  const pickedRunner = raceRunners.find(r => r.id === pickedId)
  const canTap = view.joined && !view.locked

  function nextRace() {
    if (isLastRace) { navigate('/dashboard'); return }
    view.setIdx(idx + 1)
    window.scrollTo({ top: 0 })
  }

  function panelFor(runner) {
    if (!canTap || openRunner[race.id] !== runner.id) return null
    const eachWayOffered = canOfferEachWay(runner.odds_decimal, nonWithdrawn)
    const current = eachWayOffered ? (view.bet[race.id] || 'win') : 'win'
    return {
      eachWayOffered,
      betType: current,
      note: isWinOnly(runner.odds_decimal)
        ? 'Win only — under 4/1'
        : "Win only — each-way isn't offered in fields under 5 runners",
      preview: previewPoints(current, runner.odds_decimal, nonWithdrawn),
      isUpdate: !!pickedId,
      saving: view.saving === race.id,
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="app-page pk">
      {toast && (
        <div className={`pk-toast${toast.type === 'error' ? ' pk-toast--error' : ''}`} role="status">
          {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}
        </div>
      )}

      <main className="pk__main">
        <header className="pk-head">
          <h1 className="pk-title">Picks</h1>
          {lockText && (
            <div className={`pk-lock${view.locked ? ' pk-lock--locked' : ''}`}>
              <Clock size={15} aria-hidden="true" />
              <span>{lockText}</span>
            </div>
          )}
        </header>

        {activeFestivals.length > 0 && (
          <CompetitionPills items={pillItems} activeKey={selFest ? selFest.id : 'saturday'} onSelect={pickCompetition} />
        )}

        {isFest && dayChoices.length > 1 && (
          <DaySwitch days={dayChoices} activeId={festDay?.id} onSelect={handleFestDaySwitch} />
        )}

        {isFest && festLoading && <div className="pk-loading" style={{ minHeight: 160 }}><div className="pk-loading__dot" /></div>}

        {isFest && !festLoading && !festEntry && (
          <JoinCard name={selFest.display_name || selFest.name} onJoin={() => handleJoin(selFest)} />
        )}

        {!(isFest && festLoading) && noRaces && (
          <EmptyState text={isFest ? "Picks open when this festival's races are published." : undefined} />
        )}

        {!noRaces && race && (
          <>
            <RaceChips
              races={view.races}
              activeIndex={idx}
              picked={id => hasLivePick(view.picks[id], view.runners[id] || [])}
              onSelect={view.setIdx}
            />

            <RaceHeader race={race} runnerCount={nonWithdrawn} />

            {wasReplaced(race.id) && (
              <p className="pk-note">Your original pick was withdrawn – replaced with the favourite</p>
            )}
            {pickedRunner?.is_withdrawn && !wasReplaced(race.id) && (
              <p className="pk-note">Your pick was withdrawn – choose another runner</p>
            )}
            {view.locked && (
              <p className="pk-note">Picks are locked – results will appear in Results</p>
            )}

            <div className="pk-list">
              {raceRunners.map(runner => {
                const shown = view.locked ? pickedId : (view.sel[race.id] ?? pickedId)
                return (
                  <RunnerRow
                    key={runner.id}
                    runner={runner}
                    selected={shown === runner.id}
                    isPick={pickedId === runner.id}
                    disabled={!canTap}
                    panel={panelFor(runner)}
                    onTap={() => tapRunner(race.id, runner.id)}
                    onBetType={type => (isFest ? handleFestBetTypeChange : handleBetTypeChange)(race.id, type)}
                    onSave={() => (isFest ? handleFestSavePick : handleSavePick)(race.id)}
                  />
                )
              })}
              {raceRunners.length === 0 && <p className="pk-note">No runners added yet — check back soon.</p>}
            </div>

            <button type="button" className="pk-btn pk-btn--ghost" onClick={nextRace}>
              {isLastRace ? 'Done – back to Home' : 'Next race'}
            </button>
          </>
        )}
      </main>

    </div>
  )
}
