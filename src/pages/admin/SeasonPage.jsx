import { useCallback, useEffect, useState } from 'react'
import { ConfirmSheet, FormSheet } from './sheets.jsx'
import { SeasonSheet } from './SetupSheets.jsx'
import { loadSeasons, updateSeason, setActiveSeason, completeSeason, deleteSeason, countSeasonPicks } from '../../lib/adminSetup.js'
import { seasonStatus } from '../../lib/setupView.js'
import { dateText, plural } from '../../lib/adminFmt.js'
import '../../styles/admin-new.css'

const loadAll = () => loadSeasons()

// One season: its facts and what Admin can do to it.
export default function SeasonPage({ seasonId, go, say }) {
  const [state, setState] = useState({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const [sheet, setSheet] = useState(null)       // 'edit' | 'active' | 'complete' | 'delete' | { blocked: n }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => { setSheet(null); setError('') }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await loadAll()
        if (!cancelled) setState({ status: 'ready', rows })
      } catch (err) {
        if (!cancelled) setState(prev => (prev.status === 'ready' ? prev : { status: 'error', message: err.message || String(err) }))
      }
    })()
    return () => { cancelled = true }
  }, [tick])

  const back = () => go({ s: null })
  if (state.status === 'loading') return <div className="an-note" role="status">Loading season…</div>
  if (state.status === 'error') {
    return (
      <div className="an-card an-card--plain">
        <button type="button" className="an-back" onClick={back}>‹ Seasons</button>
        <h2 className="an-h2">Could not load this season</h2>
        <p className="an-muted">{state.message}</p>
        <button type="button" className="an-btn an-btn--solid" onClick={() => { setState({ status: 'loading' }); reload() }}>Try again</button>
      </div>
    )
  }
  const season = state.rows.find(s => s.id === seasonId)
  if (!season) {
    return (
      <div className="an-card an-card--plain">
        <button type="button" className="an-back" onClick={back}>‹ Seasons</button>
        <h2 className="an-h2">That season no longer exists</h2>
      </div>
    )
  }
  const st = seasonStatus(season)
  const completed = season.status === 'completed'

  async function run(fn, done) {
    setBusy(true); setError('')
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    done(r)
  }
  const onEdit = f => run(() => updateSeason(season.id, f), () => { close(); say('ok', 'Season updated'); reload() })
  const onActive = () => run(() => setActiveSeason(season.id), () => { close(); say('ok', `${season.name} is now the active season`); reload() })
  const onComplete = () => run(() => completeSeason(season.id), () => { close(); say('ok', `${season.name} completed`); reload() })
  const onDelete = () => run(() => deleteSeason(season), () => { say('ok', `${season.name} deleted`); go({ s: null }) })

  async function openDelete() {
    if (season.is_active) { say('error', 'Set another season active first. The active season cannot be deleted.'); return }
    setBusy(true)
    try {
      const n = await countSeasonPicks(season.id)
      setSheet(n > 0 ? { blocked: n } : 'delete')
    } catch (err) { say('error', err.message || String(err)) }
    setBusy(false)
  }

  return (
    <div className="an-stack">
      <button type="button" className="an-back" onClick={back}>‹ Seasons</button>

      <section className="an-card an-card--plain" aria-label="Season">
        <div className="an-prow__name"><h2 className="an-h2 an-wrap">{season.name}</h2><span className={`an-pill an-pill--${st.tone}`}>{st.label}</span></div>
        <dl className="an-facts">
          <div><dt>Dates</dt><dd>{season.start_date ? `${dateText(season.start_date)} – ${dateText(season.end_date)}` : 'Not set'}</dd></div>
          <div><dt>Race weeks</dt><dd>{season.weekCount}</dd></div>
          <div><dt>Status</dt><dd>{completed ? 'Completed' : season.is_active ? 'Active' : 'Not completed'}</dd></div>
          {season.winner && <div><dt>Won by</dt><dd>{season.winner.name} · {season.winner.points} pts</dd></div>}
        </dl>
      </section>

      <section className="an-actions" aria-label="Actions">
        <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('edit') }}>Edit details</button>
        <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('active') }} disabled={season.is_active}>{season.is_active ? 'Already active' : 'Set active'}</button>
        <button type="button" className="an-btn an-btn--ghost" onClick={() => { setError(''); setSheet('complete') }} disabled={completed}>{completed ? 'Completed' : 'Complete season'}</button>
        <button type="button" className="an-btn an-btn--ghost an-btn--danger" onClick={openDelete} disabled={busy}>Delete season</button>
      </section>
      {season.is_active && <p className="an-note-box">This is the active season, so the app shows its race weeks and table. Set another season active before deleting this one.</p>}

      {sheet === 'edit' && <SeasonSheet season={season} start={{ name: season.name, startDate: season.start_date || '', endDate: season.end_date || '' }} seasons={state.rows} busy={busy} error={error} onSave={onEdit} onClose={close} />}
      {sheet === 'active' && (
        <ConfirmSheet title={`Make ${season.name} the active season?`} busy={busy} confirm="Set active" onConfirm={onActive} onClose={close}>
          Only one season is active at a time, so the current active season is switched off. The app then shows this season&rsquo;s race weeks and table.
          {error && <span className="an-warnbox an-warnbox--block" role="alert">{error}</span>}
        </ConfirmSheet>
      )}
      {sheet === 'complete' && (
        <ConfirmSheet title={`Complete ${season.name}?`} busy={busy} confirm="Complete season" onConfirm={onComplete} onClose={close}>
          This marks the season as finished and keeps all its standings, results and points.{season.is_active ? ' It stays the active season until you set another.' : ''}
          {error && <span className="an-warnbox an-warnbox--block" role="alert">{error}</span>}
        </ConfirmSheet>
      )}
      {sheet === 'delete' && (
        <ConfirmSheet title={`Delete ${season.name}?`} tone="danger" busy={busy} confirm="Delete season" onConfirm={onDelete} onClose={close}>
          The season and its {plural(season.weekCount, 'race week')}, with their races and runners, are deleted for good. Nobody has picked in it, so no points are lost.
          {error && <span className="an-warnbox an-warnbox--block" role="alert">{error}</span>}
        </ConfirmSheet>
      )}
      {sheet?.blocked && (
        <FormSheet title="This season cannot be deleted" onClose={close}>
          <p className="an-sheet__text">{plural(sheet.blocked, 'pick')} {sheet.blocked === 1 ? 'has' : 'have'} been made in this season. A season with picks is kept so nobody&rsquo;s points disappear. You can complete it instead.</p>
          <div className="rd-actions rd-actions--stack"><button type="button" className="gr-btn gr-btn--outline" onClick={close} data-autofocus>Close</button></div>
        </FormSheet>
      )}
    </div>
  )
}
