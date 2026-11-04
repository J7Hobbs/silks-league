import { ordinal, formatCountdown, deadlineMs } from './format.js'
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
  const place = [fest.venue, `Day ${fest.dayNumber} of ${fest.totalDays}`].filter(Boolean).join(' · ')
  return {
    key: `festival-${f.id}`,
    kind: 'festival',
    state: live ? 'open' : 'closed',
    tag: 'FESTIVAL',
    competition: { type: 'festival', id: f.id },
    deadlineMs: dl,
    context: place,
    title: f.display_name || f.name,
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

  return { cards, liveCount: cards.filter(c => c.state !== 'returns' && c.state !== 'announced').length }
}
