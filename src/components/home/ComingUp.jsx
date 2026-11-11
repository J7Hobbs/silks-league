import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import FestivalPhoto from '../festivals/FestivalPhoto.jsx'
import { daysBetween } from '../../lib/format.js'
import { dateRange, daysLabel, dayCount, untilText } from '../../lib/festivalView.js'
import '../../styles/festivals.css'

// "Coming up" on Home: the next festival as one compact row, the same shape as a row on the Festivals page (small photo, venue,
// name, dates, and how long to go on the right). It opens the Festivals page. Hidden when there is no upcoming festival.
export default function ComingUp({ next }) {
  if (!next) return null
  const { festival: f, days, moreThisYear, today } = next
  const name = f.display_name || f.name
  const until = untilText(daysBetween(today, f.start_date))
  const length = days?.length || dayCount(f)

  return (
    <section className="home__section" aria-label="Coming up" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="cu-head">
        <span className="home-label">Coming up</span>
        <Link to="/festivals" className="fx-link">All festivals</Link>
      </div>
      <Link to="/festivals" className="fr fr--link" aria-label={`${name}, ${until}. Festival calendar`}>
        <div className="fr-photo">
          <FestivalPhoto url={f.banner_url} position={f.banner_position} venue={f.venue} name={name} />
        </div>
        <div className="fr-text">
          {f.venue && <span className="fr-venue">{f.venue}</span>}
          <span className="fr-name">{name}</span>
          <span className="fr-sub">{dateRange(f.start_date, f.end_date, 'short')} · {daysLabel(length)}</span>
        </div>
        <span className="fr-when">{until}</span>
      </Link>
      <Link to="/festivals" className="cu-foot">
        <span className="nf-foot__l">Festival calendar</span>
        <span className="nf-foot__r">
          {moreThisYear > 0 ? `${moreThisYear} more this year` : 'See all festivals'}
          <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </Link>
    </section>
  )
}
