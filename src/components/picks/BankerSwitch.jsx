// "Make this my banker": one race a day scores double. Used inside the bet panel.
//   on        the switch is on
//   movesFrom the number of the race that has the banker now (turning this on moves it), or null
//   onToggle  fn(nextOn)
import { BONUS_RULES } from '../../lib/bonuses.js'

export default function BankerSwitch({ on, movesFrom, onToggle }) {
  return (
    <div className="pk-banker">
      <button type="button" role="switch" aria-checked={on} className={`pk-banker__btn${on ? ' pk-banker__btn--on' : ''}`}
        onClick={() => onToggle(!on)}>
        <span className="pk-banker__text">
          <span className="pk-banker__title"><span aria-hidden="true">★ </span>Make this my banker</span>
          <span className="pk-banker__sub">{BONUS_RULES.bankerMultiplier === 2 ? 'Double' : `${BONUS_RULES.bankerMultiplier}×`} points · 1 per day</span>
        </span>
        <span className="pk-banker__track" aria-hidden="true"><span className="pk-banker__thumb" /></span>
      </button>
      {on && movesFrom != null && <p className="pk-banker__moves">This moves your banker from Race {movesFrom}</p>}
    </div>
  )
}
