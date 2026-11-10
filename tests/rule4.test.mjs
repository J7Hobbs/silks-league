// Rule 4 deductions: the price table, the points maths, and the pipeline (Saturday and festival races, banker, each-way,
// re-scoring when a horse is withdrawn or reinstated after the result, races before the start date, no price).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDb } from './helpers/fakeDb.js'
import { freezeClock } from './helpers/clock.js'
import { seed } from './scenarios/pipeline.js'
import { setClient } from '../supabase/functions/_shared/db.js'
import * as today from '../supabase/functions/_shared/adminToday.js'
import * as raceDay from '../supabase/functions/_shared/raceDay.js'
import {
  calcTokenPoints, getPlaceTerms, canOfferEachWay, isWinOnly, rule4Deduction, rule4For, rule4Line, rule4Tag, rule4Table, rule4Applies, applyRule4, RULE4_CAP_PENCE,
} from '../supabase/functions/_shared/scoring.js'

const dec = f => (f === 'evens' ? 2 : 1 + Number(f.split('/')[0]) / Number(f.split('/')[1]))

// ── The table ─────────────────────────────────────────────────────────────
test('every band edge in the table, as the decimal price that is stored (2 places)', () => {
  const edges = [
    ['1/9', 90], ['1/10', 90], ['1/50', 90], ['2/17', 85], ['2/11', 85],
    ['1/5', 80], ['1/4', 80], ['2/7', 75], ['3/10', 75], ['1/3', 70], ['2/5', 70],
    ['4/9', 65], ['8/15', 65], ['4/7', 60], ['8/13', 60], ['4/6', 55], ['4/5', 55],
    ['5/6', 50], ['20/21', 50], ['evens', 45], ['6/5', 45], ['5/4', 40], ['6/4', 40],
    ['8/5', 35], ['7/4', 35], ['9/5', 30], ['9/4', 30], ['12/5', 25], ['3/1', 25],
    ['16/5', 20], ['4/1', 20], ['9/2', 15], ['11/2', 15], ['6/1', 10], ['9/1', 10], ['10/1', 5], ['14/1', 5],
    ['15/1', 0], ['16/1', 0], ['100/1', 0],
  ]
  for (const [price, pence] of edges) {
    assert.equal(rule4Deduction(dec(price)), pence, `${price} (${dec(price)})`)
    assert.equal(rule4Deduction(Math.round(dec(price) * 100) / 100), pence, `${price} as stored`)
  }
})

test('prices in between the listed ones fall in the right band', () => {
  assert.equal(rule4Deduction(dec('100/30')), 20)   // 4.33: between 3/1 and 4/1
  assert.equal(rule4Deduction(4.1), 25)             // between 3/1 (4.00) and 16/5 (4.20)
  assert.equal(rule4Deduction(2.1), 45)             // 11/10
  assert.equal(rule4Deduction(dec('13/8')), 35)
  assert.equal(rule4Deduction(dec('15/8')), 30)
  assert.equal(rule4Deduction(dec('5/2')), 25)
  assert.equal(rule4Deduction(dec('7/2')), 20)
  assert.equal(rule4Deduction(dec('5/1')), 15)
  assert.equal(rule4Deduction(dec('13/2')), 10)
  assert.equal(rule4Deduction(15.5), 0)             // longer than 14/1
})

test('no price or a nonsense price gives no deduction', () => {
  for (const v of [null, undefined, 0, -1, NaN, '', 'abc']) assert.equal(rule4Deduction(v), 0)
})

test('the table shown on How it works is the same table', () => {
  const rows = rule4Table()
  assert.deepEqual(rows[0], { range: '1/9 or shorter', pence: 90 })
  assert.deepEqual(rows[1], { range: '2/17 to 2/11', pence: 85 })
  assert.deepEqual(rows.find(r => r.range.startsWith('evens')), { range: 'evens to 6/5', pence: 45 })
  assert.deepEqual(rows[rows.length - 1], { range: 'Longer than 14/1', pence: 0 })
  assert.equal(rows.length, 19)
})

// ── Several withdrawals, the cap, the start date, no price ─────────────────
const wd = (name, frac) => ({ horse_name: name, odds_fractional: frac, odds_decimal: dec(frac) })

