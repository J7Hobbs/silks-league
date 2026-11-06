/**
 * Silks League — one group's table (/league/group/:groupId)
 * The group's Saturday League season table, or its members' table for the live / recent festival.
 * Uses the existing group loaders (fetchGroupSatRows, fetchFestivalRows with the member list).
 */

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ordinal, ukDateStr } from '../lib/format.js'
import {
  loadSaturdayLeague, fetchFestivalRows, fetchGroupSatRows, loadGroupMemberIds,
} from '../lib/leagueData.js'
import { loadCurrentFestival } from '../lib/festivalData.js'
import { seasonMonth, weekSubLine, festSubLine, winnersLine, weekRowsForGroup } from '../lib/leagueView.js'
import { useLeagueUser } from '../components/league/useLeagueUser.js'
import BackLink from '../components/league/BackLink.jsx'
import ViewToggle from '../components/league/ViewToggle.jsx'
import TableBody from '../components/league/TableBody.jsx'
import PicksModalHost from '../components/league/PicksModalHost.jsx'
import { LeagueSkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/league.css'

const MSG_SEASON = 'No points yet – the table fills up after the first race week'
const MSG_WEEK = 'No points yet this week – the table fills up after the first race'
const MSG_FEST = 'No points yet – the table fills up after the first race'
const VIEWS = [{ key: 'week', label: 'This week' }, { key: 'season', label: 'Season' }]

export default function LeagueGroup() {
  const { groupId } = useParams()
  const user = useLeagueUser()
  const [data, setData] = useState(undefined)   // undefined = loading, null = not found / not a member
  const [tab, setTab] = useState('saturday')    // 'saturday' | 'festival'
  const [view, setView] = useState('season')    // 'week' | 'season' (Saturday League)
  const [picksModal, setPicksModal] = useState(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      try {
        const [{ data: group }, memberIds, sat, hub] = await Promise.all([
          supabase.from('groups').select('id, name').eq('id', groupId).maybeSingle(),
          loadGroupMemberIds(groupId),
          loadSaturdayLeague(user.id),
          loadCurrentFestival(ukDateStr(Date.now())).catch(() => null),
        ])
        if (!group || !memberIds.includes(user.id)) { if (!cancelled) setData(null); return }
        const [satRows, fest] = await Promise.all([
          fetchGroupSatRows(memberIds, user.id),
          hub ? fetchFestivalRows(hub.festival, memberIds, user.id).catch(() => null) : null,
        ])
        if (!cancelled) setData({ group, memberCount: memberIds.length, sat, satRows, festival: hub?.festival || null, fest })
      } catch {
        if (!cancelled) setData(null)
      }
    })()
    return () => { cancelled = true }
  }, [user, groupId])

  if (data === undefined) return <LeagueSkeleton />

  if (!data) {
    return (
      <div className="app-page lg">
        <main className="lg__main">
          <BackLink />
          <h1 className="lg-title">Group</h1>
          <p className="lg-msg">We couldn't find that group.</p>
        </main>
      </div>
    )
  }

  const { group, memberCount, sat, satRows, festival, fest } = data
  const festName = festival ? (festival.display_name || festival.name) : ''
  const showFest = !!festival && !!fest && tab === 'festival'
  const completedWeeks = sat?.completedWeeks || []
  const month = seasonMonth(sat?.season)

  let rows, caption, message
  if (showFest) {
    caption = `${group.name} · ${festName}`
    message = MSG_FEST
    rows = fest.rows.map(r => ({
      id: r.userId, rank: r.rank, name: r.name, isMe: r.isMe, points: r.points,
      sub: festSubLine(r.dayPts, fest.festDays),
      modal: { userId: r.userId, name: r.name, pts: r.points, rank: r.rank, festivalId: festival.id, festivalName: festName },
    }))
  } else if (view === 'week') {
    const weekLabel = sat?.currentWeek?.week_number ? `Week ${sat.currentWeek.week_number}` : 'This week'
    caption = `${group.name} · ${weekLabel}`
    message = MSG_WEEK
    rows = weekRowsForGroup(sat?.weekRows || [], satRows).map(r => ({
      id: r.user_id, rank: r.rank, name: r.name, isMe: r.isMe, points: r.weekPoints,
      sub: winnersLine(r.winners || 0),
      modal: { userId: r.user_id, name: r.name, pts: r.weekPoints, rank: r.rank },
    }))
  } else {
    caption = month ? `${group.name} · ${month}` : group.name
    message = MSG_SEASON
    rows = satRows.map(r => ({
      id: r.userId, rank: r.rank, name: r.name, isMe: r.isMe, points: r.points,
      sub: weekSubLine(r.weekPts, completedWeeks),
      modal: { userId: r.userId, name: r.name, pts: r.points, rank: r.rank },
    }))
  }
  const me = rows.find(r => r.isMe)
  const players = `${memberCount} ${memberCount === 1 ? 'player' : 'players'}`

  return (
    <div className="app-page lg">
      <main className="lg__main">
        <BackLink />
        <div className="lg-ghead">
          <h1 className="lg-ghead__name">{group.name}</h1>
          <p className="lg-ghead__sub">{me ? `${players} · you're ${ordinal(me.rank)}` : players}</p>
        </div>

        {festival && fest && (
          <ViewToggle
            items={[{ key: 'saturday', label: 'Saturday League' }, { key: 'festival', label: festName }]}
            value={tab}
            onChange={setTab}
          />
        )}

        {!showFest && <ViewToggle items={VIEWS} value={view} onChange={setView} />}

        <TableBody rows={rows} caption={caption} message={message} festival={showFest} onPlayer={r => setPicksModal(r.modal)} />

        {memberCount === 1 && (
          <p className="lg-msg">Invite your mates from Groups in the account menu</p>
        )}
      </main>
      <PicksModalHost modal={picksModal} viewerUserId={user?.id} onClose={() => setPicksModal(null)} />
    </div>
  )
}
