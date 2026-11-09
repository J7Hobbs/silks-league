// The Race days tab: reading the list and one race day, and every action that changes a race day, a race
// or a runner. Scoring, bonuses, locking and withdrawals are the existing raceScoring.js, dayBonuses.js,
// raceLock.js and raceDay.js, called as they are. Every function returns { ok, ... } with `error` set in
// plain words, or throws nothing the screen has to catch.
import { supabase } from './supabase'
import { ukWallToMs } from './format.js'
import { KINDS, planWithdrawal, withdrawRunnerNow, planReinstate, reinstateRunnerNow } from './raceDay.js'
import { DAY, applyDayBonuses } from './dayBonuses.js'
import { recalculateRace, updateFestivalDayPoints } from './raceScoring.js'
import { lockRaceIfEmpty } from './raceLock.js'
import { buildDayList } from './raceDayList.js'
import { buildRaceDays } from './adminToday.js'
import { parseOdds } from './raceImport.js'

const fail = error => ({ ok: false, error: error?.message || String(error) })
const must = ({ data, error }) => { if (error) throw error; return data || [] }

// PostgREST returns 1000 rows a call at most, so page through a big read.
async function pagedRows(table, cols) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).order('id').range(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 1000) return rows
  }
}

// ═══ Reading ═══════════════════════════════════════════════════════════

// Every race day with a status, for the list.
export async function loadRaceDayList(nowMs = Date.now()) {
  const [weeks, days, festivals, wr, fr, wres, fres] = await Promise.all([
    pagedRows('race_weeks', 'id, week_number, saturday_date, picks_deadline, picks_open_notified_at, festival_day_id'),
    pagedRows('festival_days', 'id, festival_id, day_number, race_date, picks_deadline, picks_open_notified_at'),
    pagedRows('festivals', 'id, name, display_name, venue'),
    pagedRows('races', 'id, race_week_id, venue, is_abandoned'),
    pagedRows('festival_races', 'id, festival_day_id, venue, is_abandoned'),
    pagedRows('results', 'id, race_id'),
    pagedRows('festival_results', 'id, festival_race_id'),
  ])
  const races = [
    ...wr.map(r => ({ id: r.id, parent: `week:${r.race_week_id}`, venue: r.venue, is_abandoned: r.is_abandoned })),
    ...fr.map(r => ({ id: r.id, parent: `festival:${r.festival_day_id}`, venue: r.venue, is_abandoned: r.is_abandoned })),
  ]
  const doneIds = new Set([...wres.map(r => r.race_id), ...fres.map(r => r.festival_race_id)])
  return buildDayList({ weeks, days, festivals, races, doneIds }, nowMs)
}

const WEEK_COLS = 'id, season_id, week_number, saturday_date, picks_deadline, picks_open_notified_at, festival_day_id'
const DAY_COLS = 'id, festival_id, day_number, race_date, picks_deadline, picks_open_notified_at'

// One race day by list key ('week:<id>' | 'festival:<id>'). A Saturday linked to a festival day gives that
// festival day (the races are the festival's) with `week` set to the Saturday and `viaWeek` true.
export async function loadDay(key) {
  const [kind, id] = key.split(':')
  let week = null, dayRow = null
  if (kind === 'week') {
    week = (await supabase.from('race_weeks').select(WEEK_COLS).eq('id', id).maybeSingle()).data
    if (!week) throw new Error('That race week no longer exists')
    if (week.festival_day_id) dayRow = (await supabase.from('festival_days').select(DAY_COLS).eq('id', week.festival_day_id).maybeSingle()).data
  } else {
    dayRow = (await supabase.from('festival_days').select(DAY_COLS).eq('id', id).maybeSingle()).data
    if (!dayRow) throw new Error('That festival day no longer exists')
    week = (await supabase.from('race_weeks').select(WEEK_COLS).eq('festival_day_id', id).maybeSingle()).data
  }
  const festival = dayRow ? (await supabase.from('festivals').select('id, name, display_name, venue, banner_url, banner_position').eq('id', dayRow.festival_id).maybeSingle()).data : null
  const [day] = buildRaceDays({ weeks: week ? [week] : [], days: dayRow ? [dayRow] : [], festivals: festival ? [festival] : [] })
  return { day, week, festival, viaWeek: kind === 'week' && !!dayRow }
}

