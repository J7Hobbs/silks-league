import Silk from '../Silk.jsx'
import { ordinal } from '../../lib/format.js'

const BET = { win: 'Win', each_way: 'Each-way' }

// One race: the player's pick with its price, and a score box with the finishing position and
// points. Tap a race (once its result is in) to see the full placings.
// `owner` is whose pick it is: "your" on the Results page, "their" when looking at another player.
export default function RaceCard({ row, open, onToggle, owner = 'your' }) {
  const { pick, pending } = row
  const note = pick?.replaced
    ? 'Original pick withdrawn – replaced with the favourite'
    : pick?.withdrawn ? `${owner === 'your' ? 'Your' : 'Their'} pick was withdrawn` : ''

  const body = (
    <>
      <span className="rs-card__silk">
        {pick?.silk
          ? <Silk runner={pick.silk} style={{ width: 30, height: 30 }} />
          : <Silk outline style={{ width: 30, height: 30, opacity: 0.45 }} />}
      </span>

      <span className="rs-card__main">
        <span className="rs-card__meta">{`Race ${row.raceNo}${row.time ? ` · ${row.time}` : ''}`}</span>
        <span className={`rs-card__name${pick ? '' : ' rs-card__name--none'}`}>{pick ? pick.name : 'No pick'}</span>
        {pick && (pick.price || BET[pick.betType]) && (
          <span className="rs-card__bet">
            {pick.price && <span className="pk-price rs-price">{pick.price}</span>}
            {BET[pick.betType] && <span className="rs-card__type">{BET[pick.betType]}</span>}
          </span>
        )}
      </span>

      <span className={`rs-score rs-score--${pending ? 'none' : row.tone}`}>
        <span className="rs-score__top">{pending ? '—' : row.scoreTop}</span>
        {pending ? (
          <span className="rs-score__pending">Pending</span>
        ) : (
          <>
            <span className="rs-score__pts">{row.points}</span>
            <span className="rs-score__unit">pts</span>
          </>
        )}
      </span>

      {note && <span className="rs-card__note">{note}</span>}
    </>
  )

  return (
    <div className={`rs-card${open && !pending ? ' rs-card--open' : ''}`}>
      {pending ? (
        <div className="rs-card__hit rs-card__hit--static">{body}</div>
      ) : (
        <button type="button" className="rs-card__hit" aria-expanded={open} onClick={onToggle}>{body}</button>
      )}

      {open && !pending && (
        <div className="rs-places">
          {row.note && <p className="rs-places__note">{row.note}</p>}
          <ol className="rs-places__list">
            {row.placings.map(pl => (
              <li key={pl.position} className={`rs-place${pl.mine ? ' rs-place--mine' : ''}`}>
                <span className="rs-place__pos">{ordinal(pl.position)}</span>
                <span className="rs-place__name">
                  <span className="rs-place__horse">{pl.name}</span>
                  {pl.mine && <span className="rs-place__tag"> · {owner} pick</span>}
                </span>
                <span className="rs-place__sp">{pl.sp}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
