// The race-day agent endpoint, end to end against the in-memory database: the secret, the six actions, what is applied by
// itself and what waits for review, drafts, the log, pushes to admins, approving a racecard, and Replace race.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDb } from './helpers/fakeDb.js'
import { freezeClock } from './helpers/clock.js'
import { seed } from './scenarios/pipeline.js'
import { setClient } from '../supabase/functions/_shared/db.js'
import { handleAgentRequest } from '../supabase/functions/_shared/agentApi.js'
import { storeDraft, readAutoApply, writeAutoApply, logAgent, notifyAdmins, writeAlertAdmins } from '../supabase/functions/_shared/agentData.js'
import { sendPush, buildNotification, withDirectPush, ONESIGNAL_APP_ID } from '../supabase/functions/_shared/sendPush.js'
import { approveRacecard, approveDraft, rejectDraft, replaceRace } from '../supabase/functions/_shared/agentRacecard.js'
import { loadDay } from '../supabase/functions/_shared/adminRaceDays.js'

const SECRET = 'test-secret-0123456789abcdef'
const SOURCES = ['racingpost.com', 'attheraces.com']

function setup({ extra = {} } = {}) {
  const unfreeze = freezeClock('2026-11-14T15:00:00.000Z')
  const data = seed()
  data.seasons = [{ id: 's1', is_active: true }]
  Object.assign(data, extra)
  const db = createFakeDb(data)
  setClient(db.client)
  const log = console.log, err = console.error
  console.log = () => {}; console.error = () => {}
  const call = (body, { auto = false, secret = SECRET } = {}) =>
    handleAgentRequest({ method: 'POST', providedSecret: secret, bodyText: JSON.stringify(body) }, { secret: SECRET, autoApply: auto })
  const done = () => { unfreeze(); console.log = log; console.error = err }
  return { db, call, done }
}
const pushesTo = (db, pred) => db.calls.invoked.filter(c => c.name === 'send-notification' && pred(c.body))
const adminPushes = db => pushesTo(db, b => b.title === 'Silks League agent')
const playerPushes = db => pushesTo(db, b => b.title !== 'Silks League agent')

// A racecard for Saturday 21 Nov (no week exists yet).
const card = (over = {}) => ({
  action: 'submit_racecard_draft', run_id: 'rc-1', date: '2026-11-21', week: { saturday_date: '2026-11-21' },
  races: [
    { venue: 'Ascot', race_name: 'Second Race', race_time: '14:00', runners_declared: 3, runners: [
      { number: 1, horse: 'Alpha', jockey: 'J One', trainer: 'T One', owner_id: '111', owner_name: 'Mr Known', price: '2/1' },
      { number: 2, horse: 'Bravo', jockey: 'J Two', trainer: 'T Two', owner_id: '222', owner_name: 'Mrs New', price: '7/2' },
      { number: 3, horse: 'Charlie', jockey: 'J Three', trainer: 'T Three', owner_id: '222', owner_name: 'Mrs New', price: 'SP' },
    ] },
    { venue: 'Ascot', race_name: 'First Race', race_time: '13:30', runners: [
      { number: 1, horse: 'Delta', jockey: 'J Four', owner_id: '111', price: 'evens' },
      { number: 2, horse: 'Echo', jockey: 'J Five', price: '500/1', silks: { colour: '#1a3a7a', pattern: 'hoops' } },
    ] },
  ], ...over,
})

// ── The secret ───────────────────────────────────────────────────────────
test('nothing gets in without the right secret', async () => {
  const { call, done } = setup()
  try {
    assert.equal((await call({ action: 'get_calendar' }, { secret: '' })).status, 401)
    assert.equal((await call({ action: 'get_calendar' }, { secret: 'wrong' + SECRET })).status, 401)
    const empty = await handleAgentRequest({ method: 'POST', providedSecret: '', bodyText: '{}' }, { secret: '' })
    assert.equal(empty.status, 500, 'a server with no secret set refuses everything, even an empty header')
    assert.equal((await handleAgentRequest({ method: 'GET', providedSecret: SECRET, bodyText: '' }, { secret: SECRET })).status, 405)
    const unknown = await call({ action: 'delete_everything' })
    assert.equal(unknown.status, 400)
    assert.match(unknown.body.error, /get_calendar/)
    assert.equal((await handleAgentRequest({ method: 'POST', providedSecret: SECRET, bodyText: 'nope' }, { secret: SECRET })).status, 400)
  } finally { done() }
})

// ── get_calendar / get_owner_silks ───────────────────────────────────────
test('get_calendar lists the race days with lock times, races and picks status', async () => {
  const { call, done } = setup()
  try {
    const r = await call({ action: 'get_calendar', from: '2026-11-13', days: 14 })
    assert.equal(r.status, 200)
    const keys = r.body.days.map(d => d.key)
    assert.deepEqual(keys, ['festival:d1', 'week:w1'])
    const wk = r.body.days.find(d => d.key === 'week:w1')
    assert.equal(wk.date, '2026-11-14'); assert.equal(wk.week_number, 12); assert.equal(wk.lock_time, '2026-11-14T12:50:00.000Z')
    assert.equal(wk.locked, true); assert.equal(wk.picks_status, 'locked'); assert.equal(wk.race_count, 3)
    assert.equal(wk.races[0].runners.length, 6); assert.equal(wk.races[0].runners[0].horse, 'A Horse 1')
    assert.deepEqual(r.body.saturdays_without_week, ['2026-11-21'])
    assert.equal(r.body.auto_apply, false)
    assert.equal((await call({ action: 'get_calendar', days: 500 })).status, 400)
  } finally { done() }
})

test('get_owner_silks returns the library rows and the ids it does not have', async () => {
  const { call, done } = setup({ extra: { owner_silks: [{ owner_id: '111', owner_name: 'Mr Known', silk_colour: '#c0392b', silk_colour_secondary: null, silk_pattern: 'stripes' }] } })
  try {
    const r = await call({ action: 'get_owner_silks', owner_ids: ['111', '999'] })
    assert.equal(r.body.owners['111'].silk_pattern, 'stripes'); assert.deepEqual(r.body.missing, ['999'])
    assert.equal((await call({ action: 'get_owner_silks', owner_ids: [] })).status, 400)
  } finally { done() }
})

