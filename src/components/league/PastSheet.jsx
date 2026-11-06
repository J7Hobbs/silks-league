import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ukDateStr } from '../../lib/format.js'
import { loadPastFestivals, loadPastSeasons, seasonLabel } from '../../lib/leagueData.js'
import Sheet from '../groups/Sheet.jsx'
import '../../styles/groups.css'

// "Past leagues and festivals": finished festivals and earlier Saturday League seasons, each with
// who won, opening that competition's final table. Read-only; loads when the sheet opens.
//   excludeId  the festival the hub is already showing (left out of the list)
export default function PastSheet({ userId, excludeId, onClose }) {
  const [data, setData] = useState(null)   // { festivals, seasons } once loaded; a failed half is null

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadPastFestivals(ukDateStr(Date.now()), excludeId, userId).catch(() => null),
      loadPastSeasons(userId).catch(() => null),
    ]).then(([festivals, seasons]) => { if (!cancelled) setData({ festivals, seasons }) })
    return () => { cancelled = true }
  }, [userId, excludeId])

  const festivals = data?.festivals || []
  const seasons = data?.seasons || []
  const failed = data && !data.festivals && !data.seasons

  return (
    <Sheet onClose={onClose} labelledBy="past-title" dragToClose>
      <h2 id="past-title" className="gr-sheet__title gr-sheet__title--wrap">Past leagues and festivals</h2>

      {!data ? (
        <div className="lp-sheet__wait" role="status" aria-busy="true" aria-label="Loading">
          {[1, 2, 3].map(n => <span key={n} className="gr-skel-line" />)}
        </div>
      ) : failed ? (
        <p className="gr-sheet__text">Couldn't load these. Check your connection and try again.</p>
      ) : !festivals.length && !seasons.length ? (
        <p className="gr-sheet__text">Nothing here yet. Finished festivals and earlier seasons will appear once they're over.</p>
      ) : (
        <>
          {festivals.length > 0 && (
            <section className="lp-sheet__group" aria-label="Festivals">
              <h3 className="lp-sheet__head">Festivals</h3>
              <div className="gr-rows">
                {festivals.map(({ festival: f, winner }) => (
                  <Link key={f.id} to={`/league/past/festival/${f.id}`} className="gr-row lp-row">
                    <span className="lp-row__name">{f.display_name || f.name}</span>
                    <span className="lp-row__won"><span className="lp-row__wontext">{winner ? `Won by ${winner}` : 'No results'}</span><span className="gr-row__chev" aria-hidden="true">&rsaquo;</span></span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          {seasons.length > 0 && (
            <section className="lp-sheet__group" aria-label="Saturday League">
              <h3 className="lp-sheet__head">Saturday League</h3>
              <div className="gr-rows">
                {seasons.map(({ season, winner }) => (
                  <Link key={season.id} to={`/league/past/season/${season.id}`} className="gr-row lp-row">
                    <span className="lp-row__name">{seasonLabel(season)}</span>
                    <span className="lp-row__won"><span className="lp-row__wontext">{winner ? `Won by ${winner}` : 'No results'}</span><span className="gr-row__chev" aria-hidden="true">&rsaquo;</span></span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </Sheet>
  )
}
