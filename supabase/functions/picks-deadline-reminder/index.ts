// Supabase Edge Function: picks-deadline-reminder
//
// Scheduled with pg_cron every 5 minutes (see supabase/picks_deadline_reminder_cron.sql). Each run looks at every
// race_week and festival_day whose picks lock soon and sends (straight to OneSignal, see ../_shared/sendPush.js):
//
//   two_hour   (2h to 1h30 before the lock)   every player who has not picked every race:
//              "Picks close at <time>. You've still got <n> races to fill[, and no banker set]"
//   last_call  (30 to 15 minutes before)       only players with NO picks for that race day:
//              "Picks lock in 30 minutes for <race day>"
//
// Each notice goes once per race day: a row in reminder_log (race_week_id / festival_day_id + kind) is claimed BEFORE
// sending, so two overlapping runs can never both send, and it is removed again if the send fails so the next run retries.
// The wording is in ../_shared/notifyCopy.js and the who/when rules in ../_shared/reminderPlan.js.
//
// SECURITY: deploy this with JWT verification ON (the default) and it also checks, here, that the caller sent the x-cron-secret
// header matching the CRON_SECRET secret (or the runtime's service-role key as Authorization). Nobody else can trigger it.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { APP_ORIGIN, picksClosing, lastCall, describeDay, lockLabel } from '../_shared/notifyCopy.js'
import { sendPush } from '../_shared/sendPush.js'
import { dueKinds, planClosing, planLastCall, bankersApply } from '../_shared/reminderPlan.js'
import { isCronAuthorised } from '../_shared/cronAuth.js'

// deno-lint-ignore no-explicit-any
type Admin = any

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

// Straight to OneSignal (../_shared/sendPush.js), not through send-notification: one fewer function in the chain, and no
// dependence on that function accepting this one's service-role key. Throws with the reason if the push fails, so the caller
// releases its reminder_log claim and the next run retries.
// deno-lint-ignore no-unused-vars
async function callSendNotification(_supabaseUrl: string, _serviceKey: string, payload: Record<string, unknown>) {
  return await sendPush(payload, { restApiKey: Deno.env.get('ONESIGNAL_REST_API_KEY') ?? '' })
}

// PostgREST returns at most 1000 rows a call, so page through a big read.
// deno-lint-ignore no-explicit-any
async function allRows(build: (from: number, to: number) => any): Promise<any[]> {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if ((data || []).length < 1000) return out
  }
}

interface DayInfo {
  kind: 'week' | 'festival'
  id: string
  date: string
  deadline: string
  festivalName?: string
  dayNumber?: number
}

// One race day, one notice kind. Returns how many players were messaged (0 when the notice was skipped).
async function handleDay(admin: Admin, supabaseUrl: string, serviceKey: string, day: DayInfo, kind: 'two_hour' | 'last_call', nowMs: number): Promise<number> {
  const isWeek = day.kind === 'week'
  const c = isWeek
    ? { races: 'races', picks: 'picks', raceFk: 'race_id', parentFk: 'race_week_id', url: `${APP_ORIGIN}/picks` }
    : { races: 'festival_races', picks: 'festival_picks', raceFk: 'festival_race_id', parentFk: 'festival_day_id', url: `${APP_ORIGIN}/festival-picks` }

  // Already sent?
  const { data: already } = await admin.from('reminder_log').select('id').eq(c.parentFk, day.id).eq('kind', kind).maybeSingle()
  if (already) return 0

  const { data: races, error: rErr } = await admin.from(c.races).select('id').eq(c.parentFk, day.id)
  if (rErr) throw new Error(`races: ${rErr.message}`)
  const raceIds = (races || []).map((r: { id: string }) => r.id)
  if (!raceIds.length) return 0     // nothing loaded yet: no reminder, and no log row, so a late import still gets one

  const playerIds = (await allRows((a, b) => admin.from('profiles').select('id').range(a, b))).map((p: { id: string }) => p.id)
  const picks = await allRows((a, b) => admin.from(c.picks).select(`user_id, ${c.raceFk}, is_banker`).in(c.raceFk, raceIds).range(a, b))
    .then(rows => rows.map(r => ({ user_id: r.user_id as string, race_id: r[c.raceFk] as string, is_banker: !!r.is_banker })))

  const dayName = describeDay({ kind: day.kind, festivalName: day.festivalName, dayNumber: day.dayNumber }).name
  const messages: { userIds: string[]; title: string; body: string }[] = []
  if (kind === 'two_hour') {
    const lockTime = lockLabel(day.deadline, nowMs)
    for (const g of planClosing({ raceIds, picks, playerIds, bankers: bankersApply(day.date) })) {
      messages.push({ userIds: g.userIds, ...picksClosing({ lockTime, remaining: g.remaining, noBanker: g.noBanker }) })
    }
  } else {
    const userIds = planLastCall({ raceIds, picks, playerIds })
    if (userIds.length) messages.push({ userIds, ...lastCall({ dayName }) })
  }
  const recipients = messages.reduce((n, m) => n + m.userIds.length, 0)

  // Claim the row first. A second run that gets here at the same moment hits the unique index and stops.
  const claim = await admin.from('reminder_log').insert({ [c.parentFk]: day.id, kind, recipient_count: recipients })
  if (claim.error) {
    if (claim.error.code === '23505') return 0
    throw new Error(`Failed to log ${kind} for ${day.id}: ${claim.error.message}`)
  }
  try {
    for (const m of messages) await callSendNotification(supabaseUrl, serviceKey, { ...m, url: c.url })
  } catch (err) {
    await admin.from('reminder_log').delete().eq(c.parentFk, day.id).eq('kind', kind)   // release, so the next run retries
    throw err
  }
  return recipients
}

