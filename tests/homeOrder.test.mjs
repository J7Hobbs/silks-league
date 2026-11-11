// Home card order: src/lib/homeCards.js buildCards(). Only the ORDER is under test here, never the cards' contents.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/viteResolve.mjs', import.meta.url)   // lets Node load src/lib the way Vite does
const { buildCards, festivalWeek } = await import('../src/lib/homeCards.js')

const at = (date, time = '09:00:00') => Date.parse(`${date}T${time}Z`)   // UK time = UTC in March
const order = (data, nowMs) => buildCards(data, nowMs).cards.map(c => c.kind)

// A Saturday League week with picks open (deadline given), linked to a festival day when `festivalDayId` is passed.
function saturday(date, { deadline, festivalDayId = null, state = 'open' } = {}) {
  const week = { id: `w-${date}`, saturday_date: date, picks_deadline: deadline || `${date}T11:00:00Z`, festival_day_id: festivalDayId }
  if (state === 'announced') return { state, week, season: { id: 's1', startDate: '2026-03-01' }, table: null, userId: 'me' }
  return {
    state, week, deadline: week.picks_deadline, season: { id: 's1', startDate: '2026-03-01' }, seasonRank: null, userId: 'me', table: null,
    races: [{ id: 'r1', race_week_id: week.id, race_number: 1, race_time: '14:00', venue: 'Ascot', race_name: 'Handicap' }],
    runners: [{ id: 'h1', race_id: 'r1', horse_name: 'Horse', horse_number: 1, odds_decimal: 5, odds_fractional: '4/1', is_withdrawn: false }],
    picks: [], results: [], scores: [],
  }
}

// A festival card's data: dates, the day shown, and the festival's day ids.
function festival(start, end, { deadline, state = 'open', dayIds = ['d1', 'd2', 'd3'], final = false } = {}) {
  return {
    state, festival: { id: 'f1', name: 'Cheltenham', display_name: 'Cheltenham Festival', start_date: start, end_date: end },
    dayNumber: 1, totalDays: dayIds.length, total: 6, picked: 0, deadline: deadline || `${start}T11:00:00Z`,
    rank: null, alsoSaturday: false, dayIds, final, venue: 'Cheltenham',
  }
}

// Cheltenham this week: Fri 13 - Sun 15 March 2026, with Saturday 14 March linked to day 2.
const CHELTENHAM = { start: '2026-03-13', end: '2026-03-15' }

test('Cheltenham week (Fri-Sun, Saturday linked): the festival is on top every day, Monday to Sunday', () => {
  for (const day of ['09', '10', '11', '12', '13', '14', '15']) {
    // The Saturday card is given the EARLIER deadline, so the old deadline order would have put it first before Friday.
    const data = {
      festival: festival(CHELTENHAM.start, CHELTENHAM.end, { deadline: '2026-03-13T11:00:00Z' }),
      saturday: saturday('2026-03-14', { deadline: '2026-03-12T11:00:00Z', festivalDayId: 'd2' }),
    }
    assert.equal(festivalWeek(data), true, `week flag on the ${day}th`)
    assert.deepEqual(order(data, at(`2026-03-${day}`)), ['festival', 'saturday'], `Cheltenham week, ${day} March`)
  }
})

test('festival on top when it runs over the weekend even if the Saturday is not linked to a festival day', () => {
  const data = { festival: festival('2026-03-13', '2026-03-15'), saturday: saturday('2026-03-14', { deadline: '2026-03-12T11:00:00Z' }) }
  assert.equal(festivalWeek(data), true)
  assert.deepEqual(order(data, at('2026-03-11')), ['festival', 'saturday'])
})

test('festival racing earlier in the same week as the next Saturday: on top until it finishes, then Saturday League goes first', () => {
  const mk = () => ({ festival: festival('2026-03-10', '2026-03-13', { deadline: '2026-03-10T11:00:00Z' }), saturday: saturday('2026-03-14', { deadline: '2026-03-09T11:00:00Z' }) })
  for (const day of ['09', '10', '11', '12', '13']) assert.deepEqual(order(mk(), at(`2026-03-${day}`)), ['festival', 'saturday'], `${day} March`)
  // Saturday itself: the festival's last day was yesterday.
  assert.deepEqual(order({ ...mk(), festival: festival('2026-03-10', '2026-03-13', { state: 'closed' }) }, at('2026-03-14')), ['saturday', 'festival'])
})

