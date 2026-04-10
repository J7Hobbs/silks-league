import { useNavigate } from 'react-router-dom'
import './index.css'

const STATS = [
  { value: '5', label: 'Races per Saturday' },
  { value: '15', label: 'Max points available' },
  { value: '3pts', label: 'For a winner' },
  { value: '£0', label: 'Cost to play' },
]

const STEPS = [
  {
    num: '01',
    title: 'Create or join a group',
    desc: 'Set up a private group with friends or join an existing one with a unique invite code.',
    icon: '🏇',
  },
  {
    num: '02',
    title: 'Pick your 5 horses',
    desc: 'Each Saturday, select one horse per race before the off. No changing your mind.',
    icon: '✏️',
  },
  {
    num: '03',
    title: 'Watch the races live',
    desc: 'Tune in and see how your picks perform across all 5 races throughout the afternoon.',
    icon: '📺',
  },
  {
    num: '04',
    title: 'Top the leaderboard',
    desc: 'Points accumulate each week. The sharpest picker across the season wins.',
    icon: '🏆',
  },
]

const LEADERBOARD = [
  { pos: 1, name: 'Charlie H.', races: [3, 2, 0, 3, 1], total: 9 },
  { pos: 2, name: 'Sarah M.', races: [0, 3, 2, 1, 3], total: 9 },
  { pos: 3, name: 'James T.', races: [2, 1, 3, 0, 2], total: 8 },
  { pos: 4, name: 'Emma R.', races: [1, 0, 2, 3, 1], total: 7 },
  { pos: 5, name: 'Tom B.', races: [3, 1, 0, 2, 0], total: 6 },
]

function PipCell({ pts }) {
  const cls = pts === 3 ? 'pip pip-gold' : pts === 2 ? 'pip pip-silver' : pts === 1 ? 'pip pip-bronze' : 'pip pip-empty'
  return (
    <span className="lb-race-cell">
      <span className={cls}>{pts > 0 ? pts : '—'}</span>
    </span>
  )
}

