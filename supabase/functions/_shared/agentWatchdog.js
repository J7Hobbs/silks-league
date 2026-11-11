// The agent watchdog: if the race-day agent goes quiet, tell the admins. Run every 10 minutes by the agent-watchdog Edge Function.
// It only READS the calendar and the agent's drafts, and it only ever pushes to the admins chosen for agent alerts
// (notifyAdmins). It never changes a race, a result, a pick or a score.
//
// Four alerts (all UK time, and nothing at all before 07:00 or from 21:00, nor on a day with no racing):
//   racecard   from 16:00 the day before a race day, and on the day, when it has no races loaded and no racecard draft waiting
//   morning    a race day whose picks lock within the hour (or has locked) and no morning check has come in today,
//              until the first race goes off
//   result     a race went off 30+ minutes ago, is not abandoned, has no result and no results draft waiting on an admin
//   approval   a results draft has been waiting for an admin to approve for 20+ minutes
// Each alert is sent ONCE: its key is claimed in agent_watchdog_log before the push, and released again if the push fails so
// the next run retries. Several races in one run go in one push, each with its own key.
import { supabase } from './db.js'
import { loadCalendar, notifyAdmins, logAgent } from './agentData.js'
import { ukDateStr, ukClock, ukWallToMs, lockMs, weekdayLong, monthAbbr } from './format.js'

const MIN = 60000
export const QUIET_BEFORE_HOUR = 7       // nothing before 07:00 UK ...
export const QUIET_FROM_HOUR = 21        // ... or from 21:00
export const RACECARD_FROM_HOUR = 16     // the day before a race day, from 16:00
export const MORNING_CHECK_BEFORE_LOCK_MIN = 60
export const RESULT_OVERDUE_MIN = 30
export const APPROVAL_WAIT_MIN = 20

