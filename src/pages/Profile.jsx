/**
 * Silks League — Profile Page
 *
 * ── SQL to run once in Supabase SQL Editor ───────────────────────────────────
 *
 *   -- Add display_name to profiles:
 *   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
 *
 *   -- Groups tables (if not yet created):
 *   CREATE TABLE IF NOT EXISTS groups (
 *     id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     name        text NOT NULL,
 *     invite_code text UNIQUE DEFAULT substring(gen_random_uuid()::text, 1, 8),
 *     created_by  uuid REFERENCES auth.users(id),
 *     created_at  timestamptz DEFAULT now()
 *   );
 *   CREATE TABLE IF NOT EXISTS group_members (
 *     id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     group_id   uuid REFERENCES groups(id) ON DELETE CASCADE,
 *     user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 *     is_founder boolean DEFAULT false,
 *     joined_at  timestamptz DEFAULT now(),
 *     UNIQUE(group_id, user_id)
 *   );
 *   ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
 *   ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "groups_all"        ON groups        FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
 *   CREATE POLICY "group_members_all" ON group_members FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Ordinal helper ─────────────────────────────────────────────────────────
function ordinal(n) {
  if (!n) return '—'
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Profile() {
  const navigate = useNavigate()

  // ── Nav ───────────────────────────────────────────────────────────────────
  const [user,     setUser]     = useState(null)
  const [isAdmin,  setIsAdmin]  = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading,  setLoading]  = useState(true)

  // ── Profile ───────────────────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameInput,   setNameInput]   = useState('')
  const [savingName,  setSavingName]  = useState(false)

  // ── Season / weekly ───────────────────────────────────────────────────────
  const [season,       setSeason]      = useState(null)
  const [seasonStats,  setSeasonStats] = useState({ seasonPoints: 0, rank: null, weeksPlayed: 0, bestWeek: 0 })
  const [weeklyData,   setWeeklyData]  = useState([])   // [{ week, myPoints, rank, totalPlayers }]
  const [quarterWeeks, setQuarterWeeks] = useState([])  // race_week rows in current quarter

  // ── Career ────────────────────────────────────────────────────────────────
  const [careerStats, setCareerStats] = useState({
    allTimePoints: 0, totalPicks: 0, wins: 0, places: 0,
    perfectRace: false, bestEverWeek: 0, currentStreak: 0,
  })

  // ── Groups ────────────────────────────────────────────────────────────────
  const [myGroups,       setMyGroups]       = useState([])
  const [groupData,      setGroupData]      = useState(null)   // kept for badges / public standing
  const [publicStanding, setPublicStanding] = useState(null)
  const [copySuccess,    setCopySuccess]    = useState(null)   // groupId string

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/auth'); return }
    setUser(user)

    const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setIsAdmin(prof?.is_admin || false)
    const name = prof?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Player'
    setDisplayName(name)
    setNameInput(name)

    await loadSeasonData(user.id)
    await loadCareerData(user.id)
    await loadGroupData(user.id)
    setLoading(false)
  }

  // ── Season data ───────────────────────────────────────────────────────────
  async function loadSeasonData(userId) {
    const { data: s } = await supabase.from('seasons').select('*').eq('is_active', true).single()
    if (!s) return
    setSeason(s)

    const { data: allWeeks } = await supabase
      .from('race_weeks').select('*').eq('season_id', s.id).order('saturday_date')
    if (!allWeeks?.length) return

    const qWeeks = filterQuarterWeeks(allWeeks, s)
    setQuarterWeeks(qWeeks)

    const weekIds = allWeeks.map(w => w.id)
    const { data: allRaces } = await supabase
      .from('races').select('id, race_week_id').in('race_week_id', weekIds)
    if (!allRaces?.length) return

    const allRaceIds = allRaces.map(r => r.id)
    const raceToWeek = {}
    allRaces.forEach(r => { raceToWeek[r.id] = r.race_week_id })

    // My scores
    const { data: myScores } = await supabase
      .from('scores').select('race_id, total_points')
      .eq('user_id', userId).in('race_id', allRaceIds)

    // All scores for ranking
    const { data: allScores } = await supabase
      .from('scores').select('user_id, race_id, total_points')
      .in('race_id', allRaceIds)

    // ── Season totals per user ────────────────────────────────────────────
    const userTotals = {}
    for (const sc of (allScores || [])) {
      userTotals[sc.user_id] = (userTotals[sc.user_id] || 0) + sc.total_points
    }
    const mySeasonTotal = userTotals[userId] || 0
    const sortedUsers   = Object.entries(userTotals).sort((a, b) => b[1] - a[1])
    const myRank        = (sortedUsers.findIndex(([uid]) => uid === userId) + 1) || null
    const leaderTotal   = sortedUsers[0]?.[1] || 0
    setPublicStanding({
      rank:                myRank,
      total:               sortedUsers.length,
      pointsBehindLeader:  myRank === 1 ? 0 : Math.max(0, leaderTotal - mySeasonTotal),
    })

    // ── My points per week ────────────────────────────────────────────────
    const myWeekPoints = {}
    for (const sc of (myScores || [])) {
      const wid = raceToWeek[sc.race_id]
      if (wid) myWeekPoints[wid] = (myWeekPoints[wid] || 0) + sc.total_points
    }

    // ── All users' points per week (for weekly rank) ──────────────────────
    const weekUserMap = {}
    for (const sc of (allScores || [])) {
      const wid = raceToWeek[sc.race_id]
      if (!wid) continue
      if (!weekUserMap[wid]) weekUserMap[wid] = {}
      weekUserMap[wid][sc.user_id] = (weekUserMap[wid][sc.user_id] || 0) + sc.total_points
    }

    // ── Build weekly display data ─────────────────────────────────────────
    const wd = allWeeks.map(week => {
      const myPts    = myWeekPoints[week.id] || 0
      const wkUsers  = weekUserMap[week.id] || {}
      const wkSorted = Object.entries(wkUsers).sort((a, b) => b[1] - a[1])
      const wkRank   = myPts > 0 ? (wkSorted.findIndex(([uid]) => uid === userId) + 1) || null : null
      return { week, myPoints: myPts, rank: wkRank, totalPlayers: wkSorted.length }
    })
    setWeeklyData(wd)

    // ── Season stats ──────────────────────────────────────────────────────
    const weeksWithPoints = Object.values(myWeekPoints).filter(p => p > 0).length
    const weekTotals      = Object.values(myWeekPoints)
    const bestWeek        = weekTotals.length ? Math.max(...weekTotals) : 0

    // Current streak (consecutive weeks from most recent backward)
    let currentStreak = 0
    for (const week of [...allWeeks].reverse()) {
      if ((myWeekPoints[week.id] || 0) > 0) currentStreak++
      else break
    }

    setSeasonStats({ seasonPoints: mySeasonTotal, rank: myRank, weeksPlayed: weeksWithPoints, bestWeek })
    setCareerStats(prev => ({ ...prev, currentStreak }))
  }

  // ── Career data ───────────────────────────────────────────────────────────
  async function loadCareerData(userId) {
    const { data: allMyScores } = await supabase
      .from('scores').select('total_points, position_achieved, race_id')
      .eq('user_id', userId)

    const { data: allPicks } = await supabase
      .from('picks').select('id').eq('user_id', userId)

    const allTimePoints = (allMyScores || []).reduce((s, r) => s + (r.total_points || 0), 0)
    const totalPicks    = (allPicks || []).length
    const wins          = (allMyScores || []).filter(s => s.position_achieved === 1).length
    const places        = (allMyScores || []).filter(s => s.position_achieved === 2 || s.position_achieved === 3).length
    const perfectRace   = (allMyScores || []).some(s => (s.total_points || 0) >= 15)

    // Best ever week (all-time, across all seasons)
    const raceIds = [...new Set((allMyScores || []).map(s => s.race_id).filter(Boolean))]
    let bestEverWeek = 0
    if (raceIds.length) {
      const { data: raceMappings } = await supabase
        .from('races').select('id, race_week_id').in('id', raceIds)
      const raceToWeek = {}
      raceMappings?.forEach(r => { raceToWeek[r.id] = r.race_week_id })
      const weekTotals = {}
      for (const sc of (allMyScores || [])) {
        const wid = raceToWeek[sc.race_id]
        if (wid) weekTotals[wid] = (weekTotals[wid] || 0) + (sc.total_points || 0)
      }
      const vals = Object.values(weekTotals)
      bestEverWeek = vals.length ? Math.max(...vals) : 0
    }

    setCareerStats(prev => ({ ...prev, allTimePoints, totalPicks, wins, places, perfectRace, bestEverWeek }))
  }

  // ── Group data ────────────────────────────────────────────────────────────
  async function loadGroupData(userId) {
    try {
      // Load ALL group memberships for this user
      const { data: memberships } = await supabase
        .from('group_members')
        .select('is_founder, groups(id, name, invite_code)')
        .eq('user_id', userId)

      if (!memberships?.length) { setMyGroups([]); setGroupData(null); return }

      // Enrich each group with member count
      const enriched = await Promise.all(
        memberships.map(async m => {
          const g = m.groups
          const { count } = await supabase
            .from('group_members')
            .select('id', { count: 'exact', head: true })
            .eq('group_id', g.id)
          return { ...g, memberCount: count || 0, isFounder: m.is_founder }
        })
      )
      setMyGroups(enriched)

      // ── Keep single-group data for badges / public standing (use first group) ──
      const firstMembership = memberships[0]
      const group     = firstMembership.groups
      const { data: members } = await supabase
        .from('group_members').select('user_id').eq('group_id', group.id)

      const { data: season } = await supabase.from('seasons').select('id').eq('is_active', true).single()
      const memberIds = (members || []).map(m => m.user_id)
      let myGroupRank = null
      let myWeekPts   = 0

      if (season && memberIds.length) {
        const { data: weeks } = await supabase.from('race_weeks').select('id').eq('season_id', season.id)
        const weekIds = (weeks || []).map(w => w.id)
        if (weekIds.length) {
          const { data: races } = await supabase.from('races').select('id').in('race_week_id', weekIds)
          const raceIds = (races || []).map(r => r.id)
          if (raceIds.length) {
            const { data: gScores } = await supabase
              .from('scores').select('user_id, total_points').in('race_id', raceIds).in('user_id', memberIds)
            const totals = {}
            for (const s of (gScores || [])) {
              totals[s.user_id] = (totals[s.user_id] || 0) + s.total_points
            }
            const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1])
            myGroupRank = (ranked.findIndex(([uid]) => uid === userId) + 1) || 1

            const { data: latestWeek } = await supabase
              .from('race_weeks').select('id').eq('season_id', season.id)
              .order('saturday_date', { ascending: false }).limit(1)
            if (latestWeek?.[0]) {
              const { data: latestRaces } = await supabase
                .from('races').select('id').eq('race_week_id', latestWeek[0].id)
              const latestRaceIds = (latestRaces || []).map(r => r.id)
              if (latestRaceIds.length) {
                const { data: wkScores } = await supabase
                  .from('scores').select('total_points').in('race_id', latestRaceIds).eq('user_id', userId)
                myWeekPts = (wkScores || []).reduce((s, r) => s + r.total_points, 0)
              }
            }
          }
        }
      }

      setGroupData({ group, members: members || [], myRank: myGroupRank, isFounder: firstMembership.is_founder, myWeekPts })
    } catch {
      setMyGroups([])
      setGroupData(null)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function filterQuarterWeeks(weeks, season) {
    if (!season?.quarter || !season?.year) return weeks
    const ranges = { Q1: [0, 2], Q2: [3, 5], Q3: [6, 8], Q4: [9, 11] }
    const [start, end] = ranges[season.quarter] || [0, 11]
    return weeks.filter(w => {
      const d = new Date(w.saturday_date)
      return d.getFullYear() === season.year && d.getMonth() >= start && d.getMonth() <= end
    })
  }

  async function saveName() {
    if (!nameInput.trim() || !user) return
    setSavingName(true)
    const name = nameInput.trim()
    await supabase.from('profiles').upsert({ id: user.id, display_name: name })
    await supabase.auth.updateUser({ data: { full_name: name } })
    setDisplayName(name)
    setEditingName(false)
    setSavingName(false)
  }

  async function handleCopyInvite(group) {
    if (!group?.invite_code) return
    const url = `${window.location.origin}/groups?join=${group.invite_code}`
    try {
      await navigator.clipboard.writeText(url)
      setCopySuccess(group.id)
      setTimeout(() => setCopySuccess(null), 2500)
    } catch { /* ignore */ }
  }

  async function handleLeaveGroup(groupId) {
    if (!groupId || !user) return
    if (!window.confirm('Are you sure you want to leave this group?')) return
    await supabase.from('group_members')
      .delete().eq('user_id', user.id).eq('group_id', groupId)
    setMyGroups(prev => prev.filter(g => g.id !== groupId))
    if (groupData?.group?.id === groupId) setGroupData(null)
  }

  const handleSignOut = async () => { await supabase.auth.signOut(); navigate('/auth') }
  const getInitials  = () => displayName?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  const getFirstName = () => displayName?.split(' ')[0] || '?'
  const formatDate   = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  // ── Badges ────────────────────────────────────────────────────────────────
  let maxStreak = 0, tempStreak = 0
  for (const w of weeklyData) {
    if (w.myPoints > 0) { tempStreak++; maxStreak = Math.max(maxStreak, tempStreak) }
    else tempStreak = 0
  }

  const badges = [
    { id: 'first_pick',    icon: '🎯', label: 'First Pick',      desc: 'Made your first pick',            earned: careerStats.totalPicks > 0 },
    { id: 'first_winner',  icon: '🏇', label: 'First Winner',    desc: 'Picked a race winner',            earned: careerStats.wins > 0 },
    { id: 'league_leader', icon: '🥇', label: 'League Leader',   desc: 'Finished #1 for a week',          earned: weeklyData.some(w => w.rank === 1 && w.myPoints > 0) },
    { id: 'streak_5',      icon: '🔥', label: '5-Week Streak',   desc: '5 consecutive weeks picked',      earned: maxStreak >= 5 },
    { id: 'streak_10',     icon: '⚡', label: '10-Week Streak',  desc: '10 consecutive weeks',            earned: maxStreak >= 10 },
    { id: 'perfect_race',  icon: '⭐', label: 'Perfect Race',    desc: 'Scored 15+ pts in one race',      earned: careerStats.perfectRace },
    { id: 'season_winner', icon: '👑', label: 'Season Champion', desc: 'Won the overall season',          earned: seasonStats.rank === 1 && seasonStats.weeksPlayed > 0 },
    { id: 'group_founder', icon: '🏠', label: 'Group Founder',   desc: 'Created a private group',         earned: groupData?.isFounder === true },
    { id: 'top_group',     icon: '🎖️', label: 'Group Leader',   desc: 'Top of your group standings',     earned: groupData?.myRank === 1 },
  ]

  // ── Derived display values ────────────────────────────────────────────────
  const quarterWeekIds   = new Set(quarterWeeks.map(w => w.id))
  const quarterDisplay   = weeklyData.filter(w => quarterWeekIds.has(w.week.id))
  const maxWeekPts       = Math.max(...quarterDisplay.map(w => w.myPoints), 1)
  const winRate          = careerStats.totalPicks > 0 ? Math.round((careerStats.wins / careerStats.totalPicks) * 100) : 0
  const earnedBadgeCount = badges.filter(b => b.earned).length

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={st.loadingPage}><div style={st.loadingDot} /></div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={st.page}>

      {/* ── Nav ── */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>
          <div style={st.navLinks} className="app-nav-links">
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={st.navLink}>My Picks</a>
            <a href="/league"    style={st.navLink}>League</a>
            <a href="/races"     style={st.navLink}>Races</a>
            <a href="/results"   style={st.navLink}>Results</a>
            <a href="/groups"    style={st.navLink}>Groups</a>
            {isAdmin && <a href="/admin" style={{ ...st.navLink, color: '#c9a84c' }}>Admin</a>}
          </div>
          <div style={st.navRight}>
            <div style={{ ...st.avatar, outline: '2px solid #c9a84c', outlineOffset: '2px' }}
              onClick={() => setMenuOpen(!menuOpen)} title={user?.email}>
              {getInitials()}
            </div>
            {menuOpen && (
              <div style={st.dropdownMenu}>
                <div style={st.dropdownEmail}>{user?.email}</div>
                <hr style={st.dropdownDivider} />
                <button style={{ ...st.dropdownItem, color: '#c9a84c', fontWeight: '600' }}
                  onClick={() => { setMenuOpen(false); navigate('/profile') }}>
                  My Profile
                </button>
                {isAdmin && (
                  <>
                    <hr style={st.dropdownDivider} />
                    <button style={{ ...st.dropdownItem, color: '#c9a84c' }}
                      onClick={() => { setMenuOpen(false); navigate('/admin') }}>
                      Admin Panel
                    </button>
                  </>
                )}
                <hr style={st.dropdownDivider} />
                <button style={{ ...st.dropdownItem, color: '#f87171' }} onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main style={st.main} className="app-main-pad">

        {/* ── Profile header card ── */}
        <div style={st.card}>
          <div style={st.profileHeader}>
            <div style={st.avatarLarge}>{getInitials()}</div>
            <div style={st.profileInfo}>
              {editingName ? (
                <div style={st.nameEditRow}>
                  <input
                    style={st.nameInput}
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  saveName()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                    autoFocus
                    placeholder="Your display name"
                  />
                  <button style={st.btnGold} onClick={saveName} disabled={savingName}>
                    {savingName ? 'Saving…' : 'Save'}
                  </button>
                  <button style={st.btnGhost} onClick={() => setEditingName(false)}>Cancel</button>
                </div>
              ) : (
                <div style={st.nameRow}>
                  <h1 style={st.profileName}>{displayName}</h1>
                  <button style={st.editBtn}
                    onClick={() => { setNameInput(displayName); setEditingName(true) }}>
                    Edit
                  </button>
                </div>
              )}

              <div style={st.profileMeta}>
                {user?.created_at && (
                  <span style={st.metaItem}>Member since {formatDate(user.created_at)}</span>
                )}
                {season && (
                  <span style={st.metaItem}>{season.quarter} {season.year}</span>
                )}
              </div>

              <div style={st.profilePillRow}>
                {groupData?.group ? (
                  <span style={st.groupPill}>{groupData.group.name}</span>
                ) : (
                  <span style={st.groupPillEmpty}>No group</span>
                )}
                {earnedBadgeCount > 0 && (
                  <span style={st.badgePill}>🏅 {earnedBadgeCount} badge{earnedBadgeCount !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── 4 stat cards ── */}
        <div style={st.statsGrid} className="app-grid-4">
          {[
            { label: 'Season Points', value: seasonStats.seasonPoints,                          sub: 'this season',     icon: '⭐' },
            { label: 'Current Rank',  value: seasonStats.rank ? `#${seasonStats.rank}` : '—',   sub: 'in the league',   icon: '🏆' },
            { label: 'Weeks Played',  value: seasonStats.weeksPlayed,                            sub: 'this season',     icon: '📅' },
            { label: 'Best Week',     value: seasonStats.bestWeek || '—',                        sub: 'points in a week',icon: '🎯' },
          ].map(card => (
            <div key={card.label} style={st.statCard}>
              <div style={st.statIcon}>{card.icon}</div>
              <div style={st.statValue}>{card.value}</div>
              <div style={st.statLabel}>{card.label}</div>
              <div style={st.statSub}>{card.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Weekly history ── */}
        <div style={st.card}>
          <div style={st.cardHeader}>
            <span style={st.cardTitle}>Weekly History</span>
            {season && <span style={st.cardSub}>{season.quarter} {season.year}</span>}
          </div>
          {quarterDisplay.length === 0 ? (
            <p style={st.emptyMsg}>No weeks in this quarter yet — check back soon.</p>
          ) : (
            <div style={st.weekList}>
              {quarterDisplay.map(({ week, myPoints, rank, totalPlayers }) => {
                const barPct = myPoints > 0 ? Math.max((myPoints / maxWeekPts) * 100, 3) : 0
                return (
                  <div key={week.id} style={st.weekRow}>
                    <div style={st.weekNumCol}>
                      <span style={st.weekNum}>Wk {week.week_number}</span>
                      <span style={st.weekDate}>
                        {new Date(week.saturday_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <div style={st.weekBarOuter}>
                      <div style={{ ...st.weekBar, width: `${barPct}%` }} />
                    </div>
                    <div style={st.weekRightCol}>
                      {myPoints > 0 ? (
                        <>
                          <span style={st.weekPts}>{myPoints}</span>
                          <span style={st.weekRank}>
                            {rank ? `#${rank}${totalPlayers ? ` of ${totalPlayers}` : ''}` : '—'}
                          </span>
                        </>
                      ) : (
                        <span style={st.weekNoPlay}>—</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Two-column: career stats + groups & badges ── */}
        <div style={st.twoCol} className="app-grid-2">

          {/* ── Career stats ── */}
          <div style={st.card}>
            <div style={st.cardHeader}>
              <span style={st.cardTitle}>Career Stats</span>
            </div>
            <div style={st.careerGrid}>
              {[
                { label: 'All-Time Points',  value: careerStats.allTimePoints },
                { label: 'Horses Picked',    value: careerStats.totalPicks },
                { label: 'Winners Picked',   value: careerStats.wins },
                { label: 'Placed Horses',    value: careerStats.places },
                { label: 'Win Rate',         value: `${winRate}%` },
                { label: 'Best Ever Week',   value: careerStats.bestEverWeek || '—' },
                { label: 'Current Streak',   value: `${careerStats.currentStreak}w` },
              ].map(stat => (
                <div key={stat.label} style={st.careerStat}>
                  <div style={st.careerValue}>{stat.value}</div>
                  <div style={st.careerLabel}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right column: groups + badges ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Groups card */}
            <div style={st.card}>
              <div style={st.cardHeader}>
                <span style={st.cardTitle}>My Groups</span>
                <button
                  style={st.groupsPageBtn}
                  onClick={() => navigate('/groups')}
                >
                  Manage groups →
                </button>
              </div>

              {myGroups.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {myGroups.map(group => (
                    <div key={group.id} style={st.groupBox}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <div>
                          <div style={st.groupName}>{group.name}</div>
                          <div style={st.groupMeta}>
                            <span>{group.memberCount} member{group.memberCount !== 1 ? 's' : ''}</span>
                            {group.isFounder && <span style={st.founderBadge}>Founder</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            style={copySuccess === group.id ? st.btnSmallSuccess : st.btnGold}
                            onClick={() => handleCopyInvite(group)}
                          >
                            {copySuccess === group.id ? '✓ Copied!' : '🔗 Invite'}
                          </button>
                          <button style={st.leaveBtn} onClick={() => handleLeaveGroup(group.id)}>Leave</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={st.noGroupBox}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>👥</div>
                  <div style={{ fontWeight: '600', color: '#e8f0e8', fontSize: '0.95rem', marginBottom: '0.3rem' }}>No groups yet</div>
                  <div style={{ fontSize: '0.82rem', color: '#7a9e85', lineHeight: 1.5 }}>
                    Create or join a group to play with friends.
                  </div>
                  <button style={{ ...st.btnGold, marginTop: '0.75rem', fontSize: '0.82rem' }} onClick={() => navigate('/groups')}>
                    Go to Groups →
                  </button>
                </div>
              )}

              {/* Public league standing */}
              {publicStanding && (
                <div style={st.publicBox}>
                  <div style={st.publicLabel}>Public League Standing</div>
                  <div style={st.publicRow}>
                    <span style={st.publicRank}>
                      {publicStanding.rank ? `#${publicStanding.rank}` : '—'}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                      <span style={st.publicOf}>of {publicStanding.total} players</span>
                      {publicStanding.pointsBehindLeader > 0 ? (
                        <span style={st.publicBehind}>{publicStanding.pointsBehindLeader} pts behind leader</span>
                      ) : publicStanding.rank === 1 ? (
                        <span style={{ ...st.publicBehind, color: '#c9a84c' }}>👑 You're leading!</span>
                      ) : null}
                    </div>
                    <div style={{ flex: 1, textAlign: 'right' }}>
                      <span style={st.publicPts}>{seasonStats.seasonPoints}</span>
                      <span style={st.publicPtsSub}> pts</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Badges card */}
            <div style={st.card}>
              <div style={st.cardHeader}>
                <span style={st.cardTitle}>Badges</span>
                <span style={st.cardSub}>{earnedBadgeCount} / {badges.length} earned</span>
              </div>
              <div style={st.badgeGrid}>
                {badges.map(b => (
                  <div key={b.id}
                    style={{ ...st.badge, ...(b.earned ? st.badgeOn : st.badgeOff) }}
                    title={b.desc}>
                    <div style={st.badgeIcon}>{b.icon}</div>
                    <div style={st.badgeLabel}>{b.label}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

      </main>

      {/* ── Mobile bottom bar ── */}
      <nav style={st.mobileBar} className="app-mobile-bar">
        <a href="/dashboard" style={st.mobileBarItem}>
          <span>🏠</span><span style={st.mobileBarLabel}>Home</span>
        </a>
        <a href="/picks" style={st.mobileBarItem}>
          <span>🎯</span><span style={st.mobileBarLabel}>Picks</span>
        </a>
        <a href="/league" style={st.mobileBarItem}>
          <span>🏆</span><span style={st.mobileBarLabel}>League</span>
        </a>
        <a href="/races" style={st.mobileBarItem}>
          <span>🐴</span><span style={st.mobileBarLabel}>Races</span>
        </a>
        <a href="/results" style={st.mobileBarItem}>
          <span>📊</span><span style={st.mobileBarLabel}>Results</span>
        </a>
        <a href="/groups" style={st.mobileBarItem}>
          <span>👥</span><span style={st.mobileBarLabel}>Groups</span>
        </a>
      </nav>

    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = {
  page:        { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '5rem' },
  loadingPage: { minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loadingDot:  { width: '12px', height: '12px', borderRadius: '50%', background: '#c9a84c' },

  // Nav
  nav:            { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  navInner:       { maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem', height: '60px', display: 'flex', alignItems: 'center', gap: '2rem' },
  navLogo:        { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0 },
  navLinks:       { display: 'flex', gap: '0.25rem', flex: 1 },
  navLink:        { padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: '500', color: '#5a8a5a', textDecoration: 'none' },
  navRight:       { marginLeft: 'auto', position: 'relative' },
  avatar:         { width: '36px', height: '36px', borderRadius: '50%', background: '#c9a84c', color: '#0a1a08', fontWeight: '700', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.05em' },
  dropdownMenu:   { position: 'absolute', top: 'calc(100% + 0.5rem)', right: 0, background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '10px', padding: '0.5rem 0', minWidth: '200px', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', zIndex: 200 },
  dropdownEmail:  { padding: '0.5rem 1rem 0.75rem', fontSize: '0.78rem', color: '#5a8a5a' },
  dropdownDivider:{ border: 'none', borderTop: '1px solid rgba(201,168,76,0.1)', margin: '0.25rem 0' },
  dropdownItem:   { display: 'block', width: '100%', padding: '0.55rem 1rem', textAlign: 'left', background: 'none', border: 'none', color: '#e8f0e8', fontSize: '0.875rem', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

  // Layout
  main: { maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' },

  // Card base
  card:       { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.5rem' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' },
  cardTitle:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: '#e8f0e8', letterSpacing: '0.05em' },
  cardSub:    { fontSize: '0.78rem', color: '#7a9e85' },
  emptyMsg:   { color: '#7a9e85', fontSize: '0.875rem', margin: 0 },

  // Profile header
  profileHeader:  { display: 'flex', alignItems: 'flex-start', gap: '1.75rem', flexWrap: 'wrap' },
  avatarLarge:    { width: '90px', height: '90px', borderRadius: '50%', background: '#0a1a08', border: '3px solid #c9a84c', color: '#c9a84c', fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  profileInfo:    { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.65rem', paddingTop: '0.2rem' },
  nameRow:        { display: 'flex', alignItems: 'center', gap: '0.85rem' },
  profileName:    { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.4rem', color: '#e8f0e8', letterSpacing: '0.04em', margin: 0, lineHeight: 1 },
  editBtn:        { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', color: '#c9a84c', borderRadius: '6px', padding: '0.25rem 0.75rem', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
  nameEditRow:    { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  nameInput:      { background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(201,168,76,0.5)', borderRadius: '7px', padding: '0.5rem 0.9rem', fontFamily: "'DM Sans', sans-serif", fontSize: '1rem', color: '#e8f0e8', outline: 'none', flex: 1, minWidth: '180px' },
  profileMeta:    { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' },
  metaItem:       { fontSize: '0.85rem', color: '#7a9e85' },
  profilePillRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  groupPill:      { background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.4)', color: '#c9a84c', borderRadius: '999px', padding: '0.2rem 0.9rem', fontSize: '0.78rem', fontWeight: '600' },
  groupPillEmpty: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#7a9e85', borderRadius: '999px', padding: '0.2rem 0.9rem', fontSize: '0.78rem' },
  badgePill:      { background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.25)', color: '#c9a84c', borderRadius: '999px', padding: '0.2rem 0.9rem', fontSize: '0.78rem', fontWeight: '500' },

  // Stat cards
  statsGrid:  { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' },
  statCard:   { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  statIcon:   { fontSize: '1.3rem', marginBottom: '0.1rem' },
  statValue:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.2rem', color: '#c9a84c', letterSpacing: '0.03em', lineHeight: 1 },
  statLabel:  { fontSize: '0.78rem', fontWeight: '600', color: '#e8f0e8', textTransform: 'uppercase', letterSpacing: '0.04em' },
  statSub:    { fontSize: '0.72rem', color: '#7a9e85' },

  // Weekly history
  weekList:     { display: 'flex', flexDirection: 'column', gap: '0.65rem' },
  weekRow:      { display: 'flex', alignItems: 'center', gap: '1rem' },
  weekNumCol:   { display: 'flex', flexDirection: 'column', minWidth: '50px' },
  weekNum:      { fontSize: '0.8rem', fontWeight: '700', color: '#e8f0e8', lineHeight: 1 },
  weekDate:     { fontSize: '0.65rem', color: '#7a9e85', marginTop: '0.1rem' },
  weekBarOuter: { flex: 1, height: '10px', background: 'rgba(201,168,76,0.08)', borderRadius: '999px', overflow: 'hidden', border: '1px solid rgba(201,168,76,0.15)' },
  weekBar:      { height: '100%', background: 'linear-gradient(90deg, #c9a84c, #e8c96a)', borderRadius: '999px', transition: 'width 0.6s ease', minWidth: 0 },
  weekRightCol: { minWidth: '85px', textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.05rem' },
  weekPts:      { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.15rem', color: '#c9a84c', letterSpacing: '0.03em', lineHeight: 1 },
  weekRank:     { fontSize: '0.65rem', color: '#7a9e85' },
  weekNoPlay:   { fontSize: '0.85rem', color: 'rgba(255,255,255,0.18)' },

  // Career stats
  careerGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem 0.75rem' },
  careerStat:  { display: 'flex', flexDirection: 'column', gap: '0.1rem' },
  careerValue: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.7rem', color: '#c9a84c', letterSpacing: '0.03em', lineHeight: 1 },
  careerLabel: { fontSize: '0.7rem', fontWeight: '600', color: '#7a9e85', textTransform: 'uppercase', letterSpacing: '0.05em' },

  // Groups
  groupsPageBtn:   { background: 'none', border: 'none', color: '#c9a84c', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: 0 },
  groupBox:        { background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '8px', padding: '0.85rem 1rem' },
  groupName:       { fontWeight: '700', fontSize: '0.95rem', color: '#e8f0e8', marginBottom: '0.2rem' },
  groupMeta:       { display: 'flex', gap: '0.65rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#7a9e85', alignItems: 'center' },
  founderBadge:    { background: 'rgba(201,168,76,0.12)', color: '#c9a84c', fontSize: '0.65rem', fontWeight: '700', padding: '0.12rem 0.5rem', borderRadius: '999px', letterSpacing: '0.06em', textTransform: 'uppercase' },
  leaveBtn:        { background: 'none', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '0.73rem', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: '0.3rem 0.6rem', borderRadius: '5px' },
  btnSmallSuccess: { background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', fontWeight: '600', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  noGroupBox:      { textAlign: 'center', padding: '1.25rem 0.5rem', marginBottom: '0.5rem' },
  publicBox:   { marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid rgba(201,168,76,0.15)' },
  publicLabel: { fontSize: '0.68rem', fontWeight: '700', color: '#7a9e85', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.6rem' },
  publicRow:   { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  publicRank:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2rem', color: '#c9a84c', letterSpacing: '0.03em', lineHeight: 1, minWidth: '52px' },
  publicOf:    { fontSize: '0.82rem', color: '#7a9e85' },
  publicBehind:{ fontSize: '0.72rem', color: '#7a9e85', fontStyle: 'italic' },
  publicPts:   { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: '#c9a84c' },
  publicPtsSub:{ fontSize: '0.75rem', color: '#7a9e85' },

  // Badges
  badgeGrid:  { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem' },
  badge:      { borderRadius: '8px', padding: '0.85rem 0.4rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' },
  badgeOn:    { background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.4)' },
  badgeOff:   { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', opacity: 0.4, filter: 'grayscale(1)' },
  badgeIcon:  { fontSize: '1.5rem', lineHeight: 1 },
  badgeLabel: { fontSize: '0.63rem', fontWeight: '600', color: '#e8f0e8', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.3 },

  // Buttons
  btnGold:  { background: '#c9a84c', color: '#0a1a08', fontWeight: '700', fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnGhost: { background: 'transparent', border: '1.5px solid rgba(201,168,76,0.3)', color: '#c9a84c', fontWeight: '600', fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '7px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },

  // Mobile bottom bar
  mobileBar: {
    display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0,
    background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)',
    padding: '0.5rem 0', zIndex: 100, justifyContent: 'space-around',
  },
  mobileBarItem: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem',
    color: '#5a8a5a', textDecoration: 'none', fontSize: '1.1rem', padding: '0.25rem 0.75rem',
  },
  mobileBarLabel: { fontSize: '0.65rem', fontWeight: '500' },
}
