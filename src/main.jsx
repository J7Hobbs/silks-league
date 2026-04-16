import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App       from './App.jsx'
import Auth      from './pages/Auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Admin     from './pages/Admin.jsx'
import Picks     from './pages/Picks.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<App />}       />
        <Route path="/auth"      element={<Auth />}      />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/admin"     element={<Admin />}     />
        <Route path="/picks"     element={<Picks />}     />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
