import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { currentUser } from '../lib/session.js'
import { loadOnboarding } from '../lib/onboarding.js'
import { cleanCode, savePendingCode, clearPendingCode, joinGroupByCode, checkInviteCode } from '../lib/invite.js'
import '../styles/welcome.css'

// /join and /join/CODE: where a group invite link lands.
//  - logged out: shows the invitation and sends them to sign up or log in with the code kept
//  - logged in: joins straight away (already a member counts as success)
//  - /join with no code: a box to type one

function CodeBox({ onSubmit, error }) {
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')
  function submit(e) {
    e.preventDefault()
    const code = cleanCode(value)
    if (!code) { setErr('Enter the invite code first.'); return }
    onSubmit(code)
  }
  return (
    <form className="wl-form" onSubmit={submit}>
      <label className="wl-field-label" htmlFor="join-code">Invite code</label>
      <input
        id="join-code"
        className="wl-input"
        type="text"
        inputMode="text"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck="false"
        autoComplete="off"
        placeholder="e.g. a1b2c3d4"
        value={value}
        onChange={e => { setValue(e.target.value); setErr('') }}
      />
      {(err || error) && <p className="wl-error" role="alert">{err || error}</p>}
      <button type="submit" className="wl-btn wl-btn--solid">Continue</button>
    </form>
  )
}

export default function Join() {
  const { code: param } = useParams()
  const navigate = useNavigate()
  const code = cleanCode(param)
  const [state, setState] = useState({ phase: 'loading' })

  useEffect(() => {
    let off = false
    ;(async () => {
      const user = await currentUser()
      if (off) return
      if (!code) { setState({ phase: 'enter', user }); return }

      if (user) {
        const r = await joinGroupByCode(user.id, code)
        if (off) return
        if (r.status === 'joined' || r.status === 'already') {
          await clearPendingCode(user)
          const ob = await loadOnboarding(user.id)
          if (off) return
          // A new player carries on into the welcome flow, which shows the group.
          if (ob.known && !ob.done) { navigate('/welcome', { replace: true }); return }
          setState({ phase: 'done', status: r.status, group: r.group })
          return
        }
        if (r.status === 'invalid') { await clearPendingCode(user); if (!off) setState({ phase: 'invalid', user }); return }
        setState({ phase: 'error', message: r.message, user })
        return
      }

      // Logged out: check the code if we can, and keep it through sign-up.
      const name = await checkInviteCode(code)
      if (off) return
      if (name === null) { setState({ phase: 'invalid' }); return }
      savePendingCode(code)
      setState({ phase: 'invited', name: name || null })
    })()
    return () => { off = true }
  }, [code, navigate])

  const tryCode = c => navigate(`/join/${encodeURIComponent(c)}`)

  async function carryOn(user) {
    const ob = await loadOnboarding(user.id)
    navigate(ob.known && !ob.done ? '/welcome' : '/dashboard', { replace: true })
  }

  const { phase } = state
  if (phase === 'loading') return <div className="wl wl--boot" />

  let label = 'INVITE CODE', heading = '', text = '', body = null, actions = null

  if (phase === 'enter') {
    heading = 'Got an invite code?'
    text = 'Enter the code a mate shared with you.'
    body = <CodeBox onSubmit={tryCode} />
  } else if (phase === 'invited') {
    label = "YOU'RE INVITED"
    heading = state.name ? `You've been invited to ${state.name}` : "You've been invited to a group"
    text = "Join free and you'll be in their group straight away."
    body = <p className="wl-codechip">Invite code <strong>{code.toUpperCase()}</strong></p>
    actions = (
      <>
        <Link to={`/auth?mode=signup&join=${encodeURIComponent(code)}`} className="wl-btn wl-btn--solid">Join free</Link>
        <Link to={`/auth?mode=login&join=${encodeURIComponent(code)}`} className="wl-btn wl-btn--outline">I already have an account</Link>
      </>
    )
  } else if (phase === 'invalid') {
    heading = "That invite code wasn't found"
    text = 'Check it with whoever sent it, or try another code.'
    body = <CodeBox onSubmit={tryCode} />
    actions = state.user
      ? <button type="button" className="wl-btn wl-btn--text" onClick={() => carryOn(state.user)}>Carry on without a group</button>
      : <Link to="/" className="wl-btn wl-btn--text">Back to home</Link>
  } else if (phase === 'done') {
    label = 'GROUP JOINED'
    heading = state.status === 'already' ? `You're already in ${state.group.name}` : `You're in ${state.group.name}`
    text = "Your group's table is waiting."
    actions = (
      <>
        <Link to="/groups" className="wl-btn wl-btn--solid">View your groups</Link>
        <Link to="/dashboard" className="wl-btn wl-btn--text">Go to Home</Link>
      </>
    )
  } else {
    heading = "We couldn't join that group"
    text = state.message || 'Something went wrong. Please try again.'
    actions = (
      <>
        <button type="button" className="wl-btn wl-btn--solid" onClick={() => window.location.reload()}>Try again</button>
        {state.user && <button type="button" className="wl-btn wl-btn--text" onClick={() => carryOn(state.user)}>Carry on without a group</button>}
      </>
    )
  }

  return (
    <div className="wl">
      <div className="wl-top"><Link to="/" className="wl-brand"><span>SILKS</span> <span className="wl-brand__b">LEAGUE</span></Link></div>
      <div className="wl-scroll">
        <div className="wl-label">{label}</div>
        <h1 className="wl-h1">{heading}</h1>
        <p className="wl-text">{text}</p>
        {body}
      </div>
      {actions && <div className="wl-actions">{actions}</div>}
    </div>
  )
}
