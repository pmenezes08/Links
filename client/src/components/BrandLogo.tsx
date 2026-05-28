import cpointLogo from '../assets/cpoint-logo.png'

type BrandLogoProps = {
  className?: string
  alt?: string
}

/**
 * The single source of truth for the C-Point logo across the app.
 *
 * Imports the canonical artwork as a bundled, fingerprinted asset so it is
 * always available offline and can never fall back to a broken-image glyph
 * (the "octopus") the way the old network-backed /api/public/logo did.
 */
export default function BrandLogo({ className, alt = 'C-Point' }: BrandLogoProps) {
  return <img src={cpointLogo} alt={alt} className={className} draggable={false} />
}

export { cpointLogo }
