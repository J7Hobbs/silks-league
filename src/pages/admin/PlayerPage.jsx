import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BellIcon from './Bell.jsx'
import { TypeToConfirmSheet } from './sheets.jsx'
import { loadPlayerPoints, loadPlayerPicks, deletePlayer } from '../../lib/adminPlayers.js'
import { initials } from '../../lib/playersView.js'
import { dateText, plural, sentText } from '../../lib/adminFmt.js'
import { clockText } from '../../lib/format.js'
import '../../styles/admin-new.css'

const BET = { win: 'Win', each_way: 'Each-way' }

// One player: who they are, how they are doing, their groups and their picks, and the one destructive action.
export default function PlayerPage({ data, playerId, go, from, reload, say }) {
  const player = data.rows.find(r => r.id === playerId)
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const back = () => (from ? go({ p: null, from: null, v: 'groups', g: from }) : go({ p: null, from: null }))

  const groupsIn = useMemo(() => data.groups.filter(g => g.memberIds.includes(playerId)), [data.groups, playerId])
  const groupsMade = useMemo(() => data.groups.filter(g => g.creatorId === playerId), [data.groups, playerId])

  const [points, setPoints] = useState({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const p = await loadPlayerPoints(playerId)
        if (!cancelled) setPoints({ status: 'ready', ...p })
      } catch (err) {
        if (!cancelled) setPoints({ status: 'error', message: err.message || String(err) })
      }
    })()
    return () => { cancelled = true }
  }, [playerId])

  // The race days to look at: the next one, then every one this player has picked on (newest first).
  const { raceDays, pickedByDay, current } = data
  const dayOptions = useMemo(() => {
    const picked = raceDays.filter(d => pickedByDay[d.key]?.has(playerId) && d.key !== current?.key)
    return [...(current ? [current] : []), ...picked.sort((a, b) => b.date.localeCompare(a.date))]
  }, [raceDays, pickedByDay, current, playerId])
  const [dayKey, setDayKey] = useState(() => dayOptions[0]?.key || '')
  const day = dayOptions.find(d => d.key === dayKey) || null

  const [picks, setPicks] = useState({ status: 'idle' })
  useEffect(() => {
    if (!day) return
    let cancelled = false
    ;(async () => {
      setPicks({ status: 'loading' })
      try {
        const rows = await loadPlayerPicks(playerId, day)
        if (!cancelled) setPicks({ status: 'ready', rows })
      } catch (err) {
        if (!cancelled) setPicks({ status: 'error', message: err.message || String(err) })
      }
    })()
    return () => { cancelled = true }
  }, [playerId, day])

  if (!player) {
    return (
      <div className="an-card an-card--plain">
        <button type="button" className="an-back" onClick={back}>‹ Players</button>
        <h2 className="an-h2">That player no longer exists</h2>
      </div>
    )
  }

  async function onDelete() {
    setBusy(true); setError('')
    const r = await deletePlayer(player)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setSheet(false)
    say('ok', `${player.name} deleted`)
    reload()
    go({ p: null, from: null })
  }

  const notifText = player.notifications === true ? 'On' : player.notifications === false ? 'Off' : 'Not known yet'
  const notifWhen = player.notificationsAt ? sentText(player.notificationsAt) : ''

  return (
    <div className="an-stack">
      <button type="button" className="an-back" onClick={back}>{from ? '‹ Group' : '‹ Players'}</button>

      <section className="an-card an-card--plain an-phead" aria-label="Player">
        <span className="an-avatar an-avatar--lg" aria-hidden="true">{initials(player.name)}</span>
        <div className="an-phead__main">
          <h2 className="an-h2">{player.name}</h2>
          <div className="an-phead__tags">
            {player.isAdmin && <span className="an-tag an-tag--info">Admin</span>}
            {player.isNew && <span className="an-tag an-tag--info">New</span>}
            {player.picked !== null && <span className={`an-pill an-pill--${player.picked ? 'ok' : 'off'}`}>{player.picked ? 'Picked' : 'Not picked yet'}{data.current ? ` · ${dateText(data.current.date)}` : ''}</span>}
          </div>
        </div>
      </section>

      <section className="an-card an-card--plain" aria-label="Details">
        <dl className="an-facts">
          <div><dt>Joined</dt><dd>{player.joined ? dateText(player.joined) : 'Unknown'}</dd></div>
          <div><dt>Email</dt><dd className="an-facts__long">{player.email || 'Not stored'}</dd></div>
          <div><dt>Last played</dt><dd>{player.lastPlayed ? `${dateText(player.lastPlayed.date)}` : 'Not played yet'}</dd></div>
          <div><dt>Notifications</dt><dd className="an-facts__bell"><BellIcon state={player.notifications} /> {notifText}</dd></div>
        </dl>
        {notifWhen && <p className="an-muted">Status last updated {notifWhen}. A player with more than one device shows the one they used last.</p>}
        {player.notifications === null && <p className="an-muted">This player has not opened the app since notification status was added, so it is not known yet.</p>}
      </section>

      <section className="an-card an-card--plain" aria-label="Points">
        <h3 className="an-h3">Points</h3>
        {points.status === 'loading' && <p className="an-muted" role="status">Loading points…</p>}
        {points.status === 'error' && <p className="an-muted">Could not load points: {points.message}</p>}
        {points.status === 'ready' && (
          <dl className="an-facts">
            <div><dt>{points.season ? `Season · ${points.season.name}` : 'Season'}</dt><dd>{points.seasonPoints == null ? '–' : `${points.seasonPoints} pts`}</dd></div>
            {points.festivals.length === 0
              ? <div><dt>Festivals</dt><dd>Not entered</dd></div>
              : points.festivals.map(f => <div key={f.id}><dt>{f.name}</dt><dd>{f.points} pts</dd></div>)}
          </dl>
        )}
      </section>

      <section className="an-card an-card--plain" aria-label="Groups">
        <h3 className="an-h3">Groups <span className="an-count an-muted">{groupsIn.length}</span></h3>
        {groupsIn.length === 0 ? <p className="an-muted">Not in any group.</p> : (
          <ul className="an-links">{groupsIn.map(g => (
            <li key={g.id}><button type="button" className="an-link" onClick={() => go({ p: null, from: null, v: 'groups', g: g.id })}>{g.name}<span className="an-muted"> · {plural(g.memberCount, 'member')}</span></button></li>
          ))}</ul>
        )}
        <h3 className="an-h3 an-h3--sub">Created by them <span className="an-count an-muted">{groupsMade.length}</span></h3>
        {groupsMade.length === 0 ? <p className="an-muted">Has not created a group.</p> : (
          <ul className="an-links">{groupsMade.map(g => (
            <li key={g.id}><button type="button" className="an-link" onClick={() => go({ p: null, from: null, v: 'groups', g: g.id })}>{g.name}<span className="an-muted"> · code {g.code}</span></button></li>
          ))}</ul>
        )}
      </section>

      <section className="an-card an-card--plain" aria-label="Picks">
        <h3 className="an-h3">Picks</h3>
        {dayOptions.length === 0 ? <p className="an-muted">No race days with picks yet.</p> : (
          <>
            <label className="an-field" htmlFor="an-pickday">
              <span className="an-field__label">Race day</span>
              <select id="an-pickday" className="an-input" value={dayKey} onChange={e => setDayKey(e.target.value)}>
                {dayOptions.map(d => (
                  <option key={d.key} value={d.key}>{d.key === data.current?.key ? 'Next · ' : ''}{dateText(d.date)} · {d.title}</option>
                ))}
              </select>
            </label>
            {picks.status === 'loading' && <p className="an-muted" role="status">Loading picks…</p>}
            {picks.status === 'error' && <p className="an-muted">Could not load picks: {picks.message}</p>}
            {picks.status === 'ready' && (picks.rows.length === 0 ? <p className="an-muted">That race day has no races yet.</p> : (
              <ul className="an-runnerlist an-pickslist">
                {picks.rows.map(({ race, pick, points: pts }) => (
                  <li key={race.id} className="an-pickrow">
                    <span className="an-race__time">{clockText(race.race_time) || 'TBA'}</span>
                    <span className="an-pickrow__main">
                      <span className="an-pickrow__race">Race {race.race_number}{race.race_name ? ` · ${race.race_name}` : ''}</span>
                      {race.is_abandoned ? <span className="an-pill an-pill--void">Abandoned</span>
                        : pick ? (
                          <span className="an-pickrow__horse">
                            {pick.banker && <span className="an-tag an-tag--info" title="Banker">★ Banker</span>} {pick.horse}
                            <span className="an-muted"> {[pick.price, BET[pick.betType]].filter(Boolean).join(' · ')}{pick.withdrawn ? ' · withdrawn' : ''}</span>
                          </span>
                        ) : <span className="an-muted">No pick</span>}
                    </span>
                    {pts != null && !race.is_abandoned && <span className="an-pickrow__pts">{pts} pts</span>}
                  </li>
                ))}
              </ul>
            ))}
            {day && <Link className="an-btn an-btn--ghost an-btn--sm" to={`/admin?tab=racedays&d=${encodeURIComponent(day.key)}`}>Open this race day</Link>}
          </>
        )}
      </section>

      <section className="an-card an-card--plain an-danger" aria-label="Delete account">
        <h3 className="an-h3">Delete test account</h3>
        {player.isAdmin
          ? <p className="an-muted">Admin accounts cannot be deleted from here.</p>
          : (
            <>
              <p className="an-muted">Removes the sign-in, profile, picks, scores, bonuses and group memberships for good. Use it for test accounts only.</p>
              <button type="button" className="an-btn an-btn--ghost an-btn--danger" onClick={() => { setError(''); setSheet(true) }}>Delete test account</button>
            </>
          )}
      </section>

      {sheet && (
        <TypeToConfirmSheet
          title={`Delete ${player.name}?`} expected={player.name} label={`Type ${player.name} to confirm`} confirm="Delete account for good"
          busy={busy} error={error} onConfirm={onDelete} onClose={() => setSheet(false)}>
          <ul className="an-bullets">
            <li>Their sign-in and profile are removed, so they can no longer log in.</li>
            <li>All their picks, scores and bonuses are deleted, so they drop out of every league table.</li>
            {groupsMade.length > 0 && <li>{plural(groupsMade.length, 'group')} they created will stay, with no creator.</li>}
            <li>This cannot be undone.</li>
          </ul>
        </TypeToConfirmSheet>
      )}
    </div>
  )
}
