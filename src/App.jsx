import { useNavigate } from 'react-router-dom'
import './index.css'

const STATS = [
  { value: '5', label: 'Races every Saturday' },
  { value: '25pts', label: 'For a winner' },
  { value: '200', label: 'Max points per week' },
  { value: '£0', label: 'Cost to play' },
]

const STEPS = [
  {
    num: '01',
    title: 'Create or join a group',
    desc: 'Set up a private group with friends or join the public top-10 league. Invite mates with a unique group code.',
    icon: '🏇',
  },
  {
    num: '02',
    title: 'Pick your 5 horses',
    desc: 'Each Saturday, pick one horse per race from the listed runners. Picks open on Friday and close at 11am Saturday — change your mind as many times as you like before the cutoff.',
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
    title: 'Chase the championship',
    desc: 'Points stack up each week. Win the weekly prize, top your quarterly group, or go all out for the annual champion title.',
    icon: '🏆',
  },
]

const ODDS_BONUS = [
  { range: 'Shorter than 2/1', winner: '+0', placed: '+0' },
  { range: '2/1 – 4/1', winner: '+2', placed: '+1' },
  { range: '9/2 – 10/1', winner: '+5', placed: '+2' },
  { range: '11/1 – 20/1', winner: '+10', placed: '+3' },
  { range: '20/1 +', winner: '+15', placed: '+4' },
]

const LEADERBOARD = [
  { pos: 1, name: 'Charlie H.', races: [25, 15, 0, 30, 10], total: 80 },
  { pos: 2, name: 'Sarah M.', races: [0, 30, 15, 10, 25], total: 80 },
  { pos: 3, name: 'James T.', races: [25, 0, 25, 15, 10], total: 75 },
  { pos: 4, name: 'Emma R.', races: [10, 15, 25, 0, 15], total: 65 },
  { pos: 5, name: 'Tom B.', races: [25, 10, 0, 15, 0], total: 50 },
]

function PipCell({ pts }) {
  const cls =
    pts >= 25 ? 'pip pip-gold' :
    pts >= 10 ? 'pip pip-silver' :
    pts > 0   ? 'pip pip-bronze' : 'pip pip-empty'
  return (
    <span className="lb-race-cell">
      <span className={cls}>{pts > 0 ? pts : '—'}</span>
    </span>
  )
}

const ghostBtn = {
  background: 'transparent',
  border: '1.5px solid #c9a84c',
  color: '#c9a84c',
  borderRadius: '8px',
  padding: '0.55rem 1.25rem',
  fontFamily: "'DM Sans', sans-serif",
  fontWeight: '600',
  fontSize: '0.9rem',
  cursor: 'pointer',
  letterSpacing: '0.02em',
  transition: 'background 0.2s',
  whiteSpace: 'nowrap',
}

export default function App() {
  const navigate = useNavigate()
  const goToSignup = () => navigate('/auth?mode=signup')
  const goToLogin  = () => navigate('/auth?mode=login')

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
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button style={ghostBtn} onClick={goToLogin}>Log in</button>
            <button className="btn-gold nav-cta" onClick={goToSignup}>Join free</button>
          </div>
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
            <button className="btn-gold btn-large" onClick={goToSignup}>
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
              Every race, every Saturday — base points go to the top three finishers.
              Pick the winner at a big price and an odds bonus can push your score
              all the way up to 40 points in a single race.
            </p>
            <p className="split-body">
              With 5 races and a maximum of 200 points on offer each week, every pick matters.
              The season runs across four quarters — Q1 (Jan–Mar), Q2 (Apr–Jun),
              Q3 (Jul–Sep) and Q4 (Oct–Dec) — 13 Saturdays each. Compete for the weekly
              prize, your quarterly title, or go all out for the annual championship.
            </p>
          </div>
          <div className="points-stack">
            <div className="points-card points-gold">
              <span className="points-pos">1st place</span>
              <span className="points-val">25 pts</span>
            </div>
            <div className="points-card points-silver">
              <span className="points-pos">2nd place</span>
              <span className="points-val">15 pts</span>
            </div>
            <div className="points-card points-bronze">
              <span className="points-pos">3rd place</span>
              <span className="points-val">10 pts</span>
            </div>

            {/* Odds bonus table */}
            <div style={oddsBoxStyle}>
              <div style={oddsTitleStyle}>Odds bonus</div>
              <div style={oddsNoteStyle}>
                Winners get a bonus based on SP · Placed horses get ¼ of the bonus (rounded up)
              </div>
              <table style={oddsTableStyle}>
                <thead>
                  <tr>
                    <th style={oddsTh}>Starting price</th>
                    <th style={{ ...oddsTh, textAlign: 'center' }}>Winner</th>
                    <th style={{ ...oddsTh, textAlign: 'center' }}>Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {ODDS_BONUS.map((row) => (
                    <tr key={row.range}>
                      <td style={oddsTd}>{row.range}</td>
                      <td style={{ ...oddsTd, textAlign: 'center', color: '#c9a84c', fontWeight: '600' }}>{row.winner}</td>
                      <td style={{ ...oddsTd, textAlign: 'center', color: '#8ab88a' }}>{row.placed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="points-max-banner">
              Maximum <strong>40 points</strong> per race &nbsp;·&nbsp; <strong>200 points</strong> per week
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
            Max 40 pts per race · 200 pts per week · Odds bonus applied to winners and placed horses.
          </p>
        </div>
      </section>

      {/* ── PRIVATE GROUPS ── */}
      <section className="section section-alt" id="groups">
        <div className="section-inner split split-reverse">
          <div className="split-text">
            <div className="section-eyebrow">Private groups &amp; public league</div>
            <h2 className="section-title">Your circle.<br />Your competition.</h2>
            <p className="split-body">
              Create a private group and invite your friends, family, or workmates with a
              unique code. No strangers, no noise — just the people you actually want to beat.
              Run multiple groups at once: a work sweepstake, a family league, a mates'
              competition — all separate, all free.
            </p>
            <p className="split-body">
              Prefer a wider stage? Jump into the public league and see how you rank against
              all players — the top 10 are featured on the live public leaderboard every week.
            </p>
            <button className="btn-gold" onClick={goToSignup}>Start a group</button>
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
                  <span className="gs-val">80 pts</span>
                  <span className="gs-label">Top score</span>
                </div>
                <div className="group-stat">
                  <span className="gs-val">11am Sat</span>
                  <span className="gs-label">Picks deadline</span>
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
          <button className="btn-gold btn-xl" onClick={goToSignup}>
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

/* ── Odds bonus inline styles ── */
const oddsBoxStyle = {
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid rgba(201,168,76,0.15)',
  borderRadius: '10px',
  padding: '1rem 1.1rem',
}
const oddsTitleStyle = {
  fontFamily: "'Bebas Neue', sans-serif",
  fontSize: '1rem',
  color: '#c9a84c',
  letterSpacing: '0.08em',
  marginBottom: '0.35rem',
}
const oddsNoteStyle = {
  fontSize: '0.72rem',
  color: '#5a8a5a',
  marginBottom: '0.75rem',
  lineHeight: 1.45,
}
const oddsTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
}
const oddsTh = {
  fontSize: '0.7rem',
  fontWeight: '600',
  color: '#5a8a5a',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  paddingBottom: '0.4rem',
  borderBottom: '1px solid rgba(201,168,76,0.12)',
  textAlign: 'left',
}
const oddsTd = {
  fontSize: '0.8rem',
  color: '#e8f0e8',
  padding: '0.35rem 0',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
}
