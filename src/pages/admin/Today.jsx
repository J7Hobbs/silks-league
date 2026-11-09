import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Sheet from '../../components/groups/Sheet.jsx'
import WithdrawSheet from '../../components/admin/WithdrawSheet.jsx'
import ResultSheet from './ResultSheet.jsx'
import { ConfirmSheet } from './sheets.jsx'
import { runnersWithoutPrice, planWithdrawal, planReinstate } from '../../lib/raceDay.js'
import { runRunnerAction } from '../../lib/adminRaceDays.js'
import { clockText, lockMs, ukClock, ukDateStr, weekdayShort, monthAbbr } from '../../lib/format.js'
import {
  loadRaceDays, loadDayDetail, alsoThisWeek, isLocked, isRacingNow, lockCountdown, raceStatus, daySummary,
  totalsMismatches, catchUpLocks, lockPicksNow, sendPicksOpen, saveRunnerPrices,
} from '../../lib/adminToday.js'
import '../../styles/groups.css'
import '../../styles/admin-raceday.css'
import '../../styles/admin-new.css'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dateText = d => `${weekdayShort(d)} ${Number(d.slice(8, 10))} ${monthAbbr(d)}`
const sentText = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

export default function Today({ goTab }) {
  const [state, setState] = useState({ status: 'loading' })   // loading | ready | error
  const [detail, setDetail] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null)                    // 'prices' | 'resend' | 'lock' | 'pickRace' | 'findHorse' | { result: race }
  const [runnerSheet, setRunnerSheet] = useState(null)
  const [busy, setBusy] = useState(false)

  const say = (type, text) => setToast({ type, text, id: Date.now() })
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState({ status: 'loading' })
    try {
      const days = await loadRaceDays()
      let det = null
      if (days.current) {
        det = await loadDayDetail(days.current)
        const lockText = await catchUpLocks(days.current, det)
        if (lockText) { say('ok', lockText); det = await loadDayDetail(days.current) }
      }
      setDetail(det)
      setState({ status: 'ready', ...days })
    } catch (err) {
      console.error('[Admin Today] load failed:', err)
      setState({ status: 'error', message: err.message || String(err) })
    }
  }, [])
  useEffect(() => { load() }, [load])

  const day = state.current
  const view = useMemo(() => {
    if (!day || !detail) return null
    const resultIds = new Set(detail.results.map(r => r.race_id))
    const liveRunners = detail.runners.filter(r => !r.is_withdrawn)
    const byRace = {}
    detail.runners.forEach(r => { (byRace[r.race_id] ||= []).push(r) })
    const picked = new Set(detail.picks.map(p => p.user_id)).size
    return {
      resultIds, byRace, picked, runnerCount: liveRunners.length,
      missing: runnersWithoutPrice(detail.races, byRace),
      resultsIn: detail.races.filter(r => resultIds.has(r.id) || r.is_abandoned).length,
      summary: daySummary(detail.scores, detail.awards, detail.usernames),
      mismatches: totalsMismatches(detail.scores, detail.awards),
    }
  }, [day, detail])

  if (state.status === 'loading') return <div className="an-note" role="status">Loading race day…</div>
  if (state.status === 'error') {
    return (
      <div className="an-card an-card--plain">
        <h2 className="an-h2">Could not load Today</h2>
        <p className="an-muted">{state.message}</p>
        <button type="button" className="an-btn an-btn--solid" onClick={() => load()}>Try again</button>
      </div>
    )
  }

  if (!day) {
    return (
      <div className="an-card an-card--plain an-empty">
        <h2 className="an-h2">Nothing scheduled</h2>
        <p className="an-muted">There is no race day coming up. Create a Saturday week or a festival day to see it here.</p>
        <div className="an-row">
          <button type="button" className="an-btn an-btn--solid" onClick={() => goTab('racedays')}>Race days</button>
          <button type="button" className="an-btn an-btn--ghost" onClick={() => goTab('setup')}>Setup</button>
        </div>
      </div>
    )
  }

  const locked = isLocked(day, now)
  const racing = isRacingNow(day, now)
  const earlier = day.date < ukDateStr(now)      // an earlier race day still waiting on results
  const lockAt = lockMs(day.deadline, day.date)
  const lockClock = ukClock(lockAt)
  const lockDay = new Date(lockAt).toISOString().slice(0, 10) === day.date ? '' : `${dateText(day.date)} `
  const noRaces = !detail || detail.races.length === 0
  const others = alsoThisWeek(state.weeks, state.days, state.festivals, day, state.raceCounts)
  const banner = day.festival?.banner_url

  async function refreshAfter(text, type = 'ok') {
    if (text) say(type, text)
    await load(true)
  }

  async function onSend() {
    setBusy(true)
    const r = await sendPicksOpen(day)
    setBusy(false); setSheet(null)
    if (r.ok) refreshAfter('Picks-open notification sent')
    else say('error', `Notification failed to send: ${r.error}`)
  }

  async function onLockNow() {
    setBusy(true)
    const r = await lockPicksNow(day, detail)
    setBusy(false); setSheet(null)
    refreshAfter(r.text, r.ok ? 'ok' : 'error')
  }

  async function onSavePrices(edits) {
    setBusy(true)
    const r = await saveRunnerPrices(day.kind, edits)
    setBusy(false)
    if (!r.ok) return r
    setSheet(null)
    await refreshAfter(`${plural(edits.length, 'price')} saved`)
    return r
  }

  async function openRunnerSheet(mode, runner) {
    const race = detail.races.find(r => r.id === runner.race_id)
    setBusy(true)
    try {
      const plan = mode === 'withdraw'
        ? await planWithdrawal(day.kind, runner, race, { lockIso: day.deadline || null })
        : await planReinstate(day.kind, runner, race)
      setSheet(null)
      setRunnerSheet({ mode, plan })
    } catch (err) {
      say('error', err.message || String(err))
    }
    setBusy(false)
  }

  async function confirmRunnerSheet() {
    const { mode, plan } = runnerSheet
    setBusy(true)
    const r = await runRunnerAction(day.kind, mode, plan, day.deadline)
    const msg = { type: r.ok ? 'ok' : 'error', text: r.text }
    setBusy(false); setRunnerSheet(null)
    refreshAfter(msg.text, msg.type)
  }

  return (
    <div className="an-stack">
      {/* ── The race day ── */}
      <section className={`an-card an-day${banner ? ' an-day--photo' : ''}`} aria-label="Race day">
        {banner && <div className="an-day__photo" style={{ backgroundImage: `url("${String(banner).replace(/"/g, '%22')}")`, backgroundPosition: day.festival.banner_position || 'center' }} aria-hidden="true" />}
        <div className="an-day__body">
          <div className="an-eyebrow">{earlier ? 'Results outstanding' : racing ? 'Racing now' : 'Next race day'} · {dateText(day.date)}</div>
          <h2 className="an-day__title">{day.title.replace(' · ', '\u00a0· ')}</h2>
          {day.linkedWeek && <div className="an-day__also">Also Saturday League week {day.linkedWeek.week_number}</div>}
          <div className="an-day__lock">
            {locked
              ? `Picks locked ${lockDay}${lockClock} · ${plural(view?.picked || 0, 'player')} picked`
              : `Picks lock ${lockDay}${lockClock} · ${lockCountdown(lockAt - now)}`}
          </div>
        </div>
      </section>

      {noRaces ? (
        <section className="an-card an-card--plain">
          <h3 className="an-h3">Races not loaded</h3>
          <p className="an-muted">This race day has no races yet. Loading races is still in the classic Admin until Race days arrives.</p>
          <Link to="/admin/classic" className="an-btn an-btn--ghost">Open classic Admin</Link>
        </section>
      ) : !locked ? (
        <Checklist
          day={day} detail={detail} view={view} lockAt={lockAt} now={now}
          onFixPrices={() => setSheet('prices')}
          onSend={() => (day.notifiedAt ? setSheet('resend') : onSend())}
          onLock={() => setSheet('lock')}
          busy={busy}
        />
      ) : (
        <section className="an-card an-card--plain" aria-label="Races">
          <h3 className="an-h3">Races <span className="an-muted an-count">{view.resultsIn} of {detail.races.length} results in</span></h3>
          <ul className="an-races">
            {detail.races.map(race => {
              const st = raceStatus(race, view.resultIds.has(race.id), day.date, now)
              const winner = detail.results.find(r => r.race_id === race.id && r.position === 1)
              return (
                <li key={race.id}>
                  <button type="button" className="an-race" onClick={() => (race.is_abandoned ? say('error', `Race ${race.race_number} was abandoned. Restore it in Race days to enter a result.`) : setSheet({ result: race }))} data-return={`race-${race.id}`}>
                    <span className="an-race__time">{clockText(race.race_time) || 'TBA'}</span>
                    <span className="an-race__main">
                      <span className="an-race__name">{race.race_name || race.venue || `Race ${race.race_number}`}</span>
                      <span className="an-race__sub">Race {race.race_number}{winner ? ` · Won by ${winner.horse_name}` : ''}</span>
                    </span>
                    <span className={`an-pill an-pill--${st.key}`}>{st.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* ── So far today ── */}
      {(locked || (view?.resultsIn || 0) > 0) && view && (
        <section className="an-card an-card--plain" aria-label="So far today">
          <h3 className="an-h3">So far today</h3>
          <dl className="an-facts">
            <div><dt>Leader</dt><dd>{view.summary.leader ? `${view.summary.leader.name} · ${view.summary.leader.points} pts` : 'No scores yet'}</dd></div>
            <div><dt>Bonuses landed</dt><dd>{view.summary.banker + view.summary.lone + view.summary.treble === 0
              ? 'None yet'
              : [view.summary.banker && `${view.summary.banker} banker`, view.summary.lone && `${view.summary.lone} lone winner`, view.summary.treble && `${view.summary.treble} treble`].filter(Boolean).join(' · ')}</dd></div>
          </dl>
          {view.mismatches.length === 0 ? (
            <div className="an-check an-check--ok">✓ Totals check OK</div>
          ) : (
            <div className="an-check an-check--bad" role="alert">
              <strong>⚠ Totals check: {plural(view.mismatches.length, 'mismatch', 'mismatches')}</strong>
              <ul>
                {view.mismatches.slice(0, 6).map(m => {
                  const race = detail.races.find(r => r.id === m.raceId)
                  return <li key={`${m.userId}|${m.raceId}`}>{detail.usernames[m.userId] || 'A player'} · Race {race?.race_number ?? '?'}: stored {m.total}, should be {m.expected}</li>
                })}
                {view.mismatches.length > 6 && <li>and {view.mismatches.length - 6} more</li>}
              </ul>
              <div className="an-muted">Open the race and save it again to recalculate.</div>
            </div>
          )}
        </section>
      )}

      {/* ── Also this week ── */}
      {others.length > 0 && (
        <section className="an-card an-card--plain" aria-label="Also this week">
          <h3 className="an-h3">Also this week</h3>
          <ul className="an-also">
            {others.map(o => (
              <li key={o.key}>
                <span><span className="an-also__date">{dateText(o.date)}</span> {o.title}</span>
                <span className={`an-pill an-pill--${o.pill.tone}`}>{o.pill.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Quick buttons ── */}
      {!noRaces && (
        <div className="an-quick">
          <button type="button" className="an-btn an-btn--ghost" onClick={() => setSheet('findHorse')}>Non-runner</button>
          <button type="button" className="an-btn an-btn--solid" onClick={() => setSheet('pickRace')}>Enter a result</button>
        </div>
      )}

      {/* ── Sheets ── */}
      {sheet === 'prices' && <PricesSheet missing={view.missing} busy={busy} onSave={onSavePrices} onClose={() => setSheet(null)} />}
      {sheet === 'resend' && (
        <ConfirmSheet title="Send picks-open notification again?" busy={busy} confirm="Yes, send again" onConfirm={onSend} onClose={() => setSheet(null)}>
          It was already sent on {sentText(day.notifiedAt)}. Everyone who has notifications on will get it again.
        </ConfirmSheet>
      )}
      {sheet === 'lock' && (
        <ConfirmSheet title="Lock picks now?" busy={busy} confirm="Lock picks" onConfirm={onLockNow} onClose={() => setSheet(null)}>
          This counts the runners in each race and changes each-way picks to win where each-way is no longer allowed. It does not move the lock time.
        </ConfirmSheet>
      )}
      {sheet === 'pickRace' && (
        <Sheet onClose={() => setSheet(null)} labelledBy="an-pick-title" dragToClose className="an-sheet">
          <h2 className="gr-sheet__title" id="an-pick-title">Enter a result</h2>
          <ul className="an-races an-races--sheet">
            {detail.races.map(race => {
              const st = raceStatus(race, view.resultIds.has(race.id), day.date, now)
              return (
                <li key={race.id}>
                  <button type="button" className="an-race" onClick={() => (race.is_abandoned ? say('error', `Race ${race.race_number} was abandoned. Restore it in Race days to enter a result.`) : setSheet({ result: race }))}>
                    <span className="an-race__time">{clockText(race.race_time) || 'TBA'}</span>
                    <span className="an-race__main"><span className="an-race__name">{race.race_name || race.venue || `Race ${race.race_number}`}</span><span className="an-race__sub">Race {race.race_number}</span></span>
                    <span className={`an-pill an-pill--${st.key}`}>{st.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Sheet>
      )}
      {sheet === 'findHorse' && <FindHorse detail={detail} busy={busy} onPick={(mode, runner) => openRunnerSheet(mode, runner)} onClose={() => setSheet(null)} />}
      {sheet?.result && (
        <ResultSheet
          day={day} race={sheet.result} detail={detail}
          onClose={() => setSheet(null)}
          onSaved={({ ok, text, warn }) => { setSheet(null); refreshAfter(warn ? `${text} · ${warn}` : text, ok && !warn ? 'ok' : 'error') }}
        />
      )}
      {runnerSheet && <WithdrawSheet sheet={runnerSheet} busy={busy} onConfirm={confirmRunnerSheet} onClose={() => { if (!busy) setRunnerSheet(null) }} />}

      {toast && <div className={`an-toast an-toast--${toast.type}`} role="status" key={toast.id}>{toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}</div>}
    </div>
  )
}

// ── Before the lock ─────────────────────────────────────────────────
function Checklist({ day, detail, view, lockAt, now, onFixPrices, onSend, onLock, busy }) {
  const { missing } = view
  const steps = [
    {
      key: 'races', state: 'ok', name: 'Races loaded',
      sub: `${plural(detail.races.length, 'race')} · ${plural(view.runnerCount, 'runner')}`,
    },
    {
      key: 'prices', state: missing.length ? 'warn' : 'ok',
      name: missing.length ? `${plural(missing.length, 'runner')} with no price` : 'Every runner has a price',
      list: missing.map(({ race, runner }) => `Race ${race.race_number} · ${runner.horse_name}`),
      action: missing.length ? <button type="button" className="an-btn an-btn--solid an-btn--sm" onClick={onFixPrices}>Fix prices</button> : null,
    },
    {
      key: 'notify', state: day.notifiedAt ? 'ok' : 'todo', name: 'Picks-open notification',
      sub: day.notifiedAt ? `Sent ${sentText(day.notifiedAt)}` : 'Not sent yet',
      action: day.notifiedAt
        ? <button type="button" className="an-btn an-btn--text an-btn--sm" onClick={onSend} disabled={busy}>Send again</button>
        : <button type="button" className="an-btn an-btn--solid an-btn--sm" onClick={onSend} disabled={busy}>Send now</button>,
    },
    {
      key: 'lock', state: 'todo', name: `Picks lock (${view.picked} of ${detail.players} players picked)`,
      sub: `${ukClock(lockAt)} · ${lockCountdown(lockAt - now)}`,
      action: <button type="button" className="an-btn an-btn--ghost an-btn--sm" onClick={onLock} disabled={busy}>Lock picks now</button>,
    },
    { key: 'results', state: 'todo', name: 'Enter results', sub: `${view.resultsIn} of ${detail.races.length} races` },
  ]
  return (
    <section className="an-card an-card--plain" aria-label="Checklist">
      <h3 className="an-h3">Before the lock</h3>
      <ol className="an-steps">
        {steps.map(s => (
          <li key={s.key} className="an-step">
            <span className={`an-step__mark an-step__mark--${s.state}`} aria-hidden="true">{s.state === 'ok' ? '✓' : s.state === 'warn' ? '!' : ''}</span>
            <div className="an-step__body">
              <div className="an-step__name">{s.name}</div>
              {s.sub && <div className="an-muted">{s.sub}</div>}
              {s.list?.length > 0 && <ul className="an-step__list">{s.list.map(t => <li key={t}>{t}</li>)}</ul>}
              {s.action}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ── Small sheets ────────────────────────────────────────────────────
// Prices for runners that have none. Race days will get full runner editing; this covers the gap.
function PricesSheet({ missing, busy, onSave, onClose }) {
  const [vals, setVals] = useState({})
  const [error, setError] = useState('')
  const filled = missing.filter(({ runner }) => (vals[runner.id] || '').trim())
  async function save() {
    setError('')
    const r = await onSave(filled.map(({ runner }) => ({ id: runner.id, odds: vals[runner.id].trim() })))
    if (r && !r.ok) setError(r.error)
  }
  return (
    <Sheet onClose={() => { if (!busy) onClose() }} labelledBy="an-prices-title" dragToClose className="an-sheet">
      <h2 className="gr-sheet__title" id="an-prices-title">Fix prices</h2>
      <p className="an-muted">Type a price like 7/2 or evens. A runner with no price scores 0.</p>
      <div className="an-prices">
        {missing.map(({ race, runner }) => (
          <label key={runner.id} className="an-price" htmlFor={`an-price-${runner.id}`}>
            <span><strong>Race {race.race_number}</strong> {runner.horse_number ? `${runner.horse_number}. ` : ''}{runner.horse_name}</span>
            <input id={`an-price-${runner.id}`} className="an-input" inputMode="text" autoComplete="off" placeholder="7/2"
              value={vals[runner.id] || ''} onChange={e => { setError(''); setVals(v => ({ ...v, [runner.id]: e.target.value })) }} />
          </label>
        ))}
      </div>
      {error && <div className="an-rs__error" role="alert">{error}</div>}
      <div className="rd-actions rd-actions--stack">
        <button type="button" className="gr-btn gr-btn--solid" onClick={save} disabled={busy || filled.length === 0}>{busy ? 'Saving…' : `Save ${filled.length || ''} price${filled.length === 1 ? '' : 's'}`.replace('  ', ' ')}</button>
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Sheet>
  )
}

// Search a horse across the day's races, then withdraw it or reinstate it.
function FindHorse({ detail, busy, onPick, onClose }) {
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const raceNo = id => detail.races.find(r => r.id === id)?.race_number ?? 0
  const matches = detail.runners
    .filter(r => !term || r.horse_name.toLowerCase().includes(term))
    .sort((a, b) => raceNo(a.race_id) - raceNo(b.race_id) || (a.horse_number ?? 999) - (b.horse_number ?? 999))
    .slice(0, 40)
  return (
    <Sheet onClose={onClose} labelledBy="an-find-title" dragToClose className="an-sheet">
      <h2 className="gr-sheet__title" id="an-find-title">Non-runner</h2>
      <input id="an-find-q" className="an-input an-input--search" placeholder="Search a horse in today's races" value={q}
        onChange={e => setQ(e.target.value)} autoComplete="off" data-autofocus aria-label="Search a horse" />
      <ul className="an-find">
        {matches.map(r => (
          <li key={r.id}>
            <div>
              <div className="an-find__name">{r.horse_name}{r.is_withdrawn ? ' · withdrawn' : ''}</div>
              <div className="an-muted">Race {raceNo(r.race_id)}{r.odds_fractional ? ` · ${r.odds_fractional}` : ''}</div>
            </div>
            <button type="button" className={`an-btn an-btn--sm ${r.is_withdrawn ? 'an-btn--ghost' : 'an-btn--solid'}`} disabled={busy}
              onClick={() => onPick(r.is_withdrawn ? 'reinstate' : 'withdraw', r)}>
              {r.is_withdrawn ? 'Reinstate' : 'Withdraw'}
            </button>
          </li>
        ))}
        {matches.length === 0 && <li className="an-muted">No horse matches “{q}”.</li>}
      </ul>
    </Sheet>
  )
}
