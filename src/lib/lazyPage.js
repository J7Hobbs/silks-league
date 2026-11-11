import { lazy } from 'react'

// Route code-splitting helpers: lazy pages, recovery when a deploy removes a chunk, and idle prefetching.

// A deploy while the app is open can remove the old hashed files a lazy page needs. The fix is to reload once to pick up the new
// build. The flag stops that from looping if the file is still missing after the reload (e.g. the player is offline).
const RELOAD_FLAG = 'silks-chunk-reload'

export function reloadOnceForNewVersion() {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

function clearReloadFlag() {
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode: nothing to clear */ }
}

// React.lazy for a page. On a failed load it reloads once; a second failure is thrown to the error boundary around the routes.
// Only a page the player actually opened can cause a reload: a failed idle prefetch (below) is ignored, so nothing ever reloads
// the app under someone who is just looking at a screen.
export function lazyPage(importer) {
  return lazy(() =>
    importer().then(
      module => { clearReloadFlag(); return module },
      error => {
        if (reloadOnceForNewVersion()) return new Promise(() => {}) // the page is about to reload; keep the fallback up until then
        throw error
      },
    ),
  )
}

// Fetch lazy pages in idle time so tapping into them is instant. Runs once, a moment after the first page has drawn, one chunk at a
// time so it never competes with that page's own data. Skipped on Data Saver and very slow connections. Each list runs once.
const prefetched = new Set()

export function prefetchPages(importers, { delayMs = 2000 } = {}) {
  if (typeof window === 'undefined' || prefetched.has(importers)) return
  prefetched.add(importers)
  const conn = navigator.connection
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return
  const idle = fn => ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 300))
  const queue = [...importers]
  const next = () => {
    const importer = queue.shift()
    if (!importer) return
    importer().catch(() => {}).then(() => idle(next)) // a failed prefetch is not an error: the page loads on demand instead
  }
  setTimeout(() => idle(next), delayMs)
}
