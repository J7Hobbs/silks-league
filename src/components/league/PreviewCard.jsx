import { Link } from 'react-router-dom'
import EchoRings from '../home/EchoRings.jsx'
import fallbackBanner from '../../assets/ebor-banner.jpg'

// Same defaults as the festival card on Home.
const FALLBACK_POSITION = 'center 80%'
const DEFAULT_POSITION = 'center 35%'

// A hub card: a competition's name, where it stands, the top five (the player's own row pinned
// underneath when they are lower down) and a link to the full table.
//   festival  { banner: { url, position } } for the festival card, otherwise null (gold ring echo)
//   rows      { top, pinned } from previewRows(); each row { id, rank, name, points, isMe }
export default function PreviewCard({ title, sub, live, festival, rows, message, to, onPlayer }) {
  const banner = festival?.banner
  const hasPhoto = !!banner?.url
  const list = rows.pinned ? [...rows.top, rows.pinned] : rows.top
  return (
    <section className={`lh-card${festival ? ' lh-card--fest' : ''}`} aria-label={title}>
      {festival ? (
        <>
          <img
            className="lh-card__img"
            src={hasPhoto ? banner.url : fallbackBanner}
            alt=""
            style={{ objectPosition: hasPhoto ? (banner.position || DEFAULT_POSITION) : FALLBACK_POSITION }}
          />
          <div className="lh-card__fade" aria-hidden="true" />
        </>
      ) : (
        <div className="lh-card__echo" aria-hidden="true"><EchoRings /></div>
      )}

      <div className="lh-card__head">
        <div className="lh-card__titles">
          <h2 className="lh-card__title">{title}</h2>
          {sub && <p className="lh-card__sub">{sub}</p>}
        </div>
        {live && <span className="lh-live">LIVE</span>}
      </div>

      {message ? (
        <p className="lh-card__msg">{message}</p>
      ) : (
        <div className="lh-rows">
          {list.map(r => (
            <button
              key={r.id}
              type="button"
              className={`lh-row${r.isMe ? ' lh-row--me' : ''}${r === rows.pinned ? ' lh-row--pinned' : ''}`}
              onClick={() => onPlayer(r)}
            >
              <span className={`lh-row__pos${r.rank === 1 ? ' lh-row__pos--first' : ''}`}>{r.rank}</span>
              <span className="lh-row__name">{r.name}{r.isMe ? ' · you' : ''}</span>
              <span className="lh-row__pts">{r.points}</span>
            </button>
          ))}
        </div>
      )}

      <Link to={to} className="lh-more">Full table &rsaquo;</Link>
    </section>
  )
}
