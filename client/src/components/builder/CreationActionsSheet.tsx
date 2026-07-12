import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CommunitySharePicker from './CommunitySharePicker'
import { sectionOf } from '../../hooks/useExploreCreations'

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
  category?: string | null
  category_source?: string | null
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
  /** Propagate a saved category into the caller's list so reopening the
   * sheet shows the persisted value, not stale payload data. */
  onCategorySaved?: (creationId: number, category: string | null, source: string | null) => void
  /** Same, for a creator-corrected type (website/app/game). */
  onKindSaved?: (creationId: number, kind: string) => void
}

function titleFor(creation: SheetCreation): string {
  return creation.title?.trim() || 'Untitled build'
}

// Categories are TOPICS, orthogonal to the creation's form (founder call
// 2026-07-12): every creation gets the universal topic list; games add genres
// and websites add site types, rendered as dropdown groups. Mirrors
// builder.BUILDER_CATEGORIES (the backend re-validates every write, so drift
// here can never misfile a creation). Labels stay in lockstep with the
// gallery's i18n catalog entries.
const UNIVERSAL_TOPICS = ['travel', 'music', 'sports', 'food', 'health', 'fitness',
  'finance', 'productivity', 'learning', 'entertainment', 'photos', 'shopping',
  'social', 'news', 'weather', 'business', 'event', 'lifestyle', 'utilities',
  'community', 'art', 'education']
const GAME_GENRES = ['arcade', 'puzzle', 'board', 'trivia', 'word', 'action',
  'adventure', 'strategy', 'racing', 'simulation', 'casual', 'retro']
const WEBSITE_TYPES = ['portfolio', 'landing', 'blog', 'directory', 'personal', 'shop']
const SECTION_GROUPS: Record<string, { label: string; slugs: string[] }[]> = {
  website: [
    { label: 'Website types', slugs: WEBSITE_TYPES },
    { label: 'Topics', slugs: UNIVERSAL_TOPICS },
  ],
  app: [{ label: 'Topics', slugs: UNIVERSAL_TOPICS }],
  game: [
    { label: 'Game genres', slugs: GAME_GENRES },
    { label: 'Topics', slugs: UNIVERSAL_TOPICS },
  ],
}
const CATEGORY_LABELS: Record<string, string> = {
  business: 'Business', portfolio: 'Portfolio', event: 'Events', landing: 'Landing page',
  blog: 'Blog', directory: 'Directory', personal: 'Personal', shop: 'Online shop',
  education: 'Education', productivity: 'Productivity', fitness: 'Fitness',
  finance: 'Finance', travel: 'Travel', health: 'Health', learning: 'Learning',
  food: 'Food & drink', lifestyle: 'Lifestyle', entertainment: 'Entertainment',
  music: 'Music', photos: 'Photo & video', shopping: 'Shopping', social: 'Social',
  utilities: 'Utilities', news: 'News', weather: 'Weather', community: 'Community',
  art: 'Art & design', arcade: 'Arcade', puzzle: 'Puzzle', board: 'Board & cards',
  trivia: 'Trivia', word: 'Word games', sports: 'Sports', action: 'Action',
  adventure: 'Adventure', strategy: 'Strategy', racing: 'Racing',
  simulation: 'Simulation', casual: 'Casual', retro: 'Retro',
}

/**
 * Gallery metadata form — category (every creation) + builder name (listed
 * only) behind ONE explicit Save (founder call 2026-07-12: auto-save on
 * change lost picks silently on device; changes are drafts until saved, and
 * the sheet guards close while dirty). Precedence unchanged: admin locks >
 * creator > Steve's automation; the backend re-validates every write.
 */
const KIND_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'website', label: 'Website', hint: 'a page people read' },
  { value: 'app', label: 'App', hint: 'a tool that keeps their data' },
  { value: 'game', label: 'Game', hint: 'something they play' },
]

