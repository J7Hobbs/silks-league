// The jockey silk: a jersey drawn in the runner's colours. Used by RunnerCard
// and the Picks runner rows. Size it with `style`. `outline` draws an empty
// gold-outlined shirt (a race with no pick yet).
export default function Silk({ runner, style, outline = false }) {
  const fill   = outline ? 'none' : runner?.silk_colour           || '#1a3a10'
  const stroke = outline ? '#c9a84c' : runner?.silk_colour_secondary || 'white'
  return (
    <svg
      style={{ filter: outline ? 'none' : 'drop-shadow(0 1px 4px rgba(0,0,0,0.9)) drop-shadow(0 0 3px rgba(0,0,0,0.7))', ...style }}
      viewBox="0 0 874 874"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="translate(137, 80) scale(0.68)">
        <path
          d="M18.78 847.71 c0 -1.37 1.54 -10.93 3.33 -21.17 1.88 -10.24 6.91 -38.49 11.18 -62.65 4.27 -24.15 9.64 -54.54 11.95 -67.43 2.30 -12.89 6.15 -34.57 8.54 -48.22 2.39 -13.57 6.23 -35.34 8.54 -48.22 4.44 -24.92 14.25 -80.91 25.52 -145.52 3.76 -21.59 8.79 -50.36 11.18 -64.01 13.14 -74.77 23.90 -137.59 23.90 -139.72 0 -1.54 0.60 -2.65 1.96 -3.33 1.88 -1.11 97.90 -64.36 160.89 -106.09 l34.31 -22.70 0 -34.14 0 -34.14 112.24 0 112.24 0 0 33.20 0 33.29 11.35 7.34 c13.06 8.54 34.82 22.62 45.58 29.53 4.18 2.65 20.40 13.06 36.10 23.13 30.47 19.55 94.91 60.77 97.64 62.48 1.28 0.77 2.13 3.50 3.67 11.27 6.91 35.25 57.70 307.78 81.77 438.62 22.70 123.76 26.12 142.62 26.63 148.34 l0.51 5.72 -57.61 0 -57.61 0 -8.19 -27.91 c-11.10 -37.55 -17.84 -60.26 -26.03 -87.31 -3.76 -12.46 -11.18 -36.79 -16.39 -54.20 -24.24 -80.06 -35.34 -115.99 -35.59 -115.05 -0.34 1.11 -7 37.64 -40.71 223.45 l-7.94 43.53 -75.88 0.51 c-41.74 0.26 -117.87 0.85 -169.08 1.19 l-93.29 0.68 0 -2.05 c0 -1.88 -2.48 -18.18 -12.80 -83.99 -9.22 -58.72 -29.28 -182.23 -29.53 -181.97 -0.34 0.34 -20.40 70.42 -30.21 105.58 -4.78 17.16 -11.69 41.91 -15.36 55.05 -9.05 32.18 -17.92 64.27 -27.31 98.15 -4.27 15.53 -7.94 28.85 -8.19 29.70 -0.43 1.37 -4.01 1.45 -58.89 1.45 l-58.38 0 0 -2.39z"
          fill={fill} stroke={stroke} strokeWidth={outline ? 3 : 2} vectorEffect="non-scaling-stroke"
        />
        <path
          d="M330.31 90.13 l0 -28.42 32.18 -0.51 c17.67 -0.34 63.59 -0.60 102 -0.60 l69.82 0 0 28.08 0 28.08 -41.99 0.51 c-23.13 0.26 -69.05 0.68 -102 0.85 l-60 0.43 0 -28.42z"
          fill={outline ? 'none' : 'white'}
          stroke={outline ? stroke : undefined}
          strokeWidth={outline ? 3 : undefined}
          vectorEffect={outline ? 'non-scaling-stroke' : undefined}
        />
      </g>
    </svg>
  )
}
