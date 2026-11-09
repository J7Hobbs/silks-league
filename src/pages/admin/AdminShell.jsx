import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Today from './Today.jsx'
import '../../styles/admin-new.css'

// The new Admin (/admin): four tabs. Today is built; the others are coming. The previous Admin stays
// at /admin/classic until it is replaced, so nothing is lost while the new one is built in stages.
const TABS = [
  { id: 'today',    label: 'Today' },
  { id: 'racedays', label: 'Race days' },
  { id: 'players',  label: 'Players' },
  { id: 'setup',    label: 'Setup' },
]

export default function AdminShell() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [ok, setOk] = useState(false)
  const tab = TABS.some(t => t.id === params.get('tab')) ? params.get('tab') : 'today'
  const goTab = id => setParams(id === 'today' ? {} : { tab: id }, { replace: true })

  // Same gate as the classic Admin: signed in, and profiles.is_admin.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { navigate('/auth'); return }
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      if (!profile?.is_admin) { navigate('/dashboard'); return }
      if (!cancelled) setOk(true)
    })()
    return () => { cancelled = true }
  }, [navigate])

  if (!ok) return <div className="an an-gate"><div className="an-note" role="status">Checking admin access…</div></div>

  return (
    <div className="an">
      <header className="an-top">
        <div className="an-top__row">
          <h1 className="an-top__title">SILKS ADMIN</h1>
          <Link to="/dashboard" className="an-top__back">‹ Back to app</Link>
        </div>
        <nav className="an-tabs" role="tablist" aria-label="Admin sections">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" id={`an-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="an-panel"
              className={`an-tab${tab === t.id ? ' an-tab--on' : ''}`} onClick={() => goTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      </header>
      <main className="an-main" id="an-panel" role="tabpanel" aria-labelledby={`an-tab-${tab}`}>
        {tab === 'today' ? <Today goTab={goTab} /> : (
          <section className="an-card an-card--plain an-empty">
            <h2 className="an-h2">Coming in the next update</h2>
            <p className="an-muted">{TABS.find(t => t.id === tab).label} is being rebuilt. Until it lands, everything it will do is in the classic Admin.</p>
            <Link to="/admin/classic" className="an-btn an-btn--ghost">Open classic Admin</Link>
          </section>
        )}
      </main>
    </div>
  )
}
