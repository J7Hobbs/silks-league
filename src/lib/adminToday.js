// Data and rules for the new Admin "Today" tab. Reads race days, works out what to show, and runs the
// two actions the tab owns: saving a result (then scoring and notifying) and sending the picks-open push.
// Scoring, bonuses, locking and withdrawals are not here: they are the existing raceScoring.js,
// dayBonuses.js, raceLock.js and raceDay.js, called as they are.
import { supabase } from './supabase'
import { ukDateStr, ukWallToMs, clockText, lockMs } from './format.js'
import { KINDS, resultsRules } from './raceDay.js'
import { DAY } from './dayBonuses.js'
import { BONUS_TYPES } from './bonuses.js'
import { calculateScoresForRace, calculateFestivalScoresForRace, updateFestivalDayPoints } from './raceScoring.js'
import { lockRaces } from './raceLock.js'

const APP_ORIGIN = 'https://silks-league.vercel.app'
const DAY_MS = 86400000

// ═══ Pure helpers ═══════════════════════════════════════════════════════

// Fractional price text to decimal odds ("7/2" -> 4.5, "evens" -> 2). Same rules as the classic Admin.
export function parseOdds(str) {
  if (!str) return null
  const s = String(str).trim().toLowerCase()
  if (s === 'evs' || s === 'evens') return 2.0
  const parts = s.split('/')
  if (parts.length === 2) {
    const n = parseFloat(parts[0]), d = parseFloat(parts[1])
    if (!isNaN(n) && !isNaN(d) && d !== 0) return parseFloat(((n / d) + 1).toFixed(2))
  }
  const dec = parseFloat(s)
  if (!isNaN(dec) && dec > 1) return dec
  return null
}

// Race days from the rows read from Supabase. A Saturday linked to a festival day is that festival day
// (`linkedWeek` says which week), so it is listed once.
//   weeks    race_weeks [{ id, week_number, saturday_date, picks_deadline, picks_open_notified_at, festival_day_id }]
//   days     festival_days [{ id, festival_id, day_number, race_date, picks_deadline, picks_open_notified_at }]
//   festivals [{ id, name, display_name, venue, banner_url, banner_position }]
export function buildRaceDays({ weeks = [], days = [], festivals = [] }) {
  const fest = Object.fromEntries(festivals.map(f => [f.id, f]))
  const out = []
  for (const w of weeks) {
    if (w.festival_day_id) continue
    out.push({
      key: `week:${w.id}`, kind: 'week', id: w.id, date: w.saturday_date, deadline: w.picks_deadline,
      notifiedAt: w.picks_open_notified_at, title: `Saturday League · Week ${w.week_number}`,
      weekNumber: w.week_number, festival: null, dayNumber: null, linkedWeek: null,
    })
  }
  for (const d of days) {
    const f = fest[d.festival_id] || null
    const linked = weeks.find(w => w.festival_day_id === d.id) || null
    out.push({
      key: `festival:${d.id}`, kind: 'festival', id: d.id, date: d.race_date, deadline: d.picks_deadline,
      notifiedAt: d.picks_open_notified_at, title: `${f?.display_name || f?.name || 'Festival'} · Day ${d.day_number}`,
      weekNumber: null, festival: f, dayNumber: d.day_number, linkedWeek: linked ? { id: linked.id, week_number: linked.week_number } : null,
    })
  }
  return out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kind === 'week' ? -1 : 1))
}

// The next or current race day: the first one dated today or later (UK date).
export function pickCurrent(raceDays, nowMs = Date.now()) {
  const today = ukDateStr(nowMs)
  return raceDays.find(d => d.date >= today) || null
}

// "Racing now" once the day's picks have locked on the day itself, otherwise "Next race day".
export function isRacingNow(day, nowMs = Date.now()) {
  return !!day && day.date === ukDateStr(nowMs) && nowMs >= lockMs(day.deadline, day.date)
}

export const isLocked = (day, nowMs = Date.now()) => !!day && nowMs >= lockMs(day.deadline, day.date)

