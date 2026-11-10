// Checks for what the race-day agent sends to agent-api. Pure: no database, no clock. Each validate* function takes the
// request body and returns { ok: true, value } with the body cleaned up, or { ok: false, errors: [...] } where every error
// says which field is wrong and what is expected, so the agent (or whoever writes its task) can fix the request.
import { parseOdds } from './raceImport.js'
import { SILK_PATTERNS } from './silks.js'

export const ACTIONS = ['get_calendar', 'get_owner_silks', 'submit_racecard_draft', 'submit_morning_check', 'submit_results', 'backfill_owners']

const MAX_ERRORS = 25
const HEX = /^#[0-9a-fA-F]{6}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{1,2}:\d{2}$/
const NO_PRICE = new Set(['', 'sp', 'tba', 'n/a', 'na', '-'])

const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const str = v => (v == null ? '' : String(v).trim())
const intOf = v => { const n = typeof v === 'number' ? v : (/^\d+$/.test(str(v)) ? Number(str(v)) : NaN); return Number.isInteger(n) ? n : null }

class Errors {
  constructor() { this.list = [] }
  add(path, message) { if (this.list.length < MAX_ERRORS) this.list.push(`${path}: ${message}`) }
  get any() { return this.list.length > 0 }
}

const realDate = s => {
  if (!DATE.test(s)) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
export const isSaturday = s => realDate(s) && new Date(`${s}T12:00:00Z`).getUTCDay() === 6
const clock = t => { const [h, m] = str(t).split(':'); return `${h.padStart(2, '0')}:${m}` }
const validClock = t => { if (!TIME.test(str(t))) return false; const [h, m] = str(t).split(':').map(Number); return h < 24 && m < 60 }

// "7/2", "evens" and "SP" (no price yet) are the prices the app understands.
// Returns { fractional, decimal } (both null for no price) or { error }.
export function readPrice(raw) {
  if (raw == null) return { fractional: null, decimal: null }
  const s = str(raw)
  if (NO_PRICE.has(s.toLowerCase())) return { fractional: null, decimal: null }
  const decimal = parseOdds(s)
  if (!decimal) return { error: `"${s}" is not a price (use 7/2 or evens, or SP / null when there is no price yet)` }
  return { fractional: ['evs', 'evens'].includes(s.toLowerCase()) ? 'evens' : s, decimal }
}

// A price that is probably a typo or a mis-read: shorter than 1/10 or 100/1 and longer.
export const isOddPrice = decimal => decimal != null && (decimal < 1.1 || decimal >= 101)

// ── What counts as confirmed ─────────────────────────────────────────────
// The agent says an item is confirmed only when the official source and a second source agree. The server does not take
// that on trust alone: it also needs at least two different sources named.
export const MIN_SOURCES = 2
export function sourcesOf(v) {
  const list = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])
  return [...new Set(list.map(s => str(s).toLowerCase()).filter(Boolean))]
}
export function confirmation(item) {
  const sources = sourcesOf(item?.sources)
  if (item?.confirmed !== true) return { ok: false, reason: 'the agent did not mark it confirmed' }
  if (sources.length < MIN_SOURCES) return { ok: false, reason: `only ${sources.length} source${sources.length === 1 ? '' : 's'} named (${MIN_SOURCES} needed)` }
  return { ok: true }
}

// ── Shared pieces ────────────────────────────────────────────────────────
function readHeader(body, errs) {
  const run_id = str(body.run_id)
  if (!run_id) errs.add('run_id', 'required: a unique id for this submission (e.g. "racecard-2026-11-14-0630"), so a retry is not stored twice')
  else if (run_id.length > 120) errs.add('run_id', 'too long (120 characters at most)')
  const date = str(body.date)
  if (!realDate(date)) errs.add('date', 'required, as YYYY-MM-DD')
  const day = body.day == null || body.day === '' ? null : str(body.day)
  if (day && !/^(week|festival):[0-9a-fA-F-]{8,}$/.test(day)) errs.add('day', 'should be a race day key from get_calendar, e.g. "festival:<id>" or "week:<id>"')
  return { run_id, date, day }
}

