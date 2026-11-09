// Data and actions for the Setup tab: seasons and festivals. Reuses the tables and rules the classic Admin uses
// (one active season at a time, festival days made the same way) and the ranking functions for "won by".
import { supabase } from './supabase'
import { pagedRows } from './adminRaceDays.js'
import { seasonTable } from './standings.js'
import { ukDateStr } from './format.js'
import { festivalDayRow, festivalDayRows, dayName, fitWidth, PHOTO_TYPES, planFestivalEdit, renumberAfterRemove, festivalSpan, bannerPositionValue } from './setupView.js'

const must = ({ data, error }) => { if (error) throw error; return data || [] }
const BUCKET = 'festival-photos'

// A write that RLS can refuse without an error shows up as 0 rows changed, so every write asks for its row back.
const oneRow = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  if ((res.data || []).length !== 1) throw new Error(`${what} (0 rows changed). Check you are signed in as an admin.`)
}
const fail = err => ({ ok: false, error: err.message || String(err) })

// ═══ Seasons ═══════════════════════════════════════════════════════════

// Every season with its race-week count, and "won by" for the finished ones (top of that season's table, the same
// ranking the app uses; nobody on 0 points counts as a winner).
export async function loadSeasons(nowMs = Date.now()) {
  const [seasons, weeks, profiles] = await Promise.all([
    pagedRows('seasons', '*'),
    pagedRows('race_weeks', 'id, season_id'),
    pagedRows('profiles', 'id, username, full_name'),
  ])
  const names = Object.fromEntries(profiles.map(p => [p.id, p.username || p.full_name || 'A player']))
  const today = ukDateStr(nowMs)
  const rows = seasons.map(s => ({ ...s, weekCount: weeks.filter(w => w.season_id === s.id).length }))
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
  const finished = rows.filter(s => !s.is_active && (s.status === 'completed' || (s.end_date && s.end_date < today)))
  await Promise.all(finished.map(async s => {
    try {
      const { rows: table } = await seasonTable(profiles[0]?.id, s.id)   // any real player id: the rows are the whole table
      const top = table[0]
      s.winner = top && top.points > 0 ? { name: names[top.id] || top.name || 'A player', points: top.points } : null
    } catch { s.winner = null }
  }))
  return rows
}

export async function createSeason(f) {
  try {
    const row = { name: f.name.trim(), year: Number(f.startDate.slice(0, 4)), start_date: f.startDate, end_date: f.endDate, is_active: false }
    const res = await supabase.from('seasons').insert(row).select('id')
    if (res.error) throw new Error(`Could not create the season: ${res.error.message}`)
    return { ok: true, id: res.data?.[0]?.id }
  } catch (err) { return fail(err) }
}

export async function updateSeason(id, f) {
  try {
    oneRow(await supabase.from('seasons').update({ name: f.name.trim(), year: Number(f.startDate.slice(0, 4)), start_date: f.startDate, end_date: f.endDate }).eq('id', id).select('id'), 'Could not save the season')
    return { ok: true }
  } catch (err) { return fail(err) }
}

// Only one season is active at a time: every other season is switched off, then this one on (as the classic Admin does).
export async function setActiveSeason(id) {
  try {
    const off = await supabase.from('seasons').update({ is_active: false }).neq('id', id)
    if (off.error) throw new Error(`Could not switch the old season off: ${off.error.message}`)
    oneRow(await supabase.from('seasons').update({ is_active: true }).eq('id', id).select('id'), 'Could not set the season active')
    return { ok: true }
  } catch (err) { return fail(err) }
}

export async function completeSeason(id) {
  try {
    oneRow(await supabase.from('seasons').update({ status: 'completed' }).eq('id', id).select('id'), 'Could not complete the season')
    return { ok: true }
  } catch (err) { return fail(err) }
}

// Picks made on any of the season's race weeks. A season with picks cannot be deleted.
export async function countSeasonPicks(seasonId) {
  const weeks = must(await supabase.from('race_weeks').select('id').eq('season_id', seasonId))
  if (!weeks.length) return 0
  const { count } = await supabase.from('picks').select('id', { count: 'exact', head: true }).in('race_day_id', weeks.map(w => w.id))
  return count || 0
}

export async function deleteSeason(season) {
  try {
    if (season.is_active) throw new Error('Set another season active first. The active season cannot be deleted.')
    const n = await countSeasonPicks(season.id)
    if (n > 0) throw new Error(`This season has ${n} pick${n === 1 ? '' : 's'}, so it cannot be deleted.`)
    oneRow(await supabase.from('seasons').delete().eq('id', season.id).select('id'), 'Could not delete the season')
    return { ok: true }
  } catch (err) { return fail(err) }
}

// ═══ Festivals ═════════════════════════════════════════════════════════

export async function loadFestivals() {
  const [festivals, days] = await Promise.all([pagedRows('festivals', '*'), pagedRows('festival_days', 'id, festival_id')])
  return festivals.map(f => ({ ...f, dayCount: days.filter(d => d.festival_id === f.id).length }))
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))
}

