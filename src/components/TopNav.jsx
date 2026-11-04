import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { NAV_TABS, activeTabIndex } from '../lib/navTabs.js'
import ProfileDropdown from './ProfileDropdown.jsx'

// App header: logo, the four main tabs (desktop only) and the account avatar.
// Pass `user` / `isAdmin` when the page already has them; otherwise they are
// looked up here. `desktopOnly` hides the whole header on mobile, for pages
// that keep their own header there.
export default function TopNav({ user, isAdmin, desktopOnly = false }) {
  const { pathname } = useLocation()
  const active = activeTabIndex(pathname)
  const [fetchedUser, setFetchedUser] = useState(null)
  const [fetchedAdmin, setFetchedAdmin] = useState(false)

  useEffect(() => {
    if (user !== undefined && isAdmin !== undefined) return
    let cancelled = false
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      const me = session?.user
      if (!me || cancelled) return
      if (user === undefined) setFetchedUser(me)
      if (isAdmin === undefined) {
        const { data } = await supabase.from('profiles').select('is_admin').eq('id', me.id).single()
        if (!cancelled) setFetchedAdmin(!!data?.is_admin)
      }
    }
    load()
    return () => { cancelled = true }
  }, [user, isAdmin])

  return (
    <header className={`top-nav${desktopOnly ? ' top-nav--desktop-only' : ''}`}>
      <div className="top-nav__inner">
        <Link to="/" className="top-nav__logo">Silks League</Link>
        <nav className="top-nav__links" aria-label="Main">
          {NAV_TABS.map(({ to, label }, n) => (
            <Link key={to} to={to} className="top-nav__link" aria-current={n === active ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="top-nav__right">
          <ProfileDropdown user={user ?? fetchedUser} isAdmin={isAdmin ?? fetchedAdmin} />
        </div>
      </div>
    </header>
  )
}
