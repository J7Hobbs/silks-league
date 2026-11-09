/**
 * PlayerPicksModal — another player's picks, as a bottom sheet over a Leaderboard table.
 * Opened by tapping a player row. Looks like the Results page: week / day tabs, the Won / Placed /
 * No points boxes and one card per race (the Results RaceCard).
 *
 * Other players' picks stay hidden until the race day's picks lock (the week's picks_deadline, or
 * the festival day's), exactly as before: a period that hasn't locked shows a message and loads nothing.
 *
 * Props:
 *   userId        string       the player whose picks to show
 *   displayName   string       shown until their profile loads
 *   seasonPoints  number?      their total and position in the table that was tapped (this
 *   seasonRank    number?      week, season or festival), passed through from the row
 *   seasonId      string|null  the Saturday League season of the table that was tapped (a past season's
 *                              page passes its own); without it, the active season
 *   festivalId    string|null  when set, show that festival's days instead of Saturday League weeks
 *   onClose       fn
 */

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import Sheet from './groups/Sheet.jsx'
import OutcomeBoxes from './results/OutcomeBoxes.jsx'
import DayTabs from './results/DayTabs.jsx'
import RaceCard from './results/RaceCard.jsx'
import BonusSummary from './results/BonusSummary.jsx'
import { loadWeekPeriod, loadFestivalPeriod, loadWeekStanding, loadFestivalDayStanding } from '../lib/resultsData.js'
import { buildResultRows, outcomeCounts, bonusSummary, shortDate } from '../lib/resultsView.js'
import { ordinal, picksRevealed, weekdayShort } from '../lib/format.js'
import '../styles/groups.css'
import '../styles/picks.css'
import '../styles/results.css'
import '../styles/player-picks.css'

