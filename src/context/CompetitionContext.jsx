import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { CompetitionContext, SATURDAY } from './competition.js'

const STORAGE_KEY = 'silks_competition'
const TYPES = ['festival', 'group']

function readStored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (v && TYPES.includes(v.type) && typeof v.id === 'string' && v.id) return { type: v.type, id: v.id }
  } catch { /* unreadable or blocked storage: use the default */ }
  return SATURDAY
}

export function CompetitionProvider({ children }) {
  const [competition, setCompetitionState] = useState(readStored)

  // setCompetition('saturday') | setCompetition('festival', festivalId) | setCompetition('group', groupId)
  const setCompetition = useCallback((type, id = null) => {
    const next = TYPES.includes(type) && id ? { type, id } : SATURDAY
    setCompetitionState(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
  }, [])

  // If the remembered festival no longer exists, fall back to Saturday. (Finished festivals stay
  // selectable so Results can show them; Picks and Leaderboard only offer running ones.)
  // Needs a session to read festivals, so it waits until someone is signed in.
  useEffect(() => {
    if (competition.type !== 'festival') return
    let cancelled = false
    async function verify() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) return
      const { data, error } = await supabase.from('festivals').select('id')
      if (cancelled || error) return
      if (!(data || []).some(f => f.id === competition.id)) setCompetition('saturday')
    }
    verify()
    return () => { cancelled = true }
  }, [competition, setCompetition])

  const value = useMemo(() => ({ competition, setCompetition }), [competition, setCompetition])
  return <CompetitionContext.Provider value={value}>{children}</CompetitionContext.Provider>
}
