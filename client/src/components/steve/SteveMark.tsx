/**
 * Steve brand assets — the wave-with-pin mark family.
 *
 * Three cuts per the design spec (full mark ≥24px, simplified glyph for
 * action-row sizes, solid avatar treatment in SteveAvatar.tsx). All paths
 * use `currentColor` so they inherit text color like every other action
 * icon: tertiary at rest, turquoise on active/cached states, white on
 * gradient/media surfaces. Per the brand separation rules the glyph is
 * only ever rendered in Steve contexts (turquoise family / white) — the
 * monochrome company lockup stays the app-logo endpoint's job.
 *
 * NOTE: paths are a hand-drawn tracing of the founder's reference art
 * (wave curling over a location pin, three flowing underline waves) and
 * are expected to be replaced by the production SVG export when final
 * art lands. Keep the component APIs stable when that happens.
 */

/** Full mark — wave curl + pin + three underline waves. Use at ≥24px. */
export function SteveMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Wave curling over the pin */}
      <path
        d="M5 29.5 C13 29.5 17.5 24 18.8 16.5 C20 9.5 24.8 5 31 5 C38 5 42.5 10 42.5 16 C42.5 20.5 39.8 23.6 36.2 24.4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Location pin nested in the curl */}
      <path
        d="M31 10.5 C34.3 10.5 36.6 12.9 36.6 15.7 C36.6 18.4 34.2 20.6 31 23.8 C27.8 20.6 25.4 18.4 25.4 15.7 C25.4 12.9 27.7 10.5 31 10.5 Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="31" cy="15.6" r="2.1" stroke="currentColor" strokeWidth="2" />
      {/* Three flowing underline waves */}
      <path d="M9 33.5 C15 30.8 21 36.2 27 33.5 C33 30.8 39 36.2 44 33.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6 38.5 C12 35.8 18 41.2 24 38.5 C30 35.8 36 41.2 42 38.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10 43.5 C16 40.8 22 46.2 28 43.5 C33.5 41 38.5 45.6 43 43.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Simplified glyph — wave crest + pin dot only (the three underline waves
 * do not survive below ~20px). For action rows and inline chrome, 14-22px.
 */
export function SteveGlyph({
  size = 16,
  strokeWidth = 2,
  className = '',
}: {
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Crest curling over */}
      <path
        d="M3 18.5 C8 18.5 10.2 13.5 11 9.5 C11.8 5.8 14.3 4 16.6 4 C19.6 4 21.3 6.3 21.3 8.9 C21.3 11.4 19.6 13.3 17.2 13.7"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Pin dot in the curl */}
      <circle cx="16.4" cy="9" r="1.8" fill="currentColor" />
    </svg>
  )
}

export default SteveMark
