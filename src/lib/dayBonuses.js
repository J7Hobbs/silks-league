// Write a race day's bonuses (Banker, Lone winner, Treble) after its races have been scored.
//
// The rules and the arithmetic are in bonuses.js. This file reads the day's scores and bankers,
// brings bonus_awards (the ledger) in line, and sets each score row's total_points to
//   win_token_points + place_token_points + that race's bonuses,
// so every existing total and ranking includes the bonus without being changed. Running it again
// gives the same result, so it is safe to run after every score, edit or withdrawal. A linked
// Saturday has no scores of its own, so its bonuses are stored once, against the festival day.
//
// Race days before BONUS_RULES.startDate, and score rows with no bet_type (the old scoring), are not touched.
import { supabase } from './supabase'
import { bonusesApply, computeDayBonuses } from './bonuses.js'

export const DAY = {
  week: {
    days: 'race_weeks', dateCol: 'saturday_date', races: 'races', raceDayCol: 'race_week_id',
    scores: 'scores', picks: 'picks', raceCol: 'race_id', awardDayCol: 'race_week_id', awardRaceCol: 'race_id',
  },
  festival: {
    days: 'festival_days', dateCol: 'race_date', races: 'festival_races', raceDayCol: 'festival_day_id',
    scores: 'festival_scores', picks: 'festival_picks', raceCol: 'festival_race_id', awardDayCol: 'festival_day_id', awardRaceCol: 'festival_race_id',
  },
}

const fail = (what, error) => new Error(`${what}: ${error.message || error}`)

// The race day (race week id or festival day id) a race is on.
export async function raceDayOf(kind, raceId) {
  const c = DAY[kind]
  const { data, error } = await supabase.from(c.races).select(c.raceDayCol).eq('id', raceId).maybeSingle()
  if (error) throw fail('Could not read the race', error)
  return data?.[c.raceDayCol] || null
}

// Bring one race day's bonuses up to date. Returns { ok: true, skipped?, awards, changedRows } or
// { ok: false, msg }. `awards` are the ledger rows as they now stand (id, user_id, bonus_type, race id,
// points, detail). Bonuses no longer send a push of their own.
export async function applyDayBonuses(kind, dayId) {
  try {
    if (!dayId) return { ok: true, skipped: true, awards: [], changedRows: 0 }
    const c = DAY[kind]

    const { data: day, error: dayErr } = await supabase.from(c.days).select(`id, ${c.dateCol}`).eq('id', dayId).maybeSingle()
    if (dayErr) throw fail('Could not read the race day', dayErr)
    if (!day || !bonusesApply(day[c.dateCol])) return { ok: true, skipped: true, awards: [], changedRows: 0 }

    const { data: races, error: raceErr } = await supabase.from(c.races).select('id, race_number').eq(c.raceDayCol, dayId)
    if (raceErr) throw fail('Could not read the races', raceErr)
    const raceIds = (races || []).map(r => r.id)
    if (!raceIds.length) return { ok: true, skipped: true, awards: [], changedRows: 0 }

    const [scoresRes, bankersRes, awardsRes] = await Promise.all([
      supabase.from(c.scores).select(`id, user_id, ${c.raceCol}, total_points, win_token_points, place_token_points, position_achieved, bet_type`).in(c.raceCol, raceIds),
      supabase.from(c.picks).select(`user_id, ${c.raceCol}`).in(c.raceCol, raceIds).eq('is_banker', true),
      supabase.from('bonus_awards').select('id, user_id, bonus_type, race_id, festival_race_id, points, detail, notified_at').eq(c.awardDayCol, dayId),
    ])
    if (scoresRes.error) throw fail('Could not read the scores', scoresRes.error)
    if (bankersRes.error) throw fail('Could not read the bankers', bankersRes.error)
    if (awardsRes.error) throw fail('Could not read the bonus ledger', awardsRes.error)

    // Only scores from the token system: a row with no bet_type is left exactly as it is.
    const scoreRows = (scoresRes.data || []).filter(s => s.bet_type)
    const raw = s => (s.win_token_points || 0) + (s.place_token_points || 0)
    const { awards, bonusByRow } = computeDayBonuses({
      races: races || [],
      scores: scoreRows.map(s => ({ user_id: s.user_id, race_id: s[c.raceCol], position_achieved: s.position_achieved, raw: raw(s) })),
      bankers: (bankersRes.data || []).map(b => ({ user_id: b.user_id, race_id: b[c.raceCol] })),
    })

    // ── The ledger: delete what no longer applies, update what changed, add what is new ──
    const existing = awardsRes.data || []
    const keyOf = a => `${a.user_id}|${a.bonus_type || a.type}|${a.race_id ?? a.festival_race_id}`
    const wanted = new Map(awards.map(a => [keyOf(a), a]))
    const have = new Map(existing.map(a => [keyOf(a), a]))

    const stale = existing.filter(a => !wanted.has(keyOf(a)))
    if (stale.length) {
      const { error } = await supabase.from('bonus_awards').delete().in('id', stale.map(a => a.id))
      if (error) throw fail('Could not clear old bonuses', error)
    }
    for (const [key, a] of wanted) {
      const old = have.get(key)
      if (!old) continue
      const sameDetail = JSON.stringify(old.detail || {}) === JSON.stringify(a.detail || {})
      if (old.points !== a.points || !sameDetail) {
        const { error } = await supabase.from('bonus_awards').update({ points: a.points, detail: a.detail, updated_at: new Date().toISOString() }).eq('id', old.id)
        if (error) throw fail('Could not update a bonus', error)
      }
    }
    const fresh = [...wanted].filter(([key]) => !have.has(key)).map(([, a]) => ({
      user_id: a.user_id, bonus_type: a.type, points: a.points, detail: a.detail,
      [c.awardDayCol]: dayId, [c.awardRaceCol]: a.race_id,
    }))
    if (fresh.length) {
      const { error } = await supabase.from('bonus_awards').insert(fresh)
      if (error) throw fail('Could not save the bonuses', error)
    }

    // ── The scores: total = raw win + place points + this race's bonuses ──
    let changedRows = 0
    for (const s of scoreRows) {
      const want = raw(s) + (bonusByRow[`${s.user_id}|${s[c.raceCol]}`] || 0)
      if (s.total_points === want) continue
      const { data, error } = await supabase.from(c.scores).update({ total_points: want }).eq('id', s.id).select('id')
      if (error) throw fail('Could not update a score', error)
      if ((data || []).length !== 1) throw new Error('A score was not updated (0 rows changed). Check you are signed in as an admin.')
      changedRows++
    }

    const { data: now, error: nowErr } = await supabase.from('bonus_awards')
      .select('id, user_id, bonus_type, race_id, festival_race_id, points, detail, notified_at').eq(c.awardDayCol, dayId)
    if (nowErr) throw fail('Could not re-read the bonus ledger', nowErr)
    return { ok: true, awards: now || [], changedRows }
  } catch (err) {
    console.error('[Bonuses]', err)
    return { ok: false, msg: err.message || String(err) }
  }
}