// ── submit_racecard_draft ────────────────────────────────────────────────
test('a racecard becomes a pending draft with flags; a retry is not stored twice; a newer one supersedes it', async () => {
  const { db, call, done } = setup({ extra: { owner_silks: [{ owner_id: '111', owner_name: 'Mr Known', silk_colour: '#c0392b' }] } })
  try {
    const r = await call(card())
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.status, 'pending'); assert.equal(r.body.duplicate, false); assert.equal(r.body.race_day.will_create_week, true)
    assert.deepEqual(r.body.summary, { races: 2, runners: 5, new_owners: 1, missing_prices: 1, odd_prices: 1 })
    const types = r.body.flags.map(f => f.type)
    assert.ok(types.includes('new_owner') && types.includes('missing_price') && types.includes('odd_price') && types.includes('count_mismatch') === false)
    // races are numbered in time order: the 13:30 race is first
    const draft = db.tables.agent_drafts[0]
    assert.equal(draft.payload.races[0].race_time, '13:30')
    assert.equal(adminPushes(db).length, 1); assert.equal(adminPushes(db)[0].body.body, 'Racecard ready to review — Saturday 2026-11-21. 2 races, 1 new owner needs silks, 1 runner with no price, 1 odd price.')
    assert.equal(adminPushes(db)[0].body.url, 'https://silks-league.vercel.app/admin', 'tapping it opens Today')
    assert.equal(playerPushes(db).length, 0, 'players are never told about a draft')

    const again = await call(card())
    assert.equal(again.body.duplicate, true); assert.equal(again.body.draft_id, r.body.draft_id); assert.equal(db.tables.agent_drafts.length, 1)

    const newer = await call(card({ run_id: 'rc-2' }))
    assert.equal(newer.body.duplicate, false)
    assert.deepEqual(db.tables.agent_drafts.map(d => d.status).sort(), ['pending', 'superseded'])
  } finally { done() }
})

test('a racecard is refused, with the reasons, when it is not valid', async () => {
  const { call, done } = setup()
  try {
    const noWeek = await call(card({ week: undefined }))
    assert.equal(noWeek.status, 400); assert.match(noWeek.body.error, /"week"/)
    const c = card()
    c.races[0].runners[1].number = 1
    c.races[0].runners[2].price = 'abc'
    c.races[1].race_time = '1pm'
    const r = await call(c)
    assert.equal(r.status, 400)
    assert.ok(r.body.errors.some(e => /used twice/.test(e)) && r.body.errors.some(e => /not a price/.test(e)) && r.body.errors.some(e => /race_time/.test(e)), r.body.errors.join('\n'))
    assert.equal((await call(card({ date: '2026-11-18', week: { saturday_date: '2026-11-18' } }))).status, 400, 'not a Saturday')
    const tooMany = card(); tooMany.races = Array.from({ length: 8 }, (_, i) => ({ ...tooMany.races[0], race_time: `1${i}:00` }))
    assert.match((await call(tooMany)).body.error, /7 races at most/)
    const mismatch = card(); mismatch.races[0].runners_declared = 5
    assert.ok((await call(mismatch)).body.flags.some(f => f.type === 'count_mismatch'))
  } finally { done() }
})

test('two identical submissions at once store one draft (partial unique index, no ON CONFLICT)', async () => {
  const { db, done } = setup()
  try {
    const row = { kind: 'results', run_id: 'same', race_date: '2026-11-14', payload: { outcomes: [] }, status: 'applied' }
    const [a, b] = await Promise.all([storeDraft({ ...row }), storeDraft({ ...row })])
    assert.equal(db.tables.agent_drafts.length, 1)
    assert.deepEqual([a.duplicate, b.duplicate].sort(), [false, true])
    assert.equal(a.draft.id, b.draft.id)
    // drafts without a run_id are never treated as duplicates of each other
    await storeDraft({ kind: 'results', race_date: '2026-11-14', payload: {}, status: 'pending' }); await storeDraft({ kind: 'results', race_date: '2026-11-14', payload: {}, status: 'pending' })
    assert.equal(db.tables.agent_drafts.length, 3)
  } finally { done() }
})

// ── submit_morning_check ─────────────────────────────────────────────────
const nr = (over = {}) => ({ race_number: 2, horse: 'B Horse 3', confirmed: true, sources: SOURCES, ...over })

test('with automatic actions OFF nothing is applied: it all waits as a draft', async () => {
  const { db, call, done } = setup()
  try {
    const r = await call({ action: 'submit_morning_check', run_id: 'm1', date: '2026-11-14', non_runners: [nr()] }, { auto: false })
    assert.equal(r.status, 200); assert.equal(r.body.auto_apply, false)
    assert.equal(r.body.applied.length, 0); assert.match(r.body.needs_review[0].reasons[0], /switched off/)
    assert.equal(db.tables.runners.find(x => x.id === 'b-3').is_withdrawn, false)
    assert.equal(db.tables.agent_drafts[0].status, 'pending')
  } finally { done() }
})

test('a confirmed non-runner is withdrawn exactly as Admin does it, logged, and pushed to admins only', async () => {
  const { db, call, done } = setup()
  try {
    const r = await call({ action: 'submit_morning_check', run_id: 'm2', date: '2026-11-14', non_runners: [nr()], jockey_changes: [{ race_number: 1, horse: 'A Horse 2', new_jockey: 'New Jockey', confirmed: true, sources: SOURCES }] }, { auto: true })
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.needs_review.length, 0)
    assert.match(r.body.applied[0].text, /^Race 2 non-runner B Horse 3, 1 pick moved to B Horse 1/)
    assert.equal(db.tables.runners.find(x => x.id === 'b-3').is_withdrawn, true)
    const moved = db.tables.picks.find(p => p.id === 'pk-2-u4')
    assert.equal(moved.runner_id, 'b-1'); assert.equal(moved.original_runner_id, 'b-3'); assert.equal(moved.was_replaced, true)
    assert.equal(db.tables.runners.find(x => x.id === 'a-2').jockey, 'New Jockey')
    // players got the same non-runner notice Admin sends; admins got the agent's lines
    const toPlayers = playerPushes(db).filter(p => /Non-runner/.test(p.body.title))
    assert.equal(toPlayers.length, 1); assert.deepEqual(toPlayers[0].body.userIds, ['u4'])
    assert.equal(adminPushes(db).length, 2); assert.ok(adminPushes(db).every(p => p.body.userIds.length === 1 && p.body.userIds[0] === 'u1'))
    const lines = db.tables.agent_log.map(l => l.summary)
    assert.ok(lines.some(l => /Race 2 non-runner B Horse 3, 1 pick moved/.test(l)) && lines.some(l => /jockey change/.test(l)), lines.join('\n'))
    assert.equal(db.tables.agent_drafts[0].status, 'applied')
    // sending the same morning check again changes nothing and does not push again
    const pushes = db.calls.invoked.length
    const dup = await call({ action: 'submit_morning_check', run_id: 'm2', date: '2026-11-14', non_runners: [nr()] }, { auto: true })
    assert.equal(dup.body.duplicate, true); assert.equal(db.calls.invoked.length, pushes)
    // a different run reporting the same horse finds it already withdrawn
    const later = await call({ action: 'submit_morning_check', run_id: 'm3', date: '2026-11-14', non_runners: [nr()] }, { auto: true })
    assert.equal(later.body.skipped.length, 1); assert.match(later.body.skipped[0].text, /already withdrawn/)
  } finally { done() }
})

