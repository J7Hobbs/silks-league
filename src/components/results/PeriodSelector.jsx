// Steps through race weeks (Saturday League) or days (festivals).
function Arrow({ dir, label, disabled, onClick }) {
  return (
    <button type="button" className="rs-arrow" aria-label={label} disabled={disabled} onClick={onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={dir === 'back' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  )
}

export default function PeriodSelector({ label, canBack, canForward, onBack, onForward, unit = 'week' }) {
  return (
    <div className="rs-period">
      <Arrow dir="back" label={`Previous ${unit}`} disabled={!canBack} onClick={onBack} />
      <div className="rs-period__label" aria-live="polite">{label}</div>
      <Arrow dir="forward" label={`Next ${unit}`} disabled={!canForward} onClick={onForward} />
    </div>
  )
}
