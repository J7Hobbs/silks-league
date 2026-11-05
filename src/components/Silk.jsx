import { useId } from 'react'

// The jockey silk: a jersey drawn in the runner's colours. Used by RunnerCard
// and the Picks runner rows. Size it with `style`. `outline` draws an empty
// gold-outlined shirt (a race with no pick yet).
//
// `runner.silk_pattern` picks the markings, drawn in the secondary colour on a
// body in the primary colour: plain, hoops, stripes, quartered, cross, chevrons,
// diamonds, spots, star (one large) or stars (scattered). Anything else is plain.

const SHIRT = "M18.78 847.71 c0 -1.37 1.54 -10.93 3.33 -21.17 1.88 -10.24 6.91 -38.49 11.18 -62.65 4.27 -24.15 9.64 -54.54 11.95 -67.43 2.30 -12.89 6.15 -34.57 8.54 -48.22 2.39 -13.57 6.23 -35.34 8.54 -48.22 4.44 -24.92 14.25 -80.91 25.52 -145.52 3.76 -21.59 8.79 -50.36 11.18 -64.01 13.14 -74.77 23.90 -137.59 23.90 -139.72 0 -1.54 0.60 -2.65 1.96 -3.33 1.88 -1.11 97.90 -64.36 160.89 -106.09 l34.31 -22.70 0 -34.14 0 -34.14 112.24 0 112.24 0 0 33.20 0 33.29 11.35 7.34 c13.06 8.54 34.82 22.62 45.58 29.53 4.18 2.65 20.40 13.06 36.10 23.13 30.47 19.55 94.91 60.77 97.64 62.48 1.28 0.77 2.13 3.50 3.67 11.27 6.91 35.25 57.70 307.78 81.77 438.62 22.70 123.76 26.12 142.62 26.63 148.34 l0.51 5.72 -57.61 0 -57.61 0 -8.19 -27.91 c-11.10 -37.55 -17.84 -60.26 -26.03 -87.31 -3.76 -12.46 -11.18 -36.79 -16.39 -54.20 -24.24 -80.06 -35.34 -115.99 -35.59 -115.05 -0.34 1.11 -7 37.64 -40.71 223.45 l-7.94 43.53 -75.88 0.51 c-41.74 0.26 -117.87 0.85 -169.08 1.19 l-93.29 0.68 0 -2.05 c0 -1.88 -2.48 -18.18 -12.80 -83.99 -9.22 -58.72 -29.28 -182.23 -29.53 -181.97 -0.34 0.34 -20.40 70.42 -30.21 105.58 -4.78 17.16 -11.69 41.91 -15.36 55.05 -9.05 32.18 -17.92 64.27 -27.31 98.15 -4.27 15.53 -7.94 28.85 -8.19 29.70 -0.43 1.37 -4.01 1.45 -58.89 1.45 l-58.38 0 0 -2.39z"
const COLLAR = "M330.31 90.13 l0 -28.42 32.18 -0.51 c17.67 -0.34 63.59 -0.60 102 -0.60 l69.82 0 0 28.08 0 28.08 -41.99 0.51 c-23.13 0.26 -69.05 0.68 -102 0.85 l-60 0.43 0 -28.42z"

// The shirt spans x 19-848, y 50-850 in its own coordinates (centre line x = 433).
// The shapes are bold on purpose: the silk is only 26-40px wide on screen.
const W = 874
const CX = 433

function star(cx, cy, outer, inner) {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return pts.join(' ')
}
const diamond = (cx, cy, h) => `${cx},${cy - h} ${cx + h},${cy} ${cx},${cy + h} ${cx - h},${cy}`