test('unconfirmed, single-source, unknown-horse and meeting items are drafts, and nothing about them changes', async () => {
  const { db, call, done } = setup()
  try {
    const before = JSON.stringify(db.snapshot())
    const r = await call({
      action: 'submit_morning_check', run_id: 'm4', date: '2026-11-14',
      non_runners: [nr({ confirmed: false }), nr({ horse: 'B Horse 4', sources: ['racingpost.com'] }), nr({ horse: 'Nobody Known' }), nr({ horse: 'B Horse 2', number: 4 })],
      meeting_issues: [{ venue: 'Cheltenham', type: 'inspection', detail: 'Inspection at 08:00', confirmed: true, sources: SOURCES }],
    }, { auto: true })
    assert.equal(r.body.applied.length, 0); assert.equal(r.body.needs_review.length, 5)
    const why = r.body.needs_review.map(x => x.reasons.join(' | ')).join('\n')
    assert.match(why, /did not mark it confirmed/); assert.match(why, /only 1 source/); assert.match(why, /no runner called Nobody Known/); assert.match(why, /different horses/); assert.match(why, /admin decides/)
    const after = db.snapshot()
    delete after.agent_drafts; delete after.agent_log; delete after.app_settings
    const strip = s => { const o = JSON.parse(s); delete o.agent_drafts; delete o.agent_log; delete o.app_settings; return o }
    assert.deepEqual(after, strip(before), 'no runner, pick or score was touched')
    assert.equal(db.tables.agent_drafts[0].status, 'pending')
  } finally { done() }
})

test('an admin approving the pending draft applies the waiting items through the same code', async () => {
  const { db, call, done } = setup()
  try {
    await call({ action: 'submit_morning_check', run_id: 'm5', date: '2026-11-14', non_runners: [nr({ confirmed: false })], meeting_issues: [{ venue: 'Cheltenham', type: 'inspection', confirmed: false }] }, { auto: true })
    const id = db.tables.agent_drafts[0].id
    const r = await approveDraft(id, { userId: 'u1' })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(db.tables.runners.find(x => x.id === 'b-3').is_withdrawn, true)
    assert.equal(db.tables.agent_drafts[0].status, 'applied')
    assert.ok(db.tables.agent_log.some(l => l.actor === 'admin' && /non-runner B Horse 3/.test(l.summary)))
    assert.deepEqual((await rejectDraft(id)).ok, false, 'a finished draft cannot be rejected')
  } finally { done() }
})

// ── submit_results ───────────────────────────────────────────────────────
const placed = (...names) => names.map((horse, i) => ({ position: i + 1, horse }))
const result = (over = {}) => ({ race_number: 1, weighed_in: true, confirmed: true, sources: SOURCES, positions: placed('A Horse 1', 'A Horse 3', 'A Horse 2', 'A Horse 4'), ...over })

test('a confirmed weighed-in result is saved, scored, bonused and announced like Admin does it', async () => {
  const { db, call, done } = setup()
  try {
    const r = await call({ action: 'submit_results', run_id: 'r1', date: '2026-11-14', results: [result()] }, { auto: true })
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.needs_review.length, 0)
    assert.match(r.body.applied[0].text, /^Race 1 result entered \(weighed in\)/)
    assert.deepEqual(db.tables.results.map(x => `${x.position}:${x.horse_name}`).sort(), ['1:A Horse 1', '2:A Horse 3', '3:A Horse 2', '4:A Horse 4'])
    assert.equal(db.tables.scores.filter(s => s.race_id === 'r1').length, 6)
    assert.ok(db.tables.bonus_awards.length > 0, 'bonuses were brought up to date')
    assert.equal(playerPushes(db).filter(p => p.body.title === "Result's in").length, 6, 'one result teaser per player who picked')
    assert.ok(db.tables.agent_log.some(l => /Race 1 result entered/.test(l.summary)))
    assert.match(adminPushes(db)[0].body.body, /Race 1 result entered/)
    // the same result again is recognised, not saved twice
    const again = await call({ action: 'submit_results', run_id: 'r2', date: '2026-11-14', results: [result()] }, { auto: true })
    assert.match(again.body.skipped[0].text, /already entered/)
    assert.equal(db.tables.results.length, 4)
    // the last race of the day sends the end-of-day message once
    await call({ action: 'submit_results', run_id: 'r3', date: '2026-11-14', results: [result({ race_number: 2, positions: placed('B Horse 1', 'B Horse 2') }), result({ race_number: 3, positions: placed('C Horse 4', 'C Horse 2', 'C Horse 7', 'C Horse 1') })] }, { auto: true })
    assert.equal(playerPushes(db).filter(p => p.body.title === 'Final results').length, 1)
  } finally { done() }
})

