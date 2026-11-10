// The race-day agent's endpoint, as a plain function so it can be tested without a server. supabase/functions/agent-api/
// index.ts only reads the request, calls handleAgentRequest and returns the answer.
//
// Nothing gets in without the secret header. Six actions:
//   get_calendar, get_owner_silks, submit_racecard_draft, submit_morning_check, submit_results, backfill_owners
// Every submission is checked (agentValidate.js) and refused with a list of what is wrong if it is not in the right shape.
// What the agent has confirmed is applied by agentApply.js (the same code Admin uses) when automatic actions are switched on;
// everything else becomes a draft for an admin to review. Every action is logged and pushed to admins only.
import { supabase } from './db.js'
import { ukDateStr } from './format.js'
import { horseKey } from './raceImport.js'
import { pagedRows } from './adminRaceDays.js'
import {
  ACTIONS, validateCalendarRequest, validateOwnerLookup, validateRacecard, validateMorningCheck, validateResultsSubmission, validateBackfill, isSaturday, MAX_WEEK_RACES,
} from './agentValidate.js'
import { agentRacecardReady, agentResultsHeld, agentItemsToCheck } from './notifyCopy.js'
import {
  loadCalendar, resolveDay, loadDayRaces, getOwnerSilks, saveOwnerSilks, findDraftByRun, storeDraft, supersedeOlder, logAgent, notifyAdmins, readAutoApply,
} from './agentData.js'
import { processMorningCheck, processResults, AUTO_OFF_REASON } from './agentApply.js'
import { racecardFlags, racecardSummary } from './agentRacecard.js'

class HttpError extends Error {
  constructor(status, message, errors = null) { super(message); this.status = status; this.errors = errors }
}
const bad = (message, errors) => new HttpError(400, message, errors)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Compare secrets without stopping at the first different character.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

const checked = r => { if (!r.ok) throw bad(`The request is not valid: ${r.errors[0]}${r.errors.length > 1 ? ` (and ${r.errors.length - 1} more)` : ''}`, r.errors); return r.value }

const dayIds = day => ({
  race_day_kind: day?.kind || 'week',
  race_week_id: day ? (day.kind === 'week' ? day.id : day.linkedWeek?.id || null) : null,
  festival_day_id: day?.kind === 'festival' ? day.id : null,
})
const dayInfo = day => (day ? { key: day.key, title: day.title, kind: day.kind, date: day.date } : null)

// ═══ get_calendar / get_owner_silks ══════════════════════════════════════

async function getCalendar(body, ctx) {
  const v = checked(validateCalendarRequest(body))
  return { ok: true, auto_apply: ctx.autoApply, ...(await loadCalendar({ from: v.from, days: v.days, includeRunners: v.include_runners, nowMs: ctx.nowMs })) }
}

async function getOwnerSilksAction(body) {
  const v = checked(validateOwnerLookup(body))
  const owners = await getOwnerSilks(v.owner_ids)
  return { ok: true, owners, missing: v.owner_ids.filter(id => !owners[id]) }
}

// ═══ submit_racecard_draft ═══════════════════════════════════════════════

const draftReply = (draft, extra = {}) => ({ ok: true, draft_id: draft.id, status: draft.status, ...extra })

