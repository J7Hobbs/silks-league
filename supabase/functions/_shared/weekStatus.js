// Marks a Saturday League week "completed" by itself once every one of its races has a result or is abandoned, and puts it
// back when that stops being true (a race restored, a race added). This is what the classic Admin's "Complete week" button
// did: it set race_weeks.status to 'completed', and nothing else. It never touches scores, picks or points.
import { supabase } from './db.js'
import { DAY } from './dayBonuses.js'
import { KINDS } from './raceDay.js'

const must = ({ data, error }) => { if (error) throw error; return data || [] }

// A week is complete when it has races and every race has a result or is abandoned.
//   races [{ id, is_abandoned }]      resultRaceIds  Set of race ids that have a result
export const weekComplete = (races, resultRaceIds) => races.length > 0 && races.every(r => r.is_abandoned || resultRaceIds.has(r.id))

// The status to put back when a week stops being complete: whatever the season's other unfinished weeks carry (the most
// common one), since the column's own default is set in the database. null when there is none to copy.
export function commonStatus(rows) {
  const count = {}
  rows.forEach(r => { if (r.status && r.status !== 'completed') count[r.status] = (count[r.status] || 0) + 1 })
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

// Brings the status of the Saturday week(s) that own this race day in line with its races. `kind` and `parentId` are the
// race day: 'week' + race_weeks.id, or 'festival' + festival_days.id (the weeks linked to that day). Never throws: a
// failure comes back as { ok: false } and is logged, because the status is only a label and must not stop the action
// that called this. Returns { ok, changed: [{ weekId, status }] }.
export async function syncWeekStatus(kind, parentId) {
  try {
    if (!parentId) return { ok: true, changed: [] }
    const cols = 'id, season_id, status, festival_day_id'
    const weeks = must(kind === 'week'
      ? await supabase.from('race_weeks').select(cols).eq('id', parentId)
      : await supabase.from('race_weeks').select(cols).eq('festival_day_id', parentId))
    const changed = []
    for (const w of weeks) {
      // A week linked to a festival day has its races on that day.
      const src = w.festival_day_id ? 'festival' : 'week'
      const srcId = w.festival_day_id || w.id
      const c = DAY[src], k = KINDS[src]
      const races = must(await supabase.from(c.races).select('id, is_abandoned').eq(c.raceDayCol, srcId))
      const results = races.length ? must(await supabase.from(k.results).select(k.raceCol).in(k.raceCol, races.map(r => r.id))) : []
      const complete = weekComplete(races, new Set(results.map(r => r[k.raceCol])))
      let next
      if (complete && w.status !== 'completed') next = 'completed'
      else if (!complete && w.status === 'completed') {
        next = commonStatus(must(await supabase.from('race_weeks').select('status').eq('season_id', w.season_id).neq('status', 'completed')))
      } else continue
      const upd = await supabase.from('race_weeks').update({ status: next }).eq('id', w.id).select('id')
      if (upd.error) throw upd.error
      if ((upd.data || []).length !== 1) throw new Error('0 rows changed')
      changed.push({ weekId: w.id, status: next })
    }
    return { ok: true, changed }
  } catch (err) {
    console.warn('[Admin] could not update the week status:', err)
    return { ok: false, changed: [], error: err.message || String(err) }
  }
}

// The same, starting from one race: finds the race day it belongs to.
export async function syncWeekStatusForRace(kind, race) {
  try {
    const col = DAY[kind].raceDayCol
    let parent = race?.[col]
    if (!parent && race?.id) parent = (await supabase.from(DAY[kind].races).select(col).eq('id', race.id).maybeSingle()).data?.[col]
    return syncWeekStatus(kind, parent)
  } catch (err) {
    console.warn('[Admin] could not update the week status:', err)
    return { ok: false, changed: [], error: err.message || String(err) }
  }
}
