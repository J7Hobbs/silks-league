// The festival wrap-up: places, scopes, the figures on the page, and the one push that replaces the last day's end-of-day.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDb } from './helpers/fakeDb.js'
import { setClient } from '../supabase/functions/_shared/db.js'
import { sendEndOfDay } from '../supabase/functions/_shared/notifyPlayers.js'
import { festivalFinal } from '../supabase/functions/_shared/notifyCopy.js'
import { orderIds } from '../src/lib/ranking.js'
import {
  lastDayDone, placeRows, scopesFor, rowsInScope, openScope, finalView, meetingPositions, myFigures, finalSummary, finalPath,
} from '../src/lib/finalTable.js'

const E = (id, points, wins = 0, name = id) => ({ id, name, points, wins })

// ── When it exists ─────────────────────────────────────────────────────────
test('the wrap-up exists once every race on the last day has a result or is abandoned', () => {
  const races = [{ id: 'a' }, { id: 'b' }, { id: 'c', is_abandoned: true }]
  assert.equal(lastDayDone(races, ['a']), false)
  assert.equal(lastDayDone(races, ['a', 'b']), true)
  assert.equal(lastDayDone([], []), false, 'a day with no races is not finished')
  assert.equal(finalPath('f1'), '/festival/f1/final')
})

// ── Places ─────────────────────────────────────────────────────────────────
test('ties share a place: 1, 2, 2, 4 and "=" on the tied labels', () => {
  const rows = placeRows([E('a', 100), E('b', 80), E('c', 80), E('d', 60), E('e', 40)])
  assert.deepEqual(rows.map(r => r.label), ['1st', '=2nd', '=2nd', '4th', '5th'])
  assert.deepEqual(rows.map(r => r.place), [1, 2, 2, 4, 5])
  assert.deepEqual(rows.map(r => r.tied), [false, true, true, false, false])
})

test('level on points but not on winning picks is NOT a tie: the Leaderboard tie-break decides, so there is one champion', () => {
  const rows = placeRows([E('x', 50, 1, 'Zed'), E('y', 50, 3, 'Amy'), E('z', 50, 3, 'Bea')])
  assert.deepEqual(rows.map(r => r.id), ['y', 'z', 'x'])
  assert.deepEqual(rows.map(r => r.label), ['=1st', '=1st', '3rd'], 'y and z are level on points and winning picks; x is behind them')
  const one = placeRows([E('p', 260, 4, 'Jack'), E('q', 260, 3, 'Ben')])
  assert.deepEqual(one.map(r => `${r.id}:${r.label}`), ['p:1st', 'q:2nd'])
})

test('the Final order is always the Leaderboard order (one shared ranking function)', () => {
  let seed = 7
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  for (let run = 0; run < 200; run++) {
    const rows = Array.from({ length: 2 + rnd(10) }, (_, i) => E(`p${i}`, rnd(6) * 10, rnd(3), ['Zed', 'Amy', 'Bea', 'Cal'][rnd(4)]))
    const totals = {}, wins = {}, names = {}
    rows.forEach(r => { totals[r.id] = r.points; wins[r.id] = r.wins; names[r.id] = r.name })
    assert.deepEqual(placeRows(rows).map(r => r.id), orderIds(totals, wins, names))
  }
})

test('a tie for 4th is shown "=4th"', () => {
  const rows = placeRows([E('a', 90), E('b', 80), E('c', 70), E('d', 60), E('e', 60), E('f', 10)])
  assert.deepEqual(rows.map(r => r.label), ['1st', '2nd', '3rd', '=4th', '=4th', '6th'])
})

// ── Scopes ─────────────────────────────────────────────────────────────────
const entrants = [E('me', 120), E('a', 110), E('b', 100), E('c', 90), E('d', 80), E('e', 70), E('f', 60)]
const groups = [{ id: 'g2', name: 'Somerset Silks' }, { id: 'g1', name: 'Alpha' }, { id: 'g3', name: 'Lonely' }, { id: 'g4', name: 'Outsiders' }]
const members = { g1: ['me', 'c', 'x1'], g2: ['a', 'b', 'd', 'me'], g3: ['me'], g4: ['x1', 'x2', 'c'] }