// "in 2h 14m" / "in 12m" / "in 3d 4h" for the time to the lock.
export function lockCountdown(ms) {
  if (ms <= 0) return 'now'
  const total = Math.floor(ms / 60000)
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60
  if (d >= 1) return `in ${d}d ${h}h`
  if (h >= 1) return `in ${h}h ${m}m`
  return `in ${Math.max(1, m)}m`
}

// The other race days in the same Monday to Sunday week as `current`, for the "Also this week" list.
// A Saturday linked to a festival day is listed as the week ("Linked to Day 2"), once.
//   raceCounts { 'week:<id>' | 'festival:<id>': number of races loaded }
export function alsoThisWeek(weeks, days, festivals, current, raceCounts = {}) {
  if (!current) return []
  const base = new Date(current.date + 'T12:00:00Z')
  const dow = (base.getUTCDay() + 6) % 7                    // Monday = 0
  const monday = new Date(base.getTime() - dow * DAY_MS).toISOString().slice(0, 10)
  const sunday = new Date(base.getTime() + (6 - dow) * DAY_MS).toISOString().slice(0, 10)
  const inWeek = d => d >= monday && d <= sunday
  const fest = Object.fromEntries(festivals.map(f => [f.id, f]))
  const items = []
  const dayOfLinked = id => days.find(d => d.id === id)
  const skipWeek = current.kind === 'week' ? current.id : current.linkedWeek?.id
  const skipDay = current.kind === 'festival' ? current.id : null
  for (const w of weeks) {
    if (!inWeek(w.saturday_date) || w.id === skipWeek) continue
    const linkedDay = w.festival_day_id ? dayOfLinked(w.festival_day_id) : null
    if (linkedDay && linkedDay.id === skipDay) continue
    const count = raceCounts[linkedDay ? `festival:${linkedDay.id}` : `week:${w.id}`] || 0
    items.push({
      key: `week:${w.id}`, date: w.saturday_date, title: `Saturday League · Week ${w.week_number}`,
      pill: linkedDay ? { tone: 'gold', text: `Linked to Day ${linkedDay.day_number}` } : count ? { tone: 'ok', text: 'Ready' } : { tone: 'warn', text: 'Races not loaded' },
    })
  }
  for (const d of days) {
    if (!inWeek(d.race_date) || d.id === skipDay) continue
    if (weeks.some(w => w.festival_day_id === d.id)) continue      // listed as its Saturday week above
    const f = fest[d.festival_id]
    const count = raceCounts[`festival:${d.id}`] || 0
    items.push({
      key: `festival:${d.id}`, date: d.race_date, title: `${f?.display_name || f?.name || 'Festival'} · Day ${d.day_number}`,
      pill: count ? { tone: 'ok', text: 'Ready' } : { tone: 'warn', text: 'Races not loaded' },
    })
  }
  return items.sort((a, b) => a.date.localeCompare(b.date))
}

// A race's row in the list after the lock.
export function raceStatus(race, hasResult, date, nowMs = Date.now()) {
  if (hasResult) return { key: 'done', label: 'Result in ✓' }
  const off = ukWallToMs(date, race.race_time)
  if (off != null && nowMs >= off) return { key: 'enter', label: 'Enter result' }
  return { key: 'off', label: `Off ${clockText(race.race_time) || 'TBA'}` }
}

// What saving this result would do, for the line under the position pickers.
//   picks [{ race_id, user_id, runner_id, bet_type, is_banker }], usernames { userId: name }
// Returns null until a winner is chosen.
export function previewResult({ race, runners, picks, form, usernames = {}, bonuses = true }) {
  const winner = form?.horse1
  if (!winner) return null
  const rules = resultsRules(runners)
  const byId = Object.fromEntries((runners || []).map(r => [r.id, r]))
  const nameOf = p => byId[p.runner_id]?.horse_name
  const racePicks = (picks || []).filter(p => p.race_id === race.id)
  const onWinner = racePicks.filter(p => nameOf(p) === winner)
  const who = [...new Set(onWinner.map(p => p.user_id))]
  const placed = new Set()
  for (let pos = 2; pos <= rules.placesPaid; pos++) if (form[`horse${pos}`]) placed.add(form[`horse${pos}`])
  const landed = racePicks.filter(p => p.is_banker && (nameOf(p) === winner || (p.bet_type === 'each_way' && placed.has(nameOf(p))))).length
  const parts = [`${who.length} player${who.length === 1 ? '' : 's'} backed the winner`]
  if (bonuses) {
    parts.push(`lone winner: ${who.length === 1 ? (usernames[who[0]] || 'one player') : 'none'}`)
    parts.push(`${landed} banker${landed === 1 ? '' : 's'} landed`)
  }
  return parts.join(' · ')
}