test('an enquiry, a dead heat, a provisional result or a wrong horse is a draft and saves nothing', async () => {
  const { db, call, done } = setup()
  try {
    const r = await call({
      action: 'submit_results', run_id: 'r4', date: '2026-11-14',
      results: [result({ enquiry: true }), result({ race_number: 2, weighed_in: false, positions: placed('B Horse 1', 'B Horse 2') }), result({ race_number: 3, positions: placed('C Horse 1', 'Not A Horse', 'C Horse 3', 'C Horse 4') }), result({ race_number: 3, dead_heat: true, positions: [{ position: 1, horse: 'C Horse 1' }, { position: 1, horse: 'C Horse 2' }, { position: 3, horse: 'C Horse 3' }] })],
    }, { auto: true })
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.applied.length, 0)
    const why = r.body.needs_review.map(x => x.reasons.join(' | ')).join('\n')
    assert.match(why, /enquiry/); assert.match(why, /not weighed in/); assert.match(why, /no runner called Not A Horse/); assert.match(why, /dead heat/)
    assert.equal(db.tables.results.length, 0); assert.equal(db.tables.scores.length, 0)
    assert.equal(playerPushes(db).length, 0)
    assert.equal(adminPushes(db).length, 1, 'one push for the whole submission')
    assert.match(adminPushes(db)[0].body.body, /^4 results ready to approve — e\.g\. Race 1, A Horse 1 \(stewards' enquiry\)\.$/)
    // duplicate positions without dead_heat are refused outright
    const dup = await call({ action: 'submit_results', run_id: 'r5', date: '2026-11-14', results: [result({ positions: [{ position: 1, horse: 'A Horse 1' }, { position: 1, horse: 'A Horse 2' }] })] }, { auto: true })
    assert.equal(dup.status, 400); assert.match(dup.body.errors[0], /dead_heat/)
  } finally { done() }
})

test('a late non-runner in a result is withdrawn first, then the result is saved', async () => {
  const { db, call, done } = setup()
  try {
    const r = await call({ action: 'submit_results', run_id: 'r6', date: '2026-11-14', results: [result({ race_number: 2, positions: placed('B Horse 1', 'B Horse 2'), late_non_runners: [{ horse: 'B Horse 3' }] })] }, { auto: true })
    assert.equal(r.body.needs_review.length, 0, JSON.stringify(r.body)); assert.match(r.body.applied[0].text, /late non-runner withdrawn first/)
    assert.equal(db.tables.runners.find(x => x.id === 'b-3').is_withdrawn, true)
    assert.equal(db.tables.picks.find(p => p.id === 'pk-2-u4').runner_id, 'b-1')
    assert.equal(db.tables.scores.filter(s => s.race_id === 'r2').length, 6)
  } finally { done() }
})

test('an admin can approve a pending result draft (an enquiry that was resolved)', async () => {
  const { db, call, done } = setup()
  try {
    await call({ action: 'submit_results', run_id: 'r7', date: '2026-11-14', results: [result({ enquiry: true })] }, { auto: true })
    const r = await approveDraft(db.tables.agent_drafts[0].id, { userId: 'u1' })
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(db.tables.results.length, 4)
    assert.equal(db.tables.agent_drafts[0].status, 'applied')
  } finally { done() }
})

test('festival day results use the festival tables and keep festival_day_points in step', async () => {
  const { db, call, done } = setup()
  try {
    const r = await call({ action: 'submit_results', run_id: 'f1', date: '2026-11-13', results: [result({ positions: placed('FA Horse 1', 'FA Horse 2', 'FA Horse 3', 'FA Horse 4') })] }, { auto: true })
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.applied.length, 1)
    assert.equal(db.tables.festival_results.length, 4); assert.equal(db.tables.festival_scores.filter(s => s.festival_race_id === 'fr1').length, 6)
    assert.equal(db.tables.festival_day_points.length, 6, 'festival_day_points written together with festival_scores')
  } finally { done() }
})

// ── backfill_owners ──────────────────────────────────────────────────────
test('backfill_owners adds owners to existing runners and seeds the silks library from silks already entered', async () => {
  const data = seed()
  Object.assign(data.runners.find(r => r.id === 'a-1'), { silk_colour: '#1a3a7a', silk_pattern: 'hoops' })
  Object.assign(data.runners.find(r => r.id === 'b-1'), { silk_colour: '#1a3a7a', silk_pattern: 'hoops' })
  Object.assign(data.runners.find(r => r.id === 'c-1'), { silk_colour: '#c0392b' })
  const { db, call, done } = setup({ extra: { runners: data.runners } })
  try {
    const listed = await call({ action: 'backfill_owners', list_missing: true })
    assert.deepEqual(listed.body.horses.map(h => h.horse), ['A Horse 1', 'B Horse 1', 'C Horse 1'])
    const r = await call({ action: 'backfill_owners', owners: [
      { horse: 'a horse 1', owner_id: '111', owner_name: 'Mr Known' }, { horse: 'B Horse 1', owner_id: '111', owner_name: 'Mr Known' }, { horse: 'C Horse 1', owner_id: '333', owner_name: 'Ms Other' }, { horse: 'Ghost', owner_id: '444' },
    ] })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.updated_runners, 3); assert.equal(r.body.library_added, 2); assert.deepEqual(r.body.unmatched, ['Ghost'])
    assert.equal(db.tables.runners.find(x => x.id === 'a-1').owner_id, '111')
    const lib = Object.fromEntries(db.tables.owner_silks.map(o => [o.owner_id, o]))
    assert.equal(lib['111'].silk_colour, '#1a3a7a'); assert.equal(lib['111'].silk_pattern, 'hoops'); assert.equal(lib['333'].silk_colour, '#c0392b')
    // an owner an admin already chose silks for is left alone, and an owner already on a runner is not overwritten
    const again = await call({ action: 'backfill_owners', owners: [{ horse: 'A Horse 1', owner_id: '999', owner_name: 'Someone Else' }] })
    assert.equal(again.body.updated_runners, 0); assert.equal(db.tables.runners.find(x => x.id === 'a-1').owner_id, '111')
    assert.equal((await call({ action: 'backfill_owners', owners: [{ horse: 'x' }] })).status, 400)
  } finally { done() }
})

