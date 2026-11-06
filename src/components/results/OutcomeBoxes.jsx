// Won / Placed / Unplaced for the race day on screen. Races with no pick are not counted.
export default function OutcomeBoxes({ won, placed, unplaced }) {
  const boxes = [
    { key: 'won', label: 'Won', value: won },
    { key: 'placed', label: 'Placed', value: placed },
    { key: 'unplaced', label: 'Unplaced', value: unplaced },
  ]
  return (
    <div className="rs-boxes">
      {boxes.map(b => (
        <div key={b.key} className={`rs-box rs-box--${b.key}`}>
          <span className="rs-box__num">{b.value}</span>
          <span className="rs-box__lbl">{b.label}</span>
        </div>
      ))}
    </div>
  )
}
