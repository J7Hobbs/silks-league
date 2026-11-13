import { supabase } from './supabase'
import { seasonTable, festivalRank } from './standings'
import { localDateStr, ukDateStr, daysBetween, deadlineMs } from './format'
import { loadUpcomingFestivals, pickNextFestival, loadCurrentFestival } from './festivalData.js'
import { festivalFinalStatus } from './festivalFinal.js'
import { weekRaces } from './weekSource.js'
import { pickWeekFestival } from './homeCards.js'

// Everything the Home page needs, in one read-only load. A failing part is
// logged and left empty so the rest of the page still renders.

function groupBy(rows, key) {
  const out = {}
  for (const r of rows) (out[r[key]] = out[r[key]] || []).push(r)
  return out
}

// ── Saturday League ─────────────────────────────────────────────────────────
// open     picks are open now (a race week with races and a future deadline)
// closed   it's race day and the deadline has passed
// lastWeek last week's result, up to 14 days after that race week
// announced the next race week exists but has no races yet
// returns  nothing recent: "returns soon" with the position in the active season
// The card itself (homeCards.js) works out what to show from this, as the clock moves on.
const RACE_COLS = ['race_number', 'race_time', 'venue', 'race_name']   // race columns read for a week (weekRaces)
const FESTIVAL_RUNNER_COLS = 'id, horse_name, silk_colour, silk_colour_secondary, silk_pattern, is_withdrawn'
const RUNNER_COLS = 'id, race_id, horse_name, horse_number, silk_colour, silk_colour_secondary, silk_pattern, odds_fractional, odds_decimal, is_withdrawn'

// A race week's races, the player's picks and scores, the results and the season table.
async function loadWeekDetail(userId, races, season, referenceWeekId) {
  const raceIds = races.map(r => r.id)
  const [runners, picks, results, scores, table] = await Promise.all([
    supabase.from('runners').select(RUNNER_COLS).in('race_id', raceIds).then(r => r.data || []),
    supabase.from('picks').select('race_id, runner_id, bet_type, was_replaced').eq('user_id', userId).in('race_id', raceIds).then(r => r.data || []),
    supabase.from('results').select('race_id, position, horse_name, starting_price_display').in('race_id', raceIds).then(r => r.data || []),
    supabase.from('scores').select('race_id, total_points, position_achieved, bet_type, place_token_points').eq('user_id', userId).in('race_id', raceIds).then(r => r.data || []),
    season ? seasonTable(userId, season.id, referenceWeekId) : Promise.resolve(null),
  ])
  return { races, runners, picks, results, scores, table }
}

// The next race week (today or later) when it has no races yet, else null.
async function findAnnouncedWeek(weeks, today, exceptId) {
  const next = weeks
    .filter(w => w.saturday_date >= today && w.id !== exceptId)
    .sort((a, b) => (a.saturday_date < b.saturday_date ? -1 : 1))[0]
  if (!next) return null
  // A week linked to a festival day has that day's races (weekSource.js).
  const races = await weekRaces([next])
  return races.length ? null : { id: next.id, saturday_date: next.saturday_date, festival_day_id: next.festival_day_id || null }
}

// The festival day a race week is linked to: which festival and which day, for the card's wording. Null if it can't be read.
async function linkedDayInfo(dayId) {
  if (!dayId) return null
  try {
    const { data: day } = await supabase.from('festival_days').select('id, day_number, festival_id').eq('id', dayId).maybeSingle()
    if (!day) return null
    const { data: f } = await supabase.from('festivals').select('id, name, display_name, venue').eq('id', day.festival_id).maybeSingle()
    return { dayNumber: day.day_number, festivalId: day.festival_id, festivalName: f ? (f.display_name || f.name) : null, venue: f?.venue || null }
  } catch { return null }
}