// How many picks have been made on a race day.
export async function countDayPicks(kind, dayId) {
  const c = DAY[kind]
  const races = must(await supabase.from(c.races).select('id').eq(c.raceDayCol, dayId))
  if (!races.length) return 0
  const { count, error } = await supabase.from(c.picks).select('id', { count: 'exact', head: true }).in(c.raceCol, races.map(r => r.id))
  if (error) throw error
  return count || 0
}

async function countRacePicks(kind, raceId) {
  const c = DAY[kind]
  const { count, error } = await supabase.from(c.picks).select('id', { count: 'exact', head: true }).eq(c.raceCol, raceId)
  if (error) throw error
  return count || 0
}

// ═══ Saturday weeks ════════════════════════════════════════════════════

export async function createWeek(date) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return fail('Pick the Saturday date')
    const { data: season } = await supabase.from('seasons').select('id').eq('is_active', true).maybeSingle()
    if (!season) return fail('There is no active season. Activate one in the classic Admin first (Setup is coming).')
    const { data: existing } = await supabase.from('race_weeks').select('id, week_number').eq('season_id', season.id).eq('saturday_date', date)
    if (existing?.length) return fail(`A race week already exists for that date (Week ${existing[0].week_number})`)
    const { data: list } = await supabase.from('race_weeks').select('id').eq('season_id', season.id)
    const number = (list?.length || 0) + 1
    const { data, error } = await supabase.from('race_weeks').insert({
      season_id: season.id, week_number: number, saturday_date: date,
      // Placeholder (noon UK). Once races are added the database sets it to 30 minutes before the first race.
      picks_deadline: new Date(ukWallToMs(date, '12:00')).toISOString(), is_locked: false,
    }).select('id, week_number').single()
    if (error) return fail(error)
    return { ok: true, key: `week:${data.id}`, number: data.week_number }
  } catch (err) { return fail(err) }
}

export async function updateWeekDate(week, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return fail('Pick the Saturday date')
  const { data, error } = await supabase.from('race_weeks').update({
    saturday_date: date, picks_deadline: new Date(ukWallToMs(date, '12:00')).toISOString(),
  }).eq('id', week.id).select('id')
  if (error) return fail(error)
  if ((data || []).length !== 1) return fail('The week was not updated (0 rows changed). Check you are signed in as an admin.')
  return { ok: true }
}

// Delete a week. Blocked when anyone has picked on it (or, for a linked week, on its festival day).
export async function deleteWeek(week) {
  try {
    const picks = week.festival_day_id ? await countDayPicks('festival', week.festival_day_id) : await countDayPicks('week', week.id)
    if (picks > 0) return fail(`${picks} pick${picks === 1 ? ' has' : 's have'} been made on this week, so it cannot be deleted`)
    const { error } = await supabase.from('race_weeks').delete().eq('id', week.id)
    return error ? fail(error) : { ok: true }
  } catch (err) { return fail(err) }
}

// The festival day a week is linked to, or the days it could be linked to (same Saturday, not taken).
export async function loadLinkInfo(week) {
  const { data: days } = week.festival_day_id
    ? await supabase.from('festival_days').select('id, festival_id, day_number, race_date').eq('id', week.festival_day_id)
    : await supabase.from('festival_days').select('id, festival_id, day_number, race_date').eq('race_date', week.saturday_date).order('day_number')
  const { data: takenRows } = week.festival_day_id ? { data: [] } : await supabase.from('race_weeks').select('festival_day_id').not('festival_day_id', 'is', null)
  const taken = new Set((takenRows || []).map(r => r.festival_day_id))
  const list = (days || []).filter(d => week.festival_day_id || !taken.has(d.id))
  const festIds = [...new Set(list.map(d => d.festival_id))]
  const { data: fests } = festIds.length ? await supabase.from('festivals').select('id, name, display_name').in('id', festIds) : { data: [] }
  const name = Object.fromEntries((fests || []).map(f => [f.id, f.display_name || f.name]))
  const rows = []
  for (const d of list) {
    const { count } = await supabase.from('festival_races').select('id', { count: 'exact', head: true }).eq('festival_day_id', d.id)
    rows.push({ id: d.id, raceCount: count || 0, label: `${name[d.festival_id] || 'Festival'} · Day ${d.day_number}` })
  }
  return week.festival_day_id ? { linked: rows[0] || { id: week.festival_day_id, label: 'a festival day', raceCount: 0 }, candidates: [] } : { linked: null, candidates: rows }
}

