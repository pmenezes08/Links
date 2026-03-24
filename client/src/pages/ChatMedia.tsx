import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'
import ZoomableImage from '../components/ZoomableImage'
import { normalizeMediaPath } from '../chat'

type MediaItem = {
  id: number
  message_id: number
  sender: string
  url: string
  type: 'image' | 'video'
  created_at: string | number | Date
}

export default function ChatMedia() {
  const { username } = useParams()
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
        const r = await fetch(`/api/chat/media?peer=${encodeURIComponent(username || '')}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) { setItems(j.media || []); setError(null) }
        else setError(j?.error || 'Failed to load media')
      } catch { if (mounted) setError('Failed to load media') }
      finally { if (mounted) setLoading(false) }
    }
    load()
    return () => { mounted = false }
  }, [username])

  const groups = useMemo(() => {
    const map: Record<string, MediaItem[]> = {}
    for (const it of items) {
      const d = parseFlexibleDate(it.created_at)
      const key = d && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : 'Unknown Date'
      if (!map[key]) map[key] = []
      map[key].push(it)
    }
    const keys = Object.keys(map).sort((a, b) => a === 'Unknown Date' ? 1 : b === 'Unknown Date' ? -1 : a < b ? 1 : -1)
    const formatted = keys.map(k => {
      if (k === 'Unknown Date') return k
      const d = parseFlexibleDate(k)
      if (!d || isNaN(d.getTime())) return 'Unknown Date'
      const today = new Date()
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
      if (d.toDateString() === today.toDateString()) return 'Today'
      if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    })
    return { keys: formatted, map, originalKeys: keys }
  }, [items])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading...</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40 border-b border-white/10"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}>
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={() => navigate(-1)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 font-medium">Media</div>
          <div className="text-sm text-[#9fb0b5]">{items.length} item{items.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div className="app-subnav-offset max-w-2xl mx-auto pb-20 px-3 overflow-y-auto no-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch' as any, minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))', '--app-subnav-height': '40px' } as CSSProperties}>
        {items.length === 0 ? (
          <div className="text-center py-12">
            <i className="fa-solid fa-photo-film text-4xl mb-3 block opacity-50 text-[#9fb0b5]" />
            <p className="text-lg font-medium text-[#9fb0b5]">No media yet</p>
            <p className="text-sm text-[#9fb0b5]">Photos and videos shared in this chat will appear here</p>
          </div>
        ) : (
          <div className="space-y-8 pt-4">
            {groups.keys.map((label, index) => {
              const mediaForDate = groups.map[groups.originalKeys[index]] || []
              return (
                <div key={label} className="space-y-3">
                  <div className="text-sm text-[#9fb0b5] font-medium border-b border-white/10 pb-2">{label} ({mediaForDate.length})</div>
                  <div className="grid grid-cols-3 gap-2">
                    {mediaForDate.map(m => (
                      <div key={m.id} className="relative group aspect-square cursor-pointer"
                        onClick={() => setViewingMedia({ url: normalizeMediaPath(m.url), type: m.type })}>
                        {m.type === 'video' ? (
                          <>
                            <video src={normalizeMediaPath(m.url) + '#t=0.1'} className="w-full h-full object-cover rounded-lg border border-white/10" muted playsInline preload="metadata" />
                            <div className="absolute inset-0 flex items-center justify-center"><div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center"><i className="fa-solid fa-play text-white text-sm ml-0.5" /></div></div>
                          </>
                        ) : (
                          <img src={normalizeMediaPath(m.url)} alt="" className="w-full h-full object-cover rounded-lg border border-white/10" />
                        )}
                        <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-white/80">{formatSmartTime(m.created_at)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {viewingMedia && (
        <div className="fixed inset-0 bg-black z-[9999] flex flex-col" onClick={() => setViewingMedia(null)}>
          <div className="flex items-center justify-between px-4 py-3 bg-black/80" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
            <button onClick={() => setViewingMedia(null)} className="text-white p-2 -ml-2"><i className="fa-solid fa-xmark text-xl" /></button>
            <span className="text-white font-medium">{viewingMedia.type === 'video' ? 'Video' : 'Photo'}</span>
            <div className="w-8" />
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden" onClick={e => e.stopPropagation()}>
            {viewingMedia.type === 'video' ? (
              <video src={viewingMedia.url} controls autoPlay playsInline className="max-w-full max-h-full" />
            ) : (
              <ZoomableImage src={viewingMedia.url} alt="Media" className="w-full h-full" onRequestClose={() => setViewingMedia(null)} />
            )}
          </div>
          <div className="flex items-center justify-center px-4 py-4 bg-black/80" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
            <button onClick={() => setViewingMedia(null)} className="px-6 py-3 bg-white/10 text-white rounded-full font-medium hover:bg-white/20 transition">Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
