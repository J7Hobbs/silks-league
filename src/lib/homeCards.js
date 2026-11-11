import { ordinal, formatCountdown, deadlineMs, ukDateStr } from './format.js'
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
// is showing) the week after it. Null when there isn't one yet.
function nextSaturday(sat) {
  if (!sat) return null
  if (sat.state === 'lastWeek') return sat.nextWeek || null
  if (sat.state === 'open' || sat.state === 'closed' || sat.state === 'announced') return sat.week || null
  return null
}

// A festival week: a festival whose racing days fall in the same Monday-to-Sunday week as that Saturday (its Saturday is linked
// to one of the festival's days, or the festival runs over that weekend, or simply races earlier that week). The festival card
// stays on top for that whole week, from the moment it is on Home until the festival finishes.
export function festivalWeek(data) {
  const f = data.festival?.festival
  const week = nextSaturday(data.saturday)
  if (!f || !week?.saturday_date) return false
  if (week.festival_day_id && (data.festival.dayIds || []).includes(week.festival_day_id)) return true
  const sat = dateMs(week.saturday_date)
  const monday = sat - ((new Date(sat).getUTCDay() + 6) % 7) * DAY_MS
  const sunday = monday + 6 * DAY_MS
  const start = f.start_date
  const end = f.end_date || f.start_date
  return start <= dateStr(sunday) && end >= dateStr(monday)
}

export function buildCards(data, nowMs) {
  const cards = []
  if (data.festival) cards.push(festivalCard(data.festival, nowMs))
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
  else if (fest?.phase === 'running' || festivalWeek(data)) cards.sort((a, b) => (b === fest) - (a === fest))

  return { cards, liveCount: cards.filter(c => c.state !== 'returns' && c.state !== 'announced').length }
}
