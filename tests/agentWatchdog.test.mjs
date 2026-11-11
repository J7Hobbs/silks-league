// The agent watchdog: the four alerts and when each fires (pure planner), then a full run against the in-memory database:
// what is pushed to the admins, that each alert goes once, that a failed push is retried, and that a dry run sends nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDb } from './helpers/fakeDb.js'
import { freezeClock } from './helpers/clock.js'
import { setClient } from '../supabase/functions/_shared/db.js'
import { planWatchdog, runWatchdog, isQuietHours } from '../supabase/functions/_shared/agentWatchdog.js'

// Saturday 14 Nov 2026 is GMT, so UK time is UTC. The week locks 12:50; races at 13:20, 13:55 and 14:30.
const at = hhmm => Date.parse(`2026-11-14T${hhmm}:00.000Z`)
const day = (over = {}) => ({
  key: 'week:w1', date: '2026-11-14', title: 'Saturday League · Week 12', race_count: 3, lock_time: '2026-11-14T12:50:00.000Z',
  races: [
    { race_number: 1, race_time: '13:20', is_abandoned: false, has_result: false },
    { race_number: 2, race_time: '13:55', is_abandoned: false, has_result: false },
    { race_number: 3, race_time: '14:30', is_abandoned: false, has_result: false },
  ], ...over,
})
const withResults = (...nums) => day({ races: day().races.map(r => ({ ...r, has_result: nums.includes(r.race_number) })) })
const draft = (over = {}) => ({ id: 'd1', kind: 'results', status: 'pending', race_date: '2026-11-14', created_at: '2026-11-14T13:00:00.000Z', payload: { outcomes: [] }, ...over })
const waitingFor = (...nums) => ({ outcomes: nums.map(n => ({ type: 'result', state: 'needs_review', race_number: n, ref: `result:r${n}` })) })
const plan = (hhmm, input) => planWatchdog({ nowMs: at(hhmm), ...input })
const texts = alerts => alerts.map(a => a.text)

// ── Quiet hours ──────────────────────────────────────────────────────────────
test('nothing is sent before 07:00 or from 21:00 UK, whatever is wrong', () => {
  const broken = { days: [day({ race_count: 0, races: [] })], drafts: [] }
  assert.equal(isQuietHours(at('06:59')), true)
  assert.equal(isQuietHours(at('07:00')), false)
  assert.equal(isQuietHours(at('20:59')), false)
  assert.equal(isQuietHours(at('21:00')), true)
  assert.deepEqual(plan('06:59', broken), [])
  assert.deepEqual(plan('21:00', { days: [withResults()], drafts: [] }), [])
  assert.equal(plan('07:00', broken).length, 1)
})

test('a day with no racing says nothing', () => {
  assert.deepEqual(plan('15:00', { days: [], saturdaysWithoutWeek: [], seasons: [], drafts: [] }), [])
  assert.deepEqual(planWatchdog({ nowMs: Date.parse('2026-11-15T17:00:00Z'), days: [], drafts: [] }), [])
})

// ── Racecard missing ─────────────────────────────────────────────────────────
const SEASON = [{ start_date: '2026-11-01', end_date: '2026-11-30' }]
const friday = hhmm => Date.parse(`2026-11-13T${hhmm}:00.000Z`)

test('racecard: from 16:00 the day before, a Saturday in the season with no week and no draft', () => {
  const input = { days: [], saturdaysWithoutWeek: ['2026-11-14'], seasons: SEASON, drafts: [] }
  assert.deepEqual(planWatchdog({ nowMs: friday('15:59'), ...input }), [])
  const a = planWatchdog({ nowMs: friday('16:00'), ...input })
  assert.deepEqual(texts(a), ['No racecard yet for Saturday 14 Nov. The agent may have failed. Add races in Race days.'])
  assert.deepEqual(a[0].keys, ['racecard:2026-11-14'])
})