test('chips: Everyone, then each group with at least two entrants (people who did not pick do not count)', () => {
  const scopes = scopesFor(entrants, groups, members)
  assert.deepEqual(scopes.map(s => s.label), ['Everyone', 'Alpha', 'Somerset Silks'])
  assert.deepEqual(scopes.find(s => s.key === 'g1').ids, ['me', 'c'], 'x1 made no picks')
  assert.equal(scopes.find(s => s.key === 'g3'), undefined, 'a group of one is not offered')
  assert.equal(scopes.find(s => s.key === 'g4'), undefined, 'one entrant is not enough')
})

test('opens on the remembered chip, and falls back to Everyone when it is gone', () => {
  const scopes = scopesFor(entrants, groups, members)
  assert.equal(openScope(scopes, { kind: 'group', id: 'g2' }), 'g2')
  assert.equal(openScope(scopes, { kind: 'group', id: 'g3' }), 'everyone')
  assert.equal(openScope(scopes, { kind: 'group', id: 'deleted' }), 'everyone')
  assert.equal(openScope(scopes, { kind: 'everyone' }), 'everyone')
  assert.equal(openScope(scopes, null), 'everyone')
})

test('a group table is re-ranked among its own entrants', () => {
  const scopes = scopesFor(entrants, groups, members)
  const rows = rowsInScope(entrants, scopes.find(s => s.key === 'g2'))
  assert.deepEqual(rows.map(r => `${r.id}:${r.label}`), ['me:1st', 'a:2nd', 'b:3rd', 'd:4th'])
})

// ── The screen ─────────────────────────────────────────────────────────────
test('podium: 2nd left, 1st centre, 3rd right; the player is marked', () => {
  const v = finalView(entrants, { ids: null }, 'a')
  assert.deepEqual(v.podium.map(p => `${p.slot}:${p.id}`), ['second:a', 'first:me', 'third:b'])
  assert.equal(v.podium[0].isMe, true)
  assert.equal(v.podium[1].isMe, false)
})

test('fewer than three entrants shows what exists', () => {
  assert.deepEqual(finalView([E('a', 10), E('b', 5)], { ids: null }, 'a').podium.map(p => p.slot), ['second', 'first'])
  assert.deepEqual(finalView([E('a', 10)], { ids: null }, 'a').podium.map(p => p.slot), ['first'])
  const none = finalView([], { ids: null }, 'a')
  assert.equal(none.podium.length, 0); assert.equal(none.total, 0)
})

test('table: 4th downwards, the first three rows, and the player\'s row is always visible', () => {
  const many = Array.from({ length: 12 }, (_, i) => E(`p${i + 1}`, 1000 - i * 10))
  const v = finalView(many, { ids: null }, 'p10')
  assert.deepEqual(v.visible.map(r => r.id), ['p4', 'p5', 'p6', 'p10'])
  assert.equal(v.hidden, 5)                                  // rest is p4..p12 = 9 rows, 4 visible
  assert.equal(v.me.label, '10th')
  // already inside the first rows: not repeated
  const near = finalView(many, { ids: null }, 'p5')
  assert.deepEqual(near.visible.map(r => r.id), ['p4', 'p5', 'p6'])
  // on the podium: nothing extra
  assert.deepEqual(finalView(many, { ids: null }, 'p2').visible.map(r => r.id), ['p4', 'p5', 'p6'])
  // a short table shows everything and has no "See full table"
  assert.equal(finalView(entrants, { ids: null }, 'f').hidden, 0)
})

