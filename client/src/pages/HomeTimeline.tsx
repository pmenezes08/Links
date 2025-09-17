import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; display_timestamp?:string; community_id?:number|null; community_name?:string; reactions:Record<string,number>; user_reaction:string|null; poll?:any|null; replies_count?:number; profile_picture?:string|null }

function formatTimestamp(input: string): string {
  function parseDate(str: string): Date | null {
    if (!str) return null
    const s = String(str).trim()
    if (s.startsWith('0000-00-00')) return null
    if (/^\d{10,13}$/.test(s)){ const n = Number(s); const d = new Date(n > 1e12 ? n : n * 1000); return isNaN(d.getTime()) ? null : d }
    let d = new Date(s); if (!isNaN(d.getTime())) return d
    d = new Date(s.replace(' ', 'T')); if (!isNaN(d.getTime())) return d
    const mdyDots = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}) (\d{1,2}):(\d{2})$/)
    if (mdyDots){ const dt = new Date(2000+Number(mdyDots[3]), Number(mdyDots[1])-1, Number(mdyDots[2]), Number(mdyDots[4]), Number(mdyDots[5])); return isNaN(dt.getTime()) ? null : dt }
    const mdySlashAm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/i)
    if (mdySlashAm){ let hh = Number(mdySlashAm[4]); const MM = Number(mdySlashAm[5]); const ampm = mdySlashAm[6].toUpperCase(); if (ampm==='PM'&&hh<12) hh+=12; if (ampm==='AM'&&hh===12) hh=0; const dt = new Date(2000+Number(mdySlashAm[3]), Number(mdySlashAm[1])-1, Number(mdySlashAm[2]), hh, MM); return isNaN(dt.getTime()) ? null : dt }
    const dmyDash = s.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
    if (dmyDash){ const dd = Number(dmyDash[1]), mm = Number(dmyDash[2]), yyyy = Number(dmyDash[3]); const HH = dmyDash[4]?Number(dmyDash[4]):0; const MM = dmyDash[5]?Number(dmyDash[5]):0; const SS = dmyDash[6]?Number(dmyDash[6]):0; const dt = new Date(yyyy, mm-1, dd, HH, MM, SS); return isNaN(dt.getTime()) ? null : dt }
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (ymd){ const dt = new Date(Number(ymd[1]), Number(ymd[2])-1, Number(ymd[3]), Number(ymd[4]), Number(ymd[5]), ymd[6]?Number(ymd[6]):0); return isNaN(dt.getTime()) ? null : dt }
    return null
  }
  const date = parseDate(input)
  if (!date) return input
  const dd = String(date.getDate()).padStart(2,'0')
  const mm = String(date.getMonth()+1).padStart(2,'0')
  const yyyy = String(date.getFullYear())
  return `${dd}-${mm}-${yyyy}`
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
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      {/* Secondary header below global header */}

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

      <div className="h-full max-w-2xl mx-auto overflow-y-auto px-3 pb-24" style={{ WebkitOverflowScrolling: 'touch' as any, paddingTop: '40px' }}>
        {loading ? (
          <div className="p-3 text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="p-3 text-red-400">{error}</div>
        ) : posts.length === 0 ? (
          <div className="p-3 text-[#9fb0b5]">No recent posts in the last 48h.</div>
        ) : (
          <div className="space-y-3">
            {posts.map(p => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.035] shadow-sm shadow-black/20 cursor-pointer" onClick={() => navigate(`/post/${p.id}`)}>
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2" onClick={(e)=> e.stopPropagation()}>
                  <Avatar username={p.username} url={p.profile_picture || undefined} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <div className="font-medium tracking-[-0.01em] truncate">{p.username}</div>
                      {p.community_name ? (
                        <div className="text-xs text-[#9fb0b5] truncate">in {p.community_name}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatTimestamp(p.display_timestamp || p.timestamp)}</div>
                </div>
                <div className="px-3 py-2 space-y-2">
                  <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{p.content}</div>
                  {p.image_path ? (
                    <img src={p.image_path.startsWith('/uploads') || p.image_path.startsWith('/static') ? p.image_path : `/uploads/${p.image_path}`} alt="" className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10" />
                  ) : null}
                  <div className="flex items-center gap-3 text-xs">
                    <button className="ml-auto px-2.5 py-1 rounded-full text-[#cfd8dc]" onClick={(e)=> { e.stopPropagation(); navigate(`/post/${p.id}`) }}>
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

