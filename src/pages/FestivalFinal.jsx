/**
 * Silks League — festival wrap-up (/festival/:festivalId/final)
 * Podium, the rest of the table and "Your meeting", once the last race of the last day is in. Read-only: totals are the
 * Leaderboard's own (lib/festivalFinal.js). The pieces are generic (components/final/), so a season wrap-up can reuse them.
 */
import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { monthAbbr, dayRange } from '../lib/format.js'
import { loadFestivalFinal } from '../lib/festivalFinal.js'
import { finalView, meetingPositions, openScope, finalPath } from '../lib/finalTable.js'
import { getLbScope, setLbScope } from '../lib/lbScope.js'
import { useLeagueUser } from '../components/league/useLeagueUser.js'
import ScopeChips from '../components/final/ScopeChips.jsx'
import Podium from '../components/final/Podium.jsx'
import PlacedTable from '../components/final/PlacedTable.jsx'
import MeetingCard from '../components/final/MeetingCard.jsx'
import { LeagueSkeleton } from '../components/Skeletons.jsx'
import '../styles/picks.css'
import '../styles/league.css'
import '../styles/final.css'

// "12–14 Aug", or "30 Jul–1 Aug" across a month.
function dateRange(f) {
  if (!f.start_date) return ''
  const end = f.end_date || f.start_date
  if (monthAbbr(f.start_date) === monthAbbr(end)) return `${dayRange(f.start_date, end)} ${monthAbbr(end)}`
  return `${dayRange(f.start_date, f.start_date)} ${monthAbbr(f.start_date)}–${dayRange(end, end)} ${monthAbbr(end)}`
}

function TopBar({ onShare, note }) {
  return (
    <div className="fn-top">
      <Link to="/league" className="lg-back">&lsaquo; Leaderboard</Link>
      {onShare && <button type="button" className="fn-share" onClick={onShare}>Share</button>}
      <span className="fn-note" role="status" aria-live="polite">{note}</span>
    </div>
  )
}

export default function FestivalFinal() {
  const { festivalId } = useParams()
  const user = useLeagueUser()
  const [data, setData] = useState(undefined)   // undefined = loading, { state: ... }
  const [scopeKey, setScopeKey] = useState('everyone')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadFestivalFinal(festivalId, user.id)
      .then(d => {
        if (cancelled) return
        setData(d)
        if (d.state === 'final') setScopeKey(openScope(d.scopes, getLbScope()))
      })
      .catch(() => { if (!cancelled) setData({ state: 'missing' }) })
    return () => { cancelled = true }
  }, [user, festivalId])

  if (data === undefined) return <LeagueSkeleton />

  if (data.state === 'missing') {
    return (
      <div className="app-page lg"><main className="lg__main">
        <TopBar />
        <h1 className="lg-title">Festival</h1>
        <p className="lg-msg">We couldn't find that festival.</p>
      </main></div>
    )
  }

  const f = data.festival
  const name = f.display_name || f.name
  const eyebrow = [f.venue, dateRange(f), 'Final'].filter(Boolean).join(' · ')

  if (data.state === 'pending') {
    return (
      <div className="app-page lg fn"><main className="lg__main">
        <TopBar />
        <p className="fn-eyebrow">{eyebrow}</p>
        <h1 className="lg-title">{name}</h1>
        <p className="lg-msg">Final table appears once the last race is in.</p>
      </main></div>
    )
  }

  async function share() {
    const url = `${window.location.origin}${finalPath(festivalId)}`
    const text = `Final table from ${name} on Silks League`
    try {
      if (navigator.share) await navigator.share({ title: name, text, url })
      else { await navigator.clipboard.writeText(`${text} ${url}`); setNote('Link copied'); setTimeout(() => setNote(''), 2500) }
    } catch { /* the share sheet was closed */ }
  }

  const scope = data.scopes.find(s => s.key === scopeKey) || data.scopes[0]
  const view = finalView(data.entrants, scope, user.id)
  const choose = key => {
    setScopeKey(key)
    setLbScope(key === 'everyone' ? { kind: 'everyone' } : { kind: 'group', id: key })
  }

  return (
    <div className="app-page lg fn"><main className="lg__main">
      <TopBar onShare={share} note={note} />
      <p className="fn-eyebrow">{eyebrow}</p>
      <h1 className="lg-title">{name}</h1>
      <ScopeChips scopes={data.scopes} value={scope.key} onChange={choose} />
      {view.total === 0 ? <p className="lg-msg">No one made picks in this festival.</p> : (
        <>
          <Podium podium={view.podium} />
          <PlacedTable key={scope.key} view={view} />
        </>
      )}
      {data.me && <MeetingCard positions={meetingPositions(data.entrants, data.scopes, user.id, scope.key)} figures={data.me} />}
    </main></div>
  )
}
