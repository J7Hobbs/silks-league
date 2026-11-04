// Under the selected runner: Win / Each-way where allowed, the points preview and Save.
//   eachWayOffered  show the toggle; otherwise `note` explains why it's win only
//   preview         { win, place } points, place null for a win bet
export default function BetPanel({ eachWayOffered, betType, note, preview, isUpdate, saving, onBetType, onSave }) {
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
      {preview && (
        <div className="pk-panel__preview">
          <span>If this wins: <strong>{preview.win} pts</strong></span>
          {preview.place != null && <span>If it places (2nd): <strong>{preview.place} pts</strong></span>}
        </div>
      )}
      <button type="button" className="pk-btn pk-btn--solid" onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : isUpdate ? 'Update Pick' : 'Save Pick'}
      </button>
    </div>
  )
}
