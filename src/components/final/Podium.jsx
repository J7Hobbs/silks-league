// 2nd on the left, 1st in the centre (taller, gold), 3rd on the right. Ties share a place, so the label is the row's own
// ("=1st"). With fewer than three players it shows what exists. `podium`: [{ slot, id, name, points, label, isMe }].
export default function Podium({ podium }) {
  if (!podium.length) return null
  return (
    <section className="fn-card fn-podium" aria-label="Podium">
      {podium.map(p => (
        <div key={p.id} className={`fn-pod fn-pod--${p.slot}${p.isMe ? ' fn-pod--me' : ''}`}>
          <span className="fn-pod__avatar" aria-hidden="true">{(p.name || '?').trim().charAt(0).toUpperCase()}</span>
          <span className="fn-pod__name">{p.name}{p.isMe && <span className="fn-you"> you</span>}</span>
          <span className="fn-pod__pts">{p.points}<small> pts</small></span>
          <span className="fn-pod__step"><span className="fn-pod__place">{p.label}</span></span>
        </div>
      ))}
    </section>
  )
}
