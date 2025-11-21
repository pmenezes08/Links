import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'

type PhotoItem = {
  id: string
  post_id: number
  reply_id: number | null
  username: string
  image_url: string
  created_at: string | number | Date
}

export default function CommunityPhotos(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [items, setItems] = useState<PhotoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const r = await fetch(`/api/community_photos?community_id=${community_id}`, { credentials:'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){ setItems(j.photos || []); setError(null) }
        else setError(j?.error || 'Failed to load photos')
      }catch{
        if (mounted) setError('Failed to load photos')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [community_id])

  // Group by date and format dates nicely
  const groups = useMemo(() => {
    const map: Record<string, PhotoItem[]> = {}
    for (const it of items){
      const parsedDate = parseFlexibleDate(it.created_at)
      let dateKey = 'Unknown Date'

      if (parsedDate && !isNaN(parsedDate.getTime())) {
        dateKey = parsedDate.toISOString().split('T')[0] // YYYY-MM-DD format
      }

      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(it)
    }

    // Sort groups by date desc, items by time desc
    const keys = Object.keys(map).sort((a,b) => {
      if (a === 'Unknown Date') return 1
      if (b === 'Unknown Date') return -1
      return a < b ? 1 : -1
    })

    for (const k of keys){
      if (k !== 'Unknown Date') {
        map[k].sort((a,b) => {
          const dateA = parseFlexibleDate(a.created_at)
          const dateB = parseFlexibleDate(b.created_at)
          if (!dateA && !dateB) return 0
          if (!dateA) return 1
          if (!dateB) return -1
          return dateA.getTime() - dateB.getTime()
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
    <div className="h-screen overflow-hidden bg-black text-white">
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(`/community_feed_react/${community_id}`)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="text-sm font-medium">Photos</div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-3 pt-28 pb-24 h-full overflow-y-auto">
        {items.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-[#9fb0b5] mb-4">
              <i className="fa-solid fa-camera text-4xl mb-3 block opacity-50"></i>
              <p className="text-lg font-medium">No photos yet</p>
              <p className="text-sm">Photos from community posts will appear here</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.keys.map((formattedDateKey, index) => {
              const originalDateKey = groups.originalKeys[index]
              const photosForDate = groups.map[originalDateKey] || []

              return (
                <div key={formattedDateKey} className="space-y-3">
                  <div className="text-sm text-[#9fb0b5] font-medium border-b border-white/10 pb-2">
                    {formattedDateKey} ({photosForDate.length} photo{photosForDate.length !== 1 ? 's' : ''})
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {photosForDate.map(p => (
                      <div key={p.id} className="relative group aspect-square">
                        <img
                          src={p.image_url}
                          alt="Community photo"
                          className="w-full h-full object-cover rounded-lg border border-white/10 cursor-pointer hover:border-white/20 transition-colors"
                          onClick={() => navigate(`/post/${p.post_id}`)}
                        />
                        <div className="absolute bottom-2 left-2 text-xs px-2 py-1 rounded bg-black/70 border border-white/10 text-white">
                          {formatSmartTime(p.created_at)}
                        </div>
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            className="px-2 py-1 text-xs rounded bg-black/60 border border-white/10 hover:bg-black/80"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/post/${p.post_id}`)
                            }}
                          >
                            View
                          </button>
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
    </div>
  )
}
