import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import { formatSmartTime } from '../utils/time'
import ImageLoader from '../components/ImageLoader'
import VideoEmbed from '../components/VideoEmbed'
import { extractVideoEmbed, removeVideoUrlFromText } from '../utils/videoEmbed'

type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; display_timestamp?:string; community_id?:number|null; community_name?:string; reactions:Record<string,number>; user_reaction:string|null; poll?:any|null; replies_count?:number; profile_picture?:string|null }

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
              <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer" onClick={() => navigate(`/post/${p.id}`)}>
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
                  <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatSmartTime(p.display_timestamp || p.timestamp)}</div>
                </div>
                <div className="py-2 space-y-2">
                  {(() => {
                    const videoEmbed = extractVideoEmbed(p.content)
                    const displayContent = videoEmbed ? removeVideoUrlFromText(p.content, videoEmbed) : p.content
                    return (
                      <>
                        {displayContent && <div className="px-3 whitespace-pre-wrap text-[14px] leading-relaxed">{displayContent}</div>}
                        {videoEmbed && <VideoEmbed embed={videoEmbed} />}
                      </>
                    )
                  })()}
                  {p.image_path ? (
                    <ImageLoader
                      src={(() => {
                        const ip = p.image_path as string
                        if (!ip) return ''
                        if (ip.startsWith('http')) return ip
                        if (ip.startsWith('/uploads') || ip.startsWith('/static')) return ip
                        return ip.startsWith('uploads') ? `/${ip}` : `/uploads/${ip}`
                      })()}
                      alt="Post image"
                      className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10 px-3"
                    />
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

