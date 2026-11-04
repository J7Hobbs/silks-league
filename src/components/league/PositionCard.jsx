import { ordinal } from '../../lib/format.js'

// Gold card: your rank, your points and how far behind the leader.
export default function PositionCard({ rank, points, line, caption }) {
  return (
    <section className="lg-me">
      <div className="lg-me__rank">{ordinal(rank)}</div>
      <div className="lg-me__mid">
        <div className="lg-me__pts">{points} pts</div>
        {line && <div className="lg-me__line">{line}</div>}
      </div>
      {caption && <div className="lg-me__caption">{caption}</div>}
    </section>
  )
}
