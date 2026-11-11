// The scoring / bonus / lock / withdrawal / result-saving pipeline must give exactly the results it gave before it moved into
// supabase/functions/_shared. tests/golden/pipeline.json was recorded from the old src/lib copies; this runs the same
// scenario on the shared code and requires the same return values, database rows and pushes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createFakeDb } from './helpers/fakeDb.js'
import { freezeClock } from './helpers/clock.js'
import { seed, runPipelineScenario } from './scenarios/pipeline.js'
import { setClient } from '../supabase/functions/_shared/db.js'
import * as lock from '../supabase/functions/_shared/raceLock.js'
import * as today from '../supabase/functions/_shared/adminToday.js'
import * as bonuses from '../supabase/functions/_shared/dayBonuses.js'
import * as raceDay from '../supabase/functions/_shared/raceDay.js'
import * as scoring from '../supabase/functions/_shared/raceScoring.js'
import * as days from '../supabase/functions/_shared/adminRaceDays.js'
import { setRule4StartDateForTests } from '../supabase/functions/_shared/scoring.js'

// The scenario withdraws horses on race days that Rule 4 now applies to, so it runs with Rule 4 switched off: everything
// else (scoring, bonuses, locking, withdrawals, result saving, pushes) must still be identical to the old code. The Rule 4 tests
// are in rule4.test.mjs.
test('shared pipeline gives the same scores, bonuses, picks and pushes as the code it replaced', async () => {
  const unfreeze = freezeClock('2026-11-14T15:00:00.000Z')
  setRule4StartDateForTests('9999-12-31')
  try {
    const db = createFakeDb(seed())
    setClient(db.client)
    const out = await runPipelineScenario({
      lockRace: lock.lockRace, saveRaceResult: today.saveRaceResult, applyDayBonuses: bonuses.applyDayBonuses,
      planWithdrawal: raceDay.planWithdrawal, withdrawRunnerNow: raceDay.withdrawRunnerNow,
      planReinstate: raceDay.planReinstate, reinstateRunnerNow: raceDay.reinstateRunnerNow,
      recalculateRace: scoring.recalculateRace, abandonRace: days.abandonRace, restoreRace: days.restoreRace,
    }, db)
    const golden = JSON.parse(fs.readFileSync(new URL('./golden/pipeline.json', import.meta.url), 'utf8'))
    assert.deepEqual(out.returns, golden.returns, 'return values differ')
    assert.deepEqual(out.snapshot, golden.snapshot, 'database rows differ')
    // The one intended difference from the old code: this festival has a single day, which is its LAST day, so the end-of-day
    // push there is now the festival-final one (same title, same recipients, same single send; new line and the Final page).
    const expected = JSON.parse(JSON.stringify(golden.pushes))
    const eod = expected.filter(p => p.body.body === "Racing's done for the day. See who's top of the pile")
    assert.equal(eod.length, 1)
    eod[0].body.body = "Final table's in from Cheltenham. See where you finished"
    eod[0].body.url = 'https://silks-league.vercel.app/festival/f1/final'
    assert.deepEqual(JSON.parse(JSON.stringify(out.pushes)), expected, 'pushes differ')
    assert.ok(out.snapshot.scores.length > 0 && out.snapshot.bonus_awards.length > 0, 'the scenario should have scored and awarded bonuses')
  } finally { setRule4StartDateForTests(); unfreeze() }
})
