import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Silk from '../Silk.jsx'
import { pushStatus, watchPush, enablePush, needsHomeScreen } from '../../lib/notifications.js'
import EchoRings from './EchoRings.jsx'
import '../../styles/saturday-card.css'

// The Saturday League card on Home. All the content comes ready-made from
// lib/saturdayCard.js; this only draws it.

const RING = 96
const STROKE = 9
const GAP_PX = 3.5

function Marker({ kind }) {
  if (kind === 'tick') {
    return (
      <svg className="sc-tick" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 6.5 L4.8 9 L10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return <span className={`sc-dot sc-dot--${kind}`} aria-hidden="true" />
}

// One line of text that shrinks (down to a floor) rather than wrapping.
function FitHeadline({ text }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const fit = () => {
      let size = 30
      el.style.fontSize = `${size}px`
      while (el.scrollWidth > el.clientWidth && size > 16) {
        size -= 1
        el.style.fontSize = `${size}px`
      }
    }
    fit()
    const watcher = new ResizeObserver(fit)
    watcher.observe(el)
    document.fonts?.ready.then(fit)
    return () => watcher.disconnect()
  }, [text])
  return <h2 className="sc-headline" ref={ref}>{text}</h2>
}

function Ring({ ring, faint }) {
  const n = ring.segments.length
  const c = RING / 2
  const r = (RING - STROKE) / 2
  const slice = (Math.PI * 2) / n
  const gap = n > 1 ? GAP_PX / r : 0
  const point = a => [c + r * Math.cos(a), c + r * Math.sin(a)]
  return (
    <div className="sc-ring">
      <EchoRings faint={faint} />
      <svg className="sc-ring__svg" width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true">
        <circle cx={c} cy={c} r={c} className="sc-ring__disc" />
        {ring.segments.map((kind, i) => {
          if (n === 1) return <circle key={i} cx={c} cy={c} r={r} className={`sc-seg sc-seg--${kind}`} />
          const a0 = -Math.PI / 2 + i * slice + gap / 2
          const a1 = -Math.PI / 2 + (i + 1) * slice - gap / 2
          const [x0, y0] = point(a0)
          const [x1, y1] = point(a1)
          const large = a1 - a0 > Math.PI ? 1 : 0
          return <path key={i} d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`} className={`sc-seg sc-seg--${kind}`} />
        })}
      </svg>
      <div className="sc-ring__centre">
        <span className="sc-ring__num">{ring.centre}</span>
        {ring.centreLabel && <span className="sc-ring__lbl">{ring.centreLabel}</span>}
      </div>
    </div>
  )
}

function Spotlight({ spot, onOpen }) {
  const inner = (
    <>
      <span className="sc-spot__silk">
        {spot.silk === 'empty'
          ? <Silk outline style={{ width: 36, height: 36 }} />
          : <Silk runner={spot.silk} style={{ width: 36, height: 36 }} />}
      </span>
      <span className="sc-spot__text">
        <span className="sc-spot__cap">{spot.caption}</span>
        <span className="sc-spot__main">{spot.main}</span>
        {spot.sub && <span className="sc-spot__sub">{spot.sub}</span>}
      </span>
      {spot.pill && <span className="sc-spot__pill">{spot.pill}</span>}
    </>
  )
  return spot.action
    ? <button type="button" className="sc-spot sc-spot--link" onClick={onOpen}>{inner}</button>
    : <div className="sc-spot">{inner}</div>
}

function Move({ move }) {
  if (!move) return <span className="sc-move sc-move--none" aria-label="no change">–</span>
  const up = move.dir === 'up'
  return (
    <span className={`sc-move ${up ? 'sc-move--up' : 'sc-move--down'}`} aria-label={`${up ? 'up' : 'down'} ${move.n}`}>
      {up ? '▲' : '▼'} {move.n}
    </span>
  )
}

function Table({ table }) {
  return (
    <div className="sc-table">
      <div className="sc-table__head"><span>{table.title}</span><span>PTS</span></div>
      <ol className="sc-table__rows">
        {table.rows.map(row => (
          <li key={row.id} className={`sc-row${row.isMe ? ' sc-row--me' : ''}${row.gap ? ' sc-row--gap' : ''}`}>
            <span className={`sc-rank${row.rank === 1 ? ' sc-rank--first' : ''}`}>{row.rank}</span>
            <span className="sc-row__name">{row.name}</span>
            <Move move={row.move} />
            <span className="sc-row__pts">{row.points}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// The button on the "race day announced" card. It starts as the plain outline button and
// only becomes "Get notified" once we know this device can be, and isn't yet, subscribed.
function NotifyButton({ card, onAction }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    const sync = () => pushStatus().then(s => { if (!cancelled) setStatus(s) }).catch(() => {})
    sync()
    const stop = watchPush(sync)
    return () => { cancelled = true; stop() }
  }, [])

  const canEnable = status?.supported && !status.optedIn && status.permission !== 'denied'
  const needsInstall = status && !status.supported && needsHomeScreen()

  async function onTap() {
    if (needsInstall) {
      setNote('Add Silks League to your home screen first: tap the Share icon, then "Add to Home Screen". Open it from there and come back to turn notifications on.')
      return
    }
    setBusy(true)
    setNote('')
    try {
      const granted = await enablePush(card.notify.userId)
      if (!granted) setNote("Notifications weren't turned on.")
      setStatus(await pushStatus())
    } catch {
      setNote("Notifications couldn't be turned on. Try again from your Account page.")
    }
    setBusy(false)
  }

  if (!canEnable && !needsInstall) {
    return (
      <button type="button" className="sc-btn sc-btn--outline" onClick={() => onAction(card)}>
        {card.button.label}
      </button>
    )
  }
  return (
    <>
      <button type="button" className="sc-btn sc-btn--solid" onClick={onTap} disabled={busy}>
        {busy ? 'Turning on…' : card.notify.label}
      </button>
      {note && <p className="sc-note" role="status">{note}</p>}
    </>
  )
}

export default function SaturdayCard({ card, onAction }) {
  const { eyebrow, big, ring, spotlight, table, button } = card
  return (
    <article className={`sc${card.gold ? ' sc--gold' : ''}${card.soft ? ' sc--soft' : ''}`} aria-label={`Saturday League, ${eyebrow.text.toLowerCase()}`}>
      <header className="sc-head">
        <div className="sc-top">
          <span className={`sc-tag${card.faint ? ' sc-tag--faint' : ''}`}>SATURDAY LEAGUE</span>
          <span className="sc-eyebrow"><Marker kind={eyebrow.kind} />
            {eyebrow.short
              ? <><span className="sc-st-long">{eyebrow.text}</span><span className="sc-st-short">{eyebrow.short}</span></>
              : eyebrow.text}
          </span>
        </div>
        <div className="sc-main">
          <div className="sc-copy">
            <FitHeadline text={card.headline} />
            {card.sub && <div className="sc-sub">{card.sub}</div>}
            <div className="sc-big" {...(big.tick ? { role: 'timer', 'aria-live': 'off' } : {})}>{big.text}</div>
            {card.label && <div className="sc-label">{card.label}</div>}
          </div>
          <Ring ring={ring} faint={card.faint} />
        </div>
      </header>
      <div className="sc-body">
        {spotlight && (
          <Spotlight
            spot={spotlight}
            onOpen={() => onAction({ competition: card.competition, button: { action: spotlight.action } })}
          />
        )}
        {table && <Table table={table} />}
        {card.notify ? (
          <NotifyButton card={card} onAction={onAction} />
        ) : (
          <button
            type="button"
            className={`sc-btn ${button.outline ? 'sc-btn--outline' : 'sc-btn--solid'}`}
            onClick={() => onAction(card)}
          >
            {button.label}
          </button>
        )}
      </div>
    </article>
  )
}