// The database checks the rules (same Saturday, no races of its own, no unlinking once players have picked).
export async function setWeekLink(week, dayId) {
  const { data, error } = await supabase.from('race_weeks').update({ festival_day_id: dayId }).eq('id', week.id).select('id')
  if (error) return fail(error)
  if ((data || []).length !== 1) return fail('The link was not changed (0 rows changed). Check you are signed in as an admin.')
  return { ok: true }
}

// ═══ Races ═════════════════════════════════════════════════════════════

const raceCols = kind => (kind === 'week' ? { table: 'races', parent: 'race_week_id' } : { table: 'festival_races', parent: 'festival_day_id' })

// Next free race number: a Saturday week has 7 slots; a festival day has no limit.
export function nextRaceNumber(kind, races) {
  const used = new Set((races || []).map(r => r.race_number))
  if (kind === 'week') return [1, 2, 3, 4, 5, 6, 7].find(n => !used.has(n)) || null
  let n = 1
  while (used.has(n)) n++
  return n
}

// Race fields that are only written when filled in (class and distance may not be columns on every table).
function racePayload(kind, f) {
  const p = { venue: f.venue.trim(), race_name: f.race_name.trim(), race_time: f.race_time.trim() }
  if (f.distance?.trim()) p.distance = f.distance.trim()
  if (kind === 'week' && f.class_type?.trim()) p.class_type = f.class_type.trim()
  return p
}

function checkRaceForm(f) {
  if (!f.venue?.trim() || !f.race_name?.trim() || !f.race_time?.trim()) return 'Fill in the venue, race name and time'
  if (!/^\d{1,2}:\d{2}$/.test(f.race_time.trim())) return 'Time should look like 13:50'
  return null
}

export async function addRace(day, f, races) {
  const bad = checkRaceForm(f)
  if (bad) return fail(bad)
  const n = nextRaceNumber(day.kind, races)
  if (!n) return fail('All 7 race slots are already filled for this week')
  const c = raceCols(day.kind)
  const { data, error } = await supabase.from(c.table).insert({ [c.parent]: day.id, race_number: n, ...racePayload(day.kind, f) }).select('id').single()
  return error ? fail(error) : { ok: true, id: data.id, number: n }
}

export async function updateRace(day, race, f, races) {
  const bad = checkRaceForm(f)
  if (bad) return fail(bad)
  const number = parseInt(f.race_number)
  if (!number || number < 1) return fail('Race number must be 1 or more')
  if (number !== race.race_number && (races || []).some(r => r.race_number === number && r.id !== race.id)) {
    return fail(`Race ${number} already exists. Change that race's number first`)
  }
  const c = raceCols(day.kind)
  const { data, error } = await supabase.from(c.table).update({ ...racePayload(day.kind, f), race_number: number }).eq('id', race.id).select('id')
  if (error) return fail(error)
  return (data || []).length === 1 ? { ok: true } : fail('The race was not updated (0 rows changed). Check you are signed in as an admin.')
}

// Delete a race. Blocked once anyone has picked on it: abandon it instead.
export async function deleteRace(day, race) {
  try {
    const picks = await countRacePicks(day.kind, race.id)
    if (picks > 0) return fail(`${picks} pick${picks === 1 ? ' has' : 's have'} been made on this race, so it cannot be deleted. Use Abandon race instead.`)
    const { error } = await supabase.from(raceCols(day.kind).table).delete().eq('id', race.id)
    return error ? fail(error) : { ok: true }
  } catch (err) { return fail(err) }
}