// Which race an item is about: race_number, or venue + race_time.
function readRaceRef(item, path, errs) {
  const race_number = item.race_number == null || item.race_number === '' ? null : intOf(item.race_number)
  const venue = str(item.venue) || null
  const race_time = str(item.race_time) || null
  if (item.race_number != null && item.race_number !== '' && (race_number == null || race_number < 1)) errs.add(`${path}.race_number`, 'should be a whole number of 1 or more')
  if (race_time && !validClock(race_time)) errs.add(`${path}.race_time`, 'should look like 13:50')
  if (race_number == null && !(venue && race_time)) errs.add(path, 'say which race: race_number, or venue and race_time')
  return { race_number, venue, race_time: race_time && validClock(race_time) ? clock(race_time) : null }
}

const readConfirm = item => ({ confirmed: item.confirmed === true, sources: sourcesOf(item.sources) })
const list = (body, key, errs, { required = false, max = 500 } = {}) => {
  const v = body[key]
  if (v == null) { if (required) errs.add(key, 'required (a list)'); return [] }
  if (!Array.isArray(v)) { errs.add(key, 'should be a list'); return [] }
  if (v.length > max) { errs.add(key, `too many (${max} at most)`); return [] }
  return v
}

// ── get_calendar ─────────────────────────────────────────────────────────
export function validateCalendarRequest(body) {
  const errs = new Errors()
  const from = body.from == null || body.from === '' ? null : str(body.from)
  if (from && !realDate(from)) errs.add('from', 'should be YYYY-MM-DD')
  const days = body.days == null ? 21 : intOf(body.days)
  if (days == null || days < 1 || days > 60) errs.add('days', 'should be a whole number from 1 to 60 (how many days ahead to look)')
  if (errs.any) return { ok: false, errors: errs.list }
  return { ok: true, value: { from, days, include_runners: body.include_runners !== false } }
}

// ── get_owner_silks ──────────────────────────────────────────────────────
export function validateOwnerLookup(body) {
  const errs = new Errors()
  const ids = list(body, 'owner_ids', errs, { required: true, max: 500 }).map(str).filter(Boolean)
  if (!errs.any && !ids.length) errs.add('owner_ids', 'give at least one owner id')
  if (errs.any) return { ok: false, errors: errs.list }
  return { ok: true, value: { owner_ids: [...new Set(ids)] } }
}

// ── submit_racecard_draft ────────────────────────────────────────────────
function readSilks(v, path, errs) {
  if (v == null) return null
  if (!isObj(v)) { errs.add(path, 'should be { "colour": "#1a3a7a", "colour2": "#f1c40f", "pattern": "hoops" }'); return null }
  const colour = str(v.colour) || null, colour2 = str(v.colour2) || null
  const pattern = str(v.pattern).toLowerCase() || null
  if (colour && !HEX.test(colour)) errs.add(`${path}.colour`, `"${colour}" is not a hex colour like #1a3a7a`)
  if (colour2 && !HEX.test(colour2)) errs.add(`${path}.colour2`, `"${colour2}" is not a hex colour like #f1c40f`)
  if (pattern && !SILK_PATTERNS.includes(pattern)) errs.add(`${path}.pattern`, `"${pattern}" is not one of ${SILK_PATTERNS.join(', ')}`)
  if (!colour && !colour2 && !pattern) return null
  return { colour, colour2, pattern }
}

export const MAX_WEEK_RACES = 7

