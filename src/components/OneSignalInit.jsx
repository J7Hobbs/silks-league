import { useEffect } from 'react'
import { oneSignalReady } from '../lib/oneSignal'

// Loads and initialises the OneSignal Web SDK once, app-wide. Plumbing
// only — no permission prompt, subscription request, or other UI is
// triggered by this. Renders nothing.
export default function OneSignalInit() {
  useEffect(() => {
    oneSignalReady()
  }, [])

  return null
}
