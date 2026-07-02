import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { CHAT_KEYBOARD_ANIMATION_MS, CPOINT_EASE_OUT, REDUCED_MOTION_FADE_MS } from '../../design/motion'

/**
 * Generic bottom-sheet shell for the builder surface (options, settings).
 *
 * Portaled to <body>: page-transition containers carry CSS transforms, which
 * re-anchor position:fixed to the PAGE instead of the screen (see
 * CreationActionsSheet for the original incident). z-[1000] stacks above
 * DashboardBottomNav (z-[900]) and its flyout (z-[950]).
 */
export default function BuilderSheet({
  onClose,
  ariaLabel,
  children,
}: {
  onClose: () => void
  ariaLabel: string
  children: ReactNode
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
    >
      <style>{`
        @keyframes cp-builder-sheet-up { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @media (prefers-reduced-motion: reduce) {
          .cp-builder-sheet { animation: cp-builder-sheet-fade ${REDUCED_MOTION_FADE_MS}ms ease-out !important; }
          @keyframes cp-builder-sheet-fade { from { opacity: 0 } to { opacity: 1 } }
        }
      `}</style>
      <div
        className="cp-builder-sheet max-h-[82dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border border-c-border bg-c-bg-elevated p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] shadow-[0_-28px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl sm:max-w-xl sm:rounded-3xl sm:pb-4"
        style={{ animation: `cp-builder-sheet-up ${CHAT_KEYBOARD_ANIMATION_MS}ms ${CPOINT_EASE_OUT}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-c-border sm:hidden" />
        {children}
      </div>
    </div>,
    document.body,
  )
}