// One festival with its days: each day's race count and the Saturday League week linked to it, if any.
export async function loadFestivalDetail(id) {
  const festival = (await supabase.from('festivals').select('*').eq('id', id).maybeSingle()).data
  if (!festival) throw new Error('That festival no longer exists')
  const days = must(await supabase.from('festival_days').select('id, day_number, race_date, label').eq('festival_id', id).order('day_number'))
  const dayIds = days.map(d => d.id)
  const [races, weeks] = dayIds.length ? await Promise.all([
    supabase.from('festival_races').select('id, festival_day_id').in('festival_day_id', dayIds).then(must),
    supabase.from('race_weeks').select('id, week_number, festival_day_id').in('festival_day_id', dayIds).then(must),
  ]) : [[], []]
  return {
    festival,
    days: days.map(d => ({
      ...d,
      raceCount: races.filter(r => r.festival_day_id === d.id).length,
      linkedWeek: weeks.find(w => w.festival_day_id === d.id) || null,
    })),
  }
}

const festivalFields = f => ({
  name: f.name.trim(), display_name: (f.displayName || '').trim() || null, venue: (f.venue || '').trim() || null,
  start_date: f.startDate, end_date: f.endDate,
})

// Creates the festival (switched off) and a day for every date, the way the classic Admin does.
export async function createFestival(f) {
  let id = null
  try {
    const res = await supabase.from('festivals').insert({ ...festivalFields(f), banner_colour: '#c9a84c', is_active: false }).select('id')
    if (res.error) throw new Error(`Could not create the festival: ${res.error.message}`)
    id = res.data?.[0]?.id
    const rows = festivalDayRows(id, f.startDate, f.endDate)
    const ins = await supabase.from('festival_days').insert(rows)
    if (ins.error) throw new Error(`The festival was created but its days were not: ${ins.error.message}`)
    return { ok: true, id, days: rows.length }
  } catch (err) { return { ...fail(err), id } }
}

// Saves the details. Existing days move by however far the start date moved (a festival with a day taken out keeps its
// gap), and days are added if the festival got longer. Days past a shortened end date are kept, with their races, so an
// edit never deletes anything.
export async function updateFestival(festival, days, f) {
  try {
    oneRow(await supabase.from('festivals').update(festivalFields(f)).eq('id', festival.id).select('id'), 'Could not save the festival')
    const { moves, adds } = planFestivalEdit(festival, days, f)
    // Later days first when moving forward, earlier first when moving back, so two days never share a date part-way.
    const forward = moves.length && moves[0].race_date > days.find(d => d.id === moves[0].id).race_date
    for (const m of forward ? [...moves].reverse() : moves) {
      const { id, ...patch } = m
      oneRow(await supabase.from('festival_days').update(patch).eq('id', id).select('id'), `Could not move Day ${m.day_number}`)
    }
    for (const a of adds) {
      const ins = await supabase.from('festival_days').insert(a)
      if (ins.error) throw new Error(`Could not add Day ${a.day_number}: ${ins.error.message}`)
    }
    return { ok: true }
  } catch (err) { return fail(err) }
}

export async function addFestivalDay(festival, days, date) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Choose a date for the day')
    if (days.some(d => d.race_date === date)) throw new Error('This festival already has a day on that date')
    const number = Math.max(0, ...days.map(d => d.day_number)) + 1
    const ins = await supabase.from('festival_days').insert(festivalDayRow(festival.id, number, date)).select('id')
    if (ins.error) throw new Error(`Could not add the day: ${ins.error.message}`)
    // Keep the festival's own dates covering all its days.
    const patch = {}
    if (date > (festival.end_date || '')) patch.end_date = date
    if (date < (festival.start_date || '9999')) patch.start_date = date
    if (Object.keys(patch).length) oneRow(await supabase.from('festivals').update(patch).eq('id', festival.id).select('id'), 'The day was added but the festival dates were not updated')
    return { ok: true, number, dayName: dayName(date), id: ins.data?.[0]?.id }
  } catch (err) { return fail(err) }
}

// Why a day cannot be removed, or '' when it can: it must have no races, no picks, and no Saturday League week linked to it.
export async function dayRemovalBlock(day) {
  const races = must(await supabase.from('festival_races').select('id').eq('festival_day_id', day.id))
  if (races.length) return `Day ${day.day_number} has ${races.length === 1 ? '1 race' : `${races.length} races`}. A day can only be removed while it has no races.`
  const { count, error } = await supabase.from('festival_picks').select('id', { count: 'exact', head: true }).eq('race_day_id', day.id)
  if (error) throw error
  if (count) return `${count} pick${count === 1 ? ' has' : 's have'} been made on Day ${day.day_number}, so it cannot be removed.`
  const weeks = must(await supabase.from('race_weeks').select('id, week_number').eq('festival_day_id', day.id))
  if (weeks.length) return `Saturday League week ${weeks[0].week_number} is linked to Day ${day.day_number}. Unlink it in Race days first.`
  return ''
}