// ═══ Runners ═══════════════════════════════════════════════════════════

export const emptyRunnerForm = () => ({ number: '', name: '', jockey: '', trainer: '', odds: '', form: '', colour: '', colour2: '', pattern: '' })

export function runnerToForm(r) {
  return {
    number: r.horse_number?.toString() || '', name: r.horse_name || '', jockey: r.jockey || '', trainer: r.trainer || '',
    odds: r.odds_fractional || '', form: r.form_string || '', colour: r.silk_colour || '', colour2: r.silk_colour_secondary || '', pattern: r.silk_pattern || '',
  }
}

function runnerPayload(kind, f) {
  const p = {
    horse_name: f.name.trim(),
    horse_number: f.number ? parseInt(f.number) : null,
    jockey: f.jockey.trim() || null,
    trainer: f.trainer.trim() || null,
    silk_colour: f.colour || null,
    silk_colour_secondary: f.colour2 || null,
    silk_pattern: f.pattern && f.pattern !== 'plain' ? f.pattern : null,
    odds_fractional: f.odds.trim() || null,
    odds_decimal: parseOdds(f.odds) || null,
  }
  if (kind === 'week') p.form_string = f.form.trim() || null      // festival runners have no form column
  return p
}

// Add (runnerId null) or update a runner.
export async function saveRunner(kind, raceId, runnerId, f) {
  if (!f.name.trim()) return fail('Horse name is required')
  if (f.odds.trim() && !parseOdds(f.odds)) return fail(`"${f.odds}" is not a price. Use 7/2 or evens`)
  const k = KINDS[kind]
  if (runnerId) {
    const { data, error } = await supabase.from(k.runners).update(runnerPayload(kind, f)).eq('id', runnerId).select('id')
    if (error) return fail(error)
    return (data || []).length === 1 ? { ok: true } : fail('The runner was not updated (0 rows changed). Check you are signed in as an admin.')
  }
  const { error } = await supabase.from(k.runners).insert({ [k.raceCol]: raceId, ...runnerPayload(kind, f) })
  return error ? fail(error) : { ok: true }
}

// Remove a runner. Blocked once anyone has picked it: withdraw it instead, which moves their picks.
export async function removeRunner(kind, runner) {
  try {
    const k = KINDS[kind]
    const { count, error: pe } = await supabase.from(k.picks).select('id', { count: 'exact', head: true }).eq('runner_id', runner.id)
    if (pe) throw pe
    if (count > 0) return fail(`${count} player${count === 1 ? ' has' : 's have'} picked ${runner.horse_name}, so it cannot be removed. Withdraw it instead.`)
    const { error } = await supabase.from(k.runners).delete().eq('id', runner.id)
    return error ? fail(error) : { ok: true }
  } catch (err) { return fail(err) }
}

// Withdraw / reinstate through the existing flow. Returns { ok, text } in the same words the Today tab uses.
export async function runRunnerAction(kind, mode, plan, lockIso) {
  const { runner } = plan
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  try {
    if (mode === 'withdraw') {
      const r = await withdrawRunnerNow(kind, plan, { lockIso: lockIso || null })
      const bits = [`${runner.horse_name} withdrawn`]
      if (r.lockedNow) bits.push(`race locked first (field of ${r.lockedNow.count}${r.lockedNow.converted ? `, ${r.lockedNow.converted} each-way changed to win` : ''})`)
      bits.push(r.moved ? `${plural(r.moved, 'pick')} moved to ${r.favourite.horse_name}` : 'no picks to move')
      if (r.switched) bits.push(`${r.switched} each-way changed to win`)
      if (r.rescored) bits.push(r.rescored.ok ? 'scores recalculated' : `SCORES NOT RECALCULATED: ${r.rescored.msg}`)
      if (r.notified) bits.push(r.notified.ok ? `${plural(r.notified.count, 'player')} notified` : `NOTIFICATION FAILED: ${r.notified.error}`)
      return { ok: !((r.rescored && !r.rescored.ok) || (r.notified && !r.notified.ok)), text: bits.join(' · ') }
    }
    const r = await reinstateRunnerNow(kind, plan)
    const bits = [`${runner.horse_name} reinstated`]
    if (r.reverted) bits.push(`${plural(r.reverted, 'pick')} reverted`)
    if (r.rescored) bits.push(r.rescored.ok ? 'scores recalculated' : `SCORES NOT RECALCULATED: ${r.rescored.msg}`)
    return { ok: !(r.rescored && !r.rescored.ok), text: bits.join(' · ') }
  } catch (err) { return { ok: false, text: err.message || String(err) } }
}

