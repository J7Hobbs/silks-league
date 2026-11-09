import { useMemo, useState } from 'react'
import Sheet from '../../components/groups/Sheet.jsx'
import ResultsForm from '../../components/admin/ResultsForm.jsx'
import { resultsRules, validateResults } from '../../lib/raceDay.js'
import { previewResult, saveRaceResult } from '../../lib/adminToday.js'
import { clockText } from '../../lib/format.js'
import { bonusesApply } from '../../lib/bonuses.js'
import '../../styles/groups.css'
import '../../styles/admin-new.css'

// The result sheet for one race: positions, a preview of what saving will do, then save, score and notify.
//   detail   what Today loaded for the day (runners, picks, results, usernames)
//   onSaved  called with { ok, text, warn } after a save so Today can reload and show a toast
export default function ResultSheet({ day, race, detail, onSaved, onClose }) {
  const runners = useMemo(() => detail.runners.filter(r => r.race_id === race.id), [detail, race.id])
  const existing = useMemo(() => detail.results.filter(r => r.race_id === race.id), [detail, race.id])
  const isEdit = existing.length > 0
  const [form, setForm] = useState(() => Object.fromEntries(existing.map(r => [`horse${r.position}`, r.horse_name])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const rules = resultsRules(runners)
  const withdrawn = runners.filter(r => r.is_withdrawn).length
  const preview = previewResult({ race, runners, picks: detail.picks, form, usernames: detail.usernames, bonuses: bonusesApply(day.date) })
  const name = race.race_name || race.venue || ''

  async function save() {
    const check = validateResults(runners, form)
    if (!check.ok) { setError(check.message); return }
    setSaving(true); setError('')
    const r = await saveRaceResult(day.kind, race, runners, check.rows, { festivalId: day.festival?.id, notify: !isEdit })
    setSaving(false)
    if (!r.ok) { setError(r.msg); return }
    const bits = [`Race ${race.race_number} ${isEdit ? 'corrected' : 'saved'}${r.count ? ` · ${r.count} score${r.count === 1 ? '' : 's'} written` : ''}`]
    if (isEdit) bits.push('players not re-notified')
    else bits.push(r.notified ? 'players notified' : 'NOTIFICATION FAILED, send it from the classic Admin')
    onSaved({ ok: r.notified || isEdit, text: bits.join(' · '), warn: r.warn })
  }

  return (
    <Sheet onClose={() => { if (!saving) onClose() }} labelledBy="an-rs-title" dragToClose className="an-sheet">
      <div className="an-rs__head">
        <div className="an-rs__eyebrow">Race {race.race_number} · {clockText(race.race_time) || 'time TBA'}</div>
        <h2 className="an-rs__title" id="an-rs-title">{name || `Race ${race.race_number}`}</h2>
        <div className="an-rs__facts">
          <span>{rules.ran} ran</span>
          <span>{rules.eachWayAvailable ? `Places paid: top ${rules.placesPaid}` : 'Win only'}</span>
          <span className={withdrawn ? 'an-rs__fact--warn' : ''}>{withdrawn} non-runner{withdrawn === 1 ? '' : 's'}</span>
        </div>
      </div>

      <ResultsForm
        runners={runners}
        form={form}
        onChange={(k, v) => { setError(''); setForm(f => ({ ...f, [k]: v })) }}
        onSubmit={save}
        saving={saving}
        isEdit={isEdit}
        lockedCount={race.runner_count_at_lock}
        submitLabel={isEdit ? 'Save correction' : 'Save result · then notify players'}
        onCancel={onClose}
        hideHeadline
        beforeStatus={preview ? <div className="an-rs__preview" role="status">{preview}</div> : null}
      />
      {error && <div className="an-rs__error" role="alert">{error}</div>}
    </Sheet>
  )
}
