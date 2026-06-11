import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import SteveAvatar from '../steve/SteveAvatar'

/**
 * Top-of-feed entry to Ask Steve, pre-selecting this community. A quiet
 * full-width row — Steve's face, his Networking welcome question, a
 * chevron — that scrolls away with content (no pinned chrome, no badges,
 * no entrance animation). The label mirrors the Networking page's opening
 * line so the door matches the room.
 *
 * Renders nothing unless this community is networking-eligible (the same
 * server-side list the Networking page loads), so members are never
 * walked into a community Steve can't search.
 */

let eligibleIds: Set<number> | null = null
let inflight: Promise<Set<number>> | null = null

function fetchEligibleCommunities(): Promise<Set<number>> {
  if (eligibleIds) return Promise.resolve(eligibleIds)
  if (!inflight) {
    inflight = fetch('/api/networking/communities', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(data => {
        eligibleIds = new Set<number>(
          data?.success ? (data.communities || []).map((c: { id: number }) => Number(c.id)) : [],
        )
        return eligibleIds
      })
      .catch(() => {
        // Leave the module cache unset so a later mount can retry.
        return new Set<number>()
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export default function AskSteveEntry({ communityId }: { communityId: number | string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [eligible, setEligible] = useState(() => eligibleIds?.has(Number(communityId)) ?? false)

  useEffect(() => {
    let mounted = true
    void fetchEligibleCommunities().then(ids => {
      if (mounted) setEligible(ids.has(Number(communityId)))
    })
    return () => {
      mounted = false
    }
  }, [communityId])

  if (!eligible) return null

  return (
    <button
      type="button"
      onClick={() => navigate(`/networking?community=${communityId}&source=feed_entry`)}
      aria-label={t('feed.meet_prompt_aria')}
      className="flex h-11 w-full items-center gap-3 rounded-2xl border border-c-border bg-c-bg-elevated px-3 text-left transition hover:bg-c-hover-bg active:scale-[0.99]"
    >
      <SteveAvatar size={28} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-c-text-primary">
        {t('feed.meet_prompt')}
      </span>
      <i className="fa-solid fa-chevron-right text-xs text-c-text-tertiary" aria-hidden="true" />
    </button>
  )
}
