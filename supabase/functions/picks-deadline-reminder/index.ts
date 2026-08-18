// Supabase Edge Function: picks-deadline-reminder
//
// Scheduled via pg_cron every 15-30 minutes (see deploy notes). Each run
// checks for any race_week or festival_day whose picks_deadline is ~2
// hours away, and notifies every user who hasn't completed all their
// picks for that race day — reusing send-notification rather than
// talking to OneSignal directly. A row in reminder_log (see
// supabase/reminder_log_migration.sql) prevents re-notifying on the next
// scheduled run once a deadline's window has been handled.

import { createClient } from 'npm:@supabase/supabase-js@2'

const APP_ORIGIN = 'https://silks-league.vercel.app'
const WINDOW_MIN_MS = (1 * 60 + 45) * 60 * 1000 // 1h45m from now
const WINDOW_MAX_MS = (2 * 60 + 15) * 60 * 1000 // 2h15m from now

// deno-lint-ignore no-explicit-any
type Admin = any

async function callSendNotification(supabaseUrl: string, serviceKey: string, payload: Record<string, unknown>) {
  const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`send-notification failed (${res.status}): ${JSON.stringify(data)}`)
  return data
}

// Handles one race day (a race_week or a festival_day) — finds incomplete
// users, sends grouped reminders, and logs it as handled either way so
// this deadline's window is never re-processed.
async function handleRaceDay(opts: {
  admin: Admin
  supabaseUrl: string
  serviceKey: string
  racesTable: string   // 'races' | 'festival_races'
  picksTable: string   // 'picks' | 'festival_picks'
  raceFk: string       // 'race_id' | 'festival_race_id'
  parentFk: string     // 'race_week_id' | 'festival_day_id'
  parentId: string
  logColumn: 'race_week_id' | 'festival_day_id'
  url: string
  contextLabel: string
}): Promise<number> {
  const { admin, supabaseUrl, serviceKey, racesTable, picksTable, raceFk, parentFk, parentId, logColumn, url, contextLabel } = opts

  const { data: races } = await admin.from(racesTable).select('id').eq(parentFk, parentId)
  const raceIds = (races || []).map((r: { id: string }) => r.id)
  const total = raceIds.length

  let recipientCount = 0

  if (total > 0) {
    const { data: profiles } = await admin.from('profiles').select('id')
    const { data: picks } = await admin.from(picksTable).select(`user_id, ${raceFk}`).in(raceFk, raceIds)

    const pickedByUser = new Map<string, Set<string>>()
    for (const p of (picks || []) as Record<string, unknown>[]) {
      const uid = p.user_id as string
      const rid = p[raceFk] as string
      if (!pickedByUser.has(uid)) pickedByUser.set(uid, new Set())
      pickedByUser.get(uid)!.add(rid)
    }

    // Group incomplete users by their picked count, so everyone sharing the
    // same "X of Y" message goes out in one send-notification call.
    const groups = new Map<number, string[]>()
    for (const profile of (profiles || []) as { id: string }[]) {
      const pickedCount = pickedByUser.get(profile.id)?.size ?? 0
      if (pickedCount < total) {
        if (!groups.has(pickedCount)) groups.set(pickedCount, [])
        groups.get(pickedCount)!.push(profile.id)
      }
    }

    for (const [pickedCount, userIds] of groups) {
      const body = pickedCount === 0
        ? `Picks close in 2 hours for ${contextLabel} — you haven't picked yet!`
        : `Picks close in 2 hours for ${contextLabel} — you've picked ${pickedCount} of ${total} races.`
      await callSendNotification(supabaseUrl, serviceKey, {
        userIds, title: 'Picks closing soon', body, url,
      })
      recipientCount += userIds.length
    }
  }

  const { error: logErr } = await admin
    .from('reminder_log')
    .insert({ [logColumn]: parentId, recipient_count: recipientCount })
  if (logErr) throw new Error(`Failed to log reminder for ${parentId}: ${logErr.message}`)

  return recipientCount
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const now = Date.now()
  const windowStart = new Date(now + WINDOW_MIN_MS).toISOString()
  const windowEnd = new Date(now + WINDOW_MAX_MS).toISOString()

  const summary = { raceWeeksHandled: 0, festivalDaysHandled: 0, totalRecipients: 0, errors: [] as string[] }

  const { data: dueWeeks, error: weeksErr } = await admin
    .from('race_weeks')
    .select('id, week_number, picks_deadline')
    .gte('picks_deadline', windowStart)
    .lte('picks_deadline', windowEnd)
  if (weeksErr) summary.errors.push(`race_weeks query: ${weeksErr.message}`)

  for (const week of (dueWeeks || []) as { id: string; week_number: number }[]) {
    const { data: already } = await admin.from('reminder_log').select('id').eq('race_week_id', week.id).maybeSingle()
    if (already) continue
    try {
      const count = await handleRaceDay({
        admin, supabaseUrl, serviceKey,
        racesTable: 'races', picksTable: 'picks', raceFk: 'race_id', parentFk: 'race_week_id',
        parentId: week.id, logColumn: 'race_week_id',
        url: `${APP_ORIGIN}/picks`,
        contextLabel: `Week ${week.week_number}`,
      })
      summary.raceWeeksHandled++
      summary.totalRecipients += count
    } catch (e) {
      console.error('[picks-deadline-reminder] race_week failed:', week.id, e)
      summary.errors.push(`race_week ${week.id}: ${e}`)
    }
  }

  const { data: dueDays, error: daysErr } = await admin
    .from('festival_days')
    .select('id, label, picks_deadline')
    .gte('picks_deadline', windowStart)
    .lte('picks_deadline', windowEnd)
  if (daysErr) summary.errors.push(`festival_days query: ${daysErr.message}`)

  for (const day of (dueDays || []) as { id: string; label: string }[]) {
    const { data: already } = await admin.from('reminder_log').select('id').eq('festival_day_id', day.id).maybeSingle()
    if (already) continue
    try {
      const count = await handleRaceDay({
        admin, supabaseUrl, serviceKey,
        racesTable: 'festival_races', picksTable: 'festival_picks', raceFk: 'festival_race_id', parentFk: 'festival_day_id',
        parentId: day.id, logColumn: 'festival_day_id',
        url: `${APP_ORIGIN}/festival-picks`,
        contextLabel: day.label,
      })
      summary.festivalDaysHandled++
      summary.totalRecipients += count
    } catch (e) {
      console.error('[picks-deadline-reminder] festival_day failed:', day.id, e)
      summary.errors.push(`festival_day ${day.id}: ${e}`)
    }
  }

  console.log('[picks-deadline-reminder] Run complete', summary)
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } })
})
