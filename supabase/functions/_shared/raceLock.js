// Locking a race's picks: stamp runner_count_at_lock (the field size the each-way rules are judged on)
// and change every each-way pick that each-way is no longer allowed for into a win pick.
// Saturday races and festival races use the same steps (see LOCK for the table names).
//
// Each-way is not allowed when the field is smaller than the each-way minimum (getPlaceTerms) or the
// picked horse is shorter than 4/1 (canOfferEachWay). Nothing here works out a score.
//
// Used by: the two "Lock Picks" buttons, scoring when a race was never locked (so the count is never
// empty when points are worked out), a withdrawal after the lock, and Admin's catch-up for a race
// whose deadline has passed.
import { supabase } from './db.js'
import { canOfferEachWay } from './scoring.js'

export const LOCK = {
  week:     { races: 'races',          runners: 'runners',          picks: 'picks',          raceCol: 'race_id' },
  festival: { races: 'festival_races', runners: 'festival_runners', picks: 'festival_picks', raceCol: 'festival_race_id' },
}

// Count of non-withdrawn runners for a race.
export async function countNonWithdrawnRunners(table, raceIdColumn, raceId) {
  const { data } = await supabase.from(table).select('is_withdrawn').eq(raceIdColumn, raceId)
  return (data || []).filter(r => !r.is_withdrawn).length
}

// Which each-way picks have to become win: [pickId]. `runnersById` has odds_decimal. A pick on a runner
// with no price is left alone (it scores 0 either way, and the price may still be added).
export function picksToConvert(picks, runnersById, count) {
  return (picks || [])
    .filter(p => p.bet_type === 'each_way')
    .filter(p => {
      const odds = Number(runnersById[p.runner_id]?.odds_decimal)
      return odds > 0 && !canOfferEachWay(odds, count)
    })
    .map(p => p.id)
}

// Lock one race now: stamp the field size and convert the each-way picks that are no longer allowed.
// Returns { count, converted }; throws an Error that says what failed.
export async function lockRace(kind, raceId) {
  const c = LOCK[kind]

  const { data: runners, error: runErr } = await supabase
    .from(c.runners).select('id, odds_decimal, is_withdrawn').eq(c.raceCol, raceId)
  if (runErr) throw new Error(`Could not read runners: ${runErr.message}`)
  const count = (runners || []).filter(r => !r.is_withdrawn).length

  const stamp = await supabase.from(c.races).update({ runner_count_at_lock: count }).eq('id', raceId).select('id')
  if (stamp.error) throw new Error(`Could not stamp the runner count: ${stamp.error.message}`)
  if ((stamp.data || []).length !== 1) throw new Error('The runner count was not saved (0 rows changed). Check you are signed in as an admin.')

  const { data: picks, error: pickErr } = await supabase
    .from(c.picks).select('id, runner_id, bet_type').eq(c.raceCol, raceId).eq('bet_type', 'each_way')
  if (pickErr) throw new Error(`Runner count saved, but picks could not be read: ${pickErr.message}`)

  const byId = Object.fromEntries((runners || []).map(r => [r.id, r]))
  const ids = picksToConvert(picks, byId, count)
  if (ids.length) {
    const { data, error } = await supabase.from(c.picks).update({ bet_type: 'win' }).in('id', ids).select('id')
    if (error) throw new Error(`Runner count saved, but changing each-way picks to win failed: ${error.message}`)
    if ((data || []).length !== ids.length) {
      throw new Error(`Runner count saved, but expected to change ${ids.length} each-way pick${ids.length === 1 ? '' : 's'} and changed ${(data || []).length}`)
    }
  }
  return { count, converted: ids.length }
}

// Lock the race only if nothing has stamped it yet (null count). Returns the lockRace result, or null
// when the race was already locked. The count is never overwritten here.
export async function lockRaceIfEmpty(kind, raceId) {
  const c = LOCK[kind]
  const { data, error } = await supabase.from(c.races).select('runner_count_at_lock').eq('id', raceId).maybeSingle()
  if (error) throw new Error(`Could not read the race: ${error.message}`)
  if (!data || data.runner_count_at_lock != null) return null
  return lockRace(kind, raceId)
}

// Lock several races. Returns { locked: [{ raceId, count, converted }], failed: [{ raceId, error }] }.
export async function lockRaces(kind, raceIds) {
  const locked = [], failed = []
  for (const raceId of raceIds) {
    try { locked.push({ raceId, ...(await lockRace(kind, raceId)) }) }
    catch (err) { failed.push({ raceId, error: err.message || String(err) }) }
  }
  return { locked, failed }
}
