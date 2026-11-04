import { useState } from 'react'

const DEFAULT_POSITION = 'center 35%'

// A festival's banner photo, or a block with the venue's first letter when there is no
// photo (or it fails to load). Fills its parent; the parent sets the size.
export default function FestivalPhoto({ url, position, venue, name }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    const letter = (venue || name || '?').trim().charAt(0).toUpperCase()
    return <div className="fp fp--none" aria-hidden="true"><span className="fp__letter">{letter}</span></div>
  }
  return (
    <img
      className="fp fp--img"
      src={url}
      alt=""
      style={{ objectPosition: position || DEFAULT_POSITION }}
      onError={() => setFailed(true)}
    />
  )
}
