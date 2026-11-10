// One run through the whole pipeline on a Saturday week and a festival day, for the before/after comparison.
// `api` is the set of pipeline functions to exercise (the old src/lib copies, or the shared ones); `db` is a fakeDb.
// What comes back is everything that could differ: each function's return value, every row left in the database, and every
// push that was sent. tests/golden/pipeline.json is that output from the code as it was BEFORE it moved to _shared.
// The race days are dated after 2026-11-13 so Banker, Lone winner and Treble bonuses all apply.

const NOW_ISO = '2026-11-14T15:00:00.000Z'                  // Saturday afternoon, after the first lock
const users = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']

// Prices in the order of the horse numbers; 6 and 8 runners so each-way is allowed, 4 so it is not.
const PRICES = ['2/1', '7/2', '5/1', '8/1', '12/1', '20/1', '25/1', '33/1']
const dec = f => { const [n, d] = f.split('/').map(Number); return n / d + 1 }

function field(prefix, raceId, raceCol, size, extra = {}) {
  return Array.from({ length: size }, (_, i) => ({
    id: `${prefix}-${i + 1}`, [raceCol]: raceId, horse_number: i + 1, horse_name: `${prefix.toUpperCase()} Horse ${i + 1}`,
    jockey: `Jockey ${i + 1}`, trainer: `Trainer ${i + 1}`, odds_fractional: PRICES[i], odds_decimal: dec(PRICES[i]), is_withdrawn: false, ...extra,
  }))
}

// Picks: every player picks something in each race. `pick(user, race)` -> [runnerNumber, bet_type, banker]
const PLAN = {
  1: { u1: [1, 'win', true], u2: [1, 'win', false], u3: [3, 'each_way', false], u4: [2, 'each_way', false], u5: [5, 'each_way', true], u6: [6, 'win', false] },
  2: { u1: [2, 'win', false], u2: [1, 'win', true], u3: [4, 'win', false], u4: [3, 'win', false], u5: [1, 'win', false], u6: [2, 'win', false] },
  3: { u1: [4, 'each_way', false], u2: [4, 'win', false], u3: [7, 'each_way', false], u4: [4, 'each_way', true], u5: [2, 'win', false], u6: [8, 'each_way', false] },
}

export function seed() {
  const week = {
    race_weeks: [{ id: 'w1', season_id: 's1', week_number: 12, saturday_date: '2026-11-14', picks_deadline: '2026-11-14T12:50:00.000Z', festival_day_id: null, status: 'open' },
                 { id: 'w0', season_id: 's1', week_number: 11, saturday_date: '2026-11-07', picks_deadline: '2026-11-07T12:50:00.000Z', festival_day_id: null, status: 'completed' }],
    races: [
      { id: 'r1', race_week_id: 'w1', race_number: 1, venue: 'Cheltenham', race_name: 'Opener', race_time: '13:20', is_abandoned: false, runner_count_at_lock: null },
      { id: 'r2', race_week_id: 'w1', race_number: 2, venue: 'Cheltenham', race_name: 'Middle', race_time: '13:55', is_abandoned: false, runner_count_at_lock: null },
      { id: 'r3', race_week_id: 'w1', race_number: 3, venue: 'Cheltenham', race_name: 'Closer', race_time: '14:30', is_abandoned: false, runner_count_at_lock: null },
    ],
    runners: [...field('a', 'r1', 'race_id', 6), ...field('b', 'r2', 'race_id', 4), ...field('c', 'r3', 'race_id', 8)],
    picks: [], results: [], scores: [], bonus_awards: [],
  }
  for (const [n, plan] of Object.entries(PLAN)) {
    for (const u of users) {
      const [num, bet, banker] = plan[u]
      const pre = { 1: 'a', 2: 'b', 3: 'c' }[n]
      week.picks.push({ id: `pk-${n}-${u}`, user_id: u, race_id: `r${n}`, runner_id: `${pre}-${num}`, bet_type: bet, is_banker: banker, was_replaced: false, original_runner_id: null })
    }
  }
  const fest = {
    festivals: [{ id: 'f1', name: 'Cheltenham Festival', display_name: 'Cheltenham', venue: 'Cheltenham' }],
    festival_days: [{ id: 'd1', festival_id: 'f1', day_number: 1, race_date: '2026-11-13', picks_deadline: '2026-11-13T12:00:00.000Z' }],
    festival_races: [
      { id: 'fr1', festival_day_id: 'd1', race_number: 1, venue: 'Cheltenham', race_name: 'Festival Opener', race_time: '13:20', is_abandoned: false, runner_count_at_lock: null },
      { id: 'fr2', festival_day_id: 'd1', race_number: 2, venue: 'Cheltenham', race_name: 'Festival Second', race_time: '14:00', is_abandoned: false, runner_count_at_lock: null },
    ],
    festival_runners: [...field('fa', 'fr1', 'festival_race_id', 7), ...field('fb', 'fr2', 'festival_race_id', 5)],
    festival_picks: [], festival_results: [], festival_scores: [], festival_day_points: [],
  }
  const fpick = { 1: { u1: [1, 'win', true], u2: [2, 'each_way', false], u3: [1, 'each_way', false], u4: [4, 'win', false], u5: [2, 'win', false], u6: [3, 'each_way', false] },
                  2: { u1: [3, 'win', false], u2: [3, 'win', true], u3: [1, 'win', false], u4: [2, 'each_way', false], u5: [5, 'each_way', false], u6: [1, 'win', true] } }
  for (const [n, plan] of Object.entries(fpick)) {
    for (const u of users) {
      const [num, bet, banker] = plan[u]
      fest.festival_picks.push({ id: `fpk-${n}-${u}`, user_id: u, festival_race_id: `fr${n}`, runner_id: `f${n === '1' ? 'a' : 'b'}-${num}`, bet_type: bet, is_banker: banker, was_replaced: false, original_runner_id: null })
    }
  }
  return { ...week, ...fest, profiles: users.map(id => ({ id, username: `player_${id}`, full_name: `Player ${id}`, is_admin: id === 'u1' })), reminder_log: [] }
}

