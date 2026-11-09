/**
 * ProfileDropdown — nav avatar + simple dropdown
 * Clicking "Account details" navigates to /account
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import HowItWorksModal from './HowItWorksModal.jsx'
import { bonusIsNew } from '../lib/bonuses.js'
import '../styles/bonus.css'

// "Jack Hobbs" -> "JH", "Jack" -> "J". Empty when there's no name.
function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export default function ProfileDropdown({ user, isAdmin }) {
  const navigate = useNavigate()
  const ref      = useRef(null)
  const [open,         setOpen]         = useState(false)
  const [profile,      setProfile]      = useState(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    supabase.from('profiles').select('username, full_name').eq('id', user.id).single()
      .then(({ data }) => { if (data) setProfile(data) })
  }, [user?.id])

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const initials = initialsOf(profile?.full_name) || initialsOf(user?.user_metadata?.full_name)
    || (profile?.username || user?.email || '?').charAt(0).toUpperCase()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div ref={ref} style={ds.wrap}>
      <button type="button" style={ds.avatar} onClick={() => setOpen(o => !o)}
        aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}>
        {initials}
      </button>

      {open && (
        <div style={ds.dropdown}>
          <div style={ds.header}>
            <div style={ds.username}>{profile?.username || '—'}</div>
            <div style={ds.email}>{user?.email}</div>
          </div>

          <div style={ds.divider} />

          <button style={ds.item} onClick={() => { setOpen(false); setShowHowItWorks(true) }}>
            How it works
          </button>

          <button style={ds.item} onClick={() => { setOpen(false); navigate('/bonus-points') }}>
            <span style={{ color: '#c9a84c' }}>★</span> Bonus points
            {bonusIsNew() && <span className="bp-newtag">NEW</span>}
          </button>

          <div style={ds.divider} />

          <button style={ds.item} onClick={() => { setOpen(false); navigate('/account') }}>
            Account details
          </button>

          <button style={ds.item} onClick={() => { setOpen(false); navigate('/groups') }}>
            Groups
          </button>

          {isAdmin && (
            <>
              <div style={ds.divider} />
              <button style={{ ...ds.item, color: '#c9a84c' }}
                onClick={() => { setOpen(false); navigate('/admin') }}>
                Admin panel
              </button>
            </>
          )}

          <div style={ds.divider} />

          <button style={{ ...ds.item, color: '#f87171' }} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      )}
      <HowItWorksModal open={showHowItWorks} onClose={() => setShowHowItWorks(false)} />
    </div>
  )
}

const ds = {
  wrap:     { position: 'relative', flexShrink: 0 },
  avatar:   { width: '40px', height: '40px', padding: 0, borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--gold)', fontFamily: 'var(--font-heading)', fontSize: '0.875rem', fontWeight: '700', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', userSelect: 'none' },
  dropdown: { position: 'absolute', top: 'calc(100% + 10px)', right: 0, minWidth: '220px', background: '#162a1a', border: '1px solid #c9a84c', borderRadius: '10px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: 9999, overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" },
  header:   { padding: '0.9rem 1rem 0.75rem' },
  username: { fontSize: '0.95rem', fontWeight: '700', color: '#c9a84c', lineHeight: 1.2 },
  email:    { fontSize: '0.78rem', color: '#7a9e85', marginTop: '0.2rem' },
  divider:  { height: '1px', background: 'rgba(201,168,76,0.15)' },
  item:     { display: 'block', width: '100%', padding: '0.7rem 1rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.875rem', color: '#e8f0e8', fontFamily: "'DM Sans', sans-serif" },
}
