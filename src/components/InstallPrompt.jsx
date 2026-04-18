import { useState, useEffect } from 'react'

const DISMISSED_KEY = 'silks_install_dismissed'

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Don't show if already dismissed or already installed as PWA
    if (localStorage.getItem(DISMISSED_KEY)) return

    // Already running in standalone mode — already installed
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if (window.navigator.standalone === true) return // iOS standalone

    // Listen for the browser's install prompt event (Chrome / Android)
    const handler = e => {
      e.preventDefault()
      setDeferredPrompt(e)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // On iOS, Safari doesn't fire beforeinstallprompt — show the banner manually
    // after a short delay so it doesn't flash on first load
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isInStandalone = window.navigator.standalone
    if (isIOS && !isInStandalone) {
      const timer = setTimeout(() => setVisible(true), 2000)
      return () => {
        clearTimeout(timer)
        window.removeEventListener('beforeinstallprompt', handler)
      }
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        dismiss()
      }
      setDeferredPrompt(null)
    }
    // iOS: just dismiss — user follows the native share → "Add to Home Screen" flow
  }

  const dismiss = () => {
    setVisible(false)
    localStorage.setItem(DISMISSED_KEY, '1')
  }

  if (!visible) return null

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)

  return (
    <div style={st.banner}>
      <div style={st.inner}>
        <div style={st.icon}>🏇</div>
        <div style={st.text}>
          <span style={st.msg}>
            {isIOS
              ? <>Add <strong style={st.strong}>Silks League</strong> to your home screen for the best experience</>
              : <>Add <strong style={st.strong}>Silks League</strong> to your home screen for the best experience</>
            }
          </span>
          {isIOS && (
            <span style={st.iosHint}>
              Tap <span style={st.shareIcon}>⎋</span> then "Add to Home Screen"
            </span>
          )}
        </div>
        {!isIOS && (
          <button style={st.installBtn} onClick={handleInstall}>
            Install
          </button>
        )}
        <button style={st.dismissBtn} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  )
}

const st = {
  banner: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    background: '#0d1f0d',
    borderTop: '1px solid #c9a84c',
    padding: '0.75rem 1rem',
    // Safe area inset for phones with home indicator
    paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
  },
  inner: {
    maxWidth: '600px',
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  icon: {
    fontSize: '1.5rem',
    flexShrink: 0,
  },
  text: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
  },
  msg: {
    fontSize: '0.85rem',
    color: '#e8f0e8',
    lineHeight: 1.4,
    fontFamily: "'DM Sans', sans-serif",
  },
  strong: {
    color: '#c9a84c',
    fontWeight: '700',
  },
  iosHint: {
    fontSize: '0.75rem',
    color: '#7a9e85',
    fontFamily: "'DM Sans', sans-serif",
  },
  shareIcon: {
    fontSize: '0.85rem',
  },
  installBtn: {
    flexShrink: 0,
    background: '#c9a84c',
    color: '#0a1a08',
    border: 'none',
    borderRadius: '7px',
    padding: '0.5rem 1rem',
    fontSize: '0.85rem',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
  },
  dismissBtn: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    color: '#5a8a5a',
    fontSize: '1rem',
    cursor: 'pointer',
    padding: '0.25rem 0.4rem',
    lineHeight: 1,
  },
}
