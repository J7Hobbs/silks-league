import BankerSwitch from './BankerSwitch.jsx'

// Under the selected runner: Win / Each-way where allowed, what it's worth, the banker switch and Save.
//   eachWayOffered  show the toggle; otherwise `note` explains why it's win only
//   worth           { text, doubled, runners } for the "What it's worth" line, or null with no price
//   banker          { on, movesFrom, onToggle } when the race day has bonuses, otherwise null
export default function BetPanel({ eachWayOffered, betType, note, worth, banker, isUpdate, saving, onBetType, onSave }) {
  return (
    <div className="pk-panel">
      {eachWayOffered ? (
        <div className="pk-bet" role="group" aria-label="Bet type">
          <button type="button" className={`pk-bet__btn${betType === 'win' ? ' pk-bet__btn--on' : ''}`}
            aria-pressed={betType === 'win'} onClick={() => onBetType('win')}>
            All-in Win
          </button>
          <button type="button" className={`pk-bet__btn${betType === 'each_way' ? ' pk-bet__btn--on' : ''}`}
            aria-pressed={betType === 'each_way'} onClick={() => onBetType('each_way')}>
            Each-way
          </button>
        </div>
      ) : (
        note && <div className="pk-panel__note">{note}</div>
      )}
      {worth && (
        <div className="pk-worth">
          <span className="pk-worth__label">What it's worth · based on {worth.runners} runners</span>
          <span className={`pk-worth__figs${worth.doubled ? ' pk-worth__figs--gold' : ''}`}>{worth.text}</span>
        </div>
      )}
      {banker && <BankerSwitch {...banker} />}
      <button type="button" className="pk-btn pk-btn--solid" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : isUpdate ? 'Update Pick' : 'Save Pick'}
      </button>
    </div>
  )
}