Deno.serve(async req => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Only the scheduler may run this: x-cron-secret equal to CRON_SECRET (or, as before, the runtime's service-role key).
  if (!isCronAuthorised(req.headers, { cronSecret: Deno.env.get('CRON_SECRET'), serviceKey })) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)
  const now = Date.now()
  // Anything locking in the next 2 hours can have a notice due; dueKinds() decides which.
  const from = new Date(now).toISOString()
  const to = new Date(now + 2 * 60 * 60 * 1000).toISOString()

  const summary = { daysHandled: 0, twoHour: 0, lastCall: 0, totalRecipients: 0, errors: [] as string[] }
  const days: DayInfo[] = []

  const { data: weeks, error: weeksErr } = await admin.from('race_weeks').select('id, saturday_date, picks_deadline').gte('picks_deadline', from).lte('picks_deadline', to)
  if (weeksErr) summary.errors.push(`race_weeks query: ${weeksErr.message}`)
  for (const w of (weeks || []) as { id: string; saturday_date: string; picks_deadline: string }[]) {
    days.push({ kind: 'week', id: w.id, date: w.saturday_date, deadline: w.picks_deadline })
  }

  const { data: fdays, error: daysErr } = await admin.from('festival_days').select('id, day_number, race_date, picks_deadline, festival_id').gte('picks_deadline', from).lte('picks_deadline', to)
  if (daysErr) summary.errors.push(`festival_days query: ${daysErr.message}`)
  const fIds = [...new Set((fdays || []).map((d: { festival_id: string }) => d.festival_id))]
  const { data: fests } = fIds.length ? await admin.from('festivals').select('id, name, display_name').in('id', fIds) : { data: [] }
  const festName = Object.fromEntries((fests || []).map((f: { id: string; name: string; display_name: string | null }) => [f.id, f.display_name || f.name]))
  for (const d of (fdays || []) as { id: string; day_number: number; race_date: string; picks_deadline: string; festival_id: string }[]) {
    days.push({ kind: 'festival', id: d.id, date: d.race_date, deadline: d.picks_deadline, festivalName: festName[d.festival_id], dayNumber: d.day_number })
  }

  for (const day of days) {
    for (const kind of dueKinds(day.deadline, now) as ('two_hour' | 'last_call')[]) {
      try {
        const n = await handleDay(admin, supabaseUrl, serviceKey, day, kind, now)
        if (n > 0) {
          summary.daysHandled++
          summary.totalRecipients += n
          if (kind === 'two_hour') summary.twoHour++; else summary.lastCall++
        }
      } catch (e) {
        console.error(`[picks-deadline-reminder] ${kind} failed:`, day.kind, day.id, e)
        summary.errors.push(`${kind} ${day.kind} ${day.id}: ${e}`)
      }
    }
  }

  console.log('[picks-deadline-reminder] Run complete', summary)
  return json(summary)
})
