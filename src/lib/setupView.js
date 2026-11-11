// The Setup tab: seasons and festivals. Pure functions over rows already read from Supabase.
import { ukDateStr } from './format.js'
import { parsePhotoPosition } from './photoPosition.js'

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = n => String(n).padStart(2, '0')
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'))

// The first and last day of a month (monthIndex 0-11) as YYYY-MM-DD.
export function monthDates(year, monthIndex) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return { startDate: `${year}-${pad(monthIndex + 1)}-01`, endDate: `${year}-${pad(monthIndex + 1)}-${pad(last)}` }
}

// The next calendar month's season, as the "+ New month" form's starting values: the month after the latest season,
// but never a month that has already started. { name, year, startDate, endDate }.
export function nextMonthSeason(seasons, today = ukDateStr(Date.now())) {
  const starts = (seasons || []).map(s => s.start_date).filter(Boolean).sort()
  const latest = starts.length ? starts[starts.length - 1] : null
  const after = d => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1; return m === 11 ? [y + 1, 0] : [y, m + 1] }
  let [year, month] = after(today)
  if (latest) {
    const [ly, lm] = after(latest)
    if (ly > year || (ly === year && lm > month)) { year = ly; month = lm }
  }
  return { name: `${MONTHS[month]} ${year}`, year, ...monthDates(year, month) }
}

// Active (switched on), Done (marked complete, or its dates are over), Upcoming (starts later), otherwise Not active.
export function seasonStatus(s, today = ukDateStr(Date.now())) {
  if (s.is_active) return { key: 'active', tone: 'ok', label: 'Active' }
  if (s.status === 'completed' || (s.end_date && s.end_date < today)) return { key: 'done', tone: 'off', label: 'Done' }
  if (s.start_date && s.start_date > today) return { key: 'upcoming', tone: 'gold', label: 'Upcoming' }
  return { key: 'inactive', tone: 'warn', label: 'Not active' }
}

// Problems with a season form, as a list of sentences (empty when it can be saved).
export function seasonProblems(f, others = [], selfId = null) {
  const out = []
  if (!String(f.name || '').trim()) out.push('Give the season a name')
  if (!isDate(f.startDate)) out.push('Choose a start date')
  if (!isDate(f.endDate)) out.push('Choose an end date')
  if (isDate(f.startDate) && isDate(f.endDate) && f.endDate < f.startDate) out.push('The end date is before the start date')
  if (isDate(f.startDate) && others.some(s => s.id !== selfId && s.start_date === f.startDate)) out.push('Another season already starts on that date')
  return out
}

// Active (switched on in the app), Done (not on, and over), otherwise Upcoming (not on, not over).
export function festivalStatus(f, today = ukDateStr(Date.now())) {
  if (f.is_active) return { key: 'active', tone: 'ok', label: 'Active' }
  if ((f.end_date || f.start_date) < today) return { key: 'done', tone: 'off', label: 'Done' }
  return { key: 'upcoming', tone: 'gold', label: 'Upcoming' }
}

export function festivalProblems(f) {
  const out = []
  if (!String(f.name || '').trim()) out.push('Give the festival a name')
  if (!isDate(f.startDate)) out.push('Choose a start date')
  if (!isDate(f.endDate)) out.push('Choose an end date')
  if (isDate(f.startDate) && isDate(f.endDate) && f.endDate < f.startDate) out.push('The end date is before the start date')
  if (isDate(f.startDate) && isDate(f.endDate) && f.endDate >= f.startDate) {
    const n = (Date.parse(f.endDate + 'T12:00:00Z') - Date.parse(f.startDate + 'T12:00:00Z')) / 86400000 + 1
    if (n > 14) out.push(`That is ${n} days. Check the dates`)
  }
  return out
}

const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const daysBetweenDates = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
export const dayName = date => DAY_NAMES[new Date(date + 'T12:00:00Z').getUTCDay()]

// One festival day row, the way the classic Admin makes them (same label and 11:30 picks deadline).
export function festivalDayRow(festivalId, dayNumber, date) {
  return { festival_id: festivalId, day_number: dayNumber, race_date: date, label: `Day ${dayNumber} — ${dayName(date)}`, picks_deadline: `${date}T11:30:00+00:00` }
}

// The day label the classic Admin writes. A label somebody typed in by hand does not match, and is left alone.
const AUTO_LABEL = /^Day \d+ — /
const labelFor = (day, number, date) => (AUTO_LABEL.test(day.label || '') || !day.label ? `Day ${number} — ${dayName(date)}` : day.label)

