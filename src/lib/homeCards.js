import { ukDateStr } from './format.js'
import { saturdayCard } from './saturdayCard.js'
import { festivalCard, festivalSoonCard } from './festivalCard.js'

export { soonCountdown } from './festivalCard.js'

const DAY_MS = 86400000
const dateMs = d => Date.parse(`${d}T00:00:00Z`)
const dateStr = ms => new Date(ms).toISOString().slice(0, 10)

// Turns the loaded Home data into the competition cards to show, in order.
// Pure: pass in `nowMs` so the countdowns tick without re-querying.

// Open cards first (soonest deadline, festival first on a tie), then cards whose
// picks aren't open (festival first), then "returns soon".
function sortOrder(card) {
  if (card.state === 'open') return 0
  if (card.state === 'returns' || card.state === 'announced') return 2
  return 1
}

// The Saturday the Saturday League is heading for: the open or race-day week, an announced week, or (while last week's result
// is showing) the week after it. When the Saturday League has no week to show (nothing announced, or its week is a festival day
// whose own card covers it) it is simply the next Saturday on the calendar. -> { saturday_date, festival_day_id }
function nextSaturday(sat, nowMs) {
  const week = !sat ? null
    : sat.state === 'lastWeek' ? sat.nextWeek
    : (sat.state === 'open' || sat.state === 'closed' || sat.state === 'announced') ? sat.week
    : null
  if (week?.saturday_date) return week
  const today = ukDateStr(nowMs)
  const dow = new Date(dateMs(today)).getUTCDay()
  return { saturday_date: dateStr(dateMs(today) + ((6 - dow + 7) % 7) * DAY_MS), festival_day_id: null }
}

// A festival week: a festival whose racing days fall in the same Monday-to-Sunday week as that Saturday (its Saturday is linked
// to one of the festival's days, or the festival runs over that weekend, or simply races earlier that week).
// `fest` is { festival, dayIds }. The festival card is on top for that whole week (see buildCards).
function inFestivalWeek(fest, sat, nowMs) {
  const f = fest?.festival
  if (!f) return false
  const week = nextSaturday(sat, nowMs)
  if (week.festival_day_id && (fest.dayIds || []).includes(week.festival_day_id)) return true
  const day = dateMs(week.saturday_date)
  const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS
  const sunday = monday + 6 * DAY_MS
  const start = f.start_date
  const end = f.end_date || f.start_date
  return start <= dateStr(sunday) && end >= dateStr(monday)
}

export function festivalWeek(data, nowMs = Date.now()) {
  return inFestivalWeek(data.festival, data.saturday, nowMs)
}

// The upcoming festival (not yet a card: its picks aren't open) that is racing in the Saturday League's week, or null.
// `up` is loadUpcomingFestivals(): festivals starting after today, earliest first, with the day rows of the first two.
export function pickWeekFestival(up, sat, nowMs) {
  for (const f of up?.list || []) {
    const days = (up.days || []).filter(d => d.festival_id === f.id).sort((a, b) => a.day_number - b.day_number)
    if (inFestivalWeek({ festival: f, dayIds: days.map(d => d.id) }, sat, nowMs)) {
      return { festival: f, days, linkedDayId: nextSaturday(sat, nowMs).festival_day_id || null }
    }
  }
  return null
}

export function buildCards(data, nowMs) {
  const cards = []
  if (data.festival) cards.push(festivalCard(data.festival, nowMs))
  else if (data.festivalSoon) cards.push(festivalSoonCard(data.festivalSoon, nowMs))
  if (data.saturday) cards.push(saturdayCard(data.saturday, nowMs))

  cards.sort((a, b) => {
    const g = sortOrder(a) - sortOrder(b)
    if (g) return g
    if (a.state === 'open' && a.deadlineMs !== b.deadlineMs) return a.deadlineMs - b.deadlineMs
    return (a.kind === 'festival' ? 0 : 1) - (b.kind === 'festival' ? 0 : 1)
  })

  // A festival week keeps the festival on top. See festivalWeek().
  const fest = cards.find(c => c.kind === 'festival')
  if (fest?.phase === 'finished') cards.sort((a, b) => (a === fest) - (b === fest))   // finished: Saturday League first
  else if (fest?.phase === 'running' || (!data.festival && data.festivalSoon) || festivalWeek(data, nowMs)) cards.sort((a, b) => (b === fest) - (a === fest))

  return { cards, liveCount: cards.filter(c => c.state !== 'returns' && c.state !== 'announced').length }
}
