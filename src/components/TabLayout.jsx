import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadOnboarding } from '../lib/onboarding.js'
import TopNav from './TopNav.jsx'
import BottomNav from './BottomNav.jsx'

let onboardingChecked = false // module-wide: ask the database once per visit

// Shared frame for the four tab pages (Home, Picks, Leaderboard, Results). The
// bars are mounted once, so tapping a tab switches the highlight at once and the
// page below swaps in as its data arrives.
export default function TabLayout() {
  const navigate = useNavigate()

  // The pages read the signed-in user from the saved session without a network
  // call. This checks that session with the server once, in the background, and
  // sends the player to sign in if it is no longer valid. A dropped connection
  // is not a reason to sign anyone out. It waits a moment so it doesn't hold up
  // the first page's own queries (the auth client runs them one at a time), and it
  // runs once per visit, not on every tab change.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      supabase.auth.getUser().then(({ data: { user }, error }) => {
        if (cancelled) return
        if (user) { sendToWelcomeIfNew(user.id); return }
        if (error?.name === 'AuthRetryableFetchError') return
        navigate('/auth')
      }).catch(() => {})
    }, 1500)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A player who hasn't seen the welcome flow yet (they arrived by a bookmark or a
  // notification, not through sign-in) is taken to it. Once per visit; if we can't tell,
  // nobody is moved.
  function sendToWelcomeIfNew(userId) {
    if (onboardingChecked) return
    loadOnboarding(userId).then(({ known, done }) => {
      if (known) onboardingChecked = true
      if (known && !done) navigate('/welcome', { replace: true })
    })
  }

  return (
    <div className="tab-shell">
      <TopNav />
      <Outlet />
      <BottomNav />
    </div>
  )
}
