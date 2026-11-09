// Small pure helpers for the Picks page, kept apart from Supabase so they are easy to test.

import { weekdayShort, monthAbbr } from './format.js'

// Festivals offered as competition pills: switched on and not yet finished.
export function runningFestivals(festivals, today) {
  return (festivals || []).filter(f => f.is_active && (f.end_date || f.start_date) >= today)
}

// The festival the player is looking at, or null for the Saturday League.
// A group id or a festival that is no longer running falls back to Saturday.
export function selectedFestival(competition, festivals) {
  if (competition?.type !== 'festival') return null
  return festivals.find(f => f.id === competition.id) || null
}

// A festival day still takes picks until its stored deadline.
export function isDayOpen(day, nowMs, today) {
  return day.picks_deadline ? nowMs < new Date(day.picks_deadline).getTime() : day.race_date >= today
}

// Day shown first: the earliest open day, else today's, else the next, else the last.
export function defaultFestDay(days, openDays, today) {
  return openDays[0]
    || days.find(d => d.race_date === today)
    || days.find(d => d.race_date >= today)
    || days[days.length - 1]
    || null
}

// A pick counts only while the horse is still running.
// Runners in price order: the favourite first, then up through the odds. Runners with no
// price yet come after the priced ones, withdrawn runners last. Ties keep the card (cloth) number order.
// Display only: it returns a new array and never changes the data.
export function sortByPrice(runners) {
  const rank = r => (r.is_withdrawn ? 2 : r.odds_decimal > 0 ? 0 : 1)
  const num = r => (r.horse_number == null ? Infinity : r.horse_number)
  return [...(runners || [])].sort((a, b) =>
    rank(a) - rank(b)
    || (rank(a) === 0 ? a.odds_decimal - b.odds_decimal : 0)
    || num(a) - num(b))
}

export function hasLivePick(runnerId, raceRunners) {
  if (!runnerId) return false
  return !raceRunners.find(r => r.id === runnerId)?.is_withdrawn
}

// Index of the first race still needing a pick, or the first race if all are done.
export function firstUnpickedIndex(races, isPicked) {
  const i = races.findIndex(r => !isPicked(r.id))
  return i === -1 ? 0 : i
}

// "Aintree", "Aintree & Ascot" or "3 courses" for a set of races ('' when none has a course).
export function courseLabel(races) {
  const courses = []
  for (const r of races || []) {
    const v = (r.venue || '').trim()
    if (v && !courses.includes(v)) courses.push(v)
  }
  if (courses.length === 0) return ''
  if (courses.length === 1) return courses[0]
  if (courses.length === 2) return `${courses[0]} & ${courses[1]}`
  return `${courses.length} courses`
}

// "Sat 7 Nov"
export function shortDay(dateStr) {
  if (!dateStr) return ''
  return `${weekdayShort(dateStr)} ${Number(dateStr.slice(8, 10))} ${monthAbbr(dateStr)}`
}

// The line under the Picks title:
//   Saturday  "Week 1 · Sat 7 Nov · Aintree"
//   Festival  "Day 1 of 3 · Fri 13 Nov · Cheltenham"
// Parts that aren't known are left out; '' when there is nothing to say.
export function competitionLine({ festival, week, day, dayCount, races, festivalVenue }) {
  const parts = festival
    ? [
        day?.day_number ? (dayCount ? `Day ${day.day_number} of ${dayCount}` : `Day ${day.day_number}`) : '',
        shortDay(day?.race_date),
        courseLabel(races) || (festivalVenue || '').trim(),
      ]
    : [
        week?.week_number ? `Week ${week.week_number}` : '',
        shortDay(week?.saturday_date),
        courseLabel(races),
      ]
  return parts.filter(Boolean).join(' · ')
}

// "13–15 Nov" (one month) or "30 Oct – 2 Nov" (across two). '' without a start date.
export function festivalDates(start, end) {
  if (!start) return ''
  if (!end || end === start) return `${Number(start.slice(8, 10))} ${monthAbbr(start)}`
  if (monthAbbr(start) === monthAbbr(end)) return `${Number(start.slice(8, 10))}–${Number(end.slice(8, 10))} ${monthAbbr(end)}`
  return `${Number(start.slice(8, 10))} ${monthAbbr(start)} – ${Number(end.slice(8, 10))} ${monthAbbr(end)}`
}

// Picks for a day open the evening before: "2026-11-13" -> "Thu evening".
export function eveningBefore(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return `${weekdayShort(d.toISOString().slice(0, 10))} evening`
}

// One festival day in the "nothing to pick yet" card: "Fri 13 Nov · Day 1" and where it stands.
//   open    picks are open now (tappable)
//   locked  picks closed
//   soon    no races yet: picks open the evening before
export function festDayRow(day, { hasRaces, open, today }) {
  const label = `${shortDay(day.race_date)} · Day ${day.day_number}`
  if (open) return { label, state: 'open', text: 'Open now' }
  if (hasRaces || (day.race_date && day.race_date < today)) return { label, state: 'locked', text: 'Locked' }
  return { label, state: 'soon', text: `Opens ${eveningBefore(day.race_date)}` }
}
