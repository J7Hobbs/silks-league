import { useState } from 'react'
import { ConfirmSheet, FormSheet, TypeToConfirmSheet } from './sheets.jsx'
import { renameGroup, removeGroupMember, deleteGroup, inviteLink } from '../../lib/adminPlayers.js'
import { initials } from '../../lib/playersView.js'
import { dateText, plural } from '../../lib/adminFmt.js'
import '../../styles/admin-new.css'

// One group: its members and the four things Admin can do to it.
export default function GroupPage({ data, groupId, go, reload, say }) {
  const group = data.groups.find(g => g.id === groupId)
  const [sheet, setSheet] = useState(null)      // 'rename' | 'delete' | { remove: player row }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const back = () => go({ g: null })
  const close = () => { setSheet(null); setError('') }

  if (!group) {
    return (
      <div className="an-card an-card--plain">
        <button type="button" className="an-back" onClick={back}>‹ Groups</button>
        <h2 className="an-h2">That group no longer exists</h2>
      </div>
    )
  }

  const byId = Object.fromEntries(data.rows.map(r => [r.id, r]))
  const memberRows = data.members.filter(m => m.group_id === group.id)
    .map(m => ({ ...m, player: byId[m.user_id], picked: data.last ? !!data.pickedByDay[data.last.key]?.has(m.user_id) : null }))
    .sort((a, b) => Number(b.is_founder) - Number(a.is_founder) || (a.player?.name || '').localeCompare(b.player?.name || ''))

  async function run(fn, done) {
    setBusy(true); setError('')
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    done(r)
  }
  const onRename = () => run(() => renameGroup(group.id, name), r => { close(); say('ok', `Renamed to ${r.name}`); reload() })
  const onRemove = m => run(() => removeGroupMember(group.id, m.user_id), () => { close(); say('ok', `${m.player?.name || 'Member'} removed from ${group.name}`); reload() })
  const onDelete = () => run(() => deleteGroup(group.id), () => { say('ok', `${group.name} deleted`); reload(); go({ g: null }) })

  async function onCopy() {
    const link = inviteLink(group.code)
    try { await navigator.clipboard.writeText(link); say('ok', 'Invite link copied') }
    catch { say('error', `Could not copy. The link is ${link}`) }
  }

  return (
    <div className="an-stack">
      <button type="button" className="an-back" onClick={back}>‹ Groups</button>

      <section className="an-card an-card--plain" aria-label="Group">
        <h2 className="an-h2 an-wrap">{group.name}</h2>
        <dl className="an-facts">
          <div><dt>Creator</dt><dd>{group.creatorId && byId[group.creatorId]
            ? <button type="button" className="an-link an-link--inline" onClick={() => go({ g: null, p: group.creatorId, from: group.id })}>{group.creatorName}</button>
            : group.creatorName}</dd></div>
          <div><dt>Created</dt><dd>{group.createdAt ? dateText(group.createdAt.slice(0, 10)) : 'Unknown'}</dd></div>
          <div><dt>Invite code</dt><dd><span className="an-code">{group.code}</span></dd></div>
          <div><dt>Members</dt><dd>{group.memberCount}</dd></div>
          {group.picked !== null && <div><dt>Picked last race day</dt><dd>{group.picked} of {group.memberCount}</dd></div>}
        </dl>
        {data.last && <p className="an-muted">Last race day: {data.last.title}, {dateText(data.last.date)}.</p>}
      </section>

      <section className="an-actions" aria-label="Actions">
        <button type="button" className="an-btn an-btn--ghost" onClick={() => { setName(group.name); setError(''); setSheet('rename') }}>Rename</button>
        <button type="button" className="an-btn an-btn--ghost" onClick={onCopy}>Copy invite link</button>
        <button type="button" className="an-btn an-btn--ghost an-btn--danger" onClick={() => { setError(''); setSheet('delete') }}>Delete group</button>
      </section>

      <section className="an-card an-card--plain" aria-label="Members">
        <h3 className="an-h3">Members <span className="an-count an-muted">{memberRows.length}</span></h3>
        {memberRows.length === 0 ? <p className="an-muted">This group has no members.</p> : (
          <ul className="an-members">
            {memberRows.map(m => (
              <li key={m.id} className="an-member">
                <button type="button" className="an-member__open" onClick={() => go({ g: null, p: m.user_id, from: group.id })}>
                  <span className="an-avatar an-avatar--sm" aria-hidden="true">{initials(m.player?.name)}</span>
                  <span className="an-prow__main">
                    <span className="an-prow__name"><span className="an-prow__text">{m.player?.name || 'Unknown player'}</span>{m.is_founder && <span className="an-tag an-tag--info">Founder</span>}</span>
                    {m.picked !== null && <span className={`an-muted`}>{m.picked ? 'Picked last race day' : 'Did not pick last race day'}</span>}
                  </span>
                </button>
                <button type="button" className="an-btn an-btn--text an-btn--danger an-btn--sm" onClick={() => { setError(''); setSheet({ remove: m }) }} aria-label={`Remove ${m.player?.name || 'member'}`}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sheet === 'rename' && (
        <FormSheet title="Rename group" busy={busy} onClose={close}>
          <label className="an-field" htmlFor="an-gname">
            <span className="an-field__label">Group name</span>
            <input id="an-gname" className="an-input" value={name} onChange={e => setName(e.target.value)} maxLength={40} autoComplete="off" />
          </label>
          {error && <p className="an-warnbox" role="alert">{error}</p>}
          <div className="rd-actions rd-actions--stack">
            <button type="button" className="gr-btn gr-btn--solid" onClick={onRename} disabled={busy || !name.trim() || name.trim() === group.name}>{busy ? 'Saving…' : 'Save name'}</button>
            <button type="button" className="gr-btn gr-btn--text" onClick={close} disabled={busy}>Cancel</button>
          </div>
        </FormSheet>
      )}
      {sheet?.remove && (
        <ConfirmSheet title={`Remove ${sheet.remove.player?.name || 'this member'}?`} tone="danger" busy={busy} confirm="Remove from group" onConfirm={() => onRemove(sheet.remove)} onClose={close}>
          They are taken out of <strong>{group.name}</strong>. Their picks and points are not touched, and they can rejoin with the invite link.
          {error && <span className="an-warnbox an-warnbox--block" role="alert">{error}</span>}
        </ConfirmSheet>
      )}
      {sheet === 'delete' && (
        <TypeToConfirmSheet title={`Delete ${group.name}?`} expected={group.name} label={`Type ${group.name} to confirm`} confirm="Delete group for good"
          busy={busy} error={error} onConfirm={onDelete} onClose={close}>
          <ul className="an-bullets">
            <li>The group and its {plural(group.memberCount, 'membership')} are removed. The invite link stops working.</li>
            <li>Nobody&rsquo;s picks or points change.</li>
            <li>This cannot be undone.</li>
          </ul>
        </TypeToConfirmSheet>
      )}
    </div>
  )
}
