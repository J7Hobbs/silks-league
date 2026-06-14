/**
 * Silks League — Auth Page (Login + Sign Up)
 *
 * Signup collects: full_name, username, email, password
 * Username is stored in profiles.username after account creation.
 * On login, if profile has no username set, a modal prompts them to set one.
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function friendlyError(err) {
  const msg = err?.message || ''
  if (msg === 'Failed to fetch')
    return 'Cannot connect to the server. The Supabase project may be paused.'
  if (msg.toLowerCase().includes('user already registered') ||
      msg.toLowerCase().includes('already been registered') ||
      msg.toLowerCase().includes('email address is already'))
    return 'An account with this email already exists. Please log in instead.'
  if (msg.toLowerCase().includes('invalid login credentials') ||
      msg.toLowerCase().includes('invalid email or password'))
    return 'Incorrect email or password. Please try again.'
  if (msg.toLowerCase().includes('email not confirmed'))
    return 'Please check your email and click the confirmation link before logging in.'
  if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many'))
    return 'Too many attempts. Please wait a few minutes and try again.'
  if (msg.toLowerCase().includes('database error'))
    return 'There was a problem creating your account. Please try again or contact support.'
  return msg || 'Something went wrong. Please try again.'
}

const USERNAME_REGEX = /^[a-zA-Z0-9]{3,20}$/

export default function Auth() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'login')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  const [form, setForm] = useState({
    fullName: '', username: '', email: '', password: '', confirmPassword: '',
  })

  // ── Username availability check ──────────────────────────────
  const [unStatus, setUnStatus] = useState(null) // null | 'checking' | 'ok' | 'taken' | 'invalid'
  const unTimer = useRef(null)

  useEffect(() => {
    const val = form.username.trim()
    if (!val || mode !== 'signup') { setUnStatus(null); return }
    if (!USERNAME_REGEX.test(val)) { setUnStatus('invalid'); return }
    setUnStatus('checking')
    clearTimeout(unTimer.current)
    unTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles').select('id').eq('username', val).maybeSingle()
      setUnStatus(data ? 'taken' : 'ok')
    }, 450)
    return () => clearTimeout(unTimer.current)
  }, [form.username, mode])

  // ── Username-setup modal (for existing users with no username) ─
  const [showUnModal, setShowUnModal]   = useState(false)
  const [modalUn, setModalUn]           = useState('')
  const [modalUnStatus, setModalUnStatus] = useState(null)
  const [modalUserId, setModalUserId]   = useState(null)
  const [modalDest, setModalDest]       = useState('/dashboard')
  const modalTimer = useRef(null)

  useEffect(() => {
    const val = modalUn.trim()
    if (!val) { setModalUnStatus(null); return }
    if (!USERNAME_REGEX.test(val)) { setModalUnStatus('invalid'); return }
    setModalUnStatus('checking')
    clearTimeout(modalTimer.current)
    modalTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles').select('id').eq('username', val).maybeSingle()
      setModalUnStatus(data ? 'taken' : 'ok')
    }, 450)
    return () => clearTimeout(modalTimer.current)
  }, [modalUn])

  const update = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (mode === 'signup') {
      if (!form.fullName.trim())        { setError('Please enter your full name.'); return }
      if (!form.username.trim())        { setError('Please choose a username.'); return }
      if (!USERNAME_REGEX.test(form.username.trim())) {
        setError('Username must be 3–20 characters, letters and numbers only.'); return
      }
      if (unStatus === 'taken')         { setError('That username is already taken.'); return }
      if (unStatus === 'checking')      { setError('Still checking username — please wait a moment.'); return }
      if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return }
      if (form.password.length < 6)    { setError('Password must be at least 6 characters.'); return }
    }

    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.fullName.trim(), username: form.username.trim() } },
        })
        if (signUpError) throw signUpError

        // Try to save username to profiles immediately (works if email confirmation is disabled)
        // If it fails it's fine — the modal will prompt on first login
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            await supabase.from('profiles')
              .update({ username: form.username.trim(), full_name: form.fullName.trim(), email: form.email.trim() })
              .eq('id', user.id)
          }
        } catch (_) {}

        setSuccess('Account created! Check your email to confirm, then log in.')
        setMode('login')
        setForm({ fullName: '', username: '', email: form.email, password: '', confirmPassword: '' })

      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        })
        if (signInError) throw signInError

        const uid = data.user?.id
        if (uid) {
          const { data: prof } = await supabase
            .from('profiles').select('has_onboarded, username').eq('id', uid).single()

          // If username is missing, save it from metadata if available
          if (!prof?.username) {
            const metaUsername = data.user?.user_metadata?.username
            if (metaUsername) {
              await supabase.from('profiles').update({ username: metaUsername }).eq('id', uid)
              // Head to normal destination
              navigate(prof?.has_onboarded ? '/dashboard' : '/groups?welcome=1')
            } else {
              // Show modal to set username
              setModalUserId(uid)
              setModalDest(prof?.has_onboarded ? '/dashboard' : '/groups?welcome=1')
              setLoading(false)
              setShowUnModal(true)
              return
            }
          } else {
            navigate(prof?.has_onboarded ? '/dashboard' : '/groups?welcome=1')
          }
        } else {
          navigate('/dashboard')
        }
      }
    } catch (err) {
      console.error('[Auth] error:', err)
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSaveModalUsername = async () => {
    const val = modalUn.trim()
    if (!USERNAME_REGEX.test(val))  { return }
    if (modalUnStatus !== 'ok')     { return }
    setLoading(true)
    const { error } = await supabase.from('profiles')
      .update({ username: val }).eq('id', modalUserId)
    setLoading(false)
    if (error) { setError('Could not save username. Please try again.'); return }
    setShowUnModal(false)
    navigate(modalDest)
  }

  // ── Username status indicator ─────────────────────────────────
  const unIndicator = (status) => {
    if (status === 'checking') return <span style={s.unChecking}>Checking…</span>
    if (status === 'ok')       return <span style={s.unOk}>✓ Available</span>
    if (status === 'taken')    return <span style={s.unTaken}>✗ Already taken</span>
    if (status === 'invalid')  return <span style={s.unTaken}>3–20 chars, letters & numbers only</span>
    return null
  }

  return (
    <div style={s.page}>
      <div style={s.card}>

        {/* Username-setup modal */}
        {showUnModal && (
          <div style={s.modalOverlay}>
            <div style={s.modal}>
              <div style={s.modalTitle}>Choose a username</div>
              <p style={s.modalSub}>This is how you'll appear on leaderboards. You can change it later in your profile.</p>
              <input
                style={s.input}
                type="text"
                placeholder="e.g. jackh99"
                value={modalUn}
                onChange={e => setModalUn(e.target.value)}
                autoFocus
                maxLength={20}
              />
              <div style={{ minHeight: '1.2rem', marginTop: '0.35rem' }}>{unIndicator(modalUnStatus)}</div>
              <button
                style={{ ...s.submitBtn, marginTop: '1rem', ...(modalUnStatus !== 'ok' || loading ? s.submitBtnLoading : {}) }}
                disabled={modalUnStatus !== 'ok' || loading}
                onClick={handleSaveModalUsername}
              >
                {loading ? 'Saving…' : 'Save username →'}
              </button>
              <button
                style={{ ...s.toggleLink, display: 'block', marginTop: '0.75rem', textAlign: 'center' }}
                onClick={() => { setShowUnModal(false); navigate(modalDest) }}
                type="button"
              >
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* Logo */}
        <div style={s.logo}>Silks League</div>

        {/* Tabs */}
        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(mode === 'login' ? s.tabActive : {}) }}
            onClick={() => { setMode('login'); setError(''); setSuccess('') }} type="button">
            Log in
          </button>
          <button style={{ ...s.tab, ...(mode === 'signup' ? s.tabActive : {}) }}
            onClick={() => { setMode('signup'); setError(''); setSuccess('') }} type="button">
            Sign up
          </button>
        </div>

        <h1 style={s.heading}>{mode === 'login' ? 'Welcome back.' : 'Join for free.'}</h1>
        <p style={s.sub}>{mode === 'login' ? 'Log in to see your group and picks.' : 'Create an account to start playing.'}</p>

        {success && <div style={s.successBox}>{success}</div>}
        {error   && <div style={s.errorBox}>{error}</div>}

        <form onSubmit={handleSubmit} style={s.form}>
          {mode === 'signup' && (
            <div style={s.field}>
              <label style={s.label}>Full name</label>
              <input style={s.input} type="text" placeholder="Jack Hobbs"
                value={form.fullName} onChange={update('fullName')} required autoComplete="name" />
            </div>
          )}

          {mode === 'signup' && (
            <div style={s.field}>
              <label style={s.label}>Username</label>
              <input style={s.input} type="text" placeholder="e.g. jackh99"
                value={form.username}
                onChange={e => { update('username')(e); setError('') }}
                required maxLength={20} autoComplete="off"
              />
              <div style={{ minHeight: '1.1rem' }}>{unIndicator(unStatus)}</div>
            </div>
          )}

          <div style={s.field}>
            <label style={s.label}>Email address</label>
            <input style={s.input} type="email" placeholder="you@example.com"
              value={form.email} onChange={update('email')} required autoComplete="email" />
          </div>

          <div style={s.field}>
            <label style={s.label}>Password</label>
            <input style={s.input} type="password"
              placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
              value={form.password} onChange={update('password')} required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </div>

          {mode === 'signup' && (
            <div style={s.field}>
              <label style={s.label}>Confirm password</label>
              <input style={s.input} type="password" placeholder="Re-enter your password"
                value={form.confirmPassword} onChange={update('confirmPassword')} required
                autoComplete="new-password" />
            </div>
          )}

          <button type="submit"
            style={{ ...s.submitBtn, ...(loading ? s.submitBtnLoading : {}) }}
            disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Log in →' : 'Create account →'}
          </button>
        </form>

        <p style={s.toggleText}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" style={s.toggleLink}
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setSuccess('') }}>
            {mode === 'login' ? 'Sign up free' : 'Log in'}
          </button>
        </p>

        <a href="/" style={s.backLink}>← Back to home</a>
      </div>
    </div>
  )
}

