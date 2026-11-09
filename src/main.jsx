import './lib/recovery.js'   // reads a password-reset link's address before Supabase clears it
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/tokens.css'
import './index.css'
import './lib/installPrompt.js'   // remembers the browser's install event for the welcome flow
import App            from './App.jsx'
import Auth           from './pages/Auth.jsx'
import Dashboard      from './pages/Dashboard.jsx'
import Admin          from './pages/Admin.jsx'
import AdminShell     from './pages/admin/AdminShell.jsx'
import Picks          from './pages/Picks.jsx'
import League         from './pages/League.jsx'
import LeagueSaturday from './pages/LeagueSaturday.jsx'
import LeagueFestival from './pages/LeagueFestival.jsx'
import LeagueGroup    from './pages/LeagueGroup.jsx'
import LeaguePastFestival from './pages/LeaguePastFestival.jsx'
import LeaguePastSeason   from './pages/LeaguePastSeason.jsx'
import Races          from './pages/Races.jsx'
import Results        from './pages/Results.jsx'
import BonusPoints    from './pages/BonusPoints.jsx'
import Profile        from './pages/Profile.jsx'
import Groups         from './pages/Groups.jsx'
import PlayerPicks         from './pages/PlayerPicks.jsx'
import Account             from './pages/Account.jsx'
import FestivalPicks       from './pages/FestivalPicks.jsx'
import FestivalLeaderboard from './pages/FestivalLeaderboard.jsx'
import RaceDay             from './pages/RaceDay.jsx'
import Festivals           from './pages/Festivals.jsx'
import Welcome             from './pages/Welcome.jsx'
import Join                from './pages/Join.jsx'
import SetPassword         from './pages/SetPassword.jsx'
import TabLayout           from './components/TabLayout.jsx'
import OneSignalInit       from './components/OneSignalInit.jsx'
import { CompetitionProvider } from './context/CompetitionContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <CompetitionProvider>
        <Routes>
          <Route path="/"          element={<App />}       />
          <Route path="/auth"      element={<Auth />}      />
          <Route path="/reset-password" element={<SetPassword />} />
          <Route path="/welcome"   element={<Welcome />}   />
          <Route path="/join"      element={<Join />}      />
          <Route path="/join/:code" element={<Join />}     />
          <Route element={<TabLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/picks"     element={<Picks />}     />
            <Route path="/league"    element={<League />}    />
            <Route path="/league/saturday"            element={<LeagueSaturday />} />
            <Route path="/league/festival/:festivalId" element={<LeagueFestival />} />
            <Route path="/league/group/:groupId"       element={<LeagueGroup />}    />
            <Route path="/league/past/festival/:festivalId" element={<LeaguePastFestival />} />
            <Route path="/league/past/season/:seasonId"     element={<LeaguePastSeason />}   />
            <Route path="/bonus-points" element={<BonusPoints />} />
            <Route path="/results"   element={<Results />}   />
            <Route path="/festivals" element={<Festivals />} />
            <Route path="/results/festival/:festivalId" element={<Results />} />
          </Route>
          <Route path="/admin"         element={<AdminShell />} />
          <Route path="/admin/classic" element={<Admin />}      />
          <Route path="/races"     element={<Races />}     />
          <Route path="/profile"   element={<Profile />}   />
          <Route path="/groups"              element={<Groups />}      />
          <Route path="/player-picks/:userId"    element={<PlayerPicks />}         />
          <Route path="/account"               element={<Account />}             />
          <Route path="/festival-picks"        element={<FestivalPicks />}       />
          <Route path="/festival-leaderboard"        element={<FestivalLeaderboard />}           />
          <Route path="/race-day"              element={<RaceDay />}              />
        </Routes>
        <OneSignalInit />
      </CompetitionProvider>
    </BrowserRouter>
  </StrictMode>,
)
