import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'

type NativeActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  /** Teal primary (Post / Reply / Send) or muted secondary toolbar control */
  variant?: 'primary' | 'secondary'
}

const VARIANT_CLASS: Record<'primary' | 'secondary', string> = {
  primary:
    'bg-[#4db6ac] text-black hover:bg-[#45a99c] active:bg-[#3d9a91] active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100',
  secondary:
    'bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 active:bg-white/15 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
}

/** Primary action control with instant touch feedback (matches ChatThread send buttons). */
export function NativeActionButton({
  variant = 'primary',
  className = '',
  style,
  children,
  type = 'button',
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
      className={`inline-flex items-center justify-center gap-1.5 select-none cursor-pointer transition-[transform,background-color,opacity,filter] duration-100 ${VARIANT_CLASS[variant]} ${className}`}
      style={touchStyle}
      {...rest}
    >
      {children}
    </button>
  )
}
