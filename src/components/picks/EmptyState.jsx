import { NotifLine } from '../NotifStrip.jsx'

// Shown on Picks when there is nothing to pick yet.
//   kind 'linked'    Saturday League week that is a festival day's Saturday card
//   kind 'week'      ordinary Saturday League week with no races yet
//   kind 'festival'  a festival whose day has no races yet (or none open)
// `days` (festival only): [{ id, label, state: 'open' | 'locked' | 'soon', text }]
export default function EmptyState({ kind, eyebrow, title, text, days = [], onOpenDay, notif }) {
  return (
    <section className="pk-nothing" aria-label={title}>
      <div className="pk-nothing__eyebrow">{eyebrow}</div>
      <h2 className="pk-nothing__title">{title}</h2>
      <p className="pk-nothing__text">{text}</p>

      {kind === 'linked' && (
        <div className="pk-nothing__box">
          <strong>Picks open Friday evening</strong>
          <span>We&rsquo;ll notify you when they&rsquo;re live</span>
        </div>
      )}

      {kind === 'festival' && days.length > 0 && (
        <ul className="pk-nothing__days">
          {days.map(d => (
            <li key={d.id} className="pk-nothing__day">
              <span className="pk-nothing__daylabel">{d.label}</span>
              {d.state === 'open'
                ? <button type="button" className="pk-nothing__open" onClick={() => onOpenDay?.(d)}>Open now <span aria-hidden="true">&rsaquo;</span></button>
                : <span className="pk-nothing__state">{d.text}</span>}
            </li>
          ))}
        </ul>
      )}

      {notif && <NotifLine notif={notif} />}
    </section>
  )
}
