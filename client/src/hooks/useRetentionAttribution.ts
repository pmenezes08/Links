import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Fire-and-forget retention attribution: when the page was opened from a
 * deep link carrying `?source=` (weekly digest push, owner pulse push),
 * record one event so tap-through is measurable against sends. Exactly once
 * per mount; attribution loss must never affect the page (same doctrine as
 * the networking event sink in `Networking.tsx`).
 *
 * The server validates against closed event/source vocabularies and
 * collapses unknown sources to 'direct', so old clients can't corrupt the
 * dataset. No source param → no request at all.
 */
export function useRetentionAttribution(
  eventType: 'digest_opened' | 'owner_pulse_opened',
  communityId?: number | null,
) {
  const [searchParams] = useSearchParams()
  const source = searchParams.get('source')
  const sentRef = useRef(false)

  useEffect(() => {
    if (!source || sentRef.current) return
    sentRef.current = true
    fetch('/api/retention/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        event_type: eventType,
        source,
        community_id: communityId ?? undefined,
      }),
    }).catch(() => {})
  }, [source, eventType, communityId])
}