export { planWithdrawal, planReinstate }

// ═══ Bulk import ═══════════════════════════════════════════════════════

// Create the pasted races, each with its runners. A race whose runners fail is removed again.
//   parsed  parseRaceBlocks().races      existing  the day's races (for the next free numbers)
export async function importRaces(day, parsed, existing) {
  const c = raceCols(day.kind), k = KINDS[day.kind]
  const have = [...(existing || [])]
  const made = []
  for (const p of parsed) {
    const n = nextRaceNumber(day.kind, have)
    if (!n) return { ok: false, error: `Race slots are full after ${made.length} race${made.length === 1 ? '' : 's'}`, made }
    const base = { [c.parent]: day.id, race_number: n, ...racePayload(day.kind, { venue: p.header.venue, race_name: p.header.race_name, race_time: p.header.time, distance: p.header.distance, class_type: p.header.class }) }
    const { data: race, error } = await supabase.from(c.table).insert(base).select('id, race_number').single()
    if (error) return { ok: false, error: `Race ${n}: ${error.message}`, made }
    const rows = p.runners.map(r => ({ ...r, [k.raceCol]: race.id }))
    const { error: re } = await supabase.from(k.runners).insert(rows)
    if (re) {
      await supabase.from(c.table).delete().eq('id', race.id)
      return { ok: false, error: `Race ${n}: runners failed, so that race was not saved (${re.message})`, made }
    }
    have.push({ race_number: n })
    made.push({ number: n, runners: rows.length })
  }
  return { ok: true, made }
}

// ═══ Final declarations ════════════════════════════════════════════════

// How many picks sit on each runner of a race: { runnerId: count }.
export async function picksByRunner(kind, raceId) {
  const k = KINDS[kind]
  const rows = must(await supabase.from(k.picks).select('id, runner_id').eq(k.raceCol, raceId))
  const out = {}
  rows.forEach(r => { out[r.runner_id] = (out[r.runner_id] || 0) + 1 })
  return out
}

const priced = r => !r.is_withdrawn && Number(r.odds_decimal) > 0

