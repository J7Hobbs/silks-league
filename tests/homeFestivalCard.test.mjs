// The festival card on Home (design C): pill, big figure, a tile per festival day, today's picks as silks.
// Cheltenham, November 2026: Fri 13 - Sun 15, six races a day. (November: UK time = UTC.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/viteResolve.mjs', import.meta.url)
const { buildCards } = await import('../src/lib/homeCards.js')

const at = (date, time) => Date.parse(`${date}T${time}:00Z`)
const CHELT = { id: 'f1', name: 'The November Meeting', display_name: 'The November Meeting', venue: 'Cheltenham', start_date: '2026-11-13', end_date: '2026-11-15', banner_url: 'x.jpg', banner_position: null }
const TIMES = ['13:20', '13:55', '14:20', '14:55', '15:30', '16:05']
const dayOf = (n, withRaces = true) => ({
  id: `d${n}`, number: n, date: `2026-11-${12 + n}`, deadline: `2026-11-${12 + n}T12:40:00Z`,
  races: withRaces ? TIMES.map((time, i) => ({ id: `d${n}r${i + 1}`, number: i + 1, time, abandoned: false })) : [],
})
const DAYS = [dayOf(1), dayOf(2, false), dayOf(3, false)]
const RUNNERS = Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [`h${i}`, { id: `h${i}`, horse_name: `Horse ${i}`, silk_colour: '#116611', silk_colour_secondary: '#ffffff', silk_pattern: 'hoops' }]))
const pick = (n, i, banker = false) => ({ raceId: `d${n}r${i}`, runnerId: `h${i}`, banker })

function fest(over = {}) {
  return {
    state: 'open', festival: CHELT, dayNumber: 1, totalDays: 3, total: 6, picked: 0, deadline: '2026-11-13T12:40:00Z',
    rank: null, resultsIn: false, alsoSaturday: false, dayIds: ['d1', 'd2', 'd3'], final: false, venue: 'Cheltenham',
    focusDayId: 'd1', days: DAYS, picks: [], results: [], scores: [], runners: RUNNERS, ...over,
  }
}
const card = (f, now) => buildCards({ festival: f, saturday: null }, now).cards[0]

test('racecard not in: pill, countdown to Day 1, a tile per day that all say when they open, and no silks row', () => {
  const soon = { festival: CHELT, days: [1, 2, 3].map(n => ({ id: `d${n}`, festival_id: 'f1', day_number: n, race_date: `2026-11-${12 + n}` })), linkedDayId: null }
  const c = buildCards({ festival: null, festivalSoon: soon, saturday: null }, at('2026-11-11', '09:00')).cards[0]
  assert.equal(c.pill.text, 'Racecard out soon')
  assert.deepEqual(c.figure, { value: '2 days', sub: 'Racecard out soon' })
  assert.deepEqual(c.days.map(d => [d.weekday, d.date, d.line]), [['FRI', 13, 'Opens Thu'], ['SAT', 14, 'Opens Fri'], ['SUN', 15, 'Opens Sat']])
  assert.equal(c.silks, null, 'hidden until picks are open')
  assert.equal(c.context, 'Cheltenham · 3 days')
  assert.equal(c.days.every(d => d.action === null), true, 'nothing to open yet')
})

