import { useState } from 'react'
import { Bell } from 'lucide-react'
import Sheet from './groups/Sheet.jsx'
import { ShareIcon } from './welcome/Art.jsx'
import { currentDevice } from '../lib/device.js'
import '../styles/groups.css'
import '../styles/notif.css'

// The "How" sheet for the two cases the app can't fix by itself: an iPhone that hasn't added
// the app to its home screen, and a browser that has blocked notifications.
function HowSheet({ offer, onClose }) {
  const os = currentDevice().os
  let title, steps, hint
  if (offer === 'home') {
    title = 'Add Silks League to your home screen'
    steps = [
      <>Tap the Share button <ShareIcon /> at the bottom of Safari</>,
      'Scroll down and tap Add to Home Screen',
      'Open Silks League from your home screen and log in',
      'Turn on notifications from the Home screen',
    ]
    hint = "No 'Add to Home Screen'? You may be inside another app. Open this page in Safari first."
  } else {
    title = 'Switch notifications on'
    if (os === 'ios') steps = ['Open Settings', 'Tap Notifications', 'Tap Silks League', 'Turn on Allow Notifications']
    else if (os === 'android') steps = ['Long-press the Silks League app icon', 'Tap App info', 'Tap Notifications', 'Turn notifications on']
    else steps = ['Click the padlock next to the web address', 'Set Notifications to Allow', 'Reload the page']
  }
  return (
    <Sheet onClose={onClose} labelledBy="ns-how-title" dragToClose>
      <h2 className="gr-sheet__title gr-sheet__title--wrap" id="ns-how-title">{title}</h2>
      <ol className="ns-steps">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {hint && <p className="ns-hint">{hint}</p>}
      <button type="button" className="gr-btn gr-btn--solid" onClick={onClose}>Got it</button>
    </Sheet>
  )
}

// The gold strip at the top of Home. `notif` is useNotifStatus(): shown only when this device
// doesn't have notifications on, and gone as soon as "Turn on" succeeds.
export default function NotifStrip({ notif }) {
  const [how, setHow] = useState(false)
  const { offer, enable, busy } = notif
  if (!offer) return null

  const line = offer === 'home'
    ? 'Add Silks League to your home screen first'
    : offer === 'denied' ? "Switch them on in your phone's Settings" : 'Picks open, lock reminders and results'

  return (
    <>
      <div className="ns" role="region" aria-label="Notifications">
        <Bell className="ns__icon" size={20} aria-hidden="true" />
        <div className="ns__text">
          <span className="ns__title">Stay in the race</span>
          <span className="ns__sub">{line}</span>
        </div>
        {offer === 'enable'
          ? <button type="button" className="ns__btn" onClick={enable} disabled={busy}>Turn on</button>
          : <button type="button" className="ns__btn" onClick={() => setHow(true)}>How</button>}
      </div>
      {how && <HowSheet offer={offer} onClose={() => setHow(false)} />}
    </>
  )
}

// A one-line gold link under a Picks card: "Turn on notifications so you don't miss it ›".
// Same opt-in as the strip; where the app can't do it itself, it opens the same "How" sheet.
export function NotifLine({ notif }) {
  const [how, setHow] = useState(false)
  const { offer, enable, busy } = notif
  if (!offer) return null
  return (
    <>
      <button type="button" className="ns-line" onClick={offer === 'enable' ? enable : () => setHow(true)} disabled={busy}>
        Turn on notifications so you don&rsquo;t miss it <span aria-hidden="true">&rsaquo;</span>
      </button>
      {how && <HowSheet offer={offer} onClose={() => setHow(false)} />}
    </>
  )
}