test('racecard: a race day that exists with no races uses its own name; a waiting draft or loaded races silence it', () => {
  const empty = day({ race_count: 0, races: [] })
  const a = planWatchdog({ nowMs: friday('17:00'), days: [empty], drafts: [] })
  assert.deepEqual(texts(a), ['No racecard yet for Saturday League · Week 12. The agent may have failed. Add races in Race days.'])
  assert.deepEqual(planWatchdog({ nowMs: friday('17:00'), days: [empty], drafts: [draft({ kind: 'racecard' })] }), [])
  assert.deepEqual(planWatchdog({ nowMs: friday('17:00'), days: [day()], drafts: [] }), [])
})

test('racecard: a Saturday outside any active season, with no week, is not a race day', () => {
  assert.deepEqual(planWatchdog({ nowMs: friday('17:00'), days: [], saturdaysWithoutWeek: ['2026-11-14'], seasons: [], drafts: [] }), [])
  assert.deepEqual(planWatchdog({ nowMs: friday('17:00'), days: [], saturdaysWithoutWeek: ['2026-11-14'], seasons: [{ start_date: '2026-01-01', end_date: '2026-03-01' }], drafts: [] }), [])
})

test('racecard: still flagged on the race day itself, until races are loaded', () => {
  const empty = day({ race_count: 0, races: [] })
  assert.equal(plan('08:00', { days: [empty], drafts: [] }).length, 1)
})

// ── Morning check ────────────────────────────────────────────────────────────
test('morning check: from 60 minutes before the lock until the first race, if none has come in today', () => {
  const input = { days: [day()], drafts: [] }
  assert.deepEqual(plan('11:49', input), [])
  assert.deepEqual(texts(plan('11:50', input)), ["Morning check hasn't come in for Saturday League · Week 12. Check non-runners manually."])
  assert.deepEqual(plan('13:20', { days: [day()], drafts: [] }).filter(a => a.type === 'morning'), [], 'the first race is off: too late for a morning check')
})

test('morning check: any submission today counts (applied or waiting), yesterday\'s does not', () => {
  const today = draft({ kind: 'morning_check', status: 'applied', created_at: '2026-11-14T09:00:00.000Z' })
  assert.deepEqual(plan('12:00', { days: [day()], drafts: [today] }), [])
  assert.deepEqual(plan('12:00', { days: [day()], drafts: [{ ...today, status: 'pending' }] }), [])
  const old = { ...today, created_at: '2026-11-13T09:00:00.000Z' }
  assert.equal(plan('12:00', { days: [day()], drafts: [old] }).length, 1)
})

// ── Result overdue ───────────────────────────────────────────────────────────
const MORNING_IN = draft({ kind: 'morning_check', status: 'applied', created_at: '2026-11-14T08:00:00.000Z' })

test('result overdue: 30 minutes after the off, no result, not abandoned', () => {
  const input = { days: [day()], drafts: [MORNING_IN] }
  assert.deepEqual(plan('13:49', input), [])
  const a = plan('13:50', input)
  assert.deepEqual(texts(a), ['Race 1 (13:20) has no result 30 minutes after the off. Enter it in Admin.'])
  assert.deepEqual(a[0].keys, ['result:week:w1:r1'])
})

test('result overdue: a saved result or an abandoned race is not overdue', () => {
  assert.deepEqual(plan('14:00', { days: [withResults(1)], drafts: [MORNING_IN] }), [])
  const abandoned = day({ races: day().races.map(r => (r.race_number === 1 ? { ...r, is_abandoned: true } : r)) })
  assert.deepEqual(plan('14:00', { days: [abandoned], drafts: [MORNING_IN] }), [])
})

