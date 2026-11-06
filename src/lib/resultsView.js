// Pure helpers for the Results page, kept apart from Supabase so they are easy to test.
// Points are never worked out here: they are read straight from scores / festival_scores.
import { getPlaceTerms } from './scoring.js'
import { ordinal, picksRevealed, ukDateStr, daysBetween, weekdayShort, clockText, wednesdayAfter } from './format.js'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-11-07" -> "Sat 7 Nov"
export function shortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// "12:40:00" -> "12:40"
const clock = t => (t || '').slice(0, 5)

const byKey = (rows, key) => {
  const map = {}
  for (const r of rows || []) (map[r[key]] ||= []).push(r)
  return map
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


// ═══ The Results page (one race day at a time) ═══
// buildRaceRows / summarise above are still what Home's Saturday card uses; everything below
// is the Results page's own.

const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Race weeks that have races, as race days: { id, weekNumber, date, deadline, raceIds }.
export function buildWeeks(weeks, races) {
  const racesByWeek = byKey(races, 'race_week_id')
  return weeks
    .filter(w => racesByWeek[w.id]?.length)
    .map(w => ({ id: w.id, weekNumber: w.week_number, date: w.saturday_date, deadline: w.picks_deadline, raceIds: racesByWeek[w.id].map(r => r.id) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Festivals with their days (in order) as race days: { id, dayNumber, date, deadline, raceIds }.
export function buildFestivals(festivals, days, races) {
  const daysByFest = byKey(days, 'festival_id')
  const racesByDay = byKey(races, 'festival_day_id')
  return festivals.map(f => ({
    id: f.id,
    name: f.display_name || f.name,
    venue: f.venue || '',
    startDate: f.start_date || '',
    endDate: f.end_date || f.start_date || '',
    banner: { url: f.banner_url || null, position: f.banner_position || null },
    days: (daysByFest[f.id] || [])
      .slice()
      .sort((a, b) => a.day_number - b.day_number)
      .map(d => ({
        id: d.id,
        dayNumber: d.day_number,
        date: d.race_date || addDays(f.start_date, d.day_number - 1),
        deadline: d.picks_deadline,
        raceIds: (racesByDay[d.id] || []).map(r => r.id),
      })),
  }))
}

// Have this race day's picks locked? (Its stored deadline; noon UK on the day if none is stored.)
export const isLocked = (day, nowMs) => picksRevealed(day.deadline, day.date, nowMs)

const latestLockedDay = (festival, nowMs) => [...festival.days].reverse().find(d => isLocked(d, nowMs)) || null

// What /results shows with no query: the latest Saturday week whose picks have locked, or the
// latest locked day of a festival that is live (or finished within the last 7 days) when that
// day is more recent than the Saturday. null when nothing has locked.
export function defaultView({ weeks, festivals, nowMs }) {
  const today = ukDateStr(nowMs)
  const week = [...weeks].reverse().find(w => isLocked(w, nowMs)) || null
  let best = null
  for (const f of festivals) {
    if (f.endDate && daysBetween(f.endDate, today) > 7) continue
    const day = latestLockedDay(f, nowMs)
    if (day && (!best || day.date > best.day.date)) best = { festival: f, day }
  }
  if (best && (!week || best.day.date > week.date)) return { kind: 'festival', festival: best.festival, dayId: best.day.id }
  return week ? { kind: 'week', week } : null
}

// What to show for the address: ?week=<id> or ?festival=<id> open that competition (once it has
// locked), otherwise the default. { kind: 'week' | 'festival' } or { kind: 'none' }.
export function resolveView({ weeks, festivals, weekParam, festivalParam, nowMs }) {
  if (weekParam) {
    const week = weeks.find(w => w.id === weekParam)
    return week && isLocked(week, nowMs) ? { kind: 'week', week } : { kind: 'none' }
  }
  if (festivalParam) {
    const festival = festivals.find(f => f.id === festivalParam)
    const day = festival ? latestLockedDay(festival, nowMs) : null
    return day ? { kind: 'festival', festival, dayId: day.id } : { kind: 'none' }
  }
  const view = defaultView({ weeks, festivals, nowMs })
  if (!view) return { kind: 'none' }
  return isWaiting(view, nowMs) ? { ...view, waiting: true, next: nextRaceDay({ weeks, festivals, nowMs }) } : view
}

// The default Results view shows the latest locked race day until 23:59 (UK time) on the first
// Wednesday after it; from the next day until the next race day's picks lock, the page shows a
// "new race week coming" state instead. A festival also has to be over (its last day has gone).
export function isWaiting(view, nowMs) {
  const today = ukDateStr(nowMs)
  const lastDate = view.kind === 'week'
    ? view.week.date
    : view.festival.days.find(d => d.id === view.dayId)?.date
  if (!lastDate || today <= wednesdayAfter(lastDate)) return false
  return view.kind === 'week' || !view.festival.endDate || today > view.festival.endDate
}

// The next race day to come (the earliest one whose picks haven't locked) that already has
// races loaded, which means its picks are open. { kind, id, date } or null.
export function nextRaceDay({ weeks, festivals, nowMs }) {
  const days = [
    ...weeks.map(w => ({ kind: 'week', id: w.id, day: w })),
    ...festivals.flatMap(f => f.days.map(d => ({ kind: 'festival', id: f.id, day: d }))),
  ].filter(x => x.day.raceIds.length && !isLocked(x.day, nowMs))
  days.sort((a, b) => a.day.date.localeCompare(b.day.date))
  return days[0] ? { kind: days[0].kind, id: days[0].id, date: days[0].day.date } : null
}

// "Tue", "Wed"... one per festival day. Days that haven't locked can't be opened.
export function dayTabs(festival, nowMs) {
  return festival.days.map(d => ({ id: d.id, label: weekdayShort(d.date), locked: isLocked(d, nowMs) }))
}

// "Your day at Ascot", or "Your Saturday" when the races are at more than one course.
export function saturdayLabel(races) {
  const venues = [...new Set((races || []).map(r => (r.venue || '').trim()).filter(Boolean))]
  return venues.length === 1 ? `Your day at ${venues[0]}` : 'Your Saturday'
}

// The reason a pick that finished 2nd to 4th (the positions that can pay) scored 0, or ''.
function zeroNote(betType, position, runnerCount) {
  if (!(position >= 2 && position <= 4)) return ''
  if (betType === 'win') return 'Win-only pick, so no place points.'
  if (betType === 'each_way') {
    const { placesPaid } = getPlaceTerms(runnerCount)
    if (placesPaid > 0 && position > placesPaid) return `Only the top ${placesPaid} paid in this race.`
  }
  return ''
}

// One entry per race for the Results cards. Inputs are the rows read from Supabase (see
// resultsData.js). Points and positions are read as stored; nothing is worked out here.
export function buildResultRows({ races, results, picks, runners, scores }) {
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

    const p = pickByRace[race.id]
    const runner = p ? runnerById[p.runner_id] : null
    const score = scoreByRace[race.id] || null
    const pick = p ? {
      name: runner?.horse_name || '—',
      silk: runner ? { silk_colour: runner.silk_colour, silk_colour_secondary: runner.silk_colour_secondary, silk_pattern: runner.silk_pattern } : null,
      price: runner?.odds_fractional || '',
      betType: score?.bet_type || p.bet_type || null,
      replaced: !!p.was_replaced,
      withdrawn: !p.was_replaced && !!runner?.is_withdrawn,
    } : null

    const played = !pending && !!pick
    // The finishing position as stored with the score, or found in the placings; null when the
    // horse finished outside the positions we have results for.
    const placing = pick ? placings.find(pl => sameHorse(pl.name, pick.name)) : null
    const position = played ? score?.position_achieved || placing?.position || null : null
    const points = played ? score?.total_points ?? 0 : 0
    return {
      id: race.id,
      raceNo: race.race_number,
      time: clockText(race.race_time),
      pending,
      placings: placings.map(pl => ({ ...pl, mine: !!pick && sameHorse(pl.name, pick.name) })),
      pick,
      played,
      position,
      points,
      // Colour of the score box follows the points: green for a win that scored, gold for any
      // other score, grey for none.
      tone: played && points > 0 ? (position === 1 ? 'win' : 'placed') : 'none',
      // Top line of the score box: the finishing position ("2ND"), "UNPL" when the horse finished
      // outside the positions we have, "—" with no pick or result.
      scoreTop: played ? (position ? ordinal(position).toUpperCase() : 'UNPL') : '—',
      // Why a pick that finished 2nd to 4th scored nothing ('' when there is nothing to explain).
      note: played && points === 0 ? zeroNote(pick.betType, position, race.runner_count_at_lock) : '',
    }
  })
}

// The three boxes and the points for the day. Only races with a pick and a result count:
// won = finished 1st and scored, placed = scored without winning, no points = scored 0.
export function outcomeCounts(rows) {
  let points = 0, won = 0, placed = 0, unplaced = 0
  for (const r of rows) {
    if (!r.played) continue
    points += r.points
    if (r.points > 0) { if (r.position === 1) won++; else placed++ }
    else unplaced++
  }
  return { points, won, placed, unplaced, played: rows.some(r => r.pick) }
}
