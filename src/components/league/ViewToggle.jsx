// Two equal buttons in a track: "This week | Season". items: [{ key, label }]
export default function ViewToggle({ items, value, onChange }) {
  return (
    <div className="lg-seg" role="group" aria-label="Table view">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          className={`lg-seg__btn${item.key === value ? ' lg-seg__btn--on' : ''}`}
          aria-pressed={item.key === value}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
