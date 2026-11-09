// Data for the Players tab: everyone who plays, their picks, and the groups. Reads reuse the existing tables and
// helpers; the only writes are a group's name, removing a member, deleting a group, and deleting a test account
// (which goes through the delete-user Edge Function, because it has to remove the sign-in too).
import { supabase } from './supabase'
import { DAY } from './dayBonuses.js'
import { KINDS } from './raceDay.js'
import { buildRaceDays } from './adminToday.js'
import { pagedRows } from './adminRaceDays.js'
import { weekRaces, weekScores } from './weekSource.js'
import { festivalTotals } from './standings.js'
import { buildPlayers, buildGroups, displayName } from './playersView.js'

const must = ({ data, error }) => { if (error) throw error; return data || [] }

const PROFILE_COLS = 'id, username, full_name, email, created_at, is_admin, notifications_enabled, notifications_updated_at'

// Everything both views need, read once: players with their status, the race days, and the groups.
export async function loadAdminPlayers(nowMs = Date.now()) {
  const [profiles, weeks, days, festivals, wr, fr, picks, fpicks, groups, members] = await Promise.all([
    pagedRows('profiles', PROFILE_COLS),
    pagedRows('race_weeks', 'id, week_number, saturday_date, picks_deadline, picks_open_notified_at, festival_day_id'),
    pagedRows('festival_days', 'id, festival_id, day_number, race_date, picks_deadline, picks_open_notified_at'),
    pagedRows('festivals', 'id, name, display_name, venue'),
    pagedRows('races', 'id, race_week_id'),
    pagedRows('festival_races', 'id, festival_day_id'),
    pagedRows('picks', 'id, user_id, race_day_id'),
    pagedRows('festival_picks', 'id, user_id, race_day_id'),
    pagedRows('groups', 'id, name, invite_code, created_by, created_at'),
    pagedRows('group_members', 'id, group_id, user_id, is_founder, joined_at'),
  ])
  const hasRaces = new Set([...wr.map(r => `week:${r.race_week_id}`), ...fr.map(r => `festival:${r.festival_day_id}`)])
  const raceDays = buildRaceDays({ weeks, days, festivals }).filter(d => hasRaces.has(d.key))

  // A pick belongs to a race day; the same player has one pick per race, so this is a set of players per day.
  const pickedByDay = {}
  const add = (key, userId) => { if (userId) (pickedByDay[key] ||= new Set()).add(userId) }
  picks.forEach(p => p.race_day_id && add(`week:${p.race_day_id}`, p.user_id))
  fpicks.forEach(p => p.race_day_id && add(`festival:${p.race_day_id}`, p.user_id))

  const built = buildPlayers({ profiles, days: raceDays, pickedByDay }, nowMs)
  const names = Object.fromEntries(profiles.map(p => [p.id, displayName(p)]))
  const groupRows = buildGroups({ groups, members, names, pickedByDay }, built.last)
  return { ...built, raceDays, pickedByDay, names, profiles, groups: groupRows, members }
}

// What a player has scored: this season's Saturday League points and each festival they are entered in.
export async function loadPlayerPoints(userId) {
  const season = (await supabase.from('seasons').select('id, name').eq('is_active', true).limit(1)).data?.[0] || null
  let seasonPoints = null
  if (season) {
    const sweeks = must(await supabase.from('race_weeks').select('id, festival_day_id').eq('season_id', season.id))
    const races = sweeks.length ? await weekRaces(sweeks).catch(() => []) : []
    const scores = races.length ? await weekScores(races, { userIds: [userId] }).catch(() => []) : []
    seasonPoints = scores.reduce((n, s) => n + (s.total_points || 0), 0)
  }
  const entries = must(await supabase.from('festival_entries').select('festival_id, starting_points').eq('user_id', userId))
  const festivals = []
  for (const e of entries) {
    const f = (await supabase.from('festivals').select('id, name, display_name').eq('id', e.festival_id).maybeSingle()).data
    const fdays = must(await supabase.from('festival_days').select('id').eq('festival_id', e.festival_id))
    const races = fdays.length ? must(await supabase.from('festival_races').select('id').in('festival_day_id', fdays.map(d => d.id))) : []
    const scores = races.length
      ? must(await supabase.from('festival_scores').select('user_id, total_points, position_achieved').eq('user_id', userId).in('festival_race_id', races.map(r => r.id)))
      : []
    const { totals } = festivalTotals([{ user_id: userId, starting_points: e.starting_points }], scores)
    festivals.push({ id: e.festival_id, name: f?.display_name || f?.name || 'Festival', points: totals[userId] || 0 })
  }
  return { season, seasonPoints, festivals }
}

