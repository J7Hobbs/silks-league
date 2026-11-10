import { useEffect, useMemo, useState } from 'react'
import Silk from '../../components/Silk.jsx'
import { supabase } from '../../lib/supabase'
import { FormSheet } from './sheets.jsx'
import { Field } from './RaceSheets.jsx'
import { parseRaceBlocks } from '../../lib/raceImport.js'
import { replaceRace, specFromDraftRace } from '../../lib/agentRacecard.js'
import { getOwnerSilks } from '../../lib/agentData.js'
import { lockTimeText } from '../../lib/raceDay.js'
import { lockLabel } from '../../lib/notifyCopy.js'
import { plural } from '../../lib/adminFmt.js'
import '../../styles/admin-new.css'

const SAMPLE = `venue: Kempton
time: 15:10
race_name: Replacement Handicap

1, Horse Name, J Smith, T Jones, 7/2, #1a3a7a
2, Another Horse, A Rider, B Trainer, evens, #5a1010`

// Swap a race for a different one before picks lock: paste the new race, or take one from a racecard the agent sent for this
// date. The picks on the old race are cleared, nothing else on the day changes, and the players who had picked in it are
// told to pick again.
export default function ReplaceRaceSheet({ day, race, picks, players, onClose, onDone }) {
  const [source, setSource] = useState('paste')            // 'paste' | 'draft'
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [options, setOptions] = useState(null)             // races from pending racecard drafts for this date
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error: err } = await supabase.from('agent_drafts').select('id, payload, created_at').eq('kind', 'racecard').eq('status', 'pending').eq('race_date', day.date).order('created_at', { ascending: false })
      if (!live) return
      if (err) { setOptions([]); return }
      setOptions((data || []).flatMap(d => (d.payload?.races || []).map((r, ri) => ({ key: `${d.id}:${ri}`, draftId: d.id, race: r, label: `${r.race_time} ${r.venue} · ${r.race_name} · ${plural(r.runners.length, 'runner')}` }))))
    })()
    return () => { live = false }
  }, [day.date])

  const pastedOk = parsed && !parsed.errors.length && parsed.races.length === 1
  const picked = useMemo(() => (options || []).find(o => o.key === chosen) || null, [options, chosen])
  const ready = source === 'paste' ? pastedOk : !!picked

  async function replace() {
    setBusy(true); setError('')
    let spec
    if (source === 'paste') {
      const p = parsed.races[0]
      spec = { venue: p.header.venue, race_name: p.header.race_name, race_time: p.header.time, distance: p.header.distance, class_type: p.header.class, runners: p.runners }
    } else {
      const ids = [...new Set(picked.race.runners.map(u => u.owner_id).filter(Boolean))]
      spec = specFromDraftRace(day.kind, picked.race, await getOwnerSilks(ids))
    }
    const r = await replaceRace(day, race, spec)
    setBusy(false)
    if (!r.ok && !r.warn) { setError(r.error); return }
    onDone(r.warn ? `${r.text} · ${r.warn}` : r.text, r.ok)
  }

  const preview = source === 'paste' ? (pastedOk ? { head: `${parsed.races[0].header.time} ${parsed.races[0].header.venue} · ${parsed.races[0].header.race_name}`, runners: parsed.races[0].runners.map(x => ({ n: x.horse_number, name: x.horse_name, silk: x, price: x.odds_fractional })) } : null)
    : picked ? { head: picked.label, runners: picked.race.runners.map(u => ({ n: u.number, name: u.horse, silk: { silk_colour: u.silks?.colour, silk_colour_secondary: u.silks?.colour2, silk_pattern: u.silks?.pattern }, price: u.price })) } : null

  return (
    <FormSheet title={`Replace Race ${race.race_number}`} onClose={onClose} busy={busy}>
      <p className="an-sheet__text">For a race that has been swapped for another one. Race {race.race_number} stays in the same place on the day; its runners are replaced.</p>
      <div className="ag-tabs" role="tablist" aria-label="Where the new race comes from">
        <button type="button" role="tab" aria-selected={source === 'paste'} className={`ag-tab${source === 'paste' ? ' ag-tab--on' : ''}`} onClick={() => { setSource('paste'); setError('') }}>Paste it</button>
        <button type="button" role="tab" aria-selected={source === 'draft'} className={`ag-tab${source === 'draft' ? ' ag-tab--on' : ''}`} onClick={() => { setSource('draft'); setError('') }}>From a racecard draft</button>
      </div>

      {source === 'paste' ? (
        <>
          <Field id="ag-replace-text" label="Paste the new race" hint="Same format as Import races: race details, a blank line, one runner per line.">
            <textarea id="ag-replace-text" className="an-input an-input--area" rows={8} spellCheck={false} placeholder={SAMPLE} value={text} onChange={e => { setText(e.target.value); setParsed(null) }} data-autofocus />
          </Field>
          {!parsed && <button type="button" className="gr-btn gr-btn--outline" onClick={() => setParsed(parseRaceBlocks(text))} disabled={!text.trim()}>Preview</button>}
          {parsed?.errors.length > 0 && <div className="an-rs__error" role="alert"><strong>Fix these first</strong><ul className="an-bullets">{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
          {parsed && !parsed.errors.length && parsed.races.length !== 1 && <div className="an-rs__error" role="alert">Paste exactly one race (found {parsed.races.length}).</div>}
        </>
      ) : options === null ? <p className="an-muted">Looking for racecard drafts…</p> : options.length === 0 ? (
        <p className="an-muted">There is no racecard draft waiting for {day.title}&rsquo;s date. Paste the race instead.</p>
      ) : (
        <div className="an-choices" role="radiogroup" aria-label="Race from a draft">
          {options.map(o => (
            <button key={o.key} type="button" role="radio" aria-checked={chosen === o.key} className={`an-choice${chosen === o.key ? ' an-choice--on' : ''}`} onClick={() => setChosen(o.key)}>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}

      {preview && (
        <div className="an-previewrace">
          <div className="an-previewrace__head"><strong>New race</strong> · {preview.head}</div>
          <ul className="an-runnerlist an-runnerlist--tight">
            {preview.runners.map(x => (
              <li key={`${x.n}-${x.name}`}>
                <Silk runner={x.silk} style={{ width: 22, height: 22 }} />
                <span className="an-runnerlist__main">{x.n ? `${x.n}. ` : ''}{x.name}</span>
                <span className={x.price ? 'an-price-tag' : 'an-price-tag an-price-tag--none'}>{x.price || 'No price'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready && (
        <ul className="an-bullets">
          <li>{picks > 0 ? `${plural(picks, 'pick')} on Race ${race.race_number} ${picks === 1 ? 'is' : 'are'} cleared.` : `Nobody has picked in Race ${race.race_number} yet.`} Every other race, banker and bonus on the day stays as it is.</li>
          {players > 0 && <li>{plural(players, 'player')} {players === 1 ? 'is' : 'are'} told: &ldquo;Race {race.race_number} has been replaced. Pick again before {lockLabel(day.deadline) || lockTimeText(day.deadline) || 'picks lock'}.&rdquo;</li>}
        </ul>
      )}
      {error && <div className="an-rs__error" role="alert">{error}</div>}
      <div className="rd-actions rd-actions--stack">
        <button type="button" className="gr-btn gr-btn--danger" onClick={replace} disabled={busy || !ready}>{busy ? 'Replacing…' : 'Replace race'}</button>
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </FormSheet>
  )
}
