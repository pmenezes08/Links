import CreationPreview from './CreationPreview'
import type { Creation } from '../../hooks/useBuilder'

/**
 * The in-chat build card: preview + title + play. One button, one action.
 *
 * Sharing/publishing deliberately does NOT live here — My Builds is the single
 * share destination (founder decision 2026-07-02); the footer link and Steve's
 * play-close nudge point there.
 */
export default function BuildResultCard({
  creation,
  isLatest,
  onPlay,
  onViewInMyBuilds,
}: {
  creation: Creation
  isLatest: boolean
  onPlay: () => void
  onViewInMyBuilds: () => void
}) {
  return (
    <div className="mt-2.5 w-full max-w-[340px]">
      <button
        onClick={onPlay}
        aria-label={`Play ${creation.title || 'your build'}`}
        className={`relative block h-[196px] w-full overflow-hidden rounded-2xl border border-c-border bg-c-bg-elevated ${isLatest ? '' : 'opacity-85'}`}
      >
        <CreationPreview html={creation.html} />
        {/* scrim so the title stays legible over the live preview */}
        <span className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/55" aria-hidden="true" />
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cpoint-turquoise text-black shadow-[0_4px_18px_rgba(0,0,0,0.45)]">
            <i className="fa-solid fa-play text-lg" aria-hidden="true" />
          </span>
        </span>
        <span className="absolute bottom-2.5 left-3 right-3 truncate text-left text-sm font-semibold text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]">
          {creation.title}
        </span>
      </button>
      <div className="mt-1 flex min-h-[44px] items-center justify-between gap-2">
        <span className="text-xs text-c-text-tertiary">Saved to My Builds</span>
        <button
          onClick={onViewInMyBuilds}
          className="flex min-h-[44px] items-center gap-1 text-sm font-semibold text-cpoint-turquoise"
        >
          View in My Builds
          <i className="fa-solid fa-chevron-right text-[10px]" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
