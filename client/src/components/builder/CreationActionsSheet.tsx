import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import CommunitySharePicker from './CommunitySharePicker'

export type SheetCreation = {
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
  shared_community_ids?: number[]
}

type Props = {
  creation: SheetCreation | null
  copied: boolean
  deleting: boolean
  galleryWorking: boolean
  publishing: boolean
  publicEligible: boolean
  onClose: () => void
  onCopyPublicUrl: (creation: SheetCreation) => Promise<void>
  onDelete: (creation: SheetCreation) => Promise<void>
  onGallery: (creation: SheetCreation, action: 'request' | 'unlist') => Promise<void>
  onOpenCommunity: (creation: SheetCreation) => void
  onPublishWeb: (creation: SheetCreation) => Promise<void>
  onShared: (creationId: number, communityId: number, response: { post_id?: number; community_id?: number; already_published?: boolean }) => void
  onUnpublishWeb: (creation: SheetCreation) => Promise<void>
  /** Open with the Share section already expanded (deep links, Share buttons). */
  initialShareOpen?: boolean
}

function titleFor(creation: SheetCreation): string {
  return creation.title?.trim() || 'Untitled build'
}

/**
 * Opt-in Explore builder handle. Self-contained (GET/POST /api/builder/pseudonym):
 * privacy-sensitive validation (no username collisions, uniqueness) lives
 * server-side; this control only reads/writes the caller's own handle.
 */
