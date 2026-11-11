// Notifications sent from the Admin screens when results land: the per-race teaser and the end-of-day message. Both go
// through the send-notification Edge Function. The wording and the rotation are in notifyCopy.js. Nothing here touches
// scores, picks or points: it only reads them to decide who to tell. Every function returns { ok, sent, ... } and never
// throws, because a failed push must never undo the result that was just saved.
import { supabase } from './db.js'
import { ukDateStr } from './format.js'
import { DAY } from './dayBonuses.js'
import { KINDS } from './raceDay.js'
import { APP_ORIGIN, RESULT_TEASER_TITLE, END_OF_DAY_TITLE, resultTeaserFor, endOfDayFor, festivalFinal, clockOf } from './notifyCopy.js'

const must = ({ data, error }) => { if (error) throw error; return data || [] }

// A read can return 1000 rows at most, so page through it. `build(from, to)` returns the query for one page.
async function allRows(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const page = must(await build(from, from + 999))
    out.push(...page)
    if (page.length < 1000) return out
  }
}

async function push(userIds, { title, body }, url) {
  const { error } = await supabase.functions.invoke('send-notification', { body: { userIds, title, body, url } })
  if (error) throw error
}

// Where a tap on a results notification goes.
async function resultsUrl(kind, dayId, festivalId) {
  if (kind !== 'festival') return `${APP_ORIGIN}/results`
  const id = festivalId || (await supabase.from('festival_days').select('festival_id').eq('id', dayId).maybeSingle()).data?.festival_id
  return id ? `${APP_ORIGIN}/results/festival/${id}` : `${APP_ORIGIN}/results`
}

// ── After a race's result is saved: a teaser to the players who picked in it ─────────────────────────────────
// Never says points or position. Each player's line rotates between the four in notifyCopy.js and never repeats back to
// back for them on the same race day: their place in the sequence is how many teasers they have had that day (their
// picks in races that already have a result), so nothing needs storing.
export async function sendResultTeasers(kind, race, { festivalId = null } = {}) {
  try {
    const c = DAY[kind], k = KINDS[kind]
    const fresh = must(await supabase.from(c.races).select(`id, race_number, venue, race_time, ${c.raceDayCol}`).eq('id', race.id))[0] || race
    const dayId = fresh[c.raceDayCol]
    const picks = must(await supabase.from(c.picks).select('user_id, runner_id').eq(c.raceCol, race.id))
    if (!picks.length) return { ok: true, sent: 0 }

    const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
    const runners = runnerIds.length ? must(await supabase.from(k.runners).select('id, horse_name').in('id', runnerIds)) : []
    const horseOf = Object.fromEntries(runners.map(r => [r.id, r.horse_name]))

    // How many teasers each player has already had on this race day.
    const userIds = [...new Set(picks.map(p => p.user_id))]
    const siblings = must(await supabase.from(c.races).select('id').eq(c.raceDayCol, dayId)).map(r => r.id).filter(id => id !== race.id)
    const done = siblings.length ? must(await supabase.from(k.results).select(k.raceCol).in(k.raceCol, siblings)).map(r => r[k.raceCol]) : []
    const earlier = done.length
      ? await allRows((a, b) => supabase.from(c.picks).select(`user_id, ${c.raceCol}`).in(c.raceCol, [...new Set(done)]).in('user_id', userIds).range(a, b))
      : []
    const step = {}
    earlier.forEach(p => { step[p.user_id] = (step[p.user_id] || 0) + 1 })

    // One message per player, then one send per distinct message.
    const byBody = new Map()
    for (const p of picks) {
      const body = resultTeaserFor({
        seed: `${p.user_id}|${kind}:${dayId}`, step: step[p.user_id] || 0,
        details: { raceNumber: fresh.race_number, time: clockOf(fresh.race_time), venue: String(fresh.venue || '').trim(), horse: horseOf[p.runner_id] || 'your pick' },
      })
      if (!byBody.has(body)) byBody.set(body, [])
      byBody.get(body).push(p.user_id)
    }
    const url = await resultsUrl(kind, dayId, festivalId)
    const results = await Promise.allSettled([...byBody].map(([body, ids]) => push(ids, { title: RESULT_TEASER_TITLE, body }, url)))
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length) console.error('[Admin] result teaser failed:', failed[0].reason)
    return { ok: !failed.length, sent: userIds.length, failed: failed.length }
  } catch (err) {
    console.error('[Admin] result teasers failed:', err)
    return { ok: false, sent: 0, error: err.message || String(err) }
  }
}