test('result overdue: races waiting for an admin are not "overdue", and several overdue ones go in one alert', () => {
  const waiting = draft({ payload: waitingFor(1), created_at: '2026-11-14T13:45:00.000Z' })
  assert.deepEqual(plan('14:00', { days: [day()], drafts: [MORNING_IN, waiting] }).filter(a => a.type === 'result'), [])
  const two = plan('14:26', { days: [day()], drafts: [MORNING_IN] })
  assert.deepEqual(texts(two), ['Races 1 and 2 have no result 30 minutes after the off. Enter them in Admin.'])
  assert.deepEqual(two[0].keys, ['result:week:w1:r1', 'result:week:w1:r2'])
  assert.equal(two[0].compose(['result:week:w1:r2']), 'Race 2 (13:55) has no result 30 minutes after the off. Enter it in Admin.')
})

// ── A result waiting on an admin ─────────────────────────────────────────────
test('approval: a results draft waiting 20 minutes or more', () => {
  const d = draft({ payload: waitingFor(1), created_at: '2026-11-14T13:30:00.000Z' })
  assert.deepEqual(plan('13:49', { days: [day()], drafts: [MORNING_IN, d] }).filter(a => a.type === 'approval'), [])
  const a = plan('13:50', { days: [day()], drafts: [MORNING_IN, d] }).filter(a => a.type === 'approval')
  assert.deepEqual(texts(a), ['Race 1 result still waiting for your approval.'])
  assert.deepEqual(a[0].keys, ['approval:d1:1'])
})

test('approval: an applied, rejected or superseded draft is not waiting', () => {
  for (const status of ['applied', 'rejected', 'superseded']) {
    const d = draft({ status, payload: waitingFor(1), created_at: '2026-11-14T13:00:00.000Z' })
    assert.deepEqual(plan('14:00', { days: [withResults(1, 2, 3)], drafts: [MORNING_IN, d] }), [], status)
  }
})

test('approval: several races waiting are one alert', () => {
  const d = draft({ payload: waitingFor(1, 2), created_at: '2026-11-14T13:00:00.000Z' })
  const a = plan('14:00', { days: [day()], drafts: [MORNING_IN, d] }).filter(x => x.type === 'approval')
  assert.deepEqual(texts(a), ['Results for races 1 and 2 are still waiting for your approval.'])
})

// ── A full run ───────────────────────────────────────────────────────────────
function world() {
  return {
    seasons: [{ id: 's1', is_active: true, start_date: '2026-11-01', end_date: '2026-11-30' }],
    profiles: [{ id: 'adm1', is_admin: true }, { id: 'adm2', is_admin: true }, { id: 'p1', is_admin: false }],
    race_weeks: [{ id: 'w1', season_id: 's1', week_number: 12, saturday_date: '2026-11-14', picks_deadline: '2026-11-14T12:50:00.000Z', festival_day_id: null }],
    races: [
      { id: 'r1', race_week_id: 'w1', race_number: 1, venue: 'Ascot', race_name: 'One', race_time: '13:20', is_abandoned: false },
      { id: 'r2', race_week_id: 'w1', race_number: 2, venue: 'Ascot', race_name: 'Two', race_time: '13:55', is_abandoned: false },
    ],
    runners: [], results: [], festival_days: [], festival_races: [], festival_runners: [], festival_results: [], festivals: [],
    agent_drafts: [{ id: 'm1', kind: 'morning_check', status: 'applied', race_date: '2026-11-14', created_at: '2026-11-14T08:00:00.000Z', payload: {} }],
    agent_log: [], agent_watchdog_log: [],
  }
}
function run(seed, iso) {
  const unfreeze = freezeClock(iso)
  const db = createFakeDb(seed, { clock: () => iso })
  setClient(db.client)
  const log = console.log, err = console.error
  console.log = () => {}; console.error = () => {}
  return { db, done: () => { unfreeze(); console.log = log; console.error = err } }
}
const adminPushes = db => db.calls.invoked.filter(c => c.name === 'send-notification')

