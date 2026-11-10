// ── Token-based scoring (new system, from the coming Saturday / next festival onward) ──

const MULTIPLIER = 10
const BASE_FRACTION = 0.25
// 1st gets the same taper as 2nd — winning is at least as good as placing 2nd.
const POSITION_TAPER = { 1: 1.0, 2: 1.0, 3: 0.65, 4: 0.4 }
const WIN_ONLY_THRESHOLD = 5.0 // decimal odds for 4/1 — shorter than this is win-only

export function getPlaceTerms(runnerCount) {
  if (runnerCount >= 16) return { eachWayAvailable: true, placesPaid: 4 }
  if (runnerCount >= 8) return { eachWayAvailable: true, placesPaid: 3 }
  if (runnerCount >= 5) return { eachWayAvailable: true, placesPaid: 2 }
  return { eachWayAvailable: false, placesPaid: 0 }
}

export function isWinOnly(oddsDecimal) {
  return oddsDecimal < WIN_ONLY_THRESHOLD
}

export function canOfferEachWay(oddsDecimal, runnerCount) {
  return !isWinOnly(oddsDecimal) && getPlaceTerms(runnerCount).eachWayAvailable
}

// rule4Pence: the Rule 4 deduction (pence per £1 of winnings) for a race where a horse was withdrawn after picks opened.
// It reduces the winnings only, never the stake, exactly like a bet slip: the price used for the points becomes
// 1 + (price - 1) x (1 - deduction). Which bets are allowed (win only under 4/1, the places paid) is NOT judged here, so
// it is unaffected. With no deduction (the default) every figure is exactly what it has always been.
export function calcTokenPoints({ betType, position, oddsDecimal, runnerCount, rule4Pence = 0 }) {
  const odds = applyRule4(oddsDecimal, rule4Pence)
  // One rounding at the end, as always. (With a deduction the sum is first trimmed to 6 places so floating point noise
  // can never tip a .5 the wrong way.)
  const settle = v => (rule4Pence > 0 ? Math.round(+v.toFixed(6)) : Math.round(v))

  if (betType === 'win') {
    const totalPoints = position === 1 ? settle(2 * odds * MULTIPLIER) : 0
    return { betType, winTokenPoints: totalPoints, placeTokenPoints: 0, totalPoints }
  }

  if (betType === 'each_way') {
    const { placesPaid } = getPlaceTerms(runnerCount)
    const taper = POSITION_TAPER[position]
    const isPlaced = taper !== undefined && position <= placesPaid
    const winRaw = position === 1 ? odds : 0
    const placeRaw = isPlaced ? 1 + BASE_FRACTION * taper * (odds - 1) : 0

    // Round the combined total once — rounding the win/place components
    // independently before summing gives wrong results (e.g. an evens
    // each-way winner incorrectly equalling an evens all-in-win winner).
    const totalPoints = settle((winRaw + placeRaw) * MULTIPLIER)
    const winTokenPoints = position === 1 ? settle(winRaw * MULTIPLIER) : 0
    // Derived, not independently rounded, so win + place always sums to totalPoints exactly.
    const placeTokenPoints = totalPoints - winTokenPoints

    return { betType, winTokenPoints, placeTokenPoints, totalPoints }
  }

  throw new Error(`Unknown bet_type: ${betType}`)
}

// ══ Rule 4: deductions when a horse is withdrawn after picks open ══════════════════════════════════════════════
// Like a bookmaker's Rule 4 (Tattersalls Rule 4(c)). If a runner is withdrawn after picks opened, every pick in that race has
// its WINNINGS reduced by a deduction taken from the withdrawn horse's price (frozen when picks opened, i.e. the stored
// price). Nothing else about the race changes. This table is the single source of truth: scoring, Admin's confirm sheet,
// the Picks and Results lines and the How it works screen all read it.
//
// Each band runs from its shortest listed price up to (not including) the next band's shortest price, compared as decimal
// prices to 2 places (that is how prices are stored), so an in-between price such as 100/30 lands in the right band.
const RULE4_START_DATE = '2026-11-13'            // races on or after this date only; earlier races are never re-scored
let rule4Start = RULE4_START_DATE
export const RULE4_CAP_PENCE = 90                // several withdrawals add up, to no more than this (Rule 4(c))

