// The faint gold rings that fan out behind the ring on the Saturday League card.
// Shared by Home and the Results hero. It centres itself on its positioned parent
// (see .sc-echo in saturday-card.css); `faint` halves the opacity, `boost` multiplies it (the
// Results waiting-state ghost doubles it to offset its own fade).
import '../../styles/saturday-card.css'

// Radius and opacity, fading outwards.
const ECHO = [[66, 0.16], [90, 0.138], [116, 0.115], [144, 0.093], [174, 0.07], [206, 0.05], [240, 0.03]]

export default function EchoRings({ faint = false, boost = 1 }) {
  return (
    <svg className="sc-echo" viewBox="-250 -250 500 500" aria-hidden="true">
      {ECHO.map(([radius, opacity]) => (
        <circle key={radius} cx="0" cy="0" r={radius} className="sc-echo__ring" style={{ opacity: Math.min(1, (faint ? opacity / 2 : opacity) * boost) }} />
      ))}
    </svg>
  )
}
