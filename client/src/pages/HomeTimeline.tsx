import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; community_id?:number|null; community_name?:string; reactions:Record<string,number>; user_reaction:string|null; poll?:any|null; replies_count?:number; profile_picture?:string|null }

function formatTimestamp(input: string): string {
  const d = new Date(input.replace(' ', 'T'))
  if (isNaN(d.getTime())) return input
  const now = new Date()
  const diff = Math.max(0, now.getTime() - d.getTime())
  const m = 60*1000, h = 60*m, day = 24*h
  if (diff < h) return `${Math.floor(diff/m)}m`
  if (diff < day) return `${Math.floor(diff/h)}h`
  const days = Math.floor(diff/day); if (days < 10) return `${days}d`
  const mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0'), yy = String(d.getFullYear()%100).padStart(2,'0')
  return `${mm}/${dd}/${yy}`
}

export default function HomeTimeline(){
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/static/styles.css'
    document.head.appendChild(link)
    return () => { document.head.removeChild(link) }
  }, [])

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const r = await fetch('/api/home_timeline', { credentials:'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){ setData(j) } else { setError(j?.error || 'Error') }
      }catch{ if (mounted) setError('Error loading') } finally { if (mounted) setLoading(false) }
    }
    load()
    return () => { mounted = false }
  }, [])

  const posts: Post[] = useMemo(() => data?.posts || [], [data])

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#262f30] bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="mr-3 md:hidden" onClick={() => navigate('/premium_dashboard')} aria-label="Menu">
          <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden">
            {data?.current_user_profile_picture ? (
              <img src={(data.current_user_profile_picture.startsWith('http') || data.current_user_profile_picture.startsWith('/static')) ? data.current_user_profile_picture : `/static/${data.current_user_profile_picture}`} alt="" className="w-full h-full object-cover" />
            ) : (<i className="fa-solid fa-user" />)}
          </div>
        </button>
        <div className="font-semibold truncate tracking-[-0.01em] flex-1">Home</div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> window.location.href = `/user_chat`} aria-label="Messages">
            <i className="fa-solid fa-cloud" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> window.location.href = `/notifications`} aria-label="Notifications">
            <i className="fa-regular fa-bell" />
          </button>
        </div>
      </div>

      {/* Secondary tabs */}
      <div className="fixed left-0 right-0 top-14 h-10 border-b border-[#262f30] bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex">
          <button className="flex-1 text-center text-sm font-medium text-white/95">
            <div className="pt-2">Home timeline</div>
            <div className="h-0.5 bg-[#4db6ac] rounded-full w-16 mx-auto mt-1" />
          </button>
          <button className="flex-1 text-center text-sm font-medium text-[#9fb0b5] hover:text-white/90" onClick={()=> navigate('/communities')}>
            <div className="pt-2">Communities</div>
            <div className="h-0.5 bg-transparent rounded-full w-16 mx-auto mt-1" />
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto pt-24 pb-24 px-3">
        {loading ? (
          <div className="p-3 text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="p-3 text-red-400">{error}</div>
        ) : posts.length === 0 ? (
          <div className="p-3 text-[#9fb0b5]">No recent posts in the last 48h.</div>
        ) : (
          <div className="space-y-3">
            {posts.map(p => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.035] shadow-sm shadow-black/20">
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden">
                    {p.profile_picture ? (
                      <img src={(p.profile_picture.startsWith('http') || p.profile_picture.startsWith('/static')) ? p.profile_picture : `/static/${p.profile_picture}`} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="font-medium tracking-[-0.01em] truncate">{p.username}</div>
                  <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatTimestamp(p.timestamp)}</div>
                </div>
                <div className="px-3 py-2 space-y-2">
                  {p.community_name ? (
                    <div className="text-xs text-[#9fb0b5]">in {p.community_name}</div>
                  ) : null}
                  <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{p.content}</div>
                  {p.image_path ? (
                    <img src={p.image_path.startsWith('/uploads') || p.image_path.startsWith('/static') ? p.image_path : `/uploads/${p.image_path}`} alt="" className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10" />
                  ) : null}
                  <div className="flex items-center gap-3 text-xs">
                    <button className="ml-auto px-2.5 py-1 rounded-full text-[#cfd8dc]" onClick={()=> navigate(`/post/${p.id}`)}>
                      <i className="fa-regular fa-comment" />
                      <span className="ml-1">{p.replies_count||0}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

