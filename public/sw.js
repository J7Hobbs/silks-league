// Silks League — Service Worker
// Bump this version string whenever you deploy a new build so the cache refreshes
const CACHE_VERSION = 'silks-v1'
const SHELL_CACHE   = `${CACHE_VERSION}-shell`
const DATA_CACHE    = `${CACHE_VERSION}-data`

// App-shell files to pre-cache on install
const SHELL_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
]

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS))
  )
  // Activate immediately without waiting for old tabs to close
  self.skipWaiting()
})

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('silks-') && k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    )
  )
  // Take control of all open clients immediately
  self.clients.claim()
})

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle same-origin requests and https
  if (url.origin !== location.origin) return

  // Navigation requests (HTML pages) — network-first, fall back to shell, then offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache a fresh copy of the shell in the background
          const clone = response.clone()
          caches.open(SHELL_CACHE).then(cache => cache.put(request, clone))
          return response
        })
        .catch(() =>
          caches.match(request)
            .then(cached => cached || caches.match('/offline.html'))
        )
    )
    return
  }

  // Static assets (JS, CSS, images, fonts) — cache-first
  if (
    request.destination === 'script'  ||
    request.destination === 'style'   ||
    request.destination === 'image'   ||
    request.destination === 'font'    ||
    request.destination === 'manifest'
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(SHELL_CACHE).then(cache => cache.put(request, clone))
          }
          return response
        })
      })
    )
    return
  }

  // API / Supabase calls — network-first, silent fail (no cache for auth/data)
  // Just let them pass through; if offline the UI handles it gracefully
})
