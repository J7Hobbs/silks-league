// "Everyone" plus the player's groups. scopes: [{ key, label }]. Reusable for any wrap-up (festival now, a season later).
export default function ScopeChips({ scopes, value, onChange }) {
  if (scopes.length < 2) return null
  return (
    <div className="fn-chips" role="group" aria-label="Table">
      {scopes.map(s => (
        <button key={s.key} type="button" className={`fn-chip${s.key === value ? ' fn-chip--on' : ''}`} aria-pressed={s.key === value} onClick={() => onChange(s.key)}>
          {s.label}
        </button>
      ))}
    </div>
  )
}
