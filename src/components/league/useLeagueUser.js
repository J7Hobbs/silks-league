import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { currentUser } from '../../lib/session.js'

// The signed-in player for a Leaderboard page; null until known. Sends signed-out visitors to /auth.
export function useLeagueUser() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  useEffect(() => {
    let cancelled = false
    currentUser().then(u => {
      if (cancelled) return
      if (!u) navigate('/auth')
      else setUser(u)
    })
    return () => { cancelled = true }
  }, [navigate])
  return user
}