export default function App() {
  const navigate = useNavigate()
  const goToAuth = () => navigate('/auth')

  return (
    <div className="app">

      {/* ── NAV ── */}
      <nav className="nav">
        <div className="nav-inner">
          <div className="nav-logo">Silks League</div>
          <div className="nav-links">
            <a href="#how-it-works" className="nav-link">How it works</a>
            <a href="#points" className="nav-link">Points</a>
            <a href="#leaderboard" className="nav-link">Leaderboard</a>
            <a href="#groups" className="nav-link">Groups</a>
          </div>
          <button className="btn-gold nav-cta" onClick={goToAuth}>Join free</button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="hero">
        <div className="hero-glow" />
        <div className="hero-inner">
          <div className="hero-badge">
            <span className="badge-pulse" />
            Every Saturday &middot; 5 races &middot; Free to play
          </div>
          <h1 className="hero-headline">
            Pick your horses.<br />Rule the league.
          </h1>
          <p className="hero-sub">
            The ultimate free-to-play horse racing game for you and your friends.
            No betting. No risk. Just pure competition.
          </p>
          <div className="hero-ctas">
            <button className="btn-gold btn-large" onClick={goToAuth}>
              Create your group
            </button>
            <a href="#how-it-works" className="btn-outline btn-large">
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* ── STATS STRIP ── */}
      <div className="stats-strip">
        {STATS.map((s) => (
          <div key={s.label} className="stat-item">
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── HOW IT WORKS ── */}
      <section className="section" id="how-it-works">
        <div className="section-inner">
          <div className="section-eyebrow">How it works</div>
          <h2 className="section-title">Four steps to glory</h2>
          <div className="steps-grid">
            {STEPS.map((s) => (
              <div key={s.num} className="step-card">
                <div className="step-icon">{s.icon}</div>
                <div className="step-num">{s.num}</div>
                <h3 className="step-title">{s.title}</h3>
                <p className="step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── POINTS SYSTEM ── */}
      <section className="section section-alt" id="points">
        <div className="section-inner split">
          <div className="split-text">
            <div className="section-eyebrow">Points system</div>
            <h2 className="section-title">Simple.<br />Transparent.<br />Competitive.</h2>
            <p className="split-body">
              Every race, every Saturday — points are awarded to the top three finishers.
              With 5 races and a maximum of 15 points on offer, every single pick matters.
            </p>
            <p className="split-body">
              This rewards consistency, not luck. The sharpest reader of form across the
              season earns the crown — not whoever fluked a big Saturday.
            </p>
          </div>
          <div className="points-stack">
            <div className="points-card points-gold">
              <span className="points-pos">1st place</span>
              <span className="points-val">3 pts</span>
            </div>
            <div className="points-card points-silver">
              <span className="points-pos">2nd place</span>
              <span className="points-val">2 pts</span>
            </div>
            <div className="points-card points-bronze">
              <span className="points-pos">3rd place</span>
              <span className="points-val">1 pt</span>
            </div>
            <div className="points-max-banner">
              Maximum <strong>15 points</strong> available per Saturday
            </div>
          </div>
        </div>
      </section>

      {/* ── LEADERBOARD PREVIEW ── */}
      <section className="section" id="leaderboard">
        <div className="section-inner">
          <div className="section-eyebrow">Live leaderboard</div>
          <h2 className="section-title">See who's leading the pack</h2>

          <div className="lb-card">
            <div className="lb-week-label">Week 12 · Cheltenham · 22 Mar 2025</div>
            <div className="lb-table">
              <div className="lb-head">
                <span className="lb-pos">#</span>
                <span className="lb-name">Player</span>
                <span className="lb-race">R1</span>
                <span className="lb-race">R2</span>
                <span className="lb-race">R3</span>
                <span className="lb-race">R4</span>
                <span className="lb-race">R5</span>
                <span className="lb-total">Pts</span>
              </div>
              {LEADERBOARD.map((p) => (
                <div key={p.pos} className={`lb-row ${p.pos === 1 ? 'lb-row-leader' : ''}`}>
                  <span className="lb-pos">{p.pos === 1 ? '👑' : p.pos}</span>
                  <span className="lb-name lb-name-val">{p.name}</span>
                  {p.races.map((pts, i) => (
                    <PipCell key={i} pts={pts} />
                  ))}
                  <span className="lb-total lb-total-val">{p.total}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="lb-note">
            Live results update automatically each Saturday after the final race.
          </p>
        </div>
      </section>

      {/* ── PRIVATE GROUPS ── */}
      <section className="section section-alt" id="groups">
        <div className="section-inner split split-reverse">
          <div className="split-text">
            <div className="section-eyebrow">Private groups</div>
            <h2 className="section-title">Your circle.<br />Your competition.</h2>
            <p className="split-body">
              Create a private group and invite your friends, family, or workmates with a
              unique code. No strangers, no noise — just the people you actually want to beat.
            </p>
            <p className="split-body">
              Run multiple groups at once. A work sweepstake, a family league, a mates'
              competition — all separate, all free.
            </p>
            <button className="btn-gold" onClick={goToAuth}>Start a group</button>
          </div>

          <div className="groups-visual">
            <div className="group-card">
              <div className="group-card-header">
                <span className="group-name">The Friday Firm</span>
                <span className="group-live">● Live</span>
              </div>
              <div className="group-code">Invite code: <strong>FIRM88</strong></div>
              <div className="group-members-row">
                {['C', 'S', 'J', 'E', 'T', 'R'].map((l, i) => (
                  <div key={i} className="avatar" style={{ zIndex: 10 - i, marginLeft: i === 0 ? 0 : '-8px' }}>
                    {l}
                  </div>
                ))}
                <span className="members-count">6 members</span>
              </div>
              <div className="group-stats-row">
                <div className="group-stat">
                  <span className="gs-val">Week 12</span>
                  <span className="gs-label">Current week</span>
                </div>
                <div className="group-stat">
                  <span className="gs-val">9 pts</span>
                  <span className="gs-label">Top score</span>
                </div>
                <div className="group-stat">
                  <span className="gs-val">Sat 2pm</span>
                  <span className="gs-label">Next picks due</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="section cta-section">
        <div className="cta-glow" />
        <div className="section-inner cta-inner">
          <div className="section-eyebrow">Ready to play?</div>
          <h2 className="section-title cta-headline">
            Free to join.<br />Free to play.<br />Every Saturday.
          </h2>
          <button className="btn-gold btn-xl" onClick={goToAuth}>
            Create your group →
          </button>
          <p className="cta-sub">No card required. No betting. Just racing.</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-logo">Silks League</div>
          <p className="footer-tagline">Free-to-play horse racing. No betting. No risk.</p>
          <div className="footer-links">
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
          <p className="footer-copy">© 2025 Silks League. All rights reserved.</p>
        </div>
      </footer>

    </div>
  )
}
