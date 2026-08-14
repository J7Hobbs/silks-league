// Supabase Edge Function: send-notification
//
// Shared OneSignal push-sending capability. No trigger or scheduling lives
// here — this is a plain callable function that future notification
// features (deadline reminders, race day alerts, results, group winners)
// all call through, instead of each having their own OneSignal integration.
//
// Request body (JSON):
//   {
//     userIds?:   string[]   — Supabase auth user IDs to target (matched via
//                               OneSignal External ID, set client-side on
//                               opt-in — see src/pages/Account.jsx)
//     broadcast?: boolean    — true to send to all subscribed users instead
//                               of specific userIds
//     title:      string     — notification title
//     body:       string     — notification message
//     url?:       string     — optional deep link opened when tapped
//   }
// Exactly one of `userIds` (non-empty) or `broadcast: true` must be given.
//
// Caller must be an authenticated Supabase user with is_admin = true on
// their profile — this function can message every subscribed user, so it
// isn't left open to any logged-in account.
//
// Secrets required (set via `supabase secrets set`, see deploy notes):
//   ONESIGNAL_REST_API_KEY
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the Supabase Edge Runtime — no need to set those.

import { createClient } from 'npm:@supabase/supabase-js@2'

const ONESIGNAL_APP_ID = 'eedcef3b-5612-48ad-ac57-5e1e9f19abbc' // public, non-secret — matches client-side OneSignalInit.jsx
const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async req => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const restApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY')
  if (!restApiKey) {
    console.error('[send-notification] ONESIGNAL_REST_API_KEY is not set')
    return json({ error: 'Server misconfigured: missing OneSignal REST API key' }, 500)
  }

  // ── Authenticate the caller and require admin ──────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'Missing Authorization header' }, 401)
  }
  const token = authHeader.replace(/^Bearer\s+/i, '')

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let user: { id: string }
  let isAdmin = false
  try {
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey)
    const { data: { user: authUser }, error: userErr } = await supabaseAuth.auth.getUser(token)
    if (userErr || !authUser) {
      console.error('[send-notification] Invalid session:', userErr?.message)
      return json({ error: 'Invalid or expired session' }, 401)
    }
    user = authUser

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles').select('is_admin').eq('id', user.id).single()
    if (profileErr) throw profileErr
    isAdmin = !!profile?.is_admin
  } catch (err) {
    console.error('[send-notification] Auth/admin check failed:', err)
    return json({ error: 'Failed to verify caller' }, 500)
  }
  if (!isAdmin) {
    console.error('[send-notification] Non-admin caller rejected:', user.id)
    return json({ error: 'Admin access required' }, 403)
  }

  // ── Parse and validate the request ──────────────────────────────────
  let payload: { userIds?: string[]; broadcast?: boolean; title?: string; body?: string; url?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { userIds, broadcast, title, body, url } = payload ?? {}

  if (!title || !body) {
    return json({ error: 'title and body are required' }, 400)
  }
  const hasUserIds = Array.isArray(userIds) && userIds.length > 0
  if (!broadcast && !hasUserIds) {
    return json({ error: 'Provide either a non-empty userIds array or broadcast: true' }, 400)
  }
  if (broadcast && hasUserIds) {
    return json({ error: 'Provide either userIds or broadcast, not both' }, 400)
  }

  // ── Send via OneSignal ───────────────────────────────────────────────
  const notification = {
    app_id: ONESIGNAL_APP_ID,
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    ...(url ? { url } : {}),
    ...(broadcast
      // "Subscribed Users" is an older OneSignal segment name that no longer
      // exists on newer apps — this app's actual default segment for any
      // active push/email/SMS subscriber is "Active Subscriptions".
      ? { included_segments: ['Active Subscriptions'] }
      : { include_aliases: { external_id: userIds } }),
  }

  let oneSignalRes: Response
  try {
    oneSignalRes = await fetch(ONESIGNAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${restApiKey}`,
      },
      body: JSON.stringify(notification),
    })
  } catch (err) {
    console.error('[send-notification] Network error calling OneSignal:', err)
    return json({ error: 'Failed to reach OneSignal API' }, 502)
  }

  const oneSignalData = await oneSignalRes.json().catch(() => null)

  if (!oneSignalRes.ok) {
    console.error('[send-notification] OneSignal API error', oneSignalRes.status, oneSignalData)
    return json({ error: 'OneSignal API error', status: oneSignalRes.status, details: oneSignalData }, 502)
  }

  console.log('[send-notification] Sent', {
    id: oneSignalData?.id,
    recipients: oneSignalData?.recipients,
    broadcast: !!broadcast,
    userCount: userIds?.length ?? null,
  })

  return json({ ok: true, id: oneSignalData?.id, recipients: oneSignalData?.recipients })
})
