import { getPlaceTerms, placeTermTiers, SCORING_RULES } from '../../lib/scoring.js'

// "Race 3 · 13:50 Wincanton", the race name, "2m · 7 runners", and what you can pick:
// "Win" / "Win only", "Each-way · top 3" and a one-line note. The wording is worked out from
// lib/scoring.js (place terms, the win-only price and the smallest each-way field), so it
// follows the rules if they change. runnerCount is the same non-withdrawn count as "N runners".
const winOnlyPrice = `${+(SCORING_RULES.winOnlyBelowDecimal - 1).toFixed(2)}/1`   // 5.0 decimal -> "4/1"
const minEachWayField = placeTermTiers().find(t => t.eachWayAvailable)?.from        // smallest field with each-way

export default function RaceHeader({ race, runnerCount }) {
  const when = [race.race_time, race.venue].filter(Boolean).join(' ')
  const sub = [
    race.distance,
    runnerCount > 0 ? `${runnerCount} ${runnerCount === 1 ? 'runner' : 'runners'}` : null,
  ].filter(Boolean).join(' · ')
  const { eachWayAvailable, placesPaid } = getPlaceTerms(runnerCount)
  return (
    <section className="pk-race">
      <div className="pk-race__meta">{`Race ${race.race_number}${when ? ` · ${when}` : ''}`}</div>
      {race.race_name && <h2 className="pk-race__name">{race.race_name}</h2>}
      {sub && <div className="pk-race__sub">{sub}</div>}
      {runnerCount > 0 && (
        <div className="pk-race__rules">
          <div className="pk-race__pills">
            <span className="pk-pill pk-pill--gold">{eachWayAvailable ? 'Win' : 'Win only'}</span>
            {eachWayAvailable && <span className="pk-pill pk-pill--green">{`Each-way · top ${placesPaid}`}</span>}
          </div>
          <div className="pk-race__rulenote">
            {eachWayAvailable
              ? `Each-way on horses ${winOnlyPrice} or bigger`
              : `Under ${minEachWayField} runners, so no places paid`}
          </div>
        </div>
      )}
    </section>
  )
}
