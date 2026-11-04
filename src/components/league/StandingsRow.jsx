import { initialsFor } from '../../lib/leagueView.js'

// One player: rank, avatar, name with a sub-line, points. Tap to see their picks.
//   row  { rank, name, points, sub, isMe }
//   top  gold avatar (top three, once there are points)
export default function StandingsRow({ row, top, onClick }) {
  return (
    <button type="button" className={`lg-row${row.isMe ? ' lg-row--me' : ''}`} onClick={onClick}>
      <span className="lg-row__rank">{row.rank}</span>
      <span className={`lg-avatar${top ? ' lg-avatar--top' : ''}`} aria-hidden="true">{initialsFor(row.name)}</span>
      <span className="lg-row__main">
        <span className="lg-row__name">{row.name}{row.isMe ? ' (you)' : ''}</span>
        {row.sub && <span className="lg-row__sub">{row.sub}</span>}
      </span>
      <span className="lg-row__pts">{row.points}</span>
    </button>
  )
}
