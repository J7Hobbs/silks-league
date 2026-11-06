import { Link } from 'react-router-dom'
import { ordinal } from '../../lib/format.js'

// "Your groups": one row per group with the player's position in its Saturday season table.
//   groups  [{ id, name, memberCount, standing: { rank, total } | null }]
export default function GroupsList({ groups }) {
  return (
    <section className="lh-groups" aria-label="Your groups">
      <h2 className="lh-groups__head">Your groups</h2>
      {groups.length === 0 ? (
        <Link to="/groups" className="lh-groups__none">Make a group for you and your mates &rsaquo;</Link>
      ) : (
        <div className="lh-groups__list">
          {groups.map(g => (
            <Link key={g.id} to={`/league/group/${g.id}`} className="lh-group">
              <span className="lh-group__main">
                <span className="lh-group__name">{g.name}</span>
                <span className="lh-group__count">{g.memberCount} {g.memberCount === 1 ? 'player' : 'players'}</span>
              </span>
              {g.standing ? (
                <span className="lh-group__pos">
                  <span className="lh-group__rank">{ordinal(g.standing.rank)}</span>
                  <span className="lh-group__of">of {g.standing.total} &rsaquo;</span>
                </span>
              ) : (
                <span className="lh-group__of" aria-hidden="true">&rsaquo;</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
