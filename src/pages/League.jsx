/**
 * Silks League — Leaderboard hub
 * The Saturday League and any live (or just finished) festival as top-five cards, then your groups.
 * Each card links to its full table (LeagueSaturday / LeagueFestival / LeagueGroup). Rankings come
 * from the shared helpers in lib/standings.js, the same ones the Results page uses; this page only
 * lays them out. Nothing here writes to the database.
 */

import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { ukDateStr } from '../lib/format.js'
import { loadSaturdayLeague, loadMyGroups, fetchFestivalRows } from '../lib/leagueData.js'
import { loadCurrentFestival } from '../lib/festivalData.js'
import { loadMembers, loadStandings } from '../lib/groupStandings.js'
import { satHubSub, festHubSub, previewRows, allZero } from '../lib/leagueView.js'
import { useLeagueUser } from '../components/league/useLeagueUser.js'
import PreviewCard from '../components/league/PreviewCard.jsx'
import { TableKey } from '../components/league/LeagueTable.jsx'
import GroupsList from '../components/league/GroupsList.jsx'
import PicksModalHost from '../components/league/PicksModalHost.jsx'
import PastSheet from '../components/league/PastSheet.jsx'
import { LeagueHubSkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/league.css'

// The "Past" button: finished festivals and earlier seasons (PastSheet).
const SHOW_PAST = true

// How many race weeks the Saturday League card shows.
const HUB_WEEKS = 4

const MSG_SEASON = 'No points yet – the table fills up after the first race week'
const MSG_FEST = 'No points yet – the table fills up after the first race'

export default function League() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useLeagueUser()

  const [data,     setData]     = useState(null)    // { sat, fest, groups }
  const [failed,   setFailed]   = useState(false)
  const [attempt,  setAttempt]  = useState(0)
  const [picksModal, setPicksModal] = useState(null)
  const [pastOpen, setPastOpen] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function load() {
      try {
        // Older links navigate here with { festivalTab } (e.g. "Full leaderboard" on Home).
        const wanted = location.state?.festivalTab
        if (wanted) {
          navigate(`/league/festival/${wanted}`, { replace: true })
          return
        }

        const [sat, hub, groups] = await Promise.all([
          loadSaturdayLeague(user.id, { withWeek: false }),
          loadCurrentFestival(ukDateStr(Date.now())).catch(() => null),
          loadMyGroups(user.id).catch(() => []),
        ])

        // The festival card and each group's position are extras: if one can't be read the rest still shows.
        const [fest, standings] = await Promise.all([
          hub ? fetchFestivalRows(hub.festival, null, user.id).then(r => ({ ...hub, ...r })).catch(() => null) : null,
          groups.length
            ? loadMembers(groups.map(g => g.id)).then(m => loadStandings(user.id, m)).catch(() => null)
            : null,
        ])
        if (cancelled) return
        setData({
          sat,
          fest,
          groups: groups
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(g => ({ ...g, standing: standings?.[g.id]?.me || null })),
        })
        setFailed(false)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, attempt])

  if (failed) {
    return (
      <div className="app-page lg">
        <main className="lg__main">
          <h1 className="lg-title">Leaderboard</h1>
          <p className="lg-msg">Couldn't load the leaderboard. Check your connection and try again.</p>
          <button type="button" className="lg-btn" onClick={() => { setFailed(false); setData(null); setAttempt(a => a + 1) }}>Try again</button>
        </main>
      </div>
    )
  }
  if (!data) return <LeagueHubSkeleton />

  const { sat, fest, groups } = data

  // ── Saturday League card ──
  // The last four race weeks, then TOT (the full table has every week).
  const satColumns = (sat?.satTable.columns || []).slice(-HUB_WEEKS)
  const satRows = (sat?.satTable.rows || []).map(r => ({
    ...r,
    modal: { userId: r.id, name: r.name, pts: r.points, rank: r.rank, seasonId: sat?.season?.id },
  }))

  // ── Festival card ──
  const festName = fest ? (fest.festival.display_name || fest.festival.name) : ''
  const festRows = fest ? fest.table.rows.map(r => ({
    ...r,
    modal: { userId: r.id, name: r.name, pts: r.points, rank: r.rank, festivalId: fest.festival.id, festivalName: festName },
  })) : []

  return (
    <div className="app-page lg">
      <main className="lg__main">
        <div className="lh-top">
          <h1 className="lg-title">Leaderboard</h1>
          {SHOW_PAST && (
            <button type="button" className="lh-past" onClick={() => setPastOpen(true)} aria-haspopup="dialog">
              <Clock size={13} aria-hidden="true" />
              Past
            </button>
          )}
        </div>

        <PreviewCard
          title="Saturday League"
          sub={sat ? satHubSub(sat.season, sat.completedWeeks) : ''}
          columns={satColumns}
          rows={previewRows(satRows)}
          message={!sat ? 'No season is running yet.' : allZero(satRows) ? MSG_SEASON : ''}
          to="/league/saturday"
          onPlayer={r => setPicksModal(r.modal)}
        />
        {satRows.length > 0 && <TableKey />}

        {fest && (
          <PreviewCard
            title={festName}
            sub={festHubSub(fest.rows, fest.festDays, fest.live)}
            live={fest.live}
            festival={{ banner: { url: fest.festival.banner_url, position: fest.festival.banner_position } }}
            columns={fest.table.columns}
            rows={previewRows(festRows)}
            message={!festRows.length ? 'No one has entered yet.' : allZero(festRows) ? MSG_FEST : ''}
            to={`/league/festival/${fest.festival.id}`}
            onPlayer={r => setPicksModal(r.modal)}
          />
        )}
        {festRows.length > 0 && <TableKey festival />}

        <GroupsList groups={groups} />
      </main>

      <PicksModalHost modal={picksModal} viewerUserId={user?.id} onClose={() => setPicksModal(null)} />
      {pastOpen && <PastSheet userId={user.id} excludeId={fest?.festival.id || null} onClose={() => setPastOpen(false)} />}
    </div>
  )
}