// If this festival day is the LAST day of its festival: { festivalId, dayIds, venue }, else null. That day's end-of-day message is
// replaced by the festival-final one (the same claim in reminder_log, so it still goes once and never as well as the other).
async function festivalFinalOf(dayId) {
  const day = (await supabase.from('festival_days').select('festival_id, day_number').eq('id', dayId).maybeSingle()).data
  if (!day) return null
  const days = must(await supabase.from('festival_days').select('id, day_number').eq('festival_id', day.festival_id))
  if (days.some(d => d.day_number > day.day_number)) return null
  const fest = (await supabase.from('festivals').select('venue').eq('id', day.festival_id).maybeSingle()).data
  return { festivalId: day.festival_id, dayIds: days.map(d => d.id), venue: String(fest?.venue || '').trim() }
}

// ── When a race day's last race has a result (or is abandoned): one message to everyone who picked ────────────
// Once per race day. The row in reminder_log is claimed first (it is unique per race day and kind), so two admins saving
// at once cannot both send, and it is released again if the send fails. A race day more than a day old is left alone,
// so entering old results never messages anyone. `kind`/`dayId` are the race day; a Saturday linked to a festival day is
// that festival day.
export async function sendEndOfDay(kind, dayId, { festivalId = null, nowMs = Date.now() } = {}) {
  try {
    let dk = kind, id = dayId
    if (kind === 'week') {
      const w = (await supabase.from('race_weeks').select('festival_day_id').eq('id', dayId).maybeSingle()).data
      if (w?.festival_day_id) { dk = 'festival'; id = w.festival_day_id }
    }
    const c = DAY[dk], k = KINDS[dk]
    const races = must(await supabase.from(c.races).select('id, race_number, venue, is_abandoned').eq(c.raceDayCol, id))
    if (!races.length) return { ok: true, sent: 0, skipped: 'no races' }
    const withResult = new Set(must(await supabase.from(k.results).select(k.raceCol).in(k.raceCol, races.map(r => r.id))).map(r => r[k.raceCol]))
    if (!races.every(r => r.is_abandoned || withResult.has(r.id))) return { ok: true, sent: 0, skipped: 'races still to come' }

    const date = (await supabase.from(c.days).select(c.dateCol).eq('id', id).maybeSingle()).data?.[c.dateCol]
    const yesterday = ukDateStr(nowMs - 86400000)
    if (date && date < yesterday) return { ok: true, sent: 0, skipped: 'old race day' }

    // The last day of a festival tells everyone who picked anywhere in the festival that the final table is in.
    const final = dk === 'festival' ? await festivalFinalOf(id) : null
    const pickRaceIds = final
      ? must(await supabase.from(c.races).select('id').in(c.raceDayCol, final.dayIds)).map(r => r.id)
      : races.map(r => r.id)
    const picks = await allRows((a, b) => supabase.from(c.picks).select('user_id').in(c.raceCol, pickRaceIds).range(a, b))
    const userIds = [...new Set(picks.map(p => p.user_id))]
    if (!userIds.length) return { ok: true, sent: 0, skipped: 'nobody picked' }

    const logCol = dk === 'week' ? 'race_week_id' : 'festival_day_id'
    const claim = await supabase.from('reminder_log').insert({ [logCol]: id, kind: 'end_of_day', recipient_count: userIds.length })
    if (claim.error) {
      if (claim.error.code === '23505') return { ok: true, sent: 0, skipped: 'already sent' }
      throw new Error(`Could not record the end-of-day message: ${claim.error.message}`)
    }

    const venues = [...new Set(races.map(r => String(r.venue || '').trim()).filter(Boolean))]
    const message = final
      ? festivalFinal({ venue: final.venue || (venues.length === 1 ? venues[0] : '') })
      : { title: END_OF_DAY_TITLE, body: endOfDayFor({ seed: `${dk}:${id}`, details: { venue: venues.length === 1 ? venues[0] : '' } }) }
    try {
      await push(userIds, message, final ? `${APP_ORIGIN}/festival/${final.festivalId}/final` : await resultsUrl(dk, id, festivalId))
    } catch (err) {
      await supabase.from('reminder_log').delete().eq(logCol, id).eq('kind', 'end_of_day')
      throw err
    }
    return { ok: true, sent: userIds.length, ...(final ? { final: true } : {}) }
  } catch (err) {
    console.error('[Admin] end-of-day notification failed:', err)
    return { ok: false, sent: 0, error: err.message || String(err) }
  }
}
