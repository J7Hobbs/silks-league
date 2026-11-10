// Race-day Admin actions that Saturday races and festival races share: withdrawing and reinstating a
// runner, what a results form has to ask for, and the checks to run after a day's races are loaded.
// The two kinds of race only differ in table and column names (KINDS), so one set of code does both.
// Nothing here works out a score: re-scoring goes through raceScoring.js and scoring.js.
import { supabase } from './supabase'
import { getPlaceTerms, SCORING_RULES } from './scoring.js'
import { recalculateRace } from './raceScoring.js'
import { lockRaceIfEmpty } from './raceLock.js'
import { nonRunner, lockLabel } from './notifyCopy.js'

const APP_ORIGIN = 'https://silks-league.vercel.app'

export const KINDS = {
  week:     { runners: 'runners',          picks: 'picks',          results: 'results',          raceCol: 'race_id' },
  festival: { runners: 'festival_runners', picks: 'festival_picks', results: 'festival_results', raceCol: 'festival_race_id' },
}

const RUNNER_COLS = 'id, horse_name, horse_number, odds_decimal, odds_fractional, is_withdrawn'
const REASON = 'Horse withdrawn — replaced with race favourite'

// ── Pure helpers ─────────────────────────────────────────────

// Runners that can still run and have a price.
const priced = r => !r.is_withdrawn && Number(r.odds_decimal) > 0

// The favourite: the shortest price among runners still running (not `excludeId`); a tie goes to the
// lower horse number. null when no running runner has a price.
export function pickFavourite(runners, excludeId = null) {
  const num = r => (r.horse_number == null ? Infinity : r.horse_number)
  return (runners || [])
    .filter(r => r.id !== excludeId && priced(r))
    .sort((a, b) => a.odds_decimal - b.odds_decimal || num(a) - num(b))[0] || null
}

// Is a replacement at these odds win-only? (Shorter than 4/1: each-way picks have to become win.)
export const isShorterThanWinOnly = fav => !!fav && Number(fav.odds_decimal) < SCORING_RULES.winOnlyBelowDecimal

export function oddsText(r) {
  return r?.odds_fractional || (r?.odds_decimal ? String(r.odds_decimal) : '?')
}

