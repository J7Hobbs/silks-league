import { positionLine, allZero } from '../../lib/leagueView.js'
import PositionCard from './PositionCard.jsx'
import NotInCard from './NotInCard.jsx'
import StandingsRow from './StandingsRow.jsx'

// A full table: your position card, a message when nothing is scored yet, the player rows and the
// "tap a player" hint. The same layout the Leaderboard has always had; the pages choose the rows.
//   rows  [{ id, rank, name, isMe, points, sub, modal }]
//   notIn     festival only: the player has not entered (shows the "Make picks" card)
export default function TableBody({ rows, caption, message, festival = false, notIn = false, onMakePicks, onPlayer }) {
  const me = rows.find(r => r.isMe)
  const empty = allZero(rows)
  return (
    <>
      {notIn ? (
        <NotInCard onMakePicks={onMakePicks} />
      ) : me && !empty ? (
        <PositionCard rank={me.rank} points={me.points} line={positionLine(me, rows)} caption={caption} />
      ) : (
        caption && <div className="lg-caption">{caption}</div>
      )}

      {(empty || !rows.length) && <p className="lg-msg">{rows.length || !festival ? message : 'No one has entered yet.'}</p>}

      {rows.length > 0 && (
        <div className="lg-list">
          {rows.map(row => (
            <StandingsRow key={row.id} row={row} top={!empty && row.rank <= 3} onClick={() => onPlayer(row)} />
          ))}
        </div>
      )}
      {rows.length > 0 && <p className="lg-foot">Tap any player to see their picks</p>}
    </>
  )
}
