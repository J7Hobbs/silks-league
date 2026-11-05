import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { USERNAME_REGEX, RESEND_COOLDOWN_S } from '../../lib/authFlow.js'

// Counts down from 60 after an email is sent. Returns [secondsLeft, start].
export function useCooldown() {
  const [left, setLeft] = useState(0)
  const until = useRef(0)
  const active = left > 0
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setLeft(Math.max(0, Math.ceil((until.current - Date.now()) / 1000))), 500)
    return () => clearInterval(id)
  }, [active])
  const start = (seconds = RESEND_COOLDOWN_S) => {
    until.current = Date.now() + seconds * 1000
    setLeft(seconds)
  }
  return [left, start]
}

// null | 'checking' | 'ok' | 'taken' | 'invalid', for a username being typed.
export function useUsernameStatus(raw, enabled = true) {
  const val = raw.trim()
  const valid = USERNAME_REGEX.test(val)
  const [done, setDone] = useState({ val: '', status: null })
  useEffect(() => {
    if (!enabled || !val || !valid) return
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id').eq('username', val).maybeSingle()
      setDone({ val, status: data ? 'taken' : 'ok' })
    }, 450)
    return () => clearTimeout(t)
  }, [val, valid, enabled])
  if (!enabled || !val) return null
  if (!valid) return 'invalid'
  return done.val === val ? done.status : 'checking'
}
