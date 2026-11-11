// "Your meeting": where the player finished in each table, then four tiles. The same whichever chip is selected.
//   positions  [{ key, label, place, total, current }]
//   figures    { points, winners, picked, best, bestDay }
export default function MeetingCard({ title = 'Your meeting', positions, figures }) {
  const { best, bestDay } = figures
  return (
    <section className="fn-card fn-meeting" aria-label={title}>
      <h2 className="fn-h">{title}</h2>
      <ul className="fn-pos">
        {positions.map(p => (
          <li key={p.key} className={`fn-pos__row${p.current ? ' fn-pos__row--on' : ''}`}>
            <span className="fn-pos__label">{p.label}</span>
            <span className="fn-pos__val">{p.place} of {p.total}</span>
          </li>
        ))}
      </ul>
      <div className="fn-tiles">
        <div className="fn-tile">
          <span className="fn-tile__k">Points</span>
          <span className="fn-tile__v">{figures.points}</span>
        </div>
        <div className="fn-tile">
          <span className="fn-tile__k">Winners</span>
          <span className="fn-tile__v">{figures.winners} of {figures.picked}</span>
        </div>
        <div className="fn-tile">
          <span className="fn-tile__k">Best pick</span>
          {best ? (
            <>
              <span className="fn-tile__v fn-tile__v--txt">{[best.horse, best.price].filter(Boolean).join(' ')}</span>
              <span className="fn-tile__s">{best.outcome} &middot; Day {best.dayNumber} &middot; {best.points} pts</span>
            </>
          ) : <span className="fn-tile__v">–</span>}
        </div>
        <div className="fn-tile">
          <span className="fn-tile__k">Best day</span>
          {bestDay ? (
            <>
              <span className="fn-tile__v">Day {bestDay.dayNumber}</span>
              <span className="fn-tile__s">{bestDay.points} pts</span>
            </>
          ) : <span className="fn-tile__v">–</span>}
        </div>
      </div>
    </section>
  )
}
