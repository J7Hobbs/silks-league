import EchoRings from '../home/EchoRings.jsx'
import { photoPosition } from '../../lib/photoPosition.js'
import FallbackBanner from '../FallbackBanner.jsx'
import { ordinal } from '../../lib/format.js'
import BonusSummary from './BonusSummary.jsx'

// Same defaults as the festival card on Home.
const FALLBACK_POSITION = 'center 80%'
const DEFAULT_POSITION = 'center 35%'

// The card at the top: the player's points for the day, where they finished, and one line below.
// Saturday League sits on the gold ring echo from Home's Saturday card; a festival on its photo.
//   festival  { banner: { url, position } } for a festival, otherwise null
//   standing  { rank, total } or null (hidden when the player didn't play)
//   bonus     { total, tags } for "Includes x bonus pts" and the bonus tags, or null
export default function ResultsHero({ festival, label, points, standing, line, bonus }) {
  const banner = festival?.banner
  const hasPhoto = !!banner?.url
  return (
    <section className={`rs-hero${festival ? ' rs-hero--fest' : ''}`} aria-label={label}>
      {festival ? (
        <>
          {hasPhoto
            ? <img className="rs-hero__img" src={banner.url} alt="" style={{ objectPosition: photoPosition(banner.position, DEFAULT_POSITION) }} />
            : <FallbackBanner className="rs-hero__img" style={{ objectPosition: photoPosition(FALLBACK_POSITION) }} />}
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
      <BonusSummary bonus={bonus} className="rs-bonus--hero" />
      {line && <div className="rs-hero__line">{line}</div>}
    </section>
  )
}
