// Pure helpers for the festival card on Home and the Festivals page.
import {
  daysBetween, festivalLength, monthLong, monthAbbr, weekdayShort, weekdayLong,
} from './format.js'

const dayNum = d => Number(d.slice(8, 10))
const yearOf = d => Number(d.slice(0, 4))

// A festival is live while it is switched on and today falls within its dates.
// Switched on before it starts still counts as upcoming.
export function isLive(f, today) {
  return !!f.is_active && f.start_date <= today && f.end_date >= today
}

// "Fri 13 – Sun 15 November" ('long') or "Fri 13 – Sun 15 Nov" ('short').
// Across two months both months are named: "Wed 30 Dec – Fri 1 Jan".
export function dateRange(start, end, style = 'long') {
  const mon = d => (style === 'long' ? monthLong(d) : monthAbbr(d))
  const e = end || start
  if (e === start) return `${weekdayShort(start)} ${dayNum(start)} ${mon(start)}`
  if (monthAbbr(start) === monthAbbr(e) && yearOf(start) === yearOf(e)) {
    return `${weekdayShort(start)} ${dayNum(start)} – ${weekdayShort(e)} ${dayNum(e)} ${mon(e)}`
  }
  return `${weekdayShort(start)} ${dayNum(start)} ${monthAbbr(start)} – ${weekdayShort(e)} ${dayNum(e)} ${monthAbbr(e)}`
}

export const dayCount = f => festivalLength(f.start_date, f.end_date)
export const daysLabel = n => `${n} ${n === 1 ? 'day' : 'days'}`

// "Tomorrow" / "9 days" until the start.
export function untilText(days) { return days <= 1 ? 'Tomorrow' : `${days} days` }

// One tile per festival day: from the festival's day rows when it has them,
// otherwise from its start and end dates.
export function dayTiles(f, dayRows) {
  const rows = (dayRows || []).filter(d => d.race_date)
  if (rows.length) {
    return rows
      .slice().sort((a, b) => a.day_number - b.day_number)
      .map(d => ({ key: d.day_number, weekday: weekdayShort(d.race_date).toUpperCase(), date: dayNum(d.race_date), label: `Day ${d.day_number}` }))
  }
  const tiles = []
  const start = new Date(f.start_date + 'T12:00:00Z')
  for (let i = 0; i < dayCount(f); i++) {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + i)
    const s = d.toISOString().slice(0, 10)
    tiles.push({ key: i + 1, weekday: weekdayShort(s).toUpperCase(), date: dayNum(s), label: `Day ${i + 1}` })
  }
  return tiles
}

// What the Festivals page shows. `rows` are festivals that haven't finished.
//   featured   the first live or next festival of this year
//   rest       the others this year, in date order
//   groups     this year's festivals under month headers: [{ key, label, items }]
//   nextYear   { year, items } for the following calendar year
export function calendarView(rows, today) {
  const year = yearOf(today)
  const items = rows
    .filter(f => f.end_date >= today)
    .map(f => ({
      ...f,
      live: isLive(f, today),
      days: dayCount(f),
      daysUntil: daysBetween(today, f.start_date),
    }))
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0))
  const thisYear = items.filter(f => yearOf(f.start_date) <= year)
  const next = items.filter(f => yearOf(f.start_date) === year + 1)
  const groups = []
  for (const f of thisYear) {
    const key = f.start_date.slice(0, 7)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) { g = { key, label: monthLong(f.start_date), items: [] }; groups.push(g) }
    g.items.push(f)
  }
  return {
    featured: thisYear[0] || null,
    groups,
    nextYear: next.length ? { year: year + 1, items: next } : null,
    empty: !thisYear.length && !next.length,
  }
}

export { weekdayLong }
