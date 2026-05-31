/**
 * ProfileDropdown — reusable nav avatar + dropdown
 *
 * Props:
 *   user      Supabase auth user object
 *   isAdmin   boolean — show Admin Panel link when true
 *
 * Handles: username display, edit username (with availability check),
 * change password, sign out.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const USERNAME_REGEX = /^[a-zA-Z0-9]{3,20}$/

export default function ProfileDropdown({ user, isAdmin }) {
  const navigate = useNavigate()
  const ref      = useRef(null)

  const [open,    setOpen]    = useState(false)
  const [profile, setProfile] = useState(null)   // { username }

  // Which inline form is open: null | 'username' | 'password'
  const [view, setView] = useState(null)

  // ── Shared feedback ───────────────────────────────────────────
  const [msg,    setMsg]    = useState(null)   // { ok: bool, text }
  const [saving, setSaving] = useState(false)

  // ── Username edit ─────────────────────────────────────────────
  const [newUn,     setNewUn]     = useState('')
  const [unStatus,  setUnStatus]  = useState(null)  // null|'checking'|'ok'|'taken'|'invalid'
  const unTimer = useRef(null)

  // ── Password change ───────────────────────────────────────────
  const [curPwd,  setCurPwd]  = useState('')
  const [newPwd,  setNewPwd]  = useState('')
  const [confPwd, setConfPwd] = useState('')

  // ── Load profile on mount ─────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return
    supabase.from('profiles').select('username').eq('id', user.id).single()
      .then(({ data }) => { if (data) setProfile(data) })
  }, [user?.id])

  // ── Click-outside closes dropdown ────────────────────────────
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setView(null)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // ── Username availability check (debounced) ───────────────────
  useEffect(() => {
    const val = newUn.trim()
    if (!val) { setUnStatus(null); return }
    if (!USERNAME_REGEX.test(val)) { setUnStatus('invalid'); return }
    // No need to check if it's the same as current
    if (val === profile?.username) { setUnStatus('ok'); return }
    setUnStatus('checking')
    clearTimeout(unTimer.current)
    unTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles').select('id').eq('username', val).maybeSingle()
      setUnStatus(data ? 'taken' : 'ok')
    }, 400)
    return () => clearTimeout(unTimer.current)
  }, [newUn, profile?.username])

  // ── Helpers ───────────────────────────────────────────────────
  const initial = (profile?.username || user?.user_metadata?.full_name || user?.email || '?')
    .charAt(0).toUpperCase()

  function openView(v) {
    setView(v)
    setMsg(null)
    if (v === 'username') {
      setNewUn(profile?.username || '')
      setUnStatus(null)
    }
    if (v === 'password') {
      setCurPwd(''); setNewPwd(''); setConfPwd('')
    }
  }

  function closeAll() { setView(null); setMsg(null) }

  // ── Save username ─────────────────────────────────────────────
  async function saveUsername() {
    const val = newUn.trim()
    if (!USERNAME_REGEX.test(val)) {
      setMsg({ ok: false, text: 'Username must be 3–20 chars, letters & numbers only.' }); return
    }
    if (unStatus === 'taken')    { setMsg({ ok: false, text: 'That username is already taken.' }); return }
    if (unStatus !== 'ok')       { setMsg({ ok: false, text: 'Please wait for availability check.' }); return }
    setSaving(true)
    const { error } = await supabase.from('profiles').update({ username: val }).eq('id', user.id)
    setSaving(false)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setProfile(p => ({ ...p, username: val }))
    setMsg({ ok: true, text: 'Username updated!' })
    setTimeout(() => { setView(null); setMsg(null) }, 1500)
  }

  // ── Save password ─────────────────────────────────────────────
  async function savePassword() {
    if (!curPwd)              { setMsg({ ok: false, text: 'Enter your current password.' }); return }
    if (newPwd.length < 6)    { setMsg({ ok: false, text: 'New password must be at least 6 characters.' }); return }
    if (newPwd !== confPwd)   { setMsg({ ok: false, text: 'New passwords do not match.' }); return }
    setSaving(true)
    // Verify current password by re-authenticating
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: user.email, password: curPwd,
    })
    if (authErr) {
      setSaving(false)
      setMsg({ ok: false, text: 'Current password is incorrect.' }); return
    }
    const { error } = await supabase.auth.updateUser({ password: newPwd })
    setSaving(false)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setMsg({ ok: true, text: 'Password changed!' })
    setTimeout(() => { setView(null); setMsg(null) }, 1500)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  // ── Username status indicator ─────────────────────────────────
  function unHint() {
    if (unStatus === 'checking') return <span style={ds.hint}>Checking…</span>
    if (unStatus === 'ok')       return <span style={{ ...ds.hint, color: '#4ade80' }}>✓ Available</span>
    if (unStatus === 'taken')    return <span style={{ ...ds.hint, color: '#f87171' }}>✗ Already taken</span>
    if (unStatus === 'invalid')  return <span style={{ ...ds.hint, color: '#f87171' }}>3–20 chars, letters & numbers only</span>
    return null
  }

  return (
    <div ref={ref} style={ds.wrap}>

      {/* ── Avatar circle ── */}
      <div style={ds.avatar} onClick={() => { setOpen(o => !o); setView(null); setMsg(null) }}>
        {initial}
      </div>

      {/* ── Dropdown ── */}
      {open && (
        <div style={ds.dropdown}>

          {/* Header — user info */}
          <div style={ds.header}>
            <div style={ds.username}>{profile?.username || '—'}</div>
            <div style={ds.email}>{user?.email}</div>
          </div>

          <div style={ds.divider} />

          {/* ── Edit username ── */}
          {view === 'username' ? (
            <div style={ds.form}>
              <div style={ds.formLabel}>Change username</div>
              <input
                style={ds.input}
                type="text"
                value={newUn}
                onChange={e => { setNewUn(e.target.value); setMsg(null) }}
                maxLength={20}
                autoFocus
                placeholder="New username"
              />
              <div style={{ minHeight: '1rem', marginBottom: '0.25rem' }}>{unHint()}</div>
              {msg && <div style={{ ...ds.inlineMsg, color: msg.ok ? '#4ade80' : '#f87171' }}>{msg.text}</div>}
              <div style={ds.formActions}>
                <button
                  style={{ ...ds.saveBtn, ...((unStatus !== 'ok' || saving) ? ds.saveBtnDisabled : {}) }}
                  onClick={saveUsername}
                  disabled={unStatus !== 'ok' || saving}
                >{saving ? 'Saving…' : 'Save'}</button>
                <button style={ds.cancelLink} onClick={closeAll}>Cancel</button>
              </div>
            </div>
          ) : (
            <button style={ds.menuItem} onClick={() => openView('username')}>
              ✏ Edit username
            </button>
          )}

          {/* ── Change password ── */}
          {view === 'password' ? (
            <div style={ds.form}>
              <div style={ds.formLabel}>Change password</div>
              <input style={ds.input} type="password" placeholder="Current password"
                value={curPwd} onChange={e => { setCurPwd(e.target.value); setMsg(null) }}
                autoFocus autoComplete="current-password" />
              <input style={{ ...ds.input, marginTop: '0.5rem' }} type="password" placeholder="New password (min 6)"
                value={newPwd} onChange={e => { setNewPwd(e.target.value); setMsg(null) }}
                autoComplete="new-password" />
              <input style={{ ...ds.input, marginTop: '0.5rem' }} type="password" placeholder="Confirm new password"
                value={confPwd} onChange={e => { setConfPwd(e.target.value); setMsg(null) }}
                autoComplete="new-password" />
              {msg && <div style={{ ...ds.inlineMsg, marginTop: '0.4rem', color: msg.ok ? '#4ade80' : '#f87171' }}>{msg.text}</div>}
              <div style={ds.formActions}>
                <button
                  style={{ ...ds.saveBtn, ...(saving ? ds.saveBtnDisabled : {}) }}
                  onClick={savePassword}
                  disabled={saving}
                >{saving ? 'Saving…' : 'Save'}</button>
                <button style={ds.cancelLink} onClick={closeAll}>Cancel</button>
              </div>
            </div>
          ) : (
            <button style={ds.menuItem} onClick={() => openView('password')}>
              🔑 Change password
            </button>
          )}

          <div style={ds.divider} />

          {isAdmin && (
            <>
              <button style={{ ...ds.menuItem, color: '#c9a84c' }}
                onClick={() => { setOpen(false); navigate('/admin') }}>
                ⚙ Admin panel
              </button>
              <div style={ds.divider} />
            </>
          )}

          <button style={{ ...ds.menuItem, color: '#f87171' }} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

const ds = {
  wrap:     { position: 'relative', flexShrink: 0 },
  avatar:   {
    width: '36px', height: '36px', borderRadius: '50%',
    background: 'rgba(201,168,76,0.15)', border: '1.5px solid rgba(201,168,76,0.5)',
    color: '#c9a84c', fontSize: '0.875rem', fontWeight: '700',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', userSelect: 'none', transition: 'background 0.15s',
    fontFamily: "'DM Sans', sans-serif",
  },
  dropdown: {
    position: 'absolute', top: 'calc(100% + 10px)', right: 0,
    minWidth: '260px', background: '#162a1a',
    border: '1px solid #c9a84c', borderRadius: '10px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    zIndex: 9999, overflow: 'hidden',
    fontFamily: "'DM Sans', sans-serif",
  },
  header:   { padding: '0.9rem 1rem 0.75rem' },
  username: { fontSize: '0.95rem', fontWeight: '700', color: '#c9a84c', lineHeight: 1.2 },
  email:    { fontSize: '0.78rem', color: '#7a9e85', marginTop: '0.2rem' },
  divider:  { height: '1px', background: 'rgba(201,168,76,0.15)', margin: '0 0' },
  menuItem: {
    display: 'block', width: '100%', padding: '0.7rem 1rem',
    background: 'transparent', border: 'none', cursor: 'pointer',
    textAlign: 'left', fontSize: '0.875rem', color: '#e8f0e8',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'background 0.12s',
    // hover handled inline — CSS :hover not available in inline styles
  },
  form:     { padding: '0.75rem 1rem' },
  formLabel:{ fontSize: '0.72rem', fontWeight: '700', color: '#5a8a5a', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.5rem' },
  input:    {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(201,168,76,0.25)',
    borderRadius: '6px', padding: '0.55rem 0.75rem',
    fontSize: '0.85rem', color: '#e8f0e8', outline: 'none',
    fontFamily: "'DM Sans', sans-serif",
  },
  hint:     { fontSize: '0.72rem', color: '#5a8a5a' },
  inlineMsg:{ fontSize: '0.75rem', lineHeight: 1.4 },
  formActions: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.6rem' },
  saveBtn:  {
    background: '#c9a84c', color: '#0a1a08', border: 'none',
    borderRadius: '6px', padding: '0.45rem 1.1rem',
    fontSize: '0.825rem', fontWeight: '700', cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  saveBtnDisabled: { background: 'rgba(201,168,76,0.4)', cursor: 'not-allowed' },
  cancelLink:{ background: 'none', border: 'none', color: '#7a9e85', fontSize: '0.8rem', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", padding: 0, textDecoration: 'underline' },
}