const s = {
  page:    { minHeight: '100vh', background: '#0a1a08', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', fontFamily: "'DM Sans', sans-serif" },
  card:    { background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '18px', padding: '2.5rem', width: '100%', maxWidth: '420px', boxShadow: '0 24px 80px rgba(0,0,0,0.5)', position: 'relative' },
  logo:    { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: '#c9a84c', letterSpacing: '0.1em', marginBottom: '1.75rem' },
  tabs:    { display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '3px', gap: '3px', marginBottom: '1.75rem', border: '1px solid rgba(201,168,76,0.15)' },
  tab:     { flex: 1, padding: '0.55rem 1rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: '500', background: 'transparent', color: '#5a8a5a', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.2s' },
  tabActive: { background: '#c9a84c', color: '#0a1a08', fontWeight: '600' },
  heading: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.2rem', color: '#e8f0e8', letterSpacing: '0.03em', marginBottom: '0.4rem', lineHeight: 1.05 },
  sub:     { fontSize: '0.875rem', color: '#5a8a5a', marginBottom: '1.75rem' },
  successBox: { background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: '8px', padding: '0.85rem 1rem', fontSize: '0.875rem', color: '#4ade80', marginBottom: '1.25rem', lineHeight: 1.5 },
  errorBox:   { background: 'rgba(239,68,68,0.1)',  border: '1px solid rgba(239,68,68,0.3)',  borderRadius: '8px', padding: '0.85rem 1rem', fontSize: '0.875rem', color: '#f87171', marginBottom: '1.25rem', lineHeight: 1.5 },
  form:    { display: 'flex', flexDirection: 'column', gap: '1rem' },
  field:   { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  label:   { fontSize: '0.8rem', fontWeight: '600', color: '#5a8a5a', letterSpacing: '0.04em', textTransform: 'uppercase' },
  input:   { background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: '8px', padding: '0.85rem 1rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', color: '#e8f0e8', outline: 'none', width: '100%', boxSizing: 'border-box' },
  submitBtn: { marginTop: '0.5rem', background: '#c9a84c', color: '#0a1a08', fontWeight: '600', fontSize: '1rem', padding: '0.9rem 2rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'background 0.2s', width: '100%' },
  submitBtnLoading: { background: 'rgba(201,168,76,0.5)', cursor: 'not-allowed' },
  toggleText: { marginTop: '1.25rem', fontSize: '0.85rem', color: '#5a8a5a', textAlign: 'center' },
  toggleLink: { background: 'none', border: 'none', color: '#c9a84c', fontWeight: '600', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem', padding: 0, textDecoration: 'underline' },
  backLink:   { display: 'block', marginTop: '1rem', textAlign: 'center', fontSize: '0.8rem', color: '#5a8a5a', textDecoration: 'none' },
  unOk:       { fontSize: '0.75rem', color: '#4ade80' },
  unTaken:    { fontSize: '0.75rem', color: '#f87171' },
  unChecking: { fontSize: '0.75rem', color: '#5a8a5a' },
  // Username modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem' },
  modal:  { background: '#0d1f0d', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: '360px', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' },
  modalTitle: { fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', color: '#c9a84c', letterSpacing: '0.05em', marginBottom: '0.5rem' },
  modalSub:   { fontSize: '0.85rem', color: '#5a8a5a', marginBottom: '1.25rem', lineHeight: 1.5 },
}
