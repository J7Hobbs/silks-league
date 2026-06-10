/**
 * ProfileDropdown — nav avatar + simple dropdown
 * Clicking "Account details" navigates to /account
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import HowItWorksModal from './HowItWorksModal.jsx'

export default function ProfileDropdown({ user, isAdmin }) {
  const navigate = useNavigate()
  const ref      = useRef(null)
  const [open,         setOpen]         = useState(false)
  const [profile,      setProfile]      = useState(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    supabase.from('profiles').select('username').eq('id', user.id).single()
      .then(({ data }) => { if (data) setProfile(data) })
  }, [user?.id])

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const initial = (profile?.username || user?.user_metadata?.full_name || user?.email || '?')
    .charAt(0).toUpperCase()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div ref={ref} style={ds.wrap}>
      <div style={ds.avatar} onClick={() => setOpen(o => !o)}>
        {initial}
      </div>

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

          <div style={ds.divider} />

          <button style={ds.item} onClick={() => { setOpen(false); navigate('/account') }}>
            Account details
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
  avatar:   { width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(201,168,76,0.15)', border: '1.5px solid rgba(201,168,76,0.5)', color: '#c9a84c', fontSize: '0.875rem', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', userSelect: 'none', fontFamily: "'DM Sans', sans-serif" },
  dropdown: { position: 'absolute', top: 'calc(100% + 10px)', right: 0, minWidth: '220px', background: '#162a1a', border: '1px solid #c9a84c', borderRadius: '10px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', zIndex: 9999, overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" },
  header:   { padding: '0.9rem 1rem 0.75rem' },
  username: { fontSize: '0.95rem', fontWeight: '700', color: '#c9a84c', lineHeight: 1.2 },
  email:    { fontSize: '0.78rem', color: '#7a9e85', marginTop: '0.2rem' },
  divider:  { height: '1px', background: 'rgba(201,168,76,0.15)' },
  item:     { display: 'block', width: '100%', padding: '0.7rem 1rem', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.875rem', color: '#e8f0e8', fontFamily: "'DM Sans', sans-serif" },
}
