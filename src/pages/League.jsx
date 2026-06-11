/**
 * Silks League — League Page
 * Multi-tab leaderboard: Saturday · Festival(s) · Group(s)
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ProfileDropdown from '../components/ProfileDropdown.jsx'
import PlayerPicksModal from '../components/PlayerPicksModal.jsx'
import { Home, Target, Trophy, BarChart2 } from 'lucide-react'

export default function League() {
  const navigate = useNavigate()

  // ── Core ──────────────────────────────────────────────────────
  const [user,    setUser]    = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  // ── Saturday League ───────────────────────────────────────────
  const [season,      setSeason]      = useState(null)
  const [currentWeek, setCurrentWeek] = useState(null)
  const [satRows,     setSatRows]     = useState([])
  const [weekRows,    setWeekRows]    = useState([])
  const [satSubTab,   setSatSubTab]   = useState('season')

  // ── Tab state ─────────────────────────────────────────────────
  const [mainTab,    setMainTab]    = useState('saturday')
  const [festivals,  setFestivals]  = useState([])
  const [myGroups,   setMyGroups]   = useState([])

  // ── Festival leaderboards (lazy, keyed by fest.id) ────────────
  const [festData, setFestData] = useState({})
  // shape: { [festId]: { rows: [], loading: bool, loaded: bool } }

  // ── Group data (lazy, keyed by group.id) ─────────────────────
  const [groupData, setGroupData] = useState({})
  // shape: { [groupId]: { satRows, festRows: { [festId]: [] }, subTab, loading, loaded } }

  // ── Picks modal ───────────────────────────────────────────────
  const [picksModal, setPicksModal] = useState(null)

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { navigate('/auth'); return }
    setUser(u)
    const { data: profile } = await supabase
      .from('profiles').select('is_admin').eq('id', u.id).single()
    setIsAdmin(profile?.is_admin || false)
    await Promise.all([
      loadSaturdayLeague(u.id),
      loadFestivals(),
      loadMyGroups(u.id),
    ])
    setLoading(false)
  }

  // ── Saturday League ───────────────────────────────────────────
  async function loadSaturdayLeague(myUserId) {
    const { data: s } = await supabase
      .from('seasons').select('id, name').eq('is_active', true).single()
    if (!s) return
    setSeason(s)

    const { data: weeks } = await supabase
      .from('race_weeks').select('id, week_number, saturday_date')
      .eq('season_id', s.id).order('saturday_date', { ascending: false })
    const latestWeek = weeks?.[0] || null
    setCurrentWeek(latestWeek)

    const weekIds = (weeks || []).map(w => w.id)
    let allRaceIds = [], weekRaceIds = [], raceWeekMap = {}
    if (weekIds.length) {
      const { data: allRaces } = await supabase
        .from('races').select('id, race_week_id').in('race_week_id', weekIds)
      if (allRaces?.length) {
        allRaceIds  = allRaces.map(r => r.id)
        weekRaceIds = latestWeek
          ? allRaces.filter(r => r.race_week_id === latestWeek.id).map(r => r.id)
          : []
        allRaces.forEach(r => { raceWeekMap[r.id] = r.race_week_id })
      }
    }

    const ownQuery = allRaceIds.length
      ? supabase.from('scores').select('user_id, race_id, total_points').eq('user_id', myUserId).in('race_id', allRaceIds)
      : supabase.from('scores').select('user_id, race_id, total_points').eq('user_id', myUserId)
    const { data: ownScores } = await ownQuery

    let allScores = []
    if (allRaceIds.length) {
      const { data: everyone, error: evErr } = await supabase
        .from('scores').select('user_id, race_id, total_points').in('race_id', allRaceIds)
      if (!evErr && everyone?.length) allScores = everyone
    } else {
      const { data: everyone, error: evErr } = await supabase
        .from('scores').select('user_id, race_id, total_points')
      if (!evErr && everyone?.length) allScores = everyone
    }

    const scores = allScores.length ? allScores : (ownScores || [])
    const allUserIds = [...new Set([...scores.map(sc => sc.user_id), myUserId])]
    const { data: profData } = await supabase
      .rpc('get_user_names', { user_ids: allUserIds })
    const nameMap = {}
    profData?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

    const seasonScores = allRaceIds.length
      ? scores.filter(sc => allRaceIds.includes(sc.race_id))
      : scores
    const byUser = {}
    seasonScores.forEach(sc => {
      if (!byUser[sc.user_id]) {
        byUser[sc.user_id] = {
          user_id: sc.user_id,
          name: nameMap[sc.user_id] || 'Player',
          isMe: sc.user_id === myUserId,
          seasonTotal: 0, weeksPlayed: new Set(), weekPoints: 0,
        }
      }
      byUser[sc.user_id].seasonTotal += (sc.total_points || 0)
      const wId = raceWeekMap[sc.race_id]
      if (wId) byUser[sc.user_id].weeksPlayed.add(wId)
      if (weekRaceIds.includes(sc.race_id)) byUser[sc.user_id].weekPoints += (sc.total_points || 0)
    })
    if (!byUser[myUserId] && ownScores?.length) {
      const mySeasonTotal = ownScores.reduce((s, sc) => s + (sc.total_points || 0), 0)
      const myWeekPoints  = ownScores.filter(sc => weekRaceIds.includes(sc.race_id))
        .reduce((s, sc) => s + (sc.total_points || 0), 0)
      byUser[myUserId] = {
        user_id: myUserId, name: nameMap[myUserId] || 'Player', isMe: true,
        seasonTotal: mySeasonTotal, weeksPlayed: new Set(), weekPoints: myWeekPoints,
      }
      ownScores.forEach(sc => { const wId = raceWeekMap[sc.race_id]; if (wId) byUser[myUserId].weeksPlayed.add(wId) })
    }

    const seasonSorted = Object.values(byUser)
      .sort((a, b) => b.seasonTotal - a.seasonTotal || a.name.localeCompare(b.name))
      .slice(0, 30)
      .map((u, i) => ({ ...u, rank: i + 1, weeksPlayed: u.weeksPlayed.size }))
    setSatRows(seasonSorted)

    const weekByUser = {}
    scores.filter(sc => weekRaceIds.includes(sc.race_id)).forEach(sc => {
      if (!weekByUser[sc.user_id]) {
        weekByUser[sc.user_id] = {
          user_id: sc.user_id,
          name: nameMap[sc.user_id] || 'Player',
          isMe: sc.user_id === myUserId, weekPoints: 0, racesScored: 0,
        }
      }
      weekByUser[sc.user_id].weekPoints  += (sc.total_points || 0)
      weekByUser[sc.user_id].racesScored += 1
    })
    if (!weekByUser[myUserId] && ownScores?.length) {
      const myWeekScores = ownScores.filter(sc => weekRaceIds.includes(sc.race_id))
      if (myWeekScores.length) {
        weekByUser[myUserId] = {
          user_id: myUserId, name: nameMap[myUserId] || 'Player', isMe: true,
          weekPoints: myWeekScores.reduce((s, sc) => s + (sc.total_points || 0), 0),
          racesScored: myWeekScores.length,
        }
      }
    }
    const weekSorted = Object.values(weekByUser)
      .sort((a, b) => b.weekPoints - a.weekPoints || a.name.localeCompare(b.name))
      .map((u, i) => ({ ...u, rank: i + 1 }))
    setWeekRows(weekSorted)
  }

  // ── Festivals ─────────────────────────────────────────────────
  async function loadFestivals() {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const { data } = await supabase
      .from('festivals').select('*')
      .or(`is_active.eq.true,end_date.gte.${cutoff}`)
      .order('start_date')
    setFestivals(data || [])
  }

  // ── My Groups ─────────────────────────────────────────────────
  async function loadMyGroups(userId) {
    const { data: memberships } = await supabase
      .from('group_members')
      .select('is_founder, groups(id, name, invite_code, created_by)')
      .eq('user_id', userId)
    if (!memberships?.length) { setMyGroups([]); return }
    const enriched = await Promise.all(
      memberships.map(async m => {
        const g = m.groups
        const { count } = await supabase
          .from('group_members').select('id', { count: 'exact', head: true }).eq('group_id', g.id)
        return { ...g, memberCount: count || 0, isFounder: m.is_founder }
      })
    )
    setMyGroups(enriched)
  }

  // ── Festival leaderboard helper ───────────────────────────────
  async function fetchFestivalRows(fest, memberIds, myUserId) {
    const { data: days } = await supabase
      .from('festival_days').select('id').eq('festival_id', fest.id)
    if (!days?.length) return []
    const { data: races } = await supabase
      .from('festival_races').select('id').in('festival_day_id', days.map(d => d.id))
    const raceIds = (races || []).map(r => r.id)

    let entriesQ = supabase.from('festival_entries')
      .select('user_id, starting_points').eq('festival_id', fest.id)
    if (memberIds?.length) entriesQ = entriesQ.in('user_id', memberIds)
    const { data: entries } = await entriesQ
    if (!entries?.length) return []

    const entryUserIds = entries.map(e => e.user_id)
    let scoresData = []
    if (raceIds.length) {
      const { data: sc } = await supabase
        .from('festival_scores').select('user_id, total_points')
        .in('festival_race_id', raceIds).in('user_id', entryUserIds)
      scoresData = sc || []
    }

    const totals = {}
    for (const e of entries) totals[e.user_id] = (e.starting_points || 0)
    for (const s of scoresData) {
      if (totals[s.user_id] !== undefined) totals[s.user_id] += (s.total_points || 0)
    }

    const festProfileIds = [...new Set([...entryUserIds, myUserId])]
    const { data: profiles } = await supabase
      .rpc('get_user_names', { user_ids: festProfileIds })
    const nameMap = {}
    profiles?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .map(([uid, pts], i) => ({
        rank: i + 1, userId: uid, points: pts,
        name: nameMap[uid] || 'Player',
        isMe: uid === myUserId,
      }))
  }

  // ── Group Saturday helper ─────────────────────────────────────
  async function fetchGroupSatRows(memberIds, myUserId) {
    const { data: season } = await supabase
      .from('seasons').select('id').eq('is_active', true).single()
    if (!season) return []
    const { data: weeks } = await supabase
      .from('race_weeks').select('id').eq('season_id', season.id)
    const weekIds = (weeks || []).map(w => w.id)
    if (!weekIds.length) return []
    const { data: races } = await supabase
      .from('races').select('id').in('race_week_id', weekIds)
    const raceIds = (races || []).map(r => r.id)
    if (!raceIds.length) return memberIds.map((uid, i) => ({ rank: i + 1, userId: uid, points: 0, name: 'Player', isMe: uid === myUserId }))

    const { data: scores } = await supabase
      .from('scores').select('user_id, total_points')
      .in('race_id', raceIds).in('user_id', memberIds)
    const totals = {}
    for (const uid of memberIds) totals[uid] = 0
    for (const s of (scores || [])) totals[s.user_id] = (totals[s.user_id] || 0) + s.total_points

    const groupProfileIds = [...new Set([...memberIds, myUserId])]
    const { data: profiles } = await supabase
      .rpc('get_user_names', { user_ids: groupProfileIds })
    const nameMap = {}
    profiles?.forEach(p => { nameMap[p.id] = p.username || p.full_name || null })

    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .map(([uid, pts], i) => ({
        rank: i + 1, userId: uid, points: pts,
        name: nameMap[uid] || 'Player',
        isMe: uid === myUserId,
      }))
  }

  // ── Main tab click ────────────────────────────────────────────
  async function handleMainTab(tabId) {
    setMainTab(tabId)
    const myUserId = user?.id
    if (tabId === 'saturday') return

    // Festival tab
    const fest = festivals.find(f => f.id === tabId)
    if (fest) {
      if (!festData[tabId]?.loaded && !festData[tabId]?.loading) {
        setFestData(prev => ({ ...prev, [tabId]: { rows: [], loading: true, loaded: false } }))
        const rows = await fetchFestivalRows(fest, null, myUserId)
        setFestData(prev => ({ ...prev, [tabId]: { rows, loading: false, loaded: true } }))
      }
      return
    }

    // Group tab
    const group = myGroups.find(g => g.id === tabId)
    if (group && !groupData[tabId]?.loaded && !groupData[tabId]?.loading) {
      setGroupData(prev => ({ ...prev, [tabId]: { loading: true, loaded: false, subTab: 'saturday', satRows: [], festRows: {} } }))
      // Get member IDs
      const { data: members } = await supabase
        .from('group_members').select('user_id').eq('group_id', group.id)
      const memberIds = (members || []).map(m => m.user_id)

      // Load sat + all active festival rows in parallel
      const [gSatRows, ...festRowsArr] = await Promise.all([
        fetchGroupSatRows(memberIds, myUserId),
        ...festivals.map(f => fetchFestivalRows(f, memberIds, myUserId)),
      ])
      const gFestRows = {}
      festivals.forEach((f, i) => { gFestRows[f.id] = festRowsArr[i] || [] })

      setGroupData(prev => ({
        ...prev,
        [tabId]: { loading: false, loaded: true, subTab: 'saturday', satRows: gSatRows, festRows: gFestRows, memberIds },
      }))
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  function festStatus(fest) {
    const now = new Date()
    const end = new Date(fest.end_date + 'T23:59:59')
    return now <= end ? 'Live' : 'Completed'
  }

  function formatDateRange(fest) {
    const opts = { day: 'numeric', month: 'short' }
    const s = new Date(fest.start_date + 'T12:00:00').toLocaleDateString('en-GB', opts)
    const e = new Date(fest.end_date   + 'T12:00:00').toLocaleDateString('en-GB', opts)
    return `${s} – ${e}`
  }

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={st.loadingPage}>
        <div style={st.loadingInner}>
          <div style={st.loadingLogo}>Silks League</div>
          <div style={st.loadingText}>Loading league…</div>
        </div>
      </div>
    )
  }

  // ── Computed active tab data ───────────────────────────────────
  const isSatTab    = mainTab === 'saturday'
  const activeFest  = festivals.find(f => f.id === mainTab)
  const activeGroup = myGroups.find(g => g.id === mainTab)
  const currentGroupData = activeGroup ? groupData[activeGroup.id] : null

  // Saturday display rows
  const satDisplayRows = satSubTab === 'season' ? satRows : weekRows

  // Group display rows
  let groupDisplayRows = []
  if (currentGroupData?.loaded) {
    const gSubTab = currentGroupData.subTab
    if (gSubTab === 'saturday') {
      groupDisplayRows = currentGroupData.satRows || []
    } else {
      groupDisplayRows = currentGroupData.festRows?.[gSubTab] || []
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={st.page}>

      {/* ── Nav ── */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>
          <div style={st.navLinks} className="app-nav-links">
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={st.navLink}>My Picks</a>
            <a href="/league"    style={{ ...st.navLink, ...st.navLinkActive }}>League</a>
            <a href="/results"   style={st.navLink}>Results</a>
          </div>
          <div style={st.navRight}>
            <ProfileDropdown user={user} isAdmin={isAdmin} />
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main style={st.main} className="app-main-pad">

        {/* Page heading */}
        <div style={st.pageHeadRow}>
          <div>
            <h1 style={st.heading}>League</h1>
            <p style={st.sub}>{season?.name || 'Current Season'}</p>
          </div>
        </div>

        {/* ── Outer scrollable tab bar ── */}
        <div style={st.outerTabBar}>
          {/* Saturday League */}
          <button
            style={{ ...st.outerTab, ...(mainTab === 'saturday' ? st.outerTabActive : {}) }}
            onClick={() => handleMainTab('saturday')}>
            🏇 Saturday League
          </button>

          {/* Festival tabs */}
          {festivals.map(fest => (
            <button
              key={fest.id}
              style={{ ...st.outerTab, ...(mainTab === fest.id ? st.outerTabActive : {}) }}
              onClick={() => handleMainTab(fest.id)}>
              👑 {fest.display_name || fest.name}
            </button>
          ))}

          {/* Group tabs */}
          {myGroups.map(group => (
            <button
              key={group.id}
              style={{ ...st.outerTab, ...(mainTab === group.id ? st.outerTabActive : {}) }}
              onClick={() => handleMainTab(group.id)}>
              {group.name}
            </button>
          ))}
        </div>

        {/* ══════════════ SATURDAY LEAGUE TAB ══════════════ */}
        {isSatTab && (
          <>
            {/* Season / This Week inner tabs */}
            <div style={st.innerTabRow}>
              <button
                style={{ ...st.innerTab, ...(satSubTab === 'season' ? st.innerTabActive : {}) }}
                onClick={() => setSatSubTab('season')}>
                Season Standings
              </button>
              <button
                style={{ ...st.innerTab, ...(satSubTab === 'week' ? st.innerTabActive : {}) }}
                onClick={() => setSatSubTab('week')}>
                This Week{currentWeek?.week_number ? ` · Wk ${currentWeek.week_number}` : ''}
              </button>
            </div>

            {/* Leaderboard card */}
            <LeaderboardCard
              rows={satDisplayRows}
              mode={satSubTab}
              onPlayerClick={row => setPicksModal({
                userId: row.user_id,
                name: row.name,
                pts: satSubTab === 'season' ? row.seasonTotal : row.weekPoints,
                rank: row.rank,
              })}
            />
          </>
        )}

        {/* ══════════════ FESTIVAL TAB ══════════════ */}
        {activeFest && (
          <>
            {/* Compact festival banner */}
            <div style={st.festBanner}>
              <div style={st.festBannerLeft}>
                <div style={st.festBannerName}>
                  👑 {(activeFest.display_name || activeFest.name).toUpperCase()}
                </div>
                <div style={st.festBannerDates}>{formatDateRange(activeFest)}</div>
              </div>
              <div style={{
                ...st.festStatusPill,
                ...(festStatus(activeFest) === 'Live' ? st.festStatusLive : st.festStatusDone),
              }}>
                {festStatus(activeFest) === 'Live' ? '● Live' : 'Completed'}
              </div>
            </div>

            {/* Leaderboard */}
            {festData[activeFest.id]?.loading ? (
              <div style={st.loadingInline}>Loading standings…</div>
            ) : (
              <FestivalLeaderboardCard
                rows={festData[activeFest.id]?.rows || []}
                onPlayerClick={row => setPicksModal({
                  userId: row.userId,
                  name: row.name,
                  pts: row.points,
                  rank: row.rank,
                })}
              />
            )}
          </>
        )}

        {/* ══════════════ GROUP TAB ══════════════ */}
        {activeGroup && (
          <>
            {/* Group header */}
            <div style={st.groupHeader}>
              <div style={st.groupHeaderLeft}>
                <div style={st.groupName}>{activeGroup.name}</div>
                <div style={st.groupMeta}>{activeGroup.memberCount} member{activeGroup.memberCount !== 1 ? 's' : ''}</div>
              </div>
              <button
                style={st.manageLink}
                onClick={() => navigate('/groups')}>
                Manage →
              </button>
            </div>

            {currentGroupData?.loading ? (
              <div style={st.loadingInline}>Loading group standings…</div>
            ) : currentGroupData?.loaded ? (
              <>
                {/* Group inner sub-tabs */}
                <div style={st.innerTabRow}>
                  <button
                    style={{ ...st.innerTab, ...(currentGroupData.subTab === 'saturday' ? st.innerTabActive : {}) }}
                    onClick={() => setGroupData(prev => ({
                      ...prev,
                      [activeGroup.id]: { ...prev[activeGroup.id], subTab: 'saturday' },
                    }))}>
                    Saturday
                  </button>
                  {festivals.map(fest => (
                    <button
                      key={fest.id}
                      style={{ ...st.innerTab, ...(currentGroupData.subTab === fest.id ? st.innerTabActive : {}) }}
                      onClick={() => setGroupData(prev => ({
                        ...prev,
                        [activeGroup.id]: { ...prev[activeGroup.id], subTab: fest.id },
                      }))}>
                      {fest.display_name || fest.name} 👑
                    </button>
                  ))}
                </div>

                {/* Group leaderboard */}
                <FestivalLeaderboardCard
                  rows={groupDisplayRows}
                  onPlayerClick={row => setPicksModal({
                    userId: row.userId,
                    name: row.name,
                    pts: row.points,
                    rank: row.rank,
                  })}
                />
              </>
            ) : null}
          </>
        )}

        {/* CTA */}
        <div style={st.ctaStrip}>
          <button style={st.ctaBtn} onClick={() => navigate('/picks')}>
            Make your picks →
          </button>
        </div>

      </main>

      {/* ── Mobile bar ── */}
      <nav style={st.mobileBar} className="app-mobile-bar">
        <a href="/dashboard" style={st.mobileBarItem}>
          <Home size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={st.mobileBarItem}>
          <Target size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Picks</span>
        </a>
        <a href="/league" style={{ ...st.mobileBarItem, ...st.mobileBarItemActive }}>
          <Trophy size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>League</span>
          <span style={st.mobileDot} />
        </a>
        <a href="/results" style={st.mobileBarItem}>
          <BarChart2 size={22} strokeWidth={1.5} />
          <span style={st.mobileBarLabel}>Results</span>
        </a>
      </nav>

      {/* ── Player picks modal ── */}
      {picksModal && (
        <PlayerPicksModal
          userId={picksModal.userId}
          viewerUserId={user?.id}
          displayName={picksModal.name}
          seasonPoints={picksModal.pts}
          seasonRank={picksModal.rank}
          onClose={() => setPicksModal(null)}
        />
      )}

    </div>
  )
}

