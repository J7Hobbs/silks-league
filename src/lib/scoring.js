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

export function calcTokenPoints({ betType, position, oddsDecimal, runnerCount }) {
  if (betType === 'win') {
    const totalPoints = position === 1 ? Math.round(2 * oddsDecimal * MULTIPLIER) : 0
    return { betType, winTokenPoints: totalPoints, placeTokenPoints: 0, totalPoints }
  }

  if (betType === 'each_way') {
    const { placesPaid } = getPlaceTerms(runnerCount)
    const taper = POSITION_TAPER[position]
    const isPlaced = taper !== undefined && position <= placesPaid
    const winRaw = position === 1 ? oddsDecimal : 0
    const placeRaw = isPlaced ? 1 + BASE_FRACTION * taper * (oddsDecimal - 1) : 0

    // Round the combined total once — rounding the win/place components
    // independently before summing gives wrong results (e.g. an evens
    // each-way winner incorrectly equalling an evens all-in-win winner).
    const totalPoints = Math.round((winRaw + placeRaw) * MULTIPLIER)
    const winTokenPoints = position === 1 ? Math.round(winRaw * MULTIPLIER) : 0
    // Derived, not independently rounded, so win + place always sums to totalPoints exactly.
    const placeTokenPoints = totalPoints - winTokenPoints

    return { betType, winTokenPoints, placeTokenPoints, totalPoints }
  }

  throw new Error(`Unknown bet_type: ${betType}`)
}

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
