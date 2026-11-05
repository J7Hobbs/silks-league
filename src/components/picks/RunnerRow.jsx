import Silk from '../Silk.jsx'
import BetPanel from './BetPanel.jsx'

// One runner. Tapping selects it and expands the bet panel underneath.
//   selected  highlighted (the runner being picked / the saved pick when locked)
//   isPick    the saved pick: gold-filled price, gold-bordered row, "Your pick" for screen readers
//   panel     props for BetPanel when the row is expanded, otherwise null
//   disabled  not tappable (locked, not joined)
export default function RunnerRow({ runner, selected, isPick, disabled, panel, onTap, onBetType, onSave }) {
  const withdrawn = !!runner.is_withdrawn
  const line2 = [
    !withdrawn && runner.form_string ? `Form ${runner.form_string}` : null,
    runner.jockey,
    runner.trainer,
  ].filter(Boolean).join(' · ')
  const pick = !!isPick && !withdrawn
  const cls = ['pk-runner', selected && !withdrawn && 'pk-runner--on', pick && 'pk-runner--pick', withdrawn && 'pk-runner--wd'].filter(Boolean).join(' ')
  const priceCls = ['pk-price', pick && 'pk-price--pick', withdrawn && 'pk-price--wd'].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      <button
        type="button"
        className="pk-runner__row"
        disabled={disabled || withdrawn}
        aria-pressed={selected && !withdrawn}
        aria-expanded={panel ? true : undefined}
        onClick={onTap}
      >
        <span className="pk-silk"><Silk runner={runner} style={{ width: '100%', height: '100%' }} /></span>
        <span className="pk-runner__main">
          <span className="pk-runner__top">
            {pick && <span className="pk-sr">Your pick: </span>}
            {runner.horse_number != null && <span className="pk-runner__num">{runner.horse_number}</span>}
            <span className="pk-runner__name">{runner.horse_name}</span>
          </span>
          {line2 && <span className="pk-runner__sub">{line2}</span>}
        </span>
        <span className="pk-runner__side">
          <span className={priceCls}>{withdrawn ? 'NR' : runner.odds_fractional || 'TBA'}</span>
        </span>
      </button>
      {panel && <BetPanel {...panel} onBetType={onBetType} onSave={onSave} />}
    </div>
  )
}