async function loadSaturday(userId, today, nowMs) {
  const [{ data: season }, { data: weeks }] = await Promise.all([
    supabase.from('seasons').select('id, start_date').eq('is_active', true).maybeSingle(),
    supabase.from('race_weeks').select('id, season_id, week_number, saturday_date, picks_deadline, festival_day_id')
      .order('saturday_date', { ascending: false }).limit(12),
  ])
  const all = weeks || []
  const seasonInfo = season ? { id: season.id, startDate: season.start_date } : null

  const upcoming = all
    .filter(w => season && w.season_id === season.id && deadlineMs(w.picks_deadline, w.saturday_date) > nowMs)
    .sort((a, b) => deadlineMs(a.picks_deadline, a.saturday_date) - deadlineMs(b.picks_deadline, b.saturday_date))
  const todayWeek = all.find(w => w.saturday_date === today)

  const candidateWeeks = [...new Map([...upcoming, todayWeek].filter(Boolean).map(w => [w.id, w])).values()]
  let racesByWeek = {}
  if (candidateWeeks.length) {
    racesByWeek = groupBy(await weekRaces(candidateWeeks, RACE_COLS), 'race_week_id')
  }
  const hasRaces = w => (racesByWeek[w.id] || []).length > 0

  const openWeek = upcoming.find(hasRaces) || null
  const closedWeek = !openWeek && todayWeek && hasRaces(todayWeek) ? todayWeek : null
  const current = openWeek || closedWeek

  // A week linked to a festival day has no Saturday League card of its own: the festival's card
  // on Home covers it (and says the picks also count for the Saturday League).
  if (current?.festival_day_id) return { state: 'linked', week: current, season: seasonInfo }

  if (current) {
    // Once picks have closed, movement in the table is measured from before this week.
    const detail = await loadWeekDetail(userId, racesByWeek[current.id], seasonInfo, openWeek ? null : current.id)
    return {
      state: openWeek ? 'open' : 'closed',
      week: current,
      deadline: current.picks_deadline || `${current.saturday_date}T12:00:00`,
      season: seasonInfo,
      seasonRank: detail.table?.rank || null,
      ...detail,
    }
  }

  const last = all.find(w => w.saturday_date < today)
  if (last && daysBetween(last.saturday_date, today) <= 14) {
    const races = await weekRaces([last], RACE_COLS)
    if (races.length && last.festival_day_id) return { state: 'linked', week: last, season: seasonInfo }
    if (races.length) {
      // The next week, if it has been announced without races, takes over from the
      // results card on the Wednesday after race day; the card decides when.
      const [detail, nextWeek] = await Promise.all([
        loadWeekDetail(userId, races, seasonInfo, last.id),
        findAnnouncedWeek(all, today, last.id),
      ])
      return {
        state: 'lastWeek',
        week: last,
        nextWeek,
        linkedDay: await linkedDayInfo(nextWeek?.festival_day_id),
        deadline: last.picks_deadline || `${last.saturday_date}T12:00:00`,
        season: seasonInfo,
        seasonRank: detail.table?.rank || null,
        ...detail,
      }
    }
  }

  const [table, announced] = await Promise.all([
    season ? seasonTable(userId, season.id) : Promise.resolve(null),
    findAnnouncedWeek(all, today, null),
  ])
  if (announced) return { state: 'announced', week: announced, linkedDay: await linkedDayInfo(announced.festival_day_id), season: seasonInfo, table }
  return { state: 'returns', season: seasonInfo, seasonPos: table?.rank || null, table }
}

// Just the Saturday part, re-read while races are running.
export async function refreshSaturday(user) {
  const nowMs = Date.now()
  const saturday = await loadSaturday(user.id, localDateStr(new Date(nowMs)), nowMs)
  return saturday?.state === 'linked' ? null : { ...saturday, userId: user.id }
}

// Just the festival part, re-read while its races are running. Null if it can't be read (the card then keeps what it has).
export async function refreshFestival(user) {
  const nowMs = Date.now()
  try { return await loadFestival(user.id, localDateStr(new Date(nowMs)), nowMs) } catch { return null }
}

