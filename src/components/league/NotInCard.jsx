// Replaces the position card when the player hasn't entered this competition.
export default function NotInCard({ onMakePicks }) {
  return (
    <section className="lg-notin">
      <div className="lg-notin__title">You're not in this one yet</div>
      <button type="button" className="lg-btn" onClick={onMakePicks}>Make picks</button>
    </section>
  )
}
