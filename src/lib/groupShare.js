// Share a group's invite link (/join/CODE). On a phone this opens the share sheet; otherwise
// (or if the share sheet fails) the link is copied. Same behaviour the Groups page always had.
//
// Resolves 'shared' | 'cancelled' | 'copied' | 'failed' | 'blocked'.
// 'blocked' only happens with { copyOnBlocked: false }: the browser refused to open the share
// sheet because it wasn't straight after a tap (as after creating a group), so the caller can
// ask for another tap instead of silently copying.
export async function shareInvite(group, { copyOnBlocked = true } = {}) {
  const url = `${window.location.origin}/join/${group.invite_code}`
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Silks League', text: `Join my group "${group.name}" on Silks League`, url })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled' // they closed the share sheet
      if (err?.name === 'NotAllowedError' && !copyOnBlocked) return 'blocked'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
