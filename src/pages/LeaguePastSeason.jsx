/**
 * Silks League — a finished Saturday League season (/league/past/season/:seasonId)
 * Its final table (the same season ranking as /league/saturday), how the player finished, and a
 * row per race week that opens that week on the Results page. Read-only.
 */

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { loadSaturdayLeague, loadPickedWeeks, seasonLabel } from '../lib/leagueData.js'
import { weekSubLine, weekRowLine } from '../lib/leagueView.js'
import { ordinal } from '../lib/format.js'
import { useLeagueUser } from '../components/league/useLeagueUser.js'
import BackLink from '../components/league/BackLink.jsx'
import PastBanner from '../components/league/PastBanner.jsx'
import StandingsRow from '../components/league/StandingsRow.jsx'
import PicksModalHost from '../components/league/PicksModalHost.jsx'
import { LeagueSkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/league.css'

export default function LeaguePastSeason() {
  const { seasonId } = useParams()
  const user = useLeagueUser()
  const [data, setData] = useState(undefined)   // undefined = loading, null = not found
  const [picksModal, setPicksModal] = useState(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadSaturdayLeague(user.id, { withWeek: false, seasonId })
      .then(async d => {
        // Weeks the player picked in, so a week they scored 0 in isn't shown as "didn't play".
        const picked = d ? await loadPickedWeeks(user.id, d.completedWeeks.map(w => w.id)).catch(() => new Set()) : new Set()
        if (!cancelled) setData(d && { ...d, picked })
      })
      .catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [user, seasonId])

  if (data === undefined) return <LeagueSkeleton />

  if (!data) {
    return (
      <div className="app-page lg">
        <main className="lg__main">
          <BackLink />
          <h1 className="lg-title">Saturday League</h1>
          <p className="lg-msg">We couldn't find that season.</p>
        </main>
      </div>
    )
  }

  const { season, satRows, completedWeeks, picked } = data
  const label = seasonLabel(season)
  const rows = satRows.map(r => ({
    id: r.user_id, rank: r.rank, name: r.name, isMe: r.isMe, points: r.seasonTotal,
    sub: weekSubLine(r.weekPts, completedWeeks),
    modal: { userId: r.user_id, name: r.name, pts: r.seasonTotal, rank: r.rank },
  }))
  const mine = satRows.find(r => r.isMe)
  const played = !!mine && mine.weeksPlayed > 0

  return (
    <div className="app-page lg">
      <main className="lg__main">
        <BackLink />
        <PastBanner
          eyebrow={`Final table · ${label}`}
          title="Saturday League"
          line={played ? `You finished ${ordinal(mine.rank)} of ${rows.length} · ${mine.seasonTotal} pts` : "You didn't play this season"}
          muted={!played}
        />

        {rows.length > 0 && (
          <>
            <div className="lg-list">
              {rows.map(row => (
                <StandingsRow key={row.id} row={row} top={row.points > 0 && row.rank <= 3} onClick={() => setPicksModal(row.modal)} />
              ))}
            </div>
            <p className="lg-foot">Tap any player to see their picks</p>
          </>
        )}

        {completedWeeks.length > 0 && (
          <section className="lp-weeks" aria-label="Your weeks">
            <h2 className="lp-weeks__head">Your weeks</h2>
            <div className="lp-weeks__list">
              {completedWeeks.map(w => (
                <Link key={w.id} to={`/results?week=${w.id}`} className="lp-week">
                  <span className="lp-week__text">{weekRowLine(w, mine?.weekPts?.[w.id], picked.has(w.id))}</span>
                  <span className="lp-week__chev" aria-hidden="true">&rsaquo;</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
      <PicksModalHost modal={picksModal} viewerUserId={user?.id} onClose={() => setPicksModal(null)} />
    </div>
  )
}
