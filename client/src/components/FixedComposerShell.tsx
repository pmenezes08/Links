import type { CSSProperties, ReactNode, Ref } from 'react'

type FixedComposerShellProps = {
  children: ReactNode
  keyboardLift: number
  safeBottomPx: number
  className?: string
  style?: CSSProperties
  shellRef?: Ref<HTMLDivElement>
  spacerBackground?: string
}

/** Fixed-bottom composer wrapper with ChatThread-style safe-area spacer. */
export function FixedComposerShell({
  children,
  keyboardLift,
  safeBottomPx,
  className = 'fixed left-0 right-0 z-[100]',
  style,
  shellRef,
  spacerBackground = '#000',
}: FixedComposerShellProps) {
  return (
    <div
      ref={shellRef}
      className={className}
      style={{
        bottom: keyboardLift > 0 ? `${keyboardLift}px` : 0,
        display: 'flex',
        flexDirection: 'column',
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
}
