import { useState } from 'react'
import { Link } from 'react-router-dom'

// Pieces shared by the log-in / sign-up page and the set-new-password page.

export function Brand() {
  return (
    <div className="au-top">
      <Link to="/" className="au-brand" aria-label="Silks League home"><span>SILKS</span> <span className="au-brand__b">LEAGUE</span></Link>
    </div>
  )
}

export function EnvelopeIcon() {
  return (
    <span className="au-envelope" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m4 7.5 8 6 8-6" />
      </svg>
    </span>
  )
}

// A password box with a Show / Hide button.
export function PasswordField({ id, label, value, onChange, autoComplete, hint, labelExtra }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="au-field">
      <div className="au-labelrow">
        <label className="au-label" htmlFor={id}>{label}</label>
        {labelExtra}
      </div>
      <div className="au-pw">
        <input
          id={id}
          className="au-input au-input--pw"
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          required
        />
        <button type="button" className="au-pw__toggle" onClick={() => setShown(s => !s)} aria-pressed={shown} aria-controls={id}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && <p className="au-hint">{hint}</p>}
    </div>
  )
}

// The gold "You're joining …" card. `name` is the group's name, or '' when it couldn't be looked up.
export function InviteCard({ name }) {
  return (
    <div className="au-invite" role="note">
      <span className="au-invite__dot" aria-hidden="true" />
      <span>You&rsquo;re joining <strong>{name || 'a group'}</strong></span>
    </div>
  )
}

const UN_TEXT = {
  checking: ['Checking…', 'au-hint'],
  ok: ['Available', 'au-hint au-hint--ok'],
  taken: ['Already taken', 'au-hint au-hint--bad'],
  invalid: ['3–20 characters, letters and numbers only', 'au-hint au-hint--bad'],
}

// The line under a username box: the check result, or `idle` text when there's nothing to say yet.
export function UsernameHint({ status, idle }) {
  const [text, cls] = UN_TEXT[status] || [idle, 'au-hint']
  return <p className={cls} aria-live="polite">{text}</p>
}
