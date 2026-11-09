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
import { currentUser } from '../lib/session.js'
import { useCompetition } from '../context/competition.js'
import { PICKS_CHANGED } from '../lib/navTabs.js'
import { isWinOnly, canOfferEachWay, calcTokenPoints } from '../lib/scoring.js'
import { daysBetween, localDateStr, lockLabel } from '../lib/format.js'
import { useNotifStatus } from '../lib/useNotifStatus.js'
import {
  runningFestivals, selectedFestival, isDayOpen, defaultFestDay, hasLivePick, firstUnpickedIndex, competitionLine, sortByPrice,
  shortDay, festivalDates, festDayRow,
} from '../lib/picksView.js'
import CompetitionPills from '../components/picks/CompetitionPills.jsx'
import DaySwitch from '../components/picks/DaySwitch.jsx'
import RaceChips from '../components/picks/RaceChips.jsx'
import RaceHeader from '../components/picks/RaceHeader.jsx'
import RunnerRow from '../components/picks/RunnerRow.jsx'
import JoinCard from '../components/picks/JoinCard.jsx'
import EmptyState from '../components/picks/EmptyState.jsx'
import { PicksSkeleton, RunnerRowsSkeleton } from '../components/Skeletons.jsx'
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
  const [raceDayIds,       setRaceDayIds]       = useState([])   // days that have races loaded
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
  // A Saturday linked to a festival day (race_weeks.festival_day_id) has no races of its own: its
  // picks are the festival day's, shown here under the Saturday League pill. linkedFest is that
  // festival; satLinkedDays are the ids of the running festival's days that are linked to a Saturday.
  const [linkedFest,       setLinkedFest]       = useState(null)
  const [satLinkedDays,    setSatLinkedDays]    = useState([])

  // Which runner's bet panel is open, per race.
  const [openRunner, setOpenRunner] = useState({})
  // Latest festival load; older ones are ignored if the player switches mid-load.
  const festReq = useRef(0)
  // Bet type last saved per festival race, to restore if a save fails.
  const festSavedBet = useRef({})
  // After a save: the row that shows "Saved ✓" for a moment, and the timer that then moves on.
  const notif = useNotifStatus(user?.id)
  const [flash, setFlash] = useState(null)   // { raceId, runnerId }
  const advance = useRef(null)
  useEffect(() => () => clearTimeout(advance.current), [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { init() }, [])

  async function init() {
    const user = await currentUser()
    if (!user) { navigate('/auth'); return }
    setUser(user)
    // The festival list and the weekly picks don't depend on each other, so they load together.
    // The page stays on its placeholder until both are in, so the pills don't pop in late.
    const festivalsLoaded = (async () => {
      const { data: fests } = await supabase
        .from('festivals').select('*').eq('is_active', true).order('start_date')
      const running = runningFestivals(fests, localDateStr())
      setActiveFestivals(running)
      // Older links navigate here with { festivalTab } (e.g. a festival banner).
      const requestedTab = location.state?.festivalTab
      if (requestedTab && running.some(f => f.id === requestedTab)) setCompetition('festival', requestedTab)
    })()
    await loadData(user, festivalsLoaded)
  }

  // The festival being looked at (null = Saturday League). A group id or a
  // festival that has finished shows the Saturday League without changing the
  // saved selection, so a Leaderboard group choice survives a visit here.
  const selFest = selectedFestival(competition, activeFestivals)
  const selFestId = selFest?.id ?? null

  // The Saturday League week on show, when it is linked to a festival day.
  const linkedDayId = currentWeek?.festival_day_id || null

  useEffect(() => {
    if (!user) return
    if (!selFestId && !linkedDayId) return
    setFestEntry(null); setFestDays([]); setOpenDayIds([]); setRaceDayIds([]); setFestDay(null)
    setFestRaces([]); setFestRunners({}); setFestPicks({}); setFestReplaced({})
    setFestSelected({}); setFestBetType({}); setFestIdx(0)
    if (selFestId) loadFestivalData(activeFestivals.find(f => f.id === selFestId))
    else loadLinkedSaturday(linkedDayId, user)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selFestId, user, linkedDayId])

  // ── Weekly loader ─────────────────────────────────────────────
  async function loadData(u, alongside) {
    setLoading(true)
    const finish = async () => { await alongside; setLoading(false) }
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) { setNoWeek(true); await finish(); return }

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

    if (!week) { setNoWeek(true); await finish(); return }
    // Same rule as Home: no open week and the latest one is over two weeks old.
    if (!openWeek && daysBetween(week.saturday_date, localDateStr()) > 14) { setNoWeek(true); await finish(); return }
    setCurrentWeek(week)

    const { data: raceData } = await supabase
      .from('races').select('*').eq('race_week_id', week.id).order('race_number')
    setRaces(raceData || [])
    if (!raceData?.length) { await finish(); return }

    // Runners (one query per race) and the player's picks are independent, so they load together.
    const raceIds = raceData.map(r => r.id)
    const [runnerResults, { data: picks }] = await Promise.all([
      Promise.all(raceData.map(race => supabase
        .from('runners').select('*').eq('race_id', race.id).order('horse_number', { ascending: true }))),
      supabase.from('picks').select('*').eq('user_id', u.id).in('race_id', raceIds),
    ])
    const runnersMap = {}
    raceData.forEach((race, i) => { runnersMap[race.id] = runnerResults[i].data || [] })
    setRunners(runnersMap)

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
    await finish()
  }

  // ── Festival loaders ──────────────────────────────────────────
  async function loadFestivalData(fest) {
    const u = await currentUser()
    if (!u) return
    const token = ++festReq.current
    const stale = () => token !== festReq.current
    setFestLoading(true)
    try {
      const [{ data: entryData }, { data: daysData }] = await Promise.all([
        supabase.from('festival_entries').select('*')
          .eq('festival_id', fest.id).eq('user_id', u.id).maybeSingle(),
        supabase.from('festival_days').select('*').eq('festival_id', fest.id).order('day_number'),
      ])
      if (stale()) return
      setFestEntry(entryData || null)
      setFestDays(daysData || [])

      if (daysData?.length) {
        // Days that still take picks: deadline not passed and races loaded.
        const dayIds = daysData.map(d => d.id)
        const [{ data: dayRaces }, { data: linkedWeeks }] = await Promise.all([
          supabase.from('festival_races').select('festival_day_id').in('festival_day_id', dayIds),
          supabase.from('race_weeks').select('festival_day_id').in('festival_day_id', dayIds),
        ])
        if (stale()) return
        setSatLinkedDays((linkedWeeks || []).map(w => w.festival_day_id))
        const withRaces = new Set((dayRaces || []).map(r => r.festival_day_id))
        const today = localDateStr()
        const nowMs = Date.now()
        const open = daysData.filter(d => withRaces.has(d.id) && isDayOpen(d, nowMs, today))
        setOpenDayIds(open.map(d => d.id))
        setRaceDayIds([...withRaces])
        const currentDay = defaultFestDay(daysData, open, today)
        setFestDay(currentDay)
        // Races are readable by every signed-in player, so non-members see them too.
        await loadFestDayData(currentDay, u.id, token)
      }
    } finally {
      if (!stale()) setFestLoading(false)
    }
  }

  // The Saturday League for a week linked to a festival day: that day's races, runners and the
  // player's picks, loaded into the same state the festival view uses.
  async function loadLinkedSaturday(dayId, u) {
    const token = ++festReq.current
    const stale = () => token !== festReq.current
    setFestLoading(true)
    try {
      const { data: day } = await supabase.from('festival_days').select('*').eq('id', dayId).maybeSingle()
      if (stale()) return
      if (!day) return
      const { data: fest } = await supabase.from('festivals').select('id, name, display_name').eq('id', day.festival_id).maybeSingle()
      if (stale()) return
      setLinkedFest(fest || null)
      setFestDay(day)
      await loadFestDayData(day, u.id, token)
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
    const [runnerResults, { data: picksData }] = await Promise.all([
      Promise.all(racesData.map(race => supabase
        .from('festival_runners').select('*').eq('festival_race_id', race.id).order('horse_number'))),
      supabase.from('festival_picks').select('festival_race_id, runner_id, bet_type, was_replaced, original_runner_id')
        .eq('user_id', userId).in('festival_race_id', raceIds),
    ])
    if (stale()) return
    const runnersMap = {}
    racesData.forEach((race, i) => { runnersMap[race.id] = runnerResults[i].data || [] })
    setFestRunners(runnersMap)
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
    const u = await currentUser()
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

  // A saved pick: "Saved ✓" on its row for 600ms, then on to the next race with no saved pick (in
  // race order, wrapping round to earlier races). Stays put when every race has a pick.
  function confirmAndMove(raceId, runnerId, raceList, picksNow, runnersMap, setIdx) {
    clearTimeout(advance.current)
    setFlash({ raceId, runnerId })
    advance.current = setTimeout(() => {
      setFlash(null)
      const from = raceList.findIndex(r => r.id === raceId)
      for (let k = 1; k < raceList.length; k++) {
        const j = (from + k) % raceList.length
        if (!hasLivePick(picksNow[raceList[j].id], runnersMap[raceList[j].id] || [])) {
          setIdx(j)
          window.scrollTo({ top: 0 })
          return
        }
      }
    }, 600)
  }

  // Anything the player does by hand in the meantime cancels the automatic move.
  function cancelAdvance() {
    clearTimeout(advance.current)
    setFlash(null)
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
    closePanel(raceId)
    window.dispatchEvent(new Event(PICKS_CHANGED))
    const picksNow = { ...Object.fromEntries(Object.entries(userPicks).map(([id, p]) => [id, p.runner_id])), [raceId]: runnerId }
    confirmAndMove(raceId, runnerId, races, picksNow, runners, setWeekIdx)
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
    setFestPicks(prev => ({ ...prev, [raceId]: runnerId }))
    setFestBetType(prev => ({ ...prev, [raceId]: effectiveBetType }))
    festSavedBet.current = { ...festSavedBet.current, [raceId]: effectiveBetType }
    closePanel(raceId)
    window.dispatchEvent(new Event(PICKS_CHANGED))
    confirmAndMove(raceId, runnerId, festRaces, { ...festPicks, [raceId]: runnerId }, festRunners, setFestIdx)
  }

  async function handleJoin(activeFest) {
    await supabase.from('festival_entries').insert({ festival_id: activeFest.id, user_id: user.id, starting_points: 0 })
    await loadFestivalData(activeFest)
  }

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return <PicksSkeleton />
  }

  // ── What's on screen: the Saturday League or the selected festival ──
  const isFest = !!selFest
  // The Saturday League for a linked week reads and saves through the festival code below.
  const satLinked = !isFest && !!linkedDayId
  const usesFest = isFest || satLinked
  // The festival data for what's on screen is still on its way (the linked day isn't in yet).
  const festBusy = usesFest && (festLoading || (satLinked && festDay?.id !== linkedDayId))
  // A day linked to a Saturday takes picks without a separate join: the first pick enters the player.
  const joinedFest = !!festEntry || (!!festDay && satLinkedDays.includes(festDay.id))
  const view = usesFest
    ? { races: festRaces, runners: festRunners, picks: festPicks, sel: festSelected, bet: festBetType,
        saving: festSaving, locked: festDayLocked, joined: satLinked || joinedFest, idx: festIdx, setIdx: setFestIdx }
    : { races, runners, picks: Object.fromEntries(Object.entries(userPicks).map(([id, p]) => [id, p.runner_id])),
        sel: selected, bet: betType, saving, locked: isLocked, joined: true, idx: weekIdx, setIdx: setWeekIdx }
  const wasReplaced = raceId => (usesFest ? festReplaced[raceId] : userPicks[raceId]?.was_replaced)

  const noRaces = usesFest ? (!festBusy && festRaces.length === 0) : (noWeek || races.length === 0)
  const lockIso = usesFest ? festDay?.picks_deadline : currentWeek?.picks_deadline
  const lockText = noRaces ? null : view.locked ? 'Picks locked' : lockLabel(lockIso, now.getTime())

  // Under the title: which week or festival day this is. Left out until its data is in.
  const headLine = noRaces || festBusy ? '' : competitionLine({
    festival: isFest, week: currentWeek, day: festDay, dayCount: festDays.length,
    races: view.races, festivalVenue: selFest?.venue,
  })

  const pillItems = [
    { key: 'saturday', label: 'Saturday League' },
    ...activeFestivals.map(f => ({ key: f.id, label: f.display_name || f.name })),
  ]
  const dayChoices = festDays.filter(d => openDayIds.includes(d.id))

  // One set of picks counts twice: say so, on the Saturday League and on the festival's linked day.
  const alsoCounts = satLinked
    ? `These picks also count for the ${linkedFest ? (linkedFest.display_name || linkedFest.name) : 'festival'}`
    : (isFest && festDay && satLinkedDays.includes(festDay.id) ? 'These picks also count for your Saturday League' : '')

  // What the "nothing to pick yet" card says (see EmptyState).
  const festName = isFest ? (selFest.display_name || selFest.name) : linkedFest ? (linkedFest.display_name || linkedFest.name) : ''
  // The date is left off when that Saturday has already gone (the latest week has no races at all).
  const weekEyebrow = currentWeek?.saturday_date >= localDateStr() ? `This week · ${shortDay(currentWeek.saturday_date)}` : 'This week'
  const nothingYet = isFest
    ? {
        kind: 'festival',
        eyebrow: [selFest.venue, festivalDates(selFest.start_date, selFest.end_date)].filter(Boolean).join(' · '),
        title: festName,
        text: 'Picks for each day open the evening before, and we\'ll notify you.',
        days: festDays.map(d => ({
          id: d.id,
          ...festDayRow(d, { hasRaces: raceDayIds.includes(d.id), open: openDayIds.includes(d.id), today: localDateStr() }),
        })),
      }
    : satLinked
      ? {
          kind: 'linked',
          eyebrow: weekEyebrow,
          title: `Part of ${festName || 'a festival'}`,
          text: `This Saturday's races are ${festName ? `${festName}'s` : 'the festival\'s'} Saturday card. One set of picks counts for both the Saturday League and the festival.`,
        }
      : {
          kind: 'week',
          eyebrow: weekEyebrow,
          title: 'Races announced Friday',
          text: "Saturday's races go up on Friday evening. We'll notify you when picks open.",
        }

  function pickCompetition(item) {
    cancelAdvance()
    if (item.key === 'saturday') setCompetition('saturday')
    else setCompetition('festival', item.key)
  }

  function tapRunner(raceId, runnerId) {
    cancelAdvance()
    if (view.sel[raceId] !== runnerId) (usesFest ? handleFestSelect : handleSelect)(raceId, runnerId)
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
  // Every race has a live pick (one on a withdrawn runner doesn't count, as on the race chips).
  const allPicked = canTap && view.races.length > 0 && view.races.every(r => hasLivePick(view.picks[r.id], view.runners[r.id] || []))
  const lockUntil = lockText ? lockText.replace(/^Locks /, '') : ''

  function nextRace() {
    cancelAdvance()
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
          <span className="pk-tag">{isFest ? (selFest.display_name || selFest.name).toUpperCase() : 'SATURDAY LEAGUE'}</span>
          <div className="pk-head__row">
            <h1 className="pk-title">Picks</h1>
            {lockText && (
              <div className={`pk-lock${view.locked ? ' pk-lock--locked' : ''}`}>
                <Clock size={15} aria-hidden="true" />
                <span>{lockText}</span>
              </div>
            )}
          </div>
          {headLine && <p className="pk-sub">{headLine}</p>}
        </header>

        {activeFestivals.length > 0 && (
          <CompetitionPills items={pillItems} activeKey={selFest ? selFest.id : 'saturday'} onSelect={pickCompetition} />
        )}

        {isFest && dayChoices.length > 1 && (
          <DaySwitch days={dayChoices} activeId={festDay?.id} onSelect={id => { cancelAdvance(); handleFestDaySwitch(id) }} />
        )}

        {usesFest && festBusy && <RunnerRowsSkeleton />}

        {isFest && !festBusy && !view.joined && (
          <JoinCard name={selFest.display_name || selFest.name} onJoin={() => handleJoin(selFest)} />
        )}

        {!festBusy && noRaces && (
          <EmptyState {...nothingYet} notif={notif} onOpenDay={d => { cancelAdvance(); handleFestDaySwitch(festDays.find(x => x.id === d.id)) }} />
        )}

        {!noRaces && race && (
          <>
            <RaceChips
              races={view.races}
              activeIndex={idx}
              picked={id => hasLivePick(view.picks[id], view.runners[id] || [])}
              onSelect={i => { cancelAdvance(); view.setIdx(i) }}
            />

            <RaceHeader race={race} runnerCount={nonWithdrawn} />

            {alsoCounts && <p className="pk-note">{alsoCounts}</p>}

            {wasReplaced(race.id) && (
              <p className="pk-note">Your original pick was withdrawn – replaced with the favourite</p>
            )}
            {pickedRunner?.is_withdrawn && !wasReplaced(race.id) && (
              <p className="pk-note">Your pick was withdrawn – choose another runner</p>
            )}
            {view.locked && (
              <p className="pk-note">Picks are locked – results will appear in Results</p>
            )}

            {allPicked && (
              <p className="pk-done" role="status">
                <span className="pk-done__head">All {view.races.length} {view.races.length === 1 ? 'race' : 'races'} picked ✓</span>
                {lockUntil && ` · You can change any pick until ${lockUntil}`}
              </p>
            )}

            <div className="pk-list">
              {sortByPrice(raceRunners).map(runner => {
                const shown = view.locked ? pickedId : (view.sel[race.id] ?? pickedId)
                return (
                  <RunnerRow
                    key={runner.id}
                    runner={runner}
                    selected={shown === runner.id}
                    isPick={pickedId === runner.id}
                    saved={flash?.raceId === race.id && flash.runnerId === runner.id}
                    disabled={!canTap}
                    panel={panelFor(runner)}
                    onTap={() => tapRunner(race.id, runner.id)}
                    onBetType={type => (usesFest ? handleFestBetTypeChange : handleBetTypeChange)(race.id, type)}
                    onSave={() => (usesFest ? handleFestSavePick : handleSavePick)(race.id)}
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
