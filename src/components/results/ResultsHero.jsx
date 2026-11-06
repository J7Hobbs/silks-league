import EchoRings from '../home/EchoRings.jsx'
import fallbackBanner from '../../assets/ebor-banner.jpg'
import { ordinal } from '../../lib/format.js'

// Same defaults as the festival card on Home.
const FALLBACK_POSITION = 'center 80%'
const DEFAULT_POSITION = 'center 35%'

// The card at the top: the player's points for the day, where they finished, and one line below.
// Saturday League sits on the gold ring echo from Home's Saturday card; a festival on its photo.
//   festival  { banner: { url, position } } for a festival, otherwise null
//   standing  { rank, total } or null (hidden when the player didn't play)
export default function ResultsHero({ festival, label, points, standing, line }) {
  const banner = festival?.banner
  const hasPhoto = !!banner?.url
  return (
    <section className={`rs-hero${festival ? ' rs-hero--fest' : ''}`} aria-label={label}>
      {festival ? (
        <>
          <img
            className="rs-hero__img"
            src={hasPhoto ? banner.url : fallbackBanner}
            alt=""
            style={{ objectPosition: hasPhoto ? (banner.position || DEFAULT_POSITION) : FALLBACK_POSITION }}
          />
          <div className="rs-hero__fade" aria-hidden="true" />
        </>
      ) : (
        <div className="rs-hero__echo" aria-hidden="true"><EchoRings /></div>
      )}
      <div className="rs-hero__label">{label}</div>
      <div className="rs-hero__row">
        <div className="rs-hero__pts">
          <span className="rs-hero__num">{points}</span>
          <span className="rs-hero__unit">pts</span>
        </div>
        {standing && (
          <div className="rs-hero__rank">
            <span className="rs-hero__pos">{ordinal(standing.rank)}</span>
            <span className="rs-hero__of">of {standing.total} {standing.total === 1 ? 'player' : 'players'}</span>
          </div>
        )}
      </div>
      {line && <div className="rs-hero__line">{line}</div>}
    </section>
  )
}
