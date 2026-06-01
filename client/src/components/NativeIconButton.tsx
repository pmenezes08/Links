import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { triggerHaptic, type HapticCue } from '../utils/haptics'
import { composerControlPointerProps, preventComposerBlur } from '../utils/composerBlurGuard'

type NativeIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  haptic?: HapticCue
  /** sm = 32px (inline reply), md = 36px (default toolbar), lg = 40px (chat composer) */
  size?: 'sm' | 'md' | 'lg'
  /** glass = ChatThread-style frosted circle; muted = feed/settings style */
  variant?: 'glass' | 'muted'
  /** Keep keyboard open when used inside a composer (default true for toolbar use). */
  preventBlur?: boolean
}

const SIZE_CLASS: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-xl',
  lg: 'h-10 w-10 rounded-[14px]',
}

const VARIANT_CLASS: Record<'glass' | 'muted', string> = {
  glass:
    'bg-c-hover-bg hover:bg-c-active-bg active:bg-c-active-bg text-c-text-primary active:scale-95 disabled:opacity-40 disabled:active:scale-100',
  muted:
    'bg-c-active-bg hover:bg-c-hover-bg active:bg-c-active-bg text-c-text-primary active:scale-95 disabled:opacity-40 disabled:active:scale-100',
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
  onPointerDown,
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
      {...rest}
      {...(preventBlur ? { onMouseDown: composerControlPointerProps.onMouseDown } : {})}
      onPointerDown={(event) => {
        if (preventBlur) {
          preventComposerBlur(event)
          if (!disabled && haptic) void triggerHaptic(haptic)
        }
        onPointerDown?.(event)
      }}
      onClick={(event) => {
        if (!disabled && haptic && !preventBlur) void triggerHaptic(haptic)
        onClick?.(event)
      }}
    >
      {children}
    </button>
  )
}
