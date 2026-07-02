import cpointMark from '../../assets/cpoint-mark.svg'

/**
 * Steve's one canonical face: the official C-Point mark (wave over pin) on a
 * black disc with a thin turquoise ring — founder-ratified 2026-07-02.
 *
 * Convention (keep it, or product chrome and Steve blur together): the BARE
 * mark (BrandLogo) is the product; the mark IN A RINGED DISC is Steve
 * speaking. Inline tap-for-Steve affordances at tiny sizes (≤20px) still use
 * the simplified SteveGlyph from SteveMark.tsx — the full mark doesn't
 * survive below ~22px.
 */
export default function SteveAvatar({
  size = 28,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <div
      className={`rounded-full bg-black border border-cpoint-turquoise/40 flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        src={cpointMark}
        alt=""
        draggable={false}
        style={{ width: '70%', height: '70%', objectFit: 'contain' }}
      />
    </div>
  )
}
