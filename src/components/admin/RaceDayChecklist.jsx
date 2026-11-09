import { runnersWithoutPrice, noPriceMessage } from '../../lib/raceDay.js'
import '../../styles/admin-raceday.css'

// Shown under a race day (a Saturday week or a festival day) once its races are loaded:
//  1. runners with no price, which would score 0
//  2. the picks-open notification: whether it has gone out yet, and the button to send it
export default function RaceDayChecklist({ title, races, runnersByRace, notifiedAt, onNotify, busy }) {
  if (!races?.length) return null
  const missing = runnersWithoutPrice(races, runnersByRace)
  const sent = notifiedAt ? new Date(notifiedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null

  return (
    <section className="rd-panel" aria-label={`${title} checklist`}>
      <h3 className="rd-panel__title">Before picks open</h3>

      <div className="rd-step">
        <div className={`rd-step__mark${missing.length ? ' rd-step__mark--warn' : ' rd-step__mark--ok'}`} aria-hidden="true">{missing.length ? '!' : '✓'}</div>
        <div className="rd-step__body">
          <div className="rd-step__name">{missing.length ? 'Some runners have no price' : 'Every runner has a price'}</div>
          {missing.length > 0 && (
            <ul className="rd-warns">
              {missing.map(({ race, runner }) => (
                <li key={runner.id}><strong>Race {race.race_number}</strong> {noPriceMessage(runner.horse_name)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rd-step">
        <div className={`rd-step__mark${sent ? ' rd-step__mark--ok' : ''}`} aria-hidden="true">{sent ? '✓' : '2'}</div>
        <div className="rd-step__body">
          <div className="rd-step__name">Picks-open notification</div>
          <div className="rd-step__sub">{sent ? `Sent ${sent}` : `Not sent yet. Players are told ${title} are live.`}</div>
          <button type="button" className={`rd-btn ${sent ? 'rd-btn--ghost' : 'rd-btn--solid'}`} onClick={onNotify} disabled={busy}>
            {sent ? 'Send again' : 'Send picks-open notification'}
          </button>
        </div>
      </div>
    </section>
  )
}
