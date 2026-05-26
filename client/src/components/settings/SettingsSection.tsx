import type { ReactNode } from 'react'

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/28">{title}</h2>
      <div className="overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.055] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
        {children}
      </div>
    </section>
  )
}

export function SettingsDivider() {
  return <div className="ml-[4.75rem] h-px bg-white/[0.055]" />
}

export function PanelCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.055]">{children}</div>
  )
}
