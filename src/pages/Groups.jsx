import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Groups() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // ── Nav ───────────────────────────────────────────────────────
  const [user,     setUser]     = useState(null)
  const [isAdmin,  setIsAdmin]  = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading,  setLoading]  = useState(true)

  // ── Groups data ───────────────────────────────────────────────
  const [myGroups,    setMyGroups]    = useState([])
  const [selectedId,  setSelectedId]  = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [lbLoading,   setLbLoading]   = useState(false)

  // ── Create form ───────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating,   setCreating]   = useState(false)

  // ── Join form ─────────────────────────────────────────────────
  const [showJoin, setShowJoin] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining,  setJoining]  = useState(false)

  // ── Feedback ──────────────────────────────────────────────────
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState('')
  const [copySuccess, setCopySuccess] = useState(null)  // groupId

  // ── Welcome / onboarding ──────────────────────────────────────
  const isWelcome = searchParams.get('welcome') === '1'

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/auth'); return }
    setUser(user)

    const { data: prof } = await supabase
      .from('profiles').select('is_admin').eq('id', user.id).single()
    setIsAdmin(prof?.is_admin || false)

    // Pre-fill join code from URL
    const codeParam = searchParams.get('join')
    if (codeParam) { setJoinCode(codeParam); setShowJoin(true) }

    await loadMyGroups(user.id)
    setLoading(false)
  }

  // ── Load all groups the user belongs to ───────────────────────
  async function loadMyGroups(userId) {
    const { data: memberships } = await supabase
      .from('group_members')
      .select('is_founder, joined_at, groups(id, name, invite_code, created_by, created_at)')
      .eq('user_id', userId)

    if (!memberships?.length) { setMyGroups([]); return }

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

    // Auto-select first group and load its leaderboard
    if (enriched.length > 0) {
      setSelectedId(enriched[0].id)
      await loadLeaderboard(userId, enriched[0].id)
    }
  }

  // ── Load leaderboard for a specific group ─────────────────────
  async function loadLeaderboard(userId, groupId) {
    setLbLoading(true)
    try {
      const { data: members } = await supabase
        .from('group_members').select('user_id').eq('group_id', groupId)
      const memberIds = (members || []).map(m => m.user_id)
      if (!memberIds.length) { setLeaderboard([]); return }

      const { data: season } = await supabase
        .from('seasons').select('id').eq('is_active', true).single()
      if (!season) { setLeaderboard([]); return }

      const { data: weeks } = await supabase
        .from('race_weeks').select('id').eq('season_id', season.id)
      const weekIds = (weeks || []).map(w => w.id)
      if (!weekIds.length) { setLeaderboard([]); return }

      const { data: races } = await supabase
        .from('races').select('id').in('race_week_id', weekIds)
      const raceIds = (races || []).map(r => r.id)
      if (!raceIds.length) { setLeaderboard([]); return }

      const { data: scores } = await supabase
        .from('scores')
        .select('user_id, total_points')
        .in('race_id', raceIds)
        .in('user_id', memberIds)

      // Aggregate totals
      const totals = {}
      for (const uid of memberIds) totals[uid] = 0
      for (const s of (scores || [])) {
        totals[s.user_id] = (totals[s.user_id] || 0) + s.total_points
      }

      // Fetch names
      const { data: profiles } = await supabase
        .from('profiles').select('id, display_name, full_name').in('id', memberIds)
      const nameMap = {}
      profiles?.forEach(p => { nameMap[p.id] = p.display_name || p.full_name || null })

      const ranked = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .map(([uid, pts], i) => ({
          rank: i + 1,
          userId: uid,
          name: uid === userId ? 'You' : (nameMap[uid] || 'Player'),
          points: pts,
          isMe: uid === userId,
        }))

      setLeaderboard(ranked)
    } finally {
      setLbLoading(false)
    }
  }

  // ── Create group ──────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault()
    if (!createName.trim()) return
    setCreating(true)
    setError('')

    try {
      const { data: group, error: gErr } = await supabase
        .from('groups')
        .insert({ name: createName.trim(), created_by: user.id })
        .select()
        .single()
      if (gErr) throw gErr

      const { error: mErr } = await supabase
        .from('group_members')
        .insert({ group_id: group.id, user_id: user.id, is_founder: true })
      if (mErr) throw mErr

      if (isWelcome) {
        localStorage.setItem(`silks_group_onboarded_${user.id}`, '1')
        navigate('/groups', { replace: true })
      }

      setSuccess(`"${group.name}" created! Share the invite link with your friends.`)
      setCreateName('')
      setShowCreate(false)
      await loadMyGroups(user.id)
    } catch (err) {
      setError(err.message || 'Failed to create group.')
    } finally {
      setCreating(false)
    }
  }

  // ── Join group ────────────────────────────────────────────────
  async function handleJoin(e) {
    e.preventDefault()
    if (!joinCode.trim()) return
    setJoining(true)
    setError('')

    try {
      const { data: group, error: gErr } = await supabase
        .from('groups')
        .select('id, name')
        .eq('invite_code', joinCode.trim().toLowerCase())
        .single()

      if (gErr || !group) {
        setError('Invite code not found — double-check and try again.')
        return
      }

      // Check already a member
      const { data: existing } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existing) {
        setError(`You're already in "${group.name}".`)
        return
      }

      const { error: mErr } = await supabase
        .from('group_members')
        .insert({ group_id: group.id, user_id: user.id, is_founder: false })
      if (mErr) throw mErr

      if (isWelcome) {
        localStorage.setItem(`silks_group_onboarded_${user.id}`, '1')
        navigate('/groups', { replace: true })
      }

      setSuccess(`Joined "${group.name}" successfully!`)
      setJoinCode('')
      setShowJoin(false)
      await loadMyGroups(user.id)
    } catch (err) {
      setError(err.message || 'Failed to join group.')
    } finally {
      setJoining(false)
    }
  }

  // ── Leave group ───────────────────────────────────────────────
  async function handleLeave(groupId, groupName) {
    if (!window.confirm(`Leave "${groupName}"? You can rejoin with the invite code.`)) return
    await supabase
      .from('group_members')
      .delete()
      .eq('user_id', user.id)
      .eq('group_id', groupId)

    if (selectedId === groupId) { setSelectedId(null); setLeaderboard([]) }
    await loadMyGroups(user.id)
  }

  // ── Copy invite link ──────────────────────────────────────────
  async function handleCopyInvite(group) {
    const url = `${window.location.origin}/groups?join=${group.invite_code}`
    try {
      await navigator.clipboard.writeText(url)
      setCopySuccess(group.id)
      setTimeout(() => setCopySuccess(null), 2500)
    } catch { /* ignore */ }
  }

  // ── Switch group leaderboard ──────────────────────────────────
  async function handleSelectGroup(groupId) {
    if (groupId === selectedId) return
    setSelectedId(groupId)
    if (user) await loadLeaderboard(user.id, groupId)
  }

  const handleSignOut = async () => { await supabase.auth.signOut(); navigate('/auth') }
  const getFirstName  = () => user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Player'
  const getInitial    = () => getFirstName().charAt(0).toUpperCase()

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return <div style={st.loadingPage}><div style={st.loadingDot} /></div>
  }

  const selectedGroup = myGroups.find(g => g.id === selectedId)

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
            <a href="/groups"    style={{ ...st.navLink, ...st.navLinkActive }}>Groups</a>
            {isAdmin && <a href="/admin" style={{ ...st.navLink, color: '#c9a84c' }}>Admin</a>}
          </div>
          <div style={st.navRight}>
            <div style={st.avatar} onClick={() => navigate('/profile')} title="View profile">
              {getInitial()}
            </div>
            {menuOpen && (
              <div style={st.dropdownMenu}>
                <div style={st.dropdownEmail}>{user?.email}</div>
                <hr style={st.dropdownDivider} />
                <button style={st.dropdownItem} onClick={() => { setMenuOpen(false); navigate('/profile') }}>My Profile</button>
                {isAdmin && (
                  <>
                    <hr style={st.dropdownDivider} />
                    <button style={{ ...st.dropdownItem, color: '#c9a84c' }}
                      onClick={() => { setMenuOpen(false); navigate('/admin') }}>Admin Panel</button>
                  </>
                )}
                <hr style={st.dropdownDivider} />
                <button style={{ ...st.dropdownItem, color: '#f87171' }} onClick={handleSignOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main style={st.main} className="app-main-pad">

        {/* ── Welcome banner ── */}
        {isWelcome && (
          <div style={st.welcomeBanner}>
            <div style={st.welcomeIcon}>👋</div>
            <div>
              <div style={st.welcomeTitle}>Welcome to Silks League!</div>
              <div style={st.welcomeSub}>Create a private group to play with friends, or join one with an invite code.</div>
            </div>
          </div>
        )}

        {/* ── Page heading ── */}
        <div style={st.pageHeader}>
          <div>
            <h1 style={st.pageTitle}>Groups</h1>
            <p style={st.pageSub}>Play privately with friends in your own leaderboard.</p>
          </div>
          <div style={st.headerActions}>
            <button
              style={{ ...st.btnGold, ...(showCreate ? st.btnActive : {}) }}
              onClick={() => { setShowCreate(v => !v); setShowJoin(false); setError('') }}
            >
              {showCreate ? '✕ Cancel' : '+ Create group'}
            </button>
            <button
              style={{ ...st.btnGhost, ...(showJoin ? st.btnActive : {}) }}
              onClick={() => { setShowJoin(v => !v); setShowCreate(false); setError('') }}
            >
              {showJoin ? '✕ Cancel' : '↩ Join group'}
            </button>
          </div>
        </div>

        {/* ── Feedback ── */}
        {success && (
          <div style={st.successBox}>
            ✓ {success}
            <button style={st.dismissBtn} onClick={() => setSuccess('')}>✕</button>
          </div>
        )}
        {error && (
          <div style={st.errorBox}>
            ⚠ {error}
            <button style={st.dismissBtn} onClick={() => setError('')}>✕</button>
          </div>
        )}

        {/* ── Create Group form ── */}
        {showCreate && (
          <div style={st.formCard}>
            <div style={st.formTitle}>CREATE A NEW GROUP</div>
            <form onSubmit={handleCreate} style={st.formRow}>
              <input
                style={st.input}
                placeholder="Group name, e.g. The Somerset Silks"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                required
                autoFocus
              />
              <button type="submit" style={st.btnGold} disabled={creating}>
                {creating ? 'Creating…' : 'Create →'}
              </button>
            </form>
          </div>
        )}

        {/* ── Join Group form ── */}
        {showJoin && (
          <div style={st.formCard}>
            <div style={st.formTitle}>JOIN WITH AN INVITE CODE</div>
            <form onSubmit={handleJoin} style={st.formRow}>
              <input
                style={st.input}
                placeholder="Paste invite code here"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value)}
                required
                autoFocus={!searchParams.get('join')}
              />
              <button type="submit" style={st.btnGold} disabled={joining}>
                {joining ? 'Joining…' : 'Join →'}
              </button>
            </form>
          </div>
        )}

        {/* ── My Groups ── */}
        {myGroups.length === 0 ? (
          <div style={st.emptyCard}>
            <div style={st.emptyIcon}>👥</div>
            <div style={st.emptyTitle}>No groups yet</div>
            <div style={st.emptySub}>Create a group or ask your commissioner for an invite link.</div>
          </div>
        ) : (
          <div style={st.groupsList}>
            {myGroups.map(group => (
              <div
                key={group.id}
                style={{ ...st.groupCard, ...(group.id === selectedId ? st.groupCardActive : {}) }}
              >
                <div style={st.groupCardTop}>
                  <div style={st.groupCardLeft}>
                    <div style={st.groupCardName}>{group.name}</div>
                    <div style={st.groupCardMeta}>
                      {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
                      {group.isFounder && <span style={st.founderBadge}>Founder</span>}
                    </div>
                  </div>
                  <div style={st.groupCardActions}>
                    <button
                      style={group.id === selectedId ? st.btnSmallActive : st.btnSmall}
                      onClick={() => handleSelectGroup(group.id)}
                    >
                      {group.id === selectedId ? '✓ Leaderboard' : 'Leaderboard'}
                    </button>
                    <button
                      style={copySuccess === group.id ? st.btnSmallSuccess : st.btnSmallGhost}
                      onClick={() => handleCopyInvite(group)}
                    >
                      {copySuccess === group.id ? '✓ Copied!' : '🔗 Invite'}
                    </button>
                    <button style={st.btnSmallDanger} onClick={() => handleLeave(group.id, group.name)}>
                      Leave
                    </button>
                  </div>
                </div>

                {/* Invite code chip */}
                <div style={st.inviteRow}>
                  <span style={st.inviteLabel}>INVITE CODE</span>
                  <code style={st.inviteCode}>{group.invite_code}</code>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Group Leaderboard ── */}
        {selectedGroup && (
          <div style={st.card}>
            <div style={st.cardHeader}>
              <span style={st.cardTitle}>{selectedGroup.name} — Leaderboard</span>
              <span style={st.cardBadge}>{selectedGroup.memberCount} member{selectedGroup.memberCount !== 1 ? 's' : ''}</span>
            </div>

            {lbLoading ? (
              <div style={{ color: '#5a8a5a', fontSize: '0.85rem', padding: '1rem 0' }}>Loading…</div>
            ) : leaderboard.length === 0 ? (
              <div style={{ color: '#5a8a5a', fontSize: '0.85rem', padding: '0.5rem 0' }}>
                No scores yet — results will appear once races are submitted.
              </div>
            ) : (
              <div style={st.lbList}>
                {leaderboard.map(row => (
                  <div
                    key={row.userId}
                    style={{ ...st.lbRow, ...(row.isMe ? st.lbRowMe : {}) }}
                  >
                    <div style={st.lbRank}>
                      {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                    </div>
                    <div style={st.lbName}>{row.name}</div>
                    <div style={st.lbPoints}>{row.points} pts</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
        <a href="/groups" style={{ ...st.mobileBarItem, ...st.mobileBarItemActive }}>
          <span>👥</span><span style={st.mobileBarLabel}>Groups</span>
        </a>
        <a href="/results" style={st.mobileBarItem}>
          <span>📊</span><span style={st.mobileBarLabel}>Results</span>
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
  nav:           { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  navInner:      { maxWidth: '1100px', margin: '0 auto', padding: '0 1.5rem', height: '60px', display: 'flex', alignItems: 'center', gap: '2rem' },
  navLogo:       { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none', flexShrink: 0 },
  navLinks:      { display: 'flex', gap: '0.25rem', flex: 1 },
  navLink:       { padding: '0.4rem 0.85rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: '500', color: '#5a8a5a', textDecoration: 'none' },
  navLinkActive: { color: '#e8f0e8', background: 'rgba(201,168,76,0.1)' },
  navRight:      { marginLeft: 'auto', position: 'relative' },
  avatar:        { width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(201,168,76,0.15)', border: '1.5px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '0.85rem', color: '#c9a84c', cursor: 'pointer', userSelect: 'none' },
  dropdownMenu:  { position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '10px', padding: '0.35rem', minWidth: '180px', zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' },
  dropdownEmail: { padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: '#5a8a5a', fontStyle: 'italic' },
  dropdownDivider:{ margin: '0.25rem 0', border: 'none', borderTop: '1px solid rgba(201,168,76,0.1)' },
  dropdownItem:  { display: 'block', width: '100%', padding: '0.55rem 0.75rem', background: 'none', border: 'none', borderRadius: '6px', fontSize: '0.85rem', color: '#e8f0e8', cursor: 'pointer', textAlign: 'left', fontFamily: "'DM Sans', sans-serif" },

  // Main
  main:         { maxWidth: '1100px', margin: '0 auto', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },

  // Welcome banner
  welcomeBanner: { background: 'rgba(201,168,76,0.07)', border: '1px solid rgba(201,168,76,0.25)', borderLeft: '4px solid #c9a84c', borderRadius: '10px', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'flex-start', gap: '1rem' },
  welcomeIcon:   { fontSize: '1.75rem', flexShrink: 0 },
  welcomeTitle:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', letterSpacing: '0.05em', color: '#c9a84c', marginBottom: '0.2rem' },
  welcomeSub:    { fontSize: '0.875rem', color: '#7a9e85', lineHeight: 1.5 },

  // Page heading
  pageHeader:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' },
  pageTitle:    { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.2rem', color: '#e8f0e8', letterSpacing: '0.03em', margin: 0 },
  pageSub:      { fontSize: '0.875rem', color: '#5a8a5a', marginTop: '0.2rem' },
  headerActions:{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },

  // Buttons
  btnGold:        { background: '#c9a84c', color: '#0a1a08', fontWeight: '700', fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnGhost:       { background: 'transparent', border: '1.5px solid rgba(201,168,76,0.3)', color: '#c9a84c', fontWeight: '600', fontSize: '0.875rem', padding: '0.6rem 1.25rem', borderRadius: '7px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnActive:      { background: 'rgba(201,168,76,0.12)', border: '1.5px solid rgba(201,168,76,0.4)', color: '#c9a84c' },
  btnSmall:       { background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.22)', color: '#c9a84c', fontWeight: '600', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnSmallActive: { background: 'rgba(201,168,76,0.2)', border: '1px solid rgba(201,168,76,0.5)', color: '#c9a84c', fontWeight: '700', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnSmallGhost:  { background: 'transparent', border: '1px solid rgba(201,168,76,0.22)', color: '#c9a84c', fontWeight: '600', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnSmallSuccess:{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', fontWeight: '600', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  btnSmallDanger: { background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171', fontWeight: '600', fontSize: '0.78rem', padding: '0.35rem 0.75rem', borderRadius: '5px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },

  // Feedback
  successBox:  { background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: '8px', padding: '0.85rem 1rem', fontSize: '0.875rem', color: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  errorBox:    { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '0.85rem 1rem', fontSize: '0.875rem', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  dismissBtn:  { background: 'none', border: 'none', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: '0.85rem', fontFamily: "'DM Sans', sans-serif", flexShrink: 0 },

  // Create / Join form
  formCard:  { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.25rem 1.5rem' },
  formTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '0.95rem', color: '#c9a84c', letterSpacing: '0.1em', marginBottom: '0.85rem' },
  formRow:   { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  input:     { flex: 1, minWidth: '200px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '7px', padding: '0.65rem 0.9rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', color: '#e8f0e8', outline: 'none', boxSizing: 'border-box' },

  // Empty state
  emptyCard:  { background: '#162a1a', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '10px', padding: '3rem 2rem', textAlign: 'center' },
  emptyIcon:  { fontSize: '2.5rem', marginBottom: '0.75rem' },
  emptyTitle: { fontWeight: '600', color: '#e8f0e8', fontSize: '1rem', marginBottom: '0.35rem' },
  emptySub:   { fontSize: '0.875rem', color: '#7a9e85', lineHeight: 1.5 },

  // Group cards
  groupsList:       { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  groupCard:        { background: '#162a1a', border: '1px solid rgba(201,168,76,0.2)', borderLeft: '4px solid rgba(201,168,76,0.2)', borderRadius: '8px', padding: '1.1rem 1.25rem', transition: 'border-color 0.2s' },
  groupCardActive:  { borderColor: '#c9a84c', borderLeftColor: '#c9a84c' },
  groupCardTop:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' },
  groupCardLeft:    { flex: 1, minWidth: 0 },
  groupCardName:    { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: '#e8f0e8', letterSpacing: '0.05em', marginBottom: '0.2rem' },
  groupCardMeta:    { fontSize: '0.8rem', color: '#7a9e85', display: 'flex', alignItems: 'center', gap: '0.5rem' },
  groupCardActions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  founderBadge:     { background: 'rgba(201,168,76,0.12)', color: '#c9a84c', fontSize: '0.68rem', fontWeight: '700', padding: '0.15rem 0.55rem', borderRadius: '999px', letterSpacing: '0.06em', textTransform: 'uppercase' },
  inviteRow:        { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  inviteLabel:      { fontSize: '0.65rem', fontWeight: '700', letterSpacing: '0.1em', color: '#5a8a5a', textTransform: 'uppercase' },
  inviteCode:       { fontFamily: 'monospace', fontSize: '0.85rem', color: '#c9a84c', background: 'rgba(201,168,76,0.06)', padding: '0.2rem 0.55rem', borderRadius: '4px', border: '1px solid rgba(201,168,76,0.15)', letterSpacing: '0.05em' },

  // Leaderboard card
  card:       { background: '#162a1a', border: '1px solid #c9a84c', borderLeft: '4px solid #c9a84c', borderRadius: '8px', padding: '1.25rem 1.5rem' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' },
  cardTitle:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.15rem', color: '#e8f0e8', letterSpacing: '0.05em' },
  cardBadge:  { fontSize: '0.72rem', fontWeight: '700', color: '#7a9e85', background: 'rgba(0,0,0,0.25)', padding: '0.25rem 0.75rem', borderRadius: '999px', border: '1px solid rgba(201,168,76,0.12)' },
  lbList:     { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  lbRow:      { display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.65rem 0.75rem', borderRadius: '6px', background: 'rgba(0,0,0,0.15)' },
  lbRowMe:    { background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.2)' },
  lbRank:     { fontSize: '1.1rem', minWidth: '32px', textAlign: 'center' },
  lbName:     { flex: 1, fontSize: '0.9rem', color: '#e8f0e8', fontWeight: '500' },
  lbPoints:   { fontSize: '0.875rem', color: '#c9a84c', fontWeight: '700', fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.05rem', letterSpacing: '0.04em' },

  // Mobile bar
  mobileBar:        { position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0d1f0d', borderTop: '1px solid rgba(201,168,76,0.15)', display: 'none', justifyContent: 'space-around', alignItems: 'center', padding: '0.5rem 0', zIndex: 100 },
  mobileBarItem:     { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '0.25rem 0.5rem', color: '#5a8a5a', textDecoration: 'none', fontSize: '1.1rem', flex: 1 },
  mobileBarItemActive:{ color: '#c9a84c' },
  mobileBarLabel:    { fontSize: '0.62rem', fontWeight: '600', letterSpacing: '0.04em' },
}
