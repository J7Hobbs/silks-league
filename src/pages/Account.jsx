import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { OneSignal, oneSignalReady } from '../lib/oneSignal'
import ProfileDropdown from '../components/ProfileDropdown.jsx'

const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
const IS_IOS_STANDALONE = window.navigator.standalone === true

const USERNAME_REGEX = /^[a-zA-Z0-9]{3,20}$/

export default function Account() {
  const navigate = useNavigate()

  const [user,    setUser]    = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [profile, setProfile] = useState(null)   // { username }
  const [loading, setLoading] = useState(true)

  // ── Username edit ─────────────────────────────────────────────
  const [newUn,     setNewUn]     = useState('')
  const [unStatus,  setUnStatus]  = useState(null)
  const [unSaving,  setUnSaving]  = useState(false)
  const [unMsg,     setUnMsg]     = useState(null)
  const unTimer = useRef(null)

  // ── Password change ───────────────────────────────────────────
  const [curPwd,   setCurPwd]   = useState('')
  const [newPwd,   setNewPwd]   = useState('')
  const [confPwd,  setConfPwd]  = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdMsg,   setPwdMsg]   = useState(null)

  // ── Toast ─────────────────────────────────────────────────────
  const [toast, setToast] = useState(null)

  // ── Notifications ──────────────────────────────────────────────
  const [notifSupported, setNotifSupported] = useState(false)
  const [notifPermission, setNotifPermission] = useState('default') // 'default' | 'granted' | 'denied'
  const [notifOptedIn, setNotifOptedIn] = useState(false)
  const [notifLoading, setNotifLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { navigate('/auth'); return }
      setUser(user)
      const { data: prof } = await supabase
        .from('profiles').select('is_admin, username').eq('id', user.id).single()
      setIsAdmin(prof?.is_admin || false)
      setProfile(prof)
      setNewUn(prof?.username || '')
      setLoading(false)
    })
  }, [navigate])

  // ── Username availability check ───────────────────────────────
  useEffect(() => {
    const val = newUn.trim()
    if (!val) { setUnStatus(null); return }
    if (!USERNAME_REGEX.test(val)) { setUnStatus('invalid'); return }
    if (val === profile?.username) { setUnStatus('current'); return }
    setUnStatus('checking')
    clearTimeout(unTimer.current)
    unTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles').select('id').eq('username', val).maybeSingle()
      setUnStatus(data ? 'taken' : 'ok')
    }, 400)
    return () => clearTimeout(unTimer.current)
  }, [newUn, profile?.username])

  function showToast(text, ok = true) {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Notification status ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    function syncStatus() {
      const supported = OneSignal.Notifications.isPushSupported()
      setNotifSupported(supported)
      if (!supported) return
      setNotifPermission(OneSignal.Notifications.permissionNative)
      setNotifOptedIn(!!OneSignal.User.PushSubscription.optedIn)
    }

    oneSignalReady().then(() => {
      if (cancelled) return
      syncStatus()
      OneSignal.Notifications.addEventListener('permissionChange', syncStatus)
      OneSignal.User.PushSubscription.addEventListener('change', syncStatus)
    })

    return () => {
      cancelled = true
      if (OneSignal.Notifications?.removeEventListener) {
        OneSignal.Notifications.removeEventListener('permissionChange', syncStatus)
        OneSignal.User.PushSubscription.removeEventListener('change', syncStatus)
      }
    }
  }, [])

  async function toggleNotifications() {
    if (notifLoading) return

    if (notifOptedIn) {
      setNotifLoading(true)
      await OneSignal.User.PushSubscription.optOut()
      setNotifOptedIn(false)
      setNotifLoading(false)
      showToast('Notifications turned off')
      return
    }

    if (notifPermission === 'denied') {
      showToast('Notifications are blocked — enable them in your browser settings first.', false)
      return
    }

    setNotifLoading(true)
    const granted = await OneSignal.Notifications.requestPermission()
    setNotifPermission(OneSignal.Notifications.permissionNative)
    if (granted) {
      await OneSignal.User.PushSubscription.optIn()
      setNotifOptedIn(true)
      showToast('Notifications enabled')
    } else {
      setNotifOptedIn(false)
      showToast('Notifications weren\'t enabled', false)
    }
    setNotifLoading(false)
  }

  // ── Save username ─────────────────────────────────────────────
  async function saveUsername(e) {
    e.preventDefault()
    const val = newUn.trim()
    if (!USERNAME_REGEX.test(val)) { setUnMsg({ ok: false, text: 'Username must be 3–20 chars, letters & numbers only.' }); return }
    if (unStatus === 'taken')      { setUnMsg({ ok: false, text: 'That username is already taken.' }); return }
    if (unStatus !== 'ok' && unStatus !== 'current') { setUnMsg({ ok: false, text: 'Please wait for the availability check.' }); return }
    if (val === profile?.username) { setUnMsg({ ok: false, text: 'That\'s already your username.' }); return }
    setUnSaving(true)
    const { error } = await supabase.from('profiles').update({ username: val }).eq('id', user.id)
    setUnSaving(false)
    if (error) { setUnMsg({ ok: false, text: error.message }); return }
    setProfile(p => ({ ...p, username: val }))
    setUnMsg(null)
    showToast('Username updated!')
  }

  // ── Save password ─────────────────────────────────────────────
  async function savePassword(e) {
    e.preventDefault()
    if (!curPwd)            { setPwdMsg({ ok: false, text: 'Enter your current password.' }); return }
    if (newPwd.length < 6)  { setPwdMsg({ ok: false, text: 'New password must be at least 6 characters.' }); return }
    if (newPwd !== confPwd) { setPwdMsg({ ok: false, text: 'New passwords do not match.' }); return }
    setPwdSaving(true)
    // Verify current password
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: curPwd })
    if (authErr) { setPwdSaving(false); setPwdMsg({ ok: false, text: 'Current password is incorrect.' }); return }
    const { error } = await supabase.auth.updateUser({ password: newPwd })
    setPwdSaving(false)
    if (error) { setPwdMsg({ ok: false, text: error.message }); return }
    setCurPwd(''); setNewPwd(''); setConfPwd('')
    setPwdMsg(null)
    showToast('Password changed!')
  }

  function unHint() {
    if (unStatus === 'checking') return <span style={st.hintMuted}>Checking…</span>
    if (unStatus === 'ok')       return <span style={st.hintGreen}>✓ Available</span>
    if (unStatus === 'taken')    return <span style={st.hintRed}>✗ Already taken</span>
    if (unStatus === 'invalid')  return <span style={st.hintRed}>3–20 characters, letters and numbers only</span>
    if (unStatus === 'current')  return <span style={st.hintMuted}>Your current username</span>
    return null
  }

  if (loading) return <div style={{ background: '#0a1a08', minHeight: '100vh' }} />

  return (
    <div style={st.page}>

      {/* Toast */}
      {toast && (
        <div style={{ ...st.toast, ...(toast.ok ? st.toastOk : st.toastErr) }}>
          {toast.ok ? '✓ ' : '⚠ '}{toast.text}
        </div>
      )}

      {/* Nav */}
      <nav style={st.nav}>
        <div style={st.navInner}>
          <a href="/" style={st.navLogo}>Silks League</a>
          <div style={st.navLinks} className="app-nav-links">
            <a href="/dashboard" style={st.navLink}>Dashboard</a>
            <a href="/picks"     style={st.navLink}>My Picks</a>
            <a href="/league"    style={st.navLink}>League</a>
            <a href="/results"   style={st.navLink}>Results</a>
          </div>
          <div style={st.navRight}>
            <ProfileDropdown user={user} isAdmin={isAdmin} />
          </div>
        </div>
      </nav>

      <main style={st.main} className="app-main-pad">

        {/* Back + heading */}
        <div style={st.pageHead}>
          <button style={st.backBtn} onClick={() => navigate(-1)}>← Back</button>
          <h1 style={st.heading}>Account details</h1>
          <p style={st.sub}>Manage your username and password.</p>
        </div>

        {/* ── Username section ── */}
        <section style={st.card}>
          <h2 style={st.cardTitle}>Username</h2>
          <p style={st.cardSub}>Your username appears on leaderboards and group tables.</p>

          <form onSubmit={saveUsername} style={st.form}>
            <div style={st.fieldRow}>
              <input
                style={st.input}
                type="text"
                value={newUn}
                onChange={e => { setNewUn(e.target.value); setUnMsg(null) }}
                placeholder="Choose a username"
                maxLength={20}
              />
              <button
                type="submit"
                style={{ ...st.saveBtn, ...((unStatus !== 'ok' || unSaving) ? st.saveBtnOff : {}) }}
                disabled={unStatus !== 'ok' || unSaving}
              >
                {unSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div style={{ minHeight: '1.1rem', marginTop: '0.3rem' }}>{unHint()}</div>
            {unMsg && <div style={{ ...st.inlineMsg, color: unMsg.ok ? '#4ade80' : '#f87171' }}>{unMsg.text}</div>}
          </form>
        </section>

        {/* ── Password section ── */}
        <section style={st.card}>
          <h2 style={st.cardTitle}>Change password</h2>
          <p style={st.cardSub}>Choose a new password for your account.</p>

          <form onSubmit={savePassword} style={st.form}>
            <div style={st.formField}>
              <label style={st.label}>Current password</label>
              <input style={st.input} type="password" value={curPwd}
                onChange={e => { setCurPwd(e.target.value); setPwdMsg(null) }}
                placeholder="Your current password" autoComplete="current-password" />
            </div>
            <div style={st.formField}>
              <label style={st.label}>New password</label>
              <input style={st.input} type="password" value={newPwd}
                onChange={e => { setNewPwd(e.target.value); setPwdMsg(null) }}
                placeholder="Min. 6 characters" autoComplete="new-password" />
            </div>
            <div style={st.formField}>
              <label style={st.label}>Confirm new password</label>
              <input style={st.input} type="password" value={confPwd}
                onChange={e => { setConfPwd(e.target.value); setPwdMsg(null) }}
                placeholder="Re-enter new password" autoComplete="new-password" />
            </div>

            {pwdMsg && (
              <div style={{ ...st.inlineMsg, color: pwdMsg.ok ? '#4ade80' : '#f87171' }}>{pwdMsg.text}</div>
            )}

            <button type="submit"
              style={{ ...st.saveBtn, ...(pwdSaving ? st.saveBtnOff : {}), marginTop: '0.25rem' }}
              disabled={pwdSaving}>
              {pwdSaving ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </section>

        {/* ── Notifications section ── */}
        <section style={st.card}>
          <h2 style={st.cardTitle}>Notifications</h2>
          <p style={st.cardSub}>
            {notifSupported
              ? 'Get a reminder before Saturday picks close.'
              : IS_IOS && !IS_IOS_STANDALONE
                ? 'Add Silks League to your home screen first, then come back here to enable notifications.'
                : 'Notifications aren\'t supported in this browser.'}
          </p>

          {notifSupported && (
            <div style={st.switchRow}>
              <div>
                <div style={st.switchLabel}>Enable picks reminders</div>
                {notifPermission === 'denied' && (
                  <div style={st.hintRed}>Blocked in your browser settings</div>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifOptedIn}
                aria-label="Enable picks reminders"
                onClick={toggleNotifications}
                disabled={notifLoading || notifPermission === 'denied'}
                style={{
                  ...st.switchTrack,
                  ...(notifOptedIn ? st.switchTrackOn : {}),
                  ...((notifLoading || notifPermission === 'denied') ? st.switchDisabled : {}),
                }}
              >
                <span style={{ ...st.switchThumb, ...(notifOptedIn ? st.switchThumbOn : {}) }} />
              </button>
            </div>
          )}
        </section>

      </main>
    </div>
  )
}

const st = {
  page:       { minHeight: '100vh', background: '#0a1a08', fontFamily: "'DM Sans', sans-serif", color: '#e8f0e8', paddingBottom: '4rem' },
  toast:      { position: 'fixed', top: '1.25rem', right: '1.25rem', padding: '0.75rem 1.25rem', borderRadius: '9px', fontSize: '0.875rem', fontWeight: '600', zIndex: 9999, fontFamily: "'DM Sans', sans-serif", boxShadow: '0 8px 32px rgba(0,0,0,0.4)' },
  toastOk:    { background: '#162a1a', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' },
  toastErr:   { background: '#2a1212', border: '1px solid rgba(239,68,68,0.4)',  color: '#f87171' },
  nav:        { background: '#0d1f0d', borderBottom: '1px solid rgba(201,168,76,0.15)' },
  navInner:   { maxWidth: '900px', margin: '0 auto', padding: '0 1.5rem', height: '56px', display: 'flex', alignItems: 'center', gap: '1rem' },
  navLogo:    { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: '#c9a84c', letterSpacing: '0.1em', textDecoration: 'none' },
  navLinks:   { display: 'flex', gap: '0.25rem', flex: 1, justifyContent: 'center' },
  navLink:    { fontSize: '0.85rem', color: '#7a9e85', textDecoration: 'none', padding: '0.3rem 0.6rem', borderRadius: '5px' },
  navRight:   { marginLeft: 'auto' },
  main:       { maxWidth: '580px', margin: '0 auto', padding: '2rem 1.5rem' },
  pageHead:   { marginBottom: '2rem' },
  backBtn:    { background: 'none', border: 'none', color: '#5a8a5a', cursor: 'pointer', fontSize: '0.85rem', fontFamily: "'DM Sans', sans-serif", padding: 0, marginBottom: '0.75rem', display: 'block' },
  heading:    { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.2rem', color: '#e8f0e8', letterSpacing: '0.04em', marginBottom: '0.3rem' },
  sub:        { fontSize: '0.875rem', color: '#5a8a5a' },
  card:       { background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.15)', borderRadius: '14px', padding: '1.75rem', marginBottom: '1.25rem' },
  cardTitle:  { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.25rem', color: '#c9a84c', letterSpacing: '0.06em', marginBottom: '0.3rem' },
  cardSub:    { fontSize: '0.825rem', color: '#5a8a5a', marginBottom: '1.25rem', lineHeight: 1.5 },
  form:       { display: 'flex', flexDirection: 'column', gap: '0.85rem' },
  formField:  { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label:      { fontSize: '0.78rem', fontWeight: '600', color: '#5a8a5a', letterSpacing: '0.05em', textTransform: 'uppercase' },
  input:      { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '8px', padding: '0.8rem 1rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', color: '#e8f0e8', outline: 'none', width: '100%', boxSizing: 'border-box' },
  fieldRow:   { display: 'flex', gap: '0.65rem', alignItems: 'center' },
  saveBtn:    { background: '#c9a84c', color: '#0a1a08', fontWeight: '700', fontSize: '0.9rem', padding: '0.8rem 1.75rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' },
  saveBtnOff: { background: 'rgba(201,168,76,0.4)', cursor: 'not-allowed' },
  hintMuted:  { fontSize: '0.78rem', color: '#5a8a5a' },
  hintGreen:  { fontSize: '0.78rem', color: '#4ade80' },
  hintRed:    { fontSize: '0.78rem', color: '#f87171', marginTop: '0.2rem' },
  inlineMsg:  { fontSize: '0.82rem', lineHeight: 1.4 },
  switchRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  switchLabel:  { fontSize: '0.9rem', fontWeight: '600', color: '#e8f0e8' },
  switchTrack:  { width: '46px', height: '26px', borderRadius: '13px', background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)', position: 'relative', cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'background 0.15s ease' },
  switchTrackOn: { background: '#c9a84c', borderColor: '#c9a84c' },
  switchThumb:  { position: 'absolute', top: '2px', left: '2px', width: '20px', height: '20px', borderRadius: '50%', background: '#e8f0e8', transition: 'transform 0.15s ease' },
  switchThumbOn: { transform: 'translateX(20px)', background: '#0a1a08' },
  switchDisabled: { opacity: 0.5, cursor: 'not-allowed' },
}