const addDays = (dateStr, n) => new Date(new Date(`${dateStr}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10)
const ukHour = ms => Number(ukClock(ms).slice(0, 2))
const list = nums => (nums.length <= 1 ? `${nums[0]}` : `${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`)
const dateLabel = d => `${weekdayLong(d)} ${Number(d.slice(8))} ${monthAbbr(d)}`

export const isQuietHours = nowMs => { const h = ukHour(nowMs); return h < QUIET_BEFORE_HOUR || h >= QUIET_FROM_HOUR }

// A results draft covers a race when it is waiting on an admin for that race (or for a result it could not place).
const waitingResults = draft => (draft.payload?.outcomes || []).filter(o => o.type === 'result' && o.state === 'needs_review')
const covers = (draft, race) => waitingResults(draft).some(o => o.race_number == null || Number(o.race_number) === Number(race.race_number))

// One alert for a set of races. `items` are [{ key, n, time }]; `compose(items)` words it, and the runner calls it again with
// only the items it has not told the admins about yet.
const groupAlert = (type, items, compose) => ({ type, keys: items.map(i => i.key), text: compose(items), compose: fresh => compose(items.filter(i => fresh.includes(i.key))) })
const overdueText = items => (items.length === 1
  ? `Race ${items[0].n} (${items[0].time}) has no result 30 minutes after the off. Enter it in Admin.`
  : `Races ${list(items.map(i => i.n))} have no result 30 minutes after the off. Enter them in Admin.`)
const approvalText = items => {
  const nums = items.map(i => i.n).filter(n => n != null)
  if (items.length === 1) return nums.length ? `Race ${nums[0]} result still waiting for your approval.` : 'A result is still waiting for your approval.'
  return nums.length === items.length ? `Results for races ${list(nums)} are still waiting for your approval.` : `${items.length} results are still waiting for your approval.`
}

// What needs saying right now. Pure: no database, no clock beyond `nowMs`.
//   days                 the calendar's race days (loadCalendar().days), at least today and tomorrow
//   saturdaysWithoutWeek loadCalendar().saturdays_without_week
//   seasons              active seasons [{ start_date, end_date }]: a Saturday inside one is a race day even before its week exists
//   drafts               agent_drafts rows for today and tomorrow: { id, kind, status, race_date, created_at, payload }
// Returns [{ type, keys: [...], text }] in the order they should be sent.
export function planWatchdog({ nowMs, days = [], saturdaysWithoutWeek = [], seasons = [], drafts = [] }) {
  if (isQuietHours(nowMs)) return []
  const today = ukDateStr(nowMs)
  const tomorrow = addDays(today, 1)
  const alerts = []

  // 1. Racecard missing.
  const dates = [today, ...(ukHour(nowMs) >= RACECARD_FROM_HOUR ? [tomorrow] : [])]
  for (const date of dates) {
    const onDate = days.filter(d => d.date === date)
    if (onDate.some(d => d.race_count > 0)) continue
    const inSeason = (saturdaysWithoutWeek || []).includes(date) && seasons.some(s => s.start_date <= date && date <= s.end_date)
    if (!onDate.length && !inSeason) continue                           // not a race day: stay quiet
    if (drafts.some(d => d.kind === 'racecard' && d.race_date === date && ['pending', 'approved'].includes(d.status))) continue
    const label = onDate[0]?.title || dateLabel(date)
    alerts.push({ type: 'racecard', keys: [`racecard:${date}`], text: `No racecard yet for ${label}. The agent may have failed. Add races in Race days.` })
  }

  const racingToday = days.filter(d => d.date === today && d.races.some(r => !r.is_abandoned))

  // 2. Morning check missing.
  const midnight = ukWallToMs(today, '00:00')
  for (const day of racingToday) {
    const lock = lockMs(day.lock_time, day.date)
    const firstOff = Math.min(...day.races.filter(r => !r.is_abandoned).map(r => ukWallToMs(day.date, r.race_time)).filter(t => t != null), Infinity)
    if (nowMs < lock - MORNING_CHECK_BEFORE_LOCK_MIN * MIN || nowMs >= firstOff) continue
    const came = drafts.some(d => d.kind === 'morning_check' && d.race_date === day.date && new Date(d.created_at).getTime() >= midnight)
    if (!came) alerts.push({ type: 'morning', keys: [`morning:${day.key}`], text: `Morning check hasn't come in for ${day.title}. Check non-runners manually.` })
  }

  // 3. Result overdue (nothing waiting on an admin for it either), and 4. a result waiting on an admin.
  const waitingDrafts = drafts.filter(d => d.kind === 'results' && d.status === 'pending' && d.race_date === today)
  const overdue = []
  for (const day of racingToday) {
    for (const race of day.races) {
      if (race.is_abandoned || race.has_result) continue
      const off = ukWallToMs(day.date, race.race_time)
      if (off == null || nowMs < off + RESULT_OVERDUE_MIN * MIN) continue
      if (waitingDrafts.some(d => covers(d, race))) continue
      overdue.push({ key: `result:${day.key}:r${race.race_number}`, n: race.race_number, time: race.race_time })
    }
  }
  if (overdue.length) alerts.push(groupAlert('result', overdue, overdueText))

  const waiting = []
  for (const d of waitingDrafts) {
    if (nowMs - new Date(d.created_at).getTime() < APPROVAL_WAIT_MIN * MIN) continue
    for (const o of waitingResults(d)) waiting.push({ key: `approval:${d.id}:${o.race_number ?? o.ref}`, n: o.race_number })
  }
  if (waiting.length) alerts.push(groupAlert('approval', waiting, approvalText))
  return alerts
}

// ═══ Reading the database ═══════════════════════════════════════════════════════════════════════════════════

const must = ({ data, error }) => { if (error) throw error; return data || [] }

async function gather(nowMs) {
  const today = ukDateStr(nowMs)
  const cal = await loadCalendar({ days: 2, includeRunners: false, nowMs })
  const seasons = await supabase.from('seasons').select('start_date, end_date').eq('is_active', true).then(r => (r.error ? [] : r.data || []))
  const drafts = must(await supabase.from('agent_drafts').select('id, kind, status, race_date, created_at, payload').in('race_date', [today, addDays(today, 1)]))
  return { days: cal.days, saturdaysWithoutWeek: cal.saturdays_without_week, seasons, drafts }
}

// ═══ One run ═════════════════════════════════════════════════════════════════════════════════════════════════

// Claim each key; the ones nobody has claimed yet are returned. A key that cannot be claimed because the table is missing is
// an error (never push without the "already sent" record, or every run would repeat the alert).
async function claim(keys, summary) {
  const fresh = []
  for (const key of keys) {
    const { error } = await supabase.from('agent_watchdog_log').insert({ alert_key: key, summary })
    if (!error) fresh.push(key)
    else if (error.code !== '23505') throw new Error(`could not record ${key}: ${error.message}`)
  }
  return fresh
}
async function release(keys) {
  try {
    const { error } = await supabase.from('agent_watchdog_log').delete().in('alert_key', keys)
    if (error) throw error
  } catch (err) { console.error('[watchdog] could not release the claim:', err) }
}

// { ran, quiet?, planned, sent, errors }. `dryRun` plans only: nothing is recorded or pushed.
export async function runWatchdog({ nowMs = Date.now(), dryRun = false } = {}) {
  const out = { ran: true, now: new Date(nowMs).toISOString(), quiet: isQuietHours(nowMs), planned: [], sent: [], errors: [] }
  if (out.quiet) return out
  let plan
  try { plan = planWatchdog({ nowMs, ...(await gather(nowMs)) }) } catch (err) {
    out.errors.push(`could not read the calendar: ${err.message || err}`)
    return out
  }
  out.planned = plan.map(a => ({ type: a.type, text: a.text }))
  if (dryRun) return out

  for (const alert of plan) {
    let fresh = []
    try {
      fresh = await claim(alert.keys, alert.text)
      if (!fresh.length) continue                                           // already told
      const text = alert.compose ? alert.compose(fresh) : alert.text
      const res = await notifyAdmins(text)
      if (!res.ok) throw new Error(res.error || 'the push failed')
      await logAgent({ action: 'watchdog_alert', ok: false, summary: text, detail: { type: alert.type, keys: fresh, sent_to: res.sent } })
      out.sent.push({ type: alert.type, text, keys: fresh })
    } catch (err) {
      if (fresh.length) await release(fresh)                  // so the next run tries again
      out.errors.push(`${alert.type}: ${err.message || err}`)
    }
  }
  return out
}
