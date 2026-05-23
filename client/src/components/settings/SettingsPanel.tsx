import type { ReactNode } from 'react'

import { triggerHaptic } from '../../utils/haptics'

type SettingsPanelProps = {
  title: string
  open: boolean
  children: ReactNode
  onBack: () => void
}

export default function SettingsPanel({ title, open, children, onBack }: SettingsPanelProps) {
  const handleBack = () => {
    void triggerHaptic('light')
    onBack()
  }

  return (
    <section
      className={`absolute inset-0 z-20 min-h-full bg-black text-white transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        open ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-95'
      }`}
      aria-hidden={!open}
    >
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-black/95 px-5 pb-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)] backdrop-blur-xl">
        <div className="relative flex min-h-10 items-center justify-center">
          <button
            type="button"
            onClick={handleBack}
            className="absolute left-0 inline-flex items-center gap-1 rounded-full py-2 pr-3 text-sm font-medium text-[#4db6ac] active:opacity-70"
          >
            <i className="fa-solid fa-chevron-left text-sm" />
            Back
          </button>
          <h1 className="max-w-[58%] truncate text-center text-xl font-bold tracking-[-0.02em] text-white">{title}</h1>
        </div>
      </div>
      <div className="h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain px-5 py-6 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    </section>
  )
}
