import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const PHASE_STILL_MS = 8_000
const PHASE_LONGER_MS = 20_000
const PHASE_UNUSUAL_MS = 45_000

export interface SteveTypingIndicatorProps {
  active: boolean
}

export function getSteveTypingPhaseLabel(
  elapsedMs: number,
  t: (key: string) => string,
): string {
  if (elapsedMs >= PHASE_UNUSUAL_MS) {
    return t('chat.steve_typing_unusual')
  }
  if (elapsedMs >= PHASE_LONGER_MS) {
    return t('chat.steve_typing_longer')
  }
  if (elapsedMs >= PHASE_STILL_MS) {
    return t('chat.steve_typing_still')
  }
  return t('chat.steve_typing')
}

export default function SteveTypingIndicator({ active }: SteveTypingIndicatorProps) {
  const { t } = useTranslation()
  const [label, setLabel] = useState(() => t('chat.steve_typing'))

  useEffect(() => {
    if (!active) {
      setLabel(t('chat.steve_typing'))
      return
    }
    const start = Date.now()
    setLabel(getSteveTypingPhaseLabel(0, t))
    const timer = window.setInterval(() => {
      setLabel(getSteveTypingPhaseLabel(Date.now() - start, t))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active, t])

  if (!active) return null

  return (
    <div className="flex items-center gap-3 px-3 py-2 mb-2">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#26a69a] flex items-center justify-center flex-shrink-0">
        <span className="text-white text-xs font-bold">S</span>
      </div>
      <div className="bg-white/10 rounded-2xl rounded-bl-lg px-4 py-2">
        <div className="flex items-center gap-1">
          <span className="text-white/70 text-sm">{label}</span>
          <span className="flex gap-0.5">
            <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-[#4db6ac] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        </div>
      </div>
    </div>
  )
}

export { PHASE_STILL_MS, PHASE_LONGER_MS, PHASE_UNUSUAL_MS }
