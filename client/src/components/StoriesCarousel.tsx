import Avatar from './Avatar'

type StoryPreview = {
  id: number
  username: string
  display_name?: string | null
  profile_picture?: string | null
  thumbnail_path?: string | null
  has_viewed?: boolean
}

type StoriesCarouselProps = {
  stories: StoryPreview[]
  loading?: boolean
  uploading?: boolean
  currentUser?: string | null
  onSelect?: (index: number) => void
  onAddStory?: () => void
}

function normalizeStoryMedia(path?: string | null) {
  if (!path) return ''
  if (path.startsWith('http')) return path
  if (path.startsWith('/uploads') || path.startsWith('/static')) return path
  return path.startsWith('uploads') ? `/${path}` : `/uploads/${path}`
}

export default function StoriesCarousel({
  stories,
  loading,
  uploading,
  currentUser,
  onSelect,
  onAddStory,
}: StoriesCarouselProps) {
  const showAddButton = typeof onAddStory === 'function' && !!currentUser
  if (!showAddButton && stories.length === 0) {
    return null
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 space-y-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.35em] text-white/50">
        <span>Stories</span>
        {loading ? <span className="tracking-normal text-white/60">Syncing…</span> : null}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
        {showAddButton && (
          <button
            type="button"
            className="flex flex-col items-center gap-2 text-xs text-white/80"
            onClick={onAddStory}
            disabled={uploading}
          >
            <div className={`w-16 h-16 rounded-full border-2 border-dashed border-white/20 grid place-items-center bg-white/[0.03] ${uploading ? 'opacity-60' : ''}`}>
              {uploading ? (
                <span className="w-5 h-5 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
              ) : (
                <i className="fa-solid fa-plus text-white/80" />
              )}
            </div>
            <span className="text-[11px] uppercase tracking-wide">Add</span>
          </button>
        )}
        {stories.map((story, idx) => {
          const thumb = story.thumbnail_path ? normalizeStoryMedia(story.thumbnail_path) : null
          const ringClass = story.has_viewed ? 'border-white/15' : 'border-[#4db6ac]'
          return (
            <button
              type="button"
              key={story.id}
              className="flex flex-col items-center gap-2 text-xs text-white/80"
              onClick={() => onSelect?.(idx)}
            >
              <div className={`w-16 h-16 rounded-full border-2 ${ringClass} p-0.5`}>
                {thumb ? (
                  <img src={thumb} alt={story.username} className="w-full h-full rounded-full object-cover" />
                ) : (
                  <Avatar username={story.username} url={story.profile_picture || undefined} size={56} />
                )}
              </div>
              <span className="max-w-[64px] truncate text-[11px] text-white/70">
                {story.display_name || story.username}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
