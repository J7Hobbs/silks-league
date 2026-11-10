// Bonus points: Banker x2, Lone winner +25, Treble +50.
//
// Everything in this file is a plain function or constant: no database, no screen. Scoring
// (dayBonuses.js), the Picks preview, the Results tags and the Bonus points page all read BONUS_RULES,
// so the rules the player reads are the rules that are scored. calcTokenPoints (scoring.js) is not
// touched: a bonus is worked out from the points it gives, then added on top.
//
// A bonus belongs to a race day (a Saturday League week or a festival day; a Saturday linked to a
// festival day is that festival day) and only race days from `startDate` get bonuses.

export const BONUS_RULES = Object.freeze({
  bankerMultiplier: 2,        // the banker race's normal points are doubled
  loneWinnerPoints: 25,       // you were the only player whose pick won the race
  trebleWinners: 3,           // winners in a row (consecutive races on the day) ...
  treblePoints: 50,           // ... once per race day, on the race that completes the run
  startDate: '2026-11-13',    // Cheltenham November Meeting, day 1: earlier race days have no bonuses
  introUntil: '2026-11-15',   // the launch pop-up is shown up to and including this date
  newTagDays: 7,              // how long "NEW" stays on the menu item
  launchDate: '2026-11-12',   // the day the bonuses went live (start of the NEW tag)
})

export const BONUS_TYPES = Object.freeze({ banker: 'banker', lone: 'lone_winner', treble: 'treble' })

// Does a race day (its date, 'YYYY-MM-DD' or an ISO timestamp) get bonuses?
export const bonusesApply = date => !!date && String(date).slice(0, 10) >= BONUS_RULES.startDate

const DAY_MS = 86400000

// Is the "NEW" tag still on the menu item? (newTagDays from launchDate.)
export const bonusIsNew = (nowMs = Date.now()) =>
  nowMs >= Date.parse(BONUS_RULES.launchDate) && nowMs < Date.parse(BONUS_RULES.launchDate) + BONUS_RULES.newTagDays * DAY_MS

// Is the launch pop-up still to be shown? (Up to and including introUntil.)
export const bonusIntroOpen = (nowMs = Date.now()) => nowMs < Date.parse(BONUS_RULES.introUntil) + DAY_MS

// The extra a banker gives: the race's normal points again (x2 in total).
export const bankerExtra = rawPoints => Math.max(0, Math.round(rawPoints * (BONUS_RULES.bankerMultiplier - 1)))

// Work out every bonus for one race day.
//   races   [{ id, race_number }]                      every race on the day
//   scores  [{ user_id, race_id, position_achieved, raw }]
//                                                      one per pick that was scored; raw = the
//                                                      calcTokenPoints total (win + place points)
//   bankers [{ user_id, race_id }]                     the picks marked as banker
// Returns { awards, bonusByRow }:
//   awards      [{ user_id, race_id, type, points, detail }]   type is a BONUS_TYPES value
//   bonusByRow  { 'userId|raceId': points }                    what to add to that score row's raw points
export function computeDayBonuses({ races, scores, bankers }) {
  const ordered = [...(races || [])].sort((a, b) => a.race_number - b.race_number)
  const rawBy = {}                       // 'user|race' -> raw points
  const winnersByRace = {}               // race -> Set of users whose pick won
  for (const s of scores || []) {
    rawBy[`${s.user_id}|${s.race_id}`] = s.raw || 0
    if (s.position_achieved === 1) (winnersByRace[s.race_id] ||= new Set()).add(s.user_id)
  }

  const awards = []

  // Banker: the race's normal points again.
  for (const b of bankers || []) {
    const extra = bankerExtra(rawBy[`${b.user_id}|${b.race_id}`] || 0)
    if (extra > 0) awards.push({ user_id: b.user_id, race_id: b.race_id, type: BONUS_TYPES.banker, points: extra, detail: {} })
  }

  // Lone winner: exactly one player's pick won the race. (Two players on a dead-heat pair is not lone.)
  for (const race of ordered) {
    const w = winnersByRace[race.id]
    if (w && w.size === 1) {
      awards.push({ user_id: [...w][0], race_id: race.id, type: BONUS_TYPES.lone, points: BONUS_RULES.loneWinnerPoints, detail: {} })
    }
  }

  // Treble: the first run of `trebleWinners` consecutive races (in race order) a player won. A race
  // without a winning pick (no pick, no result yet, lost) breaks the run. At most one per player.
  const n = BONUS_RULES.trebleWinners
  const users = new Set()
  Object.values(winnersByRace).forEach(set => set.forEach(u => users.add(u)))
  for (const user of users) {
    let run = 0
    for (let i = 0; i < ordered.length; i++) {
      run = winnersByRace[ordered[i].id]?.has(user) ? run + 1 : 0
      if (run === n) {
        const legs = ordered.slice(i - n + 1, i + 1)
        awards.push({
          user_id: user, race_id: ordered[i].id, type: BONUS_TYPES.treble, points: BONUS_RULES.treblePoints,
          detail: { race_numbers: legs.map(r => r.race_number) },
        })
        break
      }
    }
  }

  const bonusByRow = {}
  for (const a of awards) {
    const key = `${a.user_id}|${a.race_id}`
    bonusByRow[key] = (bonusByRow[key] || 0) + a.points
  }
  return { awards, bonusByRow }
}
