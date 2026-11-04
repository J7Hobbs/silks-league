import { monthShort, dayRange, festivalLength, daysBetween, localDateStr, relativeUntil } from '../../lib/format.js'

// Next few festivals after today. Hidden when there are none.
export default function ComingUp({ festivals, nowMs }) {
  if (!festivals.length) return null
  const today = localDateStr(new Date(nowMs))

  return (
    <section className="home__section" aria-label="Coming up" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="cu-head">
        <span className="home-label">Coming up</span>
        <span className="home-muted">Festival calendar</span>
      </div>
      <ul className="cu-list">
        {festivals.map(f => {
          const days = festivalLength(f.start_date, f.end_date)
          const sub = [f.venue, `${days} ${days === 1 ? 'day' : 'days'}`].filter(Boolean).join(' · ')
          return (
            <li key={f.id} className="cu-row">
              <div className="cu-date">
                <span className="cu-date__m">{monthShort(f.start_date)}</span>
                <span className="cu-date__d">{dayRange(f.start_date, f.end_date)}</span>
              </div>
              <div className="cu-main">
                <div className="cu-name">{f.display_name || f.name}</div>
                <div className="cu-sub">{sub}</div>
              </div>
              <span className="cu-when">{relativeUntil(daysBetween(today, f.start_date))}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