export default function PlayerPicksModal({ userId, displayName, seasonPoints, seasonRank, seasonId = null, festivalId = null, onClose }) {
  const [nowMs]                   = useState(() => Date.now())
  const [profile,  setProfile]    = useState(null)
  const [periods,  setPeriods]    = useState(null)    // null while loading, then [{ id, label, caption, revealed }]
  const [initFail, setInitFail]   = useState(false)
  const [selId,    setSelId]      = useState(null)
  const [cache,    setCache]      = useState({})      // { [period id]: { rows, counts, standing } }
  const [failedId, setFailedId]   = useState(null)
  const [attempt,  setAttempt]    = useState(0)
  const [open,     setOpen]       = useState(() => new Set())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  // The player's name and the weeks (this season) or days (this festival) to choose from.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const profileLoad = supabase.from('profiles').select('id, username, full_name, display_name').eq('id', userId).maybeSingle()
        let list, pick
        if (festivalId) {
          const { data: days } = await supabase.from('festival_days').select('id, day_number, race_date, picks_deadline')
            .eq('festival_id', festivalId).order('day_number')
          list = (days || []).map(d => ({
            id: d.id,
            label: d.race_date ? weekdayShort(d.race_date) : `Day ${d.day_number}`,
            caption: '',
            revealed: !!d.race_date && picksRevealed(d.picks_deadline, d.race_date, nowMs),
          }))
          // The latest day that has locked, or the first day when none has.
          pick = list.findLastIndex(p => p.revealed)
          if (pick < 0) pick = 0
        } else {
          // The season of the table that was tapped, or the active one.
          let wantedSeason = seasonId
          if (!wantedSeason) {
            const { data: season } = await supabase.from('seasons').select('id').eq('is_active', true).maybeSingle()
            wantedSeason = season?.id || null
          }
          const { data: weeks } = wantedSeason
            ? await supabase.from('race_weeks').select('id, week_number, saturday_date, picks_deadline, festival_day_id')
                .eq('season_id', wantedSeason).order('saturday_date', { ascending: true })
            : { data: [] }
          list = (weeks || []).map(w => ({
            id: w.id,
            label: `W${w.week_number}`,
            caption: `Week ${w.week_number} · ${shortDate(w.saturday_date)}`,
            festivalDayId: w.festival_day_id || null,   // a week linked to a festival day shows that day's picks
            revealed: picksRevealed(w.picks_deadline, w.saturday_date, nowMs),
          }))
          // The latest week that has locked, or the newest week when none has.
          pick = list.findLastIndex(p => p.revealed)
          if (pick < 0) pick = list.length - 1
        }
        const { data: prof } = await profileLoad
        if (cancelled) return
        setProfile(prof)
        setPeriods(list)
        setSelId(list[pick]?.id ?? null)
      } catch {
        if (!cancelled) setInitFail(true)
      }
    })()
    return () => { cancelled = true }
  }, [userId, festivalId, seasonId, nowMs])

  const sel = periods?.find(p => p.id === selId) || null

  // That player's picks, results and scores for the chosen period, once its picks have locked.
  useEffect(() => {
    if (!sel || !sel.revealed || cache[sel.id]) return
    let cancelled = false
    const load = festivalId ? loadFestivalPeriod : loadWeekPeriod
    load(userId, { id: sel.id, festivalDayId: sel.festivalDayId })
      .then(bundle => {
        if (cancelled) return
        const rows = buildResultRows(bundle)
        setCache(prev => ({ ...prev, [sel.id]: { rows, counts: outcomeCounts(rows), bonus: bonusSummary(bundle.bonuses), standing: null } }))
        setFailedId(null)
        // Their position among everyone who picked that day, as on the Results hero. An extra: the
        // points still show if it can't be read.
        const raceIds = bundle.races.map(r => r.id)
        if (!raceIds.length) return
        ;(festivalId ? loadFestivalDayStanding(userId, raceIds) : loadWeekStanding(userId, raceIds))
          .then(standing => {
            if (mounted.current && standing) setCache(prev => (prev[sel.id] ? { ...prev, [sel.id]: { ...prev[sel.id], standing } } : prev))
          })
          .catch(() => {})
      })
      .catch(() => { if (!cancelled) setFailedId(sel.id) })
    return () => { cancelled = true }
  }, [sel, cache, userId, festivalId, attempt])

  function choose(id) {
    setOpen(new Set())
    setFailedId(null)
    setSelId(id)
  }

  function toggle(raceId) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(raceId)) next.delete(raceId); else next.add(raceId)
      return next
    })
  }

  const name = profile?.username || profile?.display_name || profile?.full_name || displayName || 'Player'
  const sub = [seasonRank != null ? ordinal(seasonRank) : '', seasonPoints != null ? `${seasonPoints} pts` : ''].filter(Boolean).join(' · ')
  const current = sel ? cache[sel.id] : null

  let body
  if (initFail) {
    body = <p className="pp-msg">Couldn't load picks. Check your connection and try again.</p>
  } else if (!periods) {
    body = (
      <div className="pp-wait" role="status" aria-busy="true" aria-label="Loading">
        {[1, 2, 3].map(n => <span key={n} className="gr-skel-line" />)}
      </div>
    )
  } else if (!sel) {
    body = <p className="pp-msg">{festivalId ? 'No race days found for this festival.' : 'No race weeks found.'}</p>
  } else if (!sel.revealed) {
    body = (
      <div className="pp-locked">
        <p className="pp-locked__title">Picks not yet revealed</p>
        <p className="pp-locked__text">Picks are hidden until they lock — come back then.</p>
      </div>
    )
  } else if (failedId === sel.id) {
    body = (
      <>
        <p className="pp-msg">Couldn't load these picks. Check your connection and try again.</p>
        <button type="button" className="pp-retry" onClick={() => { setFailedId(null); setAttempt(a => a + 1) }}>Try again</button>
      </>
    )
  } else if (!current) {
    body = (
      <div className="pp-wait" role="status" aria-busy="true" aria-label="Loading">
        {[1, 2, 3].map(n => <span key={n} className="gr-skel-line" />)}
      </div>
    )
  } else if (current.rows.length === 0) {
    body = <p className="pp-msg">{festivalId ? 'No races set up for this day yet.' : 'No races set up for this week yet.'}</p>
  } else {
    body = (
      <>
        {current.counts.played && (
          <p className="pp-period">
            <span className="pp-period__pts">{current.counts.points} pts</span>
            {current.standing && ` · ${ordinal(current.standing.rank)} of ${current.standing.total}`}
          </p>
        )}
        <BonusSummary bonus={current.bonus} />
        <OutcomeBoxes won={current.counts.won} placed={current.counts.placed} unplaced={current.counts.unplaced} />
        {current.rows.some(r => !r.pending) && <p className="rs-hint">Tap a race to see the full result</p>}
        <div className="rs-list">
          {current.rows.map(row => (
            <RaceCard key={row.id} row={row} owner="their" open={open.has(row.id)} onToggle={() => toggle(row.id)} />
          ))}
        </div>
      </>
    )
  }

  return (
    <Sheet onClose={onClose} labelledBy="pp-title" dragToClose className="pp-sheet">
      <header className="pp-head">
        <h2 id="pp-title" className="pp-name">{name}</h2>
        {sub && <p className="pp-sub">{sub}</p>}
      </header>

      {periods && periods.length > 1 && (
        <DayTabs
          scroll={!festivalId}
          tabs={periods.map(p => ({ id: p.id, label: p.label, locked: true }))}
          selectedId={selId}
          onSelect={choose}
        />
      )}
      {sel?.caption && <p className="pp-cap">{sel.caption}</p>}

      {body}
    </Sheet>
  )
}
