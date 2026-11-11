import { Component, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { dismissSplash } from '../lib/splash.js'
import { prefetchPages } from '../lib/lazyPage.js'

// Small pieces the router uses around lazy pages.

// Rendered next to a route's page. It only mounts once that page's code has loaded and drawn, so it marks "the first page is up":
// that is when the app-start splash (index.html) is taken down, and when idle prefetching of the other pages starts.
export function Landed({ prefetch }) {
  useEffect(() => {
    dismissSplash()
    if (prefetch) prefetchPages(prefetch)
  }, [prefetch])
  return null
}

// What shows while a lazy page's code loads and the page has no skeleton of its own: the plain app background, which is exactly
// what these pages show before their own first paint.
export function Blank() {
  return <div aria-hidden="true" style={{ minHeight: '100vh', background: 'var(--bg)' }} />
}

// The loading state of the older pages (Profile, Races, Festival picks, Festival leaderboard): the same gold dot, so the
// hand-over from "code loading" to "page loading" doesn't change anything on screen.
export function LegacyLoading() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#c9a84c' }} />
    </div>
  )
}

// Last resort when a page's code can't be loaded even after the automatic reload (usually: no connection).
class Boundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch() { dismissSplash() }

  // Going to another page clears the message, so one page that won't load doesn't take the rest of the app with it.
  componentDidUpdate(prev) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" style={{ minHeight: '100vh', background: '#0a1a08', color: '#f2efe4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '24px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ fontSize: '17px', fontWeight: 600 }}>This page couldn't load</div>
        <div style={{ fontSize: '14px', color: '#a8b8a2', maxWidth: '280px' }}>Check your connection and try again.</div>
        <button type="button" onClick={() => window.location.reload()} style={{ marginTop: '6px', height: '44px', padding: '0 22px', borderRadius: '10px', background: '#c9a84c', color: '#0a1a08', fontSize: '15px', fontWeight: 700 }}>Reload</button>
      </div>
    )
  }
}

export function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation()
  return <Boundary resetKey={pathname}>{children}</Boundary>
}
