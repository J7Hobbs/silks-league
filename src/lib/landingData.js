// What the logged-out landing page needs from the database: one festival, nothing else.
// festivals is readable by signed-in users only, so this goes through the public
// get_next_festival() function (supabase/get_next_festival_migration.sql). It returns
// the festival that is live today, or else the next one to start. If the function is
// missing or fails, the landing page simply leaves that section out.
import { supabase } from './supabase'
import { ukDateStr, daysBetween } from './format.js'
import { dateRange, untilText } from './festivalView.js'

export async function loadNextFestival() {
  try {
    const { data, error } = await supabase.rpc('get_next_festival')
    if (error) return null
    const row = Array.isArray(data) ? data[0] : data
    return row || null
  } catch {
    return null
  }
}

// Everything the photo card prints, ready-made. null (card hidden) when there is no festival.
export function festivalTeaser(row, nowMs = Date.now()) {
  if (!row || !row.start_date) return null
  const today = ukDateStr(nowMs)
  const live = row.is_live === true
  return {
    tag: live ? 'LIVE NOW' : `NEXT FESTIVAL · ${untilText(daysBetween(today, row.start_date)).toUpperCase()}`,
    venue: row.venue || '',
    name: row.display_name || row.name || '',
    dates: dateRange(row.start_date, row.end_date, 'long'),
    photo: { url: row.banner_url || null, position: row.banner_position || null },
  }
}