test('several withdrawals add up, capped at 90p', () => {
  assert.equal(RULE4_CAP_PENCE, 90)
  assert.equal(rule4For({ date: '2026-11-14', withdrawn: [wd('Bluey', '3/1'), wd('Rocky', '10/1')] }).pence, 30)
  const big = rule4For({ date: '2026-11-14', withdrawn: [wd('A', '1/9'), wd('B', '1/5'), wd('C', 'evens')] })
  assert.equal(big.pence, 90, 'capped'); assert.equal(big.items.length, 3)
  assert.equal(rule4For({ date: '2026-11-14', withdrawn: [wd('A', '1/4'), wd('B', '1/3'), wd('C', '4/9')] }).pence, 90)
})

test('before 13 Nov 2026 nothing applies; a withdrawn horse with no price gives none', () => {
  assert.equal(rule4Applies('2026-11-12'), false); assert.equal(rule4Applies('2026-11-13'), true); assert.equal(rule4Applies('2026-11-14T10:00:00Z'), true)
  const early = rule4For({ date: '2026-11-07', withdrawn: [wd('Bluey', '3/1')] })
  assert.deepEqual({ ...early }, { applies: false, pence: 0, items: [], missing: [] })
  const none = rule4For({ date: '2026-11-14', withdrawn: [{ horse_name: 'Nopri', odds_fractional: null, odds_decimal: null }, wd('Long', '20/1')] })
  assert.equal(none.pence, 0); assert.deepEqual(none.missing, ['Nopri']); assert.deepEqual(none.items, [])
})

test('the lines and the tag', () => {
  const one = rule4For({ date: '2026-11-14', withdrawn: [wd('Bluey', '3/1')] })
  assert.equal(rule4Line(one), 'Rule 4: 25p — Bluey withdrawn at 3/1')
  const two = rule4For({ date: '2026-11-14', withdrawn: [wd('Bluey', '3/1'), wd('Rocky', '10/1')] })
  assert.equal(rule4Line(two), 'Rule 4: 30p — Bluey (3/1) and Rocky (10/1) withdrawn')
  const three = rule4For({ date: '2026-11-14', withdrawn: [wd('A', '3/1'), wd('B', '10/1'), wd('C', '6/1')] })
  assert.equal(rule4Line(three), 'Rule 4: 40p — A (3/1), B (10/1) and C (6/1) withdrawn')
  assert.equal(rule4Line(rule4For({ date: '2026-11-14', withdrawn: [wd('Long', '20/1')] })), '')
  assert.equal(rule4Line(null), '')
  assert.equal(rule4Tag(25), 'Rule 4 −25p'); assert.equal(rule4Tag(0), '')
})

// ── The points ────────────────────────────────────────────────────────────
test('worked examples: 5/1 winner with a 25p deduction', () => {
  assert.equal(applyRule4(6, 25), 4.75)
  assert.equal(calcTokenPoints({ betType: 'win', position: 1, oddsDecimal: 6, runnerCount: 8 }).totalPoints, 120)
  assert.equal(calcTokenPoints({ betType: 'win', position: 1, oddsDecimal: 6, runnerCount: 8, rule4Pence: 25 }).totalPoints, 95)
  assert.equal(calcTokenPoints({ betType: 'each_way', position: 1, oddsDecimal: 6, runnerCount: 8 }).totalPoints, 83)
  const ew = calcTokenPoints({ betType: 'each_way', position: 1, oddsDecimal: 6, runnerCount: 8, rule4Pence: 25 })
  assert.equal(ew.totalPoints, 67)                             // (4.75 + 1.9375) x 10 = 66.875
  assert.equal(ew.winTokenPoints + ew.placeTokenPoints, ew.totalPoints)
  // a placed each-way horse: the place part uses the reduced price too (1 + 0.25 x 3.75 = 1.9375)
  assert.equal(calcTokenPoints({ betType: 'each_way', position: 2, oddsDecimal: 6, runnerCount: 8, rule4Pence: 25 }).totalPoints, 19)
  // a loser scores nothing either way
  assert.equal(calcTokenPoints({ betType: 'win', position: 5, oddsDecimal: 6, runnerCount: 8, rule4Pence: 25 }).totalPoints, 0)
  assert.equal(calcTokenPoints({ betType: 'each_way', position: 6, oddsDecimal: 6, runnerCount: 8, rule4Pence: 25 }).totalPoints, 0)
})

