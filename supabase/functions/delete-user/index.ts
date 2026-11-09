// Supabase Edge Function: delete-user
//
// Deletes a player completely: their picks, scores, bonuses, festival entries and points, group memberships, their
// profile, and finally their sign-in (the auth user). Built for removing test accounts from the Admin "Players" tab.
// It needs the service-role key (removing an auth user is not possible from the browser), so it lives here and checks
// who is calling first.
//
// Request body (JSON):
//   { userId: string, username: string }
//   `username` must match the player's current username, as a second check that the right account is being deleted.
//
// Caller must be a signed-in user whose profile has is_admin = true. It refuses to delete the caller's own account and
// refuses to delete any admin account (take the admin flag off first if that is ever really what you want).
//
// Groups the player created are kept, but lose their creator (groups.created_by is set to null by the database).
//
// Secrets: none to set. SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by the Edge Runtime.

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

// Children first, so nothing is left pointing at a row that is about to go.
const USER_TABLES = [
  'bonus_awards',
  'scores',
  'festival_scores',
  'festival_day_points',
  'picks',
  'festival_picks',
  'festival_entries',
  'group_members',
]

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)
  const token = authHeader.replace(/^Bearer\s+/i, '')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // ── Who is calling, and are they an admin? ──
  let callerId: string
  const admin = createClient(url, serviceKey)
  try {
    const { data: { user }, error } = await createClient(url, anonKey).auth.getUser(token)
    if (error || !user) return json({ error: 'Invalid or expired session' }, 401)
    callerId = user.id
    const { data: profile, error: pErr } = await admin.from('profiles').select('is_admin').eq('id', user.id).single()
    if (pErr) throw pErr
    if (!profile?.is_admin) {
      console.error('[delete-user] Non-admin caller rejected:', user.id)
      return json({ error: 'Admin access required' }, 403)
    }
  } catch (err) {
    console.error('[delete-user] Auth/admin check failed:', err)
    return json({ error: 'Failed to verify caller' }, 500)
  }

  // ── The request ──
  let payload: { userId?: string; username?: string }
  try { payload = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const { userId, username } = payload ?? {}
  if (!userId || typeof userId !== 'string') return json({ error: 'userId is required' }, 400)
  if (userId === callerId) return json({ error: 'You cannot delete your own account' }, 400)

  const { data: target, error: tErr } = await admin.from('profiles').select('id, username, full_name, is_admin').eq('id', userId).maybeSingle()
  if (tErr) return json({ error: `Could not read the player: ${tErr.message}` }, 500)
  if (!target) return json({ error: 'That player does not exist' }, 404)
  if (target.is_admin) return json({ error: 'That is an admin account. Remove the admin flag first if you really want to delete it.' }, 400)
  const shown = target.username || target.full_name || ''
  if (!username || username !== shown) return json({ error: 'The username did not match this player' }, 400)

  // ── Delete ──
  for (const table of USER_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', userId)
    if (error) {
      console.error(`[delete-user] ${table} failed:`, error)
      return json({ error: `Could not clear ${table}: ${error.message}. Nothing else was deleted after this step.` }, 500)
    }
  }
  const { error: profErr } = await admin.from('profiles').delete().eq('id', userId)
  if (profErr) {
    console.error('[delete-user] profiles failed:', profErr)
    return json({ error: `Could not delete the profile: ${profErr.message}` }, 500)
  }
  const { error: authErr } = await admin.auth.admin.deleteUser(userId)
  if (authErr) {
    console.error('[delete-user] auth delete failed:', authErr)
    return json({ error: `Their data is gone but the sign-in could not be removed: ${authErr.message}` }, 500)
  }

  console.log('[delete-user] Deleted', { userId, by: callerId })
  return json({ ok: true })
})
