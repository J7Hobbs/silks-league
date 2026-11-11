// Home in a festival week: the festival is a main card from the start of the week (even before its racecard is in), the Saturday
// League card says so when its Saturday is a festival day, and outside festival weeks nothing changes.
// Cheltenham, November 2026: Fri 13 - Sun 15, with Saturday 14 Nov linked to Day 2. (November: UK time = UTC.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/viteResolve.mjs', import.meta.url)
const { buildCards, pickWeekFestival } = await import('../src/lib/homeCards.js')
const { pickNextFestival } = await import('../src/lib/festivalData.js')

const at = (date, time = '09:00:00') => Date.parse(`${date}T${time}Z`)
const SEASON = { id: 's1', startDate: '2026-11-01' }
const TABLE = { rows: [{ id: 'a', rank: 1, name: 'Ann', points: 150, move: 0 }, { id: 'me', rank: 2, name: 'Me', points: 120, move: 1 }] }

const CHELT = { id: 'f1', name: 'Cheltenham', display_name: 'Cheltenham Festival', venue: 'Cheltenham', start_date: '2026-11-13', end_date: '2026-11-15', banner_url: null, banner_position: null }
const DAYS = [1, 2, 3].map(n => ({ id: `d${n}`, festival_id: 'f1', day_number: n, race_date: `2026-11-${12 + n}` }))
const LATER = { id: 'f2', name: 'Aintree', start_date: '2027-04-09', end_date: '2027-04-11', venue: 'Aintree' }
const upcoming = (list = [CHELT, LATER]) => ({ list, days: DAYS, today: '2026-11-11' })

const week = (date, over = {}) => ({ id: `w-${date}`, saturday_date: date, picks_deadline: `${date}T11:00:00Z`, festival_day_id: null, ...over })
const race = (w) => [{ id: `${w.id}-r1`, race_week_id: w.id, race_number: 1, race_time: '14:00', venue: 'Ascot', race_name: 'Handicap' }]
const runner = (w) => [{ id: `${w.id}-h1`, race_id: `${w.id}-r1`, horse_name: 'Horse', horse_number: 1, odds_decimal: 5, odds_fractional: '4/1', is_withdrawn: false }]

// Last Saturday's result is showing (7 Nov), and the next week (14 Nov) is announced with no races yet, linked to Cheltenham Day 2.
function lastWeekWithLinkedNext(linkedDay = { dayNumber: 2, festivalId: 'f1', festivalName: 'Cheltenham' }) {
  const last = week('2026-11-07')
  return {
    state: 'lastWeek', week: last, deadline: last.picks_deadline, season: SEASON, seasonRank: null, userId: 'me', table: TABLE,
    races: race(last), runners: runner(last), picks: [], results: [], scores: [],
    nextWeek: { id: 'w-2026-11-14', saturday_date: '2026-11-14', festival_day_id: 'd2' }, linkedDay,
  }
}
function announced(date, festival_day_id = null, linkedDay = null) {
  return { state: 'announced', week: { id: `w-${date}`, saturday_date: date, festival_day_id }, linkedDay, season: SEASON, table: TABLE, userId: 'me' }
}
function openSaturday(date) {
  const w = week(date)
  return { state: 'open', week: w, deadline: w.picks_deadline, season: SEASON, seasonRank: null, userId: 'me', table: TABLE, races: race(w), runners: runner(w), picks: [], results: [], scores: [] }
}
function festivalCardData({ state = 'open', final = false, dayNumber = 1 } = {}) {
  return { state, festival: CHELT, dayNumber, totalDays: 3, total: 6, picked: 2, deadline: '2026-11-13T11:00:00Z', rank: { rank: 3 }, alsoSaturday: false, dayIds: ['d1', 'd2', 'd3'], final, venue: 'Cheltenham' }
}

const kinds = r => r.cards.map(c => c.kind)
const text = card => JSON.stringify(card).toLowerCase()

test('TODAY (Wed 11 Nov, racecard not in): the festival is the top main card, in a "racecard out soon" state counting down to Day 1', () => {
  const now = at('2026-11-11')
  const saturday = lastWeekWithLinkedNext()
  const festivalSoon = pickWeekFestival(upcoming(), saturday, now)
  assert.equal(festivalSoon.festival.id, 'f1')
  const out = buildCards({ festival: null, festivalSoon, saturday }, now)
  assert.deepEqual(kinds(out), ['festival', 'saturday'])
  const [fest, sat] = out.cards
  assert.equal(fest.tag, 'FESTIVAL')
  assert.equal(fest.title, 'Cheltenham Festival')
  assert.match(fest.line, /Racecard out soon/)
  assert.match(fest.line, /Saturday League/, 'says it also counts for the Saturday League')
  assert.deepEqual(fest.tiles[0], { label: 'Day 1 in', value: '1d 15h', accent: true })
  assert.equal(fest.button.outline, true)
  assert.equal(out.liveCount, 0, 'not counted as live until picks are open')
  // The Saturday card keeps the November table but no longer talks about its own racecard or picks opening.
  assert.equal(sat.table.title, 'NOVEMBER TABLE')
  assert.equal(sat.headline, 'Saturday 14 Nov')
  assert.match(sat.sub, /^is Cheltenham Day 2\. Your Day 2 picks count for the Saturday League$/)
  assert.equal(sat.eyebrow.text, 'FESTIVAL DAY')
  assert.doesNotMatch(text(sat), /racecard out soon|race day announced|picks open/)
  assert.equal(sat.notify, undefined, 'no "get notified when picks open" button')
  assert.deepEqual(sat.button.action, { to: '/picks', state: { festivalTab: 'f1' } })
  assert.deepEqual(sat.competition, { type: 'festival', id: 'f1' })
})

