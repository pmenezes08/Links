import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { formatSmartTime } from '../utils/time'

type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null; is_starred?: boolean }

export default function KeyPosts(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'community'|'yours'>('community')
  const [communityPosts, setCommunityPosts] = useState<Post[]>([])
  const [yourPosts, setYourPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)

  useEffect(() => {
    let ok = true
    async function load(){
      setLoading(true)
      try{
        const [rc, ry] = await Promise.all([
          fetch(`/api/community_key_posts?community_id=${community_id}`, { credentials:'include' }),
          fetch(`/api/key_posts?community_id=${community_id}`, { credentials:'include' })
        ])
        const jc = await rc.json().catch(()=>null)
        const jy = await ry.json().catch(()=>null)
        if (!ok) return
        if (jc?.success) setCommunityPosts(jc.posts || [])
        if (jy?.success) setYourPosts(jy.posts || [])
        if (!jc?.success && !jy?.success) setError(jc?.error || jy?.error || 'Error')
      }catch{
        if (ok) setError('Error loading key posts')
      } finally {
        if (ok) setLoading(false)
      }
    }
    load()
    return ()=> { ok = false }
  }, [community_id])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(-1)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='community' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('community')}>
              <div className="pt-2">Community</div>
              <div className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${activeTab==='community' ? 'bg-[#ffd54f]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='yours' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('yours')}>
              <div className="pt-2">Yours</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='yours' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto pt-[70px] px-3 pb-16">
        <div className="mb-3 flex items-center">
          <button className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10" onClick={()=> navigate(-1)}>
            ← Back
          </button>
          <div className="ml-auto font-semibold">Key Posts</div>
        </div>
        {activeTab === 'community' ? (
          communityPosts.length === 0 ? (
            <div className="text-sm text-[#9fb0b5]">No community key posts yet.</div>
          ) : (
            <div className="space-y-3">
              {communityPosts.map(p => (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer" onClick={()=> navigate(`/post/${p.id}`)}>
                  <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                    <Avatar username={p.username} url={p.profile_picture || undefined} size={28} />
                    <div className="font-medium">{p.username}</div>
                    <div className="text-xs text-[#9fb0b5] ml-auto">{formatSmartTime((p as any).display_timestamp || p.timestamp)}</div>
                    <i className="fa-solid fa-star" style={{ color:'#ffd54f' }} />
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{p.content}</div>
                    {p.image_path ? (
                      <ImageLoader
                        src={(() => {
                          const ip = String(p.image_path || '').trim()
                          if (!ip) return ''
                          if (ip.startsWith('http')) return ip
                          if (ip.startsWith('/uploads') || ip.startsWith('/static')) return ip
                          return ip.startsWith('uploads') || ip.startsWith('static') ? `/${ip}` : `/uploads/${ip}`
                        })()}
                        alt="Post image"
                        className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10"
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          yourPosts.length === 0 ? (
            <div className="text-sm text-[#9fb0b5]">No starred posts yet. Tap the turquoise star on posts to add them here.</div>
          ) : (
            <div className="space-y-3">
              {yourPosts.map(p => (
                <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer" onClick={()=> navigate(`/post/${p.id}`)}>
                  <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                    <Avatar username={p.username} url={p.profile_picture || undefined} size={28} />
                    <div className="font-medium">{p.username}</div>
                    <div className="text-xs text-[#9fb0b5] ml-auto">{formatSmartTime((p as any).display_timestamp || p.timestamp)}</div>
                    <i className="fa-solid fa-star" style={{ color:'#4db6ac' }} />
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{p.content}</div>
                    {p.image_path ? (
                      <ImageLoader
                        src={(() => {
                          const ip = String(p.image_path || '').trim()
                          if (!ip) return ''
                          if (ip.startsWith('http')) return ip
                          if (ip.startsWith('/uploads') || ip.startsWith('/static')) return ip
                          return ip.startsWith('uploads') || ip.startsWith('static') ? `/${ip}` : `/uploads/${ip}`
                        })()}
                        alt="Post image"
                        className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10"
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