// ── Approving a racecard ─────────────────────────────────────────────────
test('approving a racecard creates the week, imports races and runners with owners and silks, and sends picks-open', async () => {
  const { db, call, done } = setup({ extra: { owner_silks: [{ owner_id: '111', owner_name: 'Mr Known', silk_colour: '#c0392b', silk_pattern: 'stripes' }] } })
  try {
    const sub = await call(card())
    const id = sub.body.draft_id
    // silks for the new owner are picked on the review screen and saved to the library
    db.tables.owner_silks.push({ owner_id: '222', owner_name: 'Mrs New', silk_colour: '#27ae60', silk_colour_secondary: '#f1c40f', silk_pattern: 'cross' })
    const r = await approveRacecard(id, { userId: 'u1' })
    assert.equal(r.ok, true, JSON.stringify(r))
    const week = db.tables.race_weeks.find(w => w.saturday_date === '2026-11-21')
    assert.ok(week && week.week_number === 3, 'numbered like Admin does: weeks already in the season + 1')
    const races = db.tables.races.filter(x => x.race_week_id === week.id).sort((a, b) => a.race_number - b.race_number)
    assert.deepEqual(races.map(x => `${x.race_number} ${x.race_time} ${x.race_name}`), ['1 13:30 First Race', '2 14:00 Second Race'])
    const run = name => db.tables.runners.find(x => x.horse_name === name)
    assert.equal(run('Alpha').silk_colour, '#c0392b'); assert.equal(run('Alpha').owner_id, '111'); assert.equal(run('Alpha').odds_decimal, 3)
    assert.equal(run('Bravo').silk_pattern, 'cross'); assert.equal(run('Bravo').owner_name, 'Mrs New')
    assert.equal(run('Echo').silk_colour, '#1a3a7a'); assert.equal(run('Charlie').odds_decimal ?? null, null)
    assert.equal(run('Delta').odds_fractional, 'evens')
    assert.ok(db.tables.owner_silks.length >= 2 && !db.tables.owner_silks.some(o => o.owner_id === 'undefined'))
    assert.equal(playerPushes(db).filter(p => p.body.broadcast).length, 1, 'picks-open went to everyone')
    assert.ok(week.picks_open_notified_at)
    assert.equal(db.tables.agent_drafts.find(d => d.id === id).status, 'applied')
    assert.ok(db.tables.agent_log.some(l => l.actor === 'admin' && /Racecard approved/.test(l.summary)))
    assert.equal((await approveRacecard(id)).ok, false, 'a second tap does nothing')
    // a second racecard for a day that now has races cannot be imported on top of it
    const second = await call(card({ run_id: 'rc-9' }))
    assert.ok(second.body.flags.some(f => f.type === 'day_has_races'))
    const blocked = await approveRacecard(second.body.draft_id)
    assert.equal(blocked.ok, false); assert.match(blocked.error, /already has 2 races/)
    assert.equal(db.tables.agent_drafts.find(d => d.id === second.body.draft_id).status, 'pending')
  } finally { done() }
})

test('rejecting a racecard changes no race day', async () => {
  const { db, call, done } = setup()
  try {
    const sub = await call(card())
    assert.equal((await rejectDraft(sub.body.draft_id, { userId: 'u1', note: 'wrong card' })).ok, true)
    assert.equal(db.tables.race_weeks.some(w => w.saturday_date === '2026-11-21'), false)
    assert.equal(db.tables.agent_drafts[0].status, 'rejected')
  } finally { done() }
})

// ── Replace race ─────────────────────────────────────────────────────────
const newRace = { venue: 'Kempton', race_name: 'Replacement', race_time: '15:10', runners: [
  { horse_number: 1, horse_name: 'New One', jockey: 'X', odds_fractional: '2/1', odds_decimal: 3 }, { horse_number: 2, horse_name: 'New Two', jockey: 'Y', odds_fractional: '5/1', odds_decimal: 6 },
] }

test('Replace race before the lock clears that race\'s picks, keeps everything else, and tells the players', async () => {
  const unfreeze = freezeClock('2026-11-14T09:00:00.000Z')
  const log = console.log; console.log = () => {}
  try {
    const db = createFakeDb(seed()); setClient(db.client)
    const { day } = await loadDay('week:w1')
    const race = db.tables.races.find(r => r.id === 'r2')
    const r = await replaceRace(day, race, newRace)
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(db.tables.picks.filter(p => p.race_id === 'r2').length, 0)
    assert.equal(db.tables.picks.filter(p => p.race_id === 'r1').length, 6); assert.equal(db.tables.picks.filter(p => p.race_id === 'r3').length, 6)
    assert.deepEqual(db.tables.runners.filter(x => x.race_id === 'r2').map(x => x.horse_name).sort(), ['New One', 'New Two'])
    const row = db.tables.races.find(x => x.id === 'r2')
    assert.equal(row.venue, 'Kempton'); assert.equal(row.race_number, 2); assert.equal(row.runner_count_at_lock, null)
    const notice = db.calls.invoked.find(c => /replaced/.test(c.body.body))
    assert.match(notice.body.body, /^Race 2 has been replaced\. Pick again before .+\.$/)
    assert.equal(notice.body.userIds.length, 6)
    assert.ok(db.tables.agent_log.some(l => l.action === 'race_replaced'))
  } finally { unfreeze(); console.log = log }
})

test('Replace race is refused once picks have locked, and after a result', async () => {
  const { db, done } = setup()
  try {
    const { day } = await loadDay('week:w1')
    const before = JSON.stringify(db.snapshot())
    const r = await replaceRace(day, db.tables.races.find(x => x.id === 'r2'), newRace)
    assert.equal(r.ok, false); assert.match(r.error, /Abandon race/)
    assert.equal(JSON.stringify(db.snapshot()), before, 'nothing changed')
    const early = freezeClock('2026-11-14T09:00:00.000Z')
    db.tables.results.push({ race_id: 'r2', position: 1, horse_name: 'B Horse 1' })
    const r2 = await replaceRace(day, db.tables.races.find(x => x.id === 'r2'), newRace, { nowMs: Date.parse('2026-11-14T09:00:00Z') })
    early(); assert.equal(r2.ok, false); assert.match(r2.error, /already has a result/)
  } finally { done() }
})

// ── Owner library on the runner editor, and the review screen's edits ────
import { saveRunner, runnerToForm } from '../supabase/functions/_shared/adminRaceDays.js'
import { editDraftRunner, editDraftRace, removeDraftRunner, racecardFlags } from '../supabase/functions/_shared/agentRacecard.js'
import { validateRacecard } from '../supabase/functions/_shared/agentValidate.js'

test('saving silks on a runner that has an owner puts them in the owner silks library', async () => {
  const data = seed()
  Object.assign(data.runners.find(r => r.id === 'a-1'), { owner_id: '555', owner_name: 'Mr Five' })
  const { db, done } = setup({ extra: { runners: data.runners } })
  try {
    const runner = db.tables.runners.find(r => r.id === 'a-1')
    const form = { ...runnerToForm(runner), colour: '#1a3a7a', colour2: '#f1c40f', pattern: 'hoops' }
    assert.equal(form.owner_id, '555')
    assert.equal((await saveRunner('week', 'r1', 'a-1', form)).ok, true)
    const { id: _id, updated_at, ...lib } = db.tables.owner_silks[0]
    assert.ok(updated_at)
    assert.deepEqual(lib, { owner_id: '555', owner_name: 'Mr Five', silk_colour: '#1a3a7a', silk_colour_secondary: '#f1c40f', silk_pattern: 'hoops' })
    // saving the runner again with different silks updates the same row; a runner with no owner adds nothing
    await saveRunner('week', 'r1', 'a-1', { ...form, colour: '#c0392b' })
    assert.equal(db.tables.owner_silks.length, 1); assert.equal(db.tables.owner_silks[0].silk_colour, '#c0392b')
    await saveRunner('week', 'r1', 'a-2', { ...runnerToForm(db.tables.runners.find(r => r.id === 'a-2')), colour: '#c0392b' })
    assert.equal(db.tables.owner_silks.length, 1)
    // the runner's own owner columns are untouched by a save
    assert.equal(db.tables.runners.find(r => r.id === 'a-1').owner_id, '555')
  } finally { done() }
})