// ── Your meeting ───────────────────────────────────────────────────────────
test('one row per table the player is in, the selected chip is current, ties show "="', () => {
  const tied = [E('me', 100), E('a', 90), E('b', 80), E('c', 70), E('d', 70), E('e', 60)]
  const scopes = scopesFor(tied, [{ id: 'g1', name: 'Alpha' }, { id: 'g2', name: 'Others' }], { g1: ['me', 'c', 'd'], g2: ['a', 'b'] })
  const pos = meetingPositions(tied, scopes, 'c', 'g1')
  assert.deepEqual(pos.map(p => `${p.label}|${p.place} of ${p.total}|${p.current}`), ['Everyone|=4th of 6|false', 'Alpha|=2nd of 3|true'])
  assert.equal(meetingPositions(tied, scopes, 'nobody', 'everyone').length, 0, 'a player who did not enter is in no table')
})

test('the player\'s figures: winners out of races picked, best pick, best day', () => {
  const row = (o = {}) => ({ pick: { name: 'Horse', price: '5/1' }, played: true, position: 4, points: 0, banker: false, abandoned: false, ...o })
  const days = [
    { dayNumber: 1, rows: [row({ position: 1, points: 60 }), row(), row({ position: 2, points: 30 })] },
    { dayNumber: 2, rows: [row({ pick: { name: 'Bluey', price: '7/2' }, position: 1, points: 144, banker: true }), row({ pick: null, played: false }), row({ abandoned: true, played: false })] },
    { dayNumber: 3, rows: [row({ position: 1, points: 40 })] },
  ]
  const f = myFigures(days, { 1: 90, 2: 144, 3: 40 })
  assert.equal(f.picked, 5, 'the race with no pick and the abandoned race are not races they played')
  assert.equal(f.winners, 3)
  assert.deepEqual(f.best, { horse: 'Bluey', price: '7/2', outcome: 'Won', dayNumber: 2, points: 144, banker: true })
  assert.deepEqual(f.bestDay, { dayNumber: 2, points: 144 })
  // placed outcome, and an equal best day goes to the earlier day
  const g = myFigures([{ dayNumber: 1, rows: [row({ position: 3, points: 20 })] }], { 1: 20, 2: 20 })
  assert.equal(g.best.outcome, 'Placed 3rd'); assert.deepEqual(g.bestDay, { dayNumber: 1, points: 20 })
  // nothing scored: no best pick, not an invented one
  assert.equal(myFigures([{ dayNumber: 1, rows: [row()] }], {}).best, null)
})

test('Leaderboard / Home summary: the champion and the player\'s place among players with picks', () => {
  const rows = [{ userId: 'a', name: 'A', points: 100, wins: 1 }, { userId: 'b', name: 'B', points: 90, wins: 0 }, { userId: 'c', name: 'C', points: 500, wins: 0 }]
  const s = finalSummary(rows, ['a', 'b'], 'b')      // c never picked, so never counts
  assert.equal(s.champion.id, 'a'); assert.equal(s.mine.label, '2nd'); assert.equal(s.total, 2)
  assert.equal(finalSummary(rows, ['a', 'b'], 'c').mine, null)
})

// ── The push ───────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-11-14T18:00:00Z')
function setupFestival(patch = {}) {
  const db = createFakeDb({
    festivals: [{ id: 'f1', name: 'Open Meeting', display_name: 'Open Meeting', venue: patch.venue === undefined ? 'York' : patch.venue }],
    festival_days: [
      { id: 'd1', festival_id: 'f1', day_number: 1, race_date: '2026-11-12' },
      { id: 'd2', festival_id: 'f1', day_number: 2, race_date: '2026-11-13' },
      { id: 'd3', festival_id: 'f1', day_number: 3, race_date: patch.lastDate || '2026-11-14' },
    ],
    festival_races: [
      { id: 'r1', festival_day_id: 'd1', race_number: 1, venue: 'York', is_abandoned: false },
      { id: 'r2', festival_day_id: 'd2', race_number: 1, venue: 'York', is_abandoned: false },
      { id: 'r3', festival_day_id: 'd3', race_number: 1, venue: 'York', is_abandoned: false },
      { id: 'r4', festival_day_id: 'd3', race_number: 2, venue: 'York', is_abandoned: false },
    ],
    festival_results: [{ festival_race_id: 'r1', position: 1 }, { festival_race_id: 'r2', position: 1 }],
    festival_picks: [
      { id: 'p1', user_id: 'u1', festival_race_id: 'r1' }, { id: 'p2', user_id: 'u2', festival_race_id: 'r1' },
      { id: 'p3', user_id: 'u1', festival_race_id: 'r3' }, { id: 'p4', user_id: 'u3', festival_race_id: 'r4' },
    ],
    reminder_log: [],
  }, { clock: () => '2026-11-14T18:00:00.000Z' })
  setClient(db.client)
  return db
}
const pushes = db => db.calls.invoked.filter(c => c.name === 'send-notification').map(c => c.body)