const DEADLINE = { week: '2026-11-14T12:50:00.000Z', festival: '2026-11-13T12:00:00.000Z' }
const dayOf = kind => (kind === 'week'
  ? { kind: 'week', id: 'w1', date: '2026-11-14', deadline: DEADLINE.week, festival: null }
  : { kind: 'festival', id: 'd1', date: '2026-11-13', deadline: DEADLINE.festival, festival: { id: 'f1', name: 'Cheltenham Festival', display_name: 'Cheltenham' } })

export async function runPipelineScenario(api, db) {
  const log = console.log
  console.log = () => {}                                   // the scoring code logs every row
  const returns = []
  const note = (label, value) => returns.push({ label, value: JSON.parse(JSON.stringify(value ?? null)) })
  const now = Date.parse(NOW_ISO)
  const rows = (kind, table, raceId) => db.tables[table].filter(r => r[kind === 'week' ? 'race_id' : 'festival_race_id'] === raceId)
  const race = (kind, id) => db.tables[kind === 'week' ? 'races' : 'festival_races'].find(r => r.id === id)
  const runnersOf = (kind, id) => rows(kind, kind === 'week' ? 'runners' : 'festival_runners', id)
  const names = (kind, id, nums) => nums.map((n, i) => ({ position: i + 1, horse_name: runnersOf(kind, id).find(r => r.horse_number === n).horse_name }))

  try {
    for (const kind of ['week', 'festival']) {
      const day = dayOf(kind), p = kind === 'week' ? ['r', 'a', 'b', 'c'] : ['fr', 'fa', 'fb']
      const r1 = `${p[0]}1`, r2 = `${p[0]}2`
      const lockIso = day.deadline

      // 1. Lock the first race and score it: a winner, two places.
      note(`${kind}: lock race 1`, await api.lockRace(kind, r1))
      note(`${kind}: result 1`, await api.saveRaceResult(kind, race(kind, r1), runnersOf(kind, r1), names(kind, r1, [1, 3, 2]), { festivalId: kind === 'festival' ? 'f1' : null }))

      // 2. A non-runner on race 2 after the lock (the race was never locked: it is locked first), picks moved to the favourite.
      const second = race(kind, r2)
      const gone = runnersOf(kind, r2).find(r => r.horse_number === 3)
      const plan = await api.planWithdrawal(kind, gone, second, { lockIso, now })
      note(`${kind}: plan withdraw`, { blocked: plan.blocked, picks: plan.picks.length, fav: plan.favourite?.horse_name, switchToWin: plan.switchToWin })
      note(`${kind}: withdraw`, await api.withdrawRunnerNow(kind, plan, { lockIso, now }))
      note(`${kind}: result 2`, await api.saveRaceResult(kind, race(kind, r2), runnersOf(kind, r2), names(kind, r2, [1, 2]), { festivalId: kind === 'festival' ? 'f1' : null }))

      // 3. Correct race 1 (no messages) with a different winner, then a late non-runner in race 1 after its result: re-scored.
      note(`${kind}: correct 1`, await api.saveRaceResult(kind, race(kind, r1), runnersOf(kind, r1), names(kind, r1, [2, 1, 3]), { festivalId: kind === 'festival' ? 'f1' : null, notify: false }))
      const late = runnersOf(kind, r1).find(r => r.horse_number === 5)
      const lp = await api.planWithdrawal(kind, late, race(kind, r1), { lockIso, now })
      note(`${kind}: late withdraw`, await api.withdrawRunnerNow(kind, lp, { lockIso, now }))

      // 4. Reinstate it again.
      const rp = await api.planReinstate(kind, late, race(kind, r1))
      note(`${kind}: reinstate`, await api.reinstateRunnerNow(kind, rp))

      // 5. Abandon race 2 (it had a result) and restore it; then recalculate the race.
      note(`${kind}: abandon 2`, await api.abandonRace(day, race(kind, r2)))
      note(`${kind}: restore 2`, await api.restoreRace(day, race(kind, r2)))
      note(`${kind}: recalc 1`, await api.recalculateRace(kind, race(kind, r1)))

      // 6. A third race (Saturday only): result with each-way places, then the bonuses are brought up to date once more.
      if (kind === 'week') {
        note('week: result 3', await api.saveRaceResult('week', race('week', 'r3'), runnersOf('week', 'r3'), names('week', 'r3', [4, 2, 7, 1]), {}))
      }
      note(`${kind}: bonuses`, await api.applyDayBonuses(kind, day.id))
    }
  } finally {
    console.log = log
  }
  return { returns, snapshot: db.snapshot(), pushes: db.calls.invoked }
}
