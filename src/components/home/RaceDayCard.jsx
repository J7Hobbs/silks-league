import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export default function RaceDayCard() {
  return (
    <Link to="/race-day" className="rd-card">
      <span className="rd-card__top">
        <span className="rd-card__soon">Coming soon</span>
        <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="rd-card__title">Race Day</span>
      <span className="rd-card__text">Heading to the races with your mates? Run your own tournament for the day.</span>
    </Link>
  )
}
