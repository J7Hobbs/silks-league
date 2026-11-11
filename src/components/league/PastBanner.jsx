import EchoRings from '../home/EchoRings.jsx'
import { photoPosition } from '../../lib/photoPosition.js'
import FallbackBanner from '../FallbackBanner.jsx'

// Same defaults as the festival card on Home.
const FALLBACK_POSITION = 'center 80%'
const DEFAULT_POSITION = 'center 35%'

// The card at the top of a past competition: its photo (festival) or the gold ring echo (Saturday
// League), a small-caps "Final table" label, the name, and how the player finished.
//   festival  { banner: { url, position } } for a festival, otherwise null
export default function PastBanner({ festival, eyebrow, title, line, muted = false }) {
  const banner = festival?.banner
  const hasPhoto = !!banner?.url
  return (
    <section className={`lp-banner${festival ? ' lp-banner--fest' : ''}`} aria-label={title}>
      {festival ? (
        <>
          {hasPhoto
            ? <img className="lp-banner__img" src={banner.url} alt="" style={{ objectPosition: photoPosition(banner.position, DEFAULT_POSITION) }} />
            : <FallbackBanner className="lp-banner__img" style={{ objectPosition: photoPosition(FALLBACK_POSITION) }} />}
          <div className="lp-banner__fade" aria-hidden="true" />
        </>
      ) : (
        <div className="lp-banner__echo" aria-hidden="true"><EchoRings /></div>
      )}
      <div className="lp-banner__eyebrow">{eyebrow}</div>
      <h1 className="lp-banner__title">{title}</h1>
      {line && <p className={`lp-banner__line${muted ? ' lp-banner__line--muted' : ''}`}>{line}</p>}
    </section>
  )
}
