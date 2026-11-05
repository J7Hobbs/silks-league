// Keeps hold of the browser's "install this app" event. It fires once, early, usually before
// the welcome page exists, so this is imported at startup (main.jsx) and remembers it.
let deferred = null
const listeners = new Set()
const tell = () => listeners.forEach(fn => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; tell() })
  window.addEventListener('appinstalled', () => { deferred = null; tell() })
}

export const hasInstallPrompt = () => deferred !== null

export function onInstallPromptChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Shows the browser's install dialog. Resolves 'accepted', 'dismissed' or 'unavailable'.
export async function runInstallPrompt() {
  if (!deferred) return 'unavailable'
  const event = deferred
  deferred = null
  tell()
  try {
    event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  } catch {
    return 'unavailable'
  }
}