test('editing a draft on the review screen is checked, and flags follow the edit', () => {
  const checked = validateRacecard(card())
  assert.equal(checked.ok, true)
  const payload = checked.value
  const lib = {}
  const missing = racecardFlags(payload, { library: lib }).filter(f => f.type === 'missing_price')
  assert.equal(missing.length, 1)
  const fixed = editDraftRunner(payload, 1, 2, { price: '9/2' })
  assert.equal(fixed.ok, true); assert.equal(fixed.payload.races[1].runners[2].price_decimal, 5.5)
  assert.equal(racecardFlags(fixed.payload, { library: lib }).filter(f => f.type === 'missing_price').length, 0)
  assert.equal(payload.races[1].runners[2].price, null, 'the original is not changed')
  assert.match(editDraftRunner(payload, 1, 2, { price: 'abc' }).error, /not a price/)
  assert.match(editDraftRunner(payload, 1, 2, { number: '1' }).error, /already used/)
  assert.match(editDraftRunner(payload, 1, 2, { horse: ' ' }).error, /needs a name/)
  assert.equal(removeDraftRunner(payload, 1, 2).payload.races[1].runners.length, 2)
  assert.match(removeDraftRunner(payload, 0, 0).error, /at least 2/)
  const moved = editDraftRace(payload, 0, { race_time: '15:00' })
  assert.deepEqual(moved.payload.races.map(r => r.race_time), ['14:00', '15:00'], 'races stay in time order')
  assert.match(editDraftRace(payload, 0, { race_time: '25:00' }).error, /13:50/)
  // an owner's silks being saved clears the new-owner flag at once
  assert.equal(racecardFlags(payload, { library: {} }).some(f => f.type === 'new_owner' && f.owner_id === '222'), true)
  assert.equal(racecardFlags(payload, { library: { 222: { silk_colour: '#27ae60' }, 111: { silk_colour: '#c0392b' } } }).some(f => f.type === 'new_owner'), false)
})

// ── The Admin "Automatic mode" switch (app_settings.agent_auto_apply) ──────
const resultsBody = () => ({ action: 'submit_results', run_id: 'rs-sw', date: '2026-11-14', results: [result()] })

test('the switch row decides: on applies a confirmed result, off makes it a draft, and it beats the secret', async () => {
  const on = setup({ extra: { app_settings: [{ key: 'agent_auto_apply', value: true }] } })
  try {
    const r = await on.call(resultsBody(), { auto: false })           // secret says off, switch says on
    assert.equal(r.status, 200); assert.equal(r.body.auto_apply, true)
    assert.equal(r.body.applied.length, 1)
  } finally { on.done() }
  const off = setup({ extra: { app_settings: [{ key: 'agent_auto_apply', value: false }] } })
  try {
    const r = await off.call(resultsBody(), { auto: true })           // secret says on, switch says off
    assert.equal(r.body.auto_apply, false)
    assert.equal(r.body.applied.length, 0); assert.equal(r.body.needs_review.length, 1)
    assert.equal(r.body.status, 'pending')
  } finally { off.done() }
})

test('with no switch row the AGENT_AUTO_APPLY secret is the fallback', async () => {
  const a = setup()
  try {
    assert.equal((await a.call({ action: 'get_calendar' }, { auto: true })).body.auto_apply, true)
    assert.equal((await a.call({ action: 'get_calendar' }, { auto: false })).body.auto_apply, false)
  } finally { a.done() }
})

test('turning it on or off in Admin changes only new submissions and is logged', async () => {
  const { db, call, done } = setup({ extra: { app_settings: [{ key: 'agent_auto_apply', value: false }] } })
  try {
    const held = await call(resultsBody())                           // off: waits as a draft
    assert.equal(held.body.status, 'pending')
    assert.deepEqual(await writeAutoApply(true, { userId: 'u-admin', by: 'Jack' }), { ok: true, on: true })
    assert.equal(db.tables.app_settings[0].value, true); assert.equal(db.tables.app_settings[0].updated_by, 'u-admin')
    const log = db.tables.agent_log.find(l => l.action === 'auto_on')
    assert.equal(log.actor, 'admin'); assert.equal(log.summary, 'Automatic mode turned on by Jack')
    assert.equal(db.tables.agent_drafts.find(d => d.id === held.body.draft_id).status, 'pending')   // the draft already waiting stays waiting
    const live = await call({ ...resultsBody(), run_id: 'rs-sw-2' })
    assert.equal(live.body.applied.length, 1)                        // a new one now goes live
    await writeAutoApply(false, { userId: 'u-admin', by: 'Jack' })
    assert.equal(db.tables.agent_log.some(l => l.summary === 'Automatic mode turned off by Jack'), true)
  } finally { done() }
})

test('the switch row missing is reported to Admin, and an unreadable setting fails safe to OFF', async () => {
  const { done } = setup()
  try {
    const w = await writeAutoApply(true, { userId: 'u-admin', by: 'Jack' })
    assert.equal(w.ok, false); assert.match(w.error, /migration/)
    const fail = { from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { code: 'XX000', message: 'boom' } }) }; return q } }
    setClient(fail)
    assert.deepEqual(await readAutoApply(true), { on: false, source: 'error' })   // even with the secret on
    const gone = { from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'no table' } }) }; return q } }
    setClient(gone)
    assert.deepEqual(await readAutoApply(true), { on: true, source: 'secret' })   // table not created yet: the secret as before
  } finally { done() }
})

// ── Pushes to admins when something is left waiting ────────────────────────
const bodies = db => adminPushes(db).map(p => p.body.body)

test('results held only because automatic mode is off: one push naming the winner, no reason added', async () => {
  const { db, call, done } = setup()
  try {
    const r = await call({ action: 'submit_results', run_id: 'p1', date: '2026-11-14', results: [result()] }, { auto: false })
    assert.equal(r.body.needs_review.length, 1)
    assert.deepEqual(bodies(db), ['Race 1 result ready to approve — A Horse 1.'])
    assert.equal(adminPushes(db)[0].body.url, 'https://silks-league.vercel.app/admin')
    assert.equal(playerPushes(db).length, 0)
    assert.equal(adminPushes(db)[0].body.userIds.length, 1)                  // admins only (the seed has one)
    // the same run again: nothing more is sent
    const again = await call({ action: 'submit_results', run_id: 'p1', date: '2026-11-14', results: [result()] }, { auto: false })
    assert.equal(again.body.duplicate, true); assert.equal(adminPushes(db).length, 1)
  } finally { done() }
})

