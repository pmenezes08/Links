import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SteveAvatar from '../../steve/SteveAvatar'
import { PLACEMENT_OPEN_EVENT, PLACEMENT_REFRESH_EVENT } from './PlacementGate'

/**
 * Pinned re-entry point for a snoozed placement questionnaire. Renders only
 * while this community has a pending placement for the viewer, so the ask
 * stays visible in the feed without the modal having to ambush anyone.
 */
export default function PlacementPendingCard({ communityId }: { communityId: number }) {
  const { t } = useTranslation()
  const [pendingHere, setPendingHere] = useState(false)

  useEffect(() => {
    if (!communityId) return
    let cancelled = false
    const check = async () => {
      try {
        const r = await fetch('/api/me/placement/pending', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const j = await r.json().catch(() => null)
        if (!cancelled && r.ok && j?.success && Array.isArray(j.pending)) {
          setPendingHere(j.pending.some((p: { community_id?: number }) => Number(p.community_id) === communityId))
        }
      } catch {
        // Leave the card hidden on failure — the app-open modal still covers it.
      }
    }
    void check()
    const onRefresh = () => void check()
    window.addEventListener(PLACEMENT_REFRESH_EVENT, onRefresh)
    return () => {
      cancelled = true
      window.removeEventListener(PLACEMENT_REFRESH_EVENT, onRefresh)
    }
  }, [communityId])

  if (!pendingHere) return null

  return (
    <section className="rounded-3xl border border-cpoint-turquoise/20 bg-c-bg-surface p-4 shadow-c-card shadow-black/20">
      <div className="flex items-center gap-3">
        <SteveAvatar size={28} />
        <p className="flex-1 min-w-0 text-sm text-c-text-secondary">
          {t('communities.placement.card_body')}
        </p>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(PLACEMENT_OPEN_EVENT, { detail: { communityId } })
            )
          }
          className="shrink-0 rounded-xl bg-cpoint-turquoise px-3 py-1.5 text-xs font-semibold text-black active:scale-[0.98] transition-transform"
        >
          {t('communities.placement.card_cta')}
        </button>
      </div>
    </section>
  )
}
