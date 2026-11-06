/**
 * Silks League — Saturday League full table (/league/saturday)
 * The This week / Season table, as it has always been; only the page around it changed.
 * Ranking comes from lib/leagueData.js (season: orderIds; this week: the same standings the
 * Results page uses).
 */

import { useState, useEffect } from 'react'
import { loadSaturdayLeague } from '../lib/leagueData.js'
import { seasonMonth, winnersLine, weekRowsForAll } from '../lib/leagueView.js'
import { useLeagueUser } from '../components/league/useLeagueUser.js'
import BackLink from '../components/league/BackLink.jsx'
import ViewToggle from '../components/league/ViewToggle.jsx'
import TableBody from '../components/league/TableBody.jsx'
import PicksModalHost from '../components/league/PicksModalHost.jsx'
import { LeagueSkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/league.css'

const VIEWS = [{ key: 'week', label: 'This week' }, { key: 'season', label: 'Season' }]
const MSG_SEASON = 'No points yet – the table fills up after the first race week'
const MSG_WEEK = 'No points yet this week – the table fills up after the first race'

export default function LeagueSaturday() {
  const user = useLeagueUser()
  const [data, setData] = useState(undefined)   // undefined = loading, null = no active season
  const [view, setView] = useState('season')
  const [picksModal, setPicksModal] = useState(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadSaturdayLeague(user.id).then(d => { if (!cancelled) setData(d) }).catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [user])

  if (data === undefined) return <LeagueSkeleton />

  const { season, currentWeek, satRows = [], weekRows = [], satTable = null } = data || {}
  const month = seasonMonth(season)
  const weekLabel = currentWeek?.week_number ? `Week ${currentWeek.week_number}` : 'This week'

  let rows, caption, message
  if (view === 'week') {
    caption = month ? `${weekLabel} · ${month}` : weekLabel
    message = MSG_WEEK
    rows = weekRowsForAll(weekRows, satRows).map(r => ({
      id: r.user_id, rank: r.rank, name: r.name, isMe: r.isMe, points: r.weekPoints,
      sub: winnersLine(r.winners || 0),
      modal: { userId: r.user_id, name: r.name, pts: r.weekPoints, rank: r.rank },
    }))
  } else {
    caption = month ? `${month} season` : ''
    message = MSG_SEASON
    rows = satRows.map(r => ({
      id: r.user_id, rank: r.rank, name: r.name, isMe: r.isMe, points: r.seasonTotal,
      modal: { userId: r.user_id, name: r.name, pts: r.seasonTotal, rank: r.rank },
    }))
  }

  return (
    <div className="app-page lg">
      <main className="lg__main">
        <BackLink />
        <h1 className="lg-title">Saturday League</h1>
        <ViewToggle items={VIEWS} value={view} onChange={setView} />
        {!data ? (
          <p className="lg-msg">No season is running yet.</p>
        ) : (
          <TableBody rows={rows} table={view === 'season' ? satTable : null} caption={caption} message={message} onPlayer={r => setPicksModal(r.modal)} />
        )}
      </main>
      <PicksModalHost modal={picksModal} viewerUserId={user?.id} onClose={() => setPicksModal(null)} />
    </div>
  )
}
