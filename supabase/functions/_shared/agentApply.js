// Turning what the agent reports into changes, for the morning check (non-runners, jockey changes, meeting problems) and
// for results. Every change goes through the code Admin already uses: planWithdrawal + withdrawRunnerNow for a non-runner
// (picks to the favourite, each-way to win where needed, re-score, bonuses, the player notice) and saveRaceResult for a
// result (save, score, bonuses, result teasers, end of day). Nothing here has a scoring rule of its own.
//
// Two modes:
//   'auto'      the server acting alone. Only a confirmed fact is applied: the agent marked it confirmed, at least two sources
//               are named, nothing about it is disputed, and the switch for automatic actions is on. Everything else comes back
//               as needs_review and NOTHING about that item is changed.
//   'approved'  an admin pressed Approve on the draft: the review reasons are lifted, the technical checks stay.
// Each item comes back as an outcome { ref, type, state, text, reasons, ... } with state applied | skipped | needs_review.
import { supabase } from './db.js'
import { KINDS, planWithdrawal, withdrawRunnerNow, validateResults } from './raceDay.js'
import { saveRaceResult } from './adminToday.js'
import { confirmation } from './agentValidate.js'
import { findRace, findRunner, raceKey, loadDayRaces } from './agentData.js'
import { horseKey } from './raceImport.js'

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const nameOf = item => item.horse || `no. ${item.number}`
const itemKey = item => horseKey(item.horse) || `n${item.number}`

// The reasons an item cannot be applied by the server on its own.
export const AUTO_OFF_REASON = 'automatic actions are switched off'
function autoReasons(item, { mode, enabled }) {
  if (mode !== 'auto') return []
  const reasons = []
  if (!enabled) reasons.push(AUTO_OFF_REASON)
  const c = confirmation(item)
  if (!c.ok) reasons.push(c.reason)
  return reasons
}

const review = (base, text, reasons, extra = {}) => ({ ...base, state: 'needs_review', text, reasons, ...extra })

// ═══ Morning check ═══════════════════════════════════════════════════════

async function nonRunnerOutcome(day, ctx, item, opts) {
  const race = findRace(ctx.races, item)
  const base = { ref: `non_runner:${raceKey(race, item)}:${itemKey(item)}`, type: 'non_runner', race_number: race?.race_number ?? item.race_number, horse: item.horse, number: item.number, item }
  const label = `Race ${base.race_number ?? '?'} non-runner ${nameOf(item)}`
  if (!race) return review(base, label, ['no race on this day matches'])
  const found = findRunner(ctx.runnersByRace[race.id] || [], item)
  if (found.error) return review(base, label, [found.error])
  const runner = found.runner
  const named = `Race ${race.race_number} non-runner ${runner.horse_name}`
  if (runner.is_withdrawn) return { ...base, state: 'skipped', text: `${named} (already withdrawn)`, reasons: [] }

  const reasons = autoReasons(item, opts)
  if (race.is_abandoned) reasons.push('the race is abandoned')
  const plan = await planWithdrawal(day.kind, runner, race, { lockIso: day.deadline || null })
  if (plan.blocked) reasons.push(plan.blocked)
  if (plan.hasResults && opts.mode === 'auto') reasons.push('the race already has a result')
  if (reasons.length) return review(base, named, reasons)

  try {
    const r = await withdrawRunnerNow(day.kind, plan, { lockIso: day.deadline || null })
    runner.is_withdrawn = true
    const warns = []
    if (r.rescored && !r.rescored.ok) warns.push(`scores NOT recalculated: ${r.rescored.msg}`)
    if (r.notified && !r.notified.ok) warns.push(`player notice failed: ${r.notified.error}`)
    if (r.rule4?.missing?.length) warns.push(`no price for ${r.rule4.missing.join(' and ')}, so no Rule 4 deduction`)
    const moved = r.moved ? `${plural(r.moved, 'pick')} moved to ${r.favourite.horse_name}` : 'no picks to move'
    const rule4 = r.rule4?.pence ? `, Rule 4 ${r.rule4.pence}p applies` : ''
    return { ...base, state: 'applied', text: `${named}, ${moved}${r.switched ? `, ${r.switched} each-way changed to win` : ''}${rule4}${warns.length ? ` (${warns.join('; ')})` : ''}`, reasons: [], warn: warns.length ? warns.join('; ') : null }
  } catch (err) {
    return review(base, named, [`could not apply it: ${err.message || err}`], { error: err.message || String(err) })
  }
}

