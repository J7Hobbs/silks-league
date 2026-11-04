import Silk from '../Silk.jsx'
import { ordinal } from '../../lib/format.js'

// One race: where it ran and who won, the player's pick with its position and
// points, and (on tap) the full placings.
export default function RaceCard({ row, open, onToggle }) {
  const { pick, pending } = row
  const expandable = !pending
  const note = pick?.replaced
    ? 'Original pick withdrawn – replaced with the favourite'
    : pick?.withdrawn ? 'Your pick was withdrawn' : ''

  const body = (
    <>
      <span className="rs-card__top">
        <span className="rs-card__where">{row.where}</span>
        {pending ? (
          <span className="rs-card__win">Result pending</span>
        ) : row.winner && (
          <span className="rs-card__win">
            Won by {row.winner.name}{row.winner.sp ? ` · ${row.winner.sp}` : ''}
          </span>
        )}
      </span>

      <span className="rs-card__main">
        {pick?.silk && <Silk runner={pick.silk} style={{ flex: 'none', width: 30, height: 30 }} />}
        <span className="rs-card__pick">
          <span className="rs-card__label">Your pick</span>
          <span className={`rs-card__name${pick ? '' : ' rs-card__name--none'}`}>{pick ? pick.name : 'No pick'}</span>
        </span>
        {row.badge && <span className="rs-badge">{row.badge}</span>}
        {row.eachWay && <span className="rs-badge rs-badge--ew">E/W</span>}
        {!pending && (
          <span className={`rs-pts rs-pts--${row.tone}`}>{row.points} pts</span>
        )}
      </span>

      {note && <span className="rs-card__note">{note}</span>}
    </>
  )

  return (
    <div className="rs-card">
      {expandable ? (
        <button type="button" className="rs-card__hit" aria-expanded={open} onClick={onToggle}>{body}</button>
      ) : (
        <div className="rs-card__hit rs-card__hit--static">{body}</div>
      )}

      {open && expandable && (
        <ol className="rs-places">
          {row.placings.map(pl => (
            <li key={pl.position} className={`rs-place${pl.mine ? ' rs-place--mine' : ''}`}>
              <span className="rs-place__pos">{ordinal(pl.position)}</span>
              <span className="rs-place__name">
                {pl.name}
                {pl.mine && <span className="rs-place__tag">Your pick</span>}
              </span>
              <span className="rs-place__sp">{pl.sp}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
