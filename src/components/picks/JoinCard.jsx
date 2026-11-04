// Shown above the races when the player hasn't entered this festival yet.
export default function JoinCard({ name, onJoin }) {
  return (
    <section className="pk-join">
      <div>
        <div className="pk-join__title">Join {name}</div>
        <div className="pk-join__text">Enter to start making picks. You can look at the races first.</div>
      </div>
      <button type="button" className="pk-btn pk-btn--solid" onClick={onJoin}>Join festival</button>
    </section>
  )
}
