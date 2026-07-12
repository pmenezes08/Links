import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import { clearCreationCache } from '../components/builder/CreationPreview'
import CreationActionsSheet from '../components/builder/CreationActionsSheet'

type Creation = {
  id: number
  title: string | null
  kind: string | null
  status: string | null
  community_id: number | null
  published_post_id: number | null
  updated_at: string | null
  plays: number
  public_status?: string | null
  public_url?: string | null
  public_kind?: string | null
  gallery_status?: string | null
  category?: string | null
  category_source?: string | null
  shared_community_ids?: number[]
}

const OPTIMISTIC_EXPLORE_KEY = 'cpoint:explore:optimistic_creations'

function storedExploreId(item: unknown): number {
  if (!item || typeof item !== 'object') return 0
  return Number((item as { id?: unknown }).id || 0)
}

function rememberExploreCreation(creation: Creation) {
  try {
    const raw = window.sessionStorage.getItem(OPTIMISTIC_EXPLORE_KEY)
    const existing = raw ? JSON.parse(raw) : []
    const list = Array.isArray(existing) ? existing : [existing]
    const next = [
      {
        id: creation.id,
        title: creation.title?.trim() || 'Untitled creation',
        kind: creation.kind,
        public_kind: creation.public_kind,
        play_url: `/creation/${creation.id}`,
        public_url: creation.public_url || null,
        plays: creation.plays || 0,
        label: 'Made with Steve',
      },
      ...list.filter((item: unknown) => storedExploreId(item) !== creation.id),
    ].slice(0, 20)
    window.sessionStorage.setItem(OPTIMISTIC_EXPLORE_KEY, JSON.stringify(next))
  } catch {
    // Best-effort instant UI handoff only; the server remains the source of truth.
  }
}

function forgetExploreCreation(creationId: number) {
  try {
    const raw = window.sessionStorage.getItem(OPTIMISTIC_EXPLORE_KEY)
    if (!raw) return
    const existing = JSON.parse(raw)
    const list = Array.isArray(existing) ? existing : [existing]
    window.sessionStorage.setItem(
      OPTIMISTIC_EXPLORE_KEY,
      JSON.stringify(list.filter((item: unknown) => storedExploreId(item) !== creationId)),
    )
  } catch {
    // Best-effort instant UI handoff only.
  }
}

