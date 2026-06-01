import type { ReactNode } from 'react'

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-c-text-tertiary">{title}</h2>
      <div className="overflow-hidden rounded-3xl border border-c-border bg-c-bg-surface shadow-c-glass">
        {children}
      </div>
    </section>
  )
}

export function SettingsDivider() {
  return <div className="ml-[4.75rem] h-px bg-c-border-subtle" />
}

export function PanelCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-c-border bg-c-bg-surface">{children}</div>
  )
}
