import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { NAV_TABS, activeTabIndex } from '../lib/navTabs.js'

// Mobile bottom nav — floating champagne glass bar. Shown on mobile only
// (styles in src/index.css, .glass-nav). The active tab comes from the
// current route, so pages just render <BottomNav /> with no props.

// Each page mounts its own copy of the bar, so remember the last active tab
// and start the lens there — it then springs across to the new tab.
let lastActive = null

// How many races this week's Saturday League picks are still empty. Same
// "current week" rule as Picks.jsx (first week whose deadline hasn't passed).
// Returns 0 once picks are locked or when there's nothing to pick.
function usePicksLeft() {
  const [left, setLeft] = useState(0)

  useEffect(() => {
    if (!window.matchMedia('(max-width: 768px)').matches) return
    let cancelled = false

    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return

      const { data: season } = await supabase.from('seasons').select('id').eq('is_active', true).single()
      if (!season) return

      const { data: weeks } = await supabase
        .from('race_weeks').select('id, saturday_date, picks_deadline')
        .eq('season_id', season.id).order('saturday_date', { ascending: true })
      const now = new Date()
      const week = weeks?.find(w => now < (w.picks_deadline ? new Date(w.picks_deadline) : new Date(w.saturday_date + 'T12:00:00')))
      if (!week) return

      const { data: races } = await supabase.from('races').select('id').eq('race_week_id', week.id)
      const raceIds = (races || []).map(r => r.id)
      if (!raceIds.length) return

      const { data: picks } = await supabase
        .from('picks').select('race_id').eq('user_id', user.id).in('race_id', raceIds)
      if (!cancelled) setLeft(Math.max(0, raceIds.length - (picks?.length ?? 0)))
    }

    load()
    return () => { cancelled = true }
  }, [])

  return left
}

export default function BottomNav() {
  const { pathname } = useLocation()
  const active = activeTabIndex(pathname)
  const [shown, setShown] = useState(lastActive ?? Math.max(active, 0))
  const picksLeft = usePicksLeft()

  useEffect(() => {
    if (active < 0) return
    lastActive = active
    const id = requestAnimationFrame(() => setShown(active))
    return () => cancelAnimationFrame(id)
  }, [active])

  return (
    <nav className="glass-nav" aria-label="Main navigation" style={{ '--i': shown }}>
      <span className={`glass-lens${active < 0 ? ' glass-lens--off' : ''}`} aria-hidden="true" />
      {NAV_TABS.map((tab, n) => {
        const { to, label } = tab
        const Icon = tab.Icon
        const isActive = n === active
        return (
          <Link key={to} to={to} className="glass-tab" aria-current={isActive ? 'page' : undefined}>
            <Icon
              size={23}
              strokeWidth={isActive ? 2 : 1.75}
              fill={isActive ? 'currentColor' : 'none'}
              fillOpacity={0.2}
              aria-hidden="true"
            />
            <span className="glass-tab__label">{label}</span>
            {to === '/picks' && picksLeft > 0 && (
              <span className="glass-badge" aria-label={`${picksLeft} races left to pick`}>{picksLeft}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