// ── Festival ────────────────────────────────────────────────────────────────
// Shown for the festival happening now or finished in the last 7 days (festivalData.js), or one
// switched on and about to start. Focus is the next day with open picks, else today's day
// (picks closed), else its last day.
async function loadFestival(userId, today, nowMs) {
  // The festival happening now (or finished within the last 7 days): the same date rule as the
  // Leaderboard (loadCurrentFestival). Failing that, a festival that is switched on and not yet
  // started, so its first day's picks can open ahead of time.
  let festival = (await loadCurrentFestival(ukDateStr(nowMs)))?.festival
  if (!festival) {
    const { data: fests } = await supabase.from('festivals').select('*')
      .eq('is_active', true).gt('start_date', today).order('start_date', { ascending: true })
    festival = fests?.[0]
  }
  if (!festival) return null

  const { data: days } = await supabase.from('festival_days')
    .select('id, day_number, race_date, picks_deadline').eq('festival_id', festival.id).order('day_number')
  const dayList = days || []
  if (!dayList.length) return null

  const { data: races } = await supabase.from('festival_races')
    .select('id, festival_day_id, race_number, race_time, venue, is_abandoned').in('festival_day_id', dayList.map(d => d.id)).order('race_number')
  const racesByDay = groupBy(races || [], 'festival_day_id')

  const openDay = dayList.find(d => (racesByDay[d.id] || []).length > 0 && deadlineMs(d.picks_deadline, d.race_date) > nowMs)
  // Flagged active before it starts and nothing to pick yet: it belongs under Coming up.
  if (!openDay && festival.start_date > today) return null

  const day = openDay || dayList.find(d => d.race_date === today) || dayList[dayList.length - 1]
  const dayRaces = racesByDay[day.id] || []
  const raceIds = dayRaces.map(r => r.id)
  const allRaceIds = (races || []).map(r => r.id)

  // The card shows every day (picks and points per day), so picks, results and scores are read for the whole festival.
  const resultsP = allRaceIds.length
    ? supabase.from('festival_results').select('festival_race_id').in('festival_race_id', allRaceIds).then(r => r.data || [])
    : Promise.resolve([])
  const picksP = allRaceIds.length
    ? supabase.from('festival_picks').select('festival_race_id, runner_id, is_banker').eq('user_id', userId).in('festival_race_id', allRaceIds).then(r => r.data || [])
    : Promise.resolve([])
  const [results, picks, scores, runnerRows, rankRaw, { data: linkedWeeks }, finalStatus] = await Promise.all([
    resultsP,
    picksP,
    allRaceIds.length
      ? supabase.from('festival_scores').select('festival_race_id, total_points, position_achieved').eq('user_id', userId).in('festival_race_id', allRaceIds).then(r => r.data || [])
      : Promise.resolve([]),
    // The silks of the player's picks (whichever day the card ends up showing).
    picksP.then(rows => {
      const ids = [...new Set(rows.filter(p => p.runner_id).map(p => p.runner_id))]
      return ids.length ? supabase.from('festival_runners').select(FESTIVAL_RUNNER_COLS).in('id', ids).then(r => r.data || []) : []
    }),
    festivalRank(userId, festival.id),
    // Which days are also a week of the Saturday League? (race_weeks.festival_day_id)
    supabase.from('race_weeks').select('festival_day_id').in('festival_day_id', dayList.map(d => d.id)),
    // Is the festival over (its last race is in)? Then the card links to its Final page. Left as not over if it can't be read.
    festivalFinalStatus(festival.id).catch(() => null),
  ])
  // Position in the festival only means something once a result is in (before that everyone is level on 0).
  const resultsIn = results.length > 0
  const rank = resultsIn ? rankRaw : null

  return {
    state: openDay ? 'open' : 'closed',
    festival,
    dayNumber: day.day_number,
    totalDays: dayList.length,
    total: raceIds.length,
    picked: new Set(picks.filter(p => raceIds.includes(p.festival_race_id)).map(p => p.festival_race_id)).size,
    deadline: day.picks_deadline || `${day.race_date}T12:00:00`,
    rank,
    resultsIn,
    alsoSaturday: (linkedWeeks || []).some(w => w.festival_day_id === day.id),
    dayIds: dayList.map(d => d.id),   // read by the card order (homeCards.js): is the Saturday League's week linked to this festival?
    // For the card (festivalCard.js), which works out the day it is about: every day with its races, and the player's picks, results and scores.
    days: dayList.map(d => ({
      id: d.id, number: d.day_number, date: d.race_date, deadline: d.picks_deadline, linked: (linkedWeeks || []).some(w => w.festival_day_id === d.id),
      races: (racesByDay[d.id] || []).map(r => ({ id: r.id, number: r.race_number, time: r.race_time, abandoned: !!r.is_abandoned })),
    })),
    picks: picks.filter(p => p.runner_id).map(p => ({ raceId: p.festival_race_id, runnerId: p.runner_id, banker: !!p.is_banker })),
    results: [...new Set(results.map(r => r.festival_race_id))],
    scores: scores.map(s => ({ raceId: s.festival_race_id, points: s.total_points, position: s.position_achieved })),
    runners: Object.fromEntries(runnerRows.map(r => [r.id, r])),
    final: !!finalStatus?.final,
    venue: festival.venue || dayRaces[0]?.venue || null,
  }
}

export async function loadHomeData(user) {
  const nowMs = Date.now()
  const today = localDateStr(new Date(nowMs))
  const safe = async (label, fn, fallback) => {
    try { return await fn() } catch (err) { console.error(`[Home] ${label} failed:`, err); return fallback }
  }

  const [profile, saturday, festival, upcoming] = await Promise.all([
    safe('profile', async () => (await supabase.from('profiles').select('is_admin, full_name, username').eq('id', user.id).single()).data, null),
    safe('saturday', async () => {
      const sat = await loadSaturday(user.id, today, nowMs)
      // Linked to a festival day: no Saturday card (the festival's card says it also counts).
      return sat?.state === 'linked' ? null : { ...sat, userId: user.id }
    }, null),
    safe('festival', () => loadFestival(user.id, today, nowMs), null),
    safe('upcoming', () => loadUpcomingFestivals(nowMs), null),
  ])

  // A festival racing in the Saturday League's week is a card from the start of that week, even before its racecard is in.
  const festivalSoon = festival ? null : pickWeekFestival(upcoming, saturday, nowMs)

  return {
    profile,
    saturday,
    festival,
    festivalSoon,
    nextFestival: pickNextFestival(upcoming, (festival || festivalSoon)?.festival.id),
  }
}