// [shortest price of the band, longest price shown, pence]. The first band has no lower limit ("1/9 or shorter").
const RULE4_BANDS = [
  ['1/9', '1/9', 90, true], ['2/17', '2/11', 85], ['1/5', '1/4', 80], ['2/7', '3/10', 75], ['1/3', '2/5', 70],
  ['4/9', '8/15', 65], ['4/7', '8/13', 60], ['4/6', '4/5', 55], ['5/6', '20/21', 50], ['evens', '6/5', 45],
  ['5/4', '6/4', 40], ['8/5', '7/4', 35], ['9/5', '9/4', 30], ['12/5', '3/1', 25], ['16/5', '4/1', 20],
  ['9/2', '11/2', 15], ['6/1', '9/1', 10], ['10/1', '14/1', 5],
]
const fracToDecimal = f => (f === 'evens' ? 2 : 1 + Number(f.split('/')[0]) / Number(f.split('/')[1]))
const to2dp = x => Math.round(x * 100 + 1e-9) / 100
const RULE4_ROWS = RULE4_BANDS.map(([from, to, pence, shortest]) => ({
  from, to, pence, shortestOnly: !!shortest,
  fromDecimal: shortest ? 0 : to2dp(fracToDecimal(from)),
  range: shortest ? `${from} or shorter` : from === to ? from : `${from} to ${to}`,
}))
const RULE4_LONGEST = to2dp(fracToDecimal('14/1'))   // 15.00: longer than 14/1 gets no deduction

export const rule4Applies = date => !!date && String(date).slice(0, 10) >= rule4Start
// For the tests only: move the start date (and put it back with no argument).
export function setRule4StartDateForTests(date = RULE4_START_DATE) { rule4Start = date }

// Pence per £1 of winnings for one withdrawn horse at this decimal price. 0 for no price or a price longer than 14/1.
export function rule4Deduction(oddsDecimal) {
  const dec = Number(oddsDecimal)
  if (!(dec > 0)) return 0
  const d = to2dp(dec)
  if (d > RULE4_LONGEST) return 0
  let pence = 0
  for (const row of RULE4_ROWS) if (d >= row.fromDecimal) pence = row.pence
  return pence
}

// The price the points are worked out from: 1 + (price - 1) x (1 - deduction). Only the winnings are reduced, never the stake.
export function applyRule4(oddsDecimal, pence) {
  return pence > 0 ? 1 + (oddsDecimal - 1) * (100 - pence) / 100 : oddsDecimal
}

// Everything about a race's Rule 4, from its date and its withdrawn runners.
//   withdrawn  [{ horse_name, odds_fractional, odds_decimal }]   (only the withdrawn runners)
// Returns { applies, pence, items: [{ name, fractional, decimal, pence }], missing: [name] }
//   pence    the total deduction, capped at RULE4_CAP_PENCE
//   items    the withdrawn horses that give a deduction
//   missing  withdrawn horses with no price: no deduction, and Admin shows a warning
export function rule4For({ date, withdrawn }) {
  const out = { applies: rule4Applies(date), pence: 0, items: [], missing: [] }
  if (!out.applies) return out
  let total = 0
  for (const r of withdrawn || []) {
    const dec = Number(r.odds_decimal)
    if (!(dec > 0)) { out.missing.push(r.horse_name || 'A runner'); continue }
    const pence = rule4Deduction(dec)
    if (pence > 0) {
      total += pence
      out.items.push({ name: r.horse_name || 'A runner', fractional: r.odds_fractional || '', decimal: dec, pence })
    }
  }
  out.pence = Math.min(RULE4_CAP_PENCE, total)
  return out
}