test('a run pushes the admins once, logs it, and records it so the next run stays quiet', async () => {
  const { db, done } = run(world(), '2026-11-14T13:50:00.000Z')
  try {
    const first = await runWatchdog({ nowMs: at('13:50') })
    assert.deepEqual(first.errors, [])
    assert.equal(first.sent.length, 1)
    const pushes = adminPushes(db)
    assert.equal(pushes.length, 1)
    assert.deepEqual(pushes[0].body.userIds.sort(), ['adm1', 'adm2'])
    assert.equal(pushes[0].body.body, 'Race 1 (13:20) has no result 30 minutes after the off. Enter it in Admin.')
    assert.deepEqual(db.tables.agent_watchdog_log.map(r => r.alert_key), ['result:week:w1:r1'])
    assert.equal(db.tables.agent_log.filter(l => l.action === 'watchdog_alert').length, 1)

    const again = await runWatchdog({ nowMs: at('14:00') })
    assert.deepEqual(again.sent, [])
    assert.equal(adminPushes(db).length, 1, 'the same alert is never sent twice')

    // Later, race 2 is overdue too: only the new one is announced.
    const later = await runWatchdog({ nowMs: at('14:25') })
    assert.equal(later.sent.length, 1)
    assert.equal(adminPushes(db).at(-1).body.body, 'Race 2 (13:55) has no result 30 minutes after the off. Enter it in Admin.')
    assert.equal(adminPushes(db).length, 2)
  } finally { done() }
})

test('a failed push is retried on the next run', async () => {
  const { db, done } = run(world(), '2026-11-14T13:50:00.000Z')
  try {
    const failing = new Proxy(db.client, {
      get(t, p) {
        if (p === 'functions') return { invoke: async () => ({ data: null, error: new Error('OneSignal said no') }) }
        const v = Reflect.get(t, p)
        return typeof v === 'function' ? v.bind(t) : v
      },
    })
    setClient(failing)
    const bad = await runWatchdog({ nowMs: at('13:50') })
    assert.equal(bad.sent.length, 0)
    assert.match(bad.errors[0], /OneSignal said no/)
    assert.deepEqual(db.tables.agent_watchdog_log, [], 'the claim is released so it can be tried again')
    setClient(db.client)
    const good = await runWatchdog({ nowMs: at('13:50') })
    assert.equal(good.sent.length, 1)
    assert.equal(adminPushes(db).length, 1)
  } finally { done() }
})

test('a dry run says what it would send and sends and records nothing', async () => {
  const { db, done } = run(world(), '2026-11-14T13:50:00.000Z')
  try {
    const out = await runWatchdog({ nowMs: at('13:50'), dryRun: true })
    assert.equal(out.planned.length, 1)
    assert.equal(adminPushes(db).length, 0)
    assert.deepEqual(db.tables.agent_watchdog_log, [])
  } finally { done() }
})

test('in quiet hours a run reads nothing and sends nothing', async () => {
  const { db, done } = run(world(), '2026-11-14T22:00:00.000Z')
  try {
    const out = await runWatchdog({ nowMs: Date.parse('2026-11-14T22:00:00.000Z') })
    assert.equal(out.quiet, true)
    assert.equal(adminPushes(db).length, 0)
  } finally { done() }
})

test('only the admins chosen for agent alerts are pushed', async () => {
  const seed = world()
  seed.app_settings = [{ key: 'agent_alert_admins', value: ['adm2'] }]
  const { db, done } = run(seed, '2026-11-14T13:50:00.000Z')
  try {
    await runWatchdog({ nowMs: at('13:50') })
    assert.deepEqual(adminPushes(db)[0].body.userIds, ['adm2'])
  } finally { done() }
})

test('a result waiting for approval is reported as that, not as overdue', async () => {
  const seed = world()
  seed.agent_drafts.push({ id: 'dr1', kind: 'results', status: 'pending', race_date: '2026-11-14', created_at: '2026-11-14T13:25:00.000Z', payload: waitingFor(1) })
  const { db, done } = run(seed, '2026-11-14T13:50:00.000Z')
  try {
    const out = await runWatchdog({ nowMs: at('13:50') })
    assert.deepEqual(out.sent.map(s => s.type), ['approval'])
    assert.equal(adminPushes(db)[0].body.body, 'Race 1 result still waiting for your approval.')
  } finally { done() }
})
