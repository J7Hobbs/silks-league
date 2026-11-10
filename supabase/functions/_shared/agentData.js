// What the race-day agent endpoint and the Admin review screens share: finding a race day by date, the calendar the agent
// reads, the activity log, pushes to admins only, the owner silks library, and agent drafts. Runs in the Edge Function
// (service-role client) and in the app (admin session); both reach the database through db.js.
// Nothing here scores, locks or moves a pick: that is the existing pipeline, called by agentApply.js.
import { supabase } from './db.js'
import { buildRaceDays } from './adminToday.js'
import { DAY } from './dayBonuses.js'
import { KINDS } from './raceDay.js'
import { lockMs, ukDateStr } from './format.js'
import { horseKey } from './raceImport.js'
import { APP_ORIGIN, agentAlert } from './notifyCopy.js'
import { isSaturday } from './agentValidate.js'

const DAY_MS = 86400000
const must = ({ data, error }) => { if (error) throw error; return data || [] }

const WEEK_COLS = 'id, season_id, week_number, saturday_date, picks_deadline, picks_open_notified_at, festival_day_id'
const DAY_COLS = 'id, festival_id, day_number, race_date, picks_deadline, picks_open_notified_at'
const FEST_COLS = 'id, name, display_name, venue, banner_url, banner_position'

// ═══ Race days ═══════════════════════════════════════════════════════════

// The race days dated `date` (a Saturday linked to a festival day is that festival day, listed once).
async function daysFromRows(weeks, days) {
  const festIds = [...new Set(days.map(d => d.festival_id))]
  const festivals = festIds.length ? must(await supabase.from('festivals').select(FEST_COLS).in('id', festIds)) : []
  return buildRaceDays({ weeks, days, festivals })
}

export async function loadDaysOn(date) {
  const [weeks, days] = await Promise.all([
    supabase.from('race_weeks').select(WEEK_COLS).eq('saturday_date', date).then(must),
    supabase.from('festival_days').select(DAY_COLS).eq('race_date', date).then(must),
  ])
  // A week dated on another day can still be linked to one of these festival days.
  const linked = days.length ? must(await supabase.from('race_weeks').select(WEEK_COLS).in('festival_day_id', days.map(d => d.id))) : []
  const all = [...weeks, ...linked.filter(l => !weeks.some(w => w.id === l.id))]
  return daysFromRows(all, days)
}

// { day } (null when there is none), or { error } when the date holds more than one and `key` does not say which.
export async function resolveDay(date, key = null) {
  const days = await loadDaysOn(date)
  if (key) {
    const day = days.find(d => d.key === key)
    return day ? { day } : { error: `${key} is not a race day on ${date}` }
  }
  if (days.length > 1) return { error: `There is more than one race day on ${date} (${days.map(d => d.key).join(', ')}). Send "day" with one of those keys.` }
  return { day: days[0] || null }
}

// A race day's races, runners and which races have a result.
export async function loadDayRaces(day) {
  const c = DAY[day.kind], k = KINDS[day.kind]
  const races = must(await supabase.from(c.races).select('*').eq(c.raceDayCol, day.id).order('race_number'))
  const ids = races.map(r => r.id)
  const [runners, results] = ids.length ? await Promise.all([
    supabase.from(k.runners).select('*').in(k.raceCol, ids).then(must),
    supabase.from(k.results).select(`${k.raceCol}, position, horse_name`).in(k.raceCol, ids).then(must),
  ]) : [[], []]
  const runnersByRace = {}
  runners.forEach(r => { (runnersByRace[r[k.raceCol]] ||= []).push(r) })
  Object.values(runnersByRace).forEach(list => list.sort((a, b) => (a.horse_number ?? 999) - (b.horse_number ?? 999)))
  const resultsByRace = {}
  results.forEach(r => { (resultsByRace[r[k.raceCol]] ||= []).push(r) })
  return { races, runnersByRace, resultsByRace }
}

const loose = s => horseKey(s)

