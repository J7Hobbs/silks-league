import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { currentUser } from '../lib/session.js'
import { supabase } from '../lib/supabase'
import { currentDevice, homeScreenVariant } from '../lib/device.js'
import { hasInstallPrompt, onInstallPromptChange, runInstallPrompt } from '../lib/installPrompt.js'
import { loadOnboarding, finishOnboarding } from '../lib/onboarding.js'
import { buildSteps, skipTarget, STEP_LABEL } from '../lib/welcomeFlow.js'
import { pushStatus, enablePush } from '../lib/notifications.js'
import HowItWorksModal from '../components/HowItWorksModal.jsx'
import { RingArt, WinArt, NotifArt, ShareIcon } from '../components/welcome/Art.jsx'
import '../styles/welcome.css'

// The one-time welcome flow shown to a new player (profiles.onboarded_at is null). Which steps
// appear depends on the device (lib/welcomeFlow.js). It is finished, and onboarded_at set,
// only when the player finishes or skips the last step. Leaving early (or installing the
// app on an iPhone and logging in again) brings it back.

const PUSH_WAIT_MS = 2500

// Push status, or null when OneSignal can't start here or is too slow.
function pushOrNull() {
  return Promise.race([
    pushStatus().catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), PUSH_WAIT_MS)),
  ])
}

