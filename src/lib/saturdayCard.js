// The Saturday League card on Home, as plain data for the component to draw.
// Pure: pass in `nowMs` so the countdown and the state move on without re-querying.
// Nothing here scores anything. Points come from the stored scores, the "win worth"
// line from the same calcTokenPoints the Picks page uses, and the table from standings.js.
import { hasLivePick } from './picksView.js'
import { calcTokenPoints } from './scoring.js'
import { buildRaceRows, summarise } from './resultsView.js'
import {
  ordinal, monthLong, clockText, ukClock, ukDateStr, ukWallToMs, formatLockCountdown, deadlineMs,
  daysBetween, weekdayLong, monthAbbr, wednesdayAfter,
} from './format.js'

const MAX_TABLE_ROWS = 3
const FALLBACK_SEGMENTS = 7   // between race days there is no week to count

function groupBy(rows, key) {
  const out = {}
  for (const r of rows) (out[r[key]] = out[r[key]] || []).push(r)
  return out
}

// Races in the order they run.
const byTime = (a, b) =>
  (clockText(a.race_time) || '99:99').localeCompare(clockText(b.race_time) || '99:99') || a.race_number - b.race_number

// Headline for the week: the course, "A & B" for two, or "Saturday's N races" for three or more.
export function venueInfo(races) {
  const courses = []
  for (const r of races) {
    const v = (r.venue || '').trim()
    if (v && !courses.includes(v)) courses.push(v)
  }
  if (courses.length === 1) return { headline: courses[0], sub: '', multi: false }
  if (courses.length === 2) return { headline: `${courses[0]} & ${courses[1]}`, sub: '', multi: true }
  return {
    headline: `Saturday's ${races.length} races`,
    sub: courses.join(', '),
    multi: courses.length > 1,
  }
}

// Which of the five states the card is in right now.
//   picks   picks are open and something is still to pick
//   picked  picks are open and every race has a pick
//   racing  picks have closed, it's race day and not every race has a result
//   results every race has a result (or race day is over)
//   back    nothing recent
export function satPhase(sat, nowMs) {
  if (!sat || sat.state === 'returns' || !sat.week) return 'back'
  const races = sat.races || []
  const runnersByRace = groupBy(sat.runners || [], 'race_id')
  const pickByRace = Object.fromEntries((sat.picks || []).map(p => [p.race_id, p]))
  if (deadlineMs(sat.deadline) > nowMs) {
    const allPicked = races.length > 0 &&
      races.every(r => hasLivePick(pickByRace[r.id]?.runner_id, runnersByRace[r.id] || []))
    return allPicked ? 'picked' : 'picks'
  }
  const withResult = new Set((sat.results || []).map(r => r.race_id))
  if (races.length > 0 && races.every(r => withResult.has(r.id))) return 'results'
  return sat.week.saturday_date === ukDateStr(nowMs) ? 'racing' : 'results'
}

// "A win at 5/1 would be worth 60 pts", or '' when the odds aren't known.
function winWorth(pick, runner, raceRunners) {
  const dec = Number(runner?.odds_decimal)
  if (!dec) return ''
  let pts
  try {
    pts = calcTokenPoints({
      betType: pick?.bet_type || 'win',
      position: 1,
      oddsDecimal: dec,
      runnerCount: raceRunners.filter(r => !r.is_withdrawn).length,
    }).totalPoints
  } catch { return '' }
  const at = runner.odds_fractional ? ` at ${runner.odds_fractional}` : ''
  return `A win${at} would be worth ${pts} pts`
}

function tableView(table, season, userId, live) {
  const rows = table?.rows || []
  const scoring = rows.filter(r => r.points > 0)
  if (!scoring.length) return null
  const toRow = (r, gap) => ({
    id: r.id,
    rank: r.rank,
    name: r.id === userId ? 'You' : (r.name || 'Player'),
    isMe: r.id === userId,
    points: r.points,
    move: !r.move ? null : r.move > 0 ? { dir: 'up', n: r.move } : { dir: 'down', n: -r.move },
    gap,
  })
  const top = scoring.slice(0, MAX_TABLE_ROWS).map(r => toRow(r, false))
  const me = rows.find(r => r.id === userId)
  if (me && !top.some(r => r.id === me.id)) top.push(toRow(me, true))
  const title = live ? 'LIVE TABLE'
    : season?.startDate ? `${monthLong(season.startDate).toUpperCase()} TABLE` : 'SEASON TABLE'
  return { title, rows: top }
}

