/**
 * Silks League — Festival calendar (/festivals)
 * Live and upcoming festivals for this year, and next year's dates. Read-only:
 * nothing here writes to the database.
 */
import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { currentUser } from '../lib/session.js'
import { useCompetition } from '../context/competition.js'
import { loadFestivalCalendar } from '../lib/festivalData.js'
import { calendarView, dateRange, daysLabel, untilText } from '../lib/festivalView.js'
import { monthShort, dayRange, relativeUntil } from '../lib/format.js'
import FestivalPhoto from '../components/festivals/FestivalPhoto.jsx'
import { FestivalsSkeleton } from '../components/Skeletons.jsx'
import '../styles/festivals.css'

function Featured({ f, onOpenLive }) {
  const name = f.display_name || f.name
  const tag = f.live ? 'LIVE NOW' : `NEXT UP · ${untilText(f.daysUntil).toUpperCase()}`
  const inner = (
    <>
      <div className="fc-photo">
        <FestivalPhoto url={f.banner_url} position={f.banner_position} venue={f.venue} name={name} />
        <div className="fx-shade" />
        <span className="fc-tag">{tag}</span>
        {f.venue && <span className="fx-venue fc-venue">{f.venue}</span>}
      </div>
      <div className="fc-body">
        <h3 className="fc-name">{name}</h3>
        <span className="fc-sub">{dateRange(f.start_date, f.end_date, 'short')} · {daysLabel(f.days)}</span>
      </div>
    </>
  )
  return f.live
    ? <button type="button" className="fc fc--link" onClick={() => onOpenLive(f)} aria-label={`${name}, live now. Open picks`}>{inner}</button>
    : <article className="fc">{inner}</article>
}

function Row({ f }) {
  const name = f.display_name || f.name
  return (
    <li className="fr">
      <div className="fr-photo">
        <FestivalPhoto url={f.banner_url} position={f.banner_position} venue={f.venue} name={name} />
      </div>
      <div className="fr-text">
        {f.venue && <span className="fr-venue">{f.venue}</span>}
        <span className="fr-name">{name}</span>
        <span className="fr-sub">{dateRange(f.start_date, f.end_date, 'short')} · {daysLabel(f.days)}</span>
      </div>
      <span className="fr-when">{f.live ? 'Live now' : relativeUntil(f.daysUntil)}</span>
    </li>
  )
}

export default function Festivals() {
  const navigate = useNavigate()
  const { setCompetition } = useCompetition()
  const [data, setData] = useState(null)      // { rows, today }
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const user = await currentUser()
      if (!user) { navigate('/auth'); return }
      try {
        const result = await loadFestivalCalendar()
        if (!cancelled) { setData(result); setFailed(false) }
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [navigate, attempt])

  function openLive(f) {
    setCompetition('festival', f.id)
    navigate('/picks')
  }

  if (!data && !failed) return <FestivalsSkeleton />

  const view = data ? calendarView(data.rows, data.today) : null

  return (
    <div className="app-page fx">
      <main className="fx__main">
        <Link to="/dashboard" className="fx-back">‹ Home</Link>
        <header className="fx-head">
          <h1 className="fx-title">Racing festivals</h1>
          <p className="fx-intro">Every festival tournament on Silks League. Pick one horse per race each day – picks lock at 12:00 on each race day.</p>
        </header>

        {failed && (
          <div className="fx-empty">
            <p className="fx-empty__t">Couldn't load festivals</p>
            <p className="fx-empty__s">Check your connection and try again.</p>
            <button type="button" className="fx-retry" onClick={() => { setFailed(false); setAttempt(a => a + 1) }}>Try again</button>
          </div>
        )}

        {view?.empty && (
          <div className="fx-empty">
            <p className="fx-empty__t">No festivals scheduled</p>
            <p className="fx-empty__s">Check back soon.</p>
          </div>
        )}

        {view?.groups.map(g => (
          <section key={g.key} className="fx-group" aria-label={g.label}>
            <h2 className="fx-month">{g.label}</h2>
            <ul className="fx-list">
              {g.items.map(f => (f.id === view.featured.id
                ? <li key={f.id} className="fx-item"><Featured f={f} onOpenLive={openLive} /></li>
                : <Row key={f.id} f={f} />
              ))}
            </ul>
          </section>
        ))}

        {view?.nextYear && (
          <section className="fx-group fx-group--next" aria-label={String(view.nextYear.year)}>
            <h2 className="fx-month">{view.nextYear.year}</h2>
            <ul className="fx-list">
              {view.nextYear.items.map(f => (
                <li key={f.id} className="fn">
                  <div className="fn-date">
                    <span className="fn-date__m">{monthShort(f.start_date)}</span>
                    <span className="fn-date__d">{dayRange(f.start_date, f.end_date)}</span>
                  </div>
                  <div className="fn-text">
                    <span className="fn-name">{f.display_name || f.name}</span>
                    <span className="fn-sub">{[f.venue, daysLabel(f.days)].filter(Boolean).join(' · ')}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
