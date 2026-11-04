import { createContext, useContext } from 'react'

// Which competition the player is looking at. Picks, Leaderboard and Results
// will read this so the selection stays the same across tabs.
//   { type: 'saturday', id: null } | { type: 'festival', id } | { type: 'group', id }
export const SATURDAY = { type: 'saturday', id: null }

export const CompetitionContext = createContext({
  competition: SATURDAY,
  setCompetition: () => {},
})

export function useCompetition() {
  return useContext(CompetitionContext)
}
