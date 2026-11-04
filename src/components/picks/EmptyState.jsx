export default function EmptyState({ text = "Picks open when this week's races are published." }) {
  return (
    <div className="pk-empty">
      <div className="pk-empty__title">No races yet</div>
      <p className="pk-empty__text">{text}</p>
    </div>
  )
}
