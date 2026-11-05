import FestivalPhoto from '../festivals/FestivalPhoto.jsx'
import '../../styles/festivals.css'

// The "Coming up" photo card on the landing page. Draws what festivalTeaser() prepared.
export default function FestivalTeaser({ teaser }) {
  return (
    <article className="lp-fest" aria-label={`${teaser.tag.toLowerCase()}: ${teaser.name}`}>
      <div className="lp-fest__photo">
        <FestivalPhoto url={teaser.photo.url} position={teaser.photo.position} venue={teaser.venue} name={teaser.name} />
        <div className="fx-shade" />
        <span className="lp-fest__tag">{teaser.tag}</span>
        <div className="lp-fest__over">
          {teaser.venue && <span className="lp-fest__venue">{teaser.venue}</span>}
          <h3 className="lp-fest__name">{teaser.name}</h3>
          <span className="lp-fest__dates">{teaser.dates}</span>
        </div>
      </div>
    </article>
  )
}