test('results held for a real reason say why; several held results are one push, not one each', async () => {
  const { db, call, done } = setup()
  try {
    await call({ action: 'submit_results', run_id: 'p2', date: '2026-11-14', results: [result({ enquiry: true })] }, { auto: true })
    await call({ action: 'submit_results', run_id: 'p3', date: '2026-11-14', results: [result({ confirmed: false })] }, { auto: true })
    await call({ action: 'submit_results', run_id: 'p4', date: '2026-11-14', results: [result({ race_number: 1, dead_heat: true, positions: [{ position: 1, horse: 'A Horse 1' }, { position: 1, horse: 'A Horse 3' }, { position: 3, horse: 'A Horse 2' }] }), result({ race_number: 2, objection: true, positions: placed('B Horse 1', 'B Horse 2') })] }, { auto: true })
    const b = bodies(db)
    assert.equal(b.length, 3, 'one push per submission')
    assert.equal(b[0], "Race 1 result ready to approve — A Horse 1 (stewards' enquiry).")
    assert.match(b[1], /^Race 1 result ready to approve — A Horse 1 \(.*confirm/)
    assert.match(b[2], /^2 results ready to approve — e\.g\. Race 1, A Horse \d \(dead heat/)
  } finally { done() }
})

test('morning check items held: one push with a count and an example; nothing to report sends nothing', async () => {
  const { db, call, done } = setup()
  try {
    const one = await call({ action: 'submit_morning_check', run_id: 'p5', date: '2026-11-14', non_runners: [nr()] }, { auto: false })
    assert.equal(one.body.needs_review.length, 1)
    const three = await call({ action: 'submit_morning_check', run_id: 'p6', date: '2026-11-14', non_runners: [nr({ horse: 'A Horse 2', race_number: 1 })], jockey_changes: [{ race_number: 1, horse: 'A Horse 3', new_jockey: 'X Rider', confirmed: true, sources: SOURCES }], meeting_issues: [{ venue: 'Cheltenham', type: 'inspection', confirmed: true, sources: SOURCES }] }, { auto: false })
    assert.equal(three.body.needs_review.length, 3)
    assert.deepEqual(bodies(db), ['1 item to check — Race 2 non-runner B Horse 3.', '3 items to check — e.g. Race 1 non-runner A Horse 2.'])
    const sent = adminPushes(db).length
    const empty = await call({ action: 'submit_morning_check', run_id: 'p7', date: '2026-11-14' }, { auto: true })
    assert.equal(empty.status, 200); assert.equal(adminPushes(db).length, sent, 'an empty morning check sends nothing')
    const dup = await call({ action: 'submit_morning_check', run_id: 'p5', date: '2026-11-14', non_runners: [nr()] }, { auto: false })
    assert.equal(dup.body.duplicate, true); assert.equal(adminPushes(db).length, sent, 'a duplicate sends nothing')
  } finally { done() }
})

test('a duplicate racecard sends nothing, and the agent log still has its line', async () => {
  const { db, call, done } = setup()
  try {
    await call(card()); await call(card())
    assert.equal(adminPushes(db).length, 1)
    assert.equal(db.tables.agent_log.filter(l => /Racecard received/.test(l.summary)).length, 1)
  } finally { done() }
})

// ── Pushes sent straight to OneSignal (not through send-notification) ──────
const okFetch = () => {
  const sent = []
  const fn = async (url, init) => { sent.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: 'os-1', recipients: 2 }), { status: 200 }) }
  return { fn, sent }
}
const onFail = ({ reason, title }) => logAgent({ action: 'push_failed', ok: false, summary: `Push failed: ${reason}${title ? ` (${title})` : ''}` })

test('the OneSignal request is exactly what send-notification builds', () => {
  assert.deepEqual(buildNotification({ userIds: ['a', 'b'], title: 'T', body: 'B', url: 'https://x/y' }), {
    app_id: ONESIGNAL_APP_ID, target_channel: 'push', headings: { en: 'T' }, contents: { en: 'B' }, url: 'https://x/y', include_aliases: { external_id: ['a', 'b'] },
  })
  assert.deepEqual(buildNotification({ broadcast: true, title: 'T', body: 'B' }), {
    app_id: ONESIGNAL_APP_ID, target_channel: 'push', headings: { en: 'T' }, contents: { en: 'B' }, included_segments: ['Active Subscriptions'],
  })
  assert.throws(() => buildNotification({ title: 'T', body: 'B' }), /userIds array or broadcast/)
  assert.throws(() => buildNotification({ userIds: ['a'], broadcast: true, title: 'T', body: 'B' }), /not both/)
  assert.throws(() => buildNotification({ userIds: ['a'], title: 'T' }), /title and body/)
})

