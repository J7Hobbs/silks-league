// What the bonus screens show, worked out from the same rules scoring uses. Nothing here writes
// anything or changes a score: the figures come from calcTokenPoints (unchanged) and BONUS_RULES.
import { calcTokenPoints, getPlaceTerms } from './scoring.js'
import { BONUS_RULES, BONUS_TYPES } from './bonuses.js'
import { ordinal } from './format.js'

// The "What it's worth" figures for one runner and bet type, from the field size right now.
//   Win:      [{ label: 'Wins', pts }]
//   Each-way: 'Wins' plus one entry per paying place, e.g. Wins 95 · 2nd 25 · 3rd 20
// With the banker on, every figure is doubled (the banker doubles that race's normal points).
// Returns null when the runner has no price yet.
// rule4Cut: the race's Rule 4 deduction, so the figures shown are what the pick would really score.
export function worthFigures({ betType, oddsDecimal, runnerCount, banker = false, rule4Cut = 0 }) {
  if (!(oddsDecimal > 0)) return null
  const mult = banker ? BONUS_RULES.bankerMultiplier : 1
  const at = position => calcTokenPoints({ betType, position, oddsDecimal, runnerCount, rule4Cut }).totalPoints * mult
  const parts = [{ label: 'Wins', pts: at(1) }]
  if (betType === 'each_way') {
    for (let p = 2; p <= getPlaceTerms(runnerCount).placesPaid; p++) parts.push({ label: ordinal(p), pts: at(p) })
  }
  return { parts, betType, doubled: banker }
}

// "Wins 95 pts" for a win bet, "Wins 95 · 2nd 25 · 3rd 20" for each-way.
export function worthText(figures) {
  if (!figures) return ''
  const { parts, betType } = figures
  if (betType === 'each_way') return parts.map(p => `${p.label} ${p.pts}`).join(' · ')
  return `Wins ${parts[0].pts} pts`
}

// The short names for the three bonuses, in the order they are listed everywhere.
export const BONUS_NAMES = Object.freeze({
  [BONUS_TYPES.banker]: 'Banker',
  [BONUS_TYPES.lone]: 'Lone winner',
  [BONUS_TYPES.treble]: 'Treble',
})
