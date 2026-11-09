// The Race days list: every Saturday League week and every festival day in one list, with a status for
// each. Pure functions over rows already read from Supabase.
import { ukDateStr, lockMs } from './format.js'

// The status pill for a race day.
//   raceCount  races loaded      done  races with a result or abandoned      locked  picks have locked
//   notified   picks-open notification sent      linked  { label } when this is a Saturday linked to a festival day
export function dayStatus({ raceCount, done, locked, notified, linked }) {
  if (linked) return { key: 'linked', tone: 'gold', label: `Linked to ${linked.label}` }
  if (!raceCount) return { key: 'empty', tone: 'warn', label: 'Races not loaded' }
  if (done >= raceCount) return { key: 'complete', tone: 'ok', label: 'Complete' }
  if (done > 0) return { key: 'results', tone: 'gold', label: `Results ${done} of ${raceCount}` }
  if (locked) return { key: 'locked', tone: 'off', label: 'Locked' }
  if (notified) return { key: 'open', tone: 'ok', label: 'Picks open' }
  return { key: 'ready', tone: 'ok', label: 'Ready' }
}

// Venues as one line: "Wincanton", "Ascot · York", "Ascot · York +1".
export function venueLine(venues) {
  const list = [...new Set((venues || []).filter(Boolean))]
  if (list.length <= 2) return list.join(' · ')
  return `${list.slice(0, 2).join(' · ')} +${list.length - 2}`
}

// Rows for the list.
//   weeks      race_weeks [{ id, week_number, saturday_date, picks_deadline, picks_open_notified_at, festival_day_id }]
//   days       festival_days [{ id, festival_id, day_number, race_date, picks_deadline, picks_open_notified_at }]
//   festivals  [{ id, name, display_name, venue }]
//   races      [{ id, parent: 'week:<id>' | 'festival:<id>', venue, is_abandoned }]
//   doneIds    Set of race ids that have a result
export function buildDayList({ weeks = [], days = [], festivals = [], races = [], doneIds = new Set() }, nowMs = Date.now()) {
  const fest = Object.fromEntries(festivals.map(f => [f.id, f]))
  const byParent = {}
  races.forEach(r => { (byParent[r.parent] ||= []).push(r) })
  const stats = key => {
    const list = byParent[key] || []
    return { raceCount: list.length, done: list.filter(r => r.is_abandoned || doneIds.has(r.id)).length, venues: list.map(r => r.venue) }
  }
  const dayName = d => `${fest[d.festival_id]?.display_name || fest[d.festival_id]?.name || 'Festival'}`
  const rows = []
  for (const w of weeks) {
    const linkedDay = w.festival_day_id ? days.find(d => d.id === w.festival_day_id) : null
    const s = stats(linkedDay ? `festival:${linkedDay.id}` : `week:${w.id}`)
    const locked = nowMs >= lockMs(w.picks_deadline, w.saturday_date)
    rows.push({
      key: `week:${w.id}`, kind: 'week', id: w.id, date: w.saturday_date,
      title: `Saturday League · Week ${w.week_number}`,
      venue: venueLine(s.venues) || (linkedDay ? fest[linkedDay.festival_id]?.venue || '' : ''),
      raceCount: s.raceCount,
      status: dayStatus({
        ...s, locked, notified: !!(linkedDay ? linkedDay.picks_open_notified_at : w.picks_open_notified_at),
        linked: linkedDay ? { label: `Day ${linkedDay.day_number}` } : null,
      }),
    })
  }
  for (const d of days) {
    const s = stats(`festival:${d.id}`)
    rows.push({
      key: `festival:${d.id}`, kind: 'festival', id: d.id, date: d.race_date,
      title: `${dayName(d)} · Day ${d.day_number}`,
      venue: venueLine(s.venues) || fest[d.festival_id]?.venue || '',
      raceCount: s.raceCount,
      status: dayStatus({ ...s, locked: nowMs >= lockMs(d.picks_deadline, d.race_date), notified: !!d.picks_open_notified_at, linked: null }),
    })
  }
  return rows
}

// Upcoming (today or later, soonest first) and Past (newest first), by UK date.
export function groupDays(rows, nowMs = Date.now()) {
  const today = ukDateStr(nowMs)
  const by = (a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key)
  return {
    upcoming: rows.filter(r => r.date >= today).sort(by),
    past: rows.filter(r => r.date < today).sort((a, b) => by(b, a)),
  }
}