// Removes a day with no races, picks or linked week. The days after it close the gap (Day 4 becomes Day 3), and the
// festival's own dates follow the days that are left.
export async function removeFestivalDay(festival, days, day) {
  try {
    const block = await dayRemovalBlock(day)
    if (block) throw new Error(block)
    oneRow(await supabase.from('festival_days').delete().eq('id', day.id).select('id'), 'Could not remove the day')
    for (const r of renumberAfterRemove(days, day)) {
      const { id, ...patch } = r
      oneRow(await supabase.from('festival_days').update(patch).eq('id', id).select('id'), 'The day was removed but a later day was not renumbered')
    }
    const span = festivalSpan(days.filter(d => d.id !== day.id))
    if (span && (span.start !== festival.start_date || span.end !== festival.end_date)) {
      oneRow(await supabase.from('festivals').update({ start_date: span.start, end_date: span.end }).eq('id', festival.id).select('id'), 'The day was removed but the festival dates were not updated')
    }
    return { ok: true }
  } catch (err) { return fail(err) }
}

// Saves where the photo sits in the banner (festivals.banner_position, which the app already reads). y is 0 (top) to 100 (bottom).
export async function saveBannerPosition(festivalId, y) {
  try {
    oneRow(await supabase.from('festivals').update({ banner_position: bannerPositionValue(y) }).eq('id', festivalId).select('id'), 'Could not save the photo position')
    return { ok: true }
  } catch (err) { return fail(err) }
}

// Switches this one festival on or off in the app. Other festivals are left as they are.
export async function setFestivalActive(id, on) {
  try {
    oneRow(await supabase.from('festivals').update({ is_active: !!on }).eq('id', id).select('id'), 'Could not change the festival')
    return { ok: true }
  } catch (err) { return fail(err) }
}

export async function countFestivalPicks(festivalId) {
  const days = must(await supabase.from('festival_days').select('id').eq('festival_id', festivalId))
  if (!days.length) return 0
  const { count } = await supabase.from('festival_picks').select('id', { count: 'exact', head: true }).in('race_day_id', days.map(d => d.id))
  return count || 0
}

// Deletes a festival with its days, races and runners (the database cascades). Blocked once anyone has made a pick.
// A Saturday League week linked to one of its days is unlinked first.
export async function deleteFestival(festival) {
  try {
    const n = await countFestivalPicks(festival.id)
    if (n > 0) throw new Error(`This festival has ${n} pick${n === 1 ? '' : 's'}, so it cannot be deleted.`)
    const days = must(await supabase.from('festival_days').select('id').eq('festival_id', festival.id))
    if (days.length) {
      const un = await supabase.from('race_weeks').update({ festival_day_id: null }).in('festival_day_id', days.map(d => d.id))
      if (un.error) throw new Error(`Could not unlink the Saturday League week: ${un.error.message}`)
    }
    oneRow(await supabase.from('festivals').delete().eq('id', festival.id).select('id'), 'Could not delete the festival')
    await removePhotoFile(festival.banner_url)
    return { ok: true }
  } catch (err) { return fail(err) }
}

// ═══ Festival photo ════════════════════════════════════════════════════

// The storage path of one of our photos from its public URL, or null for a photo that lives somewhere else.
export function photoPath(url) {
  const marker = `/${BUCKET}/`
  const i = String(url || '').indexOf(marker)
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length).split('?')[0])
}

async function removePhotoFile(url) {
  const path = photoPath(url)
  if (!path) return
  try { await supabase.storage.from(BUCKET).remove([path]) } catch { /* an old file left behind is harmless */ }
}

// Shrinks a picture to a JPEG no wider than 1600px, so a phone photo of several MB becomes a few hundred KB.
export async function prepareImage(file, maxWidth = 1600) {
  if (!file) throw new Error('Choose a photo first')
  if (!PHOTO_TYPES.includes(file.type) && !/^image\//.test(file.type)) throw new Error('That is not a picture. Choose a JPEG, PNG or WebP photo.')
  let bitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error('This photo could not be read. Try a JPEG or PNG.') }
  const { width, height } = fitWidth(bitmap.width, bitmap.height, maxWidth)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('This photo could not be prepared. Try another.')
  return blob
}

// Uploads the photo to the festival-photos bucket and saves its public URL in festivals.banner_url (the column the app
// already reads). The previous photo file is removed afterwards.
export async function uploadFestivalPhoto(festival, file) {
  let path = null
  try {
    const blob = await prepareImage(file)
    path = `${festival.id}/${Date.now()}.jpg`
    const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
    if (up.error) throw new Error(`Upload failed: ${up.error.message}. Check the festival-photos storage migration has been run.`)
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    const res = await supabase.from('festivals').update({ banner_url: url }).eq('id', festival.id).select('id')
    if (res.error || (res.data || []).length !== 1) {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
      throw new Error(res.error ? `The photo uploaded but could not be saved: ${res.error.message}` : 'The photo uploaded but could not be saved (0 rows changed). Check you are signed in as an admin.')
    }
    await removePhotoFile(festival.banner_url)
    return { ok: true, url }
  } catch (err) { return fail(err) }
}
