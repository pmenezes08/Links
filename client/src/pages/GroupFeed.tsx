import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { formatSmartTime } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'

type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null }

export default function GroupFeed(){
  const { group_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [groupName, setGroupName] = useState('Group')
  const [posts, setPosts] = useState<Post[]>([])

  useEffect(() => { setTitle(groupName ? `${groupName}` : 'Group') }, [groupName, setTitle])

  useEffect(() => {
    let ok = true
    async function load(){
      if (!group_id) return
      setLoading(true)
      try{
        const feedResp = await fetch(`/api/group_feed?group_id=${group_id}`, { credentials:'include' })
        const fj = await feedResp.json().catch(()=>null)
        if (!ok) return
        if (fj?.success){
          setGroupName(fj.group?.name || 'Group')
          setPosts(fj.posts || [])
          setError(null)
        } else {
          setError(fj?.error || 'Failed to load group')
        }
      }catch{ if (ok) setError('Failed to load group') }
      finally { if (ok) setLoading(false) }
    }
    load(); return ()=> { ok = false }
  }, [group_id])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(-1)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="font-semibold">{groupName}</div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto pt-[70px] px-3 pb-16">
        {posts.length === 0 ? (
          <div className="text-sm text-[#9fb0b5]">No posts yet.</div>
        ) : (
          <div className="space-y-3">
            {posts.map(p => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer" onClick={()=> navigate(`/post/${p.id}`)}>
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                  <Avatar username={p.username} url={p.profile_picture || undefined} size={28} />
                  <div className="font-medium">{p.username}</div>
                  <div className="text-xs text-[#9fb0b5] ml-auto">{formatSmartTime((p as any).display_timestamp || p.timestamp)}</div>
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