export function validateRacecard(body) {
  const errs = new Errors()
  const { run_id, date, day } = readHeader(body, errs)

  let week = null
  if (body.week != null) {
    if (!isObj(body.week)) errs.add('week', 'should be { "saturday_date": "YYYY-MM-DD" }')
    else {
      const sd = str(body.week.saturday_date)
      if (!isSaturday(sd)) errs.add('week.saturday_date', 'should be a Saturday, as YYYY-MM-DD')
      else if (date && sd !== date) errs.add('week.saturday_date', `should be the same date as "date" (${date})`)
      else week = { saturday_date: sd }
    }
  }

  const rawRaces = list(body, 'races', errs, { required: true, max: 20 })
  if (!errs.any && !rawRaces.length) errs.add('races', 'give at least one race')
  const races = []
  rawRaces.forEach((r, i) => {
    const p = `races[${i}]`
    if (!isObj(r)) { errs.add(p, 'should be an object'); return }
    const venue = str(r.venue), race_name = str(r.race_name), race_time = str(r.race_time)
    if (!venue) errs.add(`${p}.venue`, 'required')
    if (!race_name) errs.add(`${p}.race_name`, 'required')
    if (!validClock(race_time)) errs.add(`${p}.race_time`, 'required, as HH:MM (UK time), e.g. 13:50')
    const declared = r.runners_declared == null ? null : intOf(r.runners_declared)
    if (r.runners_declared != null && (declared == null || declared < 1)) errs.add(`${p}.runners_declared`, 'should be a whole number (how many runners the racecard says)')
    const rawRunners = Array.isArray(r.runners) ? r.runners : null
    if (!rawRunners) errs.add(`${p}.runners`, 'required (a list)')
    else if (rawRunners.length < 2) errs.add(`${p}.runners`, `needs at least 2 runners (got ${rawRunners.length})`)
    else if (rawRunners.length > 40) errs.add(`${p}.runners`, 'too many runners (40 at most)')

    const seen = new Map()
    const runners = []
    ;(rawRunners || []).forEach((u, j) => {
      const q = `${p}.runners[${j}]`
      if (!isObj(u)) { errs.add(q, 'should be an object'); return }
      const number = intOf(u.number)
      if (number == null || number < 1) errs.add(`${q}.number`, 'required, a whole number of 1 or more')
      else if (seen.has(number)) errs.add(`${q}.number`, `${number} is used twice in this race (also runners[${seen.get(number)}])`)
      else seen.set(number, j)
      const horse = str(u.horse)
      if (!horse) errs.add(`${q}.horse`, 'required')
      const price = readPrice(u.price)
      if (price.error) errs.add(`${q}.price`, price.error)
      const owner_id = str(u.owner_id) || null
      runners.push({
        number, horse, jockey: str(u.jockey) || null, trainer: str(u.trainer) || null,
        owner_id, owner_name: str(u.owner_name) || null,
        price: price.fractional ?? null, price_decimal: price.decimal ?? null,
        form: str(u.form) || null, silks: readSilks(u.silks, `${q}.silks`, errs),
      })
    })
    races.push({
      venue, race_name, race_time: validClock(race_time) ? clock(race_time) : race_time,
      distance: str(r.distance) || null, class_type: str(r.class_type ?? r.class) || null,
      runners_declared: declared, runners,
    })
  })

  if (errs.any) return { ok: false, errors: errs.list }
  // Races are numbered in time order (the order Admin's import uses); the sort is stable for races at the same time.
  races.sort((a, b) => a.race_time.localeCompare(b.race_time))
  return { ok: true, value: { run_id, date, day, week, races, source: str(body.source) || null } }
}

// ── submit_morning_check ─────────────────────────────────────────────────
export function validateMorningCheck(body) {
  const errs = new Errors()
  const { run_id, date, day } = readHeader(body, errs)

  const non_runners = list(body, 'non_runners', errs).map((n, i) => {
    const p = `non_runners[${i}]`
    if (!isObj(n)) { errs.add(p, 'should be an object'); return null }
    if (!str(n.horse) && intOf(n.number) == null) errs.add(p, 'give the horse name and/or its number')
    return { ...readRaceRef(n, p, errs), horse: str(n.horse) || null, number: intOf(n.number), reason: str(n.reason) || null, ...readConfirm(n) }
  }).filter(Boolean)

  const jockey_changes = list(body, 'jockey_changes', errs).map((n, i) => {
    const p = `jockey_changes[${i}]`
    if (!isObj(n)) { errs.add(p, 'should be an object'); return null }
    if (!str(n.horse) && intOf(n.number) == null) errs.add(p, 'give the horse name and/or its number')
    if (!str(n.new_jockey)) errs.add(`${p}.new_jockey`, 'required')
    return { ...readRaceRef(n, p, errs), horse: str(n.horse) || null, number: intOf(n.number), new_jockey: str(n.new_jockey), old_jockey: str(n.old_jockey) || null, ...readConfirm(n) }
  }).filter(Boolean)

  const TYPES = ['inspection', 'abandoned', 'postponed', 'going_change', 'other']
  const meeting_issues = list(body, 'meeting_issues', errs).map((n, i) => {
    const p = `meeting_issues[${i}]`
    if (!isObj(n)) { errs.add(p, 'should be an object'); return null }
    const type = str(n.type).toLowerCase()
    if (!TYPES.includes(type)) errs.add(`${p}.type`, `should be one of ${TYPES.join(', ')}`)
    if (!str(n.venue)) errs.add(`${p}.venue`, 'required')
    const race_numbers = Array.isArray(n.race_numbers) ? n.race_numbers.map(intOf).filter(x => x != null) : []
    return { venue: str(n.venue), type, detail: str(n.detail) || null, race_numbers, ...readConfirm(n) }
  }).filter(Boolean)

  if (errs.any) return { ok: false, errors: errs.list }
  return { ok: true, value: { run_id, date, day, checked_at: str(body.checked_at) || null, non_runners, jockey_changes, meeting_issues } }
}

