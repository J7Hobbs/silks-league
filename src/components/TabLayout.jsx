import { Outlet } from 'react-router-dom'
import TopNav from './TopNav.jsx'
import BottomNav from './BottomNav.jsx'

// Shared frame for the four tab pages (Home, Picks, Leaderboard, Results). The
// bars are mounted once, so tapping a tab switches the highlight at once and the
// page below swaps in as its data arrives.
export default function TabLayout() {
  return (
    <div className="tab-shell">
      <TopNav />
      <Outlet />
      <BottomNav />
    </div>
  )
}
