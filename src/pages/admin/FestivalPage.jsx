import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmSheet, FormSheet, TypeToConfirmSheet } from './sheets.jsx'
import BannerPosition from './BannerPosition.jsx'
import { FestivalSheet, DaySheet } from './SetupSheets.jsx'
import {
  loadFestivalDetail, updateFestival, addFestivalDay, removeFestivalDay, dayRemovalBlock, setFestivalActive, deleteFestival, countFestivalPicks, uploadFestivalPhoto,
} from '../../lib/adminSetup.js'
import { festivalStatus, setupDayStatus, nextDayDate } from '../../lib/setupView.js'
import { dateText, plural } from '../../lib/adminFmt.js'
import { weekdayShort, monthAbbr } from '../../lib/format.js'
import '../../styles/admin-new.css'

// One festival: photo, details, the "Show in the app" switch, its days, and what Admin can do to it.
export default function FestivalPage({ festivalId, go, say }) {
  const [state, setState] = useState({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const [sheet, setSheet] = useState(null)       // 'edit' | 'day' | 'delete' | { blocked: n } | { remove: day } | { dayBlock: text }
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const close = () => { setSheet(null); setError('') }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const detail = await loadFestivalDetail(festivalId)
        if (!cancelled) setState({ status: 'ready', ...detail })
      } catch (err) {
        if (!cancelled) setState(prev => (prev.status === 'ready' ? prev : { status: 'error', message: err.message || String(err) }))
      }
    })()
    return () => { cancelled = true }
  }, [festivalId, tick])

  const back = () => go({ f: null })
  if (state.status === 'loading') return <div className="an-note" role="status">Loading festival…</div>
  if (state.status === 'error') {
    return (
      <div className="an-card an-card--plain">
        <button type="button" className="an-back" onClick={back}>‹ Festivals</button>
        <h2 className="an-h2">Could not load this festival</h2>
        <p className="an-muted">{state.message}</p>
        <button type="button" className="an-btn an-btn--solid" onClick={() => { setState({ status: 'loading' }); reload() }}>Try again</button>
      </div>
    )
  }
  const { festival, days } = state
  const title = festival.display_name || festival.name
  const st = festivalStatus(festival)
  const photo = festival.banner_url

  async function run(fn, done) {
    setBusy(true); setError('')
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    done(r)
  }
  const onEdit = f => run(() => updateFestival(festival, days, f), () => { close(); say('ok', 'Festival updated'); reload() })
  const onAddDay = date => run(() => addFestivalDay(festival, days, date), r => { close(); say('ok', `Day ${r.number} added (${r.dayName})`); reload() })
  const onRemoveDay = day => run(() => removeFestivalDay(festival, days, day), () => { close(); say('ok', `Day ${day.day_number} removed`); reload() })
  const onDelete = () => run(() => deleteFestival(festival), () => { say('ok', `${title} deleted`); go({ f: null }) })

  async function onToggle() {
    setBusy(true)
    const next = !festival.is_active
    const r = await setFestivalActive(festival.id, next)
    setBusy(false)
    if (!r.ok) { say('error', r.error); return }
    say('ok', next ? `${title} is now shown in the app` : `${title} is hidden from the app`)
    reload()
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    const r = await uploadFestivalPhoto(festival, file)
    setPhotoBusy(false)
    if (!r.ok) { say('error', r.error); return }
    say('ok', 'Photo updated')
    reload()
  }

  // The row only offers this for a day with no races or link; picks are checked here, as the day is read fresh.
  async function openRemove(day) {
    setBusy(true)
    try {
      const block = await dayRemovalBlock(day)
      setSheet(block ? { dayBlock: block } : { remove: day })
    } catch (err) { say('error', err.message || String(err)) }
    setBusy(false)
  }

  async function openDelete() {
    setBusy(true)
    try {
      const n = await countFestivalPicks(festival.id)
      setSheet(n > 0 ? { blocked: n } : 'delete')
    } catch (err) { say('error', err.message || String(err)) }
    setBusy(false)
  }

  return (
    <div className="an-stack">
      <button type="button" className="an-back" onClick={back}>‹ Festivals</button>

      <section className={`an-card an-day an-fest${photo ? ' an-day--photo' : ''}`} aria-label="Festival">
        {photo && <div className="an-day__photo" style={{ backgroundImage: `url("${String(photo).replace(/"/g, '%22')}")`, backgroundPosition: festival.banner_position || 'center' }} aria-hidden="true" />}
        <div className="an-day__body">
          <div className="an-eyebrow">{festival.start_date ? `${dateText(festival.start_date)}${festival.end_date && festival.end_date !== festival.start_date ? ` – ${dateText(festival.end_date)}` : ''}` : 'No dates'}</div>
          <h2 className="an-day__title">{title}</h2>
          {festival.venue && <div className="an-day__also">{festival.venue}</div>}
          <div><span className={`an-pill an-pill--${st.tone}`}>{st.label}</span> <span className={`an-muted ${photo ? 'an-photo--yes' : 'an-photo--no'}`}>{photo ? '✓ Photo' : 'No photo yet'}</span></div>
        </div>
      </section>

      <section className="an-card an-card--plain" aria-label="Photo">
        <h3 className="an-h3">Photo</h3>
        <p className="an-muted">Shown behind the festival in the app. A wide photo works best. It is shrunk to about 1600px wide before it is saved.</p>
        <input ref={fileRef} id="an-photo-file" type="file" accept="image/jpeg,image/png,image/webp,image/*" className="an-file" onChange={onPhoto} aria-label="Choose a photo" />
        <button type="button" className="an-btn an-btn--ghost" onClick={() => fileRef.current?.click()} disabled={photoBusy}>{photoBusy ? 'Uploading…' : photo ? 'Change photo' : 'Add photo'}</button>
      </section>

      <BannerPosition key={`${festival.banner_url}|${festival.banner_position}`} festival={festival} dayCount={days.length} say={say} onSaved={reload} />

      <section className="an-card an-card--plain" aria-label="Show in the app">
        <div className="an-switchrow">
          <div className="an-switchrow__text">
            <h3 className="an-h3">Show in the app</h3>
            <p className="an-muted">{festival.is_active ? 'On. Players can see this festival and pick on its days.' : 'Off. Players cannot see this festival yet.'} Other festivals are not affected.</p>
          </div>
          <button type="button" role="switch" aria-checked={!!festival.is_active} aria-label="Show in the app" className={`an-switch${festival.is_active ? ' an-switch--on' : ''}`} onClick={onToggle} disabled={busy}>
            <span className="an-switch__knob" />
          </button>
        </div>
      </section>

      <section className="an-card an-card--plain" aria-label="Days">
        <h3 className="an-h3">Days <span className="an-count an-muted">{days.length}</span></h3>
        {days.length === 0 ? <p className="an-muted">This festival has no days yet. Add one below.</p> : (
          <ul className="an-days">
            {days.map(d => {
              const ds = setupDayStatus({ raceCount: d.raceCount, linkedWeek: d.linkedWeek })
              return (
                <li key={d.id} className="an-dayitem">
                  <Link className="an-dayrow" to={`/admin?tab=racedays&d=${encodeURIComponent(`festival:${d.id}`)}`}>
                    <span className="an-dayrow__date" aria-hidden="true">
                      <span className="an-dayrow__dow">{weekdayShort(d.race_date)}</span>
                      <span className="an-dayrow__num">{Number(d.race_date.slice(8, 10))}</span>
                      <span className="an-dayrow__mon">{monthAbbr(d.race_date)}</span>
                    </span>
                    <span className="an-dayrow__main">
                      <span className="an-dayrow__title">Day {d.day_number}</span>
                      <span className="an-muted">{d.raceCount ? plural(d.raceCount, 'race') : 'No races yet'}{d.linkedWeek ? ` · Saturday League week ${d.linkedWeek.week_number}` : ''}</span>
                      <span className={`an-pill an-pill--${ds.tone}`}>{ds.label}</span>
                    </span>
                    <span className="an-dayrow__go" aria-hidden="true">›</span>
                  </Link>
                  {!d.raceCount && !d.linkedWeek && (
                    <button type="button" className="an-linkbtn an-linkbtn--danger" onClick={() => openRemove(d)} disabled={busy} aria-label={`Remove Day ${d.day_number}`}>Remove day</button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="an-muted">Tap a day to load or manage its races in Race days. A day can be removed while it has no races and nobody has picked on it.</p>
      </section>

      <section className="an-actions" aria-label="Actions">
        <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('edit') }}>Edit details</button>
        <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('day') }}>+ Add day</button>
        <button type="button" className="an-btn an-btn--ghost an-btn--danger" onClick={openDelete} disabled={busy}>Delete festival</button>
      </section>

      {sheet === 'edit' && <FestivalSheet festival={festival} dayCount={days.length} busy={busy} error={error} onSave={onEdit} onClose={close} />}
      {sheet === 'day' && <DaySheet start={nextDayDate(days, festival)} busy={busy} error={error} onSave={onAddDay} onClose={close} />}
      {sheet?.remove && (
        <ConfirmSheet title={`Remove Day ${sheet.remove.day_number}?`} busy={busy} confirm="Remove day" tone="danger" onConfirm={() => onRemoveDay(sheet.remove)} onClose={close}>
          {dateText(sheet.remove.race_date)} has no races and nobody has picked on it. The day is deleted{days.some(d => d.day_number > sheet.remove.day_number) ? ', and the days after it move up one number' : ''}.
          {error && <span className="an-warnbox an-warnbox--block" role="alert">{error}</span>}
        </ConfirmSheet>
      )}
      {sheet?.dayBlock && (
        <FormSheet title="This day cannot be removed" onClose={close}>
          <p className="an-sheet__text">{sheet.dayBlock}</p>
          <div className="rd-actions rd-actions--stack"><button type="button" className="gr-btn gr-btn--outline" onClick={close} data-autofocus>Close</button></div>
        </FormSheet>
      )}
      {sheet === 'delete' && (
        <TypeToConfirmSheet title={`Delete ${title}?`} expected={title} label={`Type ${title} to confirm`} confirm="Delete festival for good" busy={busy} error={error} onConfirm={onDelete} onClose={close}>
          <ul className="an-bullets">
            <li>The festival, its {plural(days.length, 'day')}, and their races, runners and results are deleted.</li>
            {days.some(d => d.linkedWeek) && <li>Saturday League weeks linked to its days are unlinked.</li>}
            <li>Nobody has picked in it, so no points are lost. This cannot be undone.</li>
          </ul>
        </TypeToConfirmSheet>
      )}
      {sheet?.blocked && (
        <FormSheet title="This festival cannot be deleted" onClose={close}>
          <p className="an-sheet__text">{plural(sheet.blocked, 'pick')} {sheet.blocked === 1 ? 'has' : 'have'} been made on this festival. A festival with picks is kept so nobody&rsquo;s points disappear. You can switch it off to hide it from the app.</p>
          <div className="rd-actions rd-actions--stack"><button type="button" className="gr-btn gr-btn--outline" onClick={close} data-autofocus>Close</button></div>
        </FormSheet>
      )}
    </div>
  )
}