// The player's most recently joined group, for the "You're in …" step.
async function loadMyGroup(userId) {
  try {
    const { data: rows } = await supabase
      .from('group_members')
      .select('joined_at, groups(id, name, invite_code)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false })
      .limit(1)
    const g = rows?.[0]?.groups
    if (!g) return null
    const { data: members } = await supabase.from('group_members').select('user_id').eq('group_id', g.id)
    const ids = (members || []).map(m => m.user_id)
    let initials = []
    try {
      const { data: names } = await supabase.rpc('get_user_names', { user_ids: ids.slice(0, 5) })
      initials = (names || []).map(p => ((p.username || p.full_name || '?').trim().charAt(0) || '?').toUpperCase())
    } catch { /* initials are decoration */ }
    return { name: g.name, code: g.invite_code, count: ids.length || 1, initials }
  } catch {
    return null
  }
}

function Dots({ n, i }) {
  return (
    <div className="wl-dots" role="img" aria-label={`Step ${i + 1} of ${n}`}>
      {Array.from({ length: n }, (_, k) => <span key={k} className={`wl-dot${k === i ? ' wl-dot--on' : ''}`} />)}
    </div>
  )
}

function Steps({ items }) {
  return (
    <ol className="wl-steps">
      {items.map((it, k) => (
        <li key={k} className="wl-step">
          <span className="wl-step__num" aria-hidden="true">{k + 1}</span>
          <span className="wl-step__text">{it}</span>
        </li>
      ))}
    </ol>
  )
}

export default function Welcome() {
  const navigate = useNavigate()
  const [boot, setBoot] = useState(null)        // { user, device, steps, push, group }
  const [i, setI] = useState(0)
  const [holding, setHolding] = useState(false) // iPhone: "now open it from your home screen"
  const [busy, setBusy] = useState(false)
  const [rules, setRules] = useState(false)
  const [canInstall, setCanInstall] = useState(hasInstallPrompt())
  const finishing = useRef(false)

  useEffect(() => onInstallPromptChange(() => setCanInstall(hasInstallPrompt())), [])

  useEffect(() => {
    let off = false
    ;(async () => {
      const user = await currentUser()
      if (off) return
      if (!user) { navigate('/auth', { replace: true }); return }
      const ob = await loadOnboarding(user.id)
      if (off) return
      if (!ob.known || ob.done) { navigate('/dashboard', { replace: true }); return }
      const [push, group] = await Promise.all([pushOrNull(), loadMyGroup(user.id)])
      if (off) return
      const device = currentDevice(hasInstallPrompt())
      setBoot({ user, device, push, group, steps: buildSteps(device, push) })
    })()
    return () => { off = true }
  }, [navigate])

  if (!boot) return <div className="wl wl--boot" />

  const { user, steps, group, device } = boot
  const id = steps[i]
  const variant = homeScreenVariant({ ...device, canInstall })

  async function finish(dest = '/dashboard') {
    if (finishing.current) return
    finishing.current = true
    await finishOnboarding(user.id)
    navigate(dest, { replace: true })
  }
  const next = () => (i < steps.length - 1 ? setI(i + 1) : finish())
  const skip = () => setI(skipTarget(steps))

  async function install() {
    setBusy(true)
    const outcome = await runInstallPrompt()
    setBusy(false)
    if (outcome === 'accepted') next()
  }

  async function turnOnReminders() {
    setBusy(true)
    try { await enablePush(user.id) } catch { /* not turned on: carry on */ }
    setBusy(false)
    finish()
  }

  // ── Step content ──
  let body = null
  let actions = null
  let art = null
  let heading = ''
  let text = ''
  const showSkip = id === 'pick' || id === 'win'

  if (id === 'home' && holding) {
    heading = 'Now open it from your home screen'
    text = "Open Silks League from your home screen and log in. We'll pick up where you left off."
    actions = <button type="button" className="wl-btn wl-btn--text" onClick={() => { setHolding(false); next() }}>Carry on in Safari instead</button>
  } else if (id === 'home') {
    heading = 'Add Silks League to your home screen'
    text = "It opens like a proper app, and it's the only way to get reminders before picks lock."
    const later = <button type="button" className="wl-btn wl-btn--text" onClick={next}>I'll do it later</button>
    if (variant?.kind === 'ios') {
      body = (
        <>
          <Steps items={[
            <>Tap the Share button <ShareIcon /> at the bottom of Safari</>,
            'Scroll down and tap Add to Home Screen',
            'Open Silks League from your home screen and log in',
          ]} />
          <p className="wl-hint">No &lsquo;Add to Home Screen&rsquo;? You may be inside another app. Open this page in Safari first.</p>
        </>
      )
      actions = <><button type="button" className="wl-btn wl-btn--solid" onClick={() => setHolding(true)}>Done it</button>{later}</>
    } else if (variant?.kind === 'inapp') {
      const browser = variant.os === 'ios' ? 'Safari' : 'Chrome'
      const app = variant.app === 'another app' ? 'another app' : variant.app
      body = (
        <>
          <div className="wl-warn" role="note">
            <strong>You&rsquo;ve opened this inside {app}</strong>
            <span>Adding to your home screen only works from {browser}.</span>
          </div>
          <Steps items={[
            variant.os === 'ios' ? <>Tap the Share or <span className="wl-nobreak">⋯</span> button in {app}</> : <>Tap the <span className="wl-nobreak">⋮</span> menu in {app}</>,
            `Choose Open in ${browser}`,
            `Then add Silks League to your home screen from ${browser}`,
          ]} />
        </>
      )
      actions = later
    } else if (variant?.kind === 'android-prompt') {
      actions = (
        <>
          <button type="button" className="wl-btn wl-btn--solid" onClick={install} disabled={busy}>{busy ? 'Installing…' : 'Install Silks League'}</button>
          {later}
        </>
      )
    } else {
      body = (
        <Steps items={[
          <>Tap the <span className="wl-nobreak">⋮</span> menu in your browser</>,
          'Tap Install app or Add to Home screen',
          'Open Silks League from your home screen',
        ]} />
      )
      actions = <><button type="button" className="wl-btn wl-btn--solid" onClick={next}>Done it</button>{later}</>
    }
  } else if (id === 'pick') {
    art = <RingArt />
    heading = 'Pick a horse in every race'
    text = 'Every Saturday and at the big festivals. Change your mind as often as you like until picks lock, 30 minutes before the first race.'
    actions = <button type="button" className="wl-btn wl-btn--solid" onClick={next}>Next</button>
  } else if (id === 'win') {
    art = <WinArt />
    heading = 'Back it to win, or each-way'
    text = "Winners and placed horses score points, and the bigger the price, the bigger the score. There's no cap, so one long shot can win you the week."
    body = <button type="button" className="wl-link" onClick={() => setRules(true)}>Full scoring rules</button>
    actions = <button type="button" className="wl-btn wl-btn--solid" onClick={next}>Next</button>
  } else if (id === 'group') {
    if (group) {
      heading = `You're in ${group.name}`
      text = "Your group's table is waiting. You'll also be on the main Saturday League table."
      body = (
        <div className="wl-group" aria-label={`Your group: ${group.name}`}>
          <div className="wl-group__top">
            <span className="wl-group__name">{group.name}</span>
            <span className="wl-group__code">{String(group.code || '').toUpperCase()}</span>
          </div>
          <div className="wl-group__members">
            <div className="wl-avatars" aria-hidden="true">
              {group.initials.map((c, k) => <span key={k} className="wl-avatar">{c}</span>)}
            </div>
            <span className="wl-group__count">{group.count} {group.count === 1 ? 'member' : 'members'}</span>
          </div>
        </div>
      )
      actions = <button type="button" className="wl-btn wl-btn--solid" onClick={next}>Continue</button>
    } else {
      heading = 'Play with your mates'
      text = "Start a private group and share the code, or join one with a code from a mate. You'll also be on the main Saturday League table."
      actions = (
        <>
          <button type="button" className="wl-btn wl-btn--solid" onClick={() => finish('/groups')}>Start a group</button>
          <button type="button" className="wl-btn wl-btn--outline" onClick={() => finish('/join')}>Join with a code</button>
          <button type="button" className="wl-btn wl-btn--text" onClick={next}>Maybe later</button>
        </>
      )
    }
  } else if (id === 'remind') {
    art = <NotifArt />
    heading = 'Never miss a deadline'
    text = "We'll remind you before picks lock and tell you when results are in. Nothing else."
    actions = (
      <>
        <button type="button" className="wl-btn wl-btn--solid" onClick={turnOnReminders} disabled={busy}>{busy ? 'Turning on…' : 'Turn on reminders'}</button>
        <button type="button" className="wl-btn wl-btn--text" onClick={() => finish()} disabled={busy}>Not now</button>
      </>
    )
  }

  return (
    <div className="wl">
      <div className="wl-top">
        <Dots n={steps.length} i={i} />
        {showSkip && <button type="button" className="wl-skip" onClick={skip}>Skip</button>}
      </div>
      <div className="wl-scroll">
        {art}
        <div className="wl-label">{STEP_LABEL[id]}</div>
        <h1 className="wl-h1">{heading}</h1>
        <p className="wl-text">{text}</p>
        {body}
      </div>
      <div className="wl-actions">{actions}</div>
      <HowItWorksModal open={rules} onClose={() => setRules(false)} />
    </div>
  )
}
