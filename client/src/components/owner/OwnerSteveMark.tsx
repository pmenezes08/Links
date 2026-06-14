import SteveAvatar from '../steve/SteveAvatar'
import { STEVE_BRAND } from '../../brand/steveBrand'

/**
 * Steve's face on owner surfaces, routed through the brand swap point. Render
 * this — never the raw avatar — so a future logo change is one edit in
 * brand/steveBrand.ts.
 */
export default function OwnerSteveMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  if (STEVE_BRAND.markSrc) {
    return (
      <img
        src={STEVE_BRAND.markSrc}
        alt=""
        aria-hidden="true"
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return <SteveAvatar size={size} className={className} />
}
