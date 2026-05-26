import type { CSSProperties, ReactNode, Ref } from 'react'
import { createPortal } from 'react-dom'

type FixedComposerShellProps = {
  children: ReactNode
  keyboardLift: number
  safeBottomPx: number
  className?: string
  style?: CSSProperties
  shellRef?: Ref<HTMLDivElement>
  spacerBackground?: string
}

/** Fixed-bottom composer portaled to body so keyboard lift is viewport-relative. */
export function FixedComposerShell({
  children,
  keyboardLift,
  safeBottomPx,
  className = 'fixed left-0 right-0 z-[1000]',
  style,
  shellRef,
  spacerBackground = '#000',
}: FixedComposerShellProps) {
  const chrome = (
    <div
      ref={shellRef}
      className={className}
      style={{
        bottom: keyboardLift > 0 ? `${keyboardLift}px` : 0,
        display: 'flex',
        flexDirection: 'column',
        touchAction: 'manipulation',
        pointerEvents: 'auto',
        ...style,
      }}
    >
      {children}
      <div
        aria-hidden
        style={{
          height: keyboardLift > 0 ? '0px' : `${safeBottomPx}px`,
          background: spacerBackground,
          flexShrink: 0,
        }}
      />
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(chrome, document.body)
}
