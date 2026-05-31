/**
 * RunnerCard — shared white runner card used across all pages.
 *
 * Props:
 *   runner        { horse_name, horse_number, silk_colour, jockey, trainer,
 *                   odds_fractional, form_string, is_withdrawn }
 *   selected      bool   — fills selection circle with gold tick, shows MY PICK badge
 *   showCircle    bool   — show the gold selection circle (empty when not selected)
 *   onClick       fn     — makes card clickable
 *   disabled      bool   — dims the card, prevents click
 *   tags          [jsx]  — small badges shown inline after the horse name
 *   rightContent  jsx    — replaces the default odds + circle column
 */

export default function RunnerCard({
  runner,
  selected   = false,
  showCircle = false,
  onClick,
  disabled   = false,
  tags       = [],
  rightContent,
}) {
  if (!runner) return null

  const isWD    = !!runner.is_withdrawn
  const silkBg  = runner.silk_colour || '#1a3a10'
  const canClick = onClick && !disabled && !isWD

  return (
    <div
      style={{
        ...card.base,
        ...(selected  ? card.selected  : {}),
        ...(disabled  ? card.disabled  : {}),
        ...(isWD      ? card.withdrawn : {}),
        cursor: canClick ? 'pointer' : 'default',
      }}
      onClick={canClick ? onClick : undefined}
    >
      {/* ── Silk badge ── */}
      <div style={{
        width: '58px', minWidth: '58px', height: '64px',
        borderRadius: '8px', background: silkBg,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '2px', padding: '4px 3px 5px',
        overflow: 'hidden', flexShrink: 0,
        opacity: isWD ? 0.4 : 1,
      }}>
        <svg style={{ flex: 1, width: '100%' }} viewBox="0 0 874 874" xmlns="http://www.w3.org/2000/svg">
          <g transform="translate(137, 80) scale(0.68)">
            <path
              d="M18.78 847.71 c0 -1.37 1.54 -10.93 3.33 -21.17 1.88 -10.24 6.91 -38.49 11.18 -62.65 4.27 -24.15 9.64 -54.54 11.95 -67.43 2.30 -12.89 6.15 -34.57 8.54 -48.22 2.39 -13.57 6.23 -35.34 8.54 -48.22 4.44 -24.92 14.25 -80.91 25.52 -145.52 3.76 -21.59 8.79 -50.36 11.18 -64.01 13.14 -74.77 23.90 -137.59 23.90 -139.72 0 -1.54 0.60 -2.65 1.96 -3.33 1.88 -1.11 97.90 -64.36 160.89 -106.09 l34.31 -22.70 0 -34.14 0 -34.14 112.24 0 112.24 0 0 33.20 0 33.29 11.35 7.34 c13.06 8.54 34.82 22.62 45.58 29.53 4.18 2.65 20.40 13.06 36.10 23.13 30.47 19.55 94.91 60.77 97.64 62.48 1.28 0.77 2.13 3.50 3.67 11.27 6.91 35.25 57.70 307.78 81.77 438.62 22.70 123.76 26.12 142.62 26.63 148.34 l0.51 5.72 -57.61 0 -57.61 0 -8.19 -27.91 c-11.10 -37.55 -17.84 -60.26 -26.03 -87.31 -3.76 -12.46 -11.18 -36.79 -16.39 -54.20 -24.24 -80.06 -35.34 -115.99 -35.59 -115.05 -0.34 1.11 -7 37.64 -40.71 223.45 l-7.94 43.53 -75.88 0.51 c-41.74 0.26 -117.87 0.85 -169.08 1.19 l-93.29 0.68 0 -2.05 c0 -1.88 -2.48 -18.18 -12.80 -83.99 -9.22 -58.72 -29.28 -182.23 -29.53 -181.97 -0.34 0.34 -20.40 70.42 -30.21 105.58 -4.78 17.16 -11.69 41.91 -15.36 55.05 -9.05 32.18 -17.92 64.27 -27.31 98.15 -4.27 15.53 -7.94 28.85 -8.19 29.70 -0.43 1.37 -4.01 1.45 -58.89 1.45 l-58.38 0 0 -2.39z"
              fill={silkBg} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke"
            />
            <path
              d="M330.31 90.13 l0 -28.42 32.18 -0.51 c17.67 -0.34 63.59 -0.60 102 -0.60 l69.82 0 0 28.08 0 28.08 -41.99 0.51 c-23.13 0.26 -69.05 0.68 -102 0.85 l-60 0.43 0 -28.42z"
              fill="white"
            />
          </g>
        </svg>
        {runner.horse_number != null && (
          <span style={{ fontSize: '10px', fontWeight: '700', color: 'white', lineHeight: 1 }}>
            {runner.horse_number}
          </span>
        )}
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* Horse name row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap',
        }}>
          <span style={{
            fontSize: '15px', fontWeight: '700',
            color: isWD ? '#9ca3af' : '#0d1a08',
            textDecoration: isWD ? 'line-through' : 'none',
            lineHeight: 1.2,
          }}>
            {runner.horse_name}
          </span>
          {isWD && (
            <span style={{ fontSize: '0.6rem', fontWeight: '700', color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '3px', padding: '0.1rem 0.35rem', letterSpacing: '0.06em' }}>
              WD
            </span>
          )}
          {tags.map((tag, i) => <span key={i}>{tag}</span>)}
        </div>

        {/* Jockey / Trainer */}
        {(runner.jockey || runner.trainer) && (
          <div style={{ fontSize: '9px', color: '#666', marginTop: '3px', lineHeight: 1.4 }}>
            {[runner.jockey && `J: ${runner.jockey}`, runner.trainer && `T: ${runner.trainer}`]
              .filter(Boolean).join('  ·  ')}
          </div>
        )}

        {/* Form string */}
        {!isWD && runner.form_string && (
          <div style={{ fontSize: '9px', color: '#999', marginTop: '2px' }}>
            Form: {runner.form_string}
          </div>
        )}

        {/* MY PICK badge */}
        {selected && !isWD && (
          <div style={{ marginTop: '5px', display: 'inline-block', background: '#c9a84c', color: '#0a1a08', fontSize: '8px', fontWeight: '800', padding: '2px 7px', borderRadius: '3px', letterSpacing: '0.07em' }}>
            MY PICK
          </div>
        )}
      </div>

      {/* ── Right column: odds (or custom content) ── */}
      {rightContent !== undefined ? (
        <div style={{ flexShrink: 0, textAlign: 'right' }}>{rightContent}</div>
      ) : (
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px' }}>
          {!isWD && runner.odds_fractional && (
            <div style={{ fontSize: '22px', fontWeight: '700', color: '#c9a84c', fontFamily: 'Georgia, serif', lineHeight: 1, whiteSpace: 'nowrap' }}>
              {runner.odds_fractional}
            </div>
          )}
          {showCircle && (
            <div style={{
              width: '22px', height: '22px', borderRadius: '50%',
              border: `2px solid ${isWD ? 'rgba(239,68,68,0.3)' : '#c9a84c'}`,
              background: selected && !isWD ? '#c9a84c' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {selected && !isWD && (
                <span style={{ fontSize: '11px', fontWeight: '900', color: '#0a1a08', lineHeight: 1 }}>✓</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const card = {
  base: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 12px 10px 10px',
    borderRadius: '10px',
    border: '2px solid #c9a84c',
    background: '#ffffff',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.15s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  selected: {
    background: '#fffdf5',
    border: '2.5px solid #c9a84c',
    boxShadow: '0 3px 14px rgba(201,168,76,0.18)',
  },
  disabled:  { opacity: 0.7 },
  withdrawn: { opacity: 0.55, border: '2px solid rgba(239,68,68,0.3)', background: '#fff8f8' },
}
