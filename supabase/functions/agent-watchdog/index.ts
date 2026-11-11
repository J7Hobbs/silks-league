// Supabase Edge Function: agent-watchdog
//
// Scheduled with pg_cron every 10 minutes (see supabase/agent_watchdog_cron.sql). It does not depend on the Claude scheduled
// tasks: if the race-day agent stops, this is what notices. Each run looks at today's and tomorrow's race days and, between
// 07:00 and 21:00 UK only, pushes the admins chosen for agent alerts (Admin > Today > Agent alerts) when:
//
//   - a race day has no racecard (from 16:00 the day before) and none is waiting for review
//   - no morning check has come in by an hour before the picks lock
//   - a race went off 30+ minutes ago with no result and nothing waiting for approval
//   - a results draft has waited 20+ minutes for an admin to approve it
//
// Each alert is sent once (agent_watchdog_log) and written to Agent activity. All the rules are in ../_shared/agentWatchdog.js.
// Nothing here changes a race, result, pick or score.
//
// SECURITY: deploy with JWT verification ON (the default). It also checks that the caller sent the project's service-role key,
// exactly like picks-deadline-reminder, so nobody else can run it.
//
// POST body (optional): { "dry_run": true } returns what it WOULD send, without recording or pushing anything.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { setClient } from '../_shared/db.js'
import { logAgent } from '../_shared/agentData.js'
import { withDirectPush } from '../_shared/sendPush.js'
import { runWatchdog } from '../_shared/agentWatchdog.js'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

// Same direct-to-OneSignal route as agent-api and picks-deadline-reminder. A push that fails is written to agent_log.
setClient(withDirectPush(
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  {
    restApiKey: Deno.env.get('ONESIGNAL_REST_API_KEY') ?? '',
    onFail: ({ reason, title, userCount, broadcast }) => logAgent({
      action: 'push_failed', ok: false,
      summary: `Push failed: ${reason}${title ? ` (${title})` : ''}`,
      detail: { title, recipients: broadcast ? 'everyone' : userCount },
    }),
  },
))

Deno.serve(async req => {
  // Only the scheduler (which sends the service-role key) may run this.
  if (req.headers.get('Authorization') !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) return json({ error: 'Unauthorized' }, 401)

  let dryRun = false
  try { dryRun = (await req.json())?.dry_run === true } catch { /* no body */ }

  try {
    const out = await runWatchdog({ dryRun })
    console.log('[agent-watchdog] Run complete', JSON.stringify(out))
    return json(out, out.errors.length && !out.sent.length ? 500 : 200)
  } catch (e) {
    console.error('[agent-watchdog] failed:', e)
    return json({ error: String(e) }, 500)
  }
})
