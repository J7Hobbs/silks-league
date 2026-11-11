import { Link } from 'react-router-dom'
import { finalPath } from '../../lib/finalTable.js'

// "Final · <festival name>": the champion and where the player finished, linking to the wrap-up page.
//   summary  finalSummary() from lib/festivalFinal.js: { champion, mine, total }
export default function FinalCard({ festivalId, name, summary }) {
  const { champion, mine, total } = summary
  return (
    <Link to={finalPath(festivalId)} className="fn-teaser" aria-label={`Final table, ${name}`}>
      <span className="fn-teaser__title">Final &middot; {name}</span>
      {champion && <span className="fn-teaser__line">{champion.name} · {champion.points} pts</span>}
      {mine && <span className="fn-teaser__me">You finished {mine.label} of {total}</span>}
      <span className="fn-teaser__go" aria-hidden="true">&rsaquo;</span>
    </Link>
  )
}
