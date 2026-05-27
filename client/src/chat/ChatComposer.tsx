import { createPortal } from 'react-dom'
import type { ReactNode, RefObject } from 'react'

export type ChatComposerPortalProps = {
  visible?: boolean
  composerRef: RefObject<HTMLDivElement | null>
  displayKeyboardLift: number
  isWeb?: boolean
  children: ReactNode
}

/** Portaled fixed-bottom composer container (keyboard lift + safe area). */
export function ChatComposerPortal({
  visible = true,
  composerRef,
  displayKeyboardLift,
  isWeb = false,
  children,
}: ChatComposerPortalProps) {
  if (!visible || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={composerRef}
      className={`fixed bottom-0 chat-composer-smooth ${isWeb ? 'left-1/2 -translate-x-1/2 max-w-3xl w-full' : 'left-0 right-0'}`}
      style={{
        bottom: displayKeyboardLift > 0 ? `${displayKeyboardLift}px` : '0',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        touchAction: 'manipulation',
        pointerEvents: 'auto',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

export type ChatComposerCardProps = {
  composerCardRef?: RefObject<HTMLDivElement | null>
  isWeb?: boolean
  children: ReactNode
}

/** Rounded composer card shell inside the portal. */
export function ChatComposerCard({ composerCardRef, isWeb = false, children }: ChatComposerCardProps) {
  return (
    <div
      ref={composerCardRef}
      className={`relative ${isWeb ? 'w-full mx-auto' : 'w-full'} rounded-[16px] px-2 sm:px-2.5 py-2.5 sm:py-3`}
      style={{
        background: '#0a0a0c',
        marginBottom: 0,
        paddingLeft: 'max(10px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(10px, env(safe-area-inset-right, 0px))',
      }}
    >
      {children}
    </div>
  )
}