// Score rows whose total is not win + place + that race's bonuses: [{ userId, raceId, total, expected }].
// Rows with no bet_type (the old scoring) are not checked.
export function totalsMismatches(scores, awards) {
  const bonus = {}
  for (const a of awards || []) bonus[`${a.user_id}|${a.race_id}`] = (bonus[`${a.user_id}|${a.race_id}`] || 0) + (a.points || 0)
  const out = []
  for (const s of scores || []) {
    if (!s.bet_type) continue
    const expected = (s.win_token_points || 0) + (s.place_token_points || 0) + (bonus[`${s.user_id}|${s.race_id}`] || 0)
    if ((s.total_points || 0) !== expected) out.push({ userId: s.user_id, raceId: s.race_id, total: s.total_points || 0, expected })
  }
  return out
}

// The day's leader from the score rows, and the bonuses landed so far.
export function daySummary(scores, awards, usernames = {}) {
  const totals = {}
  for (const s of scores || []) totals[s.user_id] = (totals[s.user_id] || 0) + (s.total_points || 0)
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1] || String(usernames[a[0]] || '').localeCompare(String(usernames[b[0]] || '')))[0]
  const count = type => (awards || []).filter(a => a.bonus_type === type).length
  return {
    leader: top && top[1] > 0 ? { name: usernames[top[0]] || 'A player', points: top[1] } : null,
    banker: count(BONUS_TYPES.banker), lone: count(BONUS_TYPES.lone), treble: count(BONUS_TYPES.treble),
  }
}

// ═══ Reading ═══════════════════════════════════════════════════════════

const must = ({ data, error }) => { if (error) throw error; return data || [] }

// Race days from yesterday onwards, with what the "Also this week" list needs.
export async function loadRaceDays(nowMs = Date.now()) {
  const since = ukDateStr(nowMs - DAY_MS)
  const [weeks, days] = await Promise.all([
    supabase.from('race_weeks').select('id, week_number, saturday_date, picks_deadline, picks_open_notified_at, festival_day_id').gte('saturday_date', since).order('saturday_date').then(must),
    supabase.from('festival_days').select('id, festival_id, day_number, race_date, picks_deadline, picks_open_notified_at').gte('race_date', since).order('race_date').then(must),
  ])
  const festIds = [...new Set(days.map(d => d.festival_id))]
  const [festivals, weekRaceRows, dayRaceRows] = await Promise.all([
    festIds.length ? supabase.from('festivals').select('id, name, display_name, venue, banner_url, banner_position').in('id', festIds).then(must) : [],
    weeks.length ? supabase.from('races').select('id, race_week_id').in('race_week_id', weeks.map(w => w.id)).then(must) : [],
    days.length ? supabase.from('festival_races').select('id, festival_day_id').in('festival_day_id', days.map(d => d.id)).then(must) : [],
  ])
  const raceCounts = {}
  weekRaceRows.forEach(r => { raceCounts[`week:${r.race_week_id}`] = (raceCounts[`week:${r.race_week_id}`] || 0) + 1 })
  dayRaceRows.forEach(r => { raceCounts[`festival:${r.festival_day_id}`] = (raceCounts[`festival:${r.festival_day_id}`] || 0) + 1 })
  const raceDays = buildRaceDays({ weeks, days, festivals })
  return { raceDays, weeks, days, festivals, raceCounts, current: pickCurrent(raceDays, nowMs) }
}

