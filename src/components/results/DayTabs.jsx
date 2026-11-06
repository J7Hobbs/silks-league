// Festival days (Tue, Wed...). Days that haven't locked yet are greyed out and can't be tapped.
export default function DayTabs({ tabs, selectedId, onSelect }) {
  return (
    <div className="rs-days" role="group" aria-label="Festival day">
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
