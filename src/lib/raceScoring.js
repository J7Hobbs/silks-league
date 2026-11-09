// Scoring for one race from its results and picks, for Saturday races and festival races.
// This is where the "score one race" steps live so that entering results, editing results and a
// withdrawal after the results are in all use the same code. The formulas themselves are in
// scoring.js and are not touched here.
import { supabase } from './supabase'
import { calcPoints, calcTokenPoints } from './scoring.js'
import { countNonWithdrawnRunners, lockRaceIfEmpty } from './raceLock.js'
import { applyDayBonuses, notifyNewBonuses, raceDayOf } from './dayBonuses.js'

export { countNonWithdrawnRunners }

// A race that was never locked has no runner_count_at_lock. Before scoring, lock it the same way
// "Lock Picks" does (stamp the field size, convert each-way picks that are not allowed), so each-way
// places are always judged on a real count. null when the race was already locked.
async function lockIfNeverLocked(kind, raceId) {
  try { return { auto: await lockRaceIfEmpty(kind, raceId) } }
  catch (err) { return { error: err.message || String(err) } }
}

// ── Shared helper: score one race from its results + picks ───
async function scoreWeekRace(raceId, raceNumber) {
  console.log(`[Scores] Starting race ${raceNumber} (${raceId})`)

  const lockStep = await lockIfNeverLocked('week', raceId)
  if (lockStep.error) return { ok: false, msg: `Locking the race failed: ${lockStep.error}` }

  // 1. Wipe existing scores for this race
  const { error: delErr } = await supabase.from('scores').delete().eq('race_id', raceId)
  if (delErr) {
    console.error(`[Scores] Delete failed:`, delErr)
    return { ok: false, msg: `Delete failed: ${delErr.message}` }
  }

  // 2. Load the results (top 3, or top 4 for large fields)
  const { data: raceResults, error: resReadErr } = await supabase
    .from('results')
    .select('position, horse_name, starting_price_decimal')
    .eq('race_id', raceId)
  console.log(`[Scores] Results for race ${raceNumber}:`, raceResults, resReadErr)

  if (resReadErr) return { ok: false, msg: `Read results failed: ${resReadErr.message}` }
  if (!raceResults?.length) return { ok: true, msg: 'No results yet', count: 0 }

  const placed = {}
  raceResults.forEach(r => {
    placed[r.horse_name] = { position: r.position, sp: r.starting_price_decimal }
  })

  // 3. Load picks for this race (bet_type is null for legacy picks made before the token system)
  const { data: picks, error: picksErr } = await supabase
    .from('picks').select('id, user_id, runner_id, bet_type').eq('race_id', raceId)
  console.log(`[Scores] Picks for race ${raceNumber}:`, picks, picksErr)

  if (picksErr) return { ok: false, msg: `Picks fetch failed: ${picksErr.message}` }
  if (!picks?.length) return { ok: true, msg: 'No picks for this race', count: 0 }

  // 4. Resolve runner_id → { horse_name, odds_decimal }
  const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
  const { data: runnerRows, error: runErr } = await supabase
    .from('runners').select('id, horse_name, odds_decimal').in('id', runnerIds)
  console.log(`[Scores] Runners:`, runnerRows, runErr)

  if (runErr) return { ok: false, msg: `Runners fetch failed: ${runErr.message}` }
  const runnerMap = {}
  runnerRows?.forEach(r => {
    runnerMap[r.id] = r
  })

  // 5. Resolve runner_count_at_lock — stamped by "Lock Picks", or auto-captured
  // here as a safety net if that step was missed (each-way eligibility may then
  // not be perfectly deadline-accurate, so we surface a warning).
  let lockAutoCaptured = !!lockStep.auto
  const { data: raceRow } = await supabase.from('races').select('runner_count_at_lock').eq('id', raceId).single()
  let runnerCountAtLock = raceRow?.runner_count_at_lock
  if (runnerCountAtLock == null) {
    runnerCountAtLock = await countNonWithdrawnRunners('runners', 'race_id', raceId)
    await supabase.from('races').update({ runner_count_at_lock: runnerCountAtLock }).eq('id', raceId)
    lockAutoCaptured = true
  }

  // 6. Build score rows — new token formula for picks with bet_type set, legacy formula otherwise
  const scoresToInsert = picks
    .map(pick => {
      const runner = runnerMap[pick.runner_id]
      const horseName = runner?.horse_name
      const p = horseName ? placed[horseName] : null
      const position = p?.position ?? null

      if (pick.bet_type) {
        const oddsDecimal = runner?.odds_decimal ?? p?.sp ?? 0
        const { winTokenPoints, placeTokenPoints, totalPoints } = calcTokenPoints({
          betType: pick.bet_type, position, oddsDecimal, runnerCount: runnerCountAtLock,
        })
        return {
          user_id: pick.user_id, race_id: raceId, pick_id: pick.id,
          bet_type: pick.bet_type, win_token_points: winTokenPoints, place_token_points: placeTokenPoints,
          total_points: totalPoints, position_achieved: position,
        }
      }

      if (p) {
        const { base, bonus, total } = calcPoints(p.position, p.sp)
        return {
          user_id: pick.user_id, race_id: raceId, pick_id: pick.id,
          base_points: base, bonus_points: bonus, total_points: total,
          position_achieved: p.position,
        }
      }
      return {
        user_id: pick.user_id, race_id: raceId, pick_id: pick.id,
        base_points: 0, bonus_points: 0, total_points: 0, position_achieved: null,
      }
    })
  console.log(`[Scores] Rows to insert for race ${raceNumber}:`, scoresToInsert)

  const lockWarn = lockAutoCaptured
    ? `Runner count for each-way eligibility was auto-captured at results-entry time (Lock Picks wasn't clicked before the deadline) — may not be perfectly deadline-accurate.${lockStep.auto?.converted ? ` ${lockStep.auto.converted} each-way pick${lockStep.auto.converted === 1 ? '' : 's'} changed to win.` : ''}`
    : null

  // 7. Try full insert first
  const { error: insErr } = await supabase.from('scores').insert(scoresToInsert)
  if (!insErr) {
    console.log(`[Scores] Insert OK — ${scoresToInsert.length} rows`)
    return { ok: true, count: scoresToInsert.length, warn: lockWarn }
  }

  console.error(`[Scores] Full insert failed:`, insErr)

  // 8. Full insert failed — likely missing columns. Retry with minimal columns only.
  console.warn(`[Scores] Retrying with minimal columns (user_id, race_id, total_points)`)
  const minimal = scoresToInsert.map(s => ({
    user_id: s.user_id,
    race_id: s.race_id,
    total_points: s.total_points,
  }))
  const { error: minErr } = await supabase.from('scores').insert(minimal)
  if (!minErr) {
    console.log(`[Scores] Minimal insert OK — ${minimal.length} rows`)
    return {
      ok: true, count: minimal.length,
      warn: `Saved with minimal columns — run supabase/token_scoring_migration.sql to add the missing columns`,
    }
  }

  console.error(`[Scores] Minimal insert also failed:`, minErr)
  return { ok: false, msg: `Insert failed: ${minErr.message} (original: ${insErr.message})` }
}

