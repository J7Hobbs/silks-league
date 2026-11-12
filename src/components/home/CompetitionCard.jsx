import FallbackBanner from '../FallbackBanner.jsx'
import Silk from '../Silk.jsx'
import { photoPosition } from '../../lib/photoPosition.js'

// Used when a festival has no banner_url set, so it keeps the current photo.
const FALLBACK_POSITION = 'center 80%'
const DEFAULT_POSITION = 'center 35%'

function Pill({ pill }) {
  return (
    <span className={`fc-pill fc-pill--${pill.tone}`}>
      {(pill.tone === 'open' || pill.tone === 'racing') && <span className="fc-pill__dot" aria-hidden="true" />}
      {pill.text}
    </span>
  )
}

function DayTile({ day, onOpen }) {
  const inner = (
    <>
      <span className="fc-day__wk">{day.weekday}</span>
      <span className="fc-day__date">{day.date}</span>
      <span className="fc-day__line">{day.line}</span>
    </>
  )
  const cls = `fc-day fc-day--${day.kind}`
  return day.action
    ? <button type="button" className={cls} aria-label={`${day.label}: ${day.line}`} onClick={() => onOpen(day.action)}>{inner}</button>
    : <div className={cls}>{inner}</div>
}

function SilkTile({ item, onOpen, action }) {
  const label = item.runner ? `${item.label}: ${item.name}${item.banker ? ' (banker)' : ''}${item.tag ? `, ${item.tag}` : ''}` : `${item.label}: no pick yet`
  return (
    <button type="button" className={`fc-silk fc-silk--${item.status}${item.banker ? ' fc-silk--banker' : ''}`} aria-label={label} onClick={() => onOpen(action)}>
      {item.banker && <span className="fc-silk__b" aria-hidden="true">B</span>}
      {item.runner
        ? <Silk runner={item.runner} style={{ width: '100%', height: 'auto', aspectRatio: '1 / 1', display: 'block' }} />
        : <span className="fc-silk__plus" aria-hidden="true">+</span>}
      <span className="fc-silk__r">{item.label}</span>
      <span className="fc-silk__tag">{item.tag}</span>
    </button>
  )
}

// The festival on Home (design C): photo header, status pill, the big figure, a tile per festival day, today's picks as
// silks and the main button. All the content comes ready-made from lib/festivalCard.js; this only draws it.
// `isTop` is the first card: gold border, and a solid button when its picks are open.
export default function CompetitionCard({ card, isTop, onAction }) {
  const hasPhoto = !!card.image?.url
  const solid = isTop && !card.button.outline
  const open = action => onAction(card, action)

  return (
    <article className={`cc fc${isTop ? ' cc--top' : ''}`} aria-label={card.title}>
      <div className="fc-media">
        {hasPhoto
          ? <img className="fc-media__img" src={card.image.url} alt="" style={{ objectPosition: photoPosition(card.image.position, DEFAULT_POSITION) }} />
          : <FallbackBanner className="fc-media__img" style={{ objectPosition: photoPosition(FALLBACK_POSITION) }} />}
        <div className="fc-media__fade" />
        <div className="fc-top">
          <span className="cc-tag cc-tag--solid">{card.tag}</span>
          <Pill pill={card.pill} />
        </div>
      </div>

      <div className="fc-body">
        <div className="fc-head">
          {card.context && <p className="fc-eyebrow">{card.context}</p>}
          <h2 className="fc-title">{card.title}</h2>
        </div>

        <div className="fc-figure">
          <span className="fc-figure__value">{card.figure.value}</span>
          <span className="fc-figure__sub">{card.figure.sub}</span>
        </div>

        {card.days.length > 0 && (
          <div className="fc-days" style={{ gridTemplateColumns: `repeat(${card.days.length}, minmax(0, 1fr))` }}>
            {card.days.map(d => <DayTile key={d.key} day={d} onOpen={open} />)}
          </div>
        )}

        {card.silks && (
          <div className="fc-silks" style={{ gridTemplateColumns: `repeat(${card.silks.items.length}, minmax(0, 1fr))` }}>
            {card.silks.items.map(it => <SilkTile key={it.key} item={it} action={card.silks.action || undefined} onOpen={open} />)}
          </div>
        )}

        {card.note && <p className="fc-note">{card.note}</p>}

        <button type="button" className={`cc-btn ${solid ? 'cc-btn--solid' : 'cc-btn--outline'}`} onClick={() => open(card.button.action)}>
          {card.button.label}
        </button>
      </div>
    </article>
  )
}
