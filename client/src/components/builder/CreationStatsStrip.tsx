import { useEffect, useRef, useState } from 'react'

/**
 * Live community-stats strip for a published creation's feed card: plays, top
 * score, rating. The conversion lever — "147 plays · top 2,340 · ★4.2" reads as
 * social proof that pulls a scroller into a player.
 *
 * - Lazy: fetches the summary only when the card scrolls near the viewport
 *   (keeps the feed payload lean; cached so a re-mount doesn't refetch).
 * - Threshold-suppressed: shows nothing until a build has real data, so a cold
 *   creation never advertises an empty/dead board.
 *
 * Renders only <span>s (it lives inside a <button> in the feed card).
 */

type Summary = { plays: number; top_score: number | null; rating_avg: number | null; rating_count: number }
const cache = new Map<number, Summary>()

function fmt(n: number): string {
  const v = Math.round(n)
  if (Math.abs(v) >= 10000) return (v / 1000).toFixed(0) + 'k'
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k'
  return String(v)
}

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999,
  background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  fontSize: 12, fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums',
}

export default function CreationStatsStrip({ creationId }: { creationId: number }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [summary, setSummary] = useState<Summary | null>(cache.get(creationId) ?? null)
  const [inView, setInView] = useState(!!cache.get(creationId))

  useEffect(() => {
    if (summary) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setInView(true); io.disconnect() }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [summary])

  useEffect(() => {
    if (summary || !inView) return
    let alive = true
    fetch(`/api/builder/${creationId}/data/summary`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d || d.success === false) return
        const s: Summary = {
          plays: d.plays || 0, top_score: d.top_score ?? null,
          rating_avg: d.rating_avg ?? null, rating_count: d.rating_count || 0,
        }
        cache.set(creationId, s)
        setSummary(s)
      })
      .catch(() => { /* leave the card clean on failure */ })
    return () => { alive = false }
  }, [inView, summary, creationId])

  const showPlays = !!summary && summary.plays >= 1
  const showScore = !!summary && summary.top_score != null && summary.plays >= 3
  const showRating = !!summary && summary.rating_avg != null && summary.rating_count >= 3

  // Keep an invisible anchor so the observer can fire before there's data.
  if (!showPlays && !showScore && !showRating) {
    return <span ref={ref} aria-hidden style={{ position: 'absolute', width: 1, height: 1, left: 0, bottom: 0 }} />
  }

  return (
    <span ref={ref} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {showPlays && (
        <span style={{ ...pill, color: '#fff' }}><i className="fa-solid fa-play" style={{ fontSize: 9 }} aria-hidden /> {fmt(summary!.plays)}</span>
      )}
      {showScore && (
        <span style={{ ...pill, color: '#EF9F27' }}><i className="fa-solid fa-trophy" style={{ fontSize: 10 }} aria-hidden /> {fmt(summary!.top_score!)}</span>
      )}
      {showRating && (
        <span style={{ ...pill, color: '#00CEC8' }}><i className="fa-solid fa-star" style={{ fontSize: 10 }} aria-hidden /> {summary!.rating_avg!.toFixed(1)}</span>
      )}
    </span>
  )
}
