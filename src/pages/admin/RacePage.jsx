import { useMemo, useState } from 'react'
import Silk from '../../components/Silk.jsx'
import WithdrawSheet from '../../components/admin/WithdrawSheet.jsx'
import ResultSheet from './ResultSheet.jsx'
import { ConfirmSheet } from './sheets.jsx'
import { RaceSheet, RunnerSheet, DeclarationsSheet } from './RaceSheets.jsx'
import {
  updateRace, deleteRace, saveRunner, removeRunner, runRunnerAction, planWithdrawal, planReinstate, applyDeclarations, abandonRace, restoreRace,
} from '../../lib/adminRaceDays.js'
import { isLocked } from '../../lib/adminToday.js'
import { resultsRules } from '../../lib/raceDay.js'
import { clockText } from '../../lib/format.js'
import { plural } from '../../lib/adminFmt.js'
import '../../styles/admin-new.css'

const priceText = r => r.odds_fractional || 'No price'

// One race: its runners and everything you can do to it. `onChanged(text, ok)` reloads the day and shows a toast.
export default function RacePage({ day, race, detail, onBack, onChanged }) {
  const runners = useMemo(
    () => detail.runners.filter(r => r.race_id === race.id).sort((a, b) => (a.horse_number ?? 999) - (b.horse_number ?? 999)),
    [detail, race.id],
  )
  const results = detail.results.filter(r => r.race_id === race.id)
  const hasResult = results.length > 0
  const rules = resultsRules(runners)
  const locked = isLocked(day)
  const picksOn = useMemo(() => {
    const out = {}
    detail.picks.filter(p => p.race_id === race.id).forEach(p => { out[p.runner_id] = (out[p.runner_id] || 0) + 1 })
    return out
  }, [detail, race.id])
  const totalPicks = Object.values(picksOn).reduce((a, b) => a + b, 0)
  const winner = results.find(r => r.position === 1)

  const [sheet, setSheet] = useState(null)         // 'result' | 'decl' | 'edit' | 'abandon' | 'restore' | 'delete' | 'newRunner' | { runner }
  const [withdraw, setWithdraw] = useState(null)   // { mode, plan }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => { setSheet(null); setError('') }

  async function run(fn, after) {
    setBusy(true); setError('')
    const r = await fn()
    setBusy(false)
    return after(r)
  }

  const onEdit = f => run(() => updateRace(day, race, f, detail.races), r => { if (!r.ok) { setError(r.error); return } close(); onChanged('Race updated') })
  const onDelete = () => run(() => deleteRace(day, race), r => { if (!r.ok) { close(); onChanged(r.error, false); return } onBack(); onChanged(`Race ${race.race_number} deleted`) })
  const onAbandon = () => run(() => abandonRace(day, race), r => { close(); onChanged(r.warn ? `${r.text} · ${r.warn}` : r.text, r.ok) })
  const onRestore = () => run(() => restoreRace(day, race), r => { close(); onChanged(r.text, r.ok) })
  const onSaveRunner = (runner, f) => run(() => saveRunner(day.kind, race.id, runner?.id || null, f), r => { if (!r.ok) { setError(r.error); return } close(); onChanged(runner ? 'Runner updated' : 'Runner added') })
  const onRemoveRunner = runner => run(() => removeRunner(day.kind, runner), r => { if (!r.ok) { setError(r.error); return } close(); onChanged(`${runner.horse_name} removed`) })
  const onApply = diff => run(() => applyDeclarations(day, race, diff, { lockIso: day.deadline || null, locked }), r => {
    if (!r.ok && !r.errors?.length) { setError(r.text); return }
    close(); onChanged(r.errors?.length ? `${r.text} · ${r.errors.join(' · ')}` : r.text, r.ok)
  })

  async function openWithdraw(mode, runner) {
    setBusy(true); setError('')
    try {
      const plan = mode === 'withdraw'
        ? await planWithdrawal(day.kind, runner, race, { lockIso: day.deadline || null })
        : await planReinstate(day.kind, runner, race)
      setSheet(null); setWithdraw({ mode, plan })
    } catch (err) { setError(err.message || String(err)) }
    setBusy(false)
  }
  async function confirmWithdraw() {
    setBusy(true)
    const r = await runRunnerAction(day.kind, withdraw.mode, withdraw.plan, day.deadline)
    setBusy(false); setWithdraw(null)
    onChanged(r.text, r.ok)
  }

  return (
    <div className="an-stack">
      <button type="button" className="an-back" onClick={onBack}>‹ {day.title}</button>

      <section className="an-card an-day" aria-label="Race">
        <div className="an-day__body">
          <div className="an-eyebrow">Race {race.race_number} · {clockText(race.race_time) || 'time TBA'}</div>
          <h2 className="an-day__title">{race.race_name || race.venue || `Race ${race.race_number}`}</h2>
          <div className="an-muted">{[race.venue, race.class_type, race.distance].filter(Boolean).join(' · ') || ' '}</div>
          <div className="an-rs__facts">
            <span>{plural(rules.ran, 'runner')}</span>
            <span>{rules.eachWayAvailable ? `Places paid: top ${rules.placesPaid}` : 'Win only'}</span>
            <span>{plural(totalPicks, 'pick')}</span>
          </div>
          <div>
            {race.is_abandoned ? <span className="an-pill an-pill--void">Abandoned</span>
              : hasResult ? <span className="an-pill an-pill--done">Result in ✓ {winner ? `· ${winner.horse_name}` : ''}</span>
              : <span className="an-pill an-pill--off">No result yet</span>}
          </div>
        </div>
      </section>

      {race.is_abandoned && <p className="an-note-box">This race was abandoned. Every pick scored 0, banker included, and it shows as Abandoned in the app. Restore it if that was a mistake.</p>}

      <section className="an-actions" aria-label="Actions">
        {!race.is_abandoned && <button type="button" className="an-btn an-btn--solid" onClick={() => setSheet('result')} disabled={!rules.ran}>{hasResult ? 'Correct result' : 'Enter result'}</button>}
        {!race.is_abandoned && <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('decl') }}>Final declarations</button>}
        <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('edit') }}>Edit race</button>
        {race.is_abandoned
          ? <button type="button" className="an-btn an-btn--ghost" onClick={() => setSheet('restore')}>Restore race</button>
          : <button type="button" className="an-btn an-btn--ghost an-btn--danger" onClick={() => setSheet('abandon')}>Abandon race</button>}
        <button type="button" className="an-btn an-btn--ghost an-btn--danger" onClick={() => setSheet('delete')}>Delete race</button>
      </section>

      <section className="an-card an-card--plain" aria-label="Runners">
        <div className="an-listhead">
          <h3 className="an-h3">Runners <span className="an-muted an-count">{runners.length}</span></h3>
          <button type="button" className="an-btn an-btn--solid an-btn--sm" onClick={() => { setError(''); setSheet('newRunner') }}>+ Add runner</button>
        </div>
        {runners.length === 0 ? <p className="an-muted">No runners yet.</p> : (
          <ul className="an-runnerlist">
            {runners.map(r => (
              <li key={r.id}>
                <button type="button" className={`an-runner${r.is_withdrawn ? ' an-runner--out' : ''}`} onClick={() => { setError(''); setSheet({ runner: r }) }}>
                  <span className="an-runner__num">{r.horse_number ?? '–'}</span>
                  <Silk runner={r} style={{ width: 28, height: 28, flex: 'none' }} />
                  <span className="an-runner__main">
                    <span className="an-runner__name">{r.horse_name}{r.is_withdrawn && <span className="an-tag an-tag--out">Withdrawn</span>}</span>
                    <span className="an-race__sub">{[r.jockey, r.trainer].filter(Boolean).join(' · ') || 'No jockey or trainer'}{picksOn[r.id] ? ` · ${plural(picksOn[r.id], 'pick')}` : ''}</span>
                  </span>
                  <span className={r.odds_fractional ? 'an-price-tag' : 'an-price-tag an-price-tag--none'}>{priceText(r)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sheet === 'result' && (
        <ResultSheet day={day} race={race} detail={detail} onClose={close}
          onSaved={({ ok, text, warn }) => { close(); onChanged(warn ? `${text} · ${warn}` : text, ok && !warn) }} />
      )}
      {sheet === 'decl' && <DeclarationsSheet race={race} runners={runners} picks={picksOn} locked={locked} busy={busy} error={error} onApply={onApply} onClose={close} />}
      {sheet === 'edit' && <RaceSheet kind={day.kind} race={race} busy={busy} error={error} onSave={onEdit} onClose={close} />}
      {sheet === 'newRunner' && <RunnerSheet kind={day.kind} busy={busy} error={error} onSave={f => onSaveRunner(null, f)} onClose={close} />}
      {sheet?.runner && (
        <RunnerSheet kind={day.kind} runner={sheet.runner} busy={busy} error={error} onClose={close}
          onSave={f => onSaveRunner(sheet.runner, f)}
          onWithdraw={() => openWithdraw('withdraw', sheet.runner)}
          onReinstate={() => openWithdraw('reinstate', sheet.runner)}
          onRemove={() => onRemoveRunner(sheet.runner)} />
      )}
      {sheet === 'abandon' && (
        <ConfirmSheet title={`Abandon Race ${race.race_number}?`} tone="danger" busy={busy} confirm="Abandon race" onConfirm={onAbandon} onClose={close}>
          <ul className="an-bullets">
            <li>The race is voided: all {plural(totalPicks, 'pick')} score 0, a banker included.</li>
            {hasResult && <li>Its saved result is removed.</li>}
            <li>The day&rsquo;s bonuses are recalculated without it.</li>
            <li>It shows as Abandoned in Admin and in the app. Players are not notified.</li>
          </ul>
        </ConfirmSheet>
      )}
      {sheet === 'restore' && (
        <ConfirmSheet title={`Restore Race ${race.race_number}?`} busy={busy} confirm="Restore race" onConfirm={onRestore} onClose={close}>
          The race is a normal race again with no result. The 0-point scores are cleared and the day&rsquo;s bonuses are recalculated. Enter its result when it is in.
        </ConfirmSheet>
      )}
      {sheet === 'delete' && (
        <ConfirmSheet title={`Delete Race ${race.race_number}?`} tone="danger" busy={busy} confirm="Delete race" onConfirm={onDelete} onClose={close}>
          {totalPicks > 0
            ? `${plural(totalPicks, 'pick')} ${totalPicks === 1 ? 'has' : 'have'} been made on this race, so it cannot be deleted. Use Abandon race instead.`
            : 'The race and all its runners and results will be deleted. This cannot be undone.'}
        </ConfirmSheet>
      )}
      {withdraw && <WithdrawSheet sheet={withdraw} busy={busy} onConfirm={confirmWithdraw} onClose={() => { if (!busy) setWithdraw(null) }} />}
    </div>
  )
}
