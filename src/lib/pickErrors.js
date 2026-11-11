// What to tell a player when saving a pick is refused. The database refuses writes after the lock with a message that
// starts "Picks are locked" (supabase/picks_lock_server_side_migration.sql, and the older banker guard). Show that plainly
// instead of a generic "Failed to save — <technical text>".
export const isLockError = e => /picks are locked/i.test(e?.message || '')

export const pickSaveMessage = e => (isLockError(e) ? 'Picks are locked' : `Failed to save — ${e?.message || 'something went wrong'}`)

// The pick went through but the banker switch did not.
export const bankerFailMessage = e => (isLockError(e)
  ? 'Picks are locked, so the banker was not changed'
  : `Pick saved, but the banker was not changed: ${e?.message || 'something went wrong'}`)
