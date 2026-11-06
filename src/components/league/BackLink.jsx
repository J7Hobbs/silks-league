import { Link } from 'react-router-dom'

// "‹ Leaderboard" at the top of every full-table page.
export default function BackLink() {
  return <Link to="/league" className="lg-back">&lsaquo; Leaderboard</Link>
}
