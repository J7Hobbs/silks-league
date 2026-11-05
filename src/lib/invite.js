// Group invite codes: remembering one through sign-up, checking it, and joining with it.
import { supabase } from './supabase'

const KEY = 'silks_pending_invite'
const KEEP_MS = 3 * 24 * 60 * 60 * 1000 // a saved code is forgotten after three days

// Codes are 8 lowercase letters and numbers. Accept what people paste (any case, spaces).
export function cleanCode(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)
}

function store(kind) {
  try { return window[kind] } catch { return null }
}

// A code waiting to be used. It survives sign-up in three ways: the sign-up page URL, this
// browser (tab and device storage) and, once the account exists, the account itself
// (user_metadata.invite_code), which is what survives a confirmation email opened in a
// different browser.
export function savePendingCode(code) {
  const c = cleanCode(code)
  if (!c) return
  for (const kind of ['sessionStorage', 'localStorage']) {
    try { store(kind)?.setItem(KEY, `${c}|${Date.now()}`) } catch { /* storage can be unavailable */ }
  }
}

export function readPendingCode(user) {
  for (const kind of ['sessionStorage', 'localStorage']) {
    try {
      const [code, at] = String(store(kind)?.getItem(KEY) ?? '').split('|')
      const c = cleanCode(code)
      if (c && Date.now() - Number(at) < KEEP_MS) return c
    } catch { /* ignore */ }
  }
  return cleanCode(user?.user_metadata?.invite_code)
}

// Forget the code everywhere, so a later log-in doesn't join the group again.
export async function clearPendingCode(user) {
  for (const kind of ['sessionStorage', 'localStorage']) {
    try { store(kind)?.removeItem(KEY) } catch { /* ignore */ }
  }
  if (user?.user_metadata?.invite_code) {
    try { await supabase.auth.updateUser({ data: { invite_code: null } }) } catch { /* ignore */ }
  }
}

// Join a group by code. Resolves { status, group? } where status is
// 'joined' | 'already' | 'invalid' | 'error' (with a message).
export async function joinGroupByCode(userId, rawCode) {
  const code = cleanCode(rawCode)
  if (!code) return { status: 'invalid' }
  const { data: group, error: gErr } = await supabase
    .from('groups').select('id, name').eq('invite_code', code).maybeSingle()
  if (gErr) return { status: 'error', message: gErr.message || 'Could not look up that code.' }
  if (!group) return { status: 'invalid' }

  const { data: existing, error: eErr } = await supabase
    .from('group_members').select('id').eq('group_id', group.id).eq('user_id', userId).maybeSingle()
  if (eErr) return { status: 'error', message: eErr.message || 'Could not join the group.' }
  if (existing) return { status: 'already', group }

  const { error: mErr } = await supabase
    .from('group_members').insert({ group_id: group.id, user_id: userId, is_founder: false })
  if (mErr) return { status: 'error', message: mErr.message || 'Could not join the group.' }
  return { status: 'joined', group }
}

// The group's name for a logged-out visitor (public check_invite_code function).
// string = valid; null = no such code; undefined = couldn't check (function missing or offline),
// so the page lets them carry on and the real check happens after sign-in.
export async function checkInviteCode(rawCode) {
  const code = cleanCode(rawCode)
  if (!code) return null
  try {
    const { data, error } = await supabase.rpc('check_invite_code', { p_code: code })
    if (error) return undefined
    return typeof data === 'string' && data ? data : null
  } catch {
    return undefined
  }
}
