// Read-only festival reads for Home's "next festival" card and the Festivals page.
import { supabase } from './supabase'
import { ukDateStr, daysBetween } from './format.js'

const COLS = 'id, name, display_name, start_date, end_date, venue, banner_url, banner_position, is_active'

// The one rule for "the festival happening now" (Home's festival card, the Leaderboard hub and a
// group's festival switch): it has at least one race, today is on or after its start date, and
// today is no more than 7 days after its end date. Decided by dates only, not by is_active. If two
// qualify, the one that started most recently. -> { festival, live } or null (live = not yet over).
export function festivalInWindow(f, today) {
  return !!f.start_date && f.start_date <= today && daysBetween(f.end_date || f.start_date, today) <= 7
}

export async function loadCurrentFestival(today = ukDateStr(Date.now())) {
  const { data } = await supabase.from('festivals').select('*').order('start_date', { ascending: false })
  // Only a handful pass the dates, so checking them for races one by one is cheap.
  for (const f of (data || []).filter(f => festivalInWindow(f, today))) {
    const { data: days } = await supabase.from('festival_days').select('id').eq('festival_id', f.id)
    if (!days?.length) continue
    const { count } = await supabase.from('festival_races')
      .select('id', { count: 'exact', head: true }).in('festival_day_id', days.map(d => d.id))
    if (count > 0) return { festival: f, live: (f.end_date || f.start_date) >= today }
  }
  return null
}

// Festivals starting after today (UK), earliest first, plus the day rows of the first two
// (the live festival card may already be showing the first one). Pass the result to
// pickNextFestival once it is known which festival the live card shows.
export async function loadUpcomingFestivals(nowMs = Date.now()) {
  const today = ukDateStr(nowMs)
  const { data } = await supabase.from('festivals').select(COLS)
    .gt('start_date', today).order('start_date', { ascending: true })
  const list = data || []
  const ids = list.slice(0, 2).map(f => f.id)
  const { data: days } = ids.length
    ? await supabase.from('festival_days').select('id, festival_id, day_number, race_date').in('festival_id', ids).order('day_number')
    : { data: [] }
  return { list, days: days || [], today }
}

// The card for Home: the first upcoming festival other than `excludeId`, with its day rows
// and how many more start later in the same calendar year. null when there is none.
export function pickNextFestival(up, excludeId) {
  const list = (up?.list || []).filter(f => f.id !== excludeId)
  const next = list[0]
  if (!next) return null
  const year = next.start_date.slice(0, 4)
  return {
    festival: next,
    days: up.days.filter(d => d.festival_id === next.id),
    moreThisYear: list.slice(1).filter(f => f.start_date.slice(0, 4) === year).length,
    today: up.today,
  }
}

// Festivals that haven't finished, for the Festivals page. Throws if the read fails.
export async function loadFestivalCalendar(nowMs = Date.now()) {
  const today = ukDateStr(nowMs)
  const { data, error } = await supabase.from('festivals').select(COLS)
    .gte('end_date', today).order('start_date', { ascending: true })
  if (error) throw error
  return { rows: data || [], today }
}
