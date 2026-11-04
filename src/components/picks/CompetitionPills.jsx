// Competition switcher: Saturday League plus each running festival.
// items: [{ key, label }]
export default function CompetitionPills({ items, activeKey, onSelect }) {
  return (
    <div className="pk-scroll" role="group" aria-label="Competition">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          className={`pk-pill${item.key === activeKey ? ' pk-pill--on' : ''}`}
          aria-pressed={item.key === activeKey}
          onClick={() => onSelect(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
