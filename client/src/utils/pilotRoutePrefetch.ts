const inflight = new Set<string>()

function prefetchOnce(key: string, fetcher: () => Promise<void>) {
  if (inflight.has(key)) return
  inflight.add(key)
  void fetcher().finally(() => {
    inflight.delete(key)
  })
}

/** Warm community feed JSON on touch intent before navigation transition. */
export function prefetchCommunityFeed(communityId: number) {
  const key = `community-feed:${communityId}`
  prefetchOnce(key, async () => {
    try {
      await fetch(`/api/community_feed?community_id=${communityId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
    } catch {
      // best-effort prefetch
    }
  })
}

/** Warm post detail on touch intent before navigation transition. */
export function prefetchPostDetail(postId: number | string) {
  const key = `post:${postId}`
  prefetchOnce(key, async () => {
    try {
      await Promise.all([
        fetch(`/get_post?post_id=${postId}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }),
        fetch(`/api/group_post?post_id=${postId}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }),
      ])
    } catch {
      // best-effort prefetch
    }
  })
}

/** Attach touchstart prefetch to a community card navigation target. */
export function bindCommunityCardPrefetch(el: HTMLElement | null, communityId: number) {
  if (!el) return () => {}
  const onTouchStart = () => prefetchCommunityFeed(communityId)
  el.addEventListener('touchstart', onTouchStart, { passive: true })
  return () => el.removeEventListener('touchstart', onTouchStart)
}
