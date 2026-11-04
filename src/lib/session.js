import { supabase } from './supabase'

// The signed-in user from the session saved on this device. No network call: the
// session is read locally (and refreshed first if it has expired). TabLayout checks
// the session with the server once, in the background, after a tab page opens.
export async function currentUser() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
}
