/**
 * Silks League — festival full table (/league/festival/:id)
 * The festival table with its day columns, as it has always been. Ranked with the same helper
 * as the Results page (festivalTotals + orderIds in lib/standings.js).
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useCompetition } from '../context/competition.js'
import { loadFestival, fetchFestivalRows } from '../lib/leagueData.js'
import { useLeagueUser } from '../components/league/useLeagueUser.js'
import BackLink from '../components/league/BackLink.jsx'
import TableBody from '../components/league/TableBody.jsx'
import PicksModalHost from '../components/league/PicksModalHost.jsx'
import { LeagueSkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/league.css'

const MSG_FEST = 'No points yet – the table fills up after the first race'

export default function LeagueFestival() {
  const { festivalId } = useParams()
  const navigate = useNavigate()
  const { setCompetition } = useCompetition()
  const user = useLeagueUser()
  const [data, setData] = useState(undefined)   // undefined = loading, null = not found
  const [picksModal, setPicksModal] = useState(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      try {
        const fest = await loadFestival(festivalId)
        if (!fest) { if (!cancelled) setData(null); return }
        const { rows, table } = await fetchFestivalRows(fest, null, user.id)
        if (!cancelled) setData({ fest, rows, table })
      } catch {
        if (!cancelled) setData(null)
      }
    })()
    return () => { cancelled = true }
  }, [user, festivalId])

  if (data === undefined) return <LeagueSkeleton />

  if (!data) {
    return (
      <div className="app-page lg">
        <main className="lg__main">
          <BackLink />
          <h1 className="lg-title">Festival</h1>
          <p className="lg-msg">We couldn't find that festival.</p>
        </main>
      </div>
    )
  }

  const { fest, rows: festRows, table } = data
  const name = fest.display_name || fest.name
  const rows = festRows.map(r => ({
    id: r.userId, rank: r.rank, name: r.name, isMe: r.isMe, points: r.points,
    modal: { userId: r.userId, name: r.name, pts: r.points, rank: r.rank, festivalId: fest.id, festivalName: name },
  }))

  function makePicks() {
    setCompetition('festival', fest.id)
    navigate('/picks')
  }

  return (
    <div className="app-page lg">
      <main className="lg__main">
        <BackLink />
        <h1 className="lg-title">{name}</h1>
        <TableBody
          rows={rows}
          table={table}
          caption={name}
          message={MSG_FEST}
          festival
          notIn={!rows.some(r => r.isMe)}
          onMakePicks={makePicks}
          onPlayer={r => setPicksModal(r.modal)}
        />
      </main>
      <PicksModalHost modal={picksModal} viewerUserId={user?.id} onClose={() => setPicksModal(null)} />
    </div>
  )
}
