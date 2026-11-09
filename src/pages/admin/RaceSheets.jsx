import { useMemo, useState } from 'react'
import Silk from '../../components/Silk.jsx'
import { FormSheet } from './sheets.jsx'
import { parseRaceBlocks, parseDeclarations, diffDeclarations } from '../../lib/raceImport.js'
import { emptyRunnerForm, runnerToForm } from '../../lib/adminRaceDays.js'
import { SILK_COLOURS, SILK_PATTERNS } from '../../lib/silks.js'
import { clockText } from '../../lib/format.js'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Field({ id, label, children, hint }) {
  return (
    <div className="an-field">
      <label className="an-field__label" htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="an-muted">{hint}</div>}
    </div>
  )
}

const Error_ = ({ children }) => (children ? <div className="an-rs__error" role="alert">{children}</div> : null)

// ── Saturday week: create or change its date ───────────────────────────
export function WeekSheet({ week, busy, error, onSave, onClose }) {
  const [date, setDate] = useState(week?.saturday_date || '')
  const odd = date && new Date(date + 'T12:00:00Z').getUTCDay() !== 6
  return (
    <FormSheet title={week ? `Edit week ${week.week_number}` : 'New Saturday week'} onClose={onClose} busy={busy}>
      <Field id="an-week-date" label="Saturday date" hint={odd ? 'That date is not a Saturday.' : 'Picks lock 30 minutes before the first race, once races are added.'}>
        <input id="an-week-date" type="date" className="an-input" value={date} onChange={e => setDate(e.target.value)} data-autofocus />
      </Field>
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        <button type="button" className="gr-btn gr-btn--solid" onClick={() => onSave(date)} disabled={busy || !date}>{busy ? 'Saving…' : week ? 'Save date' : 'Create week'}</button>
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}

// ── Link a Saturday to a festival day ──────────────────────────────────
export function LinkSheet({ week, info, busy, error, onLink, onUnlink, onClose }) {
  const [pick, setPick] = useState('')
  const linked = info?.linked
  return (
    <FormSheet title={linked ? `Unlink Week ${week.week_number}?` : `Link Week ${week.week_number} to a festival day`} onClose={onClose} busy={busy}>
      {!info ? <div className="an-note">Looking for festival days…</div> : linked ? (
        <p className="an-sheet__text">Linked to <strong>{linked.label}</strong>. Unlinking gives the week its own races again. It only works while nobody has picked on that festival day.</p>
      ) : info.candidates.length === 0 ? (
        <p className="an-sheet__text">There is no free festival day on {week.saturday_date}. A festival day must be on the same Saturday and not already linked.</p>
      ) : (
        <>
          <p className="an-sheet__text">Players make one set of picks on that day&rsquo;s races. The points count for the festival and for this week of the Saturday League. The week has no races of its own, and its lock time follows the festival day.</p>
          <div className="an-choices" role="radiogroup" aria-label="Festival day">
            {info.candidates.map(c => (
              <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} className={`an-choice${pick === c.id ? ' an-choice--on' : ''}`} onClick={() => setPick(c.id)}>
                <span>{c.label}</span><span className="an-muted">{plural(c.raceCount, 'race')} loaded</span>
              </button>
            ))}
          </div>
        </>
      )}
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        {linked
          ? <button type="button" className="gr-btn gr-btn--solid" onClick={onUnlink} disabled={busy}>{busy ? 'Working…' : 'Unlink'}</button>
          : info?.candidates.length > 0 && <button type="button" className="gr-btn gr-btn--solid" onClick={() => onLink(pick)} disabled={busy || !pick}>{busy ? 'Working…' : 'Link'}</button>}
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}

// ── Add or edit a race ─────────────────────────────────────────────────
export function RaceSheet({ kind, race, busy, error, onSave, onClose }) {
  const [f, setF] = useState(() => ({
    race_number: race?.race_number ?? '', venue: race?.venue || '', race_name: race?.race_name || '', race_time: clockText(race?.race_time) || '',
    class_type: race?.class_type || '', distance: race?.distance || '',
  }))
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  return (
    <FormSheet title={race ? `Edit race ${race.race_number}` : 'Add a race'} onClose={onClose} busy={busy}>
      <Field id="an-race-venue" label="Venue"><input id="an-race-venue" className="an-input" value={f.venue} onChange={e => set('venue', e.target.value)} data-autofocus autoComplete="off" /></Field>
      <Field id="an-race-name" label="Race name"><input id="an-race-name" className="an-input" value={f.race_name} onChange={e => set('race_name', e.target.value)} autoComplete="off" /></Field>
      <div className="an-grid2">
        <Field id="an-race-time" label="Off time (UK)"><input id="an-race-time" className="an-input" inputMode="numeric" placeholder="13:50" value={f.race_time} onChange={e => set('race_time', e.target.value)} autoComplete="off" /></Field>
        {race && <Field id="an-race-num" label="Race number"><input id="an-race-num" className="an-input" inputMode="numeric" value={f.race_number} onChange={e => set('race_number', e.target.value)} autoComplete="off" /></Field>}
      </div>
      <div className="an-grid2">
        {kind === 'week' && <Field id="an-race-class" label="Class (optional)"><input id="an-race-class" className="an-input" placeholder="Class 3" value={f.class_type} onChange={e => set('class_type', e.target.value)} autoComplete="off" /></Field>}
        <Field id="an-race-dist" label="Distance (optional)"><input id="an-race-dist" className="an-input" placeholder="2m 4f" value={f.distance} onChange={e => set('distance', e.target.value)} autoComplete="off" /></Field>
      </div>
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        <button type="button" className="gr-btn gr-btn--solid" onClick={() => onSave(f)} disabled={busy}>{busy ? 'Saving…' : race ? 'Save race' : 'Add race'}</button>
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}

// ── Add or edit a runner, with the silk colour picker ──────────────────
function Swatches({ label, value, onChange }) {
  return (
    <div className="an-field">
      <span className="an-field__label">{label}</span>
      <div className="an-swatches">
        {SILK_COLOURS.map(c => (
          <button key={c.hex} type="button" className={`an-sw${value === c.hex ? ' an-sw--on' : ''}`} style={{ background: c.hex }}
            title={c.label} aria-label={c.label} aria-pressed={value === c.hex} onClick={() => onChange(value === c.hex ? '' : c.hex)} />
        ))}
      </div>
    </div>
  )
}

export function RunnerSheet({ kind, runner, busy, error, onSave, onWithdraw, onReinstate, onRemove, onClose }) {
  const [f, setF] = useState(() => (runner ? runnerToForm(runner) : emptyRunnerForm()))
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const preview = { silk_colour: f.colour || '#1a3a10', silk_colour_secondary: f.colour2 || null, silk_pattern: f.pattern || null }
  return (
    <FormSheet title={runner ? runner.horse_name : 'Add a runner'} onClose={onClose} busy={busy}>
      <div className="an-grid2 an-grid2--num">
        <Field id="an-run-num" label="Number"><input id="an-run-num" className="an-input" inputMode="numeric" value={f.number} onChange={e => set('number', e.target.value)} autoComplete="off" /></Field>
        <Field id="an-run-name" label="Horse"><input id="an-run-name" className="an-input" value={f.name} onChange={e => set('name', e.target.value)} autoComplete="off" data-autofocus={!runner || undefined} /></Field>
      </div>
      <div className="an-grid2">
        <Field id="an-run-jockey" label="Jockey"><input id="an-run-jockey" className="an-input" value={f.jockey} onChange={e => set('jockey', e.target.value)} autoComplete="off" /></Field>
        <Field id="an-run-trainer" label="Trainer"><input id="an-run-trainer" className="an-input" value={f.trainer} onChange={e => set('trainer', e.target.value)} autoComplete="off" /></Field>
      </div>
      <div className="an-grid2">
        <Field id="an-run-odds" label="Price"><input id="an-run-odds" className="an-input" placeholder="7/2" value={f.odds} onChange={e => set('odds', e.target.value)} autoComplete="off" /></Field>
        {kind === 'week' && <Field id="an-run-form" label="Form"><input id="an-run-form" className="an-input" placeholder="1-2-3" value={f.form} onChange={e => set('form', e.target.value)} autoComplete="off" /></Field>}
      </div>
      <div className="an-silkrow">
        <Silk runner={preview} style={{ width: 44, height: 44 }} />
        <Field id="an-run-pattern" label="Markings">
          <select id="an-run-pattern" className="an-input" value={f.pattern || 'plain'} onChange={e => set('pattern', e.target.value)}>
            {SILK_PATTERNS.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </Field>
      </div>
      <Swatches label="Silk colour" value={f.colour} onChange={v => set('colour', v)} />
      <Swatches label="Markings colour" value={f.colour2} onChange={v => set('colour2', v)} />
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        <button type="button" className="gr-btn gr-btn--solid" onClick={() => onSave(f)} disabled={busy}>{busy ? 'Saving…' : runner ? 'Save runner' : 'Add runner'}</button>
        {runner && (runner.is_withdrawn
          ? <button type="button" className="gr-btn gr-btn--outline" onClick={onReinstate} disabled={busy}>Reinstate</button>
          : <button type="button" className="gr-btn gr-btn--outline" onClick={onWithdraw} disabled={busy}>Withdraw (non-runner)</button>)}
        {runner && <button type="button" className="an-btn an-btn--text an-btn--danger" onClick={onRemove} disabled={busy}>Remove runner</button>}
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}

// ── Bulk import: paste, preview, then save ─────────────────────────────
const SAMPLE = `venue: Wincanton
time: 13:50
race_name: Novices' Hurdle
class: Class 3
distance: 2m 4f

1, Horse Name, J Smith, T Jones, 7/2, #1a3a7a, #f1c40f, hoops
2, Another Horse, A Rider, B Trainer, evens, #5a1010`

export function ImportSheet({ day, busy, error, onImport, onClose }) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const warnings = parsed?.races.flatMap(r => r.warnings) || []
  const ok = parsed && !parsed.errors.length && parsed.races.length > 0
  return (
    <FormSheet title={`Import races · ${day.kind === 'week' ? 'Saturday week' : 'festival day'}`} onClose={onClose} busy={busy}>
      <Field id="an-import-text" label="Paste the race" hint="Race details, a blank line, then one runner per line. Put --- between races to paste several.">
        <textarea id="an-import-text" className="an-input an-input--area" rows={9} spellCheck={false} placeholder={SAMPLE} value={text}
          onChange={e => { setText(e.target.value); setParsed(null) }} data-autofocus />
      </Field>
      <details className="an-help">
        <summary>Runner line format</summary>
        <p className="an-muted">number, horse, jockey, trainer, price, silk colour, markings colour, markings. The last two are optional. Use TBA for anything not known yet.</p>
      </details>
      {!parsed && <button type="button" className="gr-btn gr-btn--outline" onClick={() => setParsed(parseRaceBlocks(text))} disabled={!text.trim()}>Preview</button>}
      {parsed?.errors.length > 0 && <div className="an-rs__error" role="alert"><strong>Fix these first</strong><ul className="an-bullets">{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {warnings.length > 0 && <div className="an-warnbox" role="status"><strong>{plural(warnings.length, 'warning')}</strong><ul className="an-bullets">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      {ok && parsed.races.map((r, i) => (
        <div key={i} className="an-previewrace">
          <div className="an-previewrace__head"><strong>{r.header.time}</strong> · {r.header.race_name}</div>
          <div className="an-muted">{[r.header.venue, r.header.class, r.header.distance].filter(Boolean).join(' · ')} · {plural(r.runners.length, 'runner')}</div>
          <ul className="an-runnerlist an-runnerlist--tight">
            {r.runners.map(x => (
              <li key={x.horse_name}>
                <Silk runner={x} style={{ width: 22, height: 22 }} />
                <span className="an-runnerlist__main">{x.horse_number ? `${x.horse_number}. ` : ''}{x.horse_name}<span className="an-muted"> {x.jockey}</span></span>
                <span className={x.odds_fractional ? 'an-price-tag' : 'an-price-tag an-price-tag--none'}>{x.odds_fractional || 'No price'}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        {parsed && <button type="button" className="gr-btn gr-btn--solid" onClick={() => onImport(parsed.races)} disabled={busy || !ok}>{busy ? 'Importing…' : ok ? `Import ${plural(parsed.races.length, 'race')}` : 'Import'}</button>}
        {parsed && <button type="button" className="gr-btn gr-btn--outline" onClick={() => setParsed(null)} disabled={busy}>Edit paste</button>}
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}

// ── Update to final declarations ───────────────────────────────────────
// `runners` are the race's runners; `picks` maps runner id to how many picks it has; `locked` is whether picks have locked.
export function DeclarationsSheet({ race, runners, picks, locked, busy, error, onApply, onClose }) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const diff = useMemo(() => (parsed && !parsed.errors.length ? diffDeclarations(runners, parsed.runners) : null), [parsed, runners])
  const removedWithPicks = diff ? diff.removed.filter(r => picks[r.id]) : []
  const pickCount = removedWithPicks.reduce((n, r) => n + picks[r.id], 0)
  const changes = diff ? diff.updated.length + diff.added.length + diff.removed.length + diff.revived.length : 0
  return (
    <FormSheet title={`Final declarations · Race ${race.race_number}`} onClose={onClose} busy={busy}>
      <Field id="an-decl-text" label="Paste the final card" hint="One runner per line, the same format as the import: number, horse, jockey, trainer, price, colour.">
        <textarea id="an-decl-text" className="an-input an-input--area" rows={8} spellCheck={false} placeholder="1, Horse Name, J Smith, T Jones, 7/2, #1a3a7a" value={text}
          onChange={e => { setText(e.target.value); setParsed(null) }} data-autofocus />
      </Field>
      {!parsed && <button type="button" className="gr-btn gr-btn--outline" onClick={() => setParsed(parseDeclarations(text))} disabled={!text.trim()}>Preview changes</button>}
      {parsed?.errors.length > 0 && <div className="an-rs__error" role="alert"><strong>Fix these first</strong><ul className="an-bullets">{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {diff && (
        <div className="an-diff">
          {diff.warnings.map((w, i) => <div key={i} className="an-warnbox" role="alert">{w}</div>)}
          {removedWithPicks.length > 0 && (
            <div className="an-rs__error" role="alert">
              <strong>{plural(pickCount, 'pick')} on {removedWithPicks.map(r => r.horse_name).join(', ')}.</strong> {pickCount === 1 ? 'That pick moves' : 'Those picks move'} to the favourite and the players are notified, the same as a non-runner.
            </div>
          )}
          {diff.updated.length > 0 && (
            <section><h4 className="an-diff__h">Updated · {diff.updated.length}</h4>
              <ul className="an-difflist">{diff.updated.map(u => (
                <li key={u.runner.id}><strong>{u.runner.horse_name}</strong>
                  {u.changes.map(c => <span key={c.field} className="an-chg">{c.field}: {c.from ?? 'none'} → <b>{c.to}</b></span>)}
                </li>))}</ul></section>
          )}
          {diff.removed.length > 0 && (
            <section><h4 className="an-diff__h an-diff__h--bad">Removed · {diff.removed.length}</h4>
              <ul className="an-difflist">{diff.removed.map(r => (
                <li key={r.id}><strong>{r.horse_name}</strong>
                  <span className="an-chg">{picks[r.id] ? `${plural(picks[r.id], 'pick')} will be moved` : locked ? 'withdrawn (picks have locked)' : 'no picks, removed from the card'}</span>
                </li>))}</ul></section>
          )}
          {diff.added.length > 0 && (
            <section><h4 className="an-diff__h an-diff__h--ok">Added · {diff.added.length}</h4>
              <ul className="an-difflist">{diff.added.map(a => (
                <li key={a.horse_name}><strong>{a.horse_name}</strong><span className="an-chg">{[a.horse_number && `No. ${a.horse_number}`, a.jockey !== 'TBA' && a.jockey, a.odds_fractional || 'no price'].filter(Boolean).join(' · ')}</span></li>))}</ul></section>
          )}
          {diff.revived.length > 0 && (
            <section><h4 className="an-diff__h">Back in the race · {diff.revived.length}</h4>
              <ul className="an-difflist">{diff.revived.map(r => <li key={r.id}><strong>{r.horse_name}</strong><span className="an-chg">was withdrawn, is on the final card</span></li>)}</ul></section>
          )}
          <p className="an-muted">{plural(diff.unchanged.length, 'horse')} unchanged.{changes === 0 ? ' Nothing to apply.' : ''}</p>
        </div>
      )}
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        {diff && <button type="button" className="gr-btn gr-btn--solid" onClick={() => onApply(diff)} disabled={busy || changes === 0}>{busy ? 'Applying…' : removedWithPicks.length ? 'Apply and move picks' : 'Apply changes'}</button>}
        {parsed && <button type="button" className="gr-btn gr-btn--outline" onClick={() => setParsed(null)} disabled={busy}>Edit paste</button>}
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}