// ── Bonuses ──────────────────────────────────────────────────
// After a race is scored, the race day's bonuses (Banker, Lone winner, Treble) are brought up to date, so
// the stored total_points always includes them (see dayBonuses.js). A failure here never loses the
// race's own scores: the result is still ok, with a warning to run Recalculate.
function withBonuses(scored, bonus) {
  if (bonus.ok) return { ...scored, bonus }
  const warn = `Bonuses were not updated: ${bonus.msg}. Run Recalculate to fix it.`
  return { ...scored, warn: scored.warn ? `${scored.warn} ${warn}` : warn, bonus }
}

export async function calculateScoresForRace(raceId, raceNumber) {
  const scored = await scoreWeekRace(raceId, raceNumber)
  if (!scored.ok) return scored
  const dayId = await raceDayOf('week', raceId).catch(() => null)
  const bonus = await applyDayBonuses('week', dayId)
  if (bonus.ok) await notifyNewBonuses('week', bonus.awards)
  return withBonuses(scored, bonus)
}

export async function calculateFestivalScoresForRace(race) {
  const scored = await scoreFestivalRace(race)
  if (!scored.ok) return scored
  const dayId = race.festival_day_id || await raceDayOf('festival', race.id).catch(() => null)
  const bonus = await applyDayBonuses('festival', dayId)
  if (bonus.ok) await notifyNewBonuses('festival', bonus.awards)
  return withBonuses(scored, bonus)
}