async function submitRacecard(body) {
  const v = checked(validateRacecard(body))
  const dup = await findDraftByRun('racecard', v.run_id)
  const summaryOf = d => racecardSummary(d.payload, d.flags || [])
  if (dup) return draftReply(dup, { duplicate: true, summary: summaryOf(dup), flags: dup.flags })

  const res = await resolveDay(v.date, v.day)
  if (res.error) throw bad(res.error)
  const day = res.day
  if (!day) {
    if (!isSaturday(v.date)) throw bad(`There is no race day on ${v.date} and it is not a Saturday, so no week can be created for it. Festival days are set up in Admin → Setup first.`)
    if (!v.week) throw bad(`There is no race week for ${v.date} yet. Add "week": { "saturday_date": "${v.date}" } to the draft and the week is created when an admin approves it.`)
  }
  if ((!day || day.kind === 'week') && v.races.length > MAX_WEEK_RACES) throw bad(`A Saturday week holds ${MAX_WEEK_RACES} races at most; this racecard has ${v.races.length}.`)

  const existingRaces = day ? (await loadDayRaces(day)).races.length : 0
  const library = await getOwnerSilks([...new Set(v.races.flatMap(r => r.runners.map(u => u.owner_id)).filter(Boolean))])
  const flags = racecardFlags(v, { library, existingRaces })
  const { draft, duplicate } = await storeDraft({
    kind: 'racecard', run_id: v.run_id, race_date: v.date, ...dayIds(day), payload: v, flags, status: 'pending',
  })
  const summary = summaryOf(draft)
  if (duplicate) return draftReply(draft, { duplicate: true, summary, flags: draft.flags })

  await supersedeOlder(draft, [])
  const title = day ? day.title : `Saturday ${v.date}`
  const line = `Racecard received for ${title}: ${plural(summary.races, 'race')}, ${plural(summary.runners, 'runner')}${summary.new_owners ? `, ${plural(summary.new_owners, 'new owner')} need silks` : ''}`
  await logAgent({ action: 'draft_received', summary: line, detail: { summary, flags: flags.map(f => f.message) }, day, date: v.date, draftId: draft.id })
  await notifyAdmins(agentRacecardReady({
    title, races: summary.races, newOwners: summary.new_owners, missingPrices: summary.missing_prices, oddPrices: summary.odd_prices,
    dayHasRaces: flags.some(f => f.type === 'day_has_races'),
  }))
  return draftReply(draft, { duplicate: false, race_day: { ...(dayInfo(day) || { key: null, title, kind: 'week', date: v.date }), will_create_week: !day }, summary, flags })
}

// ═══ submit_morning_check / submit_results ═══════════════════════════════

const KIND_LABEL = { morning_check: 'Morning check', results: 'Results' }

async function submitItems(kind, v, ctx, process) {
  const dup = await findDraftByRun(kind, v.run_id)
  if (dup) return draftReply(dup, { duplicate: true, ...reportOf(dup.payload?.outcomes || [], ctx) })

  const res = await resolveDay(v.date, v.day)
  if (res.error) throw bad(res.error)
  if (!res.day) throw bad(`There is no race day on ${v.date}. Check get_calendar for the dates that have one.`)
  const day = res.day

  const outcomes = await process(day, v, { mode: 'auto', enabled: ctx.autoApply })
  const waiting = outcomes.filter(o => o.state === 'needs_review')
  const status = waiting.length ? 'pending' : 'applied'
  const { draft, duplicate } = await storeDraft({
    kind, run_id: v.run_id, race_date: v.date, ...dayIds(day), status,
    applied_at: status === 'applied' ? new Date().toISOString() : null,
    payload: { ...v, outcomes },
    flags: waiting.map(o => ({ type: o.type, severity: 'action', message: `${o.text}: ${o.reasons.join('; ')}` })),
  })
  if (duplicate) return draftReply(draft, { duplicate: true, ...reportOf(draft.payload?.outcomes || [], ctx) })
  await supersedeOlder(draft, outcomes.map(o => o.ref))

  // The log and the admin pushes: each automatic action on its own line, and one note when something needs a person.
  const applied = outcomes.filter(o => o.state === 'applied')
  for (const o of applied) await logAgent({ action: o.type === 'result' ? 'result_entered' : o.type, summary: o.text, ok: !o.warn, detail: { ref: o.ref, sources: o.item?.sources || null, warn: o.warn || null }, day, draftId: draft.id })
  if (waiting.length) await logAgent({ action: 'draft_received', summary: `${KIND_LABEL[kind]} for ${day.title}: ${waiting.length} item${waiting.length === 1 ? '' : 's'} need${waiting.length === 1 ? 's' : ''} review`, ok: true, detail: { items: waiting.map(o => ({ text: o.text, reasons: o.reasons })) }, day, draftId: draft.id })
  else if (!outcomes.length) await logAgent({ action: 'draft_received', summary: `${KIND_LABEL[kind]} for ${day.title}: nothing to report`, day, draftId: draft.id })
  if (applied.length <= 3) for (const o of applied) await notifyAdmins(o.text)
  else await notifyAdmins(`${applied.length} automatic actions for ${day.title}, e.g. ${applied[0].text}`)
  if (waiting.length) await notifyAdmins(reviewAlert(kind, waiting))     // one push for the whole submission, nothing at all when nothing is waiting

  return draftReply(draft, { duplicate: false, race_day: dayInfo(day), ...reportOf(outcomes, ctx) })
}

