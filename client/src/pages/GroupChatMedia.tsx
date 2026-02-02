import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'
import ZoomableImage from '../components/ZoomableImage'

type MediaItem = {
  id: number
  message_id: number
  sender: string
  url: string
  type: 'image' | 'video'
  created_at: string | number | Date
}

export default function GroupChatMedia() {
  const { group_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewingMedia, setViewingMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null)

  useEffect(() => { setTitle('Media') }, [setTitle])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const r = await fetch(`/api/group_chat/${group_id}/media`, { credentials: 'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) {
          setItems(j.media || [])
          setError(null)
        } else {
          setError(j?.error || 'Failed to load media')
        }
      } catch {
        if (mounted) setError('Failed to load media')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [group_id])

  // Group by date and format dates nicely
  const groups = useMemo(() => {
    const map: Record<string, MediaItem[]> = {}
    for (const it of items) {
      const parsedDate = parseFlexibleDate(it.created_at)
      let dateKey = 'Unknown Date'

      if (parsedDate && !isNaN(parsedDate.getTime())) {
        dateKey = parsedDate.toISOString().split('T')[0] // YYYY-MM-DD format
      }

      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(it)
    }

    // Sort groups by date desc, items by time desc
    const keys = Object.keys(map).sort((a, b) => {
      if (a === 'Unknown Date') return 1
      if (b === 'Unknown Date') return -1
      return a < b ? 1 : -1
    })

    for (const k of keys) {
      if (k !== 'Unknown Date') {
        map[k].sort((a, b) => {
          const dateA = parseFlexibleDate(a.created_at)
          const dateB = parseFlexibleDate(b.created_at)
          if (!dateA && !dateB) return 0
          if (!dateA) return 1
          if (!dateB) return -1
          return dateB.getTime() - dateA.getTime() // Most recent first within each day
        })
      }
    }

    // Format date keys to be more user-friendly
    const formattedKeys = keys.map(key => {
      if (key === 'Unknown Date') return key

      const date = parseFlexibleDate(key)
      if (!date || isNaN(date.getTime())) return 'Unknown Date'

      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)

      if (date.toDateString() === today.toDateString()) {
        return 'Today'
      } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday'
      } else {
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      }
    })

    return { keys: formattedKeys, map, originalKeys: keys }
  }, [items])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Subnav header */}
      <div
        className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button 
            className="p-2 rounded-full hover:bg-white/5" 
            onClick={() => navigate(`/group_chat/${group_id}`)} 
            aria-label="Back"
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 font-medium">Media</div>
          <div className="text-sm text-[#9fb0b5]">{items.length} item{items.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Content */}
      <div
        className="app-subnav-offset max-w-2xl mx-auto pb-20 px-3 overflow-y-auto no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
          '--app-subnav-height': '40px',
        } as CSSProperties}
      >
        {items.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-[#9fb0b5] mb-4">
              <i className="fa-solid fa-photo-film text-4xl mb-3 block opacity-50"></i>
              <p className="text-lg font-medium">No media yet</p>
              <p className="text-sm">Photos and videos shared in this chat will appear here</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8 pt-4">
            {groups.keys.map((formattedDateKey, index) => {
              const originalDateKey = groups.originalKeys[index]
              const mediaForDate = groups.map[originalDateKey] || []

              return (
                <div key={formattedDateKey} className="space-y-3">
                  <div className="text-sm text-[#9fb0b5] font-medium border-b border-white/10 pb-2">
                    {formattedDateKey} ({mediaForDate.length} item{mediaForDate.length !== 1 ? 's' : ''})
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {mediaForDate.map(m => (
                      <div 
                        key={m.id} 
                        className="relative group aspect-square cursor-pointer"
                        onClick={() => setViewingMedia({ url: m.url, type: m.type })}
                      >
                        {m.type === 'video' ? (
                          <>
                            <video
                              src={m.url}
                              className="w-full h-full object-cover rounded-lg border border-white/10"
                              muted
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                                <i className="fa-solid fa-play text-white text-sm ml-0.5" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img
                            src={m.url}
                            alt="Shared media"
                            className="w-full h-full object-cover rounded-lg border border-white/10 hover:border-white/20 transition-colors"
                          />
                        )}
                        <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-white/80">
                          {formatSmartTime(m.created_at)}
                        </div>
                        <div className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-white/60">
                          {m.sender}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Media viewer modal */}
      {viewingMedia && (
        <div 
          className="fixed inset-0 bg-black z-[9999] flex flex-col"
          onClick={() => setViewingMedia(null)}
        >
          {/* Header */}
          <div 
            className="flex items-center justify-between px-4 py-3 bg-black/80"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
          >
            <button
              onClick={() => setViewingMedia(null)}
              className="text-white p-2 -ml-2"
            >
              <i className="fa-solid fa-xmark text-xl" />
            </button>
            <span className="text-white font-medium">
              {viewingMedia.type === 'video' ? 'Video' : 'Photo'}
            </span>
            <div className="w-8" />
          </div>

          {/* Media view */}
          <div 
            className="flex-1 flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {viewingMedia.type === 'video' ? (
              <video
                src={viewingMedia.url}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-full"
              />
            ) : (
              <ZoomableImage
                src={viewingMedia.url}
                alt="Media"
                className="w-full h-full"
                onRequestClose={() => setViewingMedia(null)}
              />
            )}
          </div>

          {/* Footer */}
          <div 
            className="flex items-center justify-center px-4 py-4 bg-black/80"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            <button
              onClick={() => setViewingMedia(null)}
              className="px-6 py-3 bg-white/10 text-white rounded-full font-medium hover:bg-white/20 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