function BuilderPseudonymField() {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'error' | 'done'>('idle')

  useEffect(() => {
    let alive = true
    fetch('/api/builder/pseudonym', { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => {
        if (alive && d?.success) { setSaved(d.pseudonym || null); setValue(d.pseudonym || '') }
      })
      .catch(() => { /* field stays editable; save reports errors */ })
    return () => { alive = false }
  }, [])

  const dirty = value.trim() !== (saved || '')
  const save = async () => {
    setState('saving')
    try {
      const res = await fetch('/api/builder/pseudonym', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudonym: value.trim() || null }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        setSaved(data.pseudonym || null)
        setValue(data.pseudonym || '')
        setState('done')
        return
      }
      setState('error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="mt-3 border-t border-c-border pt-3">
      <label htmlFor="builder-pseudonym" className="block text-xs font-semibold text-c-text-secondary">
        Builder name (optional)
      </label>
      <p className="mt-0.5 text-xs text-c-text-tertiary">
        Shown on your gallery cards instead of staying anonymous. Never links to your profile.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          id="builder-pseudonym"
          type="text"
          value={value}
          maxLength={32}
          onChange={(e) => { setValue(e.target.value); setState('idle') }}
          placeholder="e.g. NightOwl Builds"
          className="min-w-0 flex-1 rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2 text-sm text-c-text-primary outline-none placeholder:text-c-text-tertiary focus:border-cpoint-turquoise/50"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || state === 'saving'}
          className="rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-2 text-sm font-semibold text-cpoint-turquoise transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === 'saving' ? 'Saving...' : 'Save'}
        </button>
      </div>
      {state === 'error' && (
        <p className="mt-1.5 text-xs text-red-400">That name is unavailable — try another.</p>
      )}
      {state === 'done' && (
        <p className="mt-1.5 text-xs text-c-text-tertiary">{saved ? `Cards will show "by ${saved}".` : 'Back to anonymous.'}</p>
      )}
    </div>
  )
}

export default function CreationActionsSheet({
  creation,
  copied,
  deleting,
  galleryWorking,
  publishing,
  publicEligible,
  onClose,
  onCopyPublicUrl,
  onDelete,
  onGallery,
  onOpenCommunity,
  onPublishWeb,
  onShared,
  onUnpublishWeb,
  initialShareOpen = false,
}: Props) {
  const [shareOpen, setShareOpen] = useState(initialShareOpen)
  // Destructive actions confirm in-sheet (two taps), never via window.confirm.
  const [armed, setArmed] = useState<'delete' | 'unpublish' | null>(null)
  const creationId = creation?.id ?? null
  useEffect(() => {
    // Re-arm defaults each time the sheet opens for a (different) creation.
    setShareOpen(creationId != null ? initialShareOpen : false)
    setArmed(null)
  }, [creationId, initialShareOpen])
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(null), 3500)
    return () => window.clearTimeout(t)
  }, [armed])
  if (!creation || typeof document === 'undefined') return null
  const isListed = creation.gallery_status === 'pending' || creation.gallery_status === 'approved'
  const isPublic = creation.public_status === 'published' && !!creation.public_url
  const sharedIds = creation.shared_community_ids || []

  // Portaled to <body>: page-transition containers carry CSS transforms, which
  // re-anchor position:fixed to the PAGE instead of the screen — the sheet's
  // bottom (Delete build) ended up below the visible viewport with nothing to
  // scroll. Same escape hatch DashboardBottomNav uses.
  return createPortal(
    <div
      // z-[1000]: must stack ABOVE DashboardBottomNav (z-[900]) and its flyout
      // (z-[950]) or the nav occludes the sheet's last rows (Delete build).
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 px-0 sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Options for ${titleFor(creation)}`}
      onClick={onClose}
    >
      <div
        // backdrop-blur: --c-bg-elevated is translucent in dark theme; without
        // blur the page bleeds through and the sheet is hard to read.
        className="max-h-[82dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl border border-c-border bg-c-bg-elevated p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] shadow-[0_-28px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl sm:max-w-xl sm:rounded-3xl sm:pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-c-border sm:hidden" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-c-text-tertiary">Build options</div>
            <h2 className="mt-1 truncate text-lg font-semibold text-c-text-primary">{titleFor(creation)}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close build options"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-c-border bg-c-hover-bg text-c-text-tertiary transition hover:text-c-text-primary"
          >
            <i className="fa-solid fa-xmark text-sm" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3">
          <section className="rounded-2xl border border-c-border bg-c-hover-bg p-3">
            <div className="mb-2 text-sm font-semibold text-c-text-primary">Made with Steve gallery</div>
            <button
              type="button"
              onClick={() => { void onGallery(creation, isListed ? 'unlist' : 'request') }}
              disabled={galleryWorking}
              className="w-full rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-2 text-left text-sm font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {galleryWorking ? 'Working...' : isListed ? 'Remove from the gallery' : 'List in the gallery'}
            </button>
            <p className="mt-2 text-xs text-c-text-tertiary">Gallery listings are anonymous: your name, profile, and community are not shown.</p>
            {isListed && <BuilderPseudonymField />}
          </section>

          <section className="rounded-2xl border border-c-border bg-c-hover-bg p-3">
            <button
              type="button"
              onClick={() => setShareOpen(open => !open)}
              aria-expanded={shareOpen}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2 text-left transition hover:border-cpoint-turquoise/35"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-c-text-primary">Share to community</span>
                <span className="text-xs text-c-text-tertiary">
                  {sharedIds.length ? `${sharedIds.length} shared already` : 'Choose a root, then a sub-community'}
                </span>
              </span>
              <i className={`fa-solid fa-chevron-${shareOpen ? 'up' : 'down'} text-xs text-c-text-tertiary`} aria-hidden="true" />
            </button>
            {shareOpen && (
              <div className="mt-3">
                <CommunitySharePicker
                  creationId={creation.id}
                  sharedCommunityIds={sharedIds}
                  onShared={(communityId, response) => onShared(creation.id, communityId, response)}
                />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-c-border bg-c-hover-bg p-3">
            <div className="mb-2 text-sm font-semibold text-c-text-primary">Public web link</div>
            {publicEligible ? (
              isPublic ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => { void onCopyPublicUrl(creation) }}
                    className="rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-2 text-sm font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/15"
                  >
                    {copied ? 'Copied' : 'Copy public link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (armed !== 'unpublish') { setArmed('unpublish'); return }
                      setArmed(null)
                      void onUnpublishWeb(creation)
                    }}
                    disabled={publishing}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${armed === 'unpublish' ? 'border-amber-400/40 bg-amber-500/10 text-amber-200' : 'border-c-border bg-c-bg-elevated text-c-text-secondary hover:text-c-text-primary'}`}
                  >
                    {publishing ? 'Working...' : armed === 'unpublish' ? 'Tap again to unpublish' : 'Unpublish web'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { void onPublishWeb(creation) }}
                  disabled={publishing}
                  className="w-full rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-2 text-left text-sm font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishing ? 'Publishing...' : 'Publish web'}
                </button>
              )
            ) : (
              <div className="rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2 text-sm text-c-text-tertiary">
                Games stay inside C-Point.
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-c-border bg-c-hover-bg p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {creation.community_id != null && (
                <button
                  type="button"
                  onClick={() => onOpenCommunity(creation)}
                  className="rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2 text-left text-sm font-medium text-c-text-secondary transition hover:text-c-text-primary"
                >
                  Open community
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (armed !== 'delete') { setArmed('delete'); return }
                  setArmed(null)
                  void onDelete(creation)
                }}
                disabled={deleting}
                className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${armed === 'delete' ? 'border-red-400/60 bg-red-500/25 text-red-100' : 'border-red-400/25 bg-red-500/10 text-red-200 hover:bg-red-500/15'}`}
              >
                {deleting ? 'Deleting...' : armed === 'delete' ? 'Tap again to delete' : 'Delete build'}
              </button>
            </div>
            {armed === 'delete' && (
              <p className="mt-2 text-xs text-c-text-tertiary">
                Removes the build, its public web link, all saves, scores, ratings, and the community post if published. This cannot be undone.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
