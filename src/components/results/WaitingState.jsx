import { Link } from 'react-router-dom'
import EchoRings from '../home/EchoRings.jsx'
import { ordinal } from '../../lib/format.js'
import { shortDate } from '../../lib/resultsView.js'

// Between one race week and the next: a faded ghost of the normal Results layout with a card on top.
//   next  { kind, id, date } the next race day whose races are loaded (so its picks are open), or null
//   last  { points, rank, total } from the race day just finished, or null when the player didn't play
export default function WaitingState({ next, last }) {
  const picksState = next?.kind === 'festival' ? { festivalTab: next.id } : undefined
  return (
    <div className="rs-wait">
      <div className="rs-wait__ghost" aria-hidden="true">
        <div className="rs-ghost rs-ghost--hero"><div className="rs-hero__echo"><EchoRings boost={2} /></div></div>
        <div className="rs-boxes">
          <div className="rs-ghost rs-ghost--box" /><div className="rs-ghost rs-ghost--box" /><div className="rs-ghost rs-ghost--box" />
        </div>
        <div className="rs-list">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="rs-ghost rs-ghost--card" />)}
        </div>
      </div>

      <div className="rs-wait__over">
        <section className="rs-wait__card" aria-label="New race week coming">
          <span className="rs-wait__icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
          </span>
          <h2 className="rs-wait__title">New race week coming</h2>
          <p className="rs-wait__text">
            {next
              ? `Picks for ${shortDate(next.date)} are open. Your results will appear here once racing starts.`
              : "Saturday's races are announced Friday. Your results will appear here once racing starts."}
          </p>
          {last && (
            <p className="rs-wait__last">
              Last week: <span className="rs-wait__pts">{last.points} pts</span> · {ordinal(last.rank)} of {last.total}
            </p>
          )}
          <div className="rs-wait__btns">
            {next && <Link className="rs-wait__btn rs-wait__btn--solid" to="/picks" state={picksState}>Make your picks</Link>}
            <Link className="rs-wait__btn rs-wait__btn--line" to="/league">See the Leaderboard</Link>
          </div>
        </section>
      </div>
    </div>
  )
}
