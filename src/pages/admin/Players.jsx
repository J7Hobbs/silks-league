import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PlayerPage from './PlayerPage.jsx'
import GroupPage from './GroupPage.jsx'
import BellIcon from './Bell.jsx'
import { loadAdminPlayers } from '../../lib/adminPlayers.js'
import { FILTERS, filterPlayers, filterCounts, searchPlayers, summarise, initials } from '../../lib/playersView.js'
import { dateText, plural } from '../../lib/adminFmt.js'
import '../../styles/admin-new.css'

// The Players tab. The address says where you are: ?tab=players is the list (&v=groups for Groups),
// &p=<player> a player, &g=<group> a group, so the browser's back button steps back one level.
export default function Players() {
  const [params, setParams] = useSearchParams()
  const view = params.get('v') === 'groups' ? 'groups' : 'players'
  const go = useCallback(patch => {
    const p = new URLSearchParams(params)
    Object.entries(patch).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)))
    setParams(p)
  }, [params, setParams])

  const [state, setState] = useState({ status: 'loading' })
  const [toast, setToast] = useState(null)
  const say = useCallback((type, text) => setToast({ type, text, id: Date.now() }), [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t) }, [toast])

  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await loadAdminPlayers()
        if (!cancelled) setState({ status: 'ready', data })
      } catch (err) {
        console.error('[Admin Players] load failed:', err)
        if (!cancelled) setState(prev => (prev.status === 'ready' ? prev : { status: 'error', message: err.message || String(err) }))
      }
    })()
    return () => { cancelled = true }
  }, [tick])

  if (state.status === 'loading') return <div className="an-note" role="status">Loading players…</div>
  if (state.status === 'error') {
    return (
      <div className="an-card an-card--plain">
        <h2 className="an-h2">Could not load players</h2>
        <p className="an-muted">{state.message}</p>
        <button type="button" className="an-btn an-btn--solid" onClick={() => { setState({ status: 'loading' }); reload() }}>Try again</button>
      </div>
    )
  }
  const { data } = state
  const playerId = params.get('p'), groupId = params.get('g')
  const toastEl = toast && <div className={`an-toast an-toast--${toast.type}`} role="status" key={toast.id}>{toast.type === 'error' ? '⚠ ' : '✓ '}{toast.text}</div>

  if (playerId) {
    return (
      <>
        <PlayerPage key={playerId} data={data} playerId={playerId} go={go} from={params.get('from')} reload={reload} say={say} />
        {toastEl}
      </>
    )
  }
  if (groupId) {
    return (
      <>
        <GroupPage key={groupId} data={data} groupId={groupId} go={go} reload={reload} say={say} />
        {toastEl}
      </>
    )
  }
  return (
    <div className="an-stack">
      <div className="an-seg" role="group" aria-label="Players or groups">
        <button type="button" className={`an-seg__b${view === 'players' ? ' an-seg__b--on' : ''}`} aria-pressed={view === 'players'} onClick={() => go({ v: null })}>Players</button>
        <button type="button" className={`an-seg__b${view === 'groups' ? ' an-seg__b--on' : ''}`} aria-pressed={view === 'groups'} onClick={() => go({ v: 'groups' })}>Groups</button>
      </div>
      {view === 'players' ? <PlayerList data={data} go={go} /> : <GroupList data={data} go={go} />}
      {toastEl}
    </div>
  )
}