test('the same from Monday (last week\'s result still showing) through Thursday', () => {
  for (const day of ['09', '10', '11', '12']) {
    const now = at(`2026-11-${day}`)
    const saturday = lastWeekWithLinkedNext()
    const out = buildCards({ festival: null, festivalSoon: pickWeekFestival(upcoming(), saturday, now), saturday }, now)
    assert.deepEqual(kinds(out), ['festival', 'saturday'], `${day} Nov`)
    assert.equal(out.cards[0].state, 'announced')
  }
})

test('when the Saturday itself is announced and linked (no last-week card), same result', () => {
  const now = at('2026-11-11')
  const saturday = announced('2026-11-14', 'd2', { dayNumber: 2, festivalId: 'f1', festivalName: 'Cheltenham' })
  const out = buildCards({ festival: null, festivalSoon: pickWeekFestival(upcoming(), saturday, now), saturday }, now)
  assert.deepEqual(kinds(out), ['festival', 'saturday'])
  assert.equal(out.cards[1].eyebrow.text, 'FESTIVAL DAY')
})

test('the festival is removed from "Coming up" while it is a main card (the next one shows instead)', () => {
  const up = upcoming()
  const soon = pickWeekFestival(up, lastWeekWithLinkedNext(), at('2026-11-11'))
  assert.equal(pickNextFestival(up, soon.festival.id).festival.id, 'f2')
  assert.equal(pickNextFestival(upcoming([CHELT]), soon.festival.id), null)
})

test('AFTER PICKS OPEN: the normal festival card (open), on top; no duplicate "soon" card', () => {
  const now = at('2026-11-12')
  for (const saturday of [null, announced('2026-11-14', 'd2', { dayNumber: 2, festivalId: 'f1', festivalName: 'Cheltenham' })]) {
    const out = buildCards({ festival: festivalCardData(), festivalSoon: null, saturday }, now)
    assert.equal(out.cards[0].kind, 'festival')
    assert.equal(out.cards[0].state, 'open')
    assert.equal(out.cards.filter(c => c.kind === 'festival').length, 1)
  }
})

test('DURING RACING (Fri 13 and Sat 14 Nov): the running festival card stays on top', () => {
  for (const day of ['2026-11-13', '2026-11-14']) {
    const out = buildCards({
      festival: festivalCardData({ state: 'closed', dayNumber: day.endsWith('13') ? 1 : 2 }),
      saturday: announced('2026-11-14', 'd2', { dayNumber: 2, festivalId: 'f1', festivalName: 'Cheltenham' }),
    }, at(day, '15:00:00'))
    assert.deepEqual(kinds(out), ['festival', 'saturday'], day)
    assert.equal(out.cards[0].phase, 'running')
  }
})

test('AFTER IT FINISHES (Mon 16 Nov): Saturday League goes back on top', () => {
  const out = buildCards({ festival: festivalCardData({ state: 'closed', final: true, dayNumber: 3 }), saturday: openSaturday('2026-11-21') }, at('2026-11-16'))
  assert.deepEqual(kinds(out), ['saturday', 'festival'])
  assert.equal(out.cards[1].phase, 'finished')
})

test('a festival weeks away is not a main card: nothing changes (it stays in "Coming up")', () => {
  const now = at('2026-11-11')
  const saturday = announced('2026-11-14')
  assert.equal(pickWeekFestival(upcoming([LATER]), saturday, now), null)
  const out = buildCards({ festival: null, festivalSoon: null, saturday }, now)
  assert.deepEqual(kinds(out), ['saturday'])
  // An ordinary announced Saturday keeps its own wording and notify button.
  assert.equal(out.cards[0].eyebrow.text, 'RACE DAY ANNOUNCED')
  assert.ok(out.cards[0].notify)
  assert.match(out.cards[0].label, /Racecard out soon/)
})

test('a festival racing earlier in the same Mon-Sun week as an unlinked Saturday is a main card from Monday', () => {
  const tueFri = { ...CHELT, start_date: '2026-11-10', end_date: '2026-11-13' }
  assert.ok(pickWeekFestival({ list: [tueFri], days: [], today: '2026-11-09' }, announced('2026-11-14'), at('2026-11-09')))
  // ...but a festival in the week after that Saturday is not.
  const next = { ...CHELT, start_date: '2026-11-17', end_date: '2026-11-20' }
  assert.equal(pickWeekFestival({ list: [next], days: [], today: '2026-11-11' }, announced('2026-11-14'), at('2026-11-11')), null)
})

test('with no Saturday week to look at, the next Saturday on the calendar decides', () => {
  const returns = { state: 'returns', season: SEASON, seasonPos: null, table: null, userId: 'me' }
  assert.ok(pickWeekFestival(upcoming(), returns, at('2026-11-11')))
  assert.equal(pickWeekFestival(upcoming([LATER]), null, at('2026-11-11')), null)
})
