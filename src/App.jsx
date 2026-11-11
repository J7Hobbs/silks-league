import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { currentUser } from './lib/session.js'
import { postAuthDestination } from './lib/onboarding.js'
import { loadNextFestival, festivalTeaser } from './lib/landingData.js'
import PhoneMock from './components/landing/PhoneMock.jsx'
import FestivalTeaser from './components/landing/FestivalTeaser.jsx'
import HowItWorksModal from './components/HowItWorksModal.jsx'
import { dismissSplash } from './lib/splash.js'
import { prefetchPages } from './lib/lazyPage.js'
import { load } from './lib/pageLoaders.js'
import './styles/landing.css'

// The public page at "/". Signed-in players are sent straight to the app; everyone else
// sees the landing page. All text is static except the festival card, which comes from
// the public get_next_festival() function and is left out when there is nothing to show.

const SIGNUP = '/auth?mode=signup'
const LOGIN = '/auth?mode=login'

const STEPS = [
  { title: 'Pick a horse in every race', desc: 'Each Saturday and at the big festivals. Change your mind until picks lock.' },
  { title: 'Score on the result', desc: 'Winners and placed horses score, and bigger prices score bigger.' },
  { title: 'Beat your mates', desc: 'Start a private group, share the code, and fight it out on your own table.' },
]

// Where a visitor goes from here: fetched in idle time once the landing page is showing.
const NEXT_PAGES = [load.Auth, load.Join, load.Welcome, load.SetPassword]

// How long to wait for the saved session before showing the page anyway (slow or offline).
const SESSION_WAIT_MS = 3000

export default function App() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false) // false while we check for a saved session
  const [teaser, setTeaser] = useState(null)
  const [showRules, setShowRules] = useState(false)

  // Check the session once. Signed in: go to where they belong (a waiting invite, the welcome
  // flow, or the app) without the landing page being drawn first.
  useEffect(() => {
    let done = false
    const finish = user => {
      if (done) return
      done = true
      if (!user) { setReady(true); return }
      postAuthDestination(user)
        .catch(() => '/dashboard')
        .then(path => navigate(path, { replace: true }))
    }
    const wait = setTimeout(() => finish(null), SESSION_WAIT_MS)
    currentUser().then(finish, () => finish(null))
    return () => { done = true; clearTimeout(wait) }
  }, [navigate])

  // The landing page is the first page for a visitor who isn't signed in: the app-start splash can come down now. (A signed-in
  // player is sent on to their page, which takes the splash down when it has drawn.)
  useEffect(() => {
    if (!ready) return
    dismissSplash()
    prefetchPages(NEXT_PAGES)
  }, [ready])

  // Only visitors who stay need the festival card.
  useEffect(() => {
    if (!ready) return undefined
    let cancelled = false
    loadNextFestival().then(row => { if (!cancelled) setTeaser(festivalTeaser(row)) })
    return () => { cancelled = true }
  }, [ready])

  if (!ready) return <div className="lp lp--boot" />

  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-col lp-header__row">
          <div className="lp-wordmark"><span>SILKS</span> <span className="lp-wordmark__b">LEAGUE</span></div>
          <Link to={LOGIN} className="lp-login">Log in</Link>
        </div>
      </header>

      <main className="lp-col">
        <section className="lp-hero">
          <span className="lp-tag">FREE-TO-PLAY RACING GAME</span>
          <h1 className="lp-h1">
            <span>Pick your horses.</span>
            <span className="lp-h1__gold">Rule the league.</span>
          </h1>
          <p className="lp-lead">The racing game for you and your mates. No betting. No risk. Just bragging rights.</p>
          <Link to={SIGNUP} className="lp-btn">Join free</Link>
          <Link to="/join" className="lp-link lp-link--invite">Got an invite code from a mate?</Link>
          <PhoneMock />
        </section>

        <section className="lp-section" aria-labelledby="lp-how">
          <h2 className="lp-label" id="lp-how">HOW IT WORKS</h2>
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="lp-step">
                <span className="lp-step__num" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3 className="lp-step__title">{s.title}</h3>
                  <p className="lp-step__desc">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <button type="button" className="lp-link lp-link--rules" onClick={() => setShowRules(true)}>Full scoring rules</button>
        </section>

        {teaser && (
          <section className="lp-section" aria-labelledby="lp-coming">
            <h2 className="lp-label" id="lp-coming">COMING UP</h2>
            <FestivalTeaser teaser={teaser} />
          </section>
        )}

        <section className="lp-cta" aria-labelledby="lp-cta-h">
          <h2 className="lp-h2" id="lp-cta-h">Your mates are already picking.</h2>
          <Link to={SIGNUP} className="lp-btn">Join free</Link>
          <p className="lp-already">Already playing? <Link to={LOGIN} className="lp-link">Log in</Link></p>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-col lp-footer__col">
          <p className="lp-footer__tag">Free-to-play. No betting. No risk.</p>
          <nav className="lp-footer__links" aria-label="Footer">
            <a href="#" className="lp-link">Privacy</a>
            <a href="#" className="lp-link">Terms</a>
            <a href="#" className="lp-link">Contact</a>
          </nav>
          <p className="lp-footer__copy">© {new Date().getFullYear()} Silks League</p>
        </div>
      </footer>

      <HowItWorksModal open={showRules} onClose={() => setShowRules(false)} section="scoring" />
    </div>
  )
}
