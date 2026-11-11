// Where a banner photo sits in its box. festivals.banner_position is meant to be a CSS object-position that Admin writes as
// "center <n>%" (n = how far down), but older or hand-typed values exist ("35% center", "top", "50% 20%"...). This turns any of
// them into one plain "X% Y%" the browser can't misread, and falls back to the default for anything it can't make sense of
// (pixels, calc(), nonsense). Used wherever a banner photo is drawn.
export const DEFAULT_PHOTO_POSITION = '50% 35%'

const HORIZONTAL = { left: 0, center: 50, right: 100 }
const VERTICAL = { top: 0, center: 50, bottom: 100 }
const clamp = n => Math.max(0, Math.min(100, n))
const trim = n => String(Math.round(n * 10) / 10)

// token -> { kind: 'x' | 'y' | 'either', value } or null
function token(t) {
  if (/^-?\d+(\.\d+)?%$/.test(t)) return { kind: 'pct', value: clamp(parseFloat(t)) }
  if (t === 'center') return { kind: 'either', value: 50 }
  if (t in HORIZONTAL) return { kind: 'x', value: HORIZONTAL[t] }
  if (t in VERTICAL) return { kind: 'y', value: VERTICAL[t] }
  return null
}

// -> { x, y } in percent, or null when the text isn't a usable position.
export function parsePhotoPosition(value) {
  const parts = String(value ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!parts.length || parts.length > 2) return null
  const toks = parts.map(token)
  if (toks.some(t => !t)) return null
  if (toks.length === 1) {
    const [a] = toks
    if (a.kind === 'y') return { x: 50, y: a.value }     // "top"
    return { x: a.value, y: 50 }                          // "left", "center", "30%": the other axis is centred
  }
  const [a, b] = toks
  // "top left" / "bottom center": a vertical keyword first means the order is swapped.
  if (a.kind === 'y' || b.kind === 'x') {
    if ((a.kind === 'x' || b.kind === 'y') && a.kind === b.kind) return null
    if (a.kind === 'pct' || b.kind === 'pct') return null   // "top 30%" is not a two-value position
    return { x: b.value, y: a.value }
  }
  return { x: a.value, y: b.value }
}

// The CSS object-position / background-position to use: always "X% Y%".
export function photoPosition(value, fallback = DEFAULT_PHOTO_POSITION) {
  const p = parsePhotoPosition(value) || parsePhotoPosition(fallback) || { x: 50, y: 35 }
  return `${trim(p.x)}% ${trim(p.y)}%`
}
