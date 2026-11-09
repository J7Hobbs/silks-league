import Sheet from '../../components/groups/Sheet.jsx'
import '../../styles/groups.css'
import '../../styles/admin-raceday.css'
import '../../styles/admin-new.css'

// A confirm sheet: says what will happen, then a solid button and Cancel. `tone="danger"` makes the
// button red for anything that deletes.
export function ConfirmSheet({ title, children, confirm, busy, onConfirm, onClose, tone }) {
  return (
    <Sheet onClose={() => { if (!busy) onClose() }} labelledBy="an-confirm-title" dragToClose className="an-sheet">
      <h2 className="gr-sheet__title gr-sheet__title--wrap" id="an-confirm-title">{title}</h2>
      <div className="an-sheet__text">{children}</div>
      <div className="rd-actions rd-actions--stack">
        <button type="button" className={`gr-btn ${tone === 'danger' ? 'gr-btn--danger' : 'gr-btn--solid'}`} onClick={onConfirm} disabled={busy} data-autofocus>{busy ? 'Working…' : confirm}</button>
        <button type="button" className="gr-btn gr-btn--text" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </Sheet>
  )
}

// A sheet with a title and a scrolling body, for the forms.
export function FormSheet({ title, onClose, busy, children }) {
  return (
    <Sheet onClose={() => { if (!busy) onClose() }} labelledBy="an-form-title" dragToClose className="an-sheet">
      <h2 className="gr-sheet__title gr-sheet__title--wrap" id="an-form-title">{title}</h2>
      {children}
    </Sheet>
  )
}
