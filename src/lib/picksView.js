// Small pure helpers for the Picks page, kept apart from Supabase so they are easy to test.

// Festivals offered as competition pills: switched on and not yet finished.
export function runningFestivals(festivals, today) {
  return (festivals || []).filter(f => f.is_active && (f.end_date || f.start_date) >= today)
}

// The festival the player is looking at, or null for the Saturday League.
// A group id or a festival that is no longer running falls back to Saturday.
export function selectedFestival(competition, festivals) {
  if (competition?.type !== 'festival') return null
  return festivals.find(f => f.id === competition.id) || null
}

// A festival day still takes picks until its stored deadline.
export function isDayOpen(day, nowMs, today) {
  return day.picks_deadline ? nowMs < new Date(day.picks_deadline).getTime() : day.race_date >= today
}

// Day shown first: the earliest open day, else today's, else the next, else the last.
export function defaultFestDay(days, openDays, today) {
  return openDays[0]
    || days.find(d => d.race_date === today)
    || days.find(d => d.race_date >= today)
    || days[days.length - 1]
    || null
}

// A pick counts only while the horse is still running.
export function hasLivePick(runnerId, raceRunners) {
  if (!runnerId) return false
  return !raceRunners.find(r => r.id === runnerId)?.is_withdrawn
}

// Index of the first race still needing a pick, or the first race if all are done.
export function firstUnpickedIndex(races, isPicked) {
  const i = races.findIndex(r => !isPicked(r.id))
  return i === -1 ? 0 : i
}