// The one admin push for what a submission left waiting. Results name the winner; the reason is added unless it is only that
// automatic mode is off. Morning-check items give a count and an example.
function reviewAlert(kind, waiting) {
  if (kind === 'results') {
    return agentResultsHeld(waiting.map(o => ({
      raceNumber: o.race_number, winner: o.winner,
      why: (o.reasons || []).filter(r => r !== AUTO_OFF_REASON).join('; '),
    })))
  }
  return agentItemsToCheck({ count: waiting.length, example: waiting[0].text })
}

function reportOf(outcomes, ctx) {
  const pick = o => ({ type: o.type, ref: o.ref, text: o.text, ...(o.reasons?.length ? { reasons: o.reasons } : {}), ...(o.warn ? { warn: o.warn } : {}) })
  return {
    auto_apply: ctx.autoApply,
    applied: outcomes.filter(o => o.state === 'applied').map(pick),
    skipped: outcomes.filter(o => o.state === 'skipped').map(pick),
    needs_review: outcomes.filter(o => o.state === 'needs_review').map(pick),
  }
}

const submitMorningCheck = (body, ctx) => submitItems('morning_check', checked(validateMorningCheck(body)), ctx, processMorningCheck)
const submitResults = (body, ctx) => submitItems('results', checked(validateResultsSubmission(body)), ctx, processResults)

// ═══ backfill_owners ═════════════════════════════════════════════════════

const OWNER_TABLES = ['runners', 'festival_runners']
const RUNNER_COLS = 'id, horse_name, owner_id, silk_colour, silk_colour_secondary, silk_pattern'

async function backfillOwners(body) {
  const v = checked(validateBackfill(body))

  if (v.list_missing) {
    const seen = new Map()
    for (const table of OWNER_TABLES) {
      for (const r of await pagedRows(table, RUNNER_COLS)) {
        if (r.owner_id) continue
        const key = horseKey(r.horse_name)
        if (!key) continue
        const cur = seen.get(key) || { horse: r.horse_name, has_silks: false }
        if (r.silk_colour) cur.has_silks = true
        seen.set(key, cur)
      }
    }
    let horses = [...seen.values()]
    if (v.only_with_silks) horses = horses.filter(h => h.has_silks)
    horses.sort((a, b) => a.horse.localeCompare(b.horse))
    return { ok: true, total: horses.length, horses: horses.slice(0, v.limit) }
  }

  const byHorse = new Map(v.owners.map(o => [horseKey(o.horse), o]))
  const matched = new Set()
  let updated = 0
  const tally = {}                                    // owner_id -> { 'colour|colour2|pattern': count }
  for (const table of OWNER_TABLES) {
    const groups = new Map()
    for (const r of await pagedRows(table, RUNNER_COLS)) {
      const o = byHorse.get(horseKey(r.horse_name))
      if (!o) continue
      matched.add(horseKey(r.horse_name))
      if (r.silk_colour) {
        const t = (tally[o.owner_id] ||= {})
        const k = [r.silk_colour, r.silk_colour_secondary || '', r.silk_pattern || ''].join('|')
        t[k] = (t[k] || 0) + 1
      }
      if (r.owner_id && !v.overwrite) continue
      if (r.owner_id === o.owner_id) continue
      const gk = `${o.owner_id}\u0000${o.owner_name || ''}`
      if (!groups.has(gk)) groups.set(gk, { owner: o, ids: [] })
      groups.get(gk).ids.push(r.id)
    }
    for (const { owner, ids } of groups.values()) {
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from(table).update({ owner_id: owner.owner_id, owner_name: owner.owner_name }).in('id', ids.slice(i, i + 200)).select('id')
        if (error) throw new HttpError(500, `Could not save owners on ${table}: ${error.message}`)
        updated += (data || []).length
      }
    }
  }

  // Seed the library from the silks already entered: for each owner, the colours most of their horses carry.
  const names = Object.fromEntries(v.owners.map(o => [o.owner_id, o.owner_name]))
  const rows = Object.entries(tally).map(([owner_id, t]) => {
    const [colour, colour2, pattern] = Object.entries(t).sort((a, b) => b[1] - a[1])[0][0].split('|')
    return { owner_id, owner_name: names[owner_id] || null, silk_colour: colour || null, silk_colour_secondary: colour2 || null, silk_pattern: pattern || null }
  })
  const lib = await saveOwnerSilks(rows, { keepExisting: true })
  if (!lib.ok) throw new HttpError(500, `Owners were saved, but the silks library could not be updated: ${lib.error}`)

  const unmatched = v.owners.filter(o => !matched.has(horseKey(o.horse))).map(o => o.horse)
  await logAgent({ action: 'owners_backfilled', summary: `Owners added to ${plural(updated, 'runner')}; ${plural(lib.saved, 'owner')} added to the silks library`, detail: { matched_horses: matched.size, unmatched: unmatched.length }, date: ukDateStr(Date.now()) })
  return { ok: true, matched_horses: matched.size, updated_runners: updated, library_added: lib.saved, unmatched: unmatched.slice(0, 100), unmatched_count: unmatched.length }
}

