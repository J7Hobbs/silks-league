// The notifications bell: on (green), off (struck through) or not known yet (a question mark).
export default function BellIcon({ state }) {
  const label = state === true ? 'Notifications on' : state === false ? 'Notifications off' : 'Notifications not known yet'
  const cls = state === true ? 'on' : state === false ? 'off' : 'unknown'
  return (
    <svg className={`an-bell an-bell--${cls}`} width="16" height="16" viewBox="0 0 24 24" role="img" aria-label={label} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <title>{label}</title>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
      {state === false && <path d="M3 3l18 18" />}
      {state === null && <path d="M12 8.5v3.2M12 14.2v.1" />}
    </svg>
  )
}
