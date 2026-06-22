import { useEffect, useRef, useState } from 'react'
import { prepareCreationHtml } from '../../utils/creationHtml'

/**
 * A non-interactive "first frame" preview of a creation, rendered in a
 * sandboxed iframe (opaque origin — no app-session access) with pointer
 * events disabled so it reads as a poster, not a playable surface.
 *
 * - Pass `html` directly (builder thread, where we already hold the artifact).
 * - Or pass `creationId` and the preview lazily fetches the HTML the first
 *   time it scrolls into view (feed cards) — keeps the feed payload lean and
 *   avoids mounting many live iframes at once. Fetched HTML is cached so a
 *   re-mount on scroll doesn't refetch.
 */

type Props = { html?: string; creationId?: number }

const htmlCache = new Map<number, string>()

// Drop a creation's cached HTML (e.g. after it's deleted) so a stale poster
// can't keep rendering/playing it on-device.
export function clearCreationCache(id: number) {
  htmlCache.delete(id)
}

export default function CreationPreview({ html, creationId }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [resolved, setResolved] = useState<string | null>(
    html ? html : (creationId != null ? htmlCache.get(creationId) ?? null : null),
  )
  const [inView, setInView] = useState(!!html)

  // Lazy: only fetch/mount once the card scrolls near the viewport.
  useEffect(() => {
    if (html || resolved || creationId == null) return
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setInView(true); io.disconnect() }
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [html, resolved, creationId])

  useEffect(() => {
    if (html) { setResolved(html); return }
    if (!inView || resolved || creationId == null) return
    let alive = true
    fetch(`/api/builder/${creationId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const h = d?.creation?.html
        if (alive && typeof h === 'string' && h) { htmlCache.set(creationId, h); setResolved(h) }
      })
      .catch(() => { /* leave poster fallback */ })
    return () => { alive = false }
  }, [inView, resolved, html, creationId])

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0b0b0b' }}>
      {resolved && (
        <iframe
          title="preview"
          aria-hidden="true"
          tabIndex={-1}
          sandbox="allow-scripts"
          scrolling="no"
          srcDoc={prepareCreationHtml(resolved)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: 'none', display: 'block' }}
        />
      )}
    </div>
  )
}
