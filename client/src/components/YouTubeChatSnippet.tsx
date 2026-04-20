import { openExternalNativeLink } from '../utils/openExternalInApp'

type Props = {
  videoId: string
  className?: string
}

/** Chat-only: thumbnail + play affordance; opens youtube.com in the OS / browser (no iframe). */
export default function YouTubeChatSnippet({ videoId, className = '' }: Props) {
  if (!videoId?.trim()) return null
  const id = videoId.trim()
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
  const thumb = `https://img.youtube.com/vi/${id}/hqdefault.jpg`

  return (
    <button
      type="button"
      className={`relative block w-full max-w-[280px] overflow-hidden rounded-lg border border-white/15 bg-black/40 text-left touch-manipulation ${className}`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void openExternalNativeLink(watchUrl)
      }}
    >
      <div className="relative aspect-video w-full bg-black">
        <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="flex h-11 w-14 items-center justify-center rounded-md bg-red-600/95 shadow-lg">
            <i className="fa-solid fa-play ml-0.5 text-sm text-white" aria-hidden />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <i className="fa-brands fa-youtube text-sm text-red-500" aria-hidden />
        <span className="truncate text-[12px] text-white/85">Watch on YouTube</span>
      </div>
    </button>
  )
}
