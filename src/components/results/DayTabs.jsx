import { useRef, useEffect } from 'react'

// Festival days (Tue, Wed...) or, with `scroll`, a longer row (the weeks of a season) that scrolls
// sideways and keeps the selected tab in view. Tabs with locked: false are greyed out and can't be tapped.
export default function DayTabs({ tabs, selectedId, onSelect, scroll = false }) {
  const row = useRef(null)
  useEffect(() => {
    const el = row.current
    const on = el?.querySelector('.rs-day--on')
    if (scroll && el && on) el.scrollLeft = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2
  }, [scroll, selectedId])

  return (
    <div ref={row} className={`rs-days${scroll ? ' rs-days--scroll' : ''}`} role="group" aria-label={scroll ? 'Race week' : 'Festival day'}>
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          className={`rs-day${t.id === selectedId ? ' rs-day--on' : ''}`}
          aria-pressed={t.id === selectedId}
          disabled={!t.locked}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