// ═══ The handler ═════════════════════════════════════════════════════════

const HANDLERS = {
  get_calendar: getCalendar,
  get_owner_silks: getOwnerSilksAction,
  submit_racecard_draft: submitRacecard,
  submit_morning_check: submitMorningCheck,
  submit_results: submitResults,
  backfill_owners: backfillOwners,
}

const MAX_BODY = 2_000_000

// request: { method, providedSecret, bodyText }   config: { secret, autoApply (fallback only), nowMs }
// Returns { status, body }. The answer to a wrong or missing secret says nothing about why.
export async function handleAgentRequest({ method, providedSecret, bodyText }, { secret, autoApply = false, nowMs = Date.now() } = {}) {
  if (!secret || secret.length < 16) return { status: 500, body: { ok: false, error: 'AGENT_SECRET is not set on the server (it must be at least 16 characters).' } }
  if (!safeEqual(String(providedSecret || ''), secret)) return { status: 401, body: { ok: false, error: 'Unauthorised' } }
  if (method !== 'POST') return { status: 405, body: { ok: false, error: 'Use POST with a JSON body.' } }
  if ((bodyText || '').length > MAX_BODY) return { status: 413, body: { ok: false, error: 'The request is too large.' } }

  let body
  try { body = JSON.parse(bodyText || '') } catch { return { status: 400, body: { ok: false, error: 'The body is not valid JSON.' } } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { ok: false, error: 'The body should be a JSON object with an "action".' } }
  const handler = HANDLERS[body.action]
  if (!handler) return { status: 400, body: { ok: false, error: `Unknown action "${body.action ?? ''}". Use one of: ${ACTIONS.join(', ')}.` } }

  try {
    // The Admin switch decides; the AGENT_AUTO_APPLY secret (config.autoApply) only counts when there is no switch row.
    const { on } = await readAutoApply(autoApply)
    return { status: 200, body: await handler(body, { autoApply: on, nowMs }) }
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { ok: false, error: err.message, ...(err.errors ? { errors: err.errors } : {}) } }
    console.error(`[agent-api] ${body.action} failed:`, err)
    await logAgent({ action: 'error', summary: `${body.action} failed: ${err.message || err}`, ok: false })
    return { status: 500, body: { ok: false, error: `${body.action} failed: ${err.message || String(err)}` } }
  }
}
