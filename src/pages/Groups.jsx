import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { currentUser } from '../lib/session.js'
import { cleanCode } from '../lib/invite.js'
import { loadMembers, loadStandings } from '../lib/groupStandings.js'
import { standingLine, playersLine, circlesFor } from '../lib/groupsView.js'
import { shareInvite } from '../lib/groupShare.js'
import { useCompetition } from '../context/competition.js'
import TopNav from '../components/TopNav.jsx'
import BottomNav from '../components/BottomNav.jsx'
import Sheet from '../components/groups/Sheet.jsx'
import '../styles/groups.css'

function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3.5" />
      <path d="M8 7.2 12 3.2l4 4" />
      <path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7a1.5 1.5 0 0 0-1.5-1.5H16" />
    </svg>
  )
}

export default function Groups() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { setCompetition } = useCompetition()

  const [user, setUser] = useState(null)
  const [groups, setGroups] = useState(null)       // null while loading
  const [loadError, setLoadError] = useState(false)
  const [sheet, setSheet] = useState(null)         // { type: 'create' | 'options' | 'leave' | 'created', id?, group? }
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  const loadId = useRef(0)

  function showToast(text) {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function init() {
    // An old-style invite link (/groups?join=CODE) goes to the invite page, which keeps the
    // code through sign-up and joins for you.
    const inviteParam = cleanCode(searchParams.get('join'))
    if (inviteParam) { navigate(`/join/${encodeURIComponent(inviteParam)}`, { replace: true }); return }

    const u = await currentUser()
    if (!u) { navigate('/auth'); return }
    setUser(u)
    await loadMyGroups(u.id)
  }

  // ── Load the groups the player belongs to ─────────────────────
  // Cards appear as soon as the groups and their members are known; the "You're 2nd of 9"
  // line and member circles fill in when the standings arrive.
  async function loadMyGroups(userId) {
    const id = ++loadId.current
    const { data: memberships, error } = await supabase
      .from('group_members')
      .select('is_founder, joined_at, groups(id, name, invite_code, created_by, created_at)')
      .eq('user_id', userId)
    if (id !== loadId.current) return
    if (error) { setLoadError(true); setGroups([]); return }
    setLoadError(false)

    const mine = (memberships || [])
      .filter(m => m.groups)
      .map(m => ({ ...m.groups, isFounder: m.is_founder, joinedAt: m.joined_at }))
      .sort((a, b) => String(b.joinedAt || '').localeCompare(String(a.joinedAt || '')))
    const members = await loadMembers(mine.map(g => g.id))
    if (id !== loadId.current) return
    setGroups(mine.map(g => ({ ...g, memberCount: members[g.id]?.length || 0, info: null })))
    if (!mine.length) return

    let standings = null
    try { standings = await loadStandings(userId, members) } catch { /* shown as "See the group table" */ }
    if (id !== loadId.current) return
    setGroups(prev => prev && prev.map(g => ({ ...g, info: standings?.[g.id] || { failed: true } })))
  }

  // ── Open a group's table on the Leaderboard ───────────────────
  function openTable(group) {
    setCompetition('group', group.id)
    navigate('/league')
  }

  // ── Create group ──────────────────────────────────────────────
  async function handleCreate(e) {
    e.preventDefault()
    const name = createName.trim()
    if (!name || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const { data: group, error: gErr } = await supabase
        .from('groups')
        .insert({ name, created_by: user.id })
        .select()
        .single()
      if (gErr) throw gErr

      const { error: mErr } = await supabase
        .from('group_members')
        .insert({ group_id: group.id, user_id: user.id, is_founder: true })
      if (mErr) throw mErr

      setSheet(null)
      setCreateName('')
      loadMyGroups(user.id)   // the new card appears while the share sheet opens

      // Straight after the tap, so the phone lets the share sheet open. If it refuses, offer a button.
      const result = await shareInvite(group, { copyOnBlocked: false })
      if (result === 'copied') showToast('Invite link copied')
      else if (result === 'blocked') setSheet({ type: 'created', group })
    } catch (err) {
      setCreateError(err.message || 'Failed to create group.')
    } finally {
      setCreating(false)
    }
  }

  // ── Share the invite link (/join/CODE) ────────────────────────
  async function handleInvite(group) {
    const result = await shareInvite(group)
    if (result === 'copied') showToast('Invite link copied')
    else if (result === 'failed') showToast('Couldn’t share the link')
  }

  async function handleCopyCode(group) {
    setSheet(null)
    try {
      await navigator.clipboard.writeText(String(group.invite_code).toUpperCase())
      showToast('Copied')
    } catch {
      showToast('Couldn’t copy the code')
    }
  }

  // ── Leave group ───────────────────────────────────────────────
  async function handleLeave(group) {
    if (leaving) return
    setLeaving(true)
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('user_id', user.id)
      .eq('group_id', group.id)
    setLeaving(false)
    setSheet(null)
    if (error) { showToast('Couldn’t leave the group. Try again.'); return }
    showToast(`You left ${group.name}`)
    await loadMyGroups(user.id)
  }

  const back = () => (location.key === 'default' ? navigate('/dashboard') : navigate(-1))
  const closeSheet = () => setSheet(null)
  const optionsGroup = sheet && (sheet.type === 'options' || sheet.type === 'leave') ? groups?.find(g => g.id === sheet.id) : null

  const actions = (
    <div className="gr-actions">
      <button type="button" className="gr-btn gr-btn--solid" onClick={() => { setCreateError(''); setSheet({ type: 'create' }) }}>Create a group</button>
      <button type="button" className="gr-btn gr-btn--outline" onClick={() => navigate('/join')}>Join with a code</button>
    </div>
  )

  return (
    <div className="app-page gr">
      <TopNav />

      <main className="gr-main">
        <div className="gr-head">
          <button type="button" className="gr-back" onClick={back}>&lsaquo; Back</button>
          <h1 className="gr-title">Groups</h1>
          <p className="gr-lede">Your private leagues with your mates.</p>
        </div>

        {groups !== null && groups.length > 0 && actions}

        {groups === null && (
          <ul className="gr-list" aria-busy="true" aria-label="Loading your groups">
            {[0, 1].map(k => <li key={k} className="gr-card gr-card--skel" aria-hidden="true" />)}
          </ul>
        )}

        {loadError && (
          <div className="gr-error" role="alert">
            We couldn&rsquo;t load your groups.{' '}
            <button type="button" className="gr-inline" onClick={() => { setGroups(null); setLoadError(false); loadMyGroups(user.id) }}>Try again</button>
          </div>
        )}

        {groups !== null && groups.length === 0 && !loadError && (
          <section className="gr-empty">
            <h2 className="gr-empty__title">No groups yet</h2>
            <p className="gr-empty__text">Start one and invite your mates, or join with a code from a mate.</p>
            {actions}
          </section>
        )}

        {groups !== null && groups.length > 0 && (
          <ul className="gr-list">
            {groups.map(g => {
              const circles = circlesFor(g.info, user?.id)
              const line = standingLine(g.info)
              return (
                <li key={g.id} className="gr-card">
                  <div className="gr-card__top">
                    <div className="gr-card__title">
                      <button type="button" className="gr-name" onClick={() => openTable(g)}>{g.name}</button>
                      <p className="gr-sub">{playersLine(g.memberCount, g.isFounder)}</p>
                    </div>
                    <button
                      type="button" className="gr-more" aria-label="Group options" aria-haspopup="dialog"
                      data-return={`opts-${g.id}`}
                      onClick={() => setSheet({ type: 'options', id: g.id })}
                    >&middot;&middot;&middot;</button>
                  </div>

                  <button type="button" className="gr-standing" onClick={() => openTable(g)}>
                    <span className="gr-circles" aria-hidden="true">
                      {circles.map(c => <span key={c.id} className={`gr-circle${c.isMe ? ' gr-circle--me' : ''}`}>{c.initials}</span>)}
                    </span>
                    {line ? <span className="gr-standing__text">{line}</span> : <span className="gr-standing__text gr-skel-line" aria-hidden="true" />}
                    <span className="gr-standing__cta">Table &rsaquo;</span>
                  </button>

                  <button type="button" className="gr-invite" onClick={() => handleInvite(g)}>
                    <ShareIcon />Invite mates
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      <BottomNav />

      {toast && <div className="gr-toast" role="status">{toast}</div>}

      {sheet?.type === 'create' && (
        <Sheet onClose={closeSheet} labelledBy="gr-sheet-title">
          <h2 className="gr-sheet__title" id="gr-sheet-title">Create a group</h2>
          <form className="gr-form" onSubmit={handleCreate}>
            <label className="gr-label" htmlFor="gr-name-input">Group name</label>
            <input
              id="gr-name-input" className="gr-input" type="text" autoComplete="off" enterKeyHint="done" data-autofocus
              value={createName} onChange={e => { setCreateName(e.target.value); setCreateError('') }}
              aria-describedby={createError ? 'gr-create-error' : undefined}
            />
            {createError && <p className="gr-error gr-error--tight" id="gr-create-error" role="alert">{createError}</p>}
            <button type="submit" className="gr-btn gr-btn--solid" disabled={!createName.trim() || creating}>{creating ? 'Creating…' : 'Create group'}</button>
          </form>
        </Sheet>
      )}

      {sheet?.type === 'options' && optionsGroup && (
        <Sheet onClose={closeSheet} labelledBy="gr-sheet-title" returnKey={`opts-${optionsGroup.id}`}>
          <h2 className="gr-sheet__title gr-sheet__title--wrap" id="gr-sheet-title">{optionsGroup.name}</h2>
          <div className="gr-rows">
            <button type="button" className="gr-row" onClick={() => { closeSheet(); openTable(optionsGroup) }}>
              <span>View group table</span><span className="gr-row__chev" aria-hidden="true">&rsaquo;</span>
            </button>
            <button type="button" className="gr-row" onClick={() => handleCopyCode(optionsGroup)}>
              <span>Copy invite code</span><span className="gr-code">{String(optionsGroup.invite_code).toUpperCase()}</span>
            </button>
            <button type="button" className="gr-row gr-row--danger" onClick={() => setSheet({ type: 'leave', id: optionsGroup.id })}>
              <span>Leave group</span>
            </button>
          </div>
        </Sheet>
      )}

      {sheet?.type === 'leave' && optionsGroup && (
        <Sheet onClose={closeSheet} labelledBy="gr-sheet-title" returnKey={`opts-${optionsGroup.id}`}>
          <h2 className="gr-sheet__title gr-sheet__title--wrap" id="gr-sheet-title">Leave {optionsGroup.name}?</h2>
          <p className="gr-sheet__text">You&rsquo;ll come off the group table. Your Saturday League points aren&rsquo;t affected, and you can rejoin with the code.</p>
          <div className="gr-actions gr-actions--stack">
            <button type="button" className="gr-btn gr-btn--danger" onClick={() => handleLeave(optionsGroup)} disabled={leaving}>{leaving ? 'Leaving…' : 'Leave group'}</button>
            <button type="button" className="gr-btn gr-btn--text" onClick={closeSheet}>Cancel</button>
          </div>
        </Sheet>
      )}

      {sheet?.type === 'created' && (
        <Sheet onClose={closeSheet} labelledBy="gr-sheet-title">
          <h2 className="gr-sheet__title gr-sheet__title--wrap" id="gr-sheet-title">{sheet.group.name} is ready</h2>
          <p className="gr-sheet__text">Send your mates the invite link so they can join.</p>
          <div className="gr-actions gr-actions--stack">
            <button type="button" className="gr-btn gr-btn--solid" data-autofocus onClick={async () => { closeSheet(); await handleInvite(sheet.group) }}>Share invite link</button>
            <button type="button" className="gr-btn gr-btn--text" onClick={closeSheet}>Done</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
