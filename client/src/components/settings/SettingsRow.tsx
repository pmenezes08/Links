import type { ReactNode } from 'react'

type SettingsRowProps = {
  icon: string
  title: string
  subtitle?: string
  badge?: ReactNode
  danger?: boolean
  active?: boolean
  onClick: () => void
}

export default function SettingsRow({
  icon,
  title,
  subtitle,
  badge,
  danger,
  active,
  onClick,
}: SettingsRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors active:bg-c-active-bg ${
        active ? 'bg-cpoint-turquoise/[0.08]' : 'hover:bg-c-hover-bg'
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
          danger
            ? 'border-red-400/15 bg-red-500/10 text-red-500'
            : active
              ? 'border-cpoint-turquoise/25 bg-cpoint-turquoise/10 text-c-text-primary'
              : 'border-c-border bg-c-hover-bg text-c-text-secondary'
        }`}
      >
        <i className={`${icon} text-sm`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15px] font-semibold ${danger ? 'text-red-500' : 'text-c-text-primary'}`}>
          {title}
        </span>
        {subtitle ? (
          <span className={`mt-0.5 block truncate text-sm ${danger ? 'text-red-400' : 'text-c-text-tertiary'}`}>
            {subtitle}
          </span>
        ) : null}
      </span>
      {badge ? <span className="shrink-0">{badge}</span> : null}
      <i className={`fa-solid fa-chevron-right text-xs ${danger ? 'text-red-400' : 'text-c-text-tertiary'}`} />
    </button>
  )
}