function formatUpdated(value: string | null): string {
  if (!value) return ''
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const mins = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function publicEligible(kind?: string | null, publicKind?: string | null): boolean {
  const k = String(publicKind || kind || 'web').toLowerCase()
  return ['web', 'website', 'site', 'landing', 'app', 'tool', 'application', 'quiz', 'dashboard', 'tracker'].includes(k)
}

export default function MyBuilds() {
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [creations, setCreations] = useState<Creation[]>([])
  const [deletingIds, setDeletingIds] = useState<Set<number>>(() => new Set())
  const [publishingIds, setPublishingIds] = useState<Set<number>>(() => new Set())
  const [galleryIds, setGalleryIds] = useState<Set<number>>(() => new Set())
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [actionCreationId, setActionCreationId] = useState<number | null>(null)
  // True when the actions sheet should open with the Share section expanded
  // (per-card Share button, or the /builds?share=<id> deep link from Steve).
  const [sheetShareOpen, setSheetShareOpen] = useState(false)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const activeCreation = actionCreationId == null ? null : creations.find(item => item.id === actionCreationId) || null

  useEffect(() => {
    setTitle('My Builds')
    return () => setTitle('')
  }, [setTitle])

  const load = useCallback(async () => {
    setState('loading')
    try {
      const r = await fetch('/api/builder/mine', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        setState('error')
        return
      }
      setCreations(Array.isArray(j.creations) ? j.creations : [])
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Deep links from the builder: ?highlight=<id> rings the fresh build so the
  // list isn't undifferentiated; ?share=<id> opens its share sheet directly
  // (Steve's play-close nudge — chat → share sheet in one tap).
  useEffect(() => {
    if (state !== 'ready') return
    const params = new URLSearchParams(window.location.search || '')
    const highlight = Number(params.get('highlight') || 0)
    const share = Number(params.get('share') || 0)
    if (!highlight && !share) return
    window.history.replaceState(null, '', window.location.pathname)
    const target = share || highlight
    if (!creations.some(item => item.id === target)) return
    setHighlightId(target)
    requestAnimationFrame(() => {
      document.getElementById(`build-${target}`)?.scrollIntoView({ block: 'center' })
    })
    window.setTimeout(() => setHighlightId(current => (current === target ? null : current)), 1800)
    if (share) {
      setSheetShareOpen(true)
      setActionCreationId(share)
    }
  }, [state, creations])

  // Confirmation is the sheet's two-tap arm (CreationActionsSheet) — by the
  // time this runs the user has already confirmed.
  const deleteBuild = useCallback(async (creation: Creation) => {
    if (deletingIds.has(creation.id)) return
    setDeletingIds(prev => new Set(prev).add(creation.id))
    try {
      const r = await fetch(`/api/builder/${creation.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        window.alert(j?.error === 'auth_required'
          ? 'Please sign in again to delete this build.'
          : 'Could not delete this build. Please try again.')
        return
      }
      setCreations(prev => prev.filter(item => item.id !== creation.id))
      setActionCreationId(current => current === creation.id ? null : current)
      clearCreationCache(creation.id) // drop the on-device poster cache so it can't replay
    } catch {
      window.alert('Could not delete this build. Please check your connection and try again.')
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev)
        next.delete(creation.id)
        return next
      })
    }
  }, [deletingIds])

  const copyUrl = useCallback(async (creation: Creation) => {
    if (!creation.public_url) return
    try {
      await navigator.clipboard.writeText(creation.public_url)
      setCopiedId(creation.id)
      window.setTimeout(() => setCopiedId(null), 1800)
    } catch {
      window.prompt('Copy this public link', creation.public_url)
    }
  }, [])

  const publishWeb = useCallback(async (creation: Creation) => {
    if (publishingIds.has(creation.id)) return
    setPublishingIds(prev => new Set(prev).add(creation.id))
    try {
      const r = await fetch(`/api/builder/${creation.id}/publish-web`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success || !j.public_url) {
        window.alert(j?.error === 'public_publish_not_supported_for_games'
          ? 'Public domains are for websites and apps. Games stay inside C-Point.'
          : 'Could not publish this build to the web.')
        return
      }
      setCreations(prev => prev.map(item => item.id === creation.id
        ? {
          ...item,
          public_status: j.public_status || 'published',
          public_url: j.public_url,
          public_kind: j.public_kind || item.public_kind,
        }
        : item))
      await copyUrl({ ...creation, public_url: j.public_url })
    } catch {
      window.alert('Could not publish this build. Please check your connection and try again.')
    } finally {
      setPublishingIds(prev => {
        const next = new Set(prev)
        next.delete(creation.id)
        return next
      })
    }
  }, [copyUrl, publishingIds])

  const unpublishWeb = useCallback(async (creation: Creation) => {
    if (publishingIds.has(creation.id)) return
    setPublishingIds(prev => new Set(prev).add(creation.id))
    try {
      const r = await fetch(`/api/builder/${creation.id}/publish-web`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        window.alert('Could not unpublish this build. Please try again.')
        return
      }
      setCreations(prev => prev.map(item => item.id === creation.id ? { ...item, public_status: 'unpublished' } : item))
    } catch {
      window.alert('Could not unpublish this build. Please check your connection and try again.')
    } finally {
      setPublishingIds(prev => {
        const next = new Set(prev)
        next.delete(creation.id)
        return next
      })
    }
  }, [publishingIds])

  // No confirm needed: the sheet's Explore section already states the listing
  // is anonymous, and unlisting is always one tap away.
  const updateGallery = useCallback(async (creation: Creation, action: 'request' | 'unlist') => {
    if (galleryIds.has(creation.id)) return
    setGalleryIds(prev => new Set(prev).add(creation.id))
    try {
      const r = await fetch(`/api/builder/${creation.id}/gallery`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) {
        window.alert('Could not update Explore listing. Please try again.')
        return
      }
      if (action === 'request') rememberExploreCreation(creation)
      else forgetExploreCreation(creation.id)
      setCreations(prev => prev.map(item => item.id === creation.id ? { ...item, gallery_status: j.gallery_status } : item))
    } catch {
      window.alert('Could not update Explore listing. Please check your connection and try again.')
    } finally {
      setGalleryIds(prev => {
        const next = new Set(prev)
        next.delete(creation.id)
        return next
      })
    }
  }, [galleryIds])

  const updateSharedCommunity = useCallback((
    creationId: number,
    communityId: number,
    response: { post_id?: number; community_id?: number; already_published?: boolean },
  ) => {
    setCreations(prev => prev.map(item => {
      if (item.id !== creationId) return item
      const sharedIds = new Set((item.shared_community_ids || []).map(Number))
      sharedIds.add(Number(communityId))
      return {
        ...item,
        community_id: item.community_id ?? Number(communityId),
        published_post_id: item.published_post_id ?? (response.post_id ?? null),
        status: 'published',
        shared_community_ids: Array.from(sharedIds).sort((a, b) => a - b),
      }
    }))
  }, [])

  return (
    <div className="app-content min-h-screen chat-thread-bg text-c-text-primary">
      <div className="mx-auto max-w-3xl px-4 py-6 pb-[var(--app-dashboard-content-pad-bottom)]">
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-c-text-primary">My Builds</h1>
          <p className="mt-1 text-sm text-c-text-tertiary">Creations you made with Steve.</p>
        </div>

        {state === 'loading' && (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-2xl border border-c-border bg-c-bg-elevated/60 animate-pulse" />
            ))}
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-5 text-center">
            <p className="text-sm text-c-text-secondary">We couldn't load your builds.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-xl bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
            >
              Try again
            </button>
          </div>
        )}

        {state === 'ready' && creations.length === 0 && (
          <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cpoint-turquoise/15 text-cpoint-turquoise">
              <i className="fa-solid fa-wand-magic-sparkles text-xl" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-c-text-primary">Create your first build</h2>
            <p className="mt-1 text-sm text-c-text-tertiary">
              Open a community and ask Steve to build a game, quiz, or tool.
            </p>
            <button
              type="button"
              onClick={() => navigate('/builder')}
              className="mt-4 rounded-xl bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
            >
              Start building with Steve
            </button>
          </div>
        )}

        {state === 'ready' && creations.length > 0 && (
          <ul className="space-y-3">
            {creations.map((c) => (
              <li
                key={c.id}
                id={`build-${c.id}`}
                className={`rounded-2xl border border-c-border bg-c-bg-elevated p-4 shadow-c-card transition-shadow ${highlightId === c.id ? 'ring-2 ring-cpoint-turquoise/60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-c-text-primary">
                      {c.title?.trim() || 'Untitled build'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-c-text-tertiary">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          c.status === 'published'
                            ? 'bg-cpoint-turquoise/20 text-cpoint-turquoise'
                            : 'bg-c-hover-bg text-c-text-secondary'
                        }`}
                      >
                        {c.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                      <span className="flex items-center gap-1">
                        <i className="fa-solid fa-play text-[9px]" aria-hidden="true" />
                        {c.plays}
                      </span>
                      {c.public_status === 'published' && c.public_url && (
                        <span className="rounded-full bg-cpoint-turquoise/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cpoint-turquoise">
                          Public web
                        </span>
                      )}
                      {c.gallery_status && c.gallery_status !== 'not_listed' && (
                        <span className="rounded-full bg-c-hover-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-c-text-secondary">
                          Explore: {c.gallery_status.replace('_', ' ')}
                        </span>
                      )}
                      {formatUpdated(c.updated_at) && (
                        <span className="flex items-center gap-1">
                          <i className="fa-regular fa-clock text-[9px]" aria-hidden="true" />
                          {formatUpdated(c.updated_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-[1fr_1fr_auto_auto] gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(c.community_id != null ? `/community/${c.community_id}/creation/${c.id}` : `/creation/${c.id}`)}
                    className="rounded-xl bg-cpoint-turquoise px-3 py-2 text-xs font-semibold text-black transition hover:brightness-110"
                  >
                    {c.status === 'published' ? 'Play' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(c.community_id != null ? `/community/${c.community_id}/builder?creation_id=${c.id}` : `/builder?creation_id=${c.id}`)}
                    className="rounded-xl border border-c-border bg-c-hover-bg px-3 py-2 text-xs font-semibold text-c-text-primary transition hover:border-cpoint-turquoise/40"
                  >
                    Continue building
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSheetShareOpen(true); setActionCreationId(c.id) }}
                    className="rounded-xl border border-cpoint-turquoise/50 px-3 py-2 text-xs font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/10"
                  >
                    Share
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSheetShareOpen(false); setActionCreationId(c.id) }}
                    aria-label={`Open options for ${c.title?.trim() || 'build'}`}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-c-border bg-c-hover-bg text-c-text-tertiary transition hover:border-cpoint-turquoise/40 hover:text-c-text-primary"
                  >
                    <i className="fa-solid fa-ellipsis" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <CreationActionsSheet
          creation={activeCreation}
          initialShareOpen={sheetShareOpen}
          copied={activeCreation ? copiedId === activeCreation.id : false}
          deleting={activeCreation ? deletingIds.has(activeCreation.id) : false}
          galleryWorking={activeCreation ? galleryIds.has(activeCreation.id) : false}
          publishing={activeCreation ? publishingIds.has(activeCreation.id) : false}
          publicEligible={activeCreation ? publicEligible(activeCreation.kind, activeCreation.public_kind) : false}
          onClose={() => setActionCreationId(null)}
          onCopyPublicUrl={copyUrl}
          onDelete={deleteBuild}
          onGallery={updateGallery}
          onOpenCommunity={(creation) => {
            if (creation.community_id != null) navigate(`/community_feed_react/${creation.community_id}`)
          }}
          onPublishWeb={publishWeb}
          onShared={updateSharedCommunity}
          onUnpublishWeb={unpublishWeb}
          onCategorySaved={(creationId, category, source) => {
            // Keep the list in sync so reopening the sheet shows the saved
            // value instead of the stale /mine payload.
            setCreations(prev => prev.map(c => c.id === creationId
              ? { ...c, category, category_source: source }
              : c))
          }}
          onKindSaved={(creationId, kind) => {
            // kind drives publish-web eligibility and the gallery shelf, so
            // the list (and the sheet's props, derived from it) must follow.
            setCreations(prev => prev.map(c => c.id === creationId
              ? { ...c, kind, public_kind: c.public_kind ? kind : c.public_kind }
              : c))
          }}
        />
      </div>
    </div>
  )
}
