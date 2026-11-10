import { useCallback, useEffect, useMemo, useState } from 'react'
import Silk from '../../components/Silk.jsx'
import { supabase } from '../../lib/supabase'
import { ConfirmSheet, FormSheet } from './sheets.jsx'
import { Field, Swatches } from './RaceSheets.jsx'
import { resolveDay, loadDayRaces, getOwnerSilks, saveOwnerSilks, updateDraft } from '../../lib/agentData.js'
import {
  racecardFlags, racecardSummary, resolveSilks, editDraftRunner, editDraftRace, removeDraftRunner, approveRacecard, rejectDraft,
} from '../../lib/agentRacecard.js'
import { SILK_PATTERNS } from '../../lib/silks.js'
import { dateText, plural } from '../../lib/adminFmt.js'
import '../../styles/admin-new.css'

const Error_ = ({ children }) => (children ? <div className="an-rs__error" role="alert">{children}</div> : null)
const SEV = { block: 'warn', action: 'gold', warn: 'off' }
const SEV_LABEL = { block: 'Blocks approval', action: 'Needs doing', warn: 'Check' }

// A racecard the agent collected: read it through, fix what is wrong, choose silks for new owners, then approve it (the week is
// created if needed, the races and runners are imported, picks-open goes out) or reject it.
export default function DraftReview({ id, onBack }) {
  const [state, setState] = useState({ status: 'loading' })
  const [sheet, setSheet] = useState(null)          // { runner: [ri, ui] } | { race: ri } | { owner } | 'approve' | 'reject'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)            // { ok, text, warn }

  const load = useCallback(async () => {
    try {
      const { data: draft, error: err } = await supabase.from('agent_drafts').select('*').eq('id', id).maybeSingle()
      if (err) throw err
      if (!draft) throw new Error('That draft no longer exists.')
      const ids = [...new Set((draft.payload?.races || []).flatMap(r => r.runners.map(u => u.owner_id)).filter(Boolean))]
      const library = await getOwnerSilks(ids)
      const res = draft.kind === 'racecard' ? await resolveDay(draft.payload.date, draft.payload.day) : { day: null }
      const existing = res.day ? (await loadDayRaces(res.day)).races.length : 0
      setState({ status: 'ready', draft, library, day: res.day || null, dayError: res.error || '', existing })
    } catch (err) {
      console.error('[Admin review] load failed:', err)
      setState({ status: 'error', message: err.message || String(err) })
    }
  }, [id])
  useEffect(() => { load() }, [load])

  const { draft, library, day, existing } = state
  const payload = draft?.payload
  const flags = useMemo(() => (payload?.races ? racecardFlags(payload, { library, existingRaces: existing }) : []), [payload, library, existing])
  const summary = useMemo(() => (payload?.races ? racecardSummary(payload, flags) : null), [payload, flags])

  if (state.status === 'loading') return <div className="an-note" role="status">Loading the racecard…</div>
  if (state.status === 'error') {
    return (
      <div className="an-card an-card--plain">
        <h2 className="an-h2">Could not load the racecard</h2>
        <p className="an-muted">{state.message}</p>
        <div className="an-row">
          <button type="button" className="an-btn an-btn--solid" onClick={() => { setState({ status: 'loading' }); load() }}>Try again</button>
          <button type="button" className="an-btn an-btn--ghost" onClick={onBack}>Back to Today</button>
        </div>
      </div>
    )
  }
  if (draft.kind !== 'racecard') {
    return (
      <div className="an-stack">
        <button type="button" className="an-back" onClick={onBack}>‹ Today</button>
        <p className="an-note-box">Morning checks and results are approved from the list on Today.</p>
      </div>
    )
  }

  const pending = draft.status === 'pending'
  const blocked = flags.some(f => f.severity === 'block') || !!state.dayError
  const owners = flags.filter(f => f.type === 'new_owner')
  const title = day ? day.title : `Saturday League · ${dateText(payload.date)}`

  async function save(next, nextFlags) {
    const row = await updateDraft(draft.id, { payload: next, flags: nextFlags }, { onlyStatus: 'pending' })
    if (!row) throw new Error('The draft could not be saved (is it still waiting for review?).')
    setState(s => ({ ...s, draft: row }))
  }
  async function edit(result) {
    if (!result.ok) { setError(result.error); return }
    setBusy(true); setError('')
    try { await save(result.payload, racecardFlags(result.payload, { library, existingRaces: existing })); setSheet(null) }
    catch (err) { setError(err.message || String(err)) }
    setBusy(false)
  }
  async function saveOwner(o, f) {
    setBusy(true); setError('')
    const r = await saveOwnerSilks([{ owner_id: o.owner_id, owner_name: o.owner_name, silk_colour: f.colour, silk_colour_secondary: f.colour2, silk_pattern: f.pattern }])
    setBusy(false)
    if (!r.ok) { setError(r.error || 'The silks could not be saved.'); return }
    if (!r.saved) { setError('Choose at least a colour or markings first.'); return }
    setSheet(null)
    setState(s => ({ ...s, library: { ...s.library, [o.owner_id]: { owner_id: o.owner_id, owner_name: o.owner_name, silk_colour: f.colour || null, silk_colour_secondary: f.colour2 || null, silk_pattern: f.pattern && f.pattern !== 'plain' ? f.pattern : null } } }))
  }
  async function approve() {
    setBusy(true); setError('')
    const userId = (await supabase.auth.getUser()).data?.user?.id || null
    const r = await approveRacecard(draft.id, { userId })
    setBusy(false); setSheet(null)
    setDone(r.ok ? { ok: true, text: r.text, warn: r.warn } : { ok: false, text: r.error })
    if (!r.ok) load()
  }
  async function reject() {
    setBusy(true)
    const userId = (await supabase.auth.getUser()).data?.user?.id || null
    const r = await rejectDraft(draft.id, { userId })
    setBusy(false); setSheet(null)
    setDone(r.ok ? { ok: true, text: 'Racecard rejected. Nothing was changed.' } : { ok: false, text: r.error })
  }

  if (done?.ok) {
    return (
      <div className="an-stack">
        <section className="an-card an-card--plain ag-card ag-card--gold">
          <div className="an-eyebrow">{done.text.startsWith('Racecard rejected') ? 'Rejected' : 'Approved'}</div>
          <h2 className="an-h2">{done.text}</h2>
          {done.warn && <p className="an-warnbox" role="alert">{done.warn}</p>}
          <button type="button" className="an-btn an-btn--solid" onClick={onBack}>Back to Today</button>
        </section>
      </div>
    )
  }

  return (
    <div className="an-stack">
      <button type="button" className="an-back" onClick={onBack}>‹ Today</button>

      <section className="an-card an-day" aria-label="Racecard">
        <div className="an-day__body">
          <div className="an-eyebrow">Racecard to review · {dateText(payload.date)}</div>
          <h2 className="an-day__title">{title.replace(' · ', ' · ')}</h2>
          <div className="an-muted">
            {plural(summary.races, 'race')} · {plural(summary.runners, 'runner')}
            {!day && !state.dayError && ' · the Saturday week is created when you approve'}
          </div>
          {!pending && <div><span className={`an-pill an-pill--${draft.status === 'applied' ? 'done' : 'off'}`}>{draft.status === 'applied' ? 'Approved' : draft.status[0].toUpperCase() + draft.status.slice(1)}</span></div>}
        </div>
      </section>

      {done && !done.ok && <div className="ag-notice ag-notice--bad" role="alert">⚠ {done.text}</div>}
      {state.dayError && <div className="ag-notice ag-notice--bad" role="alert">⚠ {state.dayError}</div>}
      {draft.note && pending && <div className="ag-notice ag-notice--bad" role="status">{draft.note}</div>}

      {flags.length > 0 && (
        <section className="an-card an-card--plain" aria-label="Flags">
          <h3 className="an-h3">To check <span className="an-muted an-count">{flags.length}</span></h3>
          <ul className="ag-flags">
            {flags.map((f, i) => (
              <li key={i}>
                <span className={`an-pill an-pill--${SEV[f.severity]}`}>{SEV_LABEL[f.severity]}</span>
                <span>{f.message}</span>
                {f.type === 'new_owner' && pending && <button type="button" className="an-btn an-btn--ghost an-btn--sm" onClick={() => { setError(''); setSheet({ owner: f }) }}>Choose silks</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {payload.races.map((race, ri) => (
        <section key={ri} className="an-card an-card--plain" aria-label={`Race ${ri + 1}`}>
          <div className="an-listhead">
            <div>
              <div className="an-eyebrow">Race {ri + 1} · {race.race_time}</div>
              <h3 className="an-h3">{race.race_name}</h3>
              <div className="an-muted">{[race.venue, race.class_type, race.distance].filter(Boolean).join(' · ')} · {plural(race.runners.length, 'runner')}</div>
            </div>
            {pending && <button type="button" className="an-btn an-btn--text an-btn--sm" onClick={() => { setError(''); setSheet({ race: ri }) }}>Edit</button>}
          </div>
          <ul className="an-runnerlist">
            {race.runners.map((u, ui) => (
              <li key={u.number}>
                <button type="button" className="an-runner" onClick={() => { setError(''); setSheet({ runner: [ri, ui] }) }} disabled={!pending}>
                  <span className="an-runner__num">{u.number}</span>
                  <Silk runner={resolveSilks(u, library)} style={{ width: 28, height: 28, flex: 'none' }} />
                  <span className="an-runner__main">
                    <span className="an-runner__name">{u.horse}</span>
                    <span className="an-race__sub">{[u.jockey, u.trainer].filter(Boolean).join(' · ') || 'No jockey or trainer'}{u.owner_name ? ` · ${u.owner_name}` : ''}</span>
                  </span>
                  <span className={u.price ? 'an-price-tag' : 'an-price-tag an-price-tag--none'}>{u.price || 'No price'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {pending && (
        <div className="ag-sticky">
          <button type="button" className="an-btn an-btn--solid" onClick={() => setSheet('approve')} disabled={blocked || busy}>Approve &amp; notify players</button>
          <button type="button" className="an-btn an-btn--ghost an-btn--danger" onClick={() => setSheet('reject')} disabled={busy}>Reject</button>
        </div>
      )}

      {sheet?.runner && (
        <RunnerEdit runner={payload.races[sheet.runner[0]].runners[sheet.runner[1]]} busy={busy} error={error} onClose={() => setSheet(null)}
          onSave={f => edit(editDraftRunner(payload, sheet.runner[0], sheet.runner[1], f))}
          onRemove={() => edit(removeDraftRunner(payload, sheet.runner[0], sheet.runner[1]))} />
      )}
      {sheet && typeof sheet === 'object' && 'race' in sheet && (
        <RaceEdit race={payload.races[sheet.race]} busy={busy} error={error} onClose={() => setSheet(null)} onSave={f => edit(editDraftRace(payload, sheet.race, f))} />
      )}
      {sheet?.owner && <OwnerSilks owner={sheet.owner} library={library} busy={busy} error={error} onSave={f => saveOwner(sheet.owner, f)} onClose={() => setSheet(null)} />}
      {sheet === 'approve' && (
        <ConfirmSheet title="Approve this racecard?" busy={busy} confirm="Approve & notify players" onConfirm={approve} onClose={() => setSheet(null)}>
          <ul className="an-bullets">
            {!day && <li>The Saturday week for {dateText(payload.date)} is created.</li>}
            <li>{plural(summary.races, 'race')} and {plural(summary.runners, 'runner')} are added to {title}, with the prices shown here.</li>
            {summary.missing_prices > 0 && <li>{plural(summary.missing_prices, 'runner')} {summary.missing_prices === 1 ? 'has' : 'have'} no price and will score 0 until you add one.</li>}
            {owners.length > 0 && <li>{plural(owners.length, 'owner')} {owners.length === 1 ? 'has' : 'have'} no silks yet, so {owners.length === 1 ? 'their runners show' : 'those runners show'} plain silks.</li>}
            <li>Everyone with notifications on is told picks are open.</li>
          </ul>
          <Error_>{error}</Error_>
        </ConfirmSheet>
      )}
      {sheet === 'reject' && (
        <ConfirmSheet title="Reject this racecard?" busy={busy} confirm="Reject" onConfirm={reject} onClose={() => setSheet(null)}>
          Nothing is added to any race day and nobody is notified. The agent can send another racecard.
        </ConfirmSheet>
      )}
    </div>
  )
}

function RunnerEdit({ runner, busy, error, onSave, onRemove, onClose }) {
  const [f, setF] = useState({ number: String(runner.number), horse: runner.horse, jockey: runner.jockey || '', trainer: runner.trainer || '', price: runner.price || '', owner_name: runner.owner_name || '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  return (
    <FormSheet title={runner.horse} onClose={onClose} busy={busy}>
      <div className="an-grid2 an-grid2--num">
        <Field id="ag-run-num" label="Number"><input id="ag-run-num" className="an-input" inputMode="numeric" value={f.number} onChange={e => set('number', e.target.value)} autoComplete="off" /></Field>
        <Field id="ag-run-name" label="Horse"><input id="ag-run-name" className="an-input" value={f.horse} onChange={e => set('horse', e.target.value)} autoComplete="off" /></Field>
      </div>
      <div className="an-grid2">
        <Field id="ag-run-jockey" label="Jockey"><input id="ag-run-jockey" className="an-input" value={f.jockey} onChange={e => set('jockey', e.target.value)} autoComplete="off" /></Field>
        <Field id="ag-run-trainer" label="Trainer"><input id="ag-run-trainer" className="an-input" value={f.trainer} onChange={e => set('trainer', e.target.value)} autoComplete="off" /></Field>
      </div>
      <div className="an-grid2">
        <Field id="ag-run-price" label="Price" hint="7/2, evens, or empty for no price yet"><input id="ag-run-price" className="an-input" placeholder="7/2" value={f.price} onChange={e => set('price', e.target.value)} autoComplete="off" /></Field>
        <Field id="ag-run-owner" label="Owner" hint={runner.owner_id ? `Racing Post id ${runner.owner_id}` : 'No owner id'}><input id="ag-run-owner" className="an-input" value={f.owner_name} onChange={e => set('owner_name', e.target.value)} autoComplete="off" /></Field>
      </div>
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        <button type="button" className="gr-btn gr-btn--solid" onClick={() => onSave(f)} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="an-btn an-btn--text an-btn--danger" onClick={onRemove} disabled={busy}>Remove from the card</button>
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}

function RaceEdit({ race, busy, error, onSave, onClose }) {
  const [f, setF] = useState({ venue: race.venue, race_name: race.race_name, race_time: race.race_time, distance: race.distance || '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  return (
    <FormSheet title="Edit race" onClose={onClose} busy={busy}>
      <Field id="ag-race-venue" label="Venue"><input id="ag-race-venue" className="an-input" value={f.venue} onChange={e => set('venue', e.target.value)} autoComplete="off" /></Field>
      <Field id="ag-race-name" label="Race name"><input id="ag-race-name" className="an-input" value={f.race_name} onChange={e => set('race_name', e.target.value)} autoComplete="off" /></Field>
      <div className="an-grid2">
        <Field id="ag-race-time" label="Off time (UK)" hint="Races are numbered in time order"><input id="ag-race-time" className="an-input" inputMode="numeric" value={f.race_time} onChange={e => set('race_time', e.target.value)} autoComplete="off" /></Field>
        <Field id="ag-race-dist" label="Distance"><input id="ag-race-dist" className="an-input" placeholder="2m 4f" value={f.distance} onChange={e => set('distance', e.target.value)} autoComplete="off" /></Field>
      </div>
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        <button type="button" className="gr-btn gr-btn--solid" onClick={() => onSave(f)} disabled={busy}>{busy ? 'Saving…' : 'Save race'}</button>
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}

// Silks for an owner who is not in the library yet. Saving puts them in the library, so every runner of theirs (on this card and
// on later ones) gets them.
function OwnerSilks({ owner, library, busy, error, onSave, onClose }) {
  const have = library[owner.owner_id]
  const [f, setF] = useState({ colour: have?.silk_colour || '', colour2: have?.silk_colour_secondary || '', pattern: have?.silk_pattern || '' })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const preview = { silk_colour: f.colour || '#1a3a10', silk_colour_secondary: f.colour2 || null, silk_pattern: f.pattern || null }
  return (
    <FormSheet title={`Silks for ${owner.owner_name || `owner ${owner.owner_id}`}`} onClose={onClose} busy={busy}>
      <p className="an-muted">{owner.runners.join(' · ')}</p>
      <div className="an-silkrow">
        <Silk runner={preview} style={{ width: 44, height: 44 }} />
        <Field id="ag-owner-pattern" label="Markings">
          <select id="ag-owner-pattern" className="an-input" value={f.pattern || 'plain'} onChange={e => set('pattern', e.target.value)}>
            {SILK_PATTERNS.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </Field>
      </div>
      <Swatches label="Silk colour" value={f.colour} onChange={v => set('colour', v)} />
      <Swatches label="Markings colour" value={f.colour2} onChange={v => set('colour2', v)} />
      <Error_>{error}</Error_>
      <div className="rd-actions rd-actions--stack">
        <button type="button" className="gr-btn gr-btn--solid" onClick={() => onSave(f)} disabled={busy}>{busy ? 'Saving…' : 'Save to the silks library'}</button>
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}
