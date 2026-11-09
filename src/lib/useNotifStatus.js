// Whether this device has push notifications on, for the Home strip and the Picks cards.
// Reads the same OneSignal state as the Account switch and opts in with the same steps
// (enablePush in notifications.js). Nothing is asked of the player until they tap.
import { useState, useEffect, useCallback } from 'react'
import { pushStatus, watchPush, enablePush, notifOffer } from './notifications.js'

// { offer, enable, busy }
//   offer   null | 'home' | 'denied' | 'enable'  (see notifOffer); null until known
//   enable  runs the opt-in; resolves to whether permission was granted
export function useNotifStatus(userId) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let off = false
    const read = () => pushStatus().then(s => { if (!off) setStatus(s) }).catch(() => {})
    read()
    const stop = watchPush(read)
    return () => { off = true; stop() }
  }, [])

  const enable = useCallback(async () => {
    if (!userId) return false
    setBusy(true)
    try {
      const granted = await enablePush(userId)
      // Hide the offer straight away; re-read in case permission was refused.
      setStatus(granted ? { supported: true, permission: 'granted', optedIn: true } : await pushStatus())
      return granted
    } catch {
      return false
    } finally {
      setBusy(false)
    }
  }, [userId])

  return { offer: notifOffer(status), enable, busy }
}
