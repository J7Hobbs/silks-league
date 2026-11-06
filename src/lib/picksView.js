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
function shortDay(dateStr) {
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
