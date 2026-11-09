// The launch pop-up for bonus points: shown once per player on their first open after release, until
// the end of the Cheltenham meeting weekend (BONUS_RULES.introUntil). "Seen" is kept on the player's
// profile (bonus_intro_seen_at), so it follows them across devices. If it can't be read or saved, it
// is skipped or closed for this visit rather than shown again and again.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { currentUser } from '../lib/session.js'
import { BONUS_RULES, bonusIntroOpen } from '../lib/bonuses.js'
import '../styles/bonus.css'

let asked = false   // module-wide: ask the database once per visit

export default function BonusIntroModal() {
  const [show, setShow] = useState(false)
  const userId = useRef(null)
  const btn = useRef(null)

  useEffect(() => {
    if (asked || !bonusIntroOpen()) return
    let cancelled = false
    ;(async () => {
      try {
        const user = await currentUser()
        if (!user || cancelled) return
        const { data, error } = await supabase.from('profiles')
          .select('bonus_intro_seen_at, onboarded_at').eq('id', user.id).maybeSingle()
        if (error || !data || cancelled) return
        asked = true
        // A player still in the welcome flow sees it there first.
        if (!data.bonus_intro_seen_at && data.onboarded_at) { userId.current = user.id; setShow(true) }
      } catch { /* not shown */ }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => { if (show) btn.current?.focus() }, [show])

  async function dismiss() {
    setShow(false)
    // Closed at once. If the save fails it will show again on the next visit (once per visit at most).
    await supabase.from('profiles').update({ bonus_intro_seen_at: new Date().toISOString() })
      .eq('id', userId.current).select('id').then(() => {}, () => {})
  }

  useEffect(() => {
    if (!show) return
    const onKey = e => { if (e.key === 'Escape') dismiss() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!show) return null
  const r = BONUS_RULES
  return (
    <div className="bi" role="presentation">
      <div className="bi__card" role="dialog" aria-modal="true" aria-labelledby="bi-title">
        <span className="bi__tag">NEW</span>
        <h2 className="bi__title" id="bi-title">Bonus points are here</h2>
        <p className="bi__sub">Starting at Cheltenham this week</p>
        <ul className="bi__list">
          <li><span className="bi__name">★ Banker</span><span className="bi__text">Double points on one race a day</span></li>
          <li><span className="bi__name">Lone winner</span><span className="bi__text">+{r.loneWinnerPoints} when you're the only one to find the winner</span></li>
          <li><span className="bi__name">Treble</span><span className="bi__text">+{r.treblePoints} for {r.trebleWinners} winners in a row</span></li>
        </ul>
        <button type="button" className="pk-btn pk-btn--solid" ref={btn} onClick={dismiss}>Got it</button>
        <p className="bi__foot">Find these any time under Bonus points in your menu</p>
      </div>
    </div>
  )
}