// The race an agent item points at: race_number, or venue + race_time.
export function findRace(races, ref) {
  if (ref.race_number != null) return races.find(r => r.race_number === ref.race_number) || null
  const hits = races.filter(r => String(r.race_time || '').slice(0, 5) === ref.race_time && loose(r.venue) === loose(ref.venue))
  return hits.length === 1 ? hits[0] : null
}

// The runner an agent item points at: by number, else by name. { runner } or { error }.
export function findRunner(runners, { horse, number }) {
  const byNum = number != null ? runners.filter(r => r.horse_number === number) : []
  const byName = horse ? runners.filter(r => loose(r.horse_name) === loose(horse)) : []
  if (byNum.length === 1 && byName.length === 1 && byNum[0].id !== byName[0].id) {
    return { error: `${horse} and number ${number} are different horses on this card (${byName[0].horse_name} is no. ${byName[0].horse_number}, no. ${number} is ${byNum[0].horse_name})` }
  }
  const hit = byName.length === 1 ? byName[0] : byNum.length === 1 ? byNum[0] : null
  if (hit) return { runner: hit }
  return { error: horse ? `no runner called ${horse}${number != null ? ` or numbered ${number}` : ''} on this card` : `no runner numbered ${number} on this card` }
}

export const raceKey = (race, ref) => (race ? `r${race.race_number}` : (ref.race_number != null ? `r${ref.race_number}` : `${ref.venue}@${ref.race_time}`))

// ═══ The calendar the agent reads ════════════════════════════════════════

const picksStatus = (day, raceCount, nowMs) => {
  if (!raceCount) return 'no_races'
  if (nowMs >= lockMs(day.deadline, day.date)) return 'locked'
  return day.notifiedAt ? 'open' : 'races_loaded'
}

