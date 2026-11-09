import { useEffect, useRef } from 'react'

// One chip per race, numbered. A dot under the number means a pick is in.
// A ★ on a chip marks the banker race.
// races: [{ id, race_number }]; picked: (raceId) => bool; banker: (raceId) => bool (optional)
export default function RaceChips({ races, activeIndex, picked, banker, onSelect }) {
  const rowRef = useRef(null)

  useEffect(() => {
    rowRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [activeIndex, races])

  return (
    <div className="pk-scroll" ref={rowRef} role="group" aria-label="Races">
      {races.map((race, i) => {
        const on = i === activeIndex
        const done = picked(race.id)
        const star = !!banker && banker(race.id)
        const cls = on ? ' pk-chip--on' : done ? ' pk-chip--picked' : ''
        return (
          <button
            key={race.id}
            type="button"
            className={`pk-chip${cls}`}
            aria-current={on ? 'true' : undefined}
            aria-label={`Race ${race.race_number}${done ? ', picked' : ''}${star ? ', banker' : ''}`}
            onClick={() => onSelect(i)}
          >
            {star && <span className="pk-chip__star" aria-hidden="true">★</span>}
            <span className="pk-chip__num">{race.race_number}</span>
            <span className={`pk-chip__dot${done ? ' pk-chip__dot--on' : ''}`} />
          </button>
        )
      })}
    </div>
  )
}
