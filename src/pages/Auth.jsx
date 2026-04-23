/**
 * Silks League — Auth Page (Login + Sign Up)
 *
 * ── HOW PROFILE CREATION WORKS ───────────────────────────────────────────────
 *
 *  The frontend does NOT manually insert into the profiles table.
 *  A Supabase database trigger handles this automatically:
 *
 *  1. User calls supabase.auth.signUp() here with email, password, full_name
 *  2. Supabase creates a row in auth.users
 *  3. The trigger on_auth_user_created fires at the database level
 *  4. The trigger inserts a row into public.profiles with:
 *       id            = new user's UUID
 *       full_name     = taken from raw_user_meta_data->>'full_name'
 *       is_admin      = false
 *       has_onboarded = false
 *  5. On first login, has_onboarded = false routes the user to /groups?welcome=1
 *  6. Once they create/join a group or skip, has_onboarded is set to true
 *
 *  To re-run the trigger setup: supabase/fix_signup.sql
 *
 * ── HOW ONBOARDING WORKS ─────────────────────────────────────────────────────
 *
 *  Login checks profiles.has_onboarded:
 *    - false → /groups?welcome=1  (first time only)
 *    - true  → /dashboard         (every login after that)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Map raw Supabase error messages to friendly user-facing ones ──────────────
function friendlyError(err, mode) {
  const msg = err?.message || ''

  if (msg === 'Failed to fetch') {
    return 'Cannot connect to the server. The Supabase project may be paused — go to supabase.com to restore it.'
  }
  if (msg.toLowerCase().includes('user already registered') ||
      msg.toLowerCase().includes('already been registered') ||
      msg.toLowerCase().includes('email address is already')) {
    return 'An account with this email already exists. Please log in instead.'
  }
  if (msg.toLowerCase().includes('invalid login credentials') ||
      msg.toLowerCase().includes('invalid email or password')) {
    return 'Incorrect email or password. Please try again.'
  }
  if (msg.toLowerCase().includes('email not confirmed')) {
    return 'Please check your email and click the confirmation link before logging in.'
  }
  if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many')) {
    return 'Too many attempts. Please wait a few minutes and try again.'
  }
  if (msg.toLowerCase().includes('database error saving new user') ||
      msg.toLowerCase().includes('database error')) {
    return 'There was a problem creating your account. Please try again or contact support.'
  }
  // Fall back to the actual Supabase message rather than a generic one —
  // better to show something specific than "Something went wrong"
  return msg || 'Something went wrong. Please try again.'
}

export default function Auth() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'login')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [success, setSuccess] = useState('')

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })

  const update = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    // ── Client-side validation ────────────────────────────────────────────────
    if (mode === 'signup') {
      if (!form.fullName.trim()) {
        setError('Please enter your full name.')
        return
      }
      if (form.password !== form.confirmPassword) {
        setError('Passwords do not match.')
        return
      }
      if (form.password.length < 6) {
        setError('Password must be at least 6 characters.')
        return
      }
    }

    setLoading(true)

    try {

      // ── SIGN UP ─────────────────────────────────────────────────────────────
      //
      //  We only call supabase.auth.signUp here.
      //  The database trigger handles inserting into public.profiles automatically.
      //  DO NOT add a manual profiles insert here — it will conflict with the trigger.
      //
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: { full_name: form.fullName.trim() },
          },
        })

        if (signUpError) throw signUpError

        setSuccess('Account created! Check your email to confirm, then log in.')
        setMode('login')
        setForm({ fullName: '', email: form.email, password: '', confirmPassword: '' })

      // ── LOG IN ──────────────────────────────────────────────────────────────
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        })

        if (signInError) throw signInError

        // Check has_onboarded — false means first login, send to group prompt
        const uid = data.user?.id
        if (uid) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('has_onboarded')
            .eq('id', uid)
            .single()

          if (prof?.has_onboarded) {
            navigate('/dashboard')
          } else {
            navigate('/groups?welcome=1')
          }
        } else {
          navigate('/dashboard')
        }
      }

    } catch (err) {
      console.error('[Auth] error:', err)
      setError(friendlyError(err, mode))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>

        {/* Logo */}
        <div style={styles.logo}>Silks League</div>

        {/* Tabs */}
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => { setMode('login'); setError(''); setSuccess('') }}
            type="button"
          >
            Log in
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'signup' ? styles.tabActive : {}) }}
            onClick={() => { setMode('signup'); setError(''); setSuccess('') }}
            type="button"
          >
            Sign up
          </button>
        </div>

        {/* Heading */}
        <h1 style={styles.heading}>
          {mode === 'login' ? 'Welcome back.' : 'Join for free.'}
        </h1>
        <p style={styles.sub}>
          {mode === 'login'
            ? 'Log in to see your group and picks.'
            : 'Create an account to start playing.'}
        </p>

        {/* Success message */}
        {success && <div style={styles.successBox}>{success}</div>}

        {/* Error message */}
        {error && <div style={styles.errorBox}>{error}</div>}

        {/* Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          {mode === 'signup' && (
            <div style={styles.field}>
              <label style={styles.label}>Full name</label>
              <input
                style={styles.input}
                type="text"
                placeholder="Jack Hobbs"
                value={form.fullName}
                onChange={update('fullName')}
                required
                autoComplete="name"
              />
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Email address</label>
            <input
              style={styles.input}
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={update('email')}
              required
              autoComplete="email"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
              value={form.password}
              onChange={update('password')}
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {mode === 'signup' && (
            <div style={styles.field}>
              <label style={styles.label}>Confirm password</label>
              <input
                style={styles.input}
                type="password"
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={update('confirmPassword')}
                required
                autoComplete="new-password"
              />
            </div>
          )}

          <button
            type="submit"
            style={{ ...styles.submitBtn, ...(loading ? styles.submitBtnLoading : {}) }}
            disabled={loading}
          >
            {loading
              ? 'Please wait...'
              : mode === 'login'
              ? 'Log in →'
              : 'Create account →'}
          </button>
        </form>

        {/* Toggle */}
        <p style={styles.toggleText}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            style={styles.toggleLink}
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setSuccess('') }}
          >
            {mode === 'login' ? 'Sign up free' : 'Log in'}
          </button>
        </p>

        {/* Back to home */}
        <a href="/" style={styles.backLink}>← Back to home</a>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a1a08',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    fontFamily: "'DM Sans', sans-serif",
  },
  card: {
    background: '#0d1f0d',
    border: '1px solid rgba(201, 168, 76, 0.2)',
    borderRadius: '18px',
    padding: '2.5rem',
    width: '100%',
    maxWidth: '420px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
  },
  logo: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '1.4rem',
    color: '#c9a84c',
    letterSpacing: '0.1em',
    marginBottom: '1.75rem',
  },
  tabs: {
    display: 'flex',
    background: 'rgba(0,0,0,0.3)',
    borderRadius: '8px',
    padding: '3px',
    gap: '3px',
    marginBottom: '1.75rem',
    border: '1px solid rgba(201,168,76,0.15)',
  },
  tab: {
    flex: 1,
    padding: '0.55rem 1rem',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '500',
    background: 'transparent',
    color: '#5a8a5a',
    border: 'none',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.2s',
  },
  tabActive: {
    background: '#c9a84c',
    color: '#0a1a08',
    fontWeight: '600',
  },
  heading: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: '2.2rem',
    color: '#e8f0e8',
    letterSpacing: '0.03em',
    marginBottom: '0.4rem',
    lineHeight: 1.05,
  },
  sub: {
    fontSize: '0.875rem',
    color: '#5a8a5a',
    marginBottom: '1.75rem',
  },
  successBox: {
    background: 'rgba(74, 222, 128, 0.1)',
    border: '1px solid rgba(74, 222, 128, 0.3)',
    borderRadius: '8px',
    padding: '0.85rem 1rem',
    fontSize: '0.875rem',
    color: '#4ade80',
    marginBottom: '1.25rem',
    lineHeight: 1.5,
  },
  errorBox: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '8px',
    padding: '0.85rem 1rem',
    fontSize: '0.875rem',
    color: '#f87171',
    marginBottom: '1.25rem',
    lineHeight: 1.5,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: '#5a8a5a',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  input: {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(201,168,76,0.2)',
    borderRadius: '8px',
    padding: '0.85rem 1rem',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: '0.9rem',
    color: '#e8f0e8',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  submitBtn: {
    marginTop: '0.5rem',
    background: '#c9a84c',
    color: '#0a1a08',
    fontWeight: '600',
    fontSize: '1rem',
    padding: '0.9rem 2rem',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'background 0.2s',
    width: '100%',
  },
  submitBtnLoading: {
    background: 'rgba(201,168,76,0.5)',
    cursor: 'not-allowed',
  },
  toggleText: {
    marginTop: '1.25rem',
    fontSize: '0.85rem',
    color: '#5a8a5a',
    textAlign: 'center',
  },
  toggleLink: {
    background: 'none',
    border: 'none',
    color: '#c9a84c',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    fontSize: '0.85rem',
    padding: 0,
    textDecoration: 'underline',
  },
  backLink: {
    display: 'block',
    marginTop: '1rem',
    textAlign: 'center',
    fontSize: '0.8rem',
    color: '#5a8a5a',
    textDecoration: 'none',
  },
}
