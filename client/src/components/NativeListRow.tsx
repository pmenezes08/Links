import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { triggerHaptic, type HapticCue } from '../utils/haptics'

type NativeListRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  haptic?: HapticCue
}

/** Full-width list row with native press feedback (Messages threads, settings-style lists). */
export function NativeListRow({
  children,
  haptic = 'selection',
  className = '',
  style,
  onClick,
  type = 'button',
  disabled,
  ...rest
}: NativeListRowProps) {
  const touchStyle: CSSProperties = {
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    ...style,
  }

  return (
    <button
      type={type}
      disabled={disabled}
      className={`flex w-full items-center text-left select-none cursor-pointer transition-[transform,background-color] duration-100 active:bg-white/[0.08] active:scale-[0.995] disabled:opacity-50 disabled:active:scale-100 ${className}`}
      style={touchStyle}
      onClick={(event) => {
        if (!disabled && haptic) void triggerHaptic(haptic)
        onClick?.(event)
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
