// A password-reset link opens /reset-password with tokens in the address (#access_token=…&type=recovery),
// which Supabase reads and then removes. This is imported first in main.jsx so the address is read
// before that happens, and the result is kept for this tab so a refresh of the page still works.

const KEY = 'silks_recovery_link'

function readAddress() {
  try {
    const p = new URLSearchParams((window.location.hash || '').replace(/^#/, '') || window.location.search)
    if (p.get('error') || p.get('error_code')) return 'error'
    if (p.get('type') === 'recovery') return 'ok'
  } catch { /* ignore */ }
  return null
}

const seen = readAddress()
if (seen) { try { sessionStorage.setItem(KEY, seen) } catch { /* storage can be unavailable */ } }

// 'ok' (arrived from a reset link), 'error' (an expired or used link), or null
export function recoveryState() {
  if (seen) return seen
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

export function clearRecovery() {
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}
