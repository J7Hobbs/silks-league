import { useState } from 'react'
import { photoPosition } from '../../lib/photoPosition.js'

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
      style={{ objectPosition: photoPosition(position) }}
      onError={() => setFailed(true)}
    />
  )
}