test('picks open, none picked: countdown, Today gold, "Pick now", six empty silks', () => {
  const c = card(fest(), at('2026-11-13', '08:00'))
  assert.equal(c.pill.text, 'Picks open')
  assert.equal(c.context, 'Cheltenham · Day 1 of 3')
  assert.deepEqual(c.figure, { value: '4h 40m', sub: 'until picks close · 12:40 Fri' })
  assert.deepEqual(c.days.map(d => [d.kind, d.line]), [['today', 'Pick now'], ['future', 'Opens Fri'], ['future', 'Opens Sat']])
  assert.equal(c.silks.items.length, 6)
  assert.equal(c.silks.items.every(s => s.status === 'empty'), true)
  assert.deepEqual(c.silks.items.map(s => s.label), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'])
  assert.equal(c.button.label, "Make today's picks")
  assert.equal(c.state, 'open')
})

test('picks open, some picked: "2/6 picked", the picks in their races, the banker marked, empty tiles for the rest', () => {
  const c = card(fest({ picked: 2, picks: [pick(1, 1), pick(1, 3, true)] }), at('2026-11-13', '08:00'))
  assert.equal(c.days[0].line, '2/6 picked')
  assert.deepEqual(c.silks.items.map(s => s.status), ['pending', 'empty', 'pending', 'empty', 'empty', 'empty'])
  assert.deepEqual(c.silks.items.map(s => s.banker), [false, false, true, false, false, false])
  assert.equal(c.silks.items[2].runner.horse_name, 'Horse 3', 'the silk is the picked runner\'s')
  assert.equal(c.button.label, 'Finish your picks')
  assert.deepEqual(c.silks.action, { to: '/picks', state: { festivalTab: 'f1' } })
})

test('picks open, all picked: "6/6 picked" and "Picks done ✓ – edit"; the countdown still shows', () => {
  const picks = [1, 2, 3, 4, 5, 6].map(i => pick(1, i, i === 3))
  const c = card(fest({ picked: 6, picks }), at('2026-11-12', '20:00'))
  assert.equal(c.days[0].line, '6/6 picked')
  assert.equal(c.silks.items.every(s => s.status === 'pending'), true)
  assert.equal(c.silks.items.filter(s => s.banker).length, 1)
  assert.equal(c.button.label, 'Picks done ✓ – edit')
  assert.equal(c.figure.value, '16h 40m')
  assert.equal(c.days[0].action.to, '/picks')
})

test('racing mid-day: next race time, "Race 3 next · 2 of 6 run", the won and placed silks marked, no position yet', () => {
  const picks = [1, 2, 3, 4, 5, 6].map(i => pick(1, i, i === 1))
  const results = ['d1r1', 'd1r2']
  const scores = [{ raceId: 'd1r1', points: 40, position: 1 }, { raceId: 'd1r2', points: 12, position: 3 }]
  const c = card(fest({ state: 'closed', picked: 6, picks, results, scores, resultsIn: true, rank: { rank: 1 } }), at('2026-11-13', '14:00'))
  assert.equal(c.pill.text, 'Racing now')
  assert.deepEqual(c.figure, { value: '14:20', sub: 'Race 3 next · 2 of 6 run' })
  const [r1, r2, r3] = c.silks.items
  assert.deepEqual([r1.status, r1.tag, r1.banker], ['won', 'WON', true])
  assert.deepEqual([r2.status, r2.tag], ['placed', '3rd'])
  assert.equal(r3.status, 'pending')
  assert.equal(c.days[0].line, '6/6 picked')
  assert.equal(c.button.label, 'View results')
  assert.equal(c.state, 'closed')
  assert.doesNotMatch(JSON.stringify(c.figure), /you're/, 'no position while racing')
})

test('racing: a pick that lost is dimmed, and a race with no stored score yet is left as it was', () => {
  const picks = [1, 2, 3].map(i => pick(1, i))
  const c = card(fest({ state: 'closed', picked: 3, picks, results: ['d1r1', 'd1r2'], scores: [{ raceId: 'd1r1', points: 0, position: 5 }] }), at('2026-11-13', '14:00'))
  assert.equal(c.silks.items[0].status, 'unplaced')
  assert.equal(c.silks.items[1].status, 'pending', 'result in, score not yet')
})

test('picks closed, first race not yet off: "Picks closed", Race 1 next, "No picks" for a player who did not play', () => {
  const c = card(fest({ state: 'closed' }), at('2026-11-13', '13:00'))
  assert.equal(c.pill.text, 'Picks closed')
  assert.deepEqual(c.figure, { value: '13:20', sub: 'Race 1 next · 0 of 6 run' })
  assert.equal(c.days[0].line, 'No picks')
})

test('day finished: points, "Day 1 · you\'re 3rd", Results in, the day tile shows the points, the silks show how each went', () => {
  const picks = [1, 2, 3, 4, 5, 6].map(i => pick(1, i))
  const results = DAYS[0].races.map(r => r.id)
  const scores = [40, 0, 12, 90, 0, 0].map((points, i) => ({ raceId: `d1r${i + 1}`, points, position: points === 40 || points === 90 ? 1 : points ? 2 : 6 }))
  const c = card(fest({ state: 'closed', picked: 6, picks, results, scores, resultsIn: true, rank: { rank: 3 } }), at('2026-11-13', '19:00'))
  assert.equal(c.pill.text, 'Results in')
  assert.deepEqual(c.figure, { value: '+142 pts', sub: "Day 1 · you're 3rd" })
  assert.deepEqual(c.days.map(d => [d.kind, d.line]), [['today', '+142'], ['future', 'Opens Fri'], ['future', 'Opens Sat']])
  assert.equal(c.days[0].action.to, '/results/festival/f1')
  assert.deepEqual(c.silks.items.map(s => s.status), ['won', 'unplaced', 'placed', 'won', 'unplaced', 'unplaced'])
  assert.equal(c.silks.items[2].tag, '2nd')
  assert.equal(c.button.label, 'View results')
})

test('day finished, player did not play: "Day 1 done" and no position', () => {
  const results = DAYS[0].races.map(r => r.id)
  const c = card(fest({ state: 'closed', results, resultsIn: true, rank: null }), at('2026-11-13', '19:00'))
  assert.deepEqual(c.figure, { value: '0 pts', sub: 'Day 1 done' })
  assert.equal(c.days[0].line, '–')
  assert.equal(c.silks.items.every(s => s.status === 'empty'), true)
})

test('last day finished: the earlier days show their points, the Final table button, "you\'re 1st overall"', () => {
  const days = [dayOf(1), dayOf(2), dayOf(3)]
  const all = days.flatMap(d => d.races)
  const picks = all.map(r => ({ raceId: r.id, runnerId: 'h1', banker: false }))
  const scores = all.map((r, i) => ({ raceId: r.id, points: r.id.startsWith('d1') ? 10 : r.id.startsWith('d2') ? 20 : 30, position: i % 2 ? 2 : 1 }))
  const c = card(fest({ state: 'closed', dayNumber: 3, focusDayId: 'd3', days, picks, results: all.map(r => r.id), scores, resultsIn: true, rank: { rank: 1 }, final: true, picked: 6 }), at('2026-11-15', '19:00'))
  assert.equal(c.phase, 'running')
  assert.equal(c.pill.text, 'Results in')
  assert.deepEqual(c.figure, { value: '+180 pts', sub: "Day 3 · you're 1st overall" })
  assert.deepEqual(c.days.map(d => [d.kind, d.line]), [['done', '+60'], ['done', '+120'], ['today', '+180']])
  assert.equal(c.button.label, 'Final table')
  // The week after, still on Home: finished, Saturday League first
  const later = card(fest({ state: 'closed', dayNumber: 3, focusDayId: 'd3', days, picks, results: all.map(r => r.id), scores, resultsIn: true, rank: { rank: 1 }, final: true }), at('2026-11-18', '10:00'))
  assert.equal(later.phase, 'finished')
  assert.equal(later.pill.text, 'Results in')
})

test('the position is never shown before a result is in (everyone is level on 0)', () => {
  const noResults = card(fest({ state: 'closed', rank: { rank: 1 }, resultsIn: false, days: [{ ...dayOf(1), date: '2026-11-12' }] }), at('2026-11-13', '19:00'))
  assert.equal(noResults.pill.text, 'Results in', 'the day has passed')
  assert.doesNotMatch(noResults.figure.sub, /you're/)
  for (const c of [card(fest(), at('2026-11-13', '08:00')), card(fest({ state: 'closed' }), at('2026-11-13', '14:00'))]) {
    assert.doesNotMatch(JSON.stringify([c.figure, c.days, c.pill]), /1st|2nd|3rd|Position/i)
  }
})

test('day tiles: a later day that already has its racecard shows its own picks line, not "Opens"', () => {
  const days = [dayOf(1), { ...dayOf(2), deadline: '2026-11-14T12:40:00Z' }, dayOf(3, false)]
  const c = card(fest({ days, picks: [pick(2, 1)] }), at('2026-11-13', '08:00'))
  assert.deepEqual(c.days.map(d => d.line), ['Pick now', '1/6 picked', 'Opens Sat'])
  assert.equal(c.days[1].kind, 'future')
  assert.equal(c.days[2].action, null)
})

test('seven races on one day: seven silks in the one row', () => {
  const races = Array.from({ length: 7 }, (_, i) => ({ id: `d1r${i + 1}`, number: i + 1, time: '13:20', abandoned: false }))
  const c = card(fest({ days: [{ ...DAYS[0], races }, DAYS[1], DAYS[2]], total: 7 }), at('2026-11-13', '08:00'))
  assert.equal(c.silks.items.length, 7)
})

test('"Also counts for your Saturday League" is kept as a small note while the day is still to run', () => {
  assert.match(card(fest({ alsoSaturday: true }), at('2026-11-13', '08:00')).note, /Saturday League/)
  assert.equal(card(fest(), at('2026-11-13', '08:00')).note, null)
})
