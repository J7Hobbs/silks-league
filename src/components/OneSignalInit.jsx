import { useEffect } from 'react'
import { oneSignalReady } from '../lib/oneSignal'
import { supabase } from '../lib/supabase'
import { syncNotifStatus, watchPush } from '../lib/notifications.js'

// Loads and initialises the OneSignal Web SDK once, app-wide. No permission prompt, subscription
// request or other UI is triggered by this. It also keeps profiles.notifications_enabled in step
// with this device (on open, on sign-in, and whenever the player turns notifications on or off)
// so Admin can see who has them off. Renders nothing.
export default function OneSignalInit() {
  useEffect(() => {
    oneSignalReady()

    let userId = null
    const sync = () => { if (userId) syncNotifStatus(userId) }
    // getSession reads the saved session without a network call.
    supabase.auth.getSession().then(({ data }) => { userId = data?.session?.user?.id || null; sync() }).catch(() => {})
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id || null
      if (next !== userId) { userId = next; sync() }
    })
    const stop = watchPush(sync)
    return () => { stop(); sub?.subscription?.unsubscribe() }
  }, [])

  return null
}