// Everything the card needs for one race day, rows keyed by race_id whatever the table.
export async function loadDayDetail(day) {
  const c = DAY[day.kind]
  const races = must(await supabase.from(c.races).select('*').eq(c.raceDayCol, day.id).order('race_number'))
  const ids = races.map(r => r.id)
  const empty = { races, runners: [], results: [], picks: [], scores: [], awards: [], usernames: {}, players: 0 }
  if (!ids.length) return { ...empty, players: await countPlayers(day) }
  const kinds = KINDS[day.kind]
  const norm = rows => rows.map(r => ({ ...r, race_id: r[c.raceCol] }))
  const [runners, results, picks, scores, awards, players] = await Promise.all([
    supabase.from(kinds.runners).select('*').in(c.raceCol, ids).then(must),
    supabase.from(kinds.results).select(`${c.raceCol}, position, horse_name`).in(c.raceCol, ids).then(must),
    supabase.from(c.picks).select(`id, user_id, runner_id, bet_type, is_banker, ${c.raceCol}`).in(c.raceCol, ids).then(must),
    supabase.from(c.scores).select(`id, user_id, total_points, win_token_points, place_token_points, bet_type, ${c.raceCol}`).in(c.raceCol, ids).then(must),
    supabase.from('bonus_awards').select(`id, user_id, bonus_type, points, race_id, festival_race_id`).eq(c.awardDayCol, day.id).then(must).catch(() => []),
    countPlayers(day),
  ])
  const userIds = [...new Set([...picks, ...scores].map(r => r.user_id))]
  const profs = userIds.length ? must(await supabase.from('profiles').select('id, username, full_name').in('id', userIds)) : []
  const usernames = Object.fromEntries(profs.map(p => [p.id, p.username || p.full_name || 'Player']))
  return {
    races, runners: norm(runners), results: norm(results), picks: norm(picks), scores: norm(scores),
    awards: awards.map(a => ({ ...a, race_id: a.race_id ?? a.festival_race_id })), usernames, players,
  }
}

// How many players the day could have: everyone registered, or the festival's entrants.
async function countPlayers(day) {
  if (day.kind === 'festival' && !day.linkedWeek && day.festival) {
    const { count } = await supabase.from('festival_entries').select('id', { count: 'exact', head: true }).eq('festival_id', day.festival.id)
    if (count) return count
  }
  const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true })
  return count || 0
}

// ═══ Actions ═══════════════════════════════════════════════════════════

// When picks have locked and a race has no runner count and no result, lock it now (the same step as
// Lock Picks), so scoring never meets an empty count. Returns the toast text, or '' when nothing was needed.
export async function catchUpLocks(day, detail) {
  if (!isLocked(day)) return ''
  const hasResult = new Set(detail.results.map(r => r.race_id))
  const todo = detail.races.filter(r => r.runner_count_at_lock == null && !hasResult.has(r.id))
  if (!todo.length) return ''
  const { locked, failed } = await lockRaces(day.kind, todo.map(r => r.id))
  const converted = locked.reduce((n, l) => n + l.converted, 0)
  if (failed.length) return `Could not lock ${failed.length} race${failed.length === 1 ? '' : 's'}: ${failed[0].error}`
  return `Picks have locked: runner counts stamped for ${locked.length} race${locked.length === 1 ? '' : 's'}${converted ? ` · ${converted} each-way pick${converted === 1 ? '' : 's'} changed to win` : ''}`
}

// "Lock picks now": the same as the classic button. Returns { ok, text }.
export async function lockPicksNow(day, detail) {
  const { locked, failed } = await lockRaces(day.kind, detail.races.map(r => r.id))
  const converted = locked.reduce((n, l) => n + l.converted, 0)
  const text = [`Locked runner counts for ${locked.length} race${locked.length === 1 ? '' : 's'}`, `${converted} each-way pick${converted === 1 ? '' : 's'} changed to win`,
    ...(failed.length ? [`FAILED: ${failed[0].error}`] : [])].join(' · ')
  return { ok: !failed.length, text }
}