async function jockeyOutcome(day, ctx, item, opts) {
  const race = findRace(ctx.races, item)
  const base = { ref: `jockey:${raceKey(race, item)}:${itemKey(item)}`, type: 'jockey_change', race_number: race?.race_number ?? item.race_number, horse: item.horse, number: item.number, item }
  const label = `Race ${base.race_number ?? '?'} jockey change: ${nameOf(item)} now ridden by ${item.new_jockey}`
  if (!race) return review(base, label, ['no race on this day matches'])
  const found = findRunner(ctx.runnersByRace[race.id] || [], item)
  if (found.error) return review(base, label, [found.error])
  const runner = found.runner
  const text = `Race ${race.race_number} jockey change: ${runner.horse_name} now ridden by ${item.new_jockey}`
  if (String(runner.jockey || '').trim().toLowerCase() === item.new_jockey.toLowerCase()) return { ...base, state: 'skipped', text: `${text} (already set)`, reasons: [] }
  const reasons = autoReasons(item, opts)
  if (race.is_abandoned) reasons.push('the race is abandoned')
  if (reasons.length) return review(base, text, reasons)
  const { data, error } = await supabase.from(KINDS[day.kind].runners).update({ jockey: item.new_jockey }).eq('id', runner.id).select('id')
  if (error || (data || []).length !== 1) return review(base, text, [`could not save it: ${error ? error.message : '0 rows changed'}`])
  runner.jockey = item.new_jockey
  return { ...base, state: 'applied', text, reasons: [] }
}

// Meeting problems (inspection, abandoned, postponed ...) are never applied by the server: an admin decides, usually by
// abandoning the race in Race days.
function meetingOutcome(item) {
  const label = { inspection: 'Inspection', abandoned: 'Meeting abandoned', postponed: 'Meeting postponed', going_change: 'Going change', other: 'Meeting issue' }[item.type] || 'Meeting issue'
  return {
    ref: `meeting:${horseKey(item.venue)}:${item.type}`, type: 'meeting_issue', state: 'needs_review', venue: item.venue,
    text: `${label} at ${item.venue}${item.race_numbers?.length ? ` (race${item.race_numbers.length === 1 ? '' : 's'} ${item.race_numbers.join(', ')})` : ''}${item.detail ? `: ${item.detail}` : ''}`,
    reasons: ['an admin decides what to do about a meeting problem'], item,
  }
}

// day + the submission's items -> outcomes. `ctx` is loadDayRaces(day) (kept up to date as items are applied).
export async function processMorningCheck(day, submission, { mode = 'auto', enabled = false } = {}) {
  const ctx = await loadDayRaces(day)
  const opts = { mode, enabled }
  const outcomes = []
  for (const n of submission.non_runners || []) outcomes.push(await nonRunnerOutcome(day, ctx, n, opts))
  for (const j of submission.jockey_changes || []) outcomes.push(await jockeyOutcome(day, ctx, j, opts))
  for (const m of submission.meeting_issues || []) outcomes.push(meetingOutcome(m))
  return outcomes
}

// ═══ Results ═════════════════════════════════════════════════════════════

const sameResult = (saved, rows) => saved.length === rows.length && rows.every(r => saved.some(s => s.position === r.position && s.horse_name === r.horse_name))