test('with no deduction every score is exactly what it always was', () => {
  // The scoring formula as it was before Rule 4, written out again here.
  const old = ({ betType, position, oddsDecimal, runnerCount }) => {
    if (betType === 'win') { const t = position === 1 ? Math.round(2 * oddsDecimal * 10) : 0; return { winTokenPoints: t, placeTokenPoints: 0, totalPoints: t } }
    const placesPaid = runnerCount >= 16 ? 4 : runnerCount >= 8 ? 3 : runnerCount >= 5 ? 2 : 0
    const taper = { 1: 1, 2: 1, 3: 0.65, 4: 0.4 }[position]
    const placed = taper !== undefined && position <= placesPaid
    const winRaw = position === 1 ? oddsDecimal : 0
    const placeRaw = placed ? 1 + 0.25 * taper * (oddsDecimal - 1) : 0
    const totalPoints = Math.round((winRaw + placeRaw) * 10)
    const winTokenPoints = position === 1 ? Math.round(winRaw * 10) : 0
    return { winTokenPoints, placeTokenPoints: totalPoints - winTokenPoints, totalPoints }
  }
  let n = 0
  for (const betType of ['win', 'each_way']) for (const runnerCount of [2, 4, 5, 7, 8, 12, 16, 20]) for (const position of [1, 2, 3, 4, 5, null]) {
    for (let d = 1.05; d < 60; d = +(d + 0.13).toFixed(2)) {
      const a = calcTokenPoints({ betType, position, oddsDecimal: d, runnerCount })
      const b = calcTokenPoints({ betType, position, oddsDecimal: d, runnerCount, rule4Pence: 0 })
      const o = old({ betType, position, oddsDecimal: d, runnerCount })
      assert.deepEqual({ ...a, betType: undefined }, { ...o, betType: undefined }, `${betType} pos ${position} @${d} n=${runnerCount}`)
      assert.deepEqual(a, b); n++
    }
  }
  assert.ok(n > 5000)
})

test('each-way eligibility is still judged on the original price and field: Rule 4 changes points, not what was allowed', () => {
  // The reduced price of a 5/1 shot at 90p is 1.5, which would be "under 4/1" if it were used for eligibility. It is not.
  assert.equal(canOfferEachWay(6, 8), true)
  assert.equal(isWinOnly(6), false)
  assert.equal(getPlaceTerms(8).placesPaid, 3)
  assert.equal(calcTokenPoints({ betType: 'each_way', position: 3, oddsDecimal: 6, runnerCount: 8, rule4Pence: 90 }).totalPoints > 0, true, 'still paid a place')
  assert.equal(calcTokenPoints({ betType: 'each_way', position: 4, oddsDecimal: 6, runnerCount: 8, rule4Pence: 90 }).totalPoints, 0, 'places paid unchanged')
})

// ── The pipeline ──────────────────────────────────────────────────────────
const NOW = Date.parse('2026-11-14T15:00:00.000Z')
function setup(change = d => d) {
  const unfreeze = freezeClock('2026-11-14T15:00:00.000Z')
  const data = change(seed())
  const db = createFakeDb(data)
  setClient(db.client)
  const log = console.log
  console.log = () => {}
  return { db, done: () => { console.log = log; unfreeze() } }
}
const rowsOf = (db, kind, raceId) => db.tables[kind === 'week' ? 'scores' : 'festival_scores'].filter(s => s[kind === 'week' ? 'race_id' : 'festival_race_id'] === raceId)
const runnersOf = (db, kind, raceId) => db.tables[kind === 'week' ? 'runners' : 'festival_runners'].filter(r => r[kind === 'week' ? 'race_id' : 'festival_race_id'] === raceId)
const race = (db, kind, id) => db.tables[kind === 'week' ? 'races' : 'festival_races'].find(r => r.id === id)
const places = (db, kind, id, nums) => nums.map((n, i) => ({ position: i + 1, horse_name: runnersOf(db, kind, id).find(r => r.horse_number === n).horse_name }))
const LOCK = '2026-11-14T12:50:00.000Z'
async function withdraw(db, kind, raceId, num, lockIso = LOCK) {
  const plan = await raceDay.planWithdrawal(kind, runnersOf(db, kind, raceId).find(r => r.horse_number === num), race(db, kind, raceId), { lockIso, now: NOW })
  return raceDay.withdrawRunnerNow(kind, plan, { lockIso, now: NOW })
}
const pointsOf = (db, kind, raceId, user) => rowsOf(db, kind, raceId).find(s => s.user_id === user)

