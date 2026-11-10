import Sheet from '../groups/Sheet.jsx'
import { oddsText, withdrawalNotice } from '../../lib/raceDay.js'
import '../../styles/groups.css'
import '../../styles/admin-raceday.css'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Confirm sheet for withdrawing or reinstating a runner. It says what will change before anything does.
//   sheet  { mode: 'withdraw' | 'reinstate', plan }  (from planWithdrawal / planReinstate)
export default function WithdrawSheet({ sheet, busy, onConfirm, onClose }) {
  const { mode, plan } = sheet
  const { runner, race } = plan
  const raceNo = `Race ${race.race_number}`

  if (mode === 'reinstate') {
    return (
      <Sheet onClose={onClose} labelledBy="rd-sheet-title" dragToClose>
        <h2 className="gr-sheet__title gr-sheet__title--wrap" id="rd-sheet-title">Reinstate {runner.horse_name}?</h2>
        <ul className="rd-list">
          <li>{raceNo}: {runner.horse_name} runs again.</li>
          <li>{plan.picks.length
            ? `${plural(plan.picks.length, 'pick')} that were moved off this horse go back to it.`
            : 'No picks were moved off this horse, so nothing else changes.'}</li>
          {plan.hasResults && <li>Results are already in, so this race&rsquo;s scores are recalculated.</li>}
        </ul>
        <div className="rd-actions rd-actions--stack">
          <button type="button" className="gr-btn gr-btn--solid" onClick={onConfirm} disabled={busy} data-autofocus>{busy ? 'Working…' : 'Reinstate'}</button>
          <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </Sheet>
    )
  }

  const { favourite, picks } = plan
  const notice = favourite && picks.length
    ? withdrawalNotice({ beforeLock: plan.beforeLock, horse: runner.horse_name, raceNumber: race.race_number, favourite: favourite.horse_name, lockText: plan.lockText })
    : null

  return (
    <Sheet onClose={onClose} labelledBy="rd-sheet-title" dragToClose>
      <h2 className="gr-sheet__title gr-sheet__title--wrap" id="rd-sheet-title">Withdraw {runner.horse_name}?</h2>
      {plan.blocked ? (
        <>
          <p className="rd-blocked" role="alert">{plan.blocked}</p>
          <div className="rd-actions rd-actions--stack">
            <button type="button" className="gr-btn gr-btn--outline" onClick={onClose} data-autofocus>Close</button>
          </div>
        </>
      ) : (
        <>
          <p className="rd-when">{raceNo} · {plan.beforeLock ? 'Picks are still open' : 'Picks are locked'}</p>
          <ul className="rd-list">
            {picks.length > 0
              ? <li>{plural(picks.length, 'pick')} on {runner.horse_name} move to the favourite, <strong>{favourite.horse_name}</strong> ({oddsText(favourite)}).</li>
              : <li>Nobody has picked {runner.horse_name}, so no picks move.</li>}
            {plan.eachWayCount > 0 && <li>{plural(plan.eachWayCount, 'each-way pick')} become win bets, because {favourite.horse_name} is shorter than 4/1.</li>}
            {plan.rule4?.pence > 0 && <li><strong>Rule 4 of {plan.rule4.pence}p will apply to all picks in this race.</strong></li>}
            {plan.rule4?.missing?.length > 0 && <li className="rd-warn" role="alert">{plan.rule4.missing.join(' and ')} {plan.rule4.missing.length === 1 ? 'has' : 'have'} no price, so no Rule 4 deduction can be taken for {plan.rule4.missing.length === 1 ? 'it' : 'them'}. Add the price first if one should apply.</li>}
            {plan.hasResults && <li>Results are already in, so this race&rsquo;s scores{' '}are recalculated{race.festival_day_id ? ' (and the festival day totals)' : ''}.</li>}
            {picks.length > 0 && <li>{plural(new Set(picks.map(p => p.user_id)).size, 'player')} will be notified.</li>}
          </ul>
          {notice && <blockquote className="rd-quote">{notice}</blockquote>}
          <div className="rd-actions rd-actions--stack">
            <button type="button" className="gr-btn gr-btn--solid" onClick={onConfirm} disabled={busy} data-autofocus>{busy ? 'Working…' : 'Withdraw'}</button>
            <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </>
      )}
    </Sheet>
  )
}
