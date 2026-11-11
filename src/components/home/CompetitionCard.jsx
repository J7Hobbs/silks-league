import FallbackBanner from '../FallbackBanner.jsx'

// Used when a festival has no banner_url set, so it keeps the current photo.
const FALLBACK_POSITION = 'center 80%'
const DEFAULT_POSITION = 'center 35%'

function TopRow({ card, over }) {
  return (
    <div className={`cc-top${over ? ' cc-top--over' : ''}`}>
      <span className={`cc-tag ${card.kind === 'festival' ? 'cc-tag--solid' : 'cc-tag--outline'}`}>{card.tag}</span>
      {card.context && <span className="cc-context">{card.context}</span>}
    </div>
  )
}

// One competition on Home. `isTop` is the first card: gold border, and a solid
// button when its picks are open.
export default function CompetitionCard({ card, isTop, onAction }) {
  const isFestival = card.kind === 'festival'
  const hasPhoto = isFestival && card.image?.url
  const solid = isTop && !card.button.outline

  const body = (
    <>
      {!isFestival && <TopRow card={card} />}
      <h2 className="cc-title">{card.title}</h2>
      {card.tiles.length > 0 && (
        <div className="cc-tiles">
          {card.tiles.map(t => (
            <div key={t.label} className="cc-tile">
              <span className="cc-tile__label">{t.label}</span>
              <span className={`cc-tile__value${t.accent ? ' cc-tile__value--accent' : ''}`}>{t.value}</span>
            </div>
          ))}
        </div>
      )}
      {card.line && <p className="cc-line">{card.line}</p>}
      <button type="button" className={`cc-btn ${solid ? 'cc-btn--solid' : 'cc-btn--outline'}`} onClick={() => onAction(card)}>
        {card.button.label}
      </button>
    </>
  )

  return (
    <article className={`cc${isTop ? ' cc--top' : ''}`} aria-label={card.title}>
      {isFestival && (
        <div className="cc-media">
          {hasPhoto
            ? <img className="cc-media__img" src={card.image.url} alt="" style={{ objectPosition: card.image.position || DEFAULT_POSITION }} />
            : <FallbackBanner className="cc-media__img" style={{ objectPosition: FALLBACK_POSITION }} />}
          <div className="cc-media__shade" />
          <TopRow card={card} over />
        </div>
      )}
      <div className="cc-body">{body}</div>
    </article>
  )
}