async function resultOutcome(day, ctx, item, opts) {
  const race = findRace(ctx.races, item)
  const base = { ref: `result:${raceKey(race, item)}`, type: 'result', race_number: race?.race_number ?? item.race_number, item }
  const label = `Race ${base.race_number ?? '?'} result`
  if (!race) return review(base, label, ['no race on this day matches'])
  if (race.is_abandoned) return review(base, label, ['the race is marked abandoned'])
  const k = KINDS[day.kind]
  const runners = ctx.runnersByRace[race.id] || []

  const reasons = autoReasons(item, opts)
  if (opts.mode === 'auto') {
    if (!item.weighed_in) reasons.push('not weighed in yet')
    if (item.enquiry) reasons.push('stewards\' enquiry')
    if (item.objection) reasons.push('objection')
    if (item.dead_heat) reasons.push('dead heat')
  }
  if (item.dead_heat && opts.mode !== 'auto') reasons.push('dead heat: enter it by hand in Race days')

  // Late non-runners, found before anything is changed.
  const late = []
  for (const n of item.late_non_runners || []) {
    const f = findRunner(runners, n)
    if (f.error) { reasons.push(`late non-runner: ${f.error}`); continue }
    if (!f.runner.is_withdrawn) late.push(f.runner)
  }
  const lateIds = new Set(late.map(r => r.id))
  const after = runners.map(r => (lateIds.has(r.id) ? { ...r, is_withdrawn: true } : r))

  // The placings, as names on this card.
  const form = {}
  for (const p of item.positions) {
    const f = findRunner(after, p)
    if (f.error) { reasons.push(`position ${p.position}: ${f.error}`); continue }
    if (f.runner.is_withdrawn) { reasons.push(`position ${p.position}: ${f.runner.horse_name} is a non-runner`); continue }
    form[`horse${p.position}`] = f.runner.horse_name
  }
  const check = validateResults(after, form)
  if (!check.ok) reasons.push(check.message)

  const saved = ctx.resultsByRace[race.id] || []
  if (!reasons.length && saved.length) {
    if (sameResult(saved, check.rows)) return { ...base, state: 'skipped', text: `${label} (already entered)`, reasons: [] }
    if (opts.mode === 'auto') reasons.push('a different result is already saved')
  }
  const winner = form.horse1 || item.positions.find(p => p.position === 1)?.horse || '?'
  const text = `${label}: ${winner} won`
  if (reasons.length) return review({ ...base, winner }, text, reasons)

  // From here the item is applied. Late non-runners first, so the field the result is checked against and the picks match.
  try {
    for (const r of late) {
      const plan = await planWithdrawal(day.kind, r, race, { lockIso: day.deadline || null })
      if (plan.blocked) throw new Error(`${r.horse_name}: ${plan.blocked}`)
      await withdrawRunnerNow(day.kind, plan, { lockIso: day.deadline || null })
      r.is_withdrawn = true
    }
    const fresh = (await supabase.from(k.runners).select('*').eq(k.raceCol, race.id)).data || runners
    const res = await saveRaceResult(day.kind, race, fresh, check.rows, { festivalId: day.festival?.id || null, notify: true })
    if (!res.ok) return review(base, text, [`could not save it: ${res.msg}`], { error: res.msg })
    ctx.resultsByRace[race.id] = check.rows.map(r => ({ position: r.position, horse_name: r.horse_name }))
    runners.forEach(r => { if (lateIds.has(r.id)) r.is_withdrawn = true })
    const how = opts.mode === 'auto' ? (item.weighed_in ? 'weighed in' : 'confirmed') : 'approved by an admin'
    return {
      ...base, state: 'applied', reasons: [], warn: res.warn || null,
      text: `Race ${race.race_number} result entered (${how})${late.length ? `, ${plural(late.length, 'late non-runner')} withdrawn first` : ''}${res.notified === false ? ' (player notifications failed)' : ''}`,
    }
  } catch (err) {
    return review(base, text, [`could not apply it: ${err.message || err}`], { error: err.message || String(err) })
  }
}

export async function processResults(day, submission, { mode = 'auto', enabled = false } = {}) {
  const ctx = await loadDayRaces(day)
  const opts = { mode, enabled }
  const outcomes = []
  for (const r of submission.results || []) outcomes.push(await resultOutcome(day, ctx, r, opts))
  return outcomes
}

// ═══ Approving a draft: apply the items that were waiting for review ═════
// Returns the full outcomes list with the waiting items re-run in 'approved' mode. Meeting issues cannot be applied, so
// they are acknowledged (state 'skipped') and nothing changes.
export async function approveOutcomes(day, draftKind, payload) {
  const waiting = (payload.outcomes || []).filter(o => o.state === 'needs_review')
  const sub = {
    non_runners: waiting.filter(o => o.type === 'non_runner').map(o => o.item),
    jockey_changes: waiting.filter(o => o.type === 'jockey_change').map(o => o.item),
    meeting_issues: [],
    results: waiting.filter(o => o.type === 'result').map(o => o.item),
  }
  const fresh = draftKind === 'results'
    ? await processResults(day, sub, { mode: 'approved', enabled: true })
    : await processMorningCheck(day, sub, { mode: 'approved', enabled: true })
  const byRef = Object.fromEntries(fresh.map(o => [o.ref, o]))
  const outcomes = (payload.outcomes || []).map(o => {
    if (o.state !== 'needs_review') return o
    if (o.type === 'meeting_issue') return { ...o, state: 'skipped', text: `${o.text} (acknowledged)` }
    return byRef[o.ref] || o
  })
  return outcomes
}
