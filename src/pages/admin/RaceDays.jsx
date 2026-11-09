import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RaceDayPage from './RaceDayPage.jsx'
import { WeekSheet } from './RaceSheets.jsx'
import { loadRaceDayList, createWeek } from '../../lib/adminRaceDays.js'
import { groupDays } from '../../lib/raceDayList.js'
import { dateText, plural } from '../../lib/adminFmt.js'
import { weekdayShort, monthAbbr } from '../../lib/format.js'
import '../../styles/admin-new.css'

// The Race days tab. The address says where you are: ?tab=racedays shows the list, &d=<day> a race day,
// and &r=<race> a race on it, so the browser's back button steps back one level.
export default function RaceDays() {
  const [params, setParams] = useSearchParams()
  const dayKey = params.get('d')
  const go = useCallback(patch => {
    const p = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)))
    setParams(p)
  }, [params, setParams])
  if (dayKey) return <RaceDayPage key={dayKey} dayKey={dayKey} raceId={params.get('r')} go={go} />
  return <RaceDayList go={go} />
}

function RaceDayList({ go }) {
  const [state, setState] = useState({ status: 'loading' })
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [tick, setTick] = useState(0)
  const load = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await loadRaceDayList()
        if (!cancelled) setState({ status: 'ready', rows })
      } catch (err) {
        console.error('[Admin Race days] load failed:', err)
        if (!cancelled) setState({ status: 'error', message: err.message || String(err) })
      }
    })()
    return () => { cancelled = true }
  }, [tick])

  async function onCreate(date) {
    setBusy(true); setError('')
    const r = await createWeek(date)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setSheet(false)
    go({ d: r.key })
  }

  if (state.status === 'loading') return <div className="an-note" role="status">Loading race days…</div>
  if (state.status === 'error') {
    return (
      <div className="an-card an-card--plain">
        <h2 className="an-h2">Could not load race days</h2>
        <p className="an-muted">{state.message}</p>
        <button type="button" className="an-btn an-btn--solid" onClick={() => { setState({ status: 'loading' }); load() }}>Try again</button>
      </div>
    )
  }
  const { upcoming, past } = groupDays(state.rows)
  return (
    <div className="an-stack">
      <div className="an-listhead">
        <h2 className="an-h2">Race days</h2>
        <button type="button" className="an-btn an-btn--solid an-btn--sm" onClick={() => { setError(''); setSheet(true) }}>+ New Saturday week</button>
      </div>
      <Group title="Upcoming" rows={upcoming} empty="Nothing upcoming. Create a Saturday week, or add a festival in the classic Admin." go={go} />
      <Group title="Past" rows={past} empty="No past race days." go={go} />
      {sheet && <WeekSheet busy={busy} error={error} onSave={onCreate} onClose={() => setSheet(false)} />}
    </div>
  )
}

function Group({ title, rows, empty, go }) {
  return (
    <section className="an-group" aria-label={title}>
      <h3 className="an-group__h">{title} <span className="an-muted">{rows.length}</span></h3>
      {rows.length === 0 ? <p className="an-muted an-group__empty">{empty}</p> : (
        <ul className="an-days">
          {rows.map(r => (
            <li key={r.key}>
              <button type="button" className="an-dayrow" onClick={() => go({ d: r.key, r: null })}>
                <span className="an-dayrow__date" aria-hidden="true">
                  <span className="an-dayrow__dow">{weekdayShort(r.date)}</span>
                  <span className="an-dayrow__num">{Number(r.date.slice(8, 10))}</span>
                  <span className="an-dayrow__mon">{monthAbbr(r.date)}</span>
                </span>
                <span className="an-dayrow__main">
                  <span className="an-dayrow__title">{r.title}</span>
                  <span className="an-muted">{[r.venue, r.raceCount ? plural(r.raceCount, 'race') : null].filter(Boolean).join(' · ') || dateText(r.date)}</span>
                  <span className={`an-pill an-pill--${r.status.tone}`}>{r.status.label}</span>
                </span>
                <span className="an-dayrow__go" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