// A player's picks for one race day: [{ race, pick: { horse, price, betType, banker, replaced } | null, points: number | null }].
export async function loadPlayerPicks(userId, day) {
  const c = DAY[day.kind], k = KINDS[day.kind]
  const races = must(await supabase.from(c.races).select('id, race_number, race_time, race_name, venue, is_abandoned').eq(c.raceDayCol, day.id).order('race_number'))
  if (!races.length) return []
  const ids = races.map(r => r.id)
  const [picks, scores] = await Promise.all([
    supabase.from(c.picks).select(`runner_id, bet_type, is_banker, was_replaced, ${c.raceCol}`).eq('user_id', userId).in(c.raceCol, ids).then(must),
    supabase.from(c.scores).select(`total_points, ${c.raceCol}`).eq('user_id', userId).in(c.raceCol, ids).then(must),
  ])
  const runnerIds = [...new Set(picks.map(p => p.runner_id).filter(Boolean))]
  const runners = runnerIds.length ? must(await supabase.from(k.runners).select('id, horse_name, odds_fractional, is_withdrawn').in('id', runnerIds)) : []
  const byRunner = Object.fromEntries(runners.map(r => [r.id, r]))
  return races.map(race => {
    const p = picks.find(x => x[c.raceCol] === race.id)
    const s = scores.find(x => x[c.raceCol] === race.id)
    const r = p ? byRunner[p.runner_id] : null
    return {
      race,
      pick: p ? { horse: r?.horse_name || 'Unknown horse', price: r?.odds_fractional || '', betType: p.bet_type, banker: !!p.is_banker, replaced: !!p.was_replaced, withdrawn: !!r?.is_withdrawn } : null,
      points: s ? s.total_points ?? 0 : null,
    }
  })
}

// ═══ Actions ═══════════════════════════════════════════════════════════

// A write that RLS can refuse without an error shows up as 0 rows changed, so every write here asks for its row back.
const oneRow = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  if ((res.data || []).length !== 1) throw new Error(`${what} (0 rows changed). Check you are signed in as an admin and that the Players migration has been run.`)
}

export async function renameGroup(groupId, name) {
  const clean = String(name || '').trim()
  if (!clean) return { ok: false, error: 'Give the group a name' }
  if (clean.length > 40) return { ok: false, error: 'Keep the name to 40 characters or fewer' }
  try {
    oneRow(await supabase.from('groups').update({ name: clean }).eq('id', groupId).select('id'), 'Could not rename the group')
    return { ok: true, name: clean }
  } catch (err) { return { ok: false, error: err.message || String(err) } }
}

export async function removeGroupMember(groupId, userId) {
  try {
    oneRow(await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId).select('id'), 'Could not remove the member')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message || String(err) } }
}

export async function deleteGroup(groupId) {
  try {
    // Members first, in case the database does not cascade. Zero rows is fine here (an empty group).
    const m = await supabase.from('group_members').delete().eq('group_id', groupId).select('id')
    if (m.error) throw new Error(`Could not remove the members: ${m.error.message}`)
    oneRow(await supabase.from('groups').delete().eq('id', groupId).select('id'), 'Could not delete the group')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message || String(err) } }
}

export const inviteLink = code => `${window.location.origin}/join/${code}`

// Deletes the player's sign-in and everything they have (the Edge Function, service role, admins only).
export async function deletePlayer(player) {
  try {
    const { data, error } = await supabase.functions.invoke('delete-user', { body: { userId: player.id, username: player.name } })
    if (error) {
      // supabase-js hides the function's own message inside the response; read it when it is there.
      let msg = error.message || String(error)
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* keep msg */ }
      throw new Error(msg)
    }
    if (data?.error) throw new Error(data.error)
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message || String(err) } }
}