test('Saturday race: a withdrawn 7/2 horse takes 20p off every pick, picks moved to the favourite included; banker doubles the reduced points; lone winner is flat', async () => {
  const { db, done } = setup()
  try {
    // Race 1: u4 is on a-2 (7/2 = 4.50, a 20p band) and is moved to the favourite a-1 (2/1). u3 is each-way on a-3 (5/1).
    await withdraw(db, 'week', 'r1', 2)
    const r = await today.saveRaceResult('week', race(db, 'week', 'r1'), runnersOf(db, 'week', 'r1'), places(db, 'week', 'r1', [1, 3, 4]), {})
    assert.equal(r.ok, true, JSON.stringify(r))
    // u2 wins on a-1 at 2/1 = 3.00: reduced price 1 + 2 x 0.80 = 2.60, so 2 x 2.60 x 10 = 52 (was 60).
    assert.equal(pointsOf(db, 'week', 'r1', 'u2').win_token_points, 52)
    // u4's pick was moved to a-1 and is reduced in the same way. (It became a win bet: 2/1 is under 4/1.)
    const u4 = pointsOf(db, 'week', 'r1', 'u4')
    assert.equal(u4.win_token_points, 52); assert.equal(u4.bet_type, 'win')
    // u1: banker on a-1: raw 52, doubled to 104 in total.
    const u1 = pointsOf(db, 'week', 'r1', 'u1')
    assert.equal(u1.win_token_points, 52); assert.equal(u1.total_points, 104)
    // u3: each-way on a-3 (5/1 = 6.00), second. Place part uses the reduced price: 1 + 0.25 x (1 + 5 x 0.8 - 1) = 2.00 -> 20 (was 23).
    const u3 = pointsOf(db, 'week', 'r1', 'u3')
    assert.equal(u3.bet_type, 'each_way'); assert.equal(u3.place_token_points, 20); assert.equal(u3.total_points, 20)
    // nobody won alone, so no lone winner; the withdrawal changes no other race
    assert.equal(db.tables.bonus_awards.filter(b => b.bonus_type === 'lone_winner' && b.race_id === 'r1').length, 0)
    assert.equal(rowsOf(db, 'week', 'r2').length, 0)
  } finally { done() }
})

test('the lone winner bonus is flat 25 with a deduction', async () => {
  const { db, done } = setup(d => {
    d.picks.filter(p => p.race_id === 'r1' && p.user_id !== 'u6').forEach(p => { p.runner_id = 'a-2' })    // everyone but u6 on a-2
    d.picks.find(p => p.race_id === 'r1' && p.user_id === 'u6').runner_id = 'a-1'
    d.picks.filter(p => p.race_id === 'r1').forEach(p => { p.bet_type = 'win'; p.is_banker = false })
    return d
  })
  try {
    await withdraw(db, 'week', 'r1', 3)                    // a-3 is 5/1 = 6.00: 15p
    await today.saveRaceResult('week', race(db, 'week', 'r1'), runnersOf(db, 'week', 'r1'), places(db, 'week', 'r1', [1, 2, 4]), {})
    const u6 = pointsOf(db, 'week', 'r1', 'u6')
    // 2/1 = 3.00, 15p: 1 + 2 x 0.85 = 2.70 -> 54, plus the flat 25
    assert.equal(u6.win_token_points, 54); assert.equal(u6.total_points, 79)
    assert.equal(db.tables.bonus_awards.find(b => b.bonus_type === 'lone_winner' && b.race_id === 'r1').points, 25)
  } finally { done() }
})

test('a race before the start date is never touched', async () => {
  const { db, done } = setup(d => { d.race_weeks.find(w => w.id === 'w1').saturday_date = '2026-11-07'; return d })
  try {
    await withdraw(db, 'week', 'r1', 2)
    await today.saveRaceResult('week', race(db, 'week', 'r1'), runnersOf(db, 'week', 'r1'), places(db, 'week', 'r1', [1, 3, 4]), {})
    assert.equal(pointsOf(db, 'week', 'r1', 'u2').win_token_points, 60, 'the full 2/1 price: no deduction')
    assert.equal(pointsOf(db, 'week', 'r1', 'u3').place_token_points, 23)
  } finally { done() }
})

test('no withdrawal: scores are exactly the old ones', async () => {
  const { db, done } = setup()
  try {
    await today.saveRaceResult('week', race(db, 'week', 'r1'), runnersOf(db, 'week', 'r1'), places(db, 'week', 'r1', [1, 3, 2]), {})
    assert.equal(pointsOf(db, 'week', 'r1', 'u2').win_token_points, 60)
    assert.equal(pointsOf(db, 'week', 'r1', 'u3').place_token_points, 23)
  } finally { done() }
})

