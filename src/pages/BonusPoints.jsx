import BonusRules from '../components/BonusRules.jsx'
import '../styles/bonus.css'

// ★ Bonus points: the full rules, from the account menu.
export default function BonusPoints() {
  return (
    <div className="app-page bp-page">
      <main className="bp-page__main">
        <span className="bp-page__tag">NEW</span>
        <h1 className="bp-page__title">Bonus points</h1>
        <BonusRules />
      </main>
    </div>
  )
}
