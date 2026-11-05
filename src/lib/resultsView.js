// Pure helpers for the Results page, kept apart from Supabase so they are easy to test.
// Points are never worked out here: they are read straight from scores / festival_scores.
import { ordinal } from './format.js'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-11-07" -> "Sat 7 Nov"
export function shortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function weekLabel(week) {
  return `Week ${week.week_number} · ${shortDate(week.saturday_date)}`
}

export function dayLabel(day) {
  return day.race_date ? `Day ${day.day_number} · ${shortDate(day.race_date)}` : `Day ${day.day_number}`
}

// "12:40:00" -> "12:40"
const clock = t => (t || '').slice(0, 5)

const byKey = (rows, key) => {
  const map = {}
  for (const r of rows || []) (map[r[key]] ||= []).push(r)
  return map
}

// ── Periods (what the arrows step through) ──────────────────────

// Race weeks that have races, oldest first. `won` is the set of race ids with a result.
export function weekPeriods(weeks, races, won) {
  const racesByWeek = byKey(races, 'race_week_id')
  return [...weeks]
    .sort((a, b) => a.saturday_date.localeCompare(b.saturday_date))
    .filter(w => racesByWeek[w.id]?.length)
    .map(w => {
      const raceIds = racesByWeek[w.id].map(r => r.id)
      return { id: w.id, label: weekLabel(w), raceIds, hasResult: raceIds.some(id => won.has(id)) }
    })
}

// Every festival with its days as periods (day order). `hasResults` is true if any day has one.
export function festivalList(festivals, days, races, won) {
  const daysByFest = byKey(days, 'festival_id')
  const racesByDay = byKey(races, 'festival_day_id')
  return festivals.map(f => {
    const periods = (daysByFest[f.id] || [])
      .slice()
      .sort((a, b) => a.day_number - b.day_number)
      .map(d => {
        const raceIds = (racesByDay[d.id] || []).map(r => r.id)
        return { id: d.id, label: dayLabel(d), raceIds, hasResult: raceIds.some(id => won.has(id)) }
      })
    return {
      id: f.id,
      name: f.display_name || f.name,
      venue: f.venue || '',
      startDate: f.start_date || '',
      periods,
      hasResults: periods.some(p => p.hasResult),
    }
  })
}

// Index of the period to open on: the latest one with a result, or -1 when none has.
export function defaultPeriodIndex(periods) {
  for (let i = periods.length - 1; i >= 0; i--) if (periods[i].hasResult) return i
  return -1
}

// ── Competition pills ───────────────────────────────────────────

// Saturday League, then festivals with results (most recent first). A festival opened by
// its link is included even with no results, so the link still lands on it.
export function pillItems(festivals, linkedId) {
  const shown = festivals
    .filter(f => f.hasResults || f.id === linkedId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
  return [{ key: 'saturday', label: 'Saturday League' }, ...shown.map(f => ({ key: f.id, label: f.name }))]
}

// Pill to show as selected. A group, or a festival that is not in the pills, shows Saturday.
export function activePillKey(competition, linkedId, items) {
  const id = linkedId || (competition?.type === 'festival' ? competition.id : null)
  return id && items.some(i => i.key === id) ? id : 'saturday'
}

// ── Race cards ──────────────────────────────────────────────────

const sameHorse = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

// One entry per race. Inputs are the plain rows read from Supabase:
//   races    [{ id, race_number, race_time, venue, race_name }]
//   results  [{ race_id, position, horse_name, starting_price_display }]
//   picks    [{ race_id, runner_id, was_replaced }]
//   runners  [{ id, horse_name, silk_colour, silk_colour_secondary, silk_pattern, is_withdrawn }]
//   scores   [{ race_id, total_points, position_achieved, bet_type, place_token_points }]
export function buildRaceRows({ races, results, picks, runners, scores }, venueFallback = '') {
  const resultsByRace = byKey(results, 'race_id')
  const pickByRace = Object.fromEntries((picks || []).map(p => [p.race_id, p]))
  const runnerById = Object.fromEntries((runners || []).map(r => [r.id, r]))
  const scoreByRace = Object.fromEntries((scores || []).map(s => [s.race_id, s]))

  return [...races].sort((a, b) => a.race_number - b.race_number).map(race => {
    const placings = (resultsByRace[race.id] || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(r => ({ position: r.position, name: r.horse_name, sp: r.starting_price_display || '' }))
    const pending = placings.length === 0
    const winner = placings[0] ? { name: placings[0].name, sp: placings[0].sp } : null

    const p = pickByRace[race.id]
    const runner = p ? runnerById[p.runner_id] : null
    const pick = p ? {
      name: runner?.horse_name || '—',
      silk: runner ? { silk_colour: runner.silk_colour, silk_colour_secondary: runner.silk_colour_secondary, silk_pattern: runner.silk_pattern } : null,
      replaced: !!p.was_replaced,
      withdrawn: !p.was_replaced && !!runner?.is_withdrawn,
    } : null

    const score = scoreByRace[race.id] || null
    const played = !pending && !!pick
    const position = played ? score?.position_achieved || null : null
    const points = played ? score?.total_points ?? 0 : 0

    return {
      id: race.id,
      where: [clock(race.race_time), race.venue || venueFallback].filter(Boolean).join(' '),
      title: race.race_name || '',
      pending,
      winner,
      placings: placings.map(pl => ({ ...pl, mine: !!pick && sameHorse(pl.name, pick.name) })),
      pick,
      // Position badge: 1st-4th as stored, otherwise unplaced. Nothing when there is no pick.
      badge: played ? (position >= 1 && position <= 4 ? ordinal(position) : 'Unpl') : null,
      position,
      eachWay: played && score?.bet_type === 'each_way',
      placePoints: played ? score?.place_token_points || 0 : 0,
      points,
      // Colour of the points pill: green for a win, gold for any other score, grey for none.
      tone: points > 0 ? (position === 1 ? 'win' : 'placed') : 'none',
    }
  })
}

// Totals for the player over one period. Placed = 2nd or 3rd, or 4th where a place was paid.
export function summarise(rows) {
  let points = 0, winners = 0, placed = 0
  for (const r of rows) {
    points += r.points
    if (r.position === 1) winners++
    else if (r.position === 2 || r.position === 3 || (r.position === 4 && r.placePoints > 0)) placed++
  }
  return { points, winners, placed, played: rows.some(r => r.pick) }
}
