import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  STEVE_THINKING_SEARCHING_MS,
  STEVE_THINKING_NARROWING_MS,
  STEVE_THINKING_LONG_MS,
  TAB_CROSSFADE_MS,
} from '../../design/motion'

/**
 * Staged wait line for the networking Steve match call. The fetch is a
 * single non-streamed POST, so stages are elapsed-time theatre that
 * mirrors the real pipeline shape (read → search → narrow) without
 * claiming event-level knowledge: lines only ever advance, never loop,
 * and the last line stays up until the reply lands. Fixed height so the
 * page's scroll-to-bottom effect never jitters on a stage change.
 */
export function getSteveThinkingLabel(
  elapsedMs: number,
  t: (key: string) => string,
): string {
  if (elapsedMs >= STEVE_THINKING_LONG_MS) {
    return t('networking.steve_status_long')
  }
  if (elapsedMs >= STEVE_THINKING_NARROWING_MS) {
    return t('networking.steve_status_narrowing')
  }
  if (elapsedMs >= STEVE_THINKING_SEARCHING_MS) {
    return t('networking.steve_status_searching')
  }
  return t('networking.steve_thinking')
}

export default function SteveThinking() {
  const { t } = useTranslation()
  const [label, setLabel] = useState(() => getSteveThinkingLabel(0, t))
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const start = Date.now()
    let fadeTimer: number | undefined
    const tick = window.setInterval(() => {
      const next = getSteveThinkingLabel(Date.now() - start, t)
      setLabel(prev => {
        if (next === prev) return prev
        setFading(true)
        fadeTimer = window.setTimeout(() => setFading(false), TAB_CROSSFADE_MS)
        return next
      })
    }, 1000)
    return () => {
      window.clearInterval(tick)
      if (fadeTimer) window.clearTimeout(fadeTimer)
    }
  }, [t])

  return (
    <div className="flex h-8 items-center gap-1.5 text-[13px] text-c-text-tertiary" role="status">
      <span
        className="min-w-0 truncate whitespace-nowrap transition-opacity"
        style={{ opacity: fading ? 0 : 1, transitionDuration: `${TAB_CROSSFADE_MS}ms` }}
      >
        {label}
      </span>
      <span className="flex flex-none gap-0.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" style={{ animationDelay: '300ms' }} />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" style={{ animationDelay: '600ms' }} />
      </span>
    </div>
  )
}
