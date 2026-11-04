// Day 1 / Day 2 … control, shown only when more than one festival day takes picks.
export default function DaySwitch({ days, activeId, onSelect }) {
  return (
    <div className="pk-seg" role="group" aria-label="Festival day">
      {days.map(day => (
        <button
          key={day.id}
          type="button"
          className={`pk-seg__btn${day.id === activeId ? ' pk-seg__btn--on' : ''}`}
          aria-pressed={day.id === activeId}
          onClick={() => onSelect(day)}
        >
          Day {day.day_number}
        </button>
      ))}
    </div>
  )
}