test('sendPush: key in the header, plain reasons when OneSignal or the network fails', async () => {
  const f = okFetch()
  const out = await sendPush({ userIds: ['a'], title: 'T', body: 'B' }, { restApiKey: 'KEY', fetchFn: f.fn })
  assert.deepEqual(out, { ok: true, id: 'os-1', recipients: 2 })
  assert.equal(f.sent[0].url, 'https://api.onesignal.com/notifications'); assert.equal(f.sent[0].headers.Authorization, 'Key KEY')
  await assert.rejects(sendPush({ userIds: ['a'], title: 'T', body: 'B' }, { restApiKey: '', fetchFn: f.fn }), /ONESIGNAL_REST_API_KEY is not set/)
  const denied = async () => new Response(JSON.stringify({ errors: ['Access denied. Please include an Authorization header'] }), { status: 403 })
  await assert.rejects(sendPush({ userIds: ['a'], title: 'T', body: 'B' }, { restApiKey: 'K', fetchFn: denied }), /OneSignal answered 403: .*Access denied/)
  const down = async () => { throw new Error('getaddrinfo ENOTFOUND') }
  await assert.rejects(sendPush({ userIds: ['a'], title: 'T', body: 'B' }, { restApiKey: 'K', fetchFn: down }), /could not reach OneSignal \(getaddrinfo/)
})

test('agent-api pushes go straight to OneSignal: admin alert, player teasers, end of day. Nothing calls send-notification', async () => {
  const { db, call, done } = setup()
  const f = okFetch()
  const { setClient: set } = await import('../supabase/functions/_shared/db.js')
  set(withDirectPush(db.client, { restApiKey: 'KEY', fetchFn: f.fn, onFail }))
  try {
    await call(card())
    const r = await call({ action: 'submit_results', run_id: 'dp1', date: '2026-11-14', results: [result()] }, { auto: true })
    assert.equal(r.status, 200); assert.equal(r.body.applied.length, 1)
    assert.deepEqual(db.calls.invoked.filter(c => c.name === 'send-notification').map(c => c.body.title), [], 'no call to the send-notification function')
    const admin = f.sent.find(p => p.body.headings.en === 'Silks League agent' && /Racecard ready/.test(p.body.contents.en))
    assert.ok(admin, 'the admin alert reached OneSignal')
    assert.deepEqual(admin.body.include_aliases.external_id, ['u1']); assert.equal(admin.body.url, 'https://silks-league.vercel.app/admin')
    assert.equal(admin.headers.Authorization, 'Key KEY')
    const teasers = f.sent.filter(p => p.body.headings.en === "Result's in")
    assert.equal(teasers.length, 6, 'one result teaser per player who picked, same as before')
    assert.ok(teasers.every(t => t.body.url === 'https://silks-league.vercel.app/results'))
    assert.deepEqual(db.tables.agent_log.filter(l => /^Push failed/.test(l.summary)).map(l => l.summary), [], 'no push failures')
  } finally { done() }
})

test('a push that fails is logged as "Push failed: ..." and never breaks the request', async () => {
  const { db, call, done } = setup()
  const denied = async () => new Response(JSON.stringify({ errors: ['Access denied'] }), { status: 403 })
  const { setClient: set } = await import('../supabase/functions/_shared/db.js')
  set(withDirectPush(db.client, { restApiKey: 'KEY', fetchFn: denied, onFail }))
  try {
    const r = await call({ action: 'submit_results', run_id: 'dp2', date: '2026-11-14', results: [result()] }, { auto: true })
    assert.equal(r.status, 200); assert.equal(r.body.applied.length, 1, 'the result still went live')
    assert.equal(db.tables.results.length, 4)
    const bad = db.tables.agent_log.filter(l => /^Push failed/.test(l.summary))
    assert.ok(bad.every(l => l.ok === false))
    assert.ok(bad.length >= 2, 'the failures are in the log')
    assert.ok(bad.every(l => /^Push failed: OneSignal answered 403/.test(l.summary)), bad.map(l => l.summary).join('\n'))
    // no OneSignal key at all: the same, with the reason spelled out
    const f2 = withDirectPush(db.client, { restApiKey: '', onFail })
    set(f2)
    await call(card())
    assert.ok(db.tables.agent_log.some(l => l.ok === false && /Push failed: ONESIGNAL_REST_API_KEY is not set/.test(l.summary)))
  } finally { done() }
})

// ── Which admins get the agent's alerts (app_settings.agent_alert_admins) ──
const twoAdmins = db => { db.tables.profiles.find(p => p.id === 'u2').is_admin = true }   // u1 and u2 are admins; u3 is a player
const alertTo = db => adminPushes(db).map(p => p.body.userIds)

test('alerts go only to the chosen admins who are still admins; player pushes are unaffected', async () => {
  const { db, call, done } = setup({ extra: { app_settings: [{ key: 'agent_alert_admins', value: ['u1', 'u3', 'gone-user'] }] } })
  try {
    twoAdmins(db)                                                  // u3 is listed but is not an admin, 'gone-user' does not exist
    assert.deepEqual(await notifyAdmins('Something to check'), { ok: true, sent: 1 })
    assert.deepEqual(alertTo(db), [['u1']])
    // an automatic result: the admin alert goes to u1 only, the result teasers still go to the players
    await call({ action: 'submit_results', run_id: 'al1', date: '2026-11-14', results: [result()] }, { auto: true })
    assert.ok(alertTo(db).every(ids => ids.length === 1 && ids[0] === 'u1'))
    assert.equal(playerPushes(db).filter(p => p.body.title === "Result's in").length, 6)
  } finally { done() }
})

test('no list means every admin; an empty list means nobody, and that is not a failure', async () => {
  const none = setup()                                             // no app_settings row at all
  try {
    twoAdmins(none.db)
    assert.deepEqual(await notifyAdmins('Hello'), { ok: true, sent: 2 })
    assert.deepEqual(alertTo(none.db), [['u1', 'u2']])
  } finally { none.done() }
  const empty = setup({ extra: { app_settings: [{ key: 'agent_alert_admins', value: [] }] } })
  try {
    twoAdmins(empty.db)
    assert.deepEqual(await notifyAdmins('Hello'), { ok: true, sent: 0 })
    assert.equal(adminPushes(empty.db).length, 0)
    const r = await empty.call(card())                             // the request itself still succeeds, the draft is saved
    assert.equal(r.status, 200); assert.equal(empty.db.tables.agent_drafts.length, 1)
    assert.equal(adminPushes(empty.db).length, 0)
  } finally { empty.done() }
})

test('Admin changes who gets alerts: saved, logged, and the next alert follows it', async () => {
  const { db, done } = setup({ extra: { app_settings: [{ key: 'agent_alert_admins', value: ['u1'] }] } })
  try {
    twoAdmins(db)
    const r = await writeAlertAdmins(['u1', 'u2', 'u2'], { userId: 'u1', by: 'Jack', names: ['Jack', 'Ollie'] })
    assert.deepEqual(r, { ok: true, ids: ['u1', 'u2'] })
    assert.deepEqual(db.tables.app_settings[0].value, ['u1', 'u2'])
    const log = db.tables.agent_log.find(l => l.action === 'alert_admins')
    assert.equal(log.actor, 'admin'); assert.equal(log.summary, 'Agent alerts now go to Jack, Ollie (changed by Jack)')
    await notifyAdmins('x'); assert.deepEqual(alertTo(db), [['u1', 'u2']])
    await writeAlertAdmins([], { userId: 'u1', by: 'Jack', names: [] })
    assert.ok(db.tables.agent_log.some(l => l.summary === 'Agent alerts now go to nobody (changed by Jack)'))
  } finally { done() }
})

test('a missing alerts row is reported when Admin tries to change it', async () => {
  const { done } = setup()
  try {
    const r = await writeAlertAdmins(['u1'], { userId: 'u1', by: 'Jack', names: ['Jack'] })
    assert.equal(r.ok, false); assert.match(r.error, /migration/)
  } finally { done() }
})