// Save a race's result, score it (bonuses included), then tell the players. Returns { ok, msg?, warn?, notified }.
// `rows` are the filled positions from validateResults: [{ position, horse_name }].
export async function saveRaceResult(kind, race, runners, rows, { festivalId = null, notify = true } = {}) {
  const runner = name => (runners || []).find(r => r.horse_name === name)
  let scored
  if (kind === 'week') {
    const del = await supabase.from('results').delete().eq('race_id', race.id)
    if (del.error) return { ok: false, msg: `Delete results failed: ${del.error.message}` }
    const ins = await supabase.from('results').insert(rows.map(({ position, horse_name }) => {
      const r = runner(horse_name)
      return { race_id: race.id, position, horse_name, starting_price_decimal: r?.odds_decimal || null, starting_price_display: r?.odds_fractional || null }
    }))
    if (ins.error) return { ok: false, msg: `Save results failed: ${ins.error.message}` }
    scored = await calculateScoresForRace(race.id, race.race_number)
  } else {
    const del = await supabase.from('festival_results').delete().eq('festival_race_id', race.id)
    if (del.error) return { ok: false, msg: `Delete results failed: ${del.error.message}` }
    const ins = await supabase.from('festival_results').insert(rows.map(({ position, horse_name }) => (
      { festival_race_id: race.id, position, horse_name, starting_price_display: runner(horse_name)?.odds_fractional || null })))
    if (ins.error) return { ok: false, msg: `Save results failed: ${ins.error.message}` }
    scored = await calculateFestivalScoresForRace(race)
    if (scored.ok) await updateFestivalDayPoints(race)
  }
  if (!scored.ok) return { ok: false, msg: `Results saved but scores failed: ${scored.msg}` }

  const label = race.venue ? `Race ${race.race_number} at ${race.venue}` : `Race ${race.race_number}`
  const url = kind === 'festival' && festivalId ? `${APP_ORIGIN}/results/festival/${festivalId}` : `${APP_ORIGIN}/results`
  let notified = true
  if (!notify) return { ok: true, warn: scored.warn || '', notified: false, count: scored.count }
  try {
    const { error } = await supabase.functions.invoke('send-notification', {
      body: { broadcast: true, title: 'Results are in!', body: `${label} results are in — see how you did`, url },
    })
    if (error) throw error
  } catch (err) {
    console.error('[Admin] results notification failed:', err)
    notified = false
  }
  return { ok: true, warn: scored.warn || '', notified, count: scored.count }
}

// The picks-open push, then record when it went. Returns { ok, error? }.
export async function sendPicksOpen(day) {
  const label = day.kind === 'week' ? `Saturday's races (Week ${day.weekNumber})` : day.title.replace(' · ', ' — ')
  try {
    const { error } = await supabase.functions.invoke('send-notification', {
      body: { broadcast: true, title: 'Picks are open!', body: `${label} are live — make your picks`, url: `${APP_ORIGIN}/picks` },
    })
    if (error) throw error
    const at = new Date().toISOString()
    const table = day.kind === 'week' ? 'race_weeks' : 'festival_days'
    const upd = await supabase.from(table).update({ picks_open_notified_at: at }).eq('id', day.id).select('id')
    if (upd.error) throw upd.error
    return { ok: true, at }
  } catch (err) {
    return { ok: false, error: err.message || String(err) }
  }
}

// Set prices on runners that have none: [{ id, odds }] with odds as fractional text. Returns { ok, error? }.
export async function saveRunnerPrices(kind, edits) {
  for (const e of edits) {
    const dec = parseOdds(e.odds)
    if (!dec) return { ok: false, error: `"${e.odds}" is not a price (use 7/2 or evens)` }
  }
  for (const e of edits) {
    const { data, error } = await supabase.from(KINDS[kind].runners)
      .update({ odds_fractional: String(e.odds).trim(), odds_decimal: parseOdds(e.odds) }).eq('id', e.id).select('id')
    if (error) return { ok: false, error: error.message }
    if ((data || []).length !== 1) return { ok: false, error: 'A price was not saved (0 rows changed). Check you are signed in as an admin.' }
  }
  return { ok: true }
}

