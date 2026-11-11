import { ordinal, formatCountdown, deadlineMs, ukDateStr, ukWallToMs } from './format.js'
import { daysLabel, dayCount } from './festivalView.js'
import { saturdayCard } from './saturdayCard.js'
import { finalPath } from './finalTable.js'

const DAY_MS = 86400000
const dateMs = d => Date.parse(`${d}T00:00:00Z`)
const dateStr = ms => new Date(ms).toISOString().slice(0, 10)

// Turns the loaded Home data into the competition cards to show, in order.
// Pure: pass in `nowMs` so the countdowns tick without re-querying.

function pickLabel(picked, total) {
  if (total > 0 && picked >= total) return 'Picks done ✓ – edit'
  if (picked > 0) return 'Finish your picks'
  return "Make today's picks"
}

const rankText = r => (r ? ordinal(r.rank) : '—')

function festivalCard(fest, nowMs) {
  const f = fest.festival
  const dl = deadlineMs(fest.deadline)
  const live = fest.state === 'open' && dl > nowMs
  // running: today is within its dates; finished: its last day has passed (the 7 days it stays on Home)
  const today = ukDateStr(nowMs)
  const phase = today > (f.end_date || f.start_date) ? 'finished' : today >= f.start_date ? 'running' : 'upcoming'
  const place = [fest.venue, `Day ${fest.dayNumber} of ${fest.totalDays}`].filter(Boolean).join(' · ')
  return {
    key: `festival-${f.id}`,
    kind: 'festival',
    phase,
    state: live ? 'open' : 'closed',
    tag: 'FESTIVAL',
    competition: { type: 'festival', id: f.id },
    deadlineMs: dl,
    context: place,
    title: f.display_name || f.name,
    line: fest.alsoSaturday ? 'Also counts for your Saturday League' : null,
    image: { url: f.banner_url || null, position: f.banner_position || null },
    tiles: [
      { label: 'Closes in', value: formatCountdown(dl - nowMs), accent: live },
      { label: 'Your picks', value: `${fest.picked}/${fest.total}` },
      { label: 'Position', value: rankText(fest.rank) },
    ],
    // Once the festival's last race is in, the card goes to its Final page (this card is only ever the latest festival).
    button: fest.final
      ? { label: 'Final table', outline: true, action: { to: finalPath(f.id) } }
      : live
        ? { label: pickLabel(fest.picked, fest.total), action: { to: '/picks', state: { festivalTab: f.id } } }
        : { label: 'View results', outline: true, action: { to: `/results/festival/${f.id}` } },
  }
}

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

// The festival's card before its racecard is in: same card, "racecard out soon", counting down to Day 1.
function festivalSoonCard(soon, nowMs) {
  const f = soon.festival
  const dayOne = soon.days.find(d => d.day_number === 1) || soon.days[0]
  const startMs = ukWallToMs(dayOne?.race_date || f.start_date, '00:00')
  const total = soon.days.length || dayCount(f)
  const linked = soon.days.some(d => d.id === soon.linkedDayId)
  return {
    key: `festival-${f.id}`,
    kind: 'festival',
    phase: 'upcoming',
    state: 'announced',   // not live yet: not counted in "Live now", and the button stays the quiet outline
    tag: 'FESTIVAL',
    competition: { type: 'festival', id: f.id },
    deadlineMs: startMs,
    context: [f.venue, daysLabel(total)].filter(Boolean).join(' · '),
    title: f.display_name || f.name,
    line: linked ? "Racecard out soon · also counts for your Saturday League" : "Racecard out soon · picks open once it's in",
    image: { url: f.banner_url || null, position: f.banner_position || null },
    tiles: [
      { label: 'Day 1 in', value: formatCountdown(startMs - nowMs), accent: true },
      { label: 'Racecard', value: 'Out soon' },
      { label: 'Days', value: String(total) },
    ],
    button: { label: 'Festival details', outline: true, action: { to: '/festivals' } },
  }
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
