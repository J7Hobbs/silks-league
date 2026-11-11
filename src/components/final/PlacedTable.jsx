import { useState } from 'react'

// 4th downwards: the first few rows, the player's own row always visible (gold tint, "Name (you)"), then "See full table".
// `view` is finalView() from lib/festivalFinal.js.
export default function PlacedTable({ view }) {
  const [open, setOpen] = useState(false)
  if (!view.rest.length) return null
  const rows = open ? view.rest : view.visible
  return (
    <section className="fn-card fn-table" aria-label="Table from 4th place">
      <ul className="fn-list">
        {rows.map((r, i) => (
          <li key={r.id} className={`fn-row${r.isMe ? ' fn-row--me' : ''}${!open && r.isMe && i > 0 && rows[i - 1].place + 1 < r.place ? ' fn-row--gap' : ''}`}>
            <span className="fn-row__place">{r.mark}</span>
            <span className="fn-row__name">{r.name}{r.isMe && ' (you)'}</span>
            <span className="fn-row__pts">{r.points}</span>
          </li>
        ))}
      </ul>
      {view.hidden > 0 && !open && (
        <button type="button" className="fn-more" onClick={() => setOpen(true)}>
          <span className="fn-more__dots" aria-hidden="true">&hellip;</span>See full table
        </button>
      )}
    </section>
  )
}
