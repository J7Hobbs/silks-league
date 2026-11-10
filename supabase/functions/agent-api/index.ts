// Supabase Edge Function: agent-api
//
// The door for the race-day agents (scheduled Claude tasks that collect racecards, non-runners and results from public racing
// sites). It does not use a signed-in user. Instead every request must carry the secret in the x-agent-secret header, and
// that is the only thing that gets in. So this function is deployed with JWT verification OFF (supabase/config.toml sets
// that; `--no-verify-jwt` on the deploy command does the same).
//
//   AGENT_SECRET        required. A long random string, set with `supabase secrets set`. Without it every request is refused.
// Automatic mode (applying CONFIRMED non-runners, jockey changes and weighed-in results by itself) is the Admin switch on the
// Today screen: app_settings.agent_auto_apply, read on every request. Off means every item waits as a draft.
//   AGENT_AUTO_APPLY    optional, and only a fallback: "true" is used ONLY when the app_settings row does not exist.
//
// All the work is in ../_shared/agentApi.js (which runs the same scoring / withdrawal / result-saving code as the app) so it
// can be tested without a server. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { setClient } from '../_shared/db.js'
import { handleAgentRequest } from '../_shared/agentApi.js'

setClient(createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}))

const ON = ['1', 'true', 'on', 'yes']

Deno.serve(async req => {
  const out = await handleAgentRequest(
    { method: req.method, providedSecret: req.headers.get('x-agent-secret'), bodyText: req.method === 'POST' ? await req.text() : '' },
    { secret: Deno.env.get('AGENT_SECRET') ?? '', autoApply: ON.includes((Deno.env.get('AGENT_AUTO_APPLY') ?? '').toLowerCase()) },
  )
  return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'Content-Type': 'application/json' } })
})
