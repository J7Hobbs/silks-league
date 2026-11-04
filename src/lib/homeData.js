import { supabase } from './supabase'
import { seasonsRank, weekRank, festivalRank } from './standings'
import { localDateStr, daysBetween, deadlineMs } from './format'

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
// returns  nothing recent: "returns soon" with the annual position
async function loadSaturday(userId, today, nowMs) {
  const { data: season } = await supabase.from('seasons').select('id, year').eq('is_active', true).maybeSingle()
  const { data: weeks } = await supabase
    .from('race_weeks').select('id, season_id, week_number, saturday_date, picks_deadline')
    .order('saturday_date', { ascending: false }).limit(12)
  const all = weeks || []

  const upcoming = all
    .filter(w => season && w.season_id === season.id && deadlineMs(w.picks_deadline, w.saturday_date) > nowMs)
    .sort((a, b) => deadlineMs(a.picks_deadline, a.saturday_date) - deadlineMs(b.picks_deadline, b.saturday_date))
  const todayWeek = all.find(w => w.saturday_date === today)

  const candidateIds = [...new Set([...upcoming.map(w => w.id), todayWeek?.id].filter(Boolean))]
  let racesByWeek = {}
  if (candidateIds.length) {
    const { data: races } = await supabase.from('races').select('id, race_week_id').in('race_week_id', candidateIds)
    racesByWeek = groupBy(races || [], 'race_week_id')
  }
  const hasRaces = w => (racesByWeek[w.id] || []).length > 0

  const openWeek = upcoming.find(hasRaces) || null
  const closedWeek = !openWeek && todayWeek && hasRaces(todayWeek) ? todayWeek : null
  const current = openWeek || closedWeek

  if (current) {
    const raceIds = racesByWeek[current.id].map(r => r.id)
    const [{ data: picks }, rank] = await Promise.all([
      supabase.from('picks').select('race_id').eq('user_id', userId).in('race_id', raceIds),
      season ? seasonsRank(userId, [season.id]) : Promise.resolve(null),
    ])
    return {
      state: openWeek ? 'open' : 'closed',
      week: current,
      total: raceIds.length,
      picked: new Set((picks || []).map(p => p.race_id)).size,
      deadline: current.picks_deadline || `${current.saturday_date}T12:00:00`,
      seasonRank: rank,
    }
  }

  const last = all.find(w => w.saturday_date < today)
  if (last && daysBetween(last.saturday_date, today) <= 14) {
    const { data: races } = await supabase.from('races').select('id').eq('race_week_id', last.id)
    const raceIds = (races || []).map(r => r.id)
    let points = 0
    let winners = 0
    let rank = null
    if (raceIds.length) {
      const [{ data: mine }, r] = await Promise.all([
        supabase.from('scores').select('total_points, position_achieved').eq('user_id', userId).in('race_id', raceIds),
        weekRank(userId, raceIds),
      ])
      points = (mine || []).reduce((sum, s) => sum + (s.total_points || 0), 0)
      winners = (mine || []).filter(s => s.position_achieved === 1).length
      rank = r
    }
    return { state: 'lastWeek', week: last, points, winners, rank }
  }

  let year = season?.year
  if (!year) {
    const { data: latest } = await supabase.from('seasons').select('year').order('year', { ascending: false }).limit(1)
    year = latest?.[0]?.year ?? new Date().getFullYear()
  }
  const { data: seasons } = await supabase.from('seasons').select('id').eq('year', year)
  const annual = seasons?.length ? await seasonsRank(userId, seasons.map(s => s.id)) : null
  return { state: 'returns', year, annual }
}

// ── Festival ────────────────────────────────────────────────────────────────
// Shown when a festival is active and hasn't ended. Focus is the next day with
// open picks, else today's day (picks closed).
async function loadFestival(userId, today, nowMs) {
  const { data: fests } = await supabase.from('festivals').select('*')
    .eq('is_active', true).gte('end_date', today).order('start_date', { ascending: true })
  const festival = fests?.[0]
  if (!festival) return null

  const { data: days } = await supabase.from('festival_days')
    .select('id, day_number, race_date, picks_deadline').eq('festival_id', festival.id).order('day_number')
  const dayList = days || []
  if (!dayList.length) return null

  const { data: races } = await supabase.from('festival_races')
    .select('id, festival_day_id, race_number, venue').in('festival_day_id', dayList.map(d => d.id)).order('race_number')
  const racesByDay = groupBy(races || [], 'festival_day_id')

  const openDay = dayList.find(d => (racesByDay[d.id] || []).length > 0 && deadlineMs(d.picks_deadline, d.race_date) > nowMs)
  // Flagged active before it starts and nothing to pick yet: it belongs under Coming up.
  if (!openDay && festival.start_date > today) return null

  const day = openDay || dayList.find(d => d.race_date === today) || dayList[dayList.length - 1]
  const dayRaces = racesByDay[day.id] || []
  const raceIds = dayRaces.map(r => r.id)

  const [{ data: picks }, rank] = await Promise.all([
    raceIds.length
      ? supabase.from('festival_picks').select('festival_race_id').eq('user_id', userId).in('festival_race_id', raceIds)
      : Promise.resolve({ data: [] }),
    festivalRank(userId, festival.id),
  ])

  return {
    state: openDay ? 'open' : 'closed',
    festival,
    dayNumber: day.day_number,
    totalDays: dayList.length,
    total: raceIds.length,
    picked: new Set((picks || []).map(p => p.festival_race_id)).size,
    deadline: day.picks_deadline || `${day.race_date}T12:00:00`,
    rank,
    venue: festival.venue || dayRaces[0]?.venue || null,
  }
}

async function loadUpcoming(today) {
  const { data } = await supabase.from('festivals')
    .select('id, name, display_name, start_date, end_date, venue')
    .gt('start_date', today).order('start_date', { ascending: true }).limit(5)
  return data || []
}

export async function loadHomeData(user) {
  const nowMs = Date.now()
  const today = localDateStr(new Date(nowMs))
  const safe = async (label, fn, fallback) => {
    try { return await fn() } catch (err) { console.error(`[Home] ${label} failed:`, err); return fallback }
  }

  const [profile, saturday, festival, upcoming] = await Promise.all([
    safe('profile', async () => (await supabase.from('profiles').select('is_admin, full_name, username').eq('id', user.id).single()).data, null),
    safe('saturday', () => loadSaturday(user.id, today, nowMs), null),
    safe('festival', () => loadFestival(user.id, today, nowMs), null),
    safe('upcoming', () => loadUpcoming(today), []),
  ])

  return {
    profile,
    saturday,
    festival,
    upcoming: upcoming.filter(f => f.id !== festival?.festival.id).slice(0, 4),
  }
}
