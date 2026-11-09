import { useState } from 'react'
import CompetitionCard from '../../components/home/CompetitionCard.jsx'
import { saveBannerPosition } from '../../lib/adminSetup.js'
import { parseBannerPosition, bannerPositionValue, BANNER_PRESETS } from '../../lib/setupView.js'
import '../../styles/home.css'

// Where the photo sits in the festival banner: a slider from Top to Bottom, with a live preview that is the real Home
// card (the same component Home uses), so what you see here is what players see. Saved to festivals.banner_position,
// which the app already reads everywhere it shows the photo. The parent gives this a key that changes when the photo or
// the saved position changes, so a save starts it fresh.
export default function BannerPosition({ festival, dayCount, say, onSaved }) {
  const stored = parseBannerPosition(festival.banner_position)
  const [y, setY] = useState(stored.y)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const photo = festival.banner_url
  const changed = touched && (y !== stored.y || !stored.saved || stored.odd)

  async function save() {
    setBusy(true)
    const r = await saveBannerPosition(festival.id, y)
    setBusy(false)
    if (!r.ok) { say('error', r.error); return }
    say('ok', 'Photo position saved')
    onSaved()
  }
  const move = v => { setY(Number(v)); setTouched(true) }

  const card = {
    key: 'preview', kind: 'festival', tag: 'FESTIVAL',
    context: [festival.venue, `Day 1 of ${Math.max(dayCount, 1)}`].filter(Boolean).join(' · '),
    title: festival.display_name || festival.name, line: null,
    image: { url: photo, position: bannerPositionValue(y) },
    tiles: [{ label: 'Closes in', value: '2h 15m', accent: true }, { label: 'Your picks', value: '0/6' }, { label: 'Position', value: '—' }],
    button: { label: "Make today's picks" },
  }

  return (
    <section className="an-card an-card--plain" aria-label="Photo position">
      <h3 className="an-h3">Photo position</h3>
      {!photo ? <p className="an-muted">Add a photo first. Then you can choose which part of it shows in the banner.</p> : (
        <>
          <p className="an-muted">Choose which part of the photo shows in the banner. The preview is the Home card, with example numbers.</p>
          <div className="an-chips" role="group" aria-label="Photo position">
            {BANNER_PRESETS.map(p => (
              <button key={p.label} type="button" className={`an-chip${y === p.y ? ' an-chip--on' : ''}`} aria-pressed={y === p.y} onClick={() => move(p.y)}>{p.label}</button>
            ))}
          </div>
          <div className="an-slider">
            <span className="an-muted" aria-hidden="true">Top</span>
            <input id="an-banner-y" type="range" min="0" max="100" step="1" value={y} onChange={e => move(e.target.value)} aria-label="Photo position, from top to bottom" />
            <span className="an-muted" aria-hidden="true">Bottom</span>
          </div>
          {stored.odd && <p className="an-muted">This photo has a position Admin did not set. Saving replaces it.</p>}
          <div className="an-homeframe" inert aria-hidden="true">
            <CompetitionCard card={card} isTop onAction={() => {}} />
          </div>
          <button type="button" className="an-btn an-btn--solid" onClick={save} disabled={!changed || busy}>{busy ? 'Saving…' : changed ? 'Save position' : 'Saved'}</button>
        </>
      )}
    </section>
  )
}
