import { SteveGlyph } from './SteveMark'

/**
 * Steve's one canonical face. Replaces the drifted gradient-"S" discs
 * (the typing indicator used white-on-#26a69a, onboarding used
 * black-on-#2a7a72 — a character with two faces is no character).
 *
 * The glyph is the doorbell, the avatar is who answers: conversational
 * surfaces (chat, onboarding, summary-sheet headers) render this face;
 * inline tap-for-Steve affordances render the bare SteveGlyph.
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
      className={`rounded-full bg-gradient-to-br from-cpoint-turquoise to-[#26a69a] flex items-center justify-center shrink-0 text-white ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <SteveGlyph size={Math.max(12, Math.round(size * 0.62))} strokeWidth={2.4} />
    </div>
  )
}