export async function loadCalendar({ from = null, days = 21, includeRunners = true, nowMs = Date.now() } = {}) {
  const start = from || ukDateStr(nowMs)
  const end = new Date(new Date(`${start}T12:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10)
  const [weeks, fdays] = await Promise.all([
    supabase.from('race_weeks').select(WEEK_COLS).gte('saturday_date', start).lte('saturday_date', end).order('saturday_date').then(must),
    supabase.from('festival_days').select(DAY_COLS).gte('race_date', start).lte('race_date', end).order('race_date').then(must),
  ])
  const linked = fdays.length ? must(await supabase.from('race_weeks').select(WEEK_COLS).in('festival_day_id', fdays.map(d => d.id))) : []
  const allWeeks = [...weeks, ...linked.filter(l => !weeks.some(w => w.id === l.id))]
  const list = await daysFromRows(allWeeks, fdays)

  const out = []
  for (const day of list) {
    const { races, runnersByRace, resultsByRace } = await loadDayRaces(day)
    const locked = nowMs >= lockMs(day.deadline, day.date)
    out.push({
      key: day.key, kind: day.kind, id: day.id, date: day.date, title: day.title,
      week_number: day.weekNumber, day_number: day.dayNumber,
      festival: day.festival ? { id: day.festival.id, name: day.festival.display_name || day.festival.name, venue: day.festival.venue || null } : null,
      linked_week: day.linkedWeek,
      lock_time: day.deadline || null, locked,
      picks_open_notified_at: day.notifiedAt || null,
      picks_status: picksStatus(day, races.length, nowMs),
      race_count: races.length,
      races: races.map(r => ({
        race_number: r.race_number, venue: r.venue, race_name: r.race_name, race_time: String(r.race_time || '').slice(0, 5),
        distance: r.distance || null, is_abandoned: !!r.is_abandoned, has_result: (resultsByRace[r.id] || []).length > 0,
        runner_count_at_lock: r.runner_count_at_lock ?? null, runner_count: (runnersByRace[r.id] || []).length,
        ...(includeRunners ? {
          runners: (runnersByRace[r.id] || []).map(u => ({
            number: u.horse_number, horse: u.horse_name, jockey: u.jockey || null, trainer: u.trainer || null,
            price: u.odds_fractional || null, is_withdrawn: !!u.is_withdrawn, owner_id: u.owner_id || null, owner_name: u.owner_name || null,
          })),
        } : {}),
      })),
    })
  }

  // Saturdays in the window that have no race day at all yet: the racecard draft for one has to say to create the week.
  const taken = new Set([...list.map(d => d.date)])
  const saturdays_without_week = []
  for (let t = new Date(`${start}T12:00:00Z`).getTime(); t <= new Date(`${end}T12:00:00Z`).getTime(); t += DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10)
    if (isSaturday(d) && !taken.has(d)) saturdays_without_week.push(d)
  }
  return { today: ukDateStr(nowMs), from: start, to: end, days: out, saturdays_without_week }
}

// ═══ Activity log and pushes to admins ═══════════════════════════════════

// Add a line to Agent activity. Never throws: a failed log line must not undo what it describes.
export async function logAgent({ actor = 'agent', action, summary, ok = true, detail = null, day = null, date = null, draftId = null }) {
  try {
    const { error } = await supabase.from('agent_log').insert({
      actor, action, summary, ok, detail,
      race_date: date || day?.date || null,
      race_week_id: day ? (day.kind === 'week' ? day.id : day.linkedWeek?.id || null) : null,
      festival_day_id: day?.kind === 'festival' ? day.id : null,
      draft_id: draftId,
    })
    if (error) throw error
    return true
  } catch (err) {
    console.error('[agent] could not write the activity log:', err)
    return false
  }
}

// ── The "Automatic mode" switch (app_settings.agent_auto_apply) ───────────────
export const AUTO_KEY = 'agent_auto_apply'

// Is automatic mode on right now? Read on every agent request, so the Admin switch takes effect at once.
//   row present                  -> its value
//   row or table missing         -> `fallback` (the AGENT_AUTO_APPLY secret: how it worked before the switch existed)
//   any other read error         -> OFF, and say so in the log. Never guess "on".
export async function readAutoApply(fallback = false) {
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', AUTO_KEY).maybeSingle()
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') return { on: !!fallback, source: 'secret' }   // table not created yet
      throw error
    }
    if (!data) return { on: !!fallback, source: 'secret' }
    const v = data.value
    return { on: v === true || v === 'true', source: 'setting' }
  } catch (err) {
    console.error('[agent] could not read the automatic mode setting, treating it as OFF:', err)
    return { on: false, source: 'error' }
  }
}

// Admin turns the switch on or off. Writes the row, then logs it. `by` is the admin's username for the log line.
export async function writeAutoApply(on, { userId = null, by = 'an admin' } = {}) {
  const { data, error } = await supabase.from('app_settings')
    .update({ value: !!on, updated_at: new Date().toISOString(), updated_by: userId })
    .eq('key', AUTO_KEY).select('key')
  if (error) return { ok: false, error: error.message }
  if (!(data || []).length) return { ok: false, error: 'The setting row is missing. Has the app settings migration been run?' }
  await logAgent({ actor: 'admin', action: on ? 'auto_on' : 'auto_off', summary: `Automatic mode turned ${on ? 'on' : 'off'} by ${by}`, detail: { auto_apply: !!on, user_id: userId } })
  return { ok: true, on: !!on }
}

// A push to every admin and nobody else: "Silks League agent: Race 3 result entered". Never throws.
export async function notifyAdmins(text, { url = `${APP_ORIGIN}/admin` } = {}) {
  try {
    const admins = must(await supabase.from('profiles').select('id').eq('is_admin', true)).map(p => p.id)
    if (!admins.length) return { ok: true, sent: 0 }
    const { error } = await supabase.functions.invoke('send-notification', { body: { userIds: admins, ...agentAlert(text), url } })
    if (error) throw error
    return { ok: true, sent: admins.length }
  } catch (err) {
    console.error('[agent] could not push to the admins:', err)
    return { ok: false, sent: 0, error: err.message || String(err) }
  }
}

// ═══ Owner silks library ═════════════════════════════════════════════════

export async function getOwnerSilks(ids) {
  const out = {}
  for (let i = 0; i < ids.length; i += 200) {
    must(await supabase.from('owner_silks').select('owner_id, owner_name, silk_colour, silk_colour_secondary, silk_pattern').in('owner_id', ids.slice(i, i + 200)))
      .forEach(o => { out[o.owner_id] = o })
  }
  return out
}

// Add or update owners in the library. rows: [{ owner_id, owner_name, silk_colour, silk_colour_secondary, silk_pattern }].
// `keepExisting` leaves owners already in the library alone (the agent's backfill never overwrites a silk an admin chose).
export async function saveOwnerSilks(rows, { keepExisting = false } = {}) {
  let todo = rows.filter(r => r.owner_id && (r.silk_colour || r.silk_colour_secondary || r.silk_pattern))
  if (keepExisting && todo.length) {
    const have = await getOwnerSilks(todo.map(r => r.owner_id))
    todo = todo.filter(r => !have[r.owner_id])
  }
  if (!todo.length) return { ok: true, saved: 0 }
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('owner_silks')
    .upsert(todo.map(r => ({
      owner_id: r.owner_id, owner_name: r.owner_name || null, silk_colour: r.silk_colour || null,
      silk_colour_secondary: r.silk_colour_secondary || null, silk_pattern: r.silk_pattern && r.silk_pattern !== 'plain' ? r.silk_pattern : null, updated_at: now,
    })), { onConflict: 'owner_id' }).select('owner_id')
  if (error) return { ok: false, saved: 0, error: error.message }
  return { ok: true, saved: (data || []).length }
}

// ═══ Drafts ══════════════════════════════════════════════════════════════

export async function findDraftByRun(kind, runId) {
  const { data, error } = await supabase.from('agent_drafts').select('*').eq('kind', kind).eq('run_id', runId).maybeSingle()
  if (error) throw error
  return data
}

// Store a draft once per (kind, run_id). A retry of the same submission gets the first draft back, found by looking up
// first and, if two arrive at once, by catching the unique violation from the partial index agent_drafts_run_uidx
// (an ON CONFLICT clause cannot name a partial index, so none is used). Returns { draft, duplicate }.
export async function storeDraft(row) {
  if (row.run_id) {
    const found = await findDraftByRun(row.kind, row.run_id)
    if (found) return { draft: found, duplicate: true }
  }
  const { data, error } = await supabase.from('agent_drafts').insert(row).select('*').single()
  if (error) {
    if (error.code === '23505' && row.run_id) {
      const found = await findDraftByRun(row.kind, row.run_id)
      if (found) return { draft: found, duplicate: true }
    }
    throw new Error(`Could not store the draft: ${error.message}`)
  }
  return { draft: data, duplicate: false }
}

export async function updateDraft(id, patch, { onlyStatus = null } = {}) {
  let q = supabase.from('agent_drafts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (onlyStatus) q = q.eq('status', onlyStatus)
  const { data, error } = await q.select('*')
  if (error) throw new Error(`Could not update the draft: ${error.message}`)
  return (data || [])[0] || null
}

// A newer submission replaces older pending drafts of the same kind and date, as long as it covers everything the old
// draft was still waiting on (`refs` are the item references that needed review). Returns the ids it superseded.
export async function supersedeOlder(draft, coveredRefs) {
  const pending = must(await supabase.from('agent_drafts').select('id, payload').eq('kind', draft.kind).eq('race_date', draft.race_date).eq('status', 'pending').neq('id', draft.id))
  const covered = new Set(coveredRefs)
  const ids = []
  for (const old of pending) {
    const waiting = draft.kind === 'racecard' ? [] : (old.payload?.outcomes || []).filter(o => o.state === 'needs_review').map(o => o.ref)
    if (waiting.every(r => covered.has(r))) ids.push(old.id)
  }
  if (!ids.length) return []
  const { error } = await supabase.from('agent_drafts').update({ status: 'superseded', updated_at: new Date().toISOString(), note: 'Replaced by a newer submission' }).in('id', ids)
  if (error) throw new Error(`Could not supersede the older drafts: ${error.message}`)
  return ids
}
