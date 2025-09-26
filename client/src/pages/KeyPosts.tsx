import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { formatSmartTime } from '../utils/time'

type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null; is_starred?: boolean }

export default function KeyPosts(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)

  useEffect(() => {
    let ok = true
    async function load(){
      setLoading(true)
      try{
        const r = await fetch(`/api/key_posts?community_id=${community_id}`, { credentials:'include' })
        const j = await r.json().catch(()=>null)
        if (!ok) return
        if (j?.success) setPosts(j.posts || [])
        else setError(j?.error || 'Error')
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
      <div className="max-w-2xl mx-auto pt-14 px-3 pb-16">
        <div className="mb-3 flex items-center">
          <button className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10" onClick={()=> navigate(-1)}>
            ← Back
          </button>
          <div className="ml-auto font-semibold">Key Posts</div>
        </div>
        {posts.length === 0 ? (
          <div className="text-sm text-[#9fb0b5]">No key posts yet. Star posts in the feed to see them here.</div>
        ) : (
          <div className="space-y-3">
            {posts.map(p => (
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
        )}
      </div>
    </div>
  )
}

