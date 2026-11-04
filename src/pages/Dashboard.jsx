import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCompetition } from '../context/competition.js'
import { loadHomeData } from '../lib/homeData.js'
import { buildCards } from '../lib/homeCards.js'
import { greetingFor } from '../lib/format.js'
import CompetitionCard from '../components/home/CompetitionCard.jsx'
import ComingUp from '../components/home/ComingUp.jsx'
import RaceDayCard from '../components/home/RaceDayCard.jsx'
import { HomeSkeleton } from '../components/Skeletons.jsx'
import '../styles/home.css'

export default function Dashboard() {
  const navigate = useNavigate()
  const { setCompetition } = useCompetition()
  const [user, setUser] = useState(null)
  const [data, setData] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  // Ticks the "Closes in" countdowns.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setUser(user)
      const result = await loadHomeData(user)
      if (!cancelled) setData(result)
    })
    return () => { cancelled = true }
  }, [navigate])

  const { cards, liveCount } = useMemo(
    () => (data ? buildCards(data, now) : { cards: [], liveCount: 0 }),
    [data, now],
  )

  if (!data) {
    return <HomeSkeleton />
  }

  const when = new Date(now)
  const firstName =
    (data.profile?.full_name || user?.user_metadata?.full_name || '').trim().split(/\s+/)[0] ||
    data.profile?.username || 'there'

  // Setting the competition first means Picks / Leaderboard / Results can read it.
  function openCard(card) {
    setCompetition(card.competition.type, card.competition.id)
    const { to, state } = card.button.action
    navigate(to, state ? { state } : undefined)
  }

  return (
    <div className="app-page home">
      <main className="home__main">
        <header className="home__intro">
          <div className="home__date">
            {when.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <h1 className="home__greeting">{greetingFor(when.getHours())}, {firstName}</h1>
        </header>

        {liveCount > 0 && (
          <div className="home-live">
            <span className="home-live__dot" aria-hidden="true" />
            <span className="home-label">Live now · {liveCount} {liveCount === 1 ? 'competition' : 'competitions'}</span>
          </div>
        )}

        {cards.map((card, i) => (
          <CompetitionCard key={card.key} card={card} isTop={i === 0} onAction={openCard} />
        ))}

        <ComingUp festivals={data.upcoming} nowMs={now} />
        <RaceDayCard />
      </main>

    </div>
  )
}
