// Points, winners and placed for the player in the period on screen.
export default function SummaryTiles({ points, winners, placed }) {
  const tiles = [
    { label: 'Points', value: points, gold: true },
    { label: 'Winners', value: winners },
    { label: 'Placed', value: placed },
  ]
  return (
    <div className="rs-tiles">
      {tiles.map(t => (
        <div key={t.label} className="rs-tile">
          <div className="rs-tile__label">{t.label}</div>
          <div className={`rs-tile__value${t.gold ? ' rs-tile__value--gold' : ''}`}>{t.value}</div>
        </div>
      ))}
    </div>
  )
}