// ── Festival races ───────────────────────────────────────────
// Same steps as the Saturday function above, reading festival_results / festival_picks and writing
// festival_scores. (This is the scoring block that used to sit inside submitFestivalResults.)
async function scoreFestivalRace(race) {
  const lockStep = await lockIfNeverLocked('festival', race.id)
  if (lockStep.error) return { ok: false, msg: `Locking the race failed: ${lockStep.error}` }

  const { data: results, error: resErr } = await supabase
    .from('festival_results').select('position, horse_name').eq('festival_race_id', race.id)
  if (resErr) return { ok: false, msg: `Read results failed: ${resErr.message}` }
  if (!results?.length) return { ok: true, msg: 'No results yet', count: 0 }

  const { data: allRunners, error: runErr0 } = await supabase
    .from('festival_runners').select('id, horse_name, odds_decimal').eq('festival_race_id', race.id)
  if (runErr0) return { ok: false, msg: `Runners fetch failed: ${runErr0.message}` }
  const oddsByName = {}
  allRunners?.forEach(r => { oddsByName[r.horse_name] = r.odds_decimal || null })

  const placed = {}
  results.forEach(r => { placed[r.horse_name] = { position: r.position, sp: oddsByName[r.horse_name] ?? null } })

  const { data: picks, error: picksErr } = await supabase
    .from('festival_picks').select('id, user_id, runner_id, bet_type').eq('festival_race_id', race.id)
  if (picksErr) return { ok: false, msg: `Picks fetch failed: ${picksErr.message}` }
  if (!picks?.length) return { ok: true, msg: 'No picks for this race', count: 0 }

  const nameMap = {}
  allRunners?.forEach(r => { nameMap[r.id] = { name: r.horse_name, sp: r.odds_decimal } })

  // Resolve runner_count_at_lock — stamped by "Lock Picks", or auto-captured
  // here as a safety net if that step was missed.
  let lockAutoCaptured = !!lockStep.auto
  const { data: raceRow } = await supabase.from('festival_races').select('runner_count_at_lock').eq('id', race.id).single()
  let runnerCountAtLock = raceRow?.runner_count_at_lock
  if (runnerCountAtLock == null) {
    runnerCountAtLock = await countNonWithdrawnRunners('festival_runners', 'festival_race_id', race.id)
    await supabase.from('festival_races').update({ runner_count_at_lock: runnerCountAtLock }).eq('id', race.id)
    lockAutoCaptured = true
  }

  // Delete old scores first
  await supabase.from('festival_scores').delete().eq('festival_race_id', race.id)

  const scoreRows = picks.map(pick => {
    const runner = nameMap[pick.runner_id]
    const p = runner ? placed[runner.name] : null
    const position = p?.position ?? null

    if (pick.bet_type) {
      const oddsDecimal = runner?.sp ?? p?.sp ?? 0
      const { winTokenPoints, placeTokenPoints, totalPoints } = calcTokenPoints({
        betType: pick.bet_type, position, oddsDecimal, runnerCount: runnerCountAtLock,
      })
      return {
        festival_race_id: race.id, user_id: pick.user_id,
        bet_type: pick.bet_type, win_token_points: winTokenPoints, place_token_points: placeTokenPoints,
        total_points: totalPoints, position_achieved: position,
      }
    }

    if (p) {
      const { base, bonus, total } = calcPoints(p.position, p.sp || 1)
      return { festival_race_id: race.id, user_id: pick.user_id, base_points: base, bonus_points: bonus, total_points: total, position_achieved: p.position }
    }
    return { festival_race_id: race.id, user_id: pick.user_id, base_points: 0, bonus_points: 0, total_points: 0, position_achieved: null }
  })

  const { error: scoreErr } = await supabase.from('festival_scores').insert(scoreRows)
  if (scoreErr) return { ok: false, msg: `Scores failed: ${scoreErr.message}` }
  return { ok: true, count: scoreRows.length, lockAutoCaptured, converted: lockStep.auto?.converted || 0 }
}

// festival_day_points (the leaderboard's numbers) for the day this race is on: each player's total of
// festival_scores across the day's races. Festival scoring writes festival_scores AND festival_day_points,
// so anything that changes one of a day's races has to run this too.
export async function updateFestivalDayPoints(race) {
  const { data: day } = await supabase
    .from('festival_days').select('festival_id, day_number').eq('id', race.festival_day_id).maybeSingle()
  if (!day) return { ok: false, msg: 'Festival day not found' }

  const { data: dayRaces } = await supabase.from('festival_races').select('id').eq('festival_day_id', race.festival_day_id)
  const dayRaceIds = (dayRaces || []).map(r => r.id)
  if (!dayRaceIds.length) return { ok: true, count: 0 }

  const { data: dayScores } = await supabase
    .from('festival_scores').select('user_id, total_points').in('festival_race_id', dayRaceIds)
  const dayTotals = {}
  ;(dayScores || []).forEach(s => { dayTotals[s.user_id] = (dayTotals[s.user_id] || 0) + (s.total_points || 0) })
  const rows = Object.entries(dayTotals).map(([userId, pts]) => ({
    festival_id: day.festival_id, user_id: userId, day_number: day.day_number, points: pts,
  }))
  if (!rows.length) return { ok: true, count: 0 }
  const { error } = await supabase.from('festival_day_points').upsert(rows, { onConflict: 'festival_id,user_id,day_number' })
  if (error) return { ok: false, msg: `Day points failed: ${error.message}` }
  return { ok: true, count: rows.length }
}

// Re-score one race (Saturday race or festival race) from the results already stored. For a festival
// race that includes that day's festival_day_points. Returns { ok, count, msg?, warn? }.
export async function recalculateRace(kind, race) {
  if (kind === 'week') return calculateScoresForRace(race.id, race.race_number)
  const scored = await calculateFestivalScoresForRace(race)
  if (!scored.ok) return scored
  const day = await updateFestivalDayPoints(race)
  return day.ok ? scored : { ok: false, msg: day.msg }
}