// Each pattern returns the shapes to draw in the secondary colour `c`.
const PATTERNS = {
  hoops: c => [150, 350, 550, 750].map(y => <rect key={y} x="0" y={y} width={W} height="100" fill={c} />),
  stripes: c => [73, 253, 433, 613, 793].map(x => <rect key={x} x={x - 45} y="0" width="90" height={W} fill={c} />),
  quartered: c => [
    <rect key="a" x="0" y="0" width={CX} height="450" fill={c} />,
    <rect key="b" x={CX} y="450" width={W - CX} height="450" fill={c} />,
  ],
  cross: c => [
    <line key="a" x1="19" y1="50" x2="848" y2="850" stroke={c} strokeWidth="130" />,
    <line key="b" x1="848" y1="50" x2="19" y2="850" stroke={c} strokeWidth="130" />,
  ],
  chevrons: c => [190, 380, 570].map(y => (
    <polyline key={y} points={`0,${y} ${CX},${y + 230} ${W},${y}`} fill="none" stroke={c} strokeWidth="85" strokeLinejoin="miter" />
  )),
  // Harlequin: diamonds with their tips touching, so the gaps are diamonds in the body colour.
  diamonds: c => {
    const out = []
    for (let j = 0; j < 4; j++) for (let i = -1; i <= 1; i++) {
      out.push(<polygon key={`${i}_${j}`} points={diamond(CX + i * 200, 190 + j * 200, 100)} fill={c} />)
    }
    return out
  },
  spots: c => [
    [348, 215], [518, 215], [263, 395], [433, 395], [603, 395], [348, 575], [518, 575],
  ].map(([x, y]) => <circle key={`${x}_${y}`} cx={x} cy={y} r="72" fill={c} />),
  star: c => [<polygon key="s" points={star(CX, 410, 215, 88)} fill={c} />],
  stars: c => [
    [330, 210], [540, 250], [260, 430], [450, 410], [610, 470], [340, 620], [530, 660],
  ].map(([x, y]) => <polygon key={`${x}_${y}`} points={star(x, y, 80, 33)} fill={c} />),
}

// The pattern named by a runner's silk_pattern, or null for plain / missing / unknown.
function silkPatternKey(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return PATTERNS[key] ? key : null
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, ch => ch + ch) : m[1]
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// Colour for the markings. When the two colours match they would vanish, so use white
// on a dark body and near-black on a light one.
function markColour(fill, stroke) {
  if ((fill || '').trim().toLowerCase() !== (stroke || '').trim().toLowerCase()) return stroke
  const l = luminance(fill)
  return l != null && l > 0.55 ? '#1a1a1a' : '#ffffff'
}

export default function Silk({ runner, style, outline = false }) {
  const uid = useId().replace(/:/g, '')
  const fill   = outline ? 'none' : runner?.silk_colour           || '#1a3a10'
  const stroke = outline ? '#c9a84c' : runner?.silk_colour_secondary || 'white'
  const key = outline ? null : silkPatternKey(runner?.silk_pattern)
  const clipId = `silk-clip-${uid}`
  return (
    <svg
      style={{ filter: outline ? 'none' : 'drop-shadow(0 1px 4px rgba(0,0,0,0.9)) drop-shadow(0 0 3px rgba(0,0,0,0.7))', ...style }}
      viewBox="0 0 874 874"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="translate(137, 80) scale(0.68)">
        {key && (
          <clipPath id={clipId}><path d={SHIRT} /></clipPath>
        )}
        <path
          d={SHIRT}
          fill={fill} stroke={stroke} strokeWidth={outline ? 3 : 2} vectorEffect="non-scaling-stroke"
        />
        {key && (
          <>
            <g clipPath={`url(#${clipId})`}>{PATTERNS[key](markColour(fill, stroke))}</g>
            <path d={SHIRT} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
        <path
          d={COLLAR}
          fill={outline ? 'none' : 'white'}
          stroke={outline ? stroke : undefined}
          strokeWidth={outline ? 3 : undefined}
          vectorEffect={outline ? 'non-scaling-stroke' : undefined}
        />
      </g>
    </svg>
  )
}
