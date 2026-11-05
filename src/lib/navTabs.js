import { Home, Target, Trophy, BarChart2 } from 'lucide-react'

// The four main tabs, shared by the desktop TopNav and the mobile BottomNav.
// `paths` lists every route that should light the tab up.
export const NAV_TABS = [
  { to: '/dashboard', label: 'Home',        Icon: Home,      paths: ['/dashboard', '/race-day', '/festivals', '/groups'] },
  { to: '/picks',     label: 'Picks',       Icon: Target,    paths: ['/picks', '/festival-picks'] },
  { to: '/league',    label: 'Leaderboard', Icon: Trophy,    paths: ['/league', '/festival-leaderboard'] },
  { to: '/results',   label: 'Results',     Icon: BarChart2, paths: ['/results'] },
]

// Index of the tab for this pathname, or -1 (e.g. /groups, /profile).
export function activeTabIndex(pathname) {
  return NAV_TABS.findIndex(t => t.paths.some(p => pathname === p || pathname.startsWith(p + '/')))
}

// Fired after a Saturday League pick is saved, so the "races left" badge on the
// bottom bar can recount.
export const PICKS_CHANGED = 'silks:picks-changed'