// ── submit_results ───────────────────────────────────────────────────────
export function validateResultsSubmission(body) {
  const errs = new Errors()
  const { run_id, date, day } = readHeader(body, errs)
  const raw = list(body, 'results', errs, { required: true, max: 20 })
  if (!errs.any && !raw.length) errs.add('results', 'give at least one race')

  const results = raw.map((r, i) => {
    const p = `results[${i}]`
    if (!isObj(r)) { errs.add(p, 'should be an object'); return null }
    const ref = readRaceRef(r, p, errs)
    const dead_heat = r.dead_heat === true
    const rawPos = Array.isArray(r.positions) ? r.positions : null
    if (!rawPos || !rawPos.length) errs.add(`${p}.positions`, 'required: at least the winner, e.g. [{ "position": 1, "horse": "Name" }]')
    const names = new Set(), used = new Map()
    const positions = (rawPos || []).map((x, j) => {
      const q = `${p}.positions[${j}]`
      if (!isObj(x)) { errs.add(q, 'should be an object'); return null }
      const position = intOf(x.position)
      if (position == null || position < 1 || position > 30) { errs.add(`${q}.position`, 'should be a whole number from 1'); return null }
      const horse = str(x.horse), number = intOf(x.number)
      if (!horse && number == null) errs.add(q, 'give the horse name and/or its number')
      const key = horse ? horse.toLowerCase() : `#${number}`
      if (names.has(key)) errs.add(q, `${horse || `number ${number}`} is placed twice`)
      names.add(key)
      if (used.has(position) && !dead_heat) errs.add(`${q}.position`, `position ${position} is given twice: set "dead_heat": true if it was a dead heat`)
      used.set(position, true)
      const price = x.sp == null ? { fractional: null } : readPrice(x.sp)
      if (price.error) errs.add(`${q}.sp`, price.error)
      return { position, horse: horse || null, number, sp: price.fractional ?? null }
    }).filter(Boolean)
    const late_non_runners = (Array.isArray(r.late_non_runners) ? r.late_non_runners : []).map((n, j) => {
      if (!isObj(n) || (!str(n.horse) && intOf(n.number) == null)) { errs.add(`${p}.late_non_runners[${j}]`, 'give the horse name and/or its number'); return null }
      return { horse: str(n.horse) || null, number: intOf(n.number) }
    }).filter(Boolean)
    return {
      ...ref, weighed_in: r.weighed_in === true, enquiry: r.enquiry === true, objection: r.objection === true, dead_heat,
      positions: positions.sort((a, b) => a.position - b.position), late_non_runners, ...readConfirm(r),
    }
  }).filter(Boolean)

  if (errs.any) return { ok: false, errors: errs.list }
  return { ok: true, value: { run_id, date, day, results } }
}

// ── backfill_owners ──────────────────────────────────────────────────────
export function validateBackfill(body) {
  const errs = new Errors()
  if (body.list_missing === true) {
    const limit = body.limit == null ? 200 : intOf(body.limit)
    if (limit == null || limit < 1 || limit > 1000) errs.add('limit', 'should be a whole number from 1 to 1000')
    if (errs.any) return { ok: false, errors: errs.list }
    return { ok: true, value: { list_missing: true, limit, only_with_silks: body.only_with_silks !== false } }
  }
  const owners = list(body, 'owners', errs, { required: true, max: 1000 }).map((o, i) => {
    const p = `owners[${i}]`
    if (!isObj(o)) { errs.add(p, 'should be an object'); return null }
    const horse = str(o.horse), owner_id = str(o.owner_id)
    if (!horse) errs.add(`${p}.horse`, 'required')
    if (!owner_id) errs.add(`${p}.owner_id`, 'required (the Racing Post owner id)')
    return { horse, owner_id, owner_name: str(o.owner_name) || null }
  }).filter(Boolean)
  if (!errs.any && !owners.length) errs.add('owners', 'give at least one { horse, owner_id, owner_name }')
  if (errs.any) return { ok: false, errors: errs.list }
  return { ok: true, value: { list_missing: false, owners, overwrite: body.overwrite === true } }
}