function GalleryMetaForm({ creation, showPseudonym, onDirtyChange, saveRef, onCategorySaved, onKindSaved }: {
  creation: SheetCreation
  showPseudonym: boolean
  onDirtyChange: (dirty: boolean) => void
  saveRef: React.MutableRefObject<(() => Promise<boolean>) | null>
  onCategorySaved?: (creationId: number, category: string | null, source: string | null) => void
  onKindSaved?: (creationId: number, kind: string) => void
}) {
  const initialKind = sectionOf({ kind: creation.kind, public_kind: creation.public_kind })
  const [savedKind, setSavedKind] = useState<string>(initialKind)
  const [draftKind, setDraftKind] = useState<string>(initialKind)
  const groups = SECTION_GROUPS[draftKind] ?? []
  const [savedCat, setSavedCat] = useState(creation.category || '')
  const [savedSource, setSavedSource] = useState<string | null>(creation.category_source || null)
  const [draftCat, setDraftCat] = useState(creation.category || '')
  const [savedName, setSavedName] = useState('')
  const [draftName, setDraftName] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'error' | 'done'>('idle')
  const [errorText, setErrorText] = useState<string>("Couldn't save — try again.")

  useEffect(() => {
    const section = sectionOf({ kind: creation.kind, public_kind: creation.public_kind })
    setSavedKind(section); setDraftKind(section)
    setSavedCat(creation.category || ''); setDraftCat(creation.category || '')
    setSavedSource(creation.category_source || null); setState('idle')
  }, [creation.id, creation.kind, creation.public_kind, creation.category, creation.category_source])

  useEffect(() => {
    if (!showPseudonym) return
    let alive = true
    // Promise.resolve wrapper: a stubbed/failing fetch must never throw
    // synchronously in the effect — the field degrades to editable-empty.
    Promise.resolve(fetch('/api/builder/pseudonym', { credentials: 'include', headers: { Accept: 'application/json' } }))
      .then(r => r!.json())
      .then(d => { if (alive && d?.success) { setSavedName(d.pseudonym || ''); setDraftName(d.pseudonym || '') } })
      .catch(() => { /* editable; save reports errors */ })
    return () => { alive = false }
  }, [showPseudonym])

  const locked = savedSource === 'admin'
  const kindDirty = draftKind !== savedKind
  const catDirty = !locked && draftCat !== savedCat
  const nameDirty = showPseudonym && draftName.trim() !== savedName
  const dirty = kindDirty || catDirty || nameDirty
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  // Unmount must never leave the sheet's close guard wedged on.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    setState('saving')
    setErrorText("Couldn't save — try again.")
    try {
      // Kind first: the server revalidates the category against the NEW
      // section, and the category POST below re-applies the (still valid)
      // draft on top.
      let catAfterKind = savedCat
      if (kindDirty) {
        const res = await fetch(`/api/builder/${creation.id}/kind`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: draftKind }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          if (data?.error === 'unpublish_web_first') setErrorText('Unpublish the web link first — games stay inside C-Point.')
          if (data?.error === 'kind_locked_multiplayer') setErrorText('Multiplayer creations are always games.')
          setState('error'); return false
        }
        setSavedKind(draftKind)
        catAfterKind = data.category || ''
        setSavedCat(catAfterKind)
        setSavedSource(data.category_source || null)
        onKindSaved?.(creation.id, draftKind)
        onCategorySaved?.(creation.id, data.category || null, data.category_source || null)
      }
      if (!locked && draftCat !== catAfterKind) {
        const res = await fetch(`/api/builder/${creation.id}/category`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: draftCat || null }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) { setState('error'); return false }
        setSavedCat(draftCat)
        setSavedSource(draftCat ? 'creator' : null)
        onCategorySaved?.(creation.id, draftCat || null, draftCat ? 'creator' : null)
      }
      if (nameDirty) {
        const res = await fetch('/api/builder/pseudonym', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pseudonym: draftName.trim() || null }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          setErrorText('That name is unavailable — try another.')
          setState('error'); return false
        }
        setSavedName(data.pseudonym || ''); setDraftName(data.pseudonym || '')
      }
      setState('done')
      return true
    } catch {
      setState('error')
      return false
    }
  }, [dirty, kindDirty, locked, savedCat, draftKind, nameDirty, draftCat, draftName, creation.id, onCategorySaved, onKindSaved])

  useEffect(() => {
    saveRef.current = save
    return () => { saveRef.current = null }
  }, [save, saveRef])

  if (groups.length === 0 && !showPseudonym) return null
  const suggested = savedCat && draftCat === savedCat && savedSource !== 'creator' && savedSource !== 'admin'
  const kindHint = KIND_OPTIONS.find(k => k.value === draftKind)?.hint
  return (
    <div className="mt-3 border-t border-c-border pt-3">
      <label htmlFor={`creation-kind-${creation.id}`} className="block text-xs font-semibold text-c-text-secondary">
        Type
      </label>
      <select
        id={`creation-kind-${creation.id}`}
        value={draftKind}
        onChange={(e) => {
          const next = e.target.value
          setDraftKind(next)
          // Keep the category draft coherent with the new section: universal
          // topics survive, form-specific slugs reset to untagged.
          const nextSlugs = (SECTION_GROUPS[next] ?? []).flatMap(g => g.slugs)
          if (draftCat && !nextSlugs.includes(draftCat)) setDraftCat('')
          setState('idle')
        }}
        className="mt-2 w-full appearance-none rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2.5 text-sm text-c-text-primary outline-none focus:border-cpoint-turquoise/50"
      >
        {KIND_OPTIONS.map(k => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </select>
      {kindHint && (
        <p className="mt-1.5 text-xs text-c-text-tertiary">
          {KIND_OPTIONS.find(k => k.value === draftKind)?.label}: {kindHint}. Everything runs inside C-Point.
        </p>
      )}
      <label htmlFor={`creation-category-${creation.id}`} className="mt-3 flex items-baseline gap-2">
        <span className="text-xs font-semibold text-c-text-secondary">Category</span>
        {suggested && (
          <span className="text-[10px] uppercase tracking-wide text-c-text-tertiary">Suggested by Steve</span>
        )}
      </label>
      <select
        id={`creation-category-${creation.id}`}
        value={draftCat}
        disabled={locked}
        onChange={(e) => { setDraftCat(e.target.value); setState('idle') }}
        className="mt-2 w-full appearance-none rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2.5 text-sm text-c-text-primary outline-none focus:border-cpoint-turquoise/50 disabled:opacity-50"
      >
        <option value="">No category</option>
        {groups.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.slugs.map(slug => (
              <option key={slug} value={slug}>{CATEGORY_LABELS[slug] || slug}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-c-text-tertiary">
        {locked ? 'Set by the review team.' : 'Helps people find it in the gallery (optional).'}
      </p>
      {showPseudonym && (
        <>
          <label htmlFor="builder-pseudonym" className="mt-3 block text-xs font-semibold text-c-text-secondary">
            Builder name (optional)
          </label>
          <p className="mt-0.5 text-xs text-c-text-tertiary">
            Shown on your gallery cards instead of staying anonymous. Never links to your profile.
          </p>
          <input
            id="builder-pseudonym"
            type="text"
            value={draftName}
            maxLength={32}
            onChange={(e) => { setDraftName(e.target.value); setState('idle') }}
            placeholder="e.g. NightOwl Builds"
            className="mt-2 w-full rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2 text-sm text-c-text-primary outline-none placeholder:text-c-text-tertiary focus:border-cpoint-turquoise/50"
          />
        </>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs" aria-live="polite">
          {state === 'error' ? (
            <span className="text-red-400">{errorText}</span>
          ) : dirty ? (
            <span className="text-amber-300">Unsaved changes</span>
          ) : state === 'done' ? (
            <span className="text-c-text-tertiary">Saved.</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || state === 'saving'}
          className="shrink-0 rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-4 py-2 text-sm font-semibold text-cpoint-turquoise transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === 'saving' ? 'Saving...' : 'Save'}
        </button>
      </div>
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
  onCategorySaved,
  onKindSaved,
}: Props) {
  const [shareOpen, setShareOpen] = useState(initialShareOpen)
  // Destructive actions confirm in-sheet (two taps), never via window.confirm.
  const [armed, setArmed] = useState<'delete' | 'unpublish' | null>(null)
  // Unsaved gallery-meta drafts guard the close (same in-sheet-confirm house
  // pattern as destructive actions — never window.confirm).
  const [metaDirty, setMetaDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const metaSaveRef = useRef<(() => Promise<boolean>) | null>(null)
  const creationId = creation?.id ?? null
  useEffect(() => {
    // Re-arm defaults each time the sheet opens for a (different) creation.
    setShareOpen(creationId != null ? initialShareOpen : false)
    setArmed(null)
    setConfirmDiscard(false)
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

  // Founder rule 2026-07-12: closing with unsaved gallery-meta drafts must ask
  // first — otherwise a picked category silently evaporates.
  const requestClose = () => {
    if (metaDirty) { setConfirmDiscard(true); return }
    onClose()
  }

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
      onClick={requestClose}
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
            onClick={requestClose}
            aria-label="Close build options"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-c-border bg-c-hover-bg text-c-text-tertiary transition hover:text-c-text-primary"
          >
            <i className="fa-solid fa-xmark text-sm" aria-hidden="true" />
          </button>
        </div>

        {confirmDiscard && (
          <div className="mb-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3">
            <p className="text-sm font-medium text-c-text-primary">You have unsaved changes.</p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const ok = await (metaSaveRef.current ? metaSaveRef.current() : Promise.resolve(true))
                  setConfirmDiscard(false)
                  if (ok) onClose()
                }}
                className="rounded-xl bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
              >
                Save & close
              </button>
              <button
                type="button"
                onClick={() => { setConfirmDiscard(false); setMetaDirty(false); onClose() }}
                className="rounded-xl border border-c-border px-4 py-2 text-sm font-semibold text-c-text-secondary transition hover:text-c-text-primary"
              >
                Discard changes
              </button>
            </div>
          </div>
        )}

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
            {/* Category is useful pre-listing too (founder QA feedback
                2026-07-12): show it always so a draft can be filed before the
                creator ever lists. The pseudonym stays listing-only — it is
                purely a gallery credit. One shared Save persists both. */}
            <GalleryMetaForm
              creation={creation}
              showPseudonym={isListed}
              onDirtyChange={setMetaDirty}
              saveRef={metaSaveRef}
              onCategorySaved={onCategorySaved}
              onKindSaved={onKindSaved}
            />
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