function PlayerList({ data, go }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const { rows, current } = data
  const sum = useMemo(() => summarise(rows, current), [rows, current])
  // The filter numbers count the players the search finds, so they match the list below.
  const found = useMemo(() => searchPlayers(rows, query), [rows, query])
  const counts = useMemo(() => filterCounts(found), [found])
  const shown = useMemo(() => filterPlayers(found, filter), [found, filter])
  const searching = query.trim() !== ''
  return (
    <>
      <section className="an-tiles" aria-label="Summary">
        <div className="an-tile">
          <span className="an-tile__n">{sum.total}</span>
          <span className="an-tile__l">Players</span>
          <span className="an-tile__s">in total</span>
        </div>
        <div className="an-tile">
          <span className="an-tile__n">{sum.hasCurrent ? sum.picked : '–'}</span>
          <span className="an-tile__l">Picked</span>
          <span className="an-tile__s">{sum.hasCurrent ? `of ${sum.total} · ${dateText(current.date)}` : 'no race day coming up'}</span>
        </div>
        <div className="an-tile">
          <span className="an-tile__n">{sum.off}</span>
          <span className="an-tile__l">Notifications off</span>
          <span className="an-tile__s">{sum.unknown ? `${sum.unknown} not known yet` : 'everyone known'}</span>
        </div>
      </section>

      <div className="an-search">
        <input id="an-player-search" type="search" className="an-input" placeholder="Search name, username or email" value={query} onChange={e => setQuery(e.target.value)}
          aria-label="Search players" autoComplete="off" autoCapitalize="off" spellCheck={false} />
        {searching && <button type="button" className="an-search__clear" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}
      </div>

      <div className="an-chips" role="group" aria-label="Filter players">
        {FILTERS.map(f => (
          <button key={f.id} type="button" className={`an-chip${filter === f.id ? ' an-chip--on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label} <span className="an-chip__n">{counts[f.id]}</span>
          </button>
        ))}
      </div>
      {current && <p className="an-muted an-filterhelp">{helpText(filter, current)}</p>}

      {shown.length === 0 ? <p className="an-muted an-group__empty">{searching ? `No players match “${query.trim()}”${filter === 'all' ? '' : ' with this filter'}.` : 'No players match this filter.'}</p> : (
        <ul className="an-days">
          {shown.map(r => (
            <li key={r.id}>
              <button type="button" className="an-prow" onClick={() => go({ p: r.id, from: null })}>
                <span className="an-avatar" aria-hidden="true">{initials(r.name)}</span>
                <span className="an-prow__main">
                  <span className="an-prow__name">
                    <span className="an-prow__text">{r.name}</span>
                    <BellIcon state={r.notifications} />
                    {r.isAdmin && <span className="an-tag an-tag--info">Admin</span>}
                    {r.isNew && <span className="an-tag an-tag--info">New</span>}
                  </span>
                  <span className="an-muted">{r.joined ? `Joined ${dateText(r.joined)}` : 'Joined date unknown'}</span>
                  <span className="an-muted">{r.lastPlayed ? `Last played ${dateText(r.lastPlayed.date)}` : 'Not played yet'}</span>
                </span>
                {r.picked !== null && <span className={`an-pill an-pill--${r.picked ? 'ok' : 'off'}`}>{r.picked ? 'Picked' : 'Not yet'}</span>}
                <span className="an-dayrow__go" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function helpText(filter, current) {
  if (filter === 'notpicked') return `Players with no picks yet for ${current.title}.`
  if (filter === 'notifoff') return 'Players whose phone or browser has notifications switched off. Players who have not opened the app since this was added are not counted.'
  if (filter === 'drifting') return 'Played in the last 30 days, but not in either of the last 2 race days.'
  if (filter === 'new') return 'Joined in the last 7 days.'
  return `Picked / Not yet is for ${current.title}.`
}

function GroupList({ data, go }) {
  const { groups, last } = data
  return (
    <section className="an-group" aria-label="Groups">
      <h3 className="an-group__h">Groups <span className="an-muted">{groups.length}</span></h3>
      {last && <p className="an-muted">&ldquo;Picked&rdquo; is for the last race day: {last.title}, {dateText(last.date)}.</p>}
      {groups.length === 0 ? <p className="an-muted an-group__empty">No groups yet.</p> : (
        <ul className="an-days">
          {groups.map(g => (
            <li key={g.id}>
              <button type="button" className="an-prow an-prow--group" onClick={() => go({ g: g.id })}>
                <span className="an-prow__main">
                  <span className="an-prow__name"><span className="an-prow__text">{g.name}</span></span>
                  <span className="an-muted">By {g.creatorName} · {plural(g.memberCount, 'member')}</span>
                  <span className="an-muted">Created {g.createdAt ? dateText(g.createdAt.slice(0, 10)) : 'date unknown'} · code <span className="an-code">{g.code}</span></span>
                  {g.picked !== null && <span className="an-muted">{g.picked} of {g.memberCount} picked last race day</span>}
                </span>
                <span className="an-dayrow__go" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
