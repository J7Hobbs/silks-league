import { Link } from 'react-router-dom'
import { Clock, ChevronRight } from 'lucide-react'
import FestivalPhoto from '../festivals/FestivalPhoto.jsx'
import { daysBetween } from '../../lib/format.js'
import { dateRange, dayTiles, untilText } from '../../lib/festivalView.js'
import '../../styles/festivals.css'

// "Coming up" on Home: the next festival as one card that opens the Festivals page.
// Hidden when there is no upcoming festival.
export default function ComingUp({ next }) {
  if (!next) return null
  const { festival: f, days, moreThisYear, today } = next
  const name = f.display_name || f.name
  const tiles = dayTiles(f, days)
  const until = untilText(daysBetween(today, f.start_date))

  return (
    <section className="home__section" aria-label="Coming up" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="cu-head">
        <span className="home-label">Coming up</span>
        <Link to="/festivals" className="fx-link">All festivals</Link>
      </div>
      <Link to="/festivals" className="nf" aria-label={`${name}, ${until}. Festival calendar`}>
        <div className="nf-photo">
          <FestivalPhoto url={f.banner_url} position={f.banner_position} venue={f.venue} name={name} />
          <div className="fx-shade nf-shade" />
          <span className="nf-tag">NEXT FESTIVAL</span>
          <span className="nf-pill"><Clock size={14} strokeWidth={2} aria-hidden="true" />{until}</span>
          <div className="nf-over">
            {f.venue && <span className="fx-venue">{f.venue}</span>}
            <h3 className="nf-name">{name}</h3>
            <span className="nf-dates">{dateRange(f.start_date, f.end_date, 'long')}</span>
          </div>
        </div>
        <div className="nf-days" style={{ gridTemplateColumns: `repeat(${Math.min(tiles.length, 5)}, minmax(0, 1fr))` }}>
          {tiles.map(t => (
            <div key={t.key} className="nf-day">
              <span className="nf-day__wd">{t.weekday}</span>
              <span className="nf-day__d">{t.date}</span>
              <span className="nf-day__n">{t.label}</span>
            </div>
          ))}
        </div>
        <div className="nf-foot">
          <span className="nf-foot__l">Festival calendar</span>
          <span className="nf-foot__r">
            {moreThisYear > 0 ? `${moreThisYear} more this year` : 'See all festivals'}
            <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </div>
      </Link>
    </section>
  )
}