test('the last race of the last day sends the final-table push to everyone who picked in the festival, once, and no end-of-day', async () => {
  const db = setupFestival()
  const quiet = console.error; console.error = () => {}
  try {
    // day 3 not finished: nothing
    assert.equal((await sendEndOfDay('festival', 'd3', { nowMs: NOW })).skipped, 'races still to come')
    db.tables.festival_results.push({ festival_race_id: 'r3', position: 1 }, { festival_race_id: 'r4', position: 1 })
    const out = await sendEndOfDay('festival', 'd3', { nowMs: NOW })
    assert.equal(out.ok, true); assert.equal(out.final, true); assert.equal(out.sent, 3, 'u2 picked only on day 1 and still gets it')
    const sent = pushes(db)
    assert.equal(sent.length, 1)
    assert.deepEqual(sent[0].userIds.sort(), ['u1', 'u2', 'u3'])
    assert.equal(sent[0].title, 'Final results')
    assert.equal(sent[0].body, "Final table's in from York. See where you finished")
    assert.equal(sent[0].url, 'https://silks-league.vercel.app/festival/f1/final')
    // the same save again (or a correction) never sends it twice
    const again = await sendEndOfDay('festival', 'd3', { nowMs: NOW })
    assert.equal(again.skipped, 'already sent'); assert.equal(pushes(db).length, 1)
  } finally { console.error = quiet }
})

test('an earlier day still gets the usual end-of-day message', async () => {
  const db = setupFestival()
  db.tables.festival_races = db.tables.festival_races.filter(r => r.festival_day_id !== 'd1').concat({ id: 'r1', festival_day_id: 'd1', race_number: 1, venue: 'York', is_abandoned: false })
  const out = await sendEndOfDay('festival', 'd1', { nowMs: Date.parse('2026-11-13T09:00:00Z') })
  assert.equal(out.ok, true); assert.equal(out.final, undefined)
  const sent = pushes(db)
  assert.equal(sent.length, 1); assert.match(sent[0].url, /\/results\/festival\/f1$/)
  assert.doesNotMatch(sent[0].body, /Final table/)
})

test('an abandoned last race counts as done; entering old results never messages anyone; no venue drops "from"', async () => {
  const db = setupFestival({ venue: '' })
  db.tables.festival_races.find(r => r.id === 'r4').is_abandoned = true
  db.tables.festival_results.push({ festival_race_id: 'r3', position: 1 })
  const out = await sendEndOfDay('festival', 'd3', { nowMs: NOW })
  assert.equal(out.final, true)
  assert.equal(pushes(db)[0].body, "Final table's in from York. See where you finished", 'a single venue on the races is used when the festival has none')
  assert.equal(festivalFinal({ venue: '' }).body, "Final table's in. See where you finished")

  const old = setupFestival({ lastDate: '2026-10-01' })
  old.tables.festival_results.push({ festival_race_id: 'r3', position: 1 }, { festival_race_id: 'r4', position: 1 })
  assert.equal((await sendEndOfDay('festival', 'd3', { nowMs: NOW })).skipped, 'old race day')
  assert.equal(pushes(old).length, 0)
})
