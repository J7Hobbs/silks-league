import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function FestivalLeaderboard() {
  const navigate = useNavigate()
  const [user,       setUser]       = useState(null)
  const [festival,   setFestival]   = useState(null)
  const [days,       setDays]       = useState([])
  const [activeView, setActiveView] = useState('overall')   // 'overall' | day.id
  const [groups,     setGroups]     = useState([])
  const [activeGroup, setActiveGroup] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setUser(user)
      await load(user.id)
    })
  }, [])

  async function load(userId) {
    setLoading(true)
    try {
      // Active festival
      const { data: fest } = await supabase
        .from('festivals').select('*').eq('is_active', true).single()
      if (!fest) { setLoading(false); return }
      setFestival(fest)

      // Days
      const { data: daysData } = await supabase
        .from('festival_days').select('*').eq('festival_id', fest.id).order('day_number')
      setDays(daysData || [])

      // User's groups (for group filter)
      const { data: myGroups } = await supabase
        .from('group_members').select('group_id, groups(id, name)').eq('user_id', userId)
      setGroups(myGroups?.map(m => m.groups).filter(Boolean) || [])

      // Build overall leaderboard
      await buildOverallLeaderboard(fest, daysData || [], null, userId)
    } finally {
      setLoading(false)
    }
  }

  async function buildOverallLeaderboard(fest, allDays, groupId, myUserId) {
    if (!allDays.length) { setLeaderboard([]); return }

    const raceIds = []
    for (const day of allDays) {
      const { data: races } = await supabase
        .from('festival_races').select('id').eq('festival_day_id', day.id)
      races?.forEach(r => raceIds.push(r.id))
    }
    if (!raceIds.length) { setLeaderboard([]); return }

    // Fetch all scores
    const { data: scores } = await supabase
      .from('festival_scores').select('user_id, total_points, festival_race_id').in('festival_race_id', raceIds)

    // Fetch all entries (for starting_points and to get list of participants)
    let entries
    if (groupId) {
      // Filter to group members
      const { data: members } = await supabase
        .from('group_members').select('user_id').eq('group_id', groupId)
      const memberIds = members?.map(m => m.user_id) || []
      const { data: ents } = await supabase
        .from('festival_entries').select('user_id, starting_points').eq('festival_id', fest.id).in('user_id', memberIds)
      entries = ents
    } else {
      const { data: ents } = await supabase
        .from('festival_entries').select('user_id, starting_points').eq('festival_id', fest.id)
      entries = ents
    }

    if (!entries?.length) { setLeaderboard([]); return }

    const byUser = {}
    entries.forEach(e => {
      byUser[e.user_id] = { total: e.starting_points || 0, startingPoints: e.starting_points || 0 }
    })
    scores?.forEach(s => {
      if (byUser[s.user_id]) byUser[s.user_id].total += (s.total_points || 0)
    })

    const userIds = [...new Set([...Object.keys(byUser), ...(myUserId ? [myUserId] : [])])]
    const { data: profiles } = await supabase
      .from('profiles').select('id, username, display_name, full_name').in('id', userIds)
    const nameMap = {}
    profiles?.forEach(p => { nameMap[p.id] = p.username || p.display_name || p.full_name || null })

    const sorted = Object.entries(byUser)
      .map(([uid, v]) => ({ userId: uid, name: nameMap[uid] || 'Player', total: v.total, startingPoints: v.startingPoints, isMe: uid === myUserId }))
      .sort((a, b) => b.total - a.total)

    setLeaderboard(sorted)
  }

  async function buildDayLeaderboard(day, groupId, myUserId) {
    const { data: races } = await supabase
      .from('festival_races').select('id').eq('festival_day_id', day.id)
    if (!races?.length) { setLeaderboard([]); return }
    const raceIds = races.map(r => r.id)

    const { data: scores } = await supabase
      .from('festival_scores').select('user_id, total_points').in('festival_race_id', raceIds)

    if (!scores?.length) { setLeaderboard([]); return }

    // Filter by group if set
    let validUserIds = null
    if (groupId) {
      const { data: members } = await supabase
        .from('group_members').select('user_id').eq('group_id', groupId)
      validUserIds = new Set(members?.map(m => m.user_id) || [])
    }

    const byUser = {}
    scores.forEach(s => {
      if (validUserIds && !validUserIds.has(s.user_id)) return
      if (!byUser[s.user_id]) byUser[s.user_id] = { total: 0 }
      byUser[s.user_id].total += (s.total_points || 0)
    })

    if (!Object.keys(byUser).length) { setLeaderboard([]); return }

    const dayUserIds = [...new Set([...Object.keys(byUser), ...(myUserId ? [myUserId] : [])])]
    const { data: profiles } = await supabase
      .from('profiles').select('id, username, display_name, full_name').in('id', dayUserIds)
    const nameMap = {}
    profiles?.forEach(p => { nameMap[p.id] = p.username || p.display_name || p.full_name || null })

    const sorted = Object.entries(byUser)
      .map(([uid, v]) => ({ userId: uid, name: nameMap[uid] || 'Player', total: v.total, isMe: uid === myUserId }))
      .sort((a, b) => b.total - a.total)

    setLeaderboard(sorted)
  }

  async function switchView(viewId) {
    setActiveView(viewId)
    setLeaderboard([])
    if (!festival) return
    if (viewId === 'overall') {
      await buildOverallLeaderboard(festival, days, activeGroup, user?.id)
    } else {
      const day = days.find(d => d.id === viewId)
      if (day) await buildDayLeaderboard(day, activeGroup, user?.id)
    }
  }

  async function switchGroup(groupId) {
    setActiveGroup(groupId)
    setLeaderboard([])
    if (!festival) return
    if (activeView === 'overall') {
      await buildOverallLeaderboard(festival, days, groupId, user?.id)
    } else {
      const day = days.find(d => d.id === activeView)
      if (day) await buildDayLeaderboard(day, groupId, user?.id)
    }
  }

  const myRank = leaderboard.findIndex(r => r.userId === user?.id) + 1

  if (loading) {
    return (
      <div style={st.loadingPage}><div style={st.loadingDot} /></div>
    )
  }

  if (!festival) {
    return (
      <div style={st.page}>
        <nav style={st.nav}><div style={st.navInner}>
          <button style={st.backBtn} onClick={() => navigate('/dashboard')}>← Dashboard</button>
          <div style={st.navLogo}>Silks League</div>
        </div></nav>
        <main style={st.main}>
          <div style={st.emptyCard}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏆</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem', color: '#c9a84c', marginBottom: '0.35rem' }}>No Active Festival</div>
            <div style={{ fontSize: '0.875rem', color: '#5a8a5a' }}>There's no active festival right now.</div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div style={st.page}>
      {/* Nav */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <button style={st.backBtn} onClick={() => navigate('/dashboard')}>← Dashboard</button>
          <div style={st.navLogo}>Silks League</div>
          <button style={{ ...st.backBtn, marginLeft: 'auto', color: '#c9a84c' }} onClick={() => navigate('/festival-picks')}>My Picks →</button>
        </div>
      </nav>

      {/* Festival banner */}
      <div style={{ background: festival.banner_colour || '#1a6b3a', padding: '1rem 1.25rem' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.6rem', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: '0.15rem' }}>Festival Leaderboard</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', color: '#fff', letterSpacing: '0.04em', lineHeight: 1 }}>{festival.display_name || festival.name}</div>
          </div>
          {myRank > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.8rem', color: '#fff', lineHeight: 1 }}>#{myRank}</div>
              <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>your rank</div>
            </div>
          )}
        </div>
      </div>

      <main style={st.main}>

        {/* Group filter */}
        {groups.length > 0 && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <button style={{ ...st.groupBtn, ...(activeGroup === null ? st.groupBtnActive : {}) }}
              onClick={() => switchGroup(null)}>All players</button>
            {groups.map(g => (
              <button key={g.id}
                style={{ ...st.groupBtn, ...(activeGroup === g.id ? st.groupBtnActive : {}) }}
                onClick={() => switchGroup(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
        )}

        {/* View tabs: Overall + per-day */}
        <div style={st.viewTabBar}>
          <button style={{ ...st.viewTab, ...(activeView === 'overall' ? st.viewTabActive : {}) }}
            onClick={() => switchView('overall')}>Overall</button>
          {days.map(day => (
            <button key={day.id}
              style={{ ...st.viewTab, ...(activeView === day.id ? st.viewTabActive : {}) }}
              onClick={() => switchView(day.id)}>
              Day {day.day_number}
            </button>
          ))}
        </div>

        {/* Leaderboard table */}
        {leaderboard.length === 0 ? (
          <div style={st.emptyMsg}>No scores yet for this view.</div>
        ) : (
          <div style={st.tableCard}>
            {/* Header */}
            <div style={{ ...st.tableRow, background: 'rgba(0,0,0,0.3)', borderTop: 'none', fontSize: '0.68rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5a8a5a' }}>
              <span style={{ width: '40px' }}>#</span>
              <span style={{ flex: 1 }}>Player</span>
              <span style={{ width: '80px', textAlign: 'right' }}>Points</span>
            </div>

            {leaderboard.map((row, i) => {
              const isMe = row.userId === user?.id
              return (
                <div key={row.userId} style={{ ...st.tableRow, ...(isMe ? st.tableRowMe : {}), ...(i === 0 ? { background: 'rgba(201,168,76,0.04)' } : {}) }}>
                  <span style={{ width: '40px', fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.1rem', color: i < 3 ? '#c9a84c' : '#5a8a5a' }}>
                    {i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: isMe ? '700' : '500', color: isMe ? '#c9a84c' : '#e8f0e8', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      {row.name}
                      {isMe && <span style={st.youBadge}>You</span>}
                    </span>
                    {(row.startingPoints || 0) > 0 && (
                      <span style={{ fontSize: '0.62rem', color: '#5a8a5a', background: 'rgba(90,138,90,0.1)', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>mid-join</span>
                    )}
                  </span>
                  <span style={{ width: '80px', textAlign: 'right', fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: i === 0 ? '#c9a84c' : '#e8f0e8' }}>{row.total}</span>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

const st = {
  page:        { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '3rem' },
  loadingPage: { minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loadingDot:  { width: '12px', height: '12px', borderRadius: '50%', background: '#c9a84c' },
  nav:         { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)' },
  navInner:    { maxWidth: '700px', margin: '0 auto', padding: '0 1.25rem', height: '56px', display: 'flex', alignItems: 'center', gap: '1rem' },
  navLogo:     { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: '#c9a84c', letterSpacing: '0.1em' },
  backBtn:     { background: 'none', border: 'none', color: '#5a8a5a', cursor: 'pointer', fontSize: '0.875rem', fontFamily: "'DM Sans', sans-serif", padding: 0 },
  main:        { maxWidth: '700px', margin: '0 auto', padding: '1.5rem 1.25rem' },
  emptyCard:   { textAlign: 'center', background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '16px', padding: '3rem 2rem', marginTop: '2rem' },
  emptyMsg:    { color: '#5a8a5a', textAlign: 'center', padding: '2rem', fontSize: '0.875rem' },
  groupBtn:    { background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '999px', padding: '0.3rem 0.85rem', fontSize: '0.78rem', fontWeight: '500', color: '#5a8a5a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  groupBtnActive: { background: 'rgba(201,168,76,0.12)', border: '1px solid #c9a84c', color: '#c9a84c' },
  viewTabBar:  { display: 'flex', gap: '0.25rem', overflowX: 'auto', WebkitOverflowScrolling: 'touch', background: '#0d1f0d', borderRadius: '8px', padding: '0.35rem 0.5rem', marginBottom: '1rem', border: '1px solid rgba(201,168,76,0.1)' },
  viewTab:     { background: 'none', border: 'none', borderRadius: '5px', padding: '0.45rem 0.85rem', fontSize: '0.8rem', fontWeight: '500', color: '#5a8a5a', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 },
  viewTabActive: { background: 'rgba(201,168,76,0.12)', color: '#c9a84c' },
  tableCard:   { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', overflow: 'hidden' },
  tableRow:    { display: 'flex', gap: '0.75rem', padding: '0.85rem 1.25rem', borderTop: '1px solid rgba(201,168,76,0.1)', alignItems: 'center' },
  tableRowMe:  { background: 'rgba(201,168,76,0.06)' },
  youBadge:    { fontSize: '0.55rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0a1a08', background: '#c9a84c', padding: '0.1rem 0.35rem', borderRadius: '3px', whiteSpace: 'nowrap', flexShrink: 0 },
}
