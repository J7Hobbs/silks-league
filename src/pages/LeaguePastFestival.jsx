/**
 * Silks League — a finished festival (/league/past/festival/:festivalId)
 * Its final table (the same table and ranking as /league/festival/:id), with how the player
 * finished and a way into their results. Read-only.
 */

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { loadFestival, fetchFestivalRows } from '../lib/leagueData.js'
import { monthYear } from '../lib/leagueView.js'
import { ordinal } from '../lib/format.js'
import { useLeagueUser } from '../components/league/useLeagueUser.js'
import BackLink from '../components/league/BackLink.jsx'
import PastBanner from '../components/league/PastBanner.jsx'
import LeagueTable, { TableKey } from '../components/league/LeagueTable.jsx'
import PicksModalHost from '../components/league/PicksModalHost.jsx'
import { LeagueSkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/league.css'

export default function LeaguePastFestival() {
  const { festivalId } = useParams()
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
  const me = rows.find(r => r.isMe)
  const mine = festRows.find(r => r.isMe)
  const played = !!mine && (mine.points > 0 || Object.keys(mine.dayPts).length > 0)

  return (
    <div className="app-page lg">
      <main className="lg__main">
        <BackLink />
        <PastBanner
          festival={{ banner: { url: fest.banner_url, position: fest.banner_position } }}
          eyebrow={`Final table · ${monthYear(fest.end_date || fest.start_date)}`}
          title={name}
          line={me ? `You finished ${ordinal(me.rank)} of ${rows.length} · ${me.points} pts` : "You didn't play this one"}
          muted={!me}
        />

        {played && (
          <Link to={`/results?festival=${fest.id}`} className="lg-btn lg-btn--link">See your results</Link>
        )}

        {rows.length === 0 ? (
          <p className="lg-msg">No one entered this one.</p>
        ) : (
          <>
            <LeagueTable columns={table.columns} rows={table.rows} dense={table.columns.length >= 5} onPlayer={r => setPicksModal(rows.find(x => x.id === r.id)?.modal)} />
            <TableKey festival />
            <p className="lg-foot">Tap any player to see their picks</p>
          </>
        )}
      </main>
      <PicksModalHost modal={picksModal} viewerUserId={user?.id} onClose={() => setPicksModal(null)} />
    </div>
  )
}
