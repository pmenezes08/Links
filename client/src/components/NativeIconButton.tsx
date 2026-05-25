import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { triggerHaptic, type HapticCue } from '../utils/haptics'
import { composerControlPointerProps } from '../utils/composerBlurGuard'

type NativeIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  haptic?: HapticCue
  /** sm = 32px (inline reply), md = 36px (default toolbar) */
  size?: 'sm' | 'md'
  /** glass = ChatThread-style frosted circle; muted = feed/settings style */
  variant?: 'glass' | 'muted'
  /** Keep keyboard open when used inside a composer (default true for toolbar use). */
  preventBlur?: boolean
}

const SIZE_CLASS: Record<'sm' | 'md', string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-xl',
}

const VARIANT_CLASS: Record<'glass' | 'muted', string> = {
  glass:
    'bg-white/12 hover:bg-white/22 active:bg-white/28 text-white active:scale-95 disabled:opacity-40 disabled:active:scale-100',
  muted:
    'bg-white/10 hover:bg-white/15 active:bg-white/20 text-white active:scale-95 disabled:opacity-40 disabled:active:scale-100',
}

export function NativeIconButton({
  children,
  haptic,
  size = 'md',
  variant = 'glass',
  preventBlur = false,
  className = '',
  style,
  onClick,
  type = 'button',
  disabled,
  ...rest
}: NativeIconButtonProps) {
  const touchStyle: CSSProperties = {
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    ...style,
  }

  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex flex-none items-center justify-center select-none cursor-pointer transition-[transform,background-color,opacity] duration-100 ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className}`}
      style={touchStyle}
      {...(preventBlur ? composerControlPointerProps : {})}
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
