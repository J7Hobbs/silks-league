// Pure parsing for the Race days tab: the bulk-import paste format and the "final declarations" card.
// No database, no screen. The format is the one the classic Admin already uses:
//
//   venue: Wincanton
//   time: 13:50
//   race_name: Novices' Hurdle
//   class: Class 3          (optional)
//   distance: 2m 4f         (optional)
//   runners: 8              (optional, checked against the rows)
//
//   1, Horse Name, Jockey, Trainer, 7/2, #1a3a7a, #f1c40f, hoops
//
// A runner row is: number, name, jockey, trainer, price, primary colour, [secondary colour], [pattern].
// More than one race can be pasted if each block is separated by a line holding only ---.

// Fractional price text to decimal odds ("7/2" -> 4.5, "evens" -> 2). null when not a price.
export function parseOdds(str) {
  if (!str) return null
  const s = String(str).trim().toLowerCase()
  if (s === 'evs' || s === 'evens') return 2.0
  const parts = s.split('/')
  if (parts.length === 2) {
    const n = parseFloat(parts[0]), d = parseFloat(parts[1])
    if (!isNaN(n) && !isNaN(d) && d !== 0) return parseFloat(((n / d) + 1).toFixed(2))
  }
  const dec = parseFloat(s)
  if (!isNaN(dec) && dec > 1) return dec
  return null
}

const HEX = /^#[0-9a-fA-F]{6}$/
const isTba = v => !v || String(v).trim().toLowerCase() === 'tba'
const HEADER_KEYS = ['venue', 'time', 'race_name', 'runners', 'class', 'distance']

