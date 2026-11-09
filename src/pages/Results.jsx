/**
 * Silks League — Results Page
 * One race day at a time: the latest Saturday League week whose picks have locked, or the latest
 * locked day of a festival that is live (or finished in the last 7 days). ?week=<race_week_id> or
 * ?festival=<festival_id> opens a specific competition instead. From the day after the first
 * Wednesday following that race day until the next one locks, the default view is a "new race
 * week coming" state (the ?week= / ?festival= links are never affected). Points are read from scores /
 * festival_scores as stored, never recalculated; nothing on this page writes to the database.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom'
import { currentUser } from '../lib/session.js'
import {
  loadResultsIndex, loadWeekPeriod, loadFestivalPeriod,
  loadWeekStanding, loadFestivalDayStanding, loadFestivalOverall,
} from '../lib/resultsData.js'
import {
  buildWeeks, buildFestivals, resolveView, dayTabs, saturdayLabel, buildResultRows, outcomeCounts, bonusSummary, shortDate,
} from '../lib/resultsView.js'
import { ordinal } from '../lib/format.js'
import ResultsHero from '../components/results/ResultsHero.jsx'
import OutcomeBoxes from '../components/results/OutcomeBoxes.jsx'
import DayTabs from '../components/results/DayTabs.jsx'
import RaceCard from '../components/results/RaceCard.jsx'
import EmptyState from '../components/results/EmptyState.jsx'
import WaitingState from '../components/results/WaitingState.jsx'
import { ResultsSkeleton, ResultsBodySkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/results.css'

// The old /results/festival/:festivalId link now opens /results?festival=:festivalId.
export default function Results() {
  const { festivalId: linkedId } = useParams()
  if (linkedId) return <Navigate to={`/results?festival=${encodeURIComponent(linkedId)}`} replace />
  return <ResultsPage />
}

function ResultsPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const weekParam = params.get('week')
  const festivalParam = params.get('festival')
  const specific = !!(weekParam || festivalParam)

  const [user,     setUser]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [failed,   setFailed]   = useState(false)   // the week / festival lists could not be read
  const [attempt,  setAttempt]  = useState(0)       // bumped to re-read the lists
  const [tryAgain, setTryAgain] = useState(0)       // bumped to re-read one race day
  const [index,    setIndex]    = useState(null)    // { weeks, festivals }
  const [nowMs]                 = useState(() => Date.now())

  const [pickedDay, setPickedDay] = useState(null)  // { festivalId, dayId } chosen with the day tabs
  const [loaded,  setLoaded]  = useState({})        // { [race day id]: { rows, counts, standing, label } }
  const [overall, setOverall] = useState({})        // { [festival id]: { total, rank } }
  const [badId,   setBadId]   = useState(null)      // race day whose data could not be read
  const [open,    setOpen]    = useState(() => new Set())

  // ── Who is signed in, then the lists of weeks and festivals ────
  useEffect(() => {
    let cancelled = false
    async function init() {
      const user = await currentUser()
      if (!user) { navigate('/auth'); return }
      if (cancelled) return
      setUser(user)
      const raw = await loadResultsIndex().catch(() => null)
      if (cancelled) return
      if (raw) {
        setIndex({
          weeks: buildWeeks(raw.weeks, raw.weekRaces),
          festivals: buildFestivals(raw.festivals, raw.days, raw.dayRaces),
        })
        setFailed(false)
      } else {
        setFailed(true)
      }
      setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [navigate, attempt])

  // ── What's on screen ───────────────────────────────────────────
  const view = useMemo(() => index
    ? resolveView({ weeks: index.weeks, festivals: index.festivals, weekParam, festivalParam, nowMs })
    : { kind: 'none' }, [index, weekParam, festivalParam, nowMs])

  const festival = view.kind === 'festival' ? view.festival : null
  const dayId = festival
    ? (pickedDay?.festivalId === festival.id && festival.days.some(d => d.id === pickedDay.dayId) ? pickedDay.dayId : view.dayId)
    : null
  const day = festival ? festival.days.find(d => d.id === dayId) : null
  const period = view.kind === 'week' ? view.week : day   // { id, raceIds, date, ... }
  const current = period ? loaded[period.id] : null

  // ── Load the player's picks, scores, results and standing for the race day ──
  useEffect(() => {
    if (!user || !period || loaded[period.id]) return
    let cancelled = false
    const bundleLoad = festival ? loadFestivalPeriod(user.id, period) : loadWeekPeriod(user.id, period)
    // The standing is extra: if it can't be read the rest of the page still shows.
    const standingLoad = (festival
      ? loadFestivalDayStanding(user.id, period.raceIds)
      : loadWeekStanding(user.id, period.raceIds)).catch(() => null)
    Promise.all([bundleLoad, standingLoad]).then(([bundle, standing]) => {
      if (cancelled) return
      const rows = buildResultRows(bundle)
      const counts = outcomeCounts(rows)
      setLoaded(prev => ({
        ...prev,
        [period.id]: { rows, counts, bonus: bonusSummary(bundle.bonuses), standing: counts.played ? standing : null, label: festival ? '' : saturdayLabel(bundle.races) },
      }))
      setBadId(null)
    }).catch(() => { if (!cancelled) setBadId(period.id) })
    return () => { cancelled = true }
  }, [user, period, festival, loaded, tryAgain])

  // A festival's running total and overall position (once per festival).
  useEffect(() => {
    if (!user || !festival || overall[festival.id]) return
    let cancelled = false
    loadFestivalOverall(user.id, festival.id)
      .then(o => { if (!cancelled) setOverall(prev => ({ ...prev, [festival.id]: o })) })
      .catch(() => { if (!cancelled) setOverall(prev => ({ ...prev, [festival.id]: { total: null, rank: null } })) })
    return () => { cancelled = true }
  }, [user, festival, overall])

  function toggle(raceId) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(raceId)) next.delete(raceId); else next.add(raceId)
      return next
    })
  }

  function selectDay(id) {
    setOpen(new Set())
    setPickedDay({ festivalId: festival.id, dayId: id })
  }

  function goBack() {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/results')
  }

  function retry() {
    setBadId(null)
    setFailed(false)
    setLoading(true)
    setAttempt(a => a + 1)
  }

  if (loading) {
    return <ResultsSkeleton />
  }

  // ── The hero's label and bottom line ───────────────────────────
  let heroLabel = '', heroLine = ''
  if (current && period) {
    if (festival) {
      heroLabel = `${festival.name} · Day ${period.dayNumber}`
      const o = overall[festival.id]
      heroLine = [
        o?.total != null ? `Festival total ${o.total} pts` : '',
        o?.rank ? `${ordinal(o.rank.rank)} overall` : '',
      ].filter(Boolean).join(' · ')
    } else {
      heroLabel = current.label
      heroLine = `Saturday League · ${shortDate(period.date)}`
    }
  }

  return (
    <div className="app-page rs">
      <main className="rs__main">
        {specific && (
          <button type="button" className="rs-back" onClick={goBack}>‹ Back</button>
        )}
        <h1 className="rs-title">Results</h1>

        {failed ? (
          <>
            <p className="rs-msg rs-msg--error">Couldn't load your results. Check your connection and try again.</p>
            <button type="button" className="rs-retry" onClick={retry}>Try again</button>
          </>
        ) : !period ? (
          <EmptyState />
        ) : badId === period.id ? (
          <>
            <p className="rs-msg rs-msg--error">Couldn't load this day. Check your connection and try again.</p>
            <button type="button" className="rs-retry" onClick={() => { setBadId(null); setTryAgain(a => a + 1) }}>Try again</button>
          </>
        ) : !current ? (
          <ResultsBodySkeleton />
        ) : view.waiting ? (
          <WaitingState
            next={view.next}
            last={current.standing && current.counts.played
              ? { points: current.counts.points, rank: current.standing.rank, total: current.standing.total }
              : null}
          />
        ) : (
          <>
            <ResultsHero
              festival={festival}
              label={heroLabel}
              points={current.counts.points}
              standing={current.standing}
              line={heroLine}
              bonus={current.bonus}
            />

            <OutcomeBoxes won={current.counts.won} placed={current.counts.placed} unplaced={current.counts.unplaced} />

            {festival && festival.days.length > 1 && (
              <DayTabs tabs={dayTabs(festival, nowMs)} selectedId={dayId} onSelect={selectDay} />
            )}

            {current.rows.length === 0 ? (
              <p className="rs-msg">No races on this day yet.</p>
            ) : (
              <>
                {current.rows.some(r => !r.pending) && (
                  <p className="rs-hint">Tap a race to see the full result</p>
                )}
                <div className="rs-list">
                  {current.rows.map(row => (
                    <RaceCard key={row.id} row={row} open={open.has(row.id)} onToggle={() => toggle(row.id)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
