// Which table the player last looked at on the Leaderboard: everyone, or one of their groups. Remembered in the browser so
// the festival "Final" page opens on the same chip. A convenience only: if storage is blocked or the value is stale the
// reader falls back to Everyone, and nothing else depends on it.
const KEY = 'silks-lb-scope'

// { kind: 'everyone' } | { kind: 'group', id }
export function getLbScope() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    if (v?.kind === 'group' && typeof v.id === 'string') return { kind: 'group', id: v.id }
  } catch { /* storage blocked or not JSON */ }
  return { kind: 'everyone' }
}

export function setLbScope(scope) {
  try { localStorage.setItem(KEY, JSON.stringify(scope?.kind === 'group' ? { kind: 'group', id: scope.id } : { kind: 'everyone' })) } catch { /* storage blocked */ }
}
