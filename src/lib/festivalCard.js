// The festival card on Home, as plain data for the component to draw (design option C: photo header, status pill, big figure,
// one tile per festival day, today's picks as silks, the main button).
// Pure: pass in `nowMs` so the countdown and the state move on without re-querying. Nothing here scores anything: points and
// finishing positions are the stored festival_scores rows, and "which races have run" is the stored festival_results rows.
import { ordinal, formatCountdown, deadlineMs, ukDateStr, ukClock, ukWallToMs, clockText, weekdayShort } from './format.js'
import { daysLabel, dayCount } from './festivalView.js'
import { finalPath } from './finalTable.js'

const DAY_MS = 86400000
const dateMs = d => Date.parse(`${d}T00:00:00Z`)
const dateStr = ms => new Date(ms).toISOString().slice(0, 10)
const dayOfMonth = d => Number(d.slice(8, 10))
const byTime = (a, b) => (clockText(a.time) || '99:99').localeCompare(clockText(b.time) || '99:99') || a.number - b.number

const picksAction = id => ({ to: '/picks', state: { festivalTab: id } })
const resultsAction = id => ({ to: `/results/festival/${id}` })

// "2 days" from a day out, then "5h 20m" (like the Saturday card's day count, then the hours and minutes left).
export function soonCountdown(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(mins / 1440)
  if (d >= 1) return `${d} ${d === 1 ? 'day' : 'days'}`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function pickLabel(picked, total) {
  if (total > 0 && picked >= total) return 'Picks done ✓ – edit'
  if (picked > 0) return 'Finish your picks'
  return "Make today's picks"
}

// "Opens Fri": a day's picks open the day before it (the racecard goes in then).
function opensText(date, today) {
  const before = dateStr(dateMs(date) - DAY_MS)
  return before < today ? 'Opens soon' : `Opens ${weekdayShort(before)}`
}

// A race that has run: it has a result, or it was abandoned.
const hasRun = (race, ran) => race.abandoned || ran.has(race.id)

// One silk per race of the focus day (R1..Rn), with the player's pick, the banker mark and, once a race is run, how it went.
function silkRow({ races, picks, runners, ran, scores }, action) {
  if (!races.length) return null
  const items = [...races].sort((a, b) => a.number - b.number).map(r => {
    const pick = picks.get(r.id)
    const runner = pick ? runners[pick.runnerId] || null : null
    const item = { key: r.id, label: `R${r.number}`, runner, banker: !!(pick && pick.banker), status: runner ? 'pending' : 'empty', tag: '', name: runner?.horse_name || '', action }
    const score = scores.get(r.id)
    if (runner && ran.has(r.id) && score && score.position != null) {
      if (score.position === 1) { item.status = 'won'; item.tag = 'WON' }
      else if (score.position > 1 && (score.points || 0) > 0) { item.status = 'placed'; item.tag = ordinal(score.position) }
      else item.status = 'unplaced'
    }
    return item
  })
  return { items, action }
}

export function festivalCard(fest, nowMs) {
  const f = fest.festival
  const today = ukDateStr(nowMs)
  const dl = deadlineMs(fest.deadline)
  const live = fest.state === 'open' && dl > nowMs
  // running: today is within its dates; finished: its last day has passed (the 7 days it stays on Home)
  const phase = today > (f.end_date || f.start_date) ? 'finished' : today >= f.start_date ? 'running' : 'upcoming'

  const days = fest.days || []
  const ran = new Set(fest.results || [])
  const picks = new Map((fest.picks || []).filter(p => p.runnerId).map(p => [p.raceId, p]))
  const scores = new Map((fest.scores || []).map(s => [s.raceId, s]))
  const runners = fest.runners || {}
  const focus = days.find(d => d.id === fest.focusDayId) || null
  const focusRaces = focus ? focus.races : []

  const pickedOn = d => d.races.filter(r => picks.has(r.id)).length
  const pointsOn = d => d.races.reduce((n, r) => n + (scores.get(r.id)?.points || 0), 0)
  const openDay = d => d.races.length > 0 && deadlineMs(d.deadline, d.date) > nowMs
  const doneDay = d => d.date < today || (d.races.length > 0 && d.races.every(r => hasRun(r, ran)))

  // What the card is showing now: picks open, racing, or the day is done.
  const dayDone = phase === 'finished' || (focus ? doneDay(focus) : false)
  const stage = dayDone ? 'done' : live ? 'open' : 'racing'
  const total = focusRaces.length
  const picked = focusRaces.filter(r => picks.has(r.id)).length

  // ── Status pill and the big figure ──
  let pill, figure
  if (stage === 'open') {
    pill = { text: 'Picks open', tone: 'open' }
    figure = { value: formatCountdown(dl - nowMs), sub: `until picks close · ${ukClock(dl)} ${weekdayShort(ukDateStr(dl))}` }
  } else if (stage === 'racing') {
    const starts = focusRaces.map(r => ukWallToMs(focus.date, r.time)).filter(x => x != null)
    const started = ran.size > 0 && focusRaces.some(r => ran.has(r.id)) || (starts.length > 0 && Math.min(...starts) <= nowMs)
    const left = focusRaces.filter(r => !hasRun(r, ran)).sort(byTime)
    const next = left[0]
    const run = focusRaces.filter(r => ran.has(r.id)).length
    pill = { text: started ? 'Racing now' : 'Picks closed', tone: 'racing' }
    figure = {
      value: (next && clockText(next.time)) || '–',
      sub: next ? `Race ${next.number} next · ${run} of ${total} run` : `${run} of ${total} run`,
    }
  } else {
    const n = focus ? focus.number : fest.dayNumber
    const played = focus ? pickedOn(focus) > 0 : fest.picked > 0
    // Position only once at least one result is in on this festival (before that everyone is level on 0).
    const place = fest.resultsIn && fest.rank ? ordinal(fest.rank.rank) : null
    pill = { text: 'Results in', tone: 'done' }
    figure = {
      value: `${played && focus ? '+' : ''}${focus ? pointsOn(focus) : 0} pts`,
      sub: !played || !place ? `Day ${n} done` : n > 1 ? `Day ${n} · you're ${place} overall` : `Day ${n} · you're ${place}`,
    }
  }

  // ── One tile per festival day ──
  const dayTiles = days.map(d => {
    const base = { key: d.id, weekday: weekdayShort(d.date).toUpperCase(), date: dayOfMonth(d.date), label: `Day ${d.number}` }
    const isFocus = d === focus
    if (doneDay(d)) return { ...base, kind: isFocus ? 'today' : 'done', line: pickedOn(d) > 0 ? `+${pointsOn(d)}` : '–', action: resultsAction(f.id) }
    if (isFocus || openDay(d)) {
      const p = pickedOn(d)
      const line = p > 0 ? `${p}/${d.races.length} picked` : (isFocus && stage === 'racing' ? 'No picks' : 'Pick now')
      return { ...base, kind: isFocus ? 'today' : 'future', line, action: picksAction(f.id) }
    }
    return { ...base, kind: 'future', line: opensText(d.date, today), action: null }
  })

  // Today's picks as silks; hidden until the racecard is in.
  const silks = focus && total > 0
    ? silkRow({ races: focusRaces, picks, runners, ran, scores }, stage === 'open' ? picksAction(f.id) : resultsAction(f.id))
    : null

  return {
    key: `festival-${f.id}`,
    kind: 'festival',
    phase,
    state: live ? 'open' : 'closed',
    tag: 'FESTIVAL',
    competition: { type: 'festival', id: f.id },
    deadlineMs: dl,
    context: [fest.venue, `Day ${fest.dayNumber} of ${fest.totalDays}`].filter(Boolean).join(' · '),
    title: f.display_name || f.name,
    note: fest.alsoSaturday && stage !== 'done' ? 'Also counts for your Saturday League' : null,
    image: { url: f.banner_url || null, position: f.banner_position || null },
    pill,
    figure,
    days: dayTiles,
    silks,
    // Once the festival's last race is in, the card goes to its Final page (this card is only ever the latest festival).
    button: fest.final
      ? { label: 'Final table', outline: true, action: { to: finalPath(f.id) } }
      : live
        ? { label: pickLabel(picked, total), action: picksAction(f.id) }
        : { label: 'View results', outline: true, action: resultsAction(f.id) },
  }
}

// The festival's card before its racecard is in: same card, "racecard out soon", counting down to Day 1.
export function festivalSoonCard(soon, nowMs) {
  const f = soon.festival
  const today = ukDateStr(nowMs)
  const dayOne = soon.days.find(d => d.day_number === 1) || soon.days[0]
  // Counting to Day 1: its picks deadline if there is one, else 13:00 UK on the day. (The first race time isn't known yet: with
  // a racecard in, this card is the normal open one.)
  const dayDate = dayOne?.race_date || f.start_date
  const startMs = dayOne?.picks_deadline ? deadlineMs(dayOne.picks_deadline, dayDate) : ukWallToMs(dayDate, '13:00')
  const total = soon.days.length || dayCount(f)
  const linked = soon.days.some(d => d.id === soon.linkedDayId)

  // The days: the festival's day rows, or its dates when it has none yet.
  let dates = soon.days.slice().sort((a, b) => a.day_number - b.day_number).filter(d => d.race_date).map(d => ({ key: d.id, date: d.race_date, n: d.day_number }))
  if (!dates.length && f.start_date) {
    for (let ms = dateMs(f.start_date), i = 1; ms <= dateMs(f.end_date || f.start_date); ms += DAY_MS, i++) dates.push({ key: `d${i}`, date: dateStr(ms), n: i })
  }

  return {
    key: `festival-${f.id}`,
    kind: 'festival',
    phase: 'upcoming',
    state: 'announced',   // not live yet: not counted in "Live now", and the button stays the quiet outline
    tag: 'FESTIVAL',
    competition: { type: 'festival', id: f.id },
    deadlineMs: startMs,
    context: [f.venue, daysLabel(total)].filter(Boolean).join(' · '),
    title: f.display_name || f.name,
    note: linked ? 'Also counts for your Saturday League' : null,
    image: { url: f.banner_url || null, position: f.banner_position || null },
    pill: { text: 'Racecard out soon', tone: 'soon' },
    figure: { value: soonCountdown(startMs - nowMs), sub: 'Racecard out soon' },
    days: dates.map(d => ({
      key: d.key, weekday: weekdayShort(d.date).toUpperCase(), date: dayOfMonth(d.date), label: `Day ${d.n}`,
      kind: 'future', line: opensText(d.date, today), action: null,
    })),
    silks: null,
    button: { label: 'Festival details', outline: true, action: { to: '/festivals' } },
  }
}
