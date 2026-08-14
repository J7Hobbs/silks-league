import { useEffect } from 'react'
import OneSignal from 'react-onesignal'

// Module-level guard — React StrictMode double-invokes effects in dev,
// and OneSignal.init() throws ("SDK already initialized") if called twice.
let initialized = false

// Loads and initialises the OneSignal Web SDK once, app-wide. Plumbing
// only — no permission prompt, subscription request, or other UI is
// triggered by this. Renders nothing.
export default function OneSignalInit() {
  useEffect(() => {
    if (initialized) return
    initialized = true
    OneSignal.init({
      appId: 'eedcef3b-5612-48ad-ac57-5e1e9f19abbc',
      allowLocalhostAsSecureOrigin: true,
    })
  }, [])

  return null
}
