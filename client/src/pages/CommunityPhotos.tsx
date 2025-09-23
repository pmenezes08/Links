import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatSmartTime } from '../utils/time'

type PhotoItem = {
  id: string
  post_id: number
  reply_id: number | null
  username: string
  image_url: string
  created_at: string
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

  // Group by date (YYYY-MM-DD)
  const groups = useMemo(() => {
    const map: Record<string, PhotoItem[]> = {}
    for (const it of items){
      const d = (it.created_at || '').slice(0,10)
      if (!map[d]) map[d] = []
      map[d].push(it)
    }
    // Sort groups by date desc, items by time desc
    const keys = Object.keys(map).sort((a,b) => (a < b ? 1 : -1))
    for (const k of keys){ map[k].sort((a,b) => (a.created_at < b.created_at ? 1 : -1)) }
    return { keys, map }
  }, [items])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-3 pt-4 pb-24">
        {groups.keys.length === 0 ? (
          <div className="text-[#9fb0b5]">No photos yet.</div>
        ) : groups.keys.map(dateKey => (
          <div key={dateKey} className="mb-6">
            <div className="text-xs text-[#9fb0b5] mb-2">{dateKey}</div>
            <div className="grid grid-cols-3 gap-2">
              {(groups.map[dateKey] || []).map(p => (
                <div key={p.id} className="relative group">
                  <img src={p.image_url} alt="Community photo" className="w-full h-28 object-cover rounded-md border border-white/10 cursor-pointer" onClick={()=> navigate(`/post/${p.post_id}`)} />
                  <div className="absolute bottom-1 left-1 text-[10px] px-1 py-0.5 rounded bg-black/60 border border-white/10">
                    {formatSmartTime(p.created_at)}
                  </div>
                  <button className="absolute top-1 right-1 text-[10px] px-1 py-0.5 rounded bg-black/60 border border-white/10 hover:bg-black/80" onClick={(e)=> { e.stopPropagation(); navigate(`/post/${p.post_id}`) }}>
                    View post
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

