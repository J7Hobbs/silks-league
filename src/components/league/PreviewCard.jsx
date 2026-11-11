import { Link } from 'react-router-dom'
import { photoPosition } from '../../lib/photoPosition.js'
import EchoRings from '../home/EchoRings.jsx'
import FallbackBanner from '../FallbackBanner.jsx'
import LeagueTable from './LeagueTable.jsx'

// Same defaults as the festival card on Home.
const FALLBACK_POSITION = 'center 80%'
const DEFAULT_POSITION = 'center 35%'

// A hub card: a competition's name, where it stands, the top five (the player's own row pinned
// underneath when they are lower down) and a link to the full table.
//   festival  { banner: { url, position } } for the festival card, otherwise null (gold ring echo)
//   rows      { top, pinned } from previewRows(); each row from buildSatTable / buildFestTable
//   columns   the week / day columns to show (the hub passes the last four weeks)
export default function PreviewCard({ title, sub, live, festival, columns, rows, message, to, onPlayer }) {
  const banner = festival?.banner
  const hasPhoto = !!banner?.url
  const list = rows.pinned ? [...rows.top, rows.pinned] : rows.top
  return (
    <section className={`lh-card${festival ? ' lh-card--fest' : ''}`} aria-label={title}>
      {festival ? (
        <>
          {hasPhoto
            ? <img className="lh-card__img" src={banner.url} alt="" style={{ objectPosition: photoPosition(banner.position, DEFAULT_POSITION) }} />
            : <FallbackBanner className="lh-card__img" style={{ objectPosition: photoPosition(FALLBACK_POSITION) }} />}
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
        <LeagueTable variant="hub" dense={!!festival && columns.length >= 5} columns={columns} rows={list} pinned={rows.pinned} onPlayer={onPlayer} />
      )}

      <Link to={to} className="lh-more">Full table &rsaquo;</Link>
    </section>
  )
}