test('a festival weeks away: Saturday League first (soonest race day first)', () => {
  const data = { festival: festival('2026-03-24', '2026-03-27'), saturday: saturday('2026-03-14') }
  assert.equal(festivalWeek(data), false)
  assert.deepEqual(order(data, at('2026-03-09')), ['saturday', 'festival'])
  assert.deepEqual(order(data, at('2026-03-13')), ['saturday', 'festival'])
})

test('a festival nearer than the Saturday and not in its week: whichever comes first goes on top', () => {
  const data = { festival: festival('2026-03-10', '2026-03-12'), saturday: saturday('2026-03-21') }
  assert.equal(festivalWeek(data), false)
  assert.deepEqual(order(data, at('2026-03-09')), ['festival', 'saturday'])
})

test('a finished festival: Saturday League first, including on the festival\'s own weekend once it is over', () => {
  const finished = festival(CHELTENHAM.start, CHELTENHAM.end, { state: 'closed', final: true })
  for (const day of ['16', '17', '20']) {
    const data = { festival: finished, saturday: saturday('2026-03-21', { deadline: '2026-03-21T11:00:00Z' }) }
    assert.deepEqual(order(data, at(`2026-03-${day}`)), ['saturday', 'festival'], `${day} March`)
  }
  // Even when the Saturday it is heading for is the one linked to the festival, once the festival has finished it goes second.
  const linked = { festival: finished, saturday: saturday('2026-03-14', { festivalDayId: 'd2', state: 'announced' }) }
  assert.deepEqual(order(linked, at('2026-03-16')), ['saturday', 'festival'])
})

test('last week\'s result showing while the festival week is ahead: the festival is on top once the next week is its week', () => {
  const lastWeek = {
    ...saturday('2026-03-07', { state: 'open' }), state: 'lastWeek', deadline: '2026-03-07T11:00:00Z',
    nextWeek: { id: 'w-2026-03-14', saturday_date: '2026-03-14', festival_day_id: 'd2' },
  }
  const data = { festival: festival(CHELTENHAM.start, CHELTENHAM.end), saturday: lastWeek }
  assert.equal(festivalWeek(data), true)
  assert.deepEqual(order(data, at('2026-03-10')), ['festival', 'saturday'])
})

test('"announced" and "returns soon" cards stay last', () => {
  const announced = { festival: festival('2026-03-24', '2026-03-27'), saturday: saturday('2026-03-14', { state: 'announced' }) }
  assert.deepEqual(order(announced, at('2026-03-09')), ['festival', 'saturday'])
  const returns = { festival: festival('2026-03-24', '2026-03-27'), saturday: { state: 'returns', season: { id: 's1', startDate: '2026-03-01' }, seasonPos: null, table: null, userId: 'me' } }
  assert.deepEqual(order(returns, at('2026-03-09')), ['festival', 'saturday'])
})

test('only the order changes: the same cards come back with the same content', () => {
  const data = { festival: festival(CHELTENHAM.start, CHELTENHAM.end), saturday: saturday('2026-03-14', { festivalDayId: 'd2' }) }
  const { cards, liveCount } = buildCards(data, at('2026-03-10'))
  assert.deepEqual(cards.map(c => c.key).sort(), ['festival-f1', 'saturday'])
  assert.equal(liveCount, 2)
  assert.equal(cards.find(c => c.kind === 'festival').title, 'Cheltenham Festival')
})

test('with only one card, nothing changes', () => {
  assert.deepEqual(order({ festival: festival(CHELTENHAM.start, CHELTENHAM.end), saturday: null }, at('2026-03-10')), ['festival'])
  assert.deepEqual(order({ festival: null, saturday: saturday('2026-03-14') }, at('2026-03-10')), ['saturday'])
})