// "Horse Name (IRE)" and "horse name" are the same horse for matching.
export const horseKey = name => String(name || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// One runner row -> { runner, warnings } or { error }.
export function parseRunnerRow(line, lineNum) {
  const parts = line.split(',').map(p => p.trim())
  if (parts.length < 6) return { error: `Line ${lineNum}: need at least 6 fields (got ${parts.length}) — "${line}"` }
  const [numStr, name, jockey, trainer, oddsStr, primaryHex, secondaryHex, pattern] = parts
  if (!name) return { error: `Line ${lineNum}: horse name is empty` }
  const warnings = []
  let oddsDecimal = null
  if (!isTba(oddsStr)) {
    oddsDecimal = parseOdds(oddsStr)
    if (!oddsDecimal) warnings.push(`Line ${lineNum}: price "${oddsStr}" not recognised, so ${name} has no price`)
  }
  if (!oddsDecimal) warnings.push(`Line ${lineNum}: ${name} has no price, so it would score 0`)
  const hexOk = HEX.test(primaryHex)
  const silk = hexOk ? primaryHex : (!isTba(primaryHex) ? '#1a3a10' : null)
  if (!isTba(primaryHex) && !hexOk) warnings.push(`Line ${lineNum}: colour "${primaryHex}" is not a valid hex, so it was set to #1a3a10`)
  const horseNum = parseInt(numStr)
  return {
    runner: {
      horse_number: !isNaN(horseNum) ? horseNum : null,
      horse_name: name,
      jockey: isTba(jockey) ? 'TBA' : jockey,
      trainer: isTba(trainer) ? null : trainer,
      odds_fractional: isTba(oddsStr) ? null : oddsStr,
      odds_decimal: oddsDecimal,
      silk_colour: silk,
      silk_colour_secondary: secondaryHex && HEX.test(secondaryHex) ? secondaryHex : null,
      silk_pattern: pattern?.trim() || null,
    },
    warnings,
  }
}

// Runner rows -> { runners, errors, warnings }. A horse named twice is an error.
export function parseRunnerRows(text) {
  const runners = [], errors = [], warnings = []
  const seen = new Set()
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
  lines.forEach((line, i) => {
    const r = parseRunnerRow(line, i + 1)
    if (r.error) { errors.push(r.error); return }
    const key = horseKey(r.runner.horse_name)
    if (seen.has(key)) { errors.push(`Line ${i + 1}: ${r.runner.horse_name} appears twice`); return }
    seen.add(key)
    runners.push(r.runner)
    warnings.push(...r.warnings)
  })
  return { runners, errors, warnings }
}

// A paste of one or more races -> { races: [{ header, runners, warnings }], errors }.
export function parseRaceBlocks(text) {
  const blocks = String(text || '').split(/^\s*-{3,}\s*$/m).map(b => b.trim()).filter(Boolean)
  const errors = []
  const races = []
  if (!blocks.length) return { races, errors: ['Paste your race data first'] }
  blocks.forEach((block, bi) => {
    const tag = blocks.length > 1 ? `Race ${bi + 1}: ` : ''
    const blank = block.search(/\n\s*\n/)
    if (blank === -1) { errors.push(`${tag}Missing blank line. Separate the race info from the runners with a blank line`); return }
    const header = {}
    for (const line of block.slice(0, blank).trim().split('\n')) {
      const i = line.indexOf(':')
      if (i === -1) continue
      header[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
    const missing = ['venue', 'time', 'race_name'].filter(k => !header[k])
    if (missing.length) { errors.push(`${tag}Missing field: ${missing.join(', ')}`); return }
    const rows = parseRunnerRows(block.slice(blank).trim())
    if (!rows.runners.length && !rows.errors.length) { errors.push(`${tag}No runners found after the blank line`); return }
    rows.errors.forEach(e => errors.push(`${tag}${e}`))
    const warnings = rows.warnings.map(w => `${tag}${w}`)
    if (!/^\d{1,2}:\d{2}$/.test(header.time)) warnings.push(`${tag}Time "${header.time}" looks unusual. Expected something like 13:50`)
    const expected = header.runners ? parseInt(header.runners) : null
    if (expected && rows.runners.length !== expected) warnings.push(`${tag}Expected ${expected} runners but found ${rows.runners.length}`)
    races.push({ header, runners: rows.runners, warnings })
  })
  return { races, errors }
}

// The final card: runner rows, with an optional race header above them (ignored).
export function parseDeclarations(text) {
  const body = String(text || '').split('\n')
    .filter(l => !new RegExp(`^\\s*(${HEADER_KEYS.join('|')})\\s*:`, 'i').test(l)).join('\n')
  const r = parseRunnerRows(body)
  if (!r.runners.length && !r.errors.length) r.errors.push('Paste the final card first: one runner per line')
  return r
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

// What applying a final card to a race would change.
//   existing  the race's runners (all of them, withdrawn ones included)
//   declared  parseDeclarations().runners
// Returns { updated, added, removed, revived, unchanged, warnings }:
//   updated  [{ runner, patch, changes: [{ field, from, to }] }]   number, jockey, trainer, price
//   added    [declared runner]                                      not on the card yet
//   removed  [runner]                                               on the card but not declared (and still running)
//   revived  [runner]                                               marked withdrawn but declared
export function diffDeclarations(existing, declared) {
  const byKey = new Map((existing || []).map(r => [horseKey(r.horse_name), r]))
  const seen = new Set()
  const updated = [], added = [], revived = [], unchanged = [], warnings = []
  for (const d of declared || []) {
    const ex = byKey.get(horseKey(d.horse_name))
    if (!ex) { added.push(d); continue }
    seen.add(ex.id)
    const patch = {}, changes = []
    if (d.horse_number != null && d.horse_number !== ex.horse_number) {
      patch.horse_number = d.horse_number; changes.push({ field: 'Number', from: ex.horse_number, to: d.horse_number })
    }
    if (!isTba(d.jockey) && !same(d.jockey, ex.jockey)) {
      patch.jockey = d.jockey; changes.push({ field: 'Jockey', from: ex.jockey, to: d.jockey })
    }
    if (d.trainer && !same(d.trainer, ex.trainer)) {
      patch.trainer = d.trainer; changes.push({ field: 'Trainer', from: ex.trainer, to: d.trainer })
    }
    if (d.odds_fractional && d.odds_decimal && !same(d.odds_fractional, ex.odds_fractional)) {
      patch.odds_fractional = d.odds_fractional; patch.odds_decimal = d.odds_decimal
      changes.push({ field: 'Price', from: ex.odds_fractional, to: d.odds_fractional })
    }
    if (ex.is_withdrawn) revived.push(ex)
    if (changes.length) updated.push({ runner: ex, patch, changes })
    else if (!ex.is_withdrawn) unchanged.push(ex)
  }
  const removed = (existing || []).filter(r => !seen.has(r.id) && !r.is_withdrawn)
  const running = (existing || []).filter(r => !r.is_withdrawn).length
  if (running > 0 && removed.length > running / 2) {
    warnings.push(`This removes ${removed.length} of ${running} horses. Check you pasted the whole card.`)
  }
  return { updated, added, removed, revived, unchanged, warnings }
}