// What "Edit details" changes. Every existing day moves by however far the start date moved (so a festival with a
// day taken out keeps its gap), then days are added for any dates after the last one, up to the new end date. Days
// past a shortened end date are kept.
//   festival { start_date }   days [{ id, day_number, race_date, label }]   f { startDate, endDate }
// Returns { moves: [{ id, day_number, race_date, label, picks_deadline }], adds: [day rows] }.
export function planFestivalEdit(festival, days, f) {
  const shift = festival.start_date && f.startDate ? daysBetweenDates(festival.start_date, f.startDate) : 0
  const moves = shift === 0 ? [] : days.map(d => {
    const date = addDays(d.race_date, shift)
    return { id: d.id, day_number: d.day_number, race_date: date, label: labelFor(d, d.day_number, date), picks_deadline: `${date}T11:30:00+00:00` }
  })
  const dates = days.map(d => addDays(d.race_date, shift)).sort()
  let number = Math.max(0, ...days.map(d => d.day_number))
  const adds = []
  for (let date = dates.length ? addDays(dates[dates.length - 1], 1) : f.startDate; date <= f.endDate && adds.length < 31; date = addDays(date, 1)) {
    number += 1
    adds.push(festivalDayRow(festival.id, number, date))
  }
  return { moves, adds }
}

// After a day is taken out, the days after it close the gap: Day 4 becomes Day 3. Returns the days that change.
export function renumberAfterRemove(days, removed) {
  return days
    .filter(d => d.id !== removed.id && d.day_number > removed.day_number)
    .sort((a, b) => a.day_number - b.day_number)
    .map(d => ({ id: d.id, day_number: d.day_number - 1, label: labelFor(d, d.day_number - 1, d.race_date) }))
}

// The festival's own first and last date, from the days that are left.
export function festivalSpan(days) {
  const dates = days.map(d => d.race_date).filter(Boolean).sort()
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null
}

// A day for every date from start to end: Day 1 is the start date.
export function festivalDayRows(festivalId, start, end) {
  const rows = []
  for (let d = start, n = 1; d <= end && n <= 31; d = addDays(d, 1), n++) rows.push(festivalDayRow(festivalId, n, d))
  return rows
}

// The day after the last one, as the "+ Add day" form's starting date.
export function nextDayDate(days, festival) {
  const last = [...(days || [])].map(d => d.race_date).sort().pop() || festival?.end_date || festival?.start_date
  return last ? addDays(last, 1) : ''
}

// The status of one festival day on the festival page.
//   raceCount  races loaded on the day      linkedWeek  { week_number } of the Saturday League week linked to it, or null
export function setupDayStatus({ raceCount, linkedWeek }) {
  if (linkedWeek) return { key: 'linked', tone: 'gold', label: `Linked · Week ${linkedWeek.week_number}` }
  if (raceCount > 0) return { key: 'ready', tone: 'ok', label: 'Ready' }
  return { key: 'load', tone: 'warn', label: 'Load races' }
}

// The size to shrink a photo to: no wider than maxWidth, same shape. Never enlarges.
export function fitWidth(width, height, maxWidth = 1600) {
  if (!width || !height) return { width: 0, height: 0 }
  if (width <= maxWidth) return { width, height }
  return { width: maxWidth, height: Math.round(height * maxWidth / width) }
}

// ── Banner position ──────────────────────────────────────────────────────
// festivals.banner_position is the CSS object-position the app puts on the photo. Admin writes "center <n>%", where n is
// how far down the photo the visible strip sits: 0 shows the top, 100 the bottom. The app uses 35 when nothing is saved.
export const DEFAULT_BANNER_Y = 35
export const BANNER_PRESETS = [{ label: 'Top', y: 0 }, { label: 'Middle', y: 50 }, { label: 'Bottom', y: 100 }]
const clamp100 = n => Math.max(0, Math.min(100, Math.round(Number(n))))
export const bannerPositionValue = y => `center ${clamp100(y)}%`

// { y, saved } from the stored text. `saved` is false when nothing is stored (the app's own default applies), and
// `odd` is true for text Admin did not write and cannot show on the slider.
export function parseBannerPosition(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return { y: DEFAULT_BANNER_Y, saved: false, odd: false }
  const m = /^center\s+(\d+(?:\.\d+)?)%$/.exec(text)
  if (m) return { y: clamp100(m[1]), saved: true, odd: false }
  const words = { top: 0, 'center top': 0, 'center 0%': 0, center: 50, 'center center': 50, bottom: 100, 'center bottom': 100 }
  if (text in words) return { y: words[text], saved: true, odd: false }
  // Other spellings the browser reads the same way ("50% 20%", "center 35%" with odd spacing): if the photo is centred across,
  // only the height matters. A value that also moves it sideways ("35% center") can't be shown on the slider.
  const p = parsePhotoPosition(text)
  if (p && p.x === 50) return { y: clamp100(p.y), saved: true, odd: false }
  return { y: DEFAULT_BANNER_Y, saved: true, odd: true }
}

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
