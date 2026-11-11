import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import TopNav from '../components/TopNav.jsx'
import BottomNav from '../components/BottomNav.jsx'
import '../styles/home.css'
import '../styles/admin-raceday.css'   // this page's tag and step styling is defined here (it was always loaded with the whole app before pages were split)

const STEPS = [
  { title: 'Set up your day', text: "Choose the meeting you're heading to and invite your group with a code." },
  { title: 'Pick every race', text: 'Everyone picks one horse per race before the first race goes off.' },
  { title: 'Follow it live', text: 'The leaderboard updates after each race, so you know where you stand between races.' },
  { title: "Crown the day's champion", text: 'The winner gets a Race Day badge on their profile, and bragging rights on the journey home.' },
]

// Teaser page for the upcoming Race Day feature (linked from Home).
export default function RaceDay() {
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { if (!session) navigate('/auth') })
  }, [navigate])

  return (
    <div className="app-page home">
      <TopNav />

      <main className="home__main">
        <Link to="/dashboard" className="rd-back">‹ Home</Link>

        <span className="cc-tag cc-tag--solid rd-tag">Coming soon</span>
        <h1 className="rd-title">Race Day</h1>
        <p className="rd-intro">
          Going racing with your mates? Race Day turns the meeting you're at into your own private tournament,
          with picks for every race and a live leaderboard you can follow from the course.
        </p>

        <div className="home-label">What you'll be able to do</div>
        <ol className="rd-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rd-step">
              <span className="rd-num">{i + 1}</span>
              <div>
                <h2 className="rd-step__title">{s.title}</h2>
                <p className="rd-step__text">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="rd-foot">Same scoring as the Saturday League. We'll let you know when it's ready.</p>
      </main>

      <BottomNav />
    </div>
  )
}
