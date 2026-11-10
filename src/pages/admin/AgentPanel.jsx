import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { approveDraft, rejectDraft, racecardSummary } from '../../lib/agentRacecard.js'
import { AUTO_KEY, ALERT_KEY, writeAutoApply, writeAlertAdmins } from '../../lib/agentData.js'
import { ConfirmSheet } from './sheets.jsx'
import { dateText, plural } from '../../lib/adminFmt.js'
import { ukDateStr } from '../../lib/format.js'
import '../../styles/admin-new.css'

const KIND = { racecard: 'Racecard', morning_check: 'Morning check', results: 'Results' }

const whenText = iso => {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  const clock = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  return ukDateStr(d.getTime()) === ukDateStr(Date.now()) ? clock : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })} ${clock}`
}

// ── Agent: automatic mode ──────────────────────────────────────────────────
// The switch behind app_settings.agent_auto_apply. It only changes what happens to NEW submissions: drafts already waiting stay
// waiting. Turning it on or off asks first, writes the setting and logs it ("Automatic mode turned on by <name>").
export function AutoModeCard({ onChanged }) {
  const [on, setOn] = useState(null)                  // null = loading
  const [problem, setProblem] = useState('')
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error: err } = await supabase.from('app_settings').select('value').eq('key', AUTO_KEY).maybeSingle()
      if (!live) return
      if (err) { setProblem(err.message); setOn(false); return }
      if (!data) { setProblem('The setting is missing. Has the app settings migration been run?'); setOn(false); return }
      setProblem(''); setOn(data.value === true || data.value === 'true')
    })()
    return () => { live = false }
  }, [])

  async function change() {
    setBusy(true); setError('')
    const uid = (await supabase.auth.getUser()).data?.user?.id || null
    const prof = uid ? (await supabase.from('profiles').select('username').eq('id', uid).maybeSingle()).data : null
    const r = await writeAutoApply(!on, { userId: uid, by: prof?.username || 'an admin' })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setOn(r.on); setAsk(false); onChanged?.()
  }

  if (on === null) return null
  return (
    <section className="an-card an-card--plain ag-auto" aria-label="Agent: automatic mode">
      <div className="an-switchrow">
        <div className="an-switchrow__text">
          <h3 className="an-h3">Agent: automatic mode</h3>
          <p className="an-muted">{on
            ? 'Confirmed non-runners, jockey changes and weighed-in results go live automatically. Anything unclear still waits for you.'
            : 'Everything the agent finds waits for you to approve.'}</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label="Automatic mode" className={`an-switch${on ? ' an-switch--on' : ''}`} onClick={() => { setError(''); setAsk(true) }} disabled={!!problem || busy}>
          <span className="an-switch__knob" />
        </button>
      </div>
      {problem && <p className="an-muted" role="status">{problem}</p>}
      <AlertAdmins onChanged={onChanged} />
      {ask && (
        <ConfirmSheet title={on ? 'Turn automatic mode off?' : 'Turn automatic mode on?'} busy={busy} confirm={on ? 'Turn off' : 'Turn on'} onConfirm={change} onClose={() => setAsk(false)}>
          {on
            ? 'From now on everything the agent finds waits for you to approve. Anything it already applied stays as it is.'
            : 'Confirmed non-runners, jockey changes and weighed-in results the agent finds will go live straight away, with players told as usual. Anything unclear still waits for you.'}
          {' '}This applies to new submissions only; drafts already waiting stay waiting.
          {error && <span className="an-rs__error" role="alert"> {error}</span>}
        </ConfirmSheet>
      )}
    </section>
  )
}

// ── "Alerts go to": which admins get the agent's own pushes ("Silks League agent: …") ──
// A tick per admin, saved as soon as it is tapped (app_settings.agent_alert_admins) and logged. Player pushes are not affected.
function AlertAdmins({ onChanged }) {
  const [admins, setAdmins] = useState(null)          // [{ id, name }]
  const [ids, setIds] = useState(null)                // the saved list; null = no setting yet
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      const [a, s] = await Promise.all([
        supabase.from('profiles').select('id, username, full_name').eq('is_admin', true).order('username'),
        supabase.from('app_settings').select('value').eq('key', ALERT_KEY).maybeSingle(),
      ])
      if (!live) return
      setAdmins((a.data || []).map(p => ({ id: p.id, name: p.username || p.full_name || 'Admin' })))
      setIds(!s.error && s.data && Array.isArray(s.data.value) ? s.data.value.map(String) : null)
    })()
    return () => { live = false }
  }, [])

  async function toggle(admin) {
    if (ids === null || busy) return
    setBusy(true); setError('')
    const next = ids.includes(admin.id) ? ids.filter(x => x !== admin.id) : [...ids, admin.id]
    const uid = (await supabase.auth.getUser()).data?.user?.id || null
    const me = admins.find(x => x.id === uid)
    const r = await writeAlertAdmins(next, { userId: uid, by: me?.name || 'an admin', names: admins.filter(x => next.includes(x.id)).map(x => x.name) })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setIds(r.ids); onChanged?.()
  }

  if (!admins?.length) return null
  return (
    <div className="ag-alerts">
      <span className="ag-alerts__label" id="ag-alerts-label">Alerts go to</span>
      <div className="ag-alerts__list" role="group" aria-labelledby="ag-alerts-label">
        {admins.map(a => {
          const on = ids === null ? false : ids.includes(a.id)
          return (
            <button key={a.id} type="button" role="checkbox" aria-checked={on} className={`ag-alert${on ? ' ag-alert--on' : ''}`} onClick={() => toggle(a)} disabled={ids === null || busy}>
              {a.name}{on ? ' ✓' : ''}
            </button>
          )
        })}
      </div>
      {ids === null && <p className="an-muted" role="status">Not set up yet, so every admin gets them. Has the agent alerts migration been run?</p>}
      {ids !== null && ids.length === 0 && <p className="an-muted" role="status">Nobody gets agent alerts.</p>}
      {error && <p className="an-rs__error" role="alert">{error}</p>}
    </div>
  )
}

// ── What the race-day agent has left for you ──────────────────────────────
// A racecard opens the review screen. A morning check or results draft shows the items waiting for a decision, with one-tap
// Approve (applied through the same code the agent uses on its own) and Reject. `version` reloads it; `onApplied` tells
// Today to reload the race day.
export function AgentReview({ version = 0, onApplied }) {
  const [, setParams] = useSearchParams()
  const [drafts, setDrafts] = useState(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  const [reject, setReject] = useState(null)

  const [tick, setTick] = useState(0)                 // bumped to read the drafts again
  const load = () => setTick(t => t + 1)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await supabase.from('agent_drafts').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(20)
      if (!live) return
      if (error) { setProblem(error.message); setDrafts([]); return }
      setProblem(''); setDrafts(data || [])
    })()
    return () => { live = false }
  }, [version, tick])

  async function userId() { return (await supabase.auth.getUser()).data?.user?.id || null }

  async function approve(d) {
    setBusy(d.id); setNotice(null)
    const r = await approveDraft(d.id, { userId: await userId() })
    setBusy(null)
    setNotice({ ok: r.ok, text: r.ok ? r.text : r.error })
    load()
    onApplied?.()
  }
  async function confirmReject() {
    const d = reject
    setBusy(d.id)
    const r = await rejectDraft(d.id, { userId: await userId() })
    setBusy(null); setReject(null)
    setNotice({ ok: r.ok, text: r.ok ? `${KIND[d.kind]} rejected` : r.error })
    load()
  }

  if (problem) return <p className="an-note-box" role="status">The agent&rsquo;s drafts could not load ({problem}). Has the agent migration been run?</p>
  if (!drafts?.length && !notice) return null

  return (
    <section className="an-stack" aria-label="For review">
      {notice && <div className={`ag-notice ag-notice--${notice.ok ? 'ok' : 'bad'}`} role="status">{notice.ok ? '✓ ' : '⚠ '}{notice.text}</div>}
      {(drafts || []).map(d => d.kind === 'racecard' ? (
        <RacecardCard key={d.id} d={d} onOpen={() => setParams({ draft: d.id })} />
      ) : (
        <ItemsCard key={d.id} d={d} busy={busy === d.id} onApprove={() => approve(d)} onReject={() => setReject(d)} />
      ))}
      {reject && (
        <ConfirmSheet title={`Reject this ${KIND[reject.kind].toLowerCase()}?`} busy={!!busy} confirm="Reject" onConfirm={confirmReject} onClose={() => setReject(null)}>
          Nothing in it is applied. Anything the agent already applied by itself stays as it is.
        </ConfirmSheet>
      )}
    </section>
  )
}

function RacecardCard({ d, onOpen }) {
  const sum = racecardSummary(d.payload, d.flags || [])
  const day = d.payload?.date
  return (
    <section className="an-card an-card--plain ag-card ag-card--gold">
      <div className="an-eyebrow">Racecard ready to review</div>
      <h3 className="an-h3">{day ? dateText(day) : 'Racecard'} · {plural(sum.races, 'race')}, {plural(sum.runners, 'runner')}</h3>
      <div className="ag-chips">
        {sum.new_owners > 0 && <span className="an-pill an-pill--gold">{plural(sum.new_owners, 'new owner')} need silks</span>}
        {sum.missing_prices > 0 && <span className="an-pill an-pill--warn">{plural(sum.missing_prices, 'runner')} with no price</span>}
        {sum.odd_prices > 0 && <span className="an-pill an-pill--warn">{plural(sum.odd_prices, 'odd price')}</span>}
        {!d.race_week_id && !d.festival_day_id && <span className="an-pill an-pill--off">Week will be created</span>}
      </div>
      <p className="an-muted">Received {whenText(d.created_at)}. Nothing is live until you approve it.</p>
      <button type="button" className="an-btn an-btn--solid" onClick={onOpen}>Review racecard</button>
    </section>
  )
}

function ItemsCard({ d, busy, onApprove, onReject }) {
  const outcomes = d.payload?.outcomes || []
  const waiting = outcomes.filter(o => o.state === 'needs_review')
  const applied = outcomes.filter(o => o.state === 'applied')
  const cannotApply = waiting.length > 0 && waiting.every(o => o.type === 'result' && o.item?.dead_heat)
  return (
    <section className="an-card an-card--plain ag-card">
      <div className="an-eyebrow">{KIND[d.kind]} needs review · {d.payload?.date ? dateText(d.payload.date) : ''}</div>
      <ul className="ag-items">
        {waiting.map(o => (
          <li key={o.ref}>
            <div className="ag-items__text">{o.text}</div>
            {o.reasons?.length > 0 && <div className="an-muted">Held back: {o.reasons.join('; ')}</div>}
          </li>
        ))}
      </ul>
      {applied.length > 0 && <p className="an-muted">{plural(applied.length, 'item')} already applied automatically.</p>}
      {d.note && <p className="an-muted">{d.note}</p>}
      <div className="ag-actions">
        <button type="button" className="an-btn an-btn--solid" onClick={onApprove} disabled={busy || cannotApply}>{busy ? 'Applying…' : waiting.some(o => o.type === 'meeting_issue') && waiting.length === 1 ? 'Acknowledge' : 'Approve'}</button>
        <button type="button" className="an-btn an-btn--ghost" onClick={onReject} disabled={busy}>Reject</button>
      </div>
      {cannotApply && <p className="an-muted">A dead heat has to be entered by hand in Race days.</p>}
    </section>
  )
}

// ── Agent activity ─────────────────────────────────────────────────────────
export function AgentActivity({ version = 0 }) {
  const [rows, setRows] = useState(null)
  const [problem, setProblem] = useState('')
  const [limit, setLimit] = useState(12)

  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await supabase.from('agent_log').select('id, created_at, actor, action, summary, ok').order('created_at', { ascending: false }).limit(limit + 1)
      if (!live) return
      if (error) { setProblem(error.message); setRows([]); return }
      setProblem(''); setRows(data || [])
    })()
    return () => { live = false }
  }, [limit, version, tick])

  if (problem) return null                       // the review panel already says when the migration is missing
  const shown = (rows || []).slice(0, limit)
  return (
    <section className="an-card an-card--plain" aria-label="Agent activity">
      <div className="an-listhead">
        <h3 className="an-h3">Agent activity</h3>
        <button type="button" className="an-btn an-btn--text an-btn--sm" onClick={() => setTick(t => t + 1)}>Refresh</button>
      </div>
      {rows === null ? <p className="an-muted">Loading…</p> : shown.length === 0 ? (
        <p className="an-muted">Nothing yet. What the race-day agent does, and what you approve for it, is listed here.</p>
      ) : (
        <ul className="ag-log">
          {shown.map(r => (
            <li key={r.id} className={r.ok ? '' : 'ag-log--bad'}>
              <span className="ag-log__when">{whenText(r.created_at)}</span>
              <span className="ag-log__text">{r.ok ? '' : '⚠ '}{r.summary}</span>
              <span className={`an-pill ${r.actor === 'agent' ? 'an-pill--off' : 'an-pill--gold'}`}>{r.actor === 'agent' ? 'Agent' : 'You'}</span>
            </li>
          ))}
        </ul>
      )}
      {(rows || []).length > limit && <button type="button" className="an-btn an-btn--ghost an-btn--sm" onClick={() => setLimit(l => l + 12)}>Show more</button>}
    </section>
  )
}
