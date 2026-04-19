import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(searchParams.get('mode') === 'signup' ? 'signup' : 'login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
      if (mode === 'signup') {
        // Supabase v2 signUp syntax
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: {
              full_name: form.fullName,
            },
          },
        })

        // Log full response for diagnostics
        console.log('[Auth] signUp response:', { data, error: signUpError })

        if (signUpError) throw signUpError

        setSuccess('Account created! Check your email to confirm, then log in.')
        setMode('login')
        setForm({ fullName: '', email: form.email, password: '', confirmPassword: '' })

      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        })

        // Log full response for diagnostics
        console.log('[Auth] signIn response:', { data, error: signInError })

        if (signInError) throw signInError

        // On first-ever login: if user has no group and hasn't been onboarded,
        // redirect to the Groups page with the welcome prompt.
        const uid = data.user?.id
        const onboardedKey = `silks_group_onboarded_${uid}`
        if (uid && !localStorage.getItem(onboardedKey)) {
          const { count } = await supabase
            .from('group_members')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', uid)
          if (!count) {
            navigate('/groups?welcome=1')
          } else {
            localStorage.setItem(onboardedKey, '1')
            navigate('/dashboard')
          }
        } else {
          navigate('/dashboard')
        }
      }

    } catch (err) {
      // Log the full error so we can see exactly what Supabase is returning
      console.error('[Auth] Full error object:', err)
      console.error('[Auth] Error message:', err?.message)
      console.error('[Auth] Error status:', err?.status)
      console.error('[Auth] Error name:', err?.name)

      // Show the actual Supabase message rather than generic "Failed to fetch"
      if (err?.message === 'Failed to fetch') {
        setError(
          'Cannot connect to the server. This usually means: (1) the Supabase project is paused — go to supabase.com and restore it, or (2) the environment variables are missing.'
        )
      } else {
        setError(err?.message || 'Something went wrong. Please try again.')
      }
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
        {success && (
          <div style={styles.successBox}>
            {success}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={styles.errorBox}>
            {error}
          </div>
        )}

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
