// A phone frame holding a small Saturday League card, drawn in code. Static example
// content only: no real usernames, scores or races are ever loaded here.

const SIZE = 64
const STROKE = 6
const GAP_PX = 2.4
// Echo circles behind the ring, same radii and fade as the real card (scaled to this ring).
const ECHO = [[66, 0.16], [90, 0.138], [116, 0.115], [144, 0.093], [174, 0.07], [206, 0.05], [240, 0.03]]

const SEGMENTS = ['gold', 'gold', 'gold', 'gold', 'gold', 'dim', 'dim'] // 5 of 7 picked
const ROWS = [
  { rank: 1, name: 'Player 1', pts: 124 },
  { rank: 2, name: 'Player 2', pts: 118, me: true },
  { rank: 3, name: 'Player 3', pts: 97 },
]

function MiniRing() {
  const n = SEGMENTS.length
  const c = SIZE / 2
  const r = (SIZE - STROKE) / 2
  const slice = (Math.PI * 2) / n
  const gap = GAP_PX / r
  const point = a => [c + r * Math.cos(a), c + r * Math.sin(a)]
  return (
    <div className="pm-ring">
      <svg className="pm-echo" viewBox="-250 -250 500 500" aria-hidden="true">
        {ECHO.map(([radius, opacity]) => (
          <circle key={radius} cx="0" cy="0" r={radius} className="pm-echo__ring" style={{ opacity }} />
        ))}
      </svg>
      <svg className="pm-ring__svg" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={c} cy={c} r={c} className="pm-ring__disc" />
        {SEGMENTS.map((kind, i) => {
          const a0 = -Math.PI / 2 + i * slice + gap / 2
          const a1 = -Math.PI / 2 + (i + 1) * slice - gap / 2
          const [x0, y0] = point(a0)
          const [x1, y1] = point(a1)
          return <path key={i} d={`M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`} className={`pm-seg pm-seg--${kind}`} />
        })}
      </svg>
      <div className="pm-ring__centre"><span className="pm-ring__num">5/7</span></div>
    </div>
  )
}

export default function PhoneMock() {
  return (
    <div className="pm" aria-hidden="true">
      <div className="pm-screen">
        <div className="pm-notch" />
        <div className="pm-card">
          <div className="pm-head">
            <div className="pm-top">
              <span className="pm-tag">SATURDAY LEAGUE</span>
              <span className="pm-status"><span className="pm-dot" />PICKS OPEN</span>
            </div>
            <div className="pm-main">
              <div className="pm-copy">
                <div className="pm-headline">Aintree</div>
                <div className="pm-big">2h 14m</div>
                <div className="pm-label">until picks lock</div>
              </div>
              <MiniRing />
            </div>
          </div>
          <div className="pm-body">
            <div className="pm-table">
              <div className="pm-table__head"><span>TOP 3</span><span>PTS</span></div>
              {ROWS.map(row => (
                <div key={row.rank} className={`pm-row${row.me ? ' pm-row--me' : ''}`}>
                  <span className={`pm-rank${row.rank === 1 ? ' pm-rank--first' : ''}`}>{row.rank}</span>
                  <span className="pm-row__name">{row.name}</span>
                  <span className="pm-row__pts">{row.pts}</span>
                </div>
              ))}
            </div>
            <div className="pm-btn">Finish your picks</div>
          </div>
        </div>
      </div>
    </div>
  )
}
