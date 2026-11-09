import { useCallback, useEffect, useMemo, useState } from 'react'
import RacePage from './RacePage.jsx'
import { ConfirmSheet, FormSheet } from './sheets.jsx'
import { WeekSheet, LinkSheet, RaceSheet, ImportSheet } from './RaceSheets.jsx'
import {
  loadDay, loadLinkInfo, setWeekLink, updateWeekDate, deleteWeek, countDayPicks, addRace, importRaces, recalculateDay,
} from '../../lib/adminRaceDays.js'
import { loadDayDetail, isLocked, lockCountdown, lockPicksNow, sendPicksOpen } from '../../lib/adminToday.js'
import { dayStatus } from '../../lib/raceDayList.js'
import { resultsRules } from '../../lib/raceDay.js'
import { dateText, plural, sentText } from '../../lib/adminFmt.js'
import { clockText, lockMs, ukClock } from '../../lib/format.js'
import '../../styles/admin-new.css'

// One race day: its header and actions, then its races. Opening a race (&r=<id>) shows RacePage instead.
export default function RaceDayPage({ dayKey, raceId, go }) {
  const [state, setState] = useState({ status: 'loading' })
  const [now, setNow] = useState(() => Date.now())
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linkInfo, setLinkInfo] = useState(null)

  const say = useCallback((type, text) => setToast({ type, text, id: Date.now() }), [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 8000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])

  const [tick, setTick] = useState(0)
  const load = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const ctx = await loadDay(dayKey)
        const detail = await loadDayDetail(ctx.day)
        if (!cancelled) setState({ status: 'ready', ...ctx, detail })
      } catch (err) {
        console.error('[Admin Race days] load failed:', err)
        if (!cancelled) setState({ status: 'error', message: err.message || String(err) })
      }
    })()
    return () => { cancelled = true }
  }, [dayKey, tick])

  const view = useMemo(() => {
    if (state.status !== 'ready') return null
    const { detail } = state
    const resultIds = new Set(detail.results.map(r => r.race_id))
    return { resultIds, done: detail.races.filter(r => resultIds.has(r.id) || r.is_abandoned).length }
  }, [state])

  const back = () => go({ d: null, r: null })
  if (state.status === 'loading') return <div className="an-note" role="status">Loading race day…</div>
  if (state.status === 'error') {
    return (
      <div className="an-card an-card--plain">
        <button type="button" className="an-back" onClick={back}>‹ Race days</button>
        <h2 className="an-h2">Could not load this race day</h2>
        <p className="an-muted">{state.message}</p>
        <button type="button" className="an-btn an-btn--solid" onClick={() => { setState({ status: 'loading' }); load() }}>Try again</button>
      </div>
    )
  }

  const { day, week, detail, viaWeek } = state
  const locked = isLocked(day, now)
  const lockAt = lockMs(day.deadline, day.date)
  const race = raceId ? detail.races.find(r => r.id === raceId) : null
  const status = dayStatus({ raceCount: detail.races.length, done: view.done, locked, notified: !!day.notifiedAt, linked: null })

  const changed = async (text, ok = true) => { say(ok ? 'ok' : 'error', text); await load() }
  const close = () => { setSheet(null); setError('') }

  if (race) {
    return (
      <>
        <RacePage day={day} race={race} detail={detail} week={week} onBack={() => go({ r: null })} onChanged={changed} />
        {toast && <div className={`an-toast an-toast--${toast.type}`} role="status" key={toast.id}>{toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}</div>}
      </>
    )
  }

  async function run(fn, after) {
    setBusy(true); setError('')
    const r = await fn()
    setBusy(false)
    return after ? after(r) : r
  }

  const onLock = () => run(() => lockPicksNow(day, detail), r => { close(); changed(r.text, r.ok) })
  const onNotify = () => run(() => sendPicksOpen(day), r => { close(); if (r.ok) changed('Picks-open notification sent'); else say('error', `Notification failed to send: ${r.error}`) })
  const onRecalc = () => run(() => recalculateDay(day, detail.races, view.resultIds), r => { close(); changed(r.text, r.ok) })
  const onAddRace = f => run(() => addRace(day, f, detail.races), r => { if (!r.ok) { setError(r.error); return } close(); changed(`Race ${r.number} added`) })
  const onImport = parsed => run(() => importRaces(day, parsed, detail.races), r => {
    if (!r.ok) { setError(r.error); if (r.made.length) load(); return }
    close(); changed(`Imported ${plural(r.made.length, 'race')} · ${plural(r.made.reduce((n, m) => n + m.runners, 0), 'runner')}`)
  })

  async function openLink() {
    setSheet('link'); setLinkInfo(null)
    try { setLinkInfo(await loadLinkInfo(week)) } catch (err) { setError(err.message || String(err)) }
  }
  const onLink = dayId => run(() => setWeekLink(week, dayId), r => { if (!r.ok) { setError(r.error); return } close(); go({ d: `week:${week.id}` }); changed(`Week ${week.week_number} linked`) })
  const onUnlink = () => run(() => setWeekLink(week, null), r => { if (!r.ok) { setError(r.error); return } close(); go({ d: `week:${week.id}` }); changed(`Week ${week.week_number} unlinked`) })
  const onEditWeek = date => run(() => updateWeekDate(week, date), r => { if (!r.ok) { setError(r.error); return } close(); changed('Week date updated') })

  async function openDelete() {
    setBusy(true)
    try {
      const n = await countDayPicks(week.festival_day_id ? 'festival' : 'week', week.festival_day_id || week.id)
      setSheet(n > 0 ? { blocked: n } : 'deleteWeek')
    } catch (err) { say('error', err.message || String(err)) }
    setBusy(false)
  }
  const onDeleteWeek = () => run(() => deleteWeek(week), r => { if (!r.ok) { close(); say('error', r.error); return } go({ d: null, r: null }) })

  const ownWeek = week && !viaWeek && day.kind === 'week'      // a Saturday week with races of its own

  return (
    <div className="an-stack">
      <button type="button" className="an-back" onClick={back}>‹ Race days</button>

      <section className="an-card an-day" aria-label="Race day">
        <div className="an-day__body">
          <div className="an-eyebrow">{dateText(day.date)}</div>
          <h2 className="an-day__title">{(viaWeek && week ? `Saturday League · Week ${week.week_number}` : day.title).replace(' · ', ' · ')}</h2>
          {viaWeek && <div className="an-day__also">Linked to {day.title}</div>}
          {!viaWeek && day.kind === 'festival' && week && <div className="an-day__also">Also Saturday League week {week.week_number}</div>}
          <div className="an-day__lock">{locked ? `Picks locked ${ukClock(lockAt)}` : `Picks lock ${ukClock(lockAt)} · ${lockCountdown(lockAt - now)}`}</div>
          <div><span className={`an-pill an-pill--${status.tone}`}>{status.label}</span>{day.notifiedAt && <span className="an-muted an-day__sent"> · picks-open sent {sentText(day.notifiedAt)}</span>}</div>
        </div>
      </section>

      {viaWeek && <p className="an-note-box">This Saturday is linked to a festival day, so it has no races of its own. The races below belong to <strong>{day.title}</strong> and are managed under the festival.</p>}
      {!viaWeek && day.kind === 'festival' && <p className="an-note-box">Festival days are created and edited in Setup. Races, runners and results are managed here.</p>}

      <section className="an-actions" aria-label="Actions">
        <button type="button" className="an-btn an-btn--ghost" onClick={() => setSheet('lock')} disabled={!detail.races.length}>Lock picks</button>
        <button type="button" className="an-btn an-btn--ghost" onClick={() => (day.notifiedAt ? setSheet('resend') : onNotify())} disabled={busy || !detail.races.length}>{day.notifiedAt ? 'Send picks-open again' : 'Send picks-open'}</button>
        <button type="button" className="an-btn an-btn--ghost" onClick={() => setSheet('recalc')} disabled={!view.done}>Recalculate scores</button>
        <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('import') }}>Import races</button>
        {ownWeek && !week.festival_day_id && <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('editWeek') }}>Edit week</button>}
        {week && <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); openLink() }}>{week.festival_day_id ? 'Unlink Saturday' : 'Link to festival day'}</button>}
        {week && (viaWeek || ownWeek) && <button type="button" className="an-btn an-btn--ghost an-btn--danger" onClick={openDelete} disabled={busy}>Delete week</button>}
      </section>

      <section className="an-card an-card--plain" aria-label="Races">
        <div className="an-listhead">
          <h3 className="an-h3">Races <span className="an-muted an-count">{view.done} of {detail.races.length} done</span></h3>
          <button type="button" className="an-btn an-btn--solid an-btn--sm" onClick={() => { setError(''); setSheet('addRace') }}>+ Add race</button>
        </div>
        {detail.races.length === 0 ? <p className="an-muted">No races yet. Add one, or import a paste of races and runners.</p> : (
          <ul className="an-races">
            {detail.races.map(r => {
              const runners = detail.runners.filter(x => x.race_id === r.id)
              const rules = resultsRules(runners)
              const done = view.resultIds.has(r.id)
              const pill = r.is_abandoned ? { t: 'void', l: 'Abandoned' } : done ? { t: 'done', l: 'Result in ✓' } : { t: 'off', l: 'No result' }
              return (
                <li key={r.id}>
                  <button type="button" className="an-race an-race--tall" onClick={() => go({ r: r.id })}>
                    <span className="an-race__time">{clockText(r.race_time) || 'TBA'}</span>
                    <span className="an-race__main">
                      <span className="an-race__name">{r.race_name || r.venue || `Race ${r.race_number}`}</span>
                      <span className="an-race__sub">Race {r.race_number}{[r.venue && r.race_name ? r.venue : null, r.class_type, r.distance].filter(Boolean).map(x => ` · ${x}`).join('')}</span>
                      <span className="an-race__sub">{plural(rules.ran, 'runner')} · {rules.eachWayAvailable ? `top ${rules.placesPaid} paid` : 'win only'}</span>
                    </span>
                    <span className={`an-pill an-pill--${pill.t}`}>{pill.l}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {sheet === 'lock' && (
        <ConfirmSheet title="Lock picks now?" busy={busy} confirm="Lock picks" onConfirm={onLock} onClose={close}>
          This counts the runners in each race and changes each-way picks to win where each-way is no longer allowed. It does not move the lock time.
        </ConfirmSheet>
      )}
      {sheet === 'resend' && (
        <ConfirmSheet title="Send picks-open notification again?" busy={busy} confirm="Yes, send again" onConfirm={onNotify} onClose={close}>
          It was already sent on {sentText(day.notifiedAt)}. Everyone who has notifications on will get it again.
        </ConfirmSheet>
      )}
      {sheet === 'recalc' && (
        <ConfirmSheet title="Recalculate scores?" busy={busy} confirm="Recalculate" onConfirm={onRecalc} onClose={close}>
          Every race on this day that has a result is scored again from the stored results, bonuses included. Players are not notified.
        </ConfirmSheet>
      )}
      {sheet === 'import' && <ImportSheet day={day} busy={busy} error={error} onImport={onImport} onClose={close} />}
      {sheet === 'addRace' && <RaceSheet kind={day.kind} busy={busy} error={error} onSave={onAddRace} onClose={close} />}
      {sheet === 'editWeek' && week && <WeekSheet week={week} busy={busy} error={error} onSave={onEditWeek} onClose={close} />}
      {sheet === 'link' && week && <LinkSheet week={week} info={linkInfo} busy={busy} error={error} onLink={onLink} onUnlink={onUnlink} onClose={close} />}
      {sheet === 'deleteWeek' && (
        <ConfirmSheet title={`Delete Week ${week.week_number}?`} tone="danger" busy={busy} confirm="Delete week" onConfirm={onDeleteWeek} onClose={close}>
          Week {week.week_number} ({week.saturday_date}) and its races, runners and results will be deleted. Nobody has picked on it. This cannot be undone.
        </ConfirmSheet>
      )}
      {sheet?.blocked && (
        <FormSheet title="This week cannot be deleted" onClose={close}>
          <p className="an-sheet__text">{plural(sheet.blocked, 'pick')} {sheet.blocked === 1 ? 'has' : 'have'} been made on this week. A week with picks is kept so nobody&rsquo;s points disappear.</p>
          <div className="rd-actions rd-actions--stack"><button type="button" className="gr-btn gr-btn--outline" onClick={close} data-autofocus>Close</button></div>
        </FormSheet>
      )}

      {toast && <div className={`an-toast an-toast--${toast.type}`} role="status" key={toast.id}>{toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}</div>}
    </div>
  )
}