// Apply a diffDeclarations() result in one go: update the runners that changed, add the new ones, bring
// back any that were wrongly withdrawn, then take the removed ones out. A removed horse that has picks (or
// any removed horse once picks have locked) goes through the existing withdraw flow, which moves its picks
// to the favourite and tells those players; the rest are deleted. Returns { ok, text, errors }.
export async function applyDeclarations(day, race, diff, { lockIso = null, locked = false } = {}) {
  const kind = day.kind, k = KINDS[kind]
  const errors = []
  const bits = []
  try {
    // 0. Check the removals can be carried out before anything changes.
    const picks = await picksByRunner(kind, race.id)
    const removedIds = new Set(diff.removed.map(r => r.id))
    const withPicks = diff.removed.filter(r => picks[r.id])
    if (withPicks.length) {
      const now = must(await supabase.from(k.runners).select('id, odds_decimal, is_withdrawn').eq(k.raceCol, race.id))
      const patchOf = Object.fromEntries(diff.updated.map(u => [u.runner.id, u.patch]))
      const survivors = now.filter(r => !removedIds.has(r.id) && priced({ ...r, ...(patchOf[r.id] || {}) })).length + diff.added.filter(a => Number(a.odds_decimal) > 0).length
      if (!survivors) return { ok: false, text: 'Nothing was changed: the horses being removed have picks, and no priced runner is left on the card to move them to.', errors }
    }

    // 1. Updates
    for (const u of diff.updated) {
      const { data, error } = await supabase.from(k.runners).update(u.patch).eq('id', u.runner.id).select('id')
      if (error) throw new Error(`Could not update ${u.runner.horse_name}: ${error.message}`)
      if ((data || []).length !== 1) throw new Error(`${u.runner.horse_name} was not updated (0 rows changed). Check you are signed in as an admin.`)
    }
    if (diff.updated.length) bits.push(`${diff.updated.length} updated`)

    // 2. New horses
    if (diff.added.length) {
      const rows = diff.added.map(r => ({ ...r, [k.raceCol]: race.id }))
      if (kind === 'festival') rows.forEach(r => { delete r.form_string })
      const { error } = await supabase.from(k.runners).insert(rows)
      if (error) throw new Error(`Could not add the new horses: ${error.message}`)
      bits.push(`${diff.added.length} added`)
    }

    // 3. Horses marked withdrawn that are on the final card
    for (const r of diff.revived) {
      const res = await runRunnerAction(kind, 'reinstate', await planReinstate(kind, r, race), lockIso)
      if (!res.ok) errors.push(res.text)
    }
    if (diff.revived.length) bits.push(`${diff.revived.length} reinstated`)

    // 4. Removed horses
    const mustWithdraw = diff.removed.filter(r => picks[r.id] || locked)
    const toDelete = diff.removed.filter(r => !mustWithdraw.includes(r))
    if (locked && race.runner_count_at_lock == null && mustWithdraw.length) await lockRaceIfEmpty(kind, race.id)
    if (toDelete.length) {
      const { error } = await supabase.from(k.runners).delete().in('id', toDelete.map(r => r.id))
      if (error) throw new Error(`Could not remove the horses that are not running: ${error.message}`)
    }
    if (mustWithdraw.length) {
      // Mark them all withdrawn first, so no removed horse can be chosen as the favourite to move picks to.
      const { error } = await supabase.from(k.runners).update({ is_withdrawn: true }).in('id', mustWithdraw.map(r => r.id))
      if (error) throw new Error(`Could not withdraw the horses that are not running: ${error.message}`)
      let moved = 0, notified = 0
      for (const r of mustWithdraw) {
        const plan = await planWithdrawal(kind, r, race, { lockIso })
        if (plan.blocked) { errors.push(`${r.horse_name}: ${plan.blocked}`); continue }
        try {
          const res = await withdrawRunnerNow(kind, plan, { lockIso })
          moved += res.moved || 0
          if (res.notified?.ok) notified += res.notified.count
          if (res.notified && !res.notified.ok) errors.push(`${r.horse_name}: notification failed (${res.notified.error})`)
          if (res.rescored && !res.rescored.ok) errors.push(`${r.horse_name}: scores not recalculated (${res.rescored.msg})`)
        } catch (err) { errors.push(`${r.horse_name}: ${err.message}`) }
      }
      bits.push(`${mustWithdraw.length} withdrawn${moved ? `, ${moved} pick${moved === 1 ? '' : 's'} moved, ${notified} player${notified === 1 ? '' : 's'} notified` : ''}`)
    }
    if (toDelete.length) bits.push(`${toDelete.length} removed`)

    // 5. Prices feed the scores, so re-score a race that already has a result.
    if (diff.updated.some(u => 'odds_decimal' in u.patch) || diff.added.length) {
      const { count } = await supabase.from(k.results).select('id', { count: 'exact', head: true }).eq(k.raceCol, race.id)
      if (count > 0) {
        const r = await recalculateRace(kind, race)
        if (!r.ok) errors.push(`Scores not recalculated: ${r.msg}`)
        else bits.push('scores recalculated')
      }
    }
    return { ok: !errors.length, text: `Final declarations applied${bits.length ? ': ' + bits.join(', ') : ' (nothing needed changing)'}`, errors }
  } catch (err) {
    return { ok: false, text: `${err.message}. Some changes may already have been made. Check the runners, then paste the card again to finish.`, errors }
  }
}

// ═══ Abandon ═══════════════════════════════════════════════════════════

