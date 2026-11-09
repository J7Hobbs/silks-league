import { useState } from 'react'
import { FormSheet } from './sheets.jsx'
import { seasonProblems, festivalProblems } from '../../lib/setupView.js'

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

function Buttons({ busy, ok, label, busyLabel = 'Saving…', onSave, onClose }) {
  return (
    <div className="rd-actions rd-actions--stack">
      <button type="button" className="gr-btn gr-btn--solid" onClick={onSave} disabled={busy || !ok}>{busy ? busyLabel : label}</button>
      <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
    </div>
  )
}

// ── Season: create (with the next month filled in) or edit ─────────────
//   start  { name, startDate, endDate } to begin with       season  the season being edited (null when new)
export function SeasonSheet({ season, start, seasons, busy, error, onSave, onClose }) {
  const [f, setF] = useState({ name: start.name, startDate: start.startDate, endDate: start.endDate })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const problems = seasonProblems(f, seasons, season?.id)
  return (
    <FormSheet title={season ? `Edit ${season.name}` : 'New month'} onClose={onClose} busy={busy}>
      <Field id="an-s-name" label="Name"><input id="an-s-name" className="an-input" value={f.name} onChange={e => set('name', e.target.value)} autoComplete="off" /></Field>
      <div className="an-grid2">
        <Field id="an-s-start" label="Starts"><input id="an-s-start" type="date" className="an-input" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></Field>
        <Field id="an-s-end" label="Ends"><input id="an-s-end" type="date" className="an-input" value={f.endDate} onChange={e => set('endDate', e.target.value)} /></Field>
      </div>
      {!season && <p className="an-muted">Filled in for the next calendar month. Change anything before saving. The new season is not active until you set it.</p>}
      {problems.length > 0 && <div className="an-muted an-problems">{problems.join('. ')}.</div>}
      <Error_>{error}</Error_>
      <Buttons busy={busy} ok={problems.length === 0} label={season ? 'Save season' : 'Create season'} onSave={() => onSave(f)} onClose={onClose} />
    </FormSheet>
  )
}

// ── Festival: create or edit ────────────────────────────────────────────
export function FestivalSheet({ festival, dayCount, busy, error, onSave, onClose }) {
  const [f, setF] = useState({
    name: festival?.name || '', displayName: festival?.display_name || '', venue: festival?.venue || '',
    startDate: festival?.start_date || '', endDate: festival?.end_date || '',
  })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const problems = festivalProblems(f)
  const newDays = f.startDate && f.endDate && f.endDate >= f.startDate ? Math.round((Date.parse(f.endDate + 'T12:00:00Z') - Date.parse(f.startDate + 'T12:00:00Z')) / 86400000) + 1 : 0
  return (
    <FormSheet title={festival ? 'Edit details' : 'New festival'} onClose={onClose} busy={busy}>
      <Field id="an-f-name" label="Name" hint="The full name, for example Cheltenham - The November Meeting"><input id="an-f-name" className="an-input" value={f.name} onChange={e => set('name', e.target.value)} autoComplete="off" /></Field>
      <Field id="an-f-short" label="Short name" hint="Shown in the app, for example Cheltenham November Meeting"><input id="an-f-short" className="an-input" value={f.displayName} onChange={e => set('displayName', e.target.value)} autoComplete="off" /></Field>
      <Field id="an-f-course" label="Course"><input id="an-f-course" className="an-input" value={f.venue} onChange={e => set('venue', e.target.value)} autoComplete="off" /></Field>
      <div className="an-grid2">
        <Field id="an-f-start" label="First day"><input id="an-f-start" type="date" className="an-input" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></Field>
        <Field id="an-f-end" label="Last day"><input id="an-f-end" type="date" className="an-input" value={f.endDate} onChange={e => set('endDate', e.target.value)} /></Field>
      </div>
      {!festival && newDays > 0 && problems.length === 0 && <p className="an-muted">This creates {newDays} {newDays === 1 ? 'day' : 'days'}, one for each date. You load the races for each day afterwards.</p>}
      {festival && <p className="an-muted">Changing the dates moves each day to match (Day 1 is the first day). Races, runners and picks stay where they are. {dayCount > newDays && newDays > 0 ? `The festival has ${dayCount} days, so days after the new last day are kept.` : ''}</p>}
      {problems.length > 0 && <div className="an-muted an-problems">{problems.join('. ')}.</div>}
      <Error_>{error}</Error_>
      <Buttons busy={busy} ok={problems.length === 0} label={festival ? 'Save details' : 'Create festival'} onSave={() => onSave(f)} onClose={onClose} />
    </FormSheet>
  )
}

// ── Add a festival day ──────────────────────────────────────────────────
export function DaySheet({ start, busy, error, onSave, onClose }) {
  const [date, setDate] = useState(start || '')
  return (
    <FormSheet title="Add a day" onClose={onClose} busy={busy}>
      <Field id="an-day-date" label="Date" hint="If it falls outside the festival's dates, the festival's first or last day moves to include it.">
        <input id="an-day-date" type="date" className="an-input" value={date} onChange={e => setDate(e.target.value)} data-autofocus />
      </Field>
      <Error_>{error}</Error_>
      <Buttons busy={busy} ok={!!date} label="Add day" busyLabel="Adding…" onSave={() => onSave(date)} onClose={onClose} />
    </FormSheet>
  )
}
