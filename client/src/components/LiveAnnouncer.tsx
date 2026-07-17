import { useEffect, useState } from 'react'

/**
 * Global screen-reader announcer — a visually hidden `aria-live` region
 * mounted once in App. Visual-only feedback (toasts, async status pills)
 * calls `announce(message)` so assistive technology hears what sighted
 * users see. Module-level emitter keeps call sites free of context
 * plumbing (announcements are fire-and-forget, never rendered state).
 */

type Listener = (message: string) => void

let listener: Listener | null = null
let pending: string | null = null

export function announce(message: string): void {
  const text = message.trim()
  if (!text) return
  if (listener) listener(text)
  else pending = text
}

export default function LiveAnnouncer() {
  const [message, setMessage] = useState('')

  useEffect(() => {
    let clearTimer: number | undefined
    listener = (text: string) => {
      // Clear first so repeating the same message re-announces.
      setMessage('')
      window.setTimeout(() => setMessage(text), 50)
      if (clearTimer) window.clearTimeout(clearTimer)
      clearTimer = window.setTimeout(() => setMessage(''), 5000)
    }
    if (pending) {
      const initial = pending
      pending = null
      listener(initial)
    }
    return () => {
      listener = null
      if (clearTimer) window.clearTimeout(clearTimer)
    }
  }, [])

  return (
    <div
      aria-live="polite"
      role="status"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {message}
    </div>
  )
}