// Void a race: clear its result, mark it abandoned, give every pick a 0-point score (banker included),
// then bring the day's bonuses (and, for a festival, the day points) up to date.
export async function abandonRace(day, race) {
  const kind = day.kind, c = DAY[kind], k = KINDS[kind], rc = raceCols(kind)
  try {
    const del = await supabase.from(k.results).delete().eq(k.raceCol, race.id)
    if (del.error) throw new Error(`Could not clear the result: ${del.error.message}`)
    const flag = await supabase.from(rc.table).update({ is_abandoned: true, abandoned_at: new Date().toISOString() }).eq('id', race.id).select('id')
    if (flag.error) throw new Error(`Could not mark the race abandoned: ${flag.error.message}`)
    if ((flag.data || []).length !== 1) throw new Error('The race was not marked abandoned (0 rows changed). Check you are signed in as an admin.')

    const ds = await supabase.from(c.scores).delete().eq(c.raceCol, race.id)
    if (ds.error) throw new Error(`Could not clear the old scores: ${ds.error.message}`)
    const picks = must(await supabase.from(c.picks).select('id, user_id, bet_type').eq(c.raceCol, race.id))
    if (picks.length) {
      const rows = picks.map(p => ({
        user_id: p.user_id, [c.raceCol]: race.id, ...(kind === 'week' ? { pick_id: p.id } : {}),
        ...(p.bet_type ? { bet_type: p.bet_type, win_token_points: 0, place_token_points: 0 } : { base_points: 0, bonus_points: 0 }),
        total_points: 0, position_achieved: null,
      }))
      const ins = await supabase.from(c.scores).insert(rows)
      if (ins.error) throw new Error(`Could not write the 0-point scores: ${ins.error.message}`)
    }
    let warn = ''
    const bonus = await applyDayBonuses(kind, day.id)
    if (!bonus.ok) warn = `Bonuses were not updated: ${bonus.msg}. Use Recalculate scores on the race day.`
    if (kind === 'festival') {
      const pts = await updateFestivalDayPoints({ ...race, festival_day_id: day.id })
      if (!pts.ok) warn = `${warn} Day points were not updated: ${pts.msg}.`.trim()
    }
    return { ok: !warn, text: `Race ${race.race_number} abandoned · ${picks.length} pick${picks.length === 1 ? '' : 's'} scored 0`, warn }
  } catch (err) { return { ok: false, text: err.message || String(err) } }
}

// Undo an abandon: the race is a normal race again with no result, so its scores are cleared.
export async function restoreRace(day, race) {
  const rc = raceCols(day.kind)
  try {
    const { data, error } = await supabase.from(rc.table).update({ is_abandoned: false, abandoned_at: null }).eq('id', race.id).select('id')
    if (error) throw new Error(error.message)
    if ((data || []).length !== 1) throw new Error('The race was not restored (0 rows changed). Check you are signed in as an admin.')
    const r = await recalculateRace(day.kind, { ...race, festival_day_id: day.kind === 'festival' ? day.id : race.festival_day_id })
    if (!r.ok) return { ok: false, text: `Race restored, but its scores were not cleared: ${r.msg}` }
    return { ok: true, text: `Race ${race.race_number} restored. Enter its result when it is in.` }
  } catch (err) { return { ok: false, text: err.message || String(err) } }
}

// ═══ Recalculate ═══════════════════════════════════════════════════════

// Re-score every race on the day that has a result, from the results already stored (bonuses included).
export async function recalculateDay(day, races, resultRaceIds) {
  let rows = 0
  const errors = []
  let n = 0
  for (const race of races) {
    if (race.is_abandoned || !resultRaceIds.has(race.id)) continue
    n++
    const r = await recalculateRace(day.kind, race)
    if (!r.ok) errors.push(`Race ${race.race_number}: ${r.msg}`)
    else { rows += r.count || 0; if (r.warn) errors.push(`Race ${race.race_number}: ${r.warn}`) }
  }
  if (!n) return { ok: false, text: 'No races on this day have a result yet' }
  return errors.length
    ? { ok: false, text: `Re-scored ${n - errors.length} of ${n} races. First issue: ${errors[0]}` }
    : { ok: true, text: `Recalculated ${n} race${n === 1 ? '' : 's'} · ${rows} score${rows === 1 ? '' : 's'} written` }
}

