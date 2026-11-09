// The bonus points rules, written from BONUS_RULES (and calcTokenPoints for the example), so what a
// player reads is what is scored. Used by the Bonus points page and the How it works sheet.
import { BONUS_RULES } from '../lib/bonuses.js'
import { calcTokenPoints } from '../lib/scoring.js'
import '../styles/bonus.css'

const WORDS = { 2: 'Double', 3: 'Triple' }
const NUMBER_WORDS = { 2: 'two', 3: 'three', 4: 'four' }
const startLabel = new Date(BONUS_RULES.startDate + 'T12:00:00Z')
  .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

// A 5/1 all-in win in an 8-runner race, worked out by calcTokenPoints.
const EXAMPLE_WIN = calcTokenPoints({ betType: 'win', position: 1, oddsDecimal: 6, runnerCount: 8 }).totalPoints

export default function BonusRules() {
  const r = BONUS_RULES
  const mult = r.bankerMultiplier
  const winners = NUMBER_WORDS[r.trebleWinners] || String(r.trebleWinners)
  return (
    <div className="bp">
      <p className="bp-p">
        Bonus points start at the Cheltenham November Meeting ({startLabel}) and apply to every Saturday League week and
        festival day from then on. They are added on top of your normal points and count in every table.
      </p>

      <div className="bp-rule">
        <div className="bp-rule__head"><span className="bp-rule__name">★ Banker</span><span className="bp-rule__val">×{mult}</span></div>
        <ul className="bp-list">
          <li>Pick one race each race day as your banker. {WORDS[mult] || `${mult}×`} points on that race.</li>
          <li>Change it any time until picks lock.</li>
          <li>It doubles that race&rsquo;s normal points only, not the other bonuses.</li>
          <li>If your horse is withdrawn, the banker stays on that race with your replacement.</li>
        </ul>
      </div>

      <div className="bp-rule">
        <div className="bp-rule__head"><span className="bp-rule__name">Lone winner</span><span className="bp-rule__val">+{r.loneWinnerPoints}</span></div>
        <ul className="bp-list">
          <li>You are the only player whose pick won the race.</li>
          <li>It can happen in several races on the same day.</li>
          <li>If two or more players have a winner, nobody gets it.</li>
        </ul>
      </div>

      <div className="bp-rule">
        <div className="bp-rule__head"><span className="bp-rule__name">Treble</span><span className="bp-rule__val">+{r.treblePoints}</span></div>
        <ul className="bp-list">
          <li>{winners[0].toUpperCase() + winners.slice(1)} winners in a row: consecutive races on the same race day, by race number.</li>
          <li>A race with no pick, or a loser, breaks the run.</li>
          <li>Once per race day, added to the race that completes the run.</li>
        </ul>
      </div>

      <div className="bp-example">
        <span className="bp-example__label">Example</span>
        <span>A 5/1 all-in win scores {EXAMPLE_WIN}. As your banker it scores {EXAMPLE_WIN * mult}. If you were also the only
          winner of that race, add {r.loneWinnerPoints}: {EXAMPLE_WIN * mult + r.loneWinnerPoints}.</span>
      </div>

      <p className="bp-p bp-p--muted">A Saturday that is part of a festival day is one race day: you get one banker and one set of bonuses, and they count for both tables.</p>
    </div>
  )
}
