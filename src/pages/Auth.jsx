/**
 * Silks League — Auth page
 *
 * One page, five views: sign up, check your email (after sign-up), log in, forgot password,
 * and reset-link-sent. Sign-up collects full_name, username, email, password. The username is
 * saved to profiles.username after the account exists; if a profile has none on log-in, a
 * small modal asks for one.
 */

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { cleanCode, savePendingCode, readPendingCode, checkInviteCode } from '../lib/invite.js'
import { postAuthDestination } from '../lib/onboarding.js'
import { friendlyAuthError, isUnconfirmed, signUpFoundExisting, USERNAME_REGEX } from '../lib/authFlow.js'
import { mailLinkFor } from '../lib/mailLink.js'
import { currentDevice } from '../lib/device.js'
import { Brand, EnvelopeIcon, PasswordField, InviteCard, UsernameHint } from '../components/auth/AuthBits.jsx'
import { useCooldown, useUsernameStatus } from '../components/auth/authHooks.js'
import '../styles/auth.css'

export default function Auth() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode')
  const [view, setView] = useState(mode === 'signup' ? 'signup' : mode === 'forgot' ? 'forgot' : 'login')
  const [form, setForm] = useState({ fullName: '', username: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exists, setExists] = useState(false)           // sign-up: that email already has an account
  const [unconfirmed, setUnconfirmed] = useState(false) // log-in: account exists but the email isn't confirmed
  const [sent, setSent] = useState(false)               // an email was re-sent from this view
  const [resendError, setResendError] = useState('')
  const [sending, setSending] = useState(false)
  const [left, startCooldown] = useCooldown()

  // An invite code that came with the link (/auth?join=CODE) or is waiting from the invite
  // page. It is kept through sign-up and log-in, then the player is sent to join the group.
  const [inviteCode] = useState(() => cleanCode(searchParams.get('join')) || readPendingCode(null))
  useEffect(() => { if (inviteCode) savePendingCode(inviteCode) }, [inviteCode])

  // The group's name for the "You're joining" card: a string (name, or '' if we couldn't look it up),
  // false when no such group exists (no card), null while we find out.
  const [group, setGroup] = useState(null)
  useEffect(() => {
    if (!inviteCode) return
    let off = false
    checkInviteCode(inviteCode).then(name => { if (!off) setGroup(name === null ? false : (name || '')) })
    return () => { off = true }
  }, [inviteCode])
  const showInvite = !!inviteCode && typeof group === 'string'

  // A new view starts at the top (the previous one may have been scrolled on a small screen).
  useEffect(() => { window.scrollTo(0, 0) }, [view])

  const unStatus = useUsernameStatus(form.username, view === 'signup')

  // ── Username-setup modal (for existing players with no username) ──
  const [showUnModal, setShowUnModal] = useState(false)
  const [modalUn, setModalUn] = useState('')
  const [modalUserId, setModalUserId] = useState(null)
  const [modalDest, setModalDest] = useState('/dashboard')
  const modalStatus = useUsernameStatus(modalUn, showUnModal)

  const go = (next) => {
    setView(next)
    setError(''); setExists(false); setUnconfirmed(false); setSent(false); setResendError('')
  }
  const update = (field) => (e) => {
    setForm(f => ({ ...f, [field]: e.target.value }))
    setError(''); setExists(false)
  }

  // ── Sign up ──
  const handleSignUp = async (e) => {
    e.preventDefault()
    setError(''); setExists(false)
    const username = form.username.trim()
    if (!form.fullName.trim())        { setError('Please enter your name.'); return }
    if (!username)                    { setError('Please choose a username.'); return }
    if (!USERNAME_REGEX.test(username)) { setError('Username must be 3–20 characters, letters and numbers only.'); return }
    if (unStatus === 'taken')         { setError('That username is already taken.'); return }
    if (unStatus === 'checking')      { setError('Still checking your username. Please wait a moment.'); return }
    if (form.password.length < 6)     { setError('Password must be at least 6 characters.'); return }

    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: {
          full_name: form.fullName.trim(),
          username,
          // Stays on the account, so it still works if the confirmation email opens elsewhere.
          ...(inviteCode ? { invite_code: inviteCode } : {}),
        } },
      })
      if (signUpFoundExisting(data, signUpError)) { setExists(true); return }
      if (signUpError) throw signUpError

      // Try to save the username to profiles straight away (works only if the player is already
      // signed in). If it fails that's fine: the username modal asks on first log-in.
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('profiles')
            .update({ username, full_name: form.fullName.trim(), email: form.email.trim() })
            .eq('id', user.id)
        }
      } catch { /* ignore */ }

      if (data?.session && data.user) { navigate(await postAuthDestination(data.user)); return }

      setForm(f => ({ ...f, email: f.email.trim(), password: '' }))
      startCooldown()   // the sign-up email counts as the first send
      setView('check')
    } catch (err) {
      console.error('[Auth] sign-up error:', err)
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  // ── Log in ──
  const handleLogin = async (e) => {
    e.preventDefault()
    setError(''); setUnconfirmed(false); setSent(false); setResendError('')
    setLoading(true)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      })
      if (signInError) throw signInError

      const uid = data.user?.id
      if (!uid) { navigate('/dashboard'); return }
      const { data: prof } = await supabase.from('profiles').select('username').eq('id', uid).single()
      // Waiting invite code first, then the welcome flow for new players, otherwise Home.
      const dest = await postAuthDestination(data.user)

      if (prof?.username) { navigate(dest); return }
      // No username yet: take it from the account if we can, otherwise ask.
      const metaUsername = data.user?.user_metadata?.username
      if (metaUsername) {
        await supabase.from('profiles').update({ username: metaUsername }).eq('id', uid)
        navigate(dest)
      } else {
        setModalUserId(uid)
        setModalDest(dest)
        setShowUnModal(true)
      }
    } catch (err) {
      if (isUnconfirmed(err)) { setUnconfirmed(true); return }
      console.error('[Auth] log-in error:', err)
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSaveModalUsername = async () => {
    if (modalStatus !== 'ok') return
    setLoading(true)
    const { error: saveError } = await supabase.from('profiles').update({ username: modalUn.trim() }).eq('id', modalUserId)
    setLoading(false)
    if (saveError) { setError('Could not save your username. Please try again.'); return }
    setShowUnModal(false)
    navigate(modalDest)
  }

  // ── Emails: re-send the confirmation, send or re-send the reset link ──
  async function resend(kind) {
    if (left > 0 || sending) return
    const email = form.email.trim()
    setSending(true); setResendError('')
    const { error: sendError } = kind === 'reset'
      ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
      : await supabase.auth.resend({ type: 'signup', email })
    setSending(false)
    if (sendError) { setResendError(friendlyAuthError(sendError)); return }
    setSent(true)
    startCooldown()
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(form.email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (sendError) { setError(friendlyAuthError(sendError)); return }
    setSent(false)
    startCooldown()
    setView('reset-sent')
  }

  const mail = mailLinkFor(form.email, currentDevice(false).os)
  const resendLabel = sending ? 'Sending…' : left > 0 ? `Resend in ${left}s` : 'Resend email'
  const groupLine = inviteCode && group !== false
    ? `You’ll be logged in and into ${group || 'your group'}`
    : 'You’ll be logged in and ready to play'

  const mailButton = mail && (
    <a className="au-btn au-btn--solid" href={mail.href} {...(mail.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>Open Mail</a>
  )
  const resendStatus = (sent || resendError) && (
    <p className={resendError ? 'au-error au-error--tight' : 'au-sent'} role={resendError ? 'alert' : 'status'}>
      {resendError || 'Sent. It can take a minute to arrive.'}
    </p>
  )

  let content
  if (view === 'check') {
    content = (
      <>
        <EnvelopeIcon />
        <div className="au-label-top">ONE MORE STEP</div>
        <h1 className="au-h1">Check your email</h1>
        <p className="au-text">We&rsquo;ve sent a confirmation link to <strong className="au-email">{form.email}</strong></p>
        <ol className="au-steps">
          <li className="au-step"><span className="au-step__num" aria-hidden="true">1</span><span>Open the email from Silks League</span></li>
          <li className="au-step"><span className="au-step__num" aria-hidden="true">2</span><span>Tap <strong>Confirm my account</strong></span></li>
          <li className="au-step"><span className="au-step__num" aria-hidden="true">3</span><span>{groupLine}</span></li>
        </ol>
        <p className="au-hint au-hint--spaced">Can&rsquo;t see it? Check your junk folder. It can take a minute.</p>
        <div className="au-actions">
          {mailButton}
          <button type="button" className="au-btn au-btn--outline" onClick={() => resend('signup')} disabled={left > 0 || sending}>{resendLabel}</button>
          {resendStatus}
          <button type="button" className="au-btn au-btn--text" onClick={() => go('signup')}>Wrong email? Start again</button>
        </div>
      </>
    )
  } else if (view === 'reset-sent') {
    content = (
      <>
        <EnvelopeIcon />
        <div className="au-label-top">PASSWORD RESET</div>
        <h1 className="au-h1">Check your email for a reset link</h1>
        <p className="au-text">We&rsquo;ve sent it to <strong className="au-email">{form.email}</strong>. Tap <strong>Set a new password</strong> in the email.</p>
        <p className="au-hint au-hint--spaced">Can&rsquo;t see it? Check your junk folder. It can take a minute.</p>
        <div className="au-actions">
          {mailButton}
          <button type="button" className="au-btn au-btn--outline" onClick={() => resend('reset')} disabled={left > 0 || sending}>{resendLabel}</button>
          {resendStatus}
          <button type="button" className="au-btn au-btn--text" onClick={() => go('login')}>Back to log in</button>
        </div>
      </>
    )
  } else if (view === 'forgot') {
    content = (
      <>
        <h1 className="au-h1">Reset your password</h1>
        <p className="au-text">Enter your email and we&rsquo;ll send you a link to set a new password.</p>
        <form className="au-form" onSubmit={handleForgot}>
          <div className="au-field">
            <label className="au-label" htmlFor="fg-email">Email</label>
            <input id="fg-email" className="au-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck="false"
              value={form.email} onChange={update('email')} required />
          </div>
          {error && <div className="au-error" role="alert">{error}</div>}
          <button type="submit" className="au-btn au-btn--solid" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
          <button type="button" className="au-btn au-btn--text" onClick={() => go('login')}>Back to log in</button>
        </form>
      </>
    )
  } else if (view === 'signup') {
    content = (
      <>
        <h1 className="au-h1">Join free</h1>
        <p className="au-text">Create an account to start playing.</p>
        {showInvite && <InviteCard name={group} />}
        <form className="au-form" onSubmit={handleSignUp}>
          <div className="au-field">
            <label className="au-label" htmlFor="su-name">Your name</label>
            <input id="su-name" className="au-input" type="text" autoComplete="name" autoCapitalize="words"
              value={form.fullName} onChange={update('fullName')} required />
          </div>
          <div className="au-field">
            <label className="au-label" htmlFor="su-username">Username</label>
            <input id="su-username" className="au-input" type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck="false" maxLength={20}
              value={form.username} onChange={update('username')} required aria-invalid={unStatus === 'taken' || unStatus === 'invalid' || undefined} />
            <UsernameHint status={unStatus} idle="Shown on the leaderboard" />
          </div>
          <div className="au-field">
            <label className="au-label" htmlFor="su-email">Email</label>
            <input id="su-email" className="au-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck="false"
              value={form.email} onChange={update('email')} required />
          </div>
          <PasswordField id="su-password" label="Password" value={form.password} onChange={update('password')} autoComplete="new-password" hint="At least 6 characters" />
          {exists && (
            <div className="au-error" role="alert">
              An account with this email already exists.{' '}
              <button type="button" className="au-inline" onClick={() => go('login')}>Log in instead</button>
            </div>
          )}
          {error && <div className="au-error" role="alert">{error}</div>}
          <button type="submit" className="au-btn au-btn--solid" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
          <p className="au-fine">We&rsquo;ll email you a link to confirm your account.</p>
        </form>
        <p className="au-switch">Already have an account? <button type="button" className="au-link" onClick={() => go('login')}>Log in</button></p>
      </>
    )
  } else {
    content = (
      <>
        <h1 className="au-h1">Welcome back</h1>
        <p className="au-text">Log in to make your picks.</p>
        {showInvite && <InviteCard name={group} />}
        <form className="au-form" onSubmit={handleLogin}>
          <div className="au-field">
            <label className="au-label" htmlFor="li-email">Email</label>
            <input id="li-email" className="au-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck="false"
              value={form.email} onChange={update('email')} required />
          </div>
          <PasswordField
            id="li-password" label="Password" value={form.password} onChange={update('password')} autoComplete="current-password"
            labelExtra={<button type="button" className="au-link au-link--small" onClick={() => go('forgot')}>Forgot password?</button>}
          />
          {unconfirmed && (
            <div className="au-note" role="alert">
              <span>You haven&rsquo;t confirmed your email yet. Check your inbox (and junk) for the link.</span>
              {resendError
                ? <span className="au-note__err">{resendError}</span>
                : sent && left > 0
                  ? <span className="au-note__sent">Sent. Resend in {left}s</span>
                  : <button type="button" className="au-link" onClick={() => resend('signup')} disabled={left > 0 || sending}>
                      {sending ? 'Sending…' : left > 0 ? `Resend in ${left}s` : 'Resend it'}
                    </button>}
            </div>
          )}
          {error && <div className="au-error" role="alert">{error}</div>}
          <button type="submit" className="au-btn au-btn--solid" disabled={loading}>{loading ? 'Logging in…' : 'Log in'}</button>
        </form>
        <p className="au-switch">New here? <button type="button" className="au-link" onClick={() => go('signup')}>Join free</button></p>
      </>
    )
  }

  return (
    <div className="au">
      <Brand />
      <main className="au-main">{content}</main>

      {showUnModal && (
        <div className="au-overlay">
          <div className="au-modal" role="dialog" aria-modal="true" aria-labelledby="au-modal-title">
            <h2 className="au-modal__title" id="au-modal-title">Choose a username</h2>
            <p className="au-text au-text--small">This is how you&rsquo;ll appear on leaderboards. You can change it later in your profile.</p>
            <div className="au-field">
              <label className="au-label" htmlFor="un-modal">Username</label>
              <input id="un-modal" className="au-input" type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck="false" maxLength={20} autoFocus
                value={modalUn} onChange={e => setModalUn(e.target.value)} />
              <UsernameHint status={modalStatus} idle="Shown on the leaderboard" />
            </div>
            {error && <div className="au-error" role="alert">{error}</div>}
            <button type="button" className="au-btn au-btn--solid" disabled={modalStatus !== 'ok' || loading} onClick={handleSaveModalUsername}>
              {loading ? 'Saving…' : 'Save username'}
            </button>
            <button type="button" className="au-btn au-btn--text" onClick={() => { setShowUnModal(false); navigate(modalDest) }}>Skip for now</button>
          </div>
        </div>
      )}
    </div>
  )
}
