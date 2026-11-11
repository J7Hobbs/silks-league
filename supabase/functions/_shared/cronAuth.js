// Who may run a scheduled (pg_cron) Edge Function: picks-deadline-reminder and agent-watchdog.
//
// Two ways in, either is enough:
//   1. the x-cron-secret header equals CRON_SECRET (a secret set with `supabase secrets set CRON_SECRET=...`). Refused outright
//      when CRON_SECRET is unset or shorter than 16 characters, so a missing secret can never let an empty header through.
//   2. the old check: Authorization is "Bearer <the runtime's service-role key>". Kept so nothing that already works breaks.
// The cron job itself still sends its legacy service_role JWT as Authorization, which is what gets it past the gateway's JWT
// verification (that stays ON); x-cron-secret is what these functions check themselves.

export const MIN_CRON_SECRET = 16

// Compare secrets without stopping at the first different character.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

// headers: a Headers object (or anything with .get). cronSecret / serviceKey: the values from the environment.
export function isCronAuthorised(headers, { cronSecret, serviceKey } = {}) {
  const provided = headers?.get?.('x-cron-secret')
  if (typeof cronSecret === 'string' && cronSecret.length >= MIN_CRON_SECRET && provided && safeEqual(provided, cronSecret)) return true
  const auth = headers?.get?.('Authorization')
  return !!serviceKey && !!auth && safeEqual(auth, `Bearer ${serviceKey}`)
}
