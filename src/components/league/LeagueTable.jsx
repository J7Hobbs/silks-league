// The Leaderboard table with columns: position, player, one column per race week (or festival day)
// and TOT. Rows come from buildSatTable / buildFestTable (lib/leagueTable.js), already ranked;
// this only lays them out.
//   columns  [{ key, label, dim }]   (the hub passes just the last few)
//   rows     [{ id, rank, name, isMe, points, cells, best, move }]
//   variant  'hub' (inside a card, never scrolls) | 'full' (scrolls sideways, position and player stay put)
//   dense    narrower number columns (30px): a festival with five or more days
//   pinned   a row to mark as the pinned "you" row under the top five (hub)
export default function LeagueTable({ columns, rows, variant = 'full', dense = false, pinned = null, onPlayer }) {
  return (
    <div className={`lt lt--${variant}${dense ? ' lt--dense' : ''}`}>
      <div className="lt-scroll">
        <div className="lt-table">
          <div className="lt-row lt-head" aria-hidden="true">
            <span className="lt-pos" />
            <span className="lt-name" />
            {columns.map(c => (
              <span key={c.key} className={`lt-num${c.dim ? ' lt-num--dim' : ''}`}>{c.label}</span>
            ))}
            <span className="lt-tot">TOT</span>
          </div>
          {rows.map(r => (
            <button
              key={r.id}
              type="button"
              className={`lt-row${r.isMe ? ' lt-row--me' : ''}${r === pinned ? ' lt-row--pinned' : ''}`}
              aria-label={`${r.rank}. ${r.name}${r.isMe ? ' (you)' : ''}, ${r.points} points`}
              onClick={() => onPlayer(r)}
            >
              <span className={`lt-pos${r.rank === 1 ? ' lt-pos--first' : ''}`}>{r.rank}</span>
              <span className="lt-name">
                <span className="lt-name__txt">{r.name}</span>
                {r.move > 0 && <span className="lt-mv lt-mv--up" aria-label={`up ${r.move}`}>▲{r.move}</span>}
                {r.move < 0 && <span className="lt-mv lt-mv--down" aria-label={`down ${-r.move}`}>▼{-r.move}</span>}
              </span>
              {columns.map(c => {
                const v = r.cells[c.key]
                const cls = `lt-num${c.dim ? ' lt-num--dim' : v == null ? ' lt-num--none' : ''}`
                return (
                  <span key={c.key} className={cls}>
                    {v == null ? '–' : r.best[c.key] ? <span className="lt-best">{v}</span> : v}
                  </span>
                )
              })}
              <span className="lt-tot">{r.points}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// The one key under the hub cards.
export function TableKey() {
  return (
    <p className="lt-key">
      <span className="lt-best lt-key__pill">best that week</span>
      <span className="lt-mv--up">▲ up</span>
      <span className="lt-mv--down">▼ down</span>
    </p>
  )
}
