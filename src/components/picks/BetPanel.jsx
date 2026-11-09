import BankerSwitch from './BankerSwitch.jsx'

// Under the selected runner: Win / Each-way where allowed, what it's worth, the banker switch and Save.
//   eachWayOffered  show the toggle; otherwise `note` explains why it's win only
//   worth           { runners, options: [{ type, text, doubled }] }: a card per option, or null with no price
//   banker          { on, movesFrom, onToggle } when the race day has bonuses, otherwise null
export default function BetPanel({ eachWayOffered, betType, note, worth, banker, isUpdate, saving, onBetType, onSave }) {
  return (
    <div className="pk-panel">
      {worth ? (
        <div className="pk-worth" role="group" aria-label="What it's worth">
          <span className="pk-worth__label">What it's worth · based on {worth.runners} runners</span>
          <div className="pk-opts">
            {worth.options.map(o => (
              <button key={o.type} type="button" className={`pk-opt${betType === o.type ? ' pk-opt--on' : ''}`}
                aria-pressed={betType === o.type} onClick={() => onBetType(o.type)}>
                <span className="pk-opt__name">{o.type === 'win' ? 'All-in Win' : 'Each-way'}</span>
                <span className={`pk-opt__figs${o.doubled ? ' pk-opt__figs--gold' : ''}`}>{o.text}</span>
              </button>
            ))}
          </div>
          {!eachWayOffered && note && <div className="pk-panel__note">{note}</div>}
        </div>
      ) : eachWayOffered ? (
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
      {banker && <BankerSwitch {...banker} />}
      <button type="button" className="pk-btn pk-btn--solid" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : isUpdate ? 'Update Pick' : 'Save Pick'}
      </button>
    </div>
  )
}