function backSoonCard(sat, base) {
  const month = sat.season?.startDate ? monthLong(sat.season.startDate) : null
  const pos = sat.seasonPos
  const scored = !!month && pos?.points > 0
  return {
    ...base,
    state: 'returns',
    phase: 'back',
    gold: false,
    faint: true,
    eyebrow: { kind: 'grey', text: 'BETWEEN RACE DAYS', short: 'BACK SOON' },
    headline: 'Back soon',
    sub: 'Next race day to be announced',
    big: { text: scored ? ordinal(pos.rank) : '–' },
    label: !month ? '' : scored ? `your ${month} position` : `The ${month} season starts with the next race day`,
    ring: { segments: Array.from({ length: FALLBACK_SEGMENTS }, () => 'faint'), centre: '–', centreLabel: '' },
    spotlight: null,
    table: tableView(sat.table, sat.season, sat.userId, false),
    button: { label: 'View leaderboard', outline: true, action: { to: '/league' } },
  }
}

// "Race day announced": the next week exists but its racecard isn't in yet.
function announcedCard(sat, week, nowMs, base) {
  const days = daysBetween(ukDateStr(nowMs), week.saturday_date)
  const dayOfMonth = String(Number(week.saturday_date.slice(8, 10)))
  const month = monthAbbr(week.saturday_date)
  return {
    ...base,
    state: 'announced',
    phase: 'announced',
    gold: false,
    soft: true,
    faint: false,
    eyebrow: { kind: 'gold', text: 'RACE DAY ANNOUNCED', short: 'ANNOUNCED' },
    headline: `${weekdayLong(week.saturday_date)} ${dayOfMonth} ${month}`,
    sub: '',
    big: { text: days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days` },
    label: "Racecard out soon · picks open once it's in",
    ring: { segments: Array.from({ length: FALLBACK_SEGMENTS }, () => 'dim'), centre: dayOfMonth, centreLabel: month },
    spotlight: null,
    table: tableView(sat.table, sat.season, sat.userId, false),
    button: { label: 'View leaderboard', outline: true, action: { to: '/league' } },
    notify: { label: 'Get notified when picks open', userId: sat.userId },
  }
}

export function saturdayCard(sat, nowMs) {
  const base = { key: 'saturday', kind: 'saturday', tag: 'SATURDAY LEAGUE', competition: { type: 'saturday', id: null } }
  // F takes over from the results card on the Wednesday after race day (UK date).
  const announcedWeek = sat.state === 'announced' ? sat.week
    : sat.state === 'lastWeek' && sat.nextWeek && ukDateStr(nowMs) >= wednesdayAfter(sat.week.saturday_date) ? sat.nextWeek
    : null
  if (announcedWeek) return announcedCard(sat, announcedWeek, nowMs, base)

  const phase = satPhase(sat, nowMs)
  if (phase === 'back') return backSoonCard(sat, base)

  const races = [...sat.races].sort(byTime)
  const venue = venueInfo(races)
  const runnersByRace = groupBy(sat.runners, 'race_id')
  const runnerById = Object.fromEntries(sat.runners.map(r => [r.id, r]))
  const pickByRace = Object.fromEntries(sat.picks.map(p => [p.race_id, p]))
  const livePicked = id => hasLivePick(pickByRace[id]?.runner_id, runnersByRace[id] || [])
  const withResult = new Set(sat.results.map(r => r.race_id))
  const dl = deadlineMs(sat.deadline)
  const total = races.length

  const where = race => (venue.multi && race.venue ? ` ${race.venue}` : '')
  const timeOf = race => clockText(race.race_time)
  const whenText = race => [timeOf(race), race.venue && venue.multi ? race.venue : ''].filter(Boolean).join(' ')

  const shared = {
    ...base,
    deadlineMs: dl,
    headline: venue.headline,
    sub: venue.sub,
    faint: false,
  }

  // Spotlight for "the user's pick in this race".
  const pickSpotlight = (caption, race) => {
    const pick = pickByRace[race.id]
    const runner = runnerById[pick.runner_id]
    const time = timeOf(race)
    return {
      caption,
      main: `${runner?.horse_name || 'Your pick'}${time ? ` · ${time}` : ''}${where(race)}`,
      sub: winWorth(pick, runner, runnersByRace[race.id] || []),
      pill: runner?.odds_fractional || '',
      silk: runner ? { silk_colour: runner.silk_colour, silk_colour_secondary: runner.silk_colour_secondary, silk_pattern: runner.silk_pattern } : null,
    }
  }

  const live = sat.table && (phase === 'racing')
  const table = tableView(sat.table, sat.season, sat.userId, live)

  if (phase === 'picks' || phase === 'picked') {
    const pickedCount = races.filter(r => livePicked(r.id)).length
    const lockAt = ukClock(dl)

    if (phase === 'picks') {
      const next = races.find(r => !livePicked(r.id))
      const time = timeOf(next)
      const runnerCount = (runnersByRace[next.id] || []).filter(r => !r.is_withdrawn).length
      return {
        ...shared,
        state: 'open',
        phase,
        gold: true,
        eyebrow: { kind: 'gold', text: 'PICKS OPEN' },
        big: { text: formatLockCountdown(dl - nowMs), tick: true },
        label: `until picks lock at ${lockAt}`,
        ring: {
          segments: races.map(r => (livePicked(r.id) ? 'gold' : 'dim')),
          centre: `${pickedCount}/${total}`,
          centreLabel: 'picked',
        },
        spotlight: {
          caption: 'NEXT TO PICK',
          main: `Race ${next.race_number}${time ? ` · ${time}` : ''}${where(next)}`,
          sub: [next.race_name, runnerCount ? `${runnerCount} runners` : ''].filter(Boolean).join(' · '),
          pill: 'Pick',
          silk: 'empty',
          action: { to: '/picks' },
        },
        table,
        button: {
          label: pickedCount === 0 ? 'Make your picks' : 'Finish your picks',
          action: { to: '/picks' },
        },
      }
    }

    const first = races[0]
    const off = ukWallToMs(sat.week.saturday_date, first.race_time)
    return {
      ...shared,
      state: 'open',
      phase,
      gold: true,
      eyebrow: { kind: 'tick', text: 'ALL PICKS IN' },
      big: off
        ? { text: formatLockCountdown(off - nowMs), tick: true }
        : { text: formatLockCountdown(dl - nowMs), tick: true },
      label: off ? `until the first race · edit until ${lockAt}` : `until picks lock at ${lockAt}`,
      ring: { segments: races.map(() => 'gold'), centre: `${total}/${total}`, centreLabel: 'picked' },
      spotlight: pickSpotlight('FIRST UP', first),
      table,
      button: { label: 'Review your picks', outline: true, action: { to: '/picks' } },
    }
  }

  // Racing and results both read the player's day through the Results page's own row builder.
  const rows = buildRaceRows(
    { races: sat.races, results: sat.results, picks: sat.picks, runners: sat.runners, scores: sat.scores },
    '',
  )
  const rowById = Object.fromEntries(rows.map(r => [r.id, r]))
  const summary = summarise(rows)

  if (phase === 'racing') {
    const next = races.find(r => !withResult.has(r.id))
    const mine = races.find(r => !withResult.has(r.id) && livePicked(r.id))
    const time = timeOf(next)
    return {
      ...shared,
      state: 'closed',
      phase,
      gold: true,
      eyebrow: { kind: 'live', text: 'RACING NOW' },
      big: { text: String(summary.points) },
      label: `so far today · race ${next.race_number}${time ? ` off at ${time}` : ' next'}`,
      ring: {
        segments: races.map(r => (withResult.has(r.id) ? 'gold' : r.id === next.id ? 'pulse' : 'dim')),
        centre: `R${next.race_number}`,
        centreLabel: `of ${total}`,
      },
      spotlight: mine ? pickSpotlight('YOUR HORSE NEXT', mine) : null,
      table,
      button: { label: 'Follow the results', outline: true, action: { to: '/results' } },
    }
  }

  // results
  const isPlaced = r => r.position === 2 || r.position === 3 || (r.position === 4 && r.placePoints > 0)
  const when = sat.week.saturday_date === ukDateStr(nowMs) ? 'today' : 'that day'
  let best = null
  for (const race of races) {
    const row = rowById[race.id]
    if (row && row.pick && row.points > 0 && (!best || row.points > best.row.points)) best = { race, row }
  }
  let spotlight = null
  if (best) {
    const { race, row } = best
    const sp = row.placings.find(p => p.mine)?.sp
    spotlight = {
      caption: 'PICK OF THE DAY',
      main: row.position === 1 ? `${row.pick.name} won` : `${row.pick.name} placed ${ordinal(row.position)}`,
      sub: [whenText(race), sp ? `SP ${sp}` : ''].filter(Boolean).join(' · '),
      pill: `+${row.points}`,
      silk: row.pick.silk,
    }
  }
  return {
    ...shared,
    state: 'lastWeek',
    phase,
    gold: false,
    eyebrow: { kind: 'grey', text: 'RESULTS IN' },
    big: { text: String(summary.points) },
    label: summary.played
      ? `${summary.winners} ${summary.winners === 1 ? 'winner' : 'winners'} · ${summary.placed} placed ${when}`
      : "You didn't play",
    ring: {
      segments: races.map(r => {
        const row = rowById[r.id]
        if (!row || !row.pick || row.pending) return 'dim'
        return row.position === 1 ? 'gold' : isPlaced(row) ? 'placed' : 'dim'
      }),
      centre: String(summary.points),
      centreLabel: 'points',
    },
    spotlight,
    table,
    button: { label: 'View results', outline: true, action: { to: '/results' } },
  }
}
