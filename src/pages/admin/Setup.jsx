import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import SeasonPage from './SeasonPage.jsx'
import FestivalPage from './FestivalPage.jsx'
import { SeasonSheet, FestivalSheet } from './SetupSheets.jsx'
import { loadSeasons, loadFestivals, createSeason, createFestival } from '../../lib/adminSetup.js'
import { seasonStatus, festivalStatus, nextMonthSeason } from '../../lib/setupView.js'
import { dateText, plural } from '../../lib/adminFmt.js'
import '../../styles/admin-new.css'

// The Setup tab: Seasons and Festivals. The address says where you are: ?tab=setup is the Seasons list (&v=festivals for
// Festivals), &s=<season> a season, &f=<festival> a festival, so the browser's back button steps back one level.
export default function Setup() {
  const [params, setParams] = useSearchParams()
  const view = params.get('v') === 'festivals' ? 'festivals' : 'seasons'
  const go = useCallback(patch => {
    const p = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)))
    setParams(p)
  }, [params, setParams])

  const [toast, setToast] = useState(null)
  const say = useCallback((type, text) => setToast({ type, text, id: Date.now() }), [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t) }, [toast])
  const toastEl = toast && <div className={`an-toast an-toast--${toast.type}`} role="status" key={toast.id}>{toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}</div>

  const seasonId = params.get('s'), festivalId = params.get('f')
  if (seasonId) return <><SeasonPage key={seasonId} seasonId={seasonId} go={go} say={say} />{toastEl}</>
  if (festivalId) return <><FestivalPage key={festivalId} festivalId={festivalId} go={go} say={say} />{toastEl}</>
  return (
    <div className="an-stack">
      <div className="an-seg" role="group" aria-label="Seasons or festivals">
        <button type="button" className={`an-seg__b${view === 'seasons' ? ' an-seg__b--on' : ''}`} aria-pressed={view === 'seasons'} onClick={() => go({ v: null })}>Seasons</button>
        <button type="button" className={`an-seg__b${view === 'festivals' ? ' an-seg__b--on' : ''}`} aria-pressed={view === 'festivals'} onClick={() => go({ v: 'festivals' })}>Festivals</button>
      </div>
      {view === 'seasons' ? <SeasonList go={go} say={say} /> : <FestivalList go={go} say={say} />}
      {toastEl}
    </div>
  )
}

// Loads a list with the tick pattern, keeping the old rows on screen while it reloads.
function useList(loader) {
  const [state, setState] = useState({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await loader()
        if (!cancelled) setState({ status: 'ready', rows })
      } catch (err) {
        console.error('[Admin Setup] load failed:', err)
        if (!cancelled) setState(prev => (prev.status === 'ready' ? prev : { status: 'error', message: err.message || String(err) }))
      }
    })()
    return () => { cancelled = true }
  }, [loader, tick])
  return [state, setState, reload]
}

function LoadState({ state, what, retry }) {
  if (state.status === 'loading') return <div className="an-note" role="status">Loading {what}…</div>
  return (
    <div className="an-card an-card--plain">
      <h2 className="an-h2">Could not load {what}</h2>
      <p className="an-muted">{state.message}</p>
      <button type="button" className="an-btn an-btn--solid" onClick={retry}>Try again</button>
    </div>
  )
}

const loadSeasonRows = () => loadSeasons()
const loadFestivalRows = () => loadFestivals()

function SeasonList({ go, say }) {
  const [state, setState, reload] = useList(loadSeasonRows)
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (state.status !== 'ready') return <LoadState state={state} what="seasons" retry={() => { setState({ status: 'loading' }); reload() }} />
  const rows = state.rows

  async function onCreate(f) {
    setBusy(true); setError('')
    const r = await createSeason(f)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setSheet(false); say('ok', `${f.name.trim()} created`); reload()
  }

  return (
    <>
      <div className="an-listhead">
        <h2 className="an-h2">Seasons</h2>
        <button type="button" className="an-btn an-btn--solid an-btn--sm" onClick={() => { setError(''); setSheet(true) }}>+ New month</button>
      </div>
      {rows.length === 0 ? <p className="an-muted">No seasons yet. Create the first month.</p> : (
        <ul className="an-days">
          {rows.map(s => {
            const st = seasonStatus(s)
            return (
              <li key={s.id}>
                <button type="button" className="an-prow an-prow--group" onClick={() => go({ s: s.id })}>
                  <span className="an-prow__main">
                    <span className="an-prow__name"><span className="an-prow__text">{s.name}</span><span className={`an-pill an-pill--${st.tone}`}>{st.label}</span></span>
                    <span className="an-muted">{s.start_date ? `${dateText(s.start_date)} – ${dateText(s.end_date)}` : 'No dates'}</span>
                    <span className="an-muted">{plural(s.weekCount, 'race week')}</span>
                    {s.winner && <span className="an-muted an-won">Won by <strong>{s.winner.name}</strong> · {s.winner.points} pts</span>}
                  </span>
                  <span className="an-dayrow__go" aria-hidden="true">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {sheet && <SeasonSheet start={nextMonthSeason(rows)} seasons={rows} busy={busy} error={error} onSave={onCreate} onClose={() => setSheet(false)} />}
    </>
  )
}

function FestivalList({ go, say }) {
  const [state, setState, reload] = useList(loadFestivalRows)
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (state.status !== 'ready') return <LoadState state={state} what="festivals" retry={() => { setState({ status: 'loading' }); reload() }} />
  const rows = state.rows

  async function onCreate(f) {
    setBusy(true); setError('')
    const r = await createFestival(f)
    setBusy(false)
    if (!r.ok) { setError(r.error); if (r.id) reload(); return }
    setSheet(false); say('ok', `${f.name.trim()} created with ${plural(r.days, 'day')}`)
    go({ f: r.id })
  }

  return (
    <>
      <div className="an-listhead">
        <h2 className="an-h2">Festivals</h2>
        <button type="button" className="an-btn an-btn--solid an-btn--sm" onClick={() => { setError(''); setSheet(true) }}>+ New festival</button>
      </div>
      {rows.length === 0 ? <p className="an-muted">No festivals yet.</p> : (
        <ul className="an-days">
          {rows.map(f => {
            const st = festivalStatus(f)
            return (
              <li key={f.id}>
                <button type="button" className="an-prow an-prow--group" onClick={() => go({ f: f.id })}>
                  <span className="an-prow__main">
                    <span className="an-prow__name"><span className="an-prow__text">{f.display_name || f.name}</span><span className={`an-pill an-pill--${st.tone}`}>{st.label}</span></span>
                    <span className="an-muted">{f.start_date ? `${dateText(f.start_date)}${f.end_date && f.end_date !== f.start_date ? ` – ${dateText(f.end_date)}` : ''}` : 'No dates'}{f.venue ? ` · ${f.venue}` : ''}</span>
                    <span className="an-muted">{plural(f.dayCount, 'day')} · <span className={f.banner_url ? 'an-photo--yes' : 'an-photo--no'}>{f.banner_url ? '✓ Photo' : 'No photo'}</span></span>
                  </span>
                  <span className="an-dayrow__go" aria-hidden="true">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {sheet && <FestivalSheet busy={busy} error={error} onSave={onCreate} onClose={() => setSheet(false)} />}
    </>
  )
}
