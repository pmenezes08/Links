import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; community_id?:number|null; community_name?:string; reactions:Record<string,number>; user_reaction:string|null; poll?:any|null; replies_count?:number; profile_picture?:string|null }

function formatTimestamp(input: string): string {
  function parseDate(str: string): Date | null {
    if (/^\d{10,13}$/.test(str.trim())){
      const n = Number(str)
      const d = new Date(n > 1e12 ? n : n * 1000)
      return isNaN(d.getTime()) ? null : d
    }
    let d = new Date(str)
    if (!isNaN(d.getTime())) return d
    d = new Date(str.replace(' ', 'T'))
    if (!isNaN(d.getTime())) return d
    const mdyDots = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}) (\d{1,2}):(\d{2})$/)
    if (mdyDots){
      const mm = Number(mdyDots[1])
      const dd = Number(mdyDots[2])
      const yy = Number(mdyDots[3])
      const HH = Number(mdyDots[4])
      const MM = Number(mdyDots[5])
      const year = 2000 + yy
      const dt = new Date(year, mm - 1, dd, HH, MM)
      return isNaN(dt.getTime()) ? null : dt
    }
    const mdySlashAm = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/i)
    if (mdySlashAm){
      const mm = Number(mdySlashAm[1])
      const dd = Number(mdySlashAm[2])
      const yy = Number(mdySlashAm[3])
      let hh = Number(mdySlashAm[4])
      const MM = Number(mdySlashAm[5])
      const ampm = mdySlashAm[6].toUpperCase()
      if (ampm === 'PM' && hh < 12) hh += 12
      if (ampm === 'AM' && hh === 12) hh = 0
      const year = 2000 + yy
      const dt = new Date(year, mm - 1, dd, hh, MM)
      return isNaN(dt.getTime()) ? null : dt
    }
    const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (ymd){
      const year = Number(ymd[1])
      const mm = Number(ymd[2])
      const dd = Number(ymd[3])
      const HH = Number(ymd[4])
      const MM = Number(ymd[5])
      const SS = ymd[6] ? Number(ymd[6]) : 0
      const dt = new Date(year, mm - 1, dd, HH, MM, SS)
      return isNaN(dt.getTime()) ? null : dt
    }
    return null
  }

  const date = parseDate(input)
  if (!date) return input
  const now = new Date()
  let diffMs = now.getTime() - date.getTime()
  if (diffMs < 0) diffMs = 0
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  if (diffMs < hourMs){
    const mins = Math.floor(diffMs / minuteMs)
    return `${mins}m`
  }
  if (diffMs < dayMs){
    const hours = Math.floor(diffMs / hourMs)
    return `${hours}h`
  }
  const days = Math.floor(diffMs / dayMs)
  if (days < 10){
    return `${days}d`
  }
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yy = String(date.getFullYear() % 100).padStart(2, '0')
  return `${mm}/${dd}/${yy}`
}

export default function HomeTimeline(){
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)

  useEffect(() => {
    let link = document.getElementById('legacy-styles') as HTMLLinkElement | null
    if (!link){
      link = document.createElement('link')
      link.id = 'legacy-styles'
      link.rel = 'stylesheet'
      link.href = '/static/styles.css'
      document.head.appendChild(link)
    }
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
  const { setTitle } = useHeader()

  useEffect(() => { setTitle('Home') }, [setTitle])

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Global header used from App */}

      {/* Secondary tabs */}
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex">
          <button type="button" className="flex-1 text-center text-sm font-medium text-white/95">
            <div className="pt-2">Home timeline</div>
            <div className="h-0.5 bg-[#4db6ac] rounded-full w-16 mx-auto mt-1" />
          </button>
          <button type="button" className="flex-1 text-center text-sm font-medium text-[#9fb0b5] hover:text-white/90" onClick={()=> navigate('/communities')}>
            <div className="pt-2">Communities</div>
            <div className="h-0.5 bg-transparent rounded-full w-16 mx-auto mt-1" />
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto pt-12 pb-24 px-3">
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

