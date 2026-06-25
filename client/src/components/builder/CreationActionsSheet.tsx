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
}

function titleFor(creation: SheetCreation): string {
  return creation.title?.trim() || 'Untitled build'
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
}: Props) {
  if (!creation) return null
  const isListed = creation.gallery_status === 'pending' || creation.gallery_status === 'approved'
  const isPublic = creation.public_status === 'published' && !!creation.public_url
  const sharedIds = creation.shared_community_ids || []

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 px-0 sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Options for ${titleFor(creation)}`}
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-c-border bg-c-bg-elevated p-4 shadow-c-card sm:max-w-xl sm:rounded-3xl"
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
          <CommunitySharePicker
            creationId={creation.id}
            sharedCommunityIds={sharedIds}
            onShared={(communityId, response) => onShared(creation.id, communityId, response)}
          />

          <section className="rounded-2xl border border-c-border bg-c-hover-bg p-3">
            <div className="mb-2 text-sm font-semibold text-c-text-primary">Explore Creations</div>
            <button
              type="button"
              onClick={() => { void onGallery(creation, isListed ? 'unlist' : 'request') }}
              disabled={galleryWorking}
              className="w-full rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-3 py-2 text-left text-sm font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {galleryWorking ? 'Working...' : isListed ? 'Remove from Explore' : 'List in Explore Creations'}
            </button>
            <p className="mt-2 text-xs text-c-text-tertiary">Explore listings are anonymous: your name, profile, and community are not shown.</p>
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
                    onClick={() => { void onUnpublishWeb(creation) }}
                    disabled={publishing}
                    className="rounded-xl border border-c-border bg-c-bg-elevated px-3 py-2 text-sm font-medium text-c-text-secondary transition hover:text-c-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {publishing ? 'Working...' : 'Unpublish web'}
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
                onClick={() => { void onDelete(creation) }}
                disabled={deleting}
                className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-left text-sm font-semibold text-red-200 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete build'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