const priceOf = it => it.fractional || `${it.decimal}`
const listOf = names => (names.length <= 1 ? names[0] || '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

// "Rule 4: 25p — Bluey withdrawn at 3/1"  /  "Rule 4: 35p — Bluey (3/1) and Rocky (10/1) withdrawn". '' when nothing applies.
export function rule4Line(r4) {
  if (!r4 || !(r4.pence > 0)) return ''
  const { items } = r4
  if (items.length === 1) return `Rule 4: ${r4.pence}p — ${items[0].name} withdrawn at ${priceOf(items[0])}`
  return `Rule 4: ${r4.pence}p — ${listOf(items.map(i => `${i.name} (${priceOf(i)})`))} withdrawn`
}

// The tag next to a player's points: "Rule 4 −25p".
export const rule4Tag = pence => (pence > 0 ? `Rule 4 \u2212${pence}p` : '')

// The table for the How it works screen: [{ range, pence }] from the shortest price to the longest, then "longer than 14/1".
export function rule4Table() {
  return [...RULE4_ROWS.map(r => ({ range: r.range, pence: r.pence })), { range: 'Longer than 14/1', pence: 0 }]
}
export const rule4Example = Object.freeze({ price: '3/1', pence: rule4Deduction(4) })   // the worked example in the rules text

// ── Legacy fixed-tier scoring (system in place before the token overhaul) ──
// Unchanged from src/pages/Admin.jsx — kept here so both scoring pipelines
// and both formulas live in one shared module instead of being duplicated.
export function calcPoints(position, spDecimal) {
  const base = position === 1 ? 25 : position === 2 ? 15 : position === 3 ? 10 : 0
  let bonus = 0
  if (position === 1) {
    if (spDecimal >= 21.0) bonus = 15
    else if (spDecimal >= 12.0) bonus = 10
    else if (spDecimal >= 5.5) bonus = 5
    else if (spDecimal >= 3.0) bonus = 2
  } else if (position === 2 || position === 3) {
    if (spDecimal >= 21.0) bonus = 4
    else if (spDecimal >= 12.0) bonus = 3
    else if (spDecimal >= 5.5) bonus = 2
    else if (spDecimal >= 3.0) bonus = 1
  }
  return { base, bonus, total: Math.min(base + bonus, 40) }
}

// ── Display helpers for the How It Works screen ──
// Read-only views of the constants and rules above, so the rules screen can never drift
// from what scoring does. Nothing here is used by scoring itself.
export const SCORING_RULES = Object.freeze({
  tokens: 2,
  multiplier: MULTIPLIER,
  baseFraction: BASE_FRACTION,
  winOnlyBelowDecimal: WIN_ONLY_THRESHOLD,
})

// Field-size bands from getPlaceTerms: [{ from, to, placesPaid, eachWayAvailable }].
// The last band has to: null (and up).
export function placeTermTiers(maxRunners = 20) {
  const tiers = []
  for (let n = 1; n <= maxRunners; n++) {
    const { placesPaid, eachWayAvailable } = getPlaceTerms(n)
    const last = tiers[tiers.length - 1]
    if (last && last.placesPaid === placesPaid) last.to = n
    else tiers.push({ from: n, to: n, placesPaid, eachWayAvailable })
  }
  if (tiers.length) tiers[tiers.length - 1].to = null
  return tiers
}

// One row per finishing position that scores: { position, share, minRunners }.
// share is the part of the place value paid (1 = all of it); minRunners is the smallest
// field where that finishing position is paid.
export function placeTapers() {
  return Object.keys(POSITION_TAPER).map(Number).sort((a, b) => a - b).map(position => {
    let minRunners = null
    for (let n = 1; n <= 40 && minRunners === null; n++) {
      if (getPlaceTerms(n).placesPaid >= position) minRunners = n
    }
    return { position, share: POSITION_TAPER[position], minRunners }
  })
}
