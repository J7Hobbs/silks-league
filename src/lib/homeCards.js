import { ordinal, formatCountdown, deadlineMs, ukDateStr } from './format.js'
import { saturdayCard } from './saturdayCard.js'

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
    button: live
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

  // A running festival stays on top; once it has finished, the Saturday League card goes first.
  const fest = cards.find(c => c.kind === 'festival')
  if (fest?.phase === 'running') cards.sort((a, b) => (b === fest) - (a === fest))
  else if (fest?.phase === 'finished') cards.sort((a, b) => (a === fest) - (b === fest))

  return { cards, liveCount: cards.filter(c => c.state !== 'returns' && c.state !== 'announced').length }
}
