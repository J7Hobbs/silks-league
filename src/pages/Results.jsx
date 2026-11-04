/**
 * Silks League — Results Page
 * Your results for the Saturday League (week by week) and for festivals that
 * have results (day by day). This replaces the old My Results page and the
 * Festival Results page. Points are read from scores / festival_scores as
 * stored, never recalculated; nothing on this page writes to the database.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCompetition } from '../context/competition.js'
import {
  loadWeekIndex, loadFestivalIndex, loadWeekPeriod, loadFestivalPeriod,
} from '../lib/resultsData.js'
import {
  weekPeriods, festivalList, defaultPeriodIndex, pillItems, activePillKey, buildRaceRows, summarise,
} from '../lib/resultsView.js'
import TopNav from '../components/TopNav.jsx'
import BottomNav from '../components/BottomNav.jsx'
import CompetitionPills from '../components/picks/CompetitionPills.jsx'
import PeriodSelector from '../components/results/PeriodSelector.jsx'
import SummaryTiles from '../components/results/SummaryTiles.jsx'
import RaceCard from '../components/results/RaceCard.jsx'
import EmptyState from '../components/results/EmptyState.jsx'
import '../styles/picks.css'
import '../styles/results.css'

export default function Results() {
  const navigate = useNavigate()
  const { festivalId: linkedId } = useParams()   // set on the old /results/festival/:festivalId link
  const { competition, setCompetition } = useCompetition()

  const [user,    setUser]    = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed,  setFailed]  = useState(false)   // the week / festival lists could not be read
  const [attempt, setAttempt] = useState(0)   // bumped to re-read the lists
  const [tryAgain, setTryAgain] = useState(0)   // bumped to re-read one period

  const [weeks,     setWeeks]     = useState([])  // Saturday periods, oldest first
  const [festivals, setFestivals] = useState([])  // each with its day periods

  const [chosen, setChosen] = useState({})        // { [competition key]: period index } picked with the arrows
  const [loaded, setLoaded] = useState({})        // { [period id]: { rows, summary } }
  const [badId,  setBadId]  = useState(null)      // period whose data could not be read
  const [open,   setOpen]   = useState(() => new Set())
  const linkApplied = useRef(null)

  // ── Who is signed in, then the lists of weeks and festivals ────
  useEffect(() => {
    let cancelled = false
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/auth'); return }
      if (cancelled) return
      setUser(user)
      const [{ data: profile }, indexes] = await Promise.all([
        supabase.from('profiles').select('is_admin').eq('id', user.id).single(),
        Promise.all([loadWeekIndex(), loadFestivalIndex()]).catch(() => null),
      ])
      if (cancelled) return
      setIsAdmin(profile?.is_admin || false)
      if (indexes) {
        const [w, f] = indexes
        setWeeks(weekPeriods(w.weeks, w.races, w.won))
        setFestivals(festivalList(f.festivals, f.days, f.races, f.won))
        setFailed(false)
      } else {
        setFailed(true)
      }
      setLoading(false)
    }
    init()
    return () => { cancelled = true }
  }, [navigate, attempt])

  // The old festival link selects that festival, once.
  useEffect(() => {
    if (!linkedId || linkApplied.current === linkedId || !festivals.some(f => f.id === linkedId)) return
    linkApplied.current = linkedId
    setCompetition('festival', linkedId)
  }, [linkedId, festivals, setCompetition])

  // ── What's on screen ───────────────────────────────────────────
  // A group, or a festival without results, shows the Saturday League; the saved selection is left alone.
  const items     = pillItems(festivals, linkedId)
  const activeKey = activePillKey(competition, linkedId, items)
  const festival  = festivals.find(f => f.id === activeKey) || null
  const periods   = festival ? festival.periods : weeks
  const idx       = chosen[activeKey] ?? defaultPeriodIndex(periods)
  const period    = idx >= 0 ? periods[idx] : null
  const unit      = festival ? 'day' : 'week'
  const current   = period ? loaded[period.id] : null

  // ── Load the player's picks, scores and results for the period ──
  useEffect(() => {
    if (!user || !period || loaded[period.id]) return
    let cancelled = false
    const fetchPeriod = festival ? loadFestivalPeriod : loadWeekPeriod
    fetchPeriod(user.id, period).then(bundle => {
      if (cancelled) return
      const rows = buildRaceRows(bundle, festival?.venue || '')
      setLoaded(prev => ({ ...prev, [period.id]: { rows, summary: summarise(rows) } }))
      setBadId(null)
    }).catch(() => { if (!cancelled) setBadId(period.id) })
    return () => { cancelled = true }
  }, [user, period, festival, loaded, tryAgain])

  function selectPill(item) {
    setOpen(new Set())
    if (item.key === 'saturday') setCompetition('saturday')
    else setCompetition('festival', item.key)
    if (linkedId) navigate('/results', { replace: true })
  }

  function step(delta) {
    const next = idx + delta
    if (next < 0 || next >= periods.length) return
    setOpen(new Set())
    setChosen(prev => ({ ...prev, [activeKey]: next }))
  }

  function toggle(raceId) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(raceId)) next.delete(raceId); else next.add(raceId)
      return next
    })
  }

  function retry() {
    setBadId(null)
    setFailed(false)
    setLoading(true)
    setAttempt(a => a + 1)
  }

  if (loading) {
    return <div className="rs-loading"><div className="rs-loading__dot" /></div>
  }

  return (
    <div className="app-page rs">
      <TopNav user={user} isAdmin={isAdmin} />

      <main className="rs__main">
        <h1 className="rs-title">Results</h1>

        {items.length > 1 && (
          <CompetitionPills items={items} activeKey={activeKey} onSelect={selectPill} />
        )}

        {failed ? (
          <>
            <p className="rs-msg rs-msg--error">Couldn't load your results. Check your connection and try again.</p>
            <button type="button" className="rs-retry" onClick={retry}>Try again</button>
          </>
        ) : !period ? (
          <EmptyState />
        ) : (
          <>
            <PeriodSelector
              label={period.label}
              unit={unit}
              canBack={idx > 0}
              canForward={idx < periods.length - 1}
              onBack={() => step(-1)}
              onForward={() => step(1)}
            />

            {badId === period.id ? (
              <>
                <p className="rs-msg rs-msg--error">Couldn't load this {unit}. Check your connection and try again.</p>
                <button type="button" className="rs-retry" onClick={() => { setBadId(null); setTryAgain(a => a + 1) }}>Try again</button>
              </>
            ) : !current ? (
              <div className="rs-loading--inline"><div className="rs-loading__dot" /></div>
            ) : (
              <>
                {current.summary.played ? (
                  <SummaryTiles
                    points={current.summary.points}
                    winners={current.summary.winners}
                    placed={current.summary.placed}
                  />
                ) : (
                  <p className="rs-msg">You didn't play this {unit}</p>
                )}

                {current.rows.length === 0 ? (
                  <p className="rs-msg">No races in this {unit} yet.</p>
                ) : (
                  <div className="rs-list">
                    {current.rows.map(row => (
                      <RaceCard key={row.id} row={row} open={open.has(row.id)} onToggle={() => toggle(row.id)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
