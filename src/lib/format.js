// Small formatting helpers for the Home page. All pure, so they are easy to test.

// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd"
export function ordinal(n) {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`
}

// Local calendar date as YYYY-MM-DD (matches the date strings stored in Supabase).
export function localDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Whole days from date string a to date string b (b - a), both YYYY-MM-DD.
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
}

export function greetingFor(hour) {
  if (hour < 12) return 'Morning'
  if (hour < 17) return 'Afternoon'
  return 'Evening'
}

// Live countdown for a "Closes in" tile: "3d 4h", "2h 14m", "14m 05s", or "Closed".
export function formatCountdown(ms) {
  if (ms <= 0) return 'Closed'
  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d >= 1) return `${d}d ${h}h`
  if (h >= 1) return `${h}h ${m}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

// "Tomorrow", "5 days", "3 weeks", "4 months" for a number of days from today.
export function relativeUntil(days) {
  if (days <= 1) return 'Tomorrow'
  if (days < 14) return `${days} days`
  if (days < 56) return `${Math.round(days / 7)} weeks`
  const months = Math.max(2, Math.round(days / 30.4))
  return `${months} months`
}

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthShort(dateStr) { return MONTHS_SHORT[new Date(dateStr + 'T00:00:00').getMonth()] }
export function monthLong(dateStr) { return MONTHS_LONG[new Date(dateStr + 'T00:00:00').getMonth()] }

// "4–5" within a month, "30–2" across a month boundary, "4" for a single day.
export function dayRange(start, end) {
  const s = new Date(start + 'T00:00:00').getDate()
  const e = new Date((end || start) + 'T00:00:00').getDate()
  return s === e || !end ? String(s) : `${s}–${e}`
}

// Number of days a festival runs, inclusive.
export function festivalLength(start, end) {
  return end ? daysBetween(start, end) + 1 : 1
}

// Stored deadline as epoch ms; falls back to noon on the day if none is stored.
export function deadlineMs(iso, fallbackDate) {
  return new Date(iso || `${fallbackDate}T12:00:00`).getTime()
}

// ── Picks lock time, shown in UK time whatever the device's timezone ──
const UK = 'Europe/London'
const UK_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const UK_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: UK, year: 'numeric', month: '2-digit', day: '2-digit' })

// "Locks 12:00 today", "Locks Sat 12:00", or "Locks Sat 8 Aug 12:00" if more than a week away.
export function lockLabel(iso, nowMs) {
  if (!iso) return null
  const at = new Date(iso).getTime()
  const p = Object.fromEntries(UK_PARTS.formatToParts(at).map(x => [x.type, x.value]))
  const time = `${p.hour}:${p.minute}`
  const ahead = daysBetween(UK_DATE.format(nowMs), UK_DATE.format(at))
  if (ahead <= 0) return `Locks ${time} today`
  if (ahead < 7) return `Locks ${p.weekday} ${time}`
  return `Locks ${p.weekday} ${p.day} ${p.month} ${time}`
}

// ── UK clock helpers for the Saturday League card ──
const UK_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: UK, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const UK_FULL = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

// Today's date in the UK, YYYY-MM-DD.
export function ukDateStr(ms) { return UK_DATE.format(ms) }

// "12:00" for a moment in time, in UK time.
export function ukClock(ms) { return UK_CLOCK.format(ms) }

// "14:10" -> "14:10"; anything that isn't an HH:MM time -> ''.
export function clockText(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '')
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

function ukOffsetMs(ms) {
  const p = Object.fromEntries(UK_FULL.formatToParts(ms).map(x => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000
}

// The moment a UK wall-clock time ("2026-11-07", "14:10") happens, as epoch ms. null if the time is missing.
export function ukWallToMs(dateStr, hhmm) {
  const t = clockText(hhmm)
  if (!dateStr || !t) return null
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  return wall - ukOffsetMs(wall - ukOffsetMs(wall))
}

// Countdown on the Saturday card: "2d 21h" from a day out, then hh:mm:ss.
export function formatLockCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  if (d >= 1) return `${d}d ${h}h`
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

// ── Date words for the "race day announced" state ──
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// "2026-11-07" -> "Saturday"
export function weekdayLong(dateStr) { return WEEKDAYS_LONG[new Date(dateStr + 'T12:00:00Z').getUTCDay()] }

// "2026-11-07" -> "Nov"
export function monthAbbr(dateStr) { return monthLong(dateStr).slice(0, 3) }

// The first Wednesday after a date (YYYY-MM-DD), as YYYY-MM-DD.
export function wednesdayAfter(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() !== 3)
  return d.toISOString().slice(0, 10)
}
