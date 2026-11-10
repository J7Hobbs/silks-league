// Supabase Edge Function: notify-group-join
//
// Called by the app right after a player joins a group. Tells everyone already in the group:
//   "<username> just joined <group name>"
// through send-notification.
//
// Players are not admins, so they cannot call send-notification themselves. This function takes only a group id from the
// caller and builds the message itself, so it cannot be used to send anything else. It checks that the caller really is a
// member of that group and joined in the last 5 minutes, and it never messages the person who joined.
//
// Deploy with JWT verification ON (the default): the caller is a signed-in player.
// The wording is in ../_shared/notifyCopy.js.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { APP_ORIGIN, groupJoined } from '../_shared/notifyCopy.js'

const FRESH_MS = 5 * 60 * 1000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Missing Authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: { user }, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !user) return json({ error: 'Invalid or expired session' }, 401)

  let groupId = ''
  try { groupId = String((await req.json())?.groupId || '') } catch { /* handled below */ }
  if (!groupId) return json({ error: 'groupId is required' }, 400)

  try {
    // The caller must be in the group, and must have only just joined.
    const { data: mine } = await admin.from('group_members').select('joined_at').eq('group_id', groupId).eq('user_id', user.id).maybeSingle()
    if (!mine) return json({ error: 'You are not a member of that group' }, 403)
    const joinedMs = Date.parse(mine.joined_at || '')
    if (Number.isNaN(joinedMs) || Date.now() - joinedMs > FRESH_MS) return json({ ok: true, sent: 0, skipped: 'not a new join' })

    const [{ data: group }, { data: profile }, { data: others }] = await Promise.all([
      admin.from('groups').select('name').eq('id', groupId).maybeSingle(),
      admin.from('profiles').select('username, full_name').eq('id', user.id).maybeSingle(),
      admin.from('group_members').select('user_id').eq('group_id', groupId).neq('user_id', user.id),
    ])
    const userIds = [...new Set((others || []).map((m: { user_id: string }) => m.user_id))]
    if (!group?.name || !userIds.length) return json({ ok: true, sent: 0 })

    const username = profile?.username || profile?.full_name || 'A new player'
    const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ userIds, ...groupJoined({ username, groupName: group.name }), url: `${APP_ORIGIN}/league` }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error('[notify-group-join] send-notification failed', res.status, data)
      return json({ error: 'Could not send the notification' }, 502)
    }
    return json({ ok: true, sent: userIds.length })
  } catch (err) {
    console.error('[notify-group-join] failed:', err)
    return json({ error: 'Could not send the notification' }, 500)
  }
})
