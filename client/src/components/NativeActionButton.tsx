import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { triggerHaptic, type HapticCue } from '../utils/haptics'

type NativeActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  /** Teal primary (Post / Reply), muted secondary toolbar, or round composer send (ChatThread-style). */
  variant?: 'primary' | 'secondary' | 'composer'
  haptic?: HapticCue
}

const VARIANT_CLASS: Record<'primary' | 'secondary' | 'composer', string> = {
  primary:
    'bg-cpoint-turquoise text-black hover:brightness-95 active:brightness-90 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100',
  secondary:
    'bg-c-hover-bg border border-c-border text-c-text-secondary hover:text-white hover:bg-c-hover-bg active:bg-white/15 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
  composer:
    'bg-cpoint-turquoise text-white hover:brightness-95 active:brightness-90 active:scale-95 disabled:opacity-50 disabled:active:scale-100',
}

/** Primary action control with instant touch feedback (matches ChatThread send buttons). */
export function NativeActionButton({
  variant = 'primary',
  className = '',
  style,
  children,
  type = 'button',
  haptic,
  onClick,
  disabled,
  ...rest
}: NativeActionButtonProps) {
  const touchStyle: CSSProperties = {
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    ...style,
  }

  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 select-none cursor-pointer transition-[transform,background-color,opacity,filter] duration-100 ${VARIANT_CLASS[variant]} ${className}`}
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
