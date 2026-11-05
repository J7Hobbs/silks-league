import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A bottom sheet. Mount it to open it, unmount it to close it.
//  - closes on a backdrop tap and on Escape (calls onClose)
//  - keeps Tab inside the sheet and stops the page behind it scrolling
//  - on iPhone the overlay follows the visual viewport, so the sheet stays above the keyboard
//  - when it closes, focus goes back to the button that opened it. `returnKey` names a
//    data-return attribute to find that button again if the page re-rendered it meanwhile.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Sheet({ onClose, labelledBy, returnKey, children }) {
  const panel = useRef(null)
  const [opener] = useState(() => document.activeElement)
  const [vv, setVv] = useState(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  // Focus into the sheet; put it back on the opener afterwards.
  useEffect(() => {
    const el = panel.current
    const target = el?.querySelector('[data-autofocus]') || el?.querySelector(FOCUSABLE) || el
    target?.focus({ preventScroll: true })
    return () => {
      requestAnimationFrame(() => {
        const back = opener?.isConnected ? opener : (returnKey ? document.querySelector(`[data-return="${returnKey}"]`) : null)
        back?.focus({ preventScroll: true })
      })
    }
  }, [opener, returnKey])

  // Stop the page behind scrolling.
  useEffect(() => {
    const html = document.documentElement
    const before = [html.style.overflow, document.body.style.overflow]
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => { html.style.overflow = before[0]; document.body.style.overflow = before[1] }
  }, [])

  // Follow the visual viewport (keyboard open, page zoomed or scrolled).
  useEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const sync = () => setVv({ top: v.offsetTop, height: v.height })
    sync()
    v.addEventListener('resize', sync)
    v.addEventListener('scroll', sync)
    return () => { v.removeEventListener('resize', sync); v.removeEventListener('scroll', sync) }
  }, [])

  // Escape closes; Tab stays inside.
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current?.(); return }
      if (e.key !== 'Tab') return
      const items = [...(panel.current?.querySelectorAll(FOCUSABLE) || [])]
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return createPortal(
    <div className="gr-overlay" style={vv ? { top: vv.top, height: vv.height } : undefined}>
      <div className="gr-backdrop" onClick={() => closeRef.current?.()} aria-hidden="true" />
      <div className="gr-sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={panel} tabIndex={-1}>
        <span className="gr-sheet__grab" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  )
}
