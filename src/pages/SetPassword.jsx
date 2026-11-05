import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { currentUser } from '../lib/session.js'
import { postAuthDestination } from '../lib/onboarding.js'
import { recoveryState, clearRecovery } from '../lib/recovery.js'
import { friendlyAuthError } from '../lib/authFlow.js'
import { Brand, PasswordField } from '../components/auth/AuthBits.jsx'
import '../styles/auth.css'

// /reset-password: where the "Set a new password" email button lands. Supabase has already
// signed the player in from the link, so saving the password is enough; then on to the app.
// Opened without a reset link: signed-in players go Home, everyone else is told the link has expired.

export default function SetPassword() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('loading') // loading | form | expired
  const [user, setUser] = useState(null)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let off = false
    ;(async () => {
      const state = recoveryState()
      const u = await currentUser()   // waits for Supabase to read the link
      if (off) return
      if (u && state === 'ok') { setUser(u); setPhase('form'); return }
      if (u && !state) { navigate('/dashboard', { replace: true }); return }
      setPhase('expired')
    })()
    return () => { off = true }
  }, [navigate])

  async function save(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setSaving(true)
    const { error: saveError } = await supabase.auth.updateUser({ password })
    if (saveError) { setSaving(false); setError(friendlyAuthError(saveError)); return }
    clearRecovery()
    let dest = '/dashboard'
    try { dest = await postAuthDestination(user) } catch { /* Home is fine */ }
    navigate(dest, { replace: true })
  }

  if (phase === 'loading') return <div className="au au--boot" />

  return (
    <div className="au">
      <Brand />
      <main className="au-main">
        {phase === 'form' ? (
          <>
            <h1 className="au-h1">Set a new password</h1>
            <p className="au-text">Choose a password for your Silks League account.</p>
            <form className="au-form" onSubmit={save}>
              <PasswordField id="np-password" label="New password" value={password}
                onChange={e => { setPassword(e.target.value); setError('') }} autoComplete="new-password" hint="At least 6 characters" />
              {error && <div className="au-error" role="alert">{error}</div>}
              <button type="submit" className="au-btn au-btn--solid" disabled={saving}>{saving ? 'Saving…' : 'Save password'}</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="au-h1">This link has expired</h1>
            <p className="au-text">Reset links only work once, and run out after a while. Ask for a new one.</p>
            <div className="au-actions">
              <Link to="/auth?mode=forgot" className="au-btn au-btn--solid">Send a new link</Link>
              <Link to="/auth" className="au-btn au-btn--text">Back to log in</Link>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