// ── Saturday leaderboard card ─────────────────────────────────
function LeaderboardCard({ rows, mode, onPlayerClick }) {
  if (!rows.length) {
    return (
      <div style={st.card}>
        <div style={st.empty}>No scores yet — check back after results are in.</div>
      </div>
    )
  }
  const isSeason = mode === 'season'
  return (
    <div style={st.card}>
      {/* Header row */}
      <div style={st.tableHeader} className="league-row">
        <span style={{ minWidth: '40px' }}>#</span>
        <span style={{ flex: 1 }}>Player</span>
        {isSeason ? (
          <>
            <span style={st.colRight} className="league-col-data">Wks</span>
            <span style={st.colRight} className="league-col-data league-hide-mobile">This Wk</span>
            <span style={st.colRight} className="league-col-data">Total</span>
          </>
        ) : (
          <>
            <span style={st.colRight} className="league-col-data">Races</span>
            <span style={st.colRight} className="league-col-data">Points</span>
          </>
        )}
      </div>
      {rows.map((row, idx) => (
        <div
          key={row.user_id}
          className="league-row"
          style={{ ...st.row, ...(row.isMe ? st.rowMe : {}), ...(idx < rows.length - 1 ? {} : st.rowLast) }}>
          <div style={st.rankCell}>
            {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
              <span style={st.rankNum}>{row.rank}</span>
            )}
          </div>
          <div style={st.nameCell}>
            <span
              style={{ ...st.playerName, ...(row.isMe ? st.playerNameMe : {}), cursor: 'pointer', textDecoration: 'underline dotted' }}
              onClick={() => onPlayerClick(row)}>
              {row.name}
            </span>
            {row.isMe && <span style={st.youBadge}>You</span>}
          </div>
          {isSeason ? (
            <>
              <div style={st.dataCell} className="league-col-data">{row.weeksPlayed}</div>
              <div style={st.dataCell} className="league-col-data league-hide-mobile">
                {row.weekPoints > 0 ? `+${row.weekPoints}` : row.weekPoints}
              </div>
              <div style={{ ...st.dataCell, ...st.totalCell }} className="league-col-data">{row.seasonTotal}</div>
            </>
          ) : (
            <>
              <div style={st.dataCell} className="league-col-data">{row.racesScored}</div>
              <div style={{ ...st.dataCell, ...st.totalCell }} className="league-col-data">{row.weekPoints}</div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Festival / Group leaderboard card (points only) ───────────
function FestivalLeaderboardCard({ rows, onPlayerClick }) {
  if (!rows.length) {
    return (
      <div style={st.card}>
        <div style={st.empty}>No entries yet.</div>
      </div>
    )
  }
  return (
    <div style={st.card}>
      <div style={st.tableHeader} className="league-row">
        <span style={{ minWidth: '40px' }}>#</span>
        <span style={{ flex: 1 }}>Player</span>
        <span style={st.colRight}>Points</span>
      </div>
      {rows.map((row, idx) => (
        <div
          key={row.userId}
          className="league-row"
          style={{ ...st.row, ...(row.isMe ? st.rowMe : {}), ...(idx < rows.length - 1 ? {} : st.rowLast) }}>
          <div style={st.rankCell}>
            {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
              <span style={st.rankNum}>{row.rank}</span>
            )}
          </div>
          <div style={st.nameCell}>
            <span
              style={{ ...st.playerName, ...(row.isMe ? st.playerNameMe : {}), cursor: 'pointer', textDecoration: 'underline dotted' }}
              onClick={() => onPlayerClick(row)}>
              {row.name}
            </span>
            {row.isMe && <span style={st.youBadge}>You</span>}
          </div>
          <div style={{ ...st.dataCell, ...st.totalCell }}>{row.points}</div>
        </div>
      ))}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────
const st = {
  page: { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '5rem' },
  loadingPage: { minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loadingInner: { textAlign: 'center' },
  loadingLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#c9a84c', letterSpacing: '0.12em', marginBottom: '0.5rem' },
  loadingText: { color: '#5a8a5a', fontSize: '0.9rem' },
  loadingInline: { textAlign: 'center', color: '#5a8a5a', padding: '2.5rem 1rem', fontSize: '0.875rem' },

  // Nav
  nav: { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  navInner: { maxWidth: '900px', margin: '0 auto', padding: '0 1.5rem', height: '60px', display: 'flex', alignItems: 'center', gap: '2rem' },
  navLogo: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0 },
  navLinks: { display: 'flex', gap: '0.25rem', flex: 1 },
  navLink: { padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: '500', color: '#5a8a5a', textDecoration: 'none' },
  navLinkActive: { color: '#e8f0e8', background: 'rgba(201,168,76,0.1)' },
  navRight: { marginLeft: 'auto', position: 'relative' },

  // Main
  main: { maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  pageHeadRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  heading: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.6rem', color: '#e8f0e8', letterSpacing: '0.03em', margin: 0, lineHeight: 1 },
  sub: { marginTop: '0.4rem', fontSize: '0.9rem', color: '#5a8a5a' },

  // Outer tab bar — scrollable pills
  outerTabBar: {
    display: 'flex', gap: '0.4rem',
    overflowX: 'auto', paddingBottom: '2px',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  },
  outerTab: {
    flexShrink: 0,
    padding: '0.5rem 1.1rem',
    borderRadius: '20px',
    fontSize: '0.85rem', fontWeight: '600',
    background: 'rgba(255,255,255,0.04)',
    border: '1.5px solid rgba(201,168,76,0.15)',
    color: 'rgba(232,240,232,0.4)',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap', transition: 'all 0.15s',
  },
  outerTabActive: {
    background: 'rgba(201,168,76,0.12)',
    border: '1.5px solid #c9a84c',
    color: '#c9a84c',
  },

  // Inner tabs (season/week, saturday/festival within group)
  innerTabRow: {
    display: 'flex', gap: '0.35rem',
    overflowX: 'auto', scrollbarWidth: 'none',
  },
  innerTab: {
    padding: '0.45rem 1rem',
    borderRadius: '7px', fontSize: '0.82rem', fontWeight: '600',
    background: 'none',
    border: '1px solid rgba(201,168,76,0.12)',
    color: '#5a8a5a',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap', transition: 'all 0.15s',
  },
  innerTabActive: {
    background: 'rgba(201,168,76,0.1)',
    border: '1px solid rgba(201,168,76,0.3)',
    color: '#c9a84c',
  },

  // Festival banner
  festBanner: {
    background: 'linear-gradient(135deg, #1a3512 0%, #0f2a0a 100%)',
    border: '1.5px solid rgba(201,168,76,0.4)',
    borderRadius: '8px', padding: '0.9rem 1.25rem',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
  },
  festBannerLeft: {},
  festBannerName: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.1rem', color: '#e8f0e8',
    letterSpacing: '0.05em', lineHeight: 1,
  },
  festBannerDates: { fontSize: '0.78rem', color: 'rgba(232,240,232,0.5)', marginTop: '0.2rem' },
  festStatusPill: {
    fontSize: '0.72rem', fontWeight: '700', padding: '0.25rem 0.6rem',
    borderRadius: '20px', letterSpacing: '0.04em', flexShrink: 0,
  },
  festStatusLive: { background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' },
  festStatusDone: { background: 'rgba(201,168,76,0.1)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.3)' },

  // Group header
  groupHeader: {
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    border: '1.5px solid rgba(201,168,76,0.3)',
    borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', padding: '1rem 1.25rem',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  groupHeaderLeft: {},
  groupName: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#e8f0e8', letterSpacing: '0.04em', lineHeight: 1 },
  groupMeta: { fontSize: '0.78rem', color: '#5a8a5a', marginTop: '0.2rem' },
  manageLink: {
    background: 'none', border: 'none',
    color: '#c9a84c', fontSize: '0.82rem', fontWeight: '600',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
    padding: '0.4rem 0.75rem',
    borderRadius: '6px',
    border: '1px solid rgba(201,168,76,0.25)',
  },

  // Leaderboard card
  card: {
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c',
    borderRadius: '8px', overflow: 'hidden',
  },
  empty: { padding: '3rem 2rem', textAlign: 'center', color: '#5a8a5a', fontSize: '0.9rem' },
  tableHeader: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.75rem 1.5rem',
    background: 'rgba(0,0,0,0.25)',
    borderBottom: '1px solid rgba(201,168,76,0.2)',
    fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#5a8a5a',
  },
  colRight: { minWidth: '60px', textAlign: 'right' },
  row: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.9rem 1.5rem',
    borderBottom: '1px solid rgba(201,168,76,0.1)',
    transition: 'background 0.15s',
  },
  rowLast: { borderBottom: 'none' },
  rowMe: {
    background: 'rgba(201,168,76,0.05)',
    borderLeft: '4px solid #c9a84c',
    paddingLeft: 'calc(1.5rem - 4px)',
  },
  rankCell: { minWidth: '40px', fontSize: '1.1rem', textAlign: 'center' },
  rankNum:  { fontSize: '0.85rem', color: '#5a8a5a', fontWeight: '600' },
  nameCell: { flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' },
  playerName: { fontSize: '0.95rem', fontWeight: '500', color: '#e8f0e8' },
  playerNameMe: { color: '#c9a84c' },
  youBadge: {
    fontSize: '0.62rem', fontWeight: '700', letterSpacing: '0.06em',
    background: 'rgba(201,168,76,0.15)', color: '#c9a84c',
    padding: '0.15rem 0.45rem', borderRadius: '4px',
  },
  dataCell: { minWidth: '60px', textAlign: 'right', fontSize: '0.9rem', color: '#5a8a5a' },
  totalCell: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem',
    color: '#c9a84c', letterSpacing: '0.03em',
  },

  // CTA
  ctaStrip: { display: 'flex' },
  ctaBtn: {
    flex: 1, padding: '0.85rem', background: '#c9a84c', color: '#0a1a08',
    border: 'none', borderRadius: '10px', fontSize: '0.9rem', fontWeight: '700',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
  },

  // Mobile bar
  mobileBar: { display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)', padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around' },
  mobileBarItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '0.3rem 0', color: 'rgba(232,220,200,0.4)', textDecoration: 'none', flex: 1 },
  mobileBarItemActive: { color: '#c9a84c' },
  mobileBarLabel: { fontSize: '10px', fontWeight: '500' },
  mobileDot: { width: '4px', height: '4px', borderRadius: '50%', background: '#c9a84c', marginTop: '1px' },
}
