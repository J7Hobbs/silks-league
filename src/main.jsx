import './lib/recovery.js'   // reads a password-reset link's address before Supabase clears it
import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/tokens.css'
import './index.css'
import './lib/installPrompt.js'   // remembers the browser's install event for the welcome flow
import App            from './App.jsx'
import Dashboard      from './pages/Dashboard.jsx'
import Picks          from './pages/Picks.jsx'
import League         from './pages/League.jsx'
import Results        from './pages/Results.jsx'
import TabLayout           from './components/TabLayout.jsx'
import OneSignalInit       from './components/OneSignalInit.jsx'
import { Landed, Blank, LegacyLoading, RouteErrorBoundary } from './components/RouteBits.jsx'
import { LeagueSkeleton } from './components/Skeletons.jsx'
import { lazyPage } from './lib/lazyPage.js'
import { load } from './lib/pageLoaders.js'
import { CompetitionProvider } from './context/CompetitionContext.jsx'

// Pages other than the four tabs load on demand, so the first screen downloads only what it needs. Each page's code (and its CSS)
// arrives with it. Tapping into them is instant in practice: they are fetched in idle time once the first page has drawn.
const Auth                = lazyPage(load.Auth)
const SetPassword         = lazyPage(load.SetPassword)
const Welcome             = lazyPage(load.Welcome)
const Join                = lazyPage(load.Join)
const Admin               = lazyPage(load.Admin)
const AdminShell          = lazyPage(load.AdminShell)
const LeagueSaturday      = lazyPage(load.LeagueSaturday)
const LeagueFestival      = lazyPage(load.LeagueFestival)
const LeagueGroup         = lazyPage(load.LeagueGroup)
const LeaguePastFestival  = lazyPage(load.LeaguePastFestival)
const LeaguePastSeason    = lazyPage(load.LeaguePastSeason)
const FestivalFinal       = lazyPage(load.FestivalFinal)
const BonusPoints         = lazyPage(load.BonusPoints)
const Festivals           = lazyPage(load.Festivals)
const Races               = lazyPage(load.Races)
const Profile             = lazyPage(load.Profile)
const Groups              = lazyPage(load.Groups)
const PlayerPicks         = lazyPage(load.PlayerPicks)
const Account             = lazyPage(load.Account)
const FestivalPicks       = lazyPage(load.FestivalPicks)
const FestivalLeaderboard = lazyPage(load.FestivalLeaderboard)
const RaceDay             = lazyPage(load.RaceDay)

// Fetched in idle time after the first page draws, most likely first (festival pages for Cheltenham week). The admin pages are
// left out on purpose: only admins use them, and they are the largest.
const PREFETCH = [
  load.FestivalPicks, load.LeagueFestival, load.FestivalLeaderboard, load.Festivals, load.FestivalFinal,
  load.LeagueSaturday, load.LeagueGroup, load.Profile, load.Groups, load.BonusPoints, load.Account,
  load.LeaguePastFestival, load.LeaguePastSeason, load.PlayerPicks, load.Races, load.RaceDay,
]

// A route's page. While a lazy page's code loads, `Fallback` stands in: the page's own skeleton when it has one, otherwise the
// plain background. At app start the splash is covering the screen, so nothing else shows.
const eager = page => { const Page = page; return <><Page /><Landed prefetch={PREFETCH} /></> }
const lazy = (page, fallback = Blank) => {
  const Page = page, Fallback = fallback
  return <Suspense fallback={<Fallback />}><Page /><Landed prefetch={PREFETCH} /></Suspense>
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <CompetitionProvider>
        <RouteErrorBoundary>
        <Routes>
          <Route path="/"          element={<App />}       />
          <Route path="/auth"      element={lazy(Auth)}      />
          <Route path="/reset-password" element={lazy(SetPassword)} />
          <Route path="/welcome"   element={lazy(Welcome)}   />
          <Route path="/join"      element={lazy(Join)}      />
          <Route path="/join/:code" element={lazy(Join)}     />
          <Route element={<TabLayout />}>
            <Route path="/dashboard" element={eager(Dashboard)} />
            <Route path="/picks"     element={eager(Picks)}     />
            <Route path="/league"    element={eager(League)}    />
            <Route path="/league/saturday"            element={lazy(LeagueSaturday, LeagueSkeleton)} />
            <Route path="/league/festival/:festivalId" element={lazy(LeagueFestival, LeagueSkeleton)} />
            <Route path="/league/group/:groupId"       element={lazy(LeagueGroup, LeagueSkeleton)}    />
            <Route path="/league/past/festival/:festivalId" element={lazy(LeaguePastFestival, LeagueSkeleton)} />
            <Route path="/festival/:festivalId/final" element={lazy(FestivalFinal, LeagueSkeleton)} />
            <Route path="/league/past/season/:seasonId"     element={lazy(LeaguePastSeason, LeagueSkeleton)}   />
            <Route path="/bonus-points" element={lazy(BonusPoints)} />
            <Route path="/results"   element={eager(Results)}   />
            <Route path="/festivals" element={lazy(Festivals)} />
            <Route path="/results/festival/:festivalId" element={eager(Results)} />
          </Route>
          <Route path="/admin"         element={lazy(AdminShell)} />
          <Route path="/admin/classic" element={lazy(Admin)}      />
          <Route path="/races"     element={lazy(Races, LegacyLoading)}     />
          <Route path="/profile"   element={lazy(Profile, LegacyLoading)}   />
          <Route path="/groups"              element={lazy(Groups)}      />
          <Route path="/player-picks/:userId"    element={lazy(PlayerPicks)}         />
          <Route path="/account"               element={lazy(Account)}             />
          <Route path="/festival-picks"        element={lazy(FestivalPicks, LegacyLoading)}       />
          <Route path="/festival-leaderboard"        element={lazy(FestivalLeaderboard, LegacyLoading)}           />
          <Route path="/race-day"              element={lazy(RaceDay)}              />
          <Route path="*" element={<Landed />} />
        </Routes>
        </RouteErrorBoundary>
        <OneSignalInit />
      </CompetitionProvider>
    </BrowserRouter>
  </StrictMode>,
)
