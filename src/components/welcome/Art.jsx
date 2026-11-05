// The small illustrations on the welcome steps. Drawn in code with made-up example data
// (no real horses, races or players). All decorative, so hidden from screen readers.

const ECHO = [[66, 0.16], [90, 0.138], [116, 0.115], [144, 0.093], [174, 0.07], [206, 0.05], [240, 0.03]]

// The iOS "Share" button: a square with an arrow coming out of the top.
export function ShareIcon() {
  return (
    <svg className="wl-share" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3.5" />
      <path d="M8 7.2 12 3.2l4 4" />
      <path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7a1.5 1.5 0 0 0-1.5-1.5H16" />
    </svg>
  )
}

// Step 2: the Saturday ring at 4 of 7, with the echo circles behind it.
export function RingArt() {
  const SIZE = 148, STROKE = 13, n = 7, done = 4
  const c = SIZE / 2, r = (SIZE - STROKE) / 2
  const slice = (Math.PI * 2) / n, gap = 5 / r
  const pt = a => [c + r * Math.cos(a), c + r * Math.sin(a)]
  return (
    <div className="wl-art wl-art--ring" aria-hidden="true">
      <div className="wl-ring">
        <svg className="wl-echo" viewBox="-250 -250 500 500">
          {ECHO.map(([radius, opacity]) => <circle key={radius} cx="0" cy="0" r={radius} className="wl-echo__ring" style={{ opacity }} />)}
        </svg>
        <svg className="wl-ring__svg" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={c} cy={c} r={c} className="wl-ring__disc" />
          {Array.from({ length: n }, (_, i) => {
            const a0 = -Math.PI / 2 + i * slice + gap / 2
            const a1 = -Math.PI / 2 + (i + 1) * slice - gap / 2
            const [x0, y0] = pt(a0), [x1, y1] = pt(a1)
            return <path key={i} d={`M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`} className={`wl-seg ${i < done ? 'wl-seg--on' : 'wl-seg--off'}`} />
          })}
        </svg>
        <div className="wl-ring__centre"><span className="wl-ring__num">4/7</span></div>
      </div>
      <span className="wl-pill">Picks lock 30 min before race 1</span>
    </div>
  )
}

// Step 3: a short price and a long price, and the all-in / each-way choice.
export function WinArt() {
  return (
    <div className="wl-art wl-art--cards" aria-hidden="true">
      <div className="wl-horse">
        <div className="wl-horse__text">
          <span className="wl-horse__cap">Under 4/1</span>
          <span className="wl-horse__main">Win only</span>
        </div>
        <span className="wl-horse__price">13/8</span>
      </div>
      <div className="wl-horse wl-horse--gold">
        <div className="wl-horse__row">
          <div className="wl-horse__text">
            <span className="wl-horse__cap">4/1 and bigger</span>
            <span className="wl-horse__main">Your choice</span>
          </div>
          <span className="wl-horse__price">10/1</span>
        </div>
        <div className="wl-toggle">
          <span className="wl-toggle__on">All-in win</span>
          <span className="wl-toggle__off">Each-way</span>
        </div>
      </div>
    </div>
  )
}

// Step 5: two example notifications.
export function NotifArt() {
  const items = [
    { title: 'Picks lock in 2 hours', text: "You've picked 4 of 7 at Aintree" },
    { title: 'Result in: race 3', text: 'Your horse won at 10/1' },
  ]
  return (
    <div className="wl-art wl-art--notifs" aria-hidden="true">
      {items.map(n => (
        <div key={n.title} className="wl-notif">
          <span className="wl-notif__icon">S</span>
          <div className="wl-notif__text">
            <span className="wl-notif__title">{n.title}</span>
            <span className="wl-notif__body">{n.text}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
