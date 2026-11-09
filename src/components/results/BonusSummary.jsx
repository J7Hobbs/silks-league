// "Includes 105 bonus pts" and a tag for each bonus won that day (★ Banker +x, Lone winner +25,
// Treble +50). Nothing is shown on a day with no bonuses.
//   bonus  { total, tags: [{ key, text }] } from bonusSummary()
export default function BonusSummary({ bonus, className = '' }) {
  if (!bonus || !bonus.total) return null
  return (
    <div className={`rs-bonus ${className}`.trim()}>
      <span className="rs-bonus__line">Includes {bonus.total} bonus pts</span>
      <span className="rs-bonus__tags">
        {bonus.tags.map(t => <span key={t.key} className={`rs-tag rs-tag--${t.key}`}>{t.text}</span>)}
      </span>
    </div>
  )
}