test('a horse withdrawn AFTER the result re-scores the race with the deduction; reinstating it takes the deduction off', async () => {
  const { db, done } = setup()
  try {
    await today.saveRaceResult('week', race(db, 'week', 'r1'), runnersOf(db, 'week', 'r1'), places(db, 'week', 'r1', [1, 3, 4]), {})
    assert.equal(pointsOf(db, 'week', 'r1', 'u2').win_token_points, 60)
    const out = await withdraw(db, 'week', 'r1', 5)       // a-5 is 12/1 = 13.00: 5p
    assert.equal(out.rescored.ok, true)
    assert.equal(pointsOf(db, 'week', 'r1', 'u2').win_token_points, 58, '2 x (1 + 2 x 0.95) x 10')
    // reinstate it: re-scored again, back to the full price
    const plan = await raceDay.planReinstate('week', runnersOf(db, 'week', 'r1').find(r => r.horse_number === 5), race(db, 'week', 'r1'))
    const back = await raceDay.reinstateRunnerNow('week', plan)
    assert.equal(back.rescored.ok, true)
    assert.equal(pointsOf(db, 'week', 'r1', 'u2').win_token_points, 60)
  } finally { done() }
})

test('festival race: the deduction applies, and the festival day points follow the reduced scores', async () => {
  const { db, done } = setup()
  try {
    // fr1 (race day 2026-11-13): fa-3 is 5/1 = 6.00, 15p. u1 is on fa-1 (win, banker), u3 on fa-1 (each-way, 2/1).
    const lockIso = '2026-11-13T12:00:00.000Z'
    await withdraw(db, 'festival', 'fr1', 3, lockIso)
    const r = await today.saveRaceResult('festival', race(db, 'festival', 'fr1'), runnersOf(db, 'festival', 'fr1'), places(db, 'festival', 'fr1', [1, 2, 4]), { festivalId: 'f1' })
    assert.equal(r.ok, true, JSON.stringify(r))
    // u1: 2/1 = 3.00, 15p: 1 + 2 x 0.85 = 2.70 -> 54, banker doubles: 108
    const u1 = pointsOf(db, 'festival', 'fr1', 'u1')
    assert.equal(u1.win_token_points, 54); assert.equal(u1.total_points, 108)
    // u3: each-way on 2/1: a 2/1 horse (3.00) is under 4/1, so it was already a win bet at the lock. Same deduction.
    const u3 = pointsOf(db, 'festival', 'fr1', 'u3')
    assert.equal(u3.bet_type, 'win'); assert.equal(u3.total_points, 54)
    const day = db.tables.festival_day_points.find(p => p.user_id === 'u1')
    assert.equal(day.points, db.tables.festival_scores.filter(s => s.user_id === 'u1').reduce((n, s) => n + s.total_points, 0), 'festival_day_points matches festival_scores')
  } finally { done() }
})

test('a withdrawn horse with no price: no deduction, and the scorer says so', async () => {
  const { db, done } = setup(d => { const r = d.runners.find(x => x.id === 'a-2'); r.odds_fractional = null; r.odds_decimal = null; return d })
  try {
    await withdraw(db, 'week', 'r1', 2)
    const r = await today.saveRaceResult('week', race(db, 'week', 'r1'), runnersOf(db, 'week', 'r1'), places(db, 'week', 'r1', [1, 3, 4]), {})
    assert.equal(pointsOf(db, 'week', 'r1', 'u2').win_token_points, 60, 'no price, no deduction')
    assert.match(r.warn, /Rule 4: A Horse 2 was withdrawn with no price, so no deduction was taken for it/)
  } finally { done() }
})

test('the plan for a withdrawal reports the deduction before anything changes', async () => {
  const { db, done } = setup()
  try {
    const plan = await raceDay.planWithdrawal('week', runnersOf(db, 'week', 'r1').find(r => r.horse_number === 2), race(db, 'week', 'r1'), { lockIso: LOCK, now: NOW })
    assert.equal(plan.rule4.pence, 20)                          // 7/2 = 4.50
    assert.deepEqual(plan.rule4.items.map(i => i.name), ['A Horse 2'])
    assert.equal(runnersOf(db, 'week', 'r1').find(r => r.horse_number === 2).is_withdrawn, false, 'planning changes nothing')
    // a second withdrawal in the same race adds to the first (5/1 = 15p more)
    await withdraw(db, 'week', 'r1', 2)
    const plan2 = await raceDay.planWithdrawal('week', runnersOf(db, 'week', 'r1').find(r => r.horse_number === 3), race(db, 'week', 'r1'), { lockIso: LOCK, now: NOW })
    assert.equal(plan2.rule4.pence, 35); assert.equal(plan2.rule4.items.length, 2)
  } finally { done() }
})
