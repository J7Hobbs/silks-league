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

import Silk from './Silk.jsx'

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

  const isWD      = !!runner.is_withdrawn
  const canClick   = onClick && !disabled && !isWD

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
        borderRadius: '8px', background: '#0d1f0b',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '2px', padding: '4px 3px 5px',
        overflow: 'hidden', flexShrink: 0,
        opacity: isWD ? 0.4 : 1,
      }}>
        <Silk runner={runner} style={{ flex: 1, width: '100%' }} />
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
            color: isWD ? '#9ca3af' : selected ? '#c9a84c' : '#e8f0e8',
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
          <div style={{ fontSize: '9px', color: '#5a8a5a', marginTop: '3px', lineHeight: 1.4 }}>
            {[runner.jockey && `J: ${runner.jockey}`, runner.trainer && `T: ${runner.trainer}`]
              .filter(Boolean).join('  ·  ')}
          </div>
        )}

        {/* Form string */}
        {!isWD && runner.form_string && (
          <div style={{ fontSize: '9px', color: '#5a8a5a', marginTop: '2px' }}>
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
              border: `2px solid ${isWD ? 'rgba(239,68,68,0.3)' : selected ? '#c9a84c' : 'rgba(201,168,76,0.3)'}`,
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
    border: '1.5px solid rgba(201,168,76,0.3)',
    background: 'linear-gradient(180deg, #152e12 0%, #0a1a08 100%)',
    fontFamily: "'DM Sans', sans-serif",
    transition: 'all 0.15s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  selected: {
    background: 'rgba(201,168,76,0.08)',
    border: '1.5px solid #c9a84c',
    boxShadow: '0 3px 14px rgba(201,168,76,0.18)',
  },
  disabled:  { opacity: 0.7 },
  withdrawn: { opacity: 0.55, border: '1.5px solid rgba(239,68,68,0.3)', background: 'linear-gradient(180deg, #1f1008 0%, #0a1a08 100%)' },
}
