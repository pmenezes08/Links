import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  STEVE_THINKING_SEARCHING_MS,
  STEVE_THINKING_NARROWING_MS,
  STEVE_THINKING_LONG_MS,
  STEVE_THINKING_CROSSFADE_MS,
  CPOINT_EASE_OUT,
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
  // The label being retired — rendered alongside the incoming one so the two
  // genuinely crossfade (old slides up + fades out, new slides up + fades in)
  // instead of the previous instant text swap, which read as no motion.
  const [outgoing, setOutgoing] = useState<string | null>(null)

  useEffect(() => {
    const start = Date.now()
    let clearTimer: number | undefined
    const tick = window.setInterval(() => {
      const next = getSteveThinkingLabel(Date.now() - start, t)
      setLabel(prev => {
        if (next === prev) return prev
        setOutgoing(prev)
        if (clearTimer) window.clearTimeout(clearTimer)
        clearTimer = window.setTimeout(() => setOutgoing(null), STEVE_THINKING_CROSSFADE_MS)
        return next
      })
    }, 1000)
    return () => {
      window.clearInterval(tick)
      if (clearTimer) window.clearTimeout(clearTimer)
    }
  }, [t])

  const anim = (name: string) => ({
    animationName: name,
    animationDuration: `${STEVE_THINKING_CROSSFADE_MS}ms`,
    animationTimingFunction: CPOINT_EASE_OUT,
    animationFillMode: 'both' as const,
  })

  return (
    <div className="flex h-8 items-center gap-1.5 text-[13px] text-c-text-tertiary" role="status">
      <span className="relative inline-block">
        {/* keyed so each new label remounts and replays the entrance animation */}
        <span key={label} className="block whitespace-nowrap" style={anim('cpoint-label-in')}>
          {label}
        </span>
        {outgoing && outgoing !== label && (
          <span
            key={`out-${outgoing}`}
            aria-hidden
            className="absolute inset-0 whitespace-nowrap"
            style={anim('cpoint-label-out')}
          >
            {outgoing}
          </span>
        )}
      </span>
      <span className="flex flex-none gap-0.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" style={{ animationDelay: '300ms' }} />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" style={{ animationDelay: '600ms' }} />
      </span>
    </div>
  )
}
