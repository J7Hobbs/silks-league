// Has this player seen the welcome flow, and where should they go after signing in?
import { supabase } from './supabase'
import { readPendingCode } from './invite.js'

// { known, done }. known:false means we couldn't tell (e.g. the column isn't there yet or
// the network failed), and callers must NOT trap anyone in the flow in that case.
export async function loadOnboarding(userId) {
  try {
    const { data, error } = await supabase.from('profiles').select('onboarded_at').eq('id', userId).maybeSingle()
    if (error || !data) return { known: false, done: true }
    return { known: true, done: !!data.onboarded_at }
  } catch {
    return { known: false, done: true }
  }
}

// Marks the welcome flow as finished. has_onboarded is kept in step with the older flag.
export async function finishOnboarding(userId) {
  const { error } = await supabase.from('profiles')
    .update({ onboarded_at: new Date().toISOString(), has_onboarded: true }).eq('id', userId)
  return !error
}

// Where to send a signed-in player: a waiting invite code first (the join page then moves
// them on), then the welcome flow if they haven't done it, otherwise Home.
export async function postAuthDestination(user) {
  const code = readPendingCode(user)
  if (code) return `/join/${encodeURIComponent(code)}`
  const { done } = await loadOnboarding(user.id)
  return done ? '/dashboard' : '/welcome'
}
