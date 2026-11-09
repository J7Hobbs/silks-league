import { resultsRules, resultsHeadline, validateResults, positionLabel } from '../../lib/raceDay.js'
import '../../styles/admin-raceday.css'

// The results entry form for one race, Saturday or festival. It asks for 1st plus every paid place
// (the minimum is just 1st), offers further places up to 4th as optional, never lists a withdrawn
// runner, and keeps Save switched off until the required positions are filled.
//   runners  all of the race's runners (withdrawn ones are filtered out here)
//   form     { horse1, horse2, horse3, horse4 } by horse name
//   lockedCount  runner_count_at_lock, when "Lock Picks" has stamped it
export default function ResultsForm({ runners, form, onChange, onSubmit, onCancel, saving, isEdit, lockedCount, submitLabel }) {
  const rules = resultsRules(runners)
  const check = validateResults(runners, form)
  const running = (runners || [])
    .filter(r => !r.is_withdrawn)
    .sort((a, b) => (a.horse_number ?? 999) - (b.horse_number ?? 999))
  const taken = name => [1, 2, 3, 4].some(p => form[`horse${p}`] === name)

  return (
    <div className="rd-form">
      <div className="rd-form__head">
        <div className="rd-form__headline">{resultsHeadline(rules)}</div>
        {lockedCount != null && lockedCount !== rules.ran && (
          <div className="rd-form__note">Scoring uses the {lockedCount} runners counted at Lock Picks.</div>
        )}
        {isEdit && <div className="rd-form__note rd-form__note--warn">Editing results. Existing scores are recalculated when you save.</div>}
      </div>

      {rules.shown === 0 && <div className="rd-form__note rd-form__note--warn">Every runner is withdrawn, so there is nothing to place.</div>}

      {Array.from({ length: rules.shown }, (_, i) => i + 1).map(pos => {
        const key = `horse${pos}`
        const required = pos <= rules.required
        const value = running.some(r => r.horse_name === form[key]) ? form[key] : ''
        return (
          <label key={pos} className="rd-pos">
            <span className="rd-pos__label">
              <span className="rd-pos__name">{positionLabel(pos)}</span>
              <span className={`rd-tag${required ? ' rd-tag--req' : ''}`}>{required ? 'Required' : 'Optional'}</span>
            </span>
            <select
              className="rd-select"
              value={value}
              onChange={e => onChange(key, e.target.value)}
              aria-label={`${positionLabel(pos)} place`}
            >
              <option value="">Select horse…</option>
              {running.map(r => (
                <option key={r.id} value={r.horse_name} disabled={taken(r.horse_name) && value !== r.horse_name}>
                  {r.horse_number ? `${r.horse_number}. ` : ''}{r.horse_name}{r.odds_fractional ? ` (${r.odds_fractional})` : ''}
                </option>
              ))}
            </select>
          </label>
        )
      })}

      <div className={`rd-form__status${check.ok ? ' rd-form__status--ok' : ''}`} role="status">
        {check.ok ? 'Ready to save' : check.message}
      </div>
      <div className="rd-actions">
        <button type="button" className="rd-btn rd-btn--solid" onClick={onSubmit} disabled={saving || !check.ok}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && <button type="button" className="rd-btn rd-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>}
      </div>
    </div>
  )
}
