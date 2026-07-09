import { useEffect } from 'react'

/**
 * Minimal, app-native toast for moderation feedback (report received,
 * throttled, errors) — replaces the browser alert() the report flows used.
 * Renders nothing when message is null. Auto-dismisses; polite live region
 * so screen readers announce it without stealing focus.
 */
export default function FeedbackToast({
  message,
  onDone,
  durationMs = 4000,
}: {
  message: string | null
  onDone: () => void
  durationMs?: number
}) {
  useEffect(() => {
    if (!message) return
    const id = window.setTimeout(onDone, durationMs)
    return () => window.clearTimeout(id)
  }, [message, durationMs, onDone])

  if (!message) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-[130] flex justify-center px-6"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
    >
      <div className="max-w-sm rounded-2xl border border-c-border bg-c-bg-elevated px-4 py-3 text-[13px] leading-snug text-c-text-primary/95 shadow-lg">
        {message}
      </div>
    </div>
  )
}