// "Sat 14 Nov, 13:05" in UK time.
export function lockTimeText(iso) {
  if (!iso) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(p => [p.type, p.value]))
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`
}

// The push sent to a player whose pick was a non-runner (the wording is in notifyCopy.js). `horse` and `favourite` are
// accepted so callers need not change, but the message no longer names them.
export function withdrawalNotice({ beforeLock, raceNumber, lockText }) {
  return nonRunner({ beforeLock, raceNumber, lockText }).body
}

// What a results form has to ask for. `runners` are all of a race's runners, withdrawn ones included.
//   ran         runners not withdrawn
//   placesPaid  places the bookmakers pay for that many runners (0 = win only)
//   required    1st plus every paid place, never fewer than 1st and never more than ran
//   shown       positions on the form: the required ones, then optional ones up to 4th (never more than ran)
export function resultsRules(runners) {
  const ran = (runners || []).filter(r => !r.is_withdrawn).length
  const { placesPaid, eachWayAvailable } = getPlaceTerms(ran)
  const required = Math.min(Math.max(1, placesPaid), ran)
  const shown = Math.min(4, ran)
  return { ran, placesPaid, eachWayAvailable, required, shown }
}

const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }
export const positionLabel = n => ORD[n] || `${n}th`

// "6 ran · places paid: top 2" / "4 ran · win only"
export function resultsHeadline(rules) {
  return `${rules.ran} ran · ${rules.eachWayAvailable ? `places paid: top ${rules.placesPaid}` : 'win only'}`
}

// Check a results form ({ horse1..horse4 } by horse name) against the race's runners.
// { ok, message, rows: [{ position, horse_name }] } — rows are the positions that were filled in.
export function validateResults(runners, form = {}) {
  const rules = resultsRules(runners)
  const running = new Set((runners || []).filter(r => !r.is_withdrawn).map(r => r.horse_name))
  const rows = []
  const missing = []
  const seen = new Set()
  let duplicate = null
  for (let pos = 1; pos <= rules.shown; pos++) {
    const name = form[`horse${pos}`]
    if (name && running.has(name)) {
      if (seen.has(name)) duplicate = name
      seen.add(name)
      rows.push({ position: pos, horse_name: name })
    } else if (pos <= rules.required) {
      missing.push(positionLabel(pos))
    }
  }
  if (rules.ran === 0) return { ok: false, message: 'No runners to place', rows, missing, rules }
  if (missing.length) return { ok: false, message: `Still needed: ${missing.join(', ')}`, rows, missing, rules }
  if (duplicate) return { ok: false, message: `${duplicate} is placed twice`, rows, missing, rules }
  return { ok: true, message: '', rows, missing, rules }
}

// Runners that would score nothing because they have no price: [{ race, runner }].
export function runnersWithoutPrice(races, runnersByRace) {
  const out = []
  for (const race of races || []) {
    for (const runner of runnersByRace?.[race.id] || []) {
      if (!runner.is_withdrawn && !(Number(runner.odds_decimal) > 0)) out.push({ race, runner })
    }
  }
  return out
}

export const noPriceMessage = horse => `${horse} has no price, so it would score 0`

// ── Withdraw ─────────────────────────────────────────────────

async function raceHasResults(c, raceId) {
  const { data, error } = await supabase.from(c.results).select('position').eq(c.raceCol, raceId).limit(1)
  if (error) throw error
  return (data || []).length > 0
}

// Everything the confirm sheet needs to say before anything is changed.
export async function planWithdrawal(kind, runner, race, { lockIso, now = Date.now() } = {}) {
  const c = KINDS[kind]
  const [rs, pk] = await Promise.all([
    supabase.from(c.runners).select(RUNNER_COLS).eq(c.raceCol, race.id),
    supabase.from(c.picks).select('id, user_id, bet_type, original_runner_id').eq('runner_id', runner.id).eq(c.raceCol, race.id),
  ])
  if (rs.error) throw rs.error
  if (pk.error) throw pk.error
  const favourite = pickFavourite(rs.data, runner.id)
  const picks = pk.data || []
  const hasResults = await raceHasResults(c, race.id)
  let blocked = null
  if (picks.length && !favourite) {
    blocked = 'There is no priced runner left to move these picks to. Add prices to the other runners first (or reinstate one).'
  }
  const switchToWin = isShorterThanWinOnly(favourite)
  return {
    runner, race, favourite, picks, hasResults, blocked,
    switchToWin,
    eachWayCount: switchToWin ? picks.filter(p => p.bet_type === 'each_way').length : 0,
    beforeLock: !lockIso || now < new Date(lockIso).getTime(),
    lockText: lockLabel(lockIso),
  }
}

// Update rows and check that exactly the expected number changed.
async function updateRows(table, ids, patch, what) {
  if (!ids.length) return 0
  const { data, error } = await supabase.from(table).update(patch).in('id', ids).select('id')
  if (error) throw new Error(`${what}: ${error.message}`)
  if ((data || []).length !== ids.length) {
    throw new Error(`${what}: expected to change ${ids.length} row${ids.length === 1 ? '' : 's'} but changed ${(data || []).length}`)
  }
  return data.length
}

// Withdraw the runner and move every pick on it to the favourite.
// Returns { moved, switched, rescored, notified } or throws an Error whose message says what went wrong.
export async function withdrawRunnerNow(kind, plan, { lockIso, now = Date.now() } = {}) {
  const c = KINDS[kind]
  const { runner, race } = plan

  // After the lock, a race that was never locked still has no field size. Lock it first, so the count
  // is the one at the lock and includes this horse (the each-way places are judged on it).
  let lockedNow = null
  if (!(!lockIso || now < new Date(lockIso).getTime())) {
    try { lockedNow = await lockRaceIfEmpty(kind, race.id) }
    catch (err) { throw new Error(`Could not lock the race before withdrawing: ${err.message}`) }
  }

  // Re-read the runners and the picks now, rather than trusting the numbers the sheet showed.
  const [rs, pk] = await Promise.all([
    supabase.from(c.runners).select(RUNNER_COLS).eq(c.raceCol, race.id),
    supabase.from(c.picks).select('id, user_id, bet_type, original_runner_id').eq('runner_id', runner.id).eq(c.raceCol, race.id),
  ])
  if (rs.error) throw new Error(`Could not read runners: ${rs.error.message}`)
  if (pk.error) throw new Error(`Could not read picks: ${pk.error.message}`)
  const picks = pk.data || []
  const favourite = pickFavourite(rs.data, runner.id)
  if (picks.length && !favourite) throw new Error('No priced runner left to move the picks to')

  // 1. The runner
  const wd = await supabase.from(c.runners).update({ is_withdrawn: true }).eq('id', runner.id).select('id')
  if (wd.error) throw new Error(`Could not withdraw ${runner.horse_name}: ${wd.error.message}`)
  if ((wd.data || []).length !== 1) {
    throw new Error(`${runner.horse_name} was not withdrawn (0 rows changed). Check you are signed in as an admin.`)
  }

  // 2. The picks. The very first horse is kept in original_runner_id, so a pick that is moved again
  // (a chain of withdrawals) still remembers where it started.
  let moved = 0, switched = 0
  if (picks.length) {
    const first = picks.filter(p => !p.original_runner_id).map(p => p.id)
    const again = picks.filter(p => p.original_runner_id).map(p => p.id)
    const base = { runner_id: favourite.id, was_replaced: true, replacement_reason: REASON }
    try {
      moved += await updateRows(c.picks, first, { ...base, original_runner_id: runner.id }, 'Moving picks')
      moved += await updateRows(c.picks, again, base, 'Moving picks')
      if (isShorterThanWinOnly(favourite)) {
        const ew = picks.filter(p => p.bet_type === 'each_way').map(p => p.id)
        switched = await updateRows(c.picks, ew, { bet_type: 'win' }, 'Changing each-way picks to win')
      }
    } catch (err) {
      throw new Error(`${runner.horse_name} is marked withdrawn, but ${err.message}. Reinstate it and withdraw again to retry.`)
    }
  }

  // 3. Re-score this race if its results are already in.
  let rescored = null
  if (await raceHasResults(c, race.id)) {
    rescored = await recalculateRace(kind, race)
  }

  // 4. Tell the players who were moved. A failed push never undoes the withdrawal.
  let notified = null
  if (moved > 0) {
    const userIds = [...new Set(picks.map(p => p.user_id))]
    const beforeLock = !lockIso || now < new Date(lockIso).getTime()
    notified = await sendNotice(userIds, race, {
      beforeLock,
      horse: runner.horse_name,
      raceNumber: race.race_number,
      favourite: favourite.horse_name,
      lockText: lockLabel(lockIso),
    })
  }

  return { moved, switched, rescored, notified, favourite, lockedNow }
}

async function sendNotice(userIds, race, notice) {
  try {
    const { error } = await supabase.functions.invoke('send-notification', {
      body: {
        userIds,
        ...nonRunner(notice),
        url: `${APP_ORIGIN}/picks`,
      },
    })
    if (error) throw error
    return { ok: true, count: userIds.length }
  } catch (err) {
    console.error('[Admin] withdrawal notification failed:', err)
    return { ok: false, count: userIds.length, error: err.message || String(err) }
  }
}

// ── Reinstate ────────────────────────────────────────────────

export async function planReinstate(kind, runner, race) {
  const c = KINDS[kind]
  const { data, error } = await supabase.from(c.picks).select('id')
    .eq('original_runner_id', runner.id).eq(c.raceCol, race.id)
  if (error) throw error
  return { runner, race, picks: data || [], hasResults: await raceHasResults(c, race.id) }
}

// Put the runner back and revert only the picks that were moved off this horse.
export async function reinstateRunnerNow(kind, plan) {
  const c = KINDS[kind]
  const { runner, race } = plan

  const re = await supabase.from(c.runners).update({ is_withdrawn: false }).eq('id', runner.id).select('id')
  if (re.error) throw new Error(`Could not reinstate ${runner.horse_name}: ${re.error.message}`)
  if ((re.data || []).length !== 1) {
    throw new Error(`${runner.horse_name} was not reinstated (0 rows changed). Check you are signed in as an admin.`)
  }

  const pk = await supabase.from(c.picks).select('id').eq('original_runner_id', runner.id).eq(c.raceCol, race.id)
  if (pk.error) throw new Error(`${runner.horse_name} is reinstated, but its picks could not be read: ${pk.error.message}`)
  let reverted = 0
  try {
    reverted = await updateRows(c.picks, (pk.data || []).map(p => p.id), {
      runner_id: runner.id, original_runner_id: null, was_replaced: false, replacement_reason: null,
    }, 'Reverting picks')
  } catch (err) {
    throw new Error(`${runner.horse_name} is reinstated, but ${err.message}`)
  }

  let rescored = null
  if (await raceHasResults(c, race.id)) rescored = await recalculateRace(kind, race)
  return { reverted, rescored }
}
