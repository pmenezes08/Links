import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { formatSmartTime } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'

type Reply = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null }
type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null, replies: Reply[], can_edit?: boolean, can_delete?: boolean }

export default function GroupFeed(){
  const { group_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [groupName, setGroupName] = useState('Group')
  const [communityMeta, setCommunityMeta] = useState<{ id?: number|string, name?: string, type?: string } | null>(null)
  const [posts, setPosts] = useState<Post[]>([])

  useEffect(() => {
    const communityName = (communityMeta && (communityMeta as any).name) ? (communityMeta as any).name : ''
    const title = communityName ? `${groupName} · ${communityName}` : (groupName || 'Group')
    setTitle(title)
  }, [groupName, communityMeta, setTitle])

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
          setCommunityMeta(fj.community || null)
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
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      <div className="h-full max-w-2xl mx-auto overflow-y-auto no-scrollbar pb-28 px-3" style={{ WebkitOverflowScrolling: 'touch' as any, paddingTop: '12px' }}>
        <div className="space-y-3">
          {/* Back to communities (parent) and aligned header text */}
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10"
              onClick={()=> {
                const cid = (communityMeta as any)?.id
                if (cid) navigate(`/communities?parent_id=${cid}`)
                else navigate('/communities')
              }}
            >
              ← Back to Communities
            </button>
            <div className="ml-1 text-sm truncate">
              <span className="font-semibold mr-1 truncate inline-block max-w-[40vw] align-baseline">{groupName}</span>
              {communityMeta?.name ? (
                <span className="text-[#9fb0b5] text-[13px] align-baseline">{`· ${communityMeta.name}`}</span>
              ) : null}
            </div>
          </div>
          {/* Header removed; composer removed (use dedicated compose page) */}
          {posts.length === 0 ? (
            <div className="text-sm text-[#9fb0b5]">No posts yet.</div>
          ) : (
            posts.map(p => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer" onClick={()=> navigate(`/post/${p.id}`)}>
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                  <Avatar username={p.username} url={p.profile_picture || undefined} size={28} />
                  <div className="font-medium">{p.username}</div>
                  <div className="text-xs text-[#9fb0b5] ml-auto">{formatSmartTime((p as any).display_timestamp || p.timestamp)}</div>
                  {(p.can_edit || p.can_delete) ? (
                    <div className="ml-2 relative">
                      <button
                        className="p-1.5 rounded hover:bg-white/5"
                        aria-label="More"
                        onClick={(e)=> {
                          e.stopPropagation()
                          const menu = document.getElementById(`gp-menu-${p.id}`)
                          if (menu){
                            const visible = menu.style.display === 'block'
                            menu.style.display = visible ? 'none' : 'block'
                          }
                        }}
                      >
                        <i className="fa-solid fa-ellipsis" />
                      </button>
                      <div id={`gp-menu-${p.id}`} className="hidden absolute right-0 mt-1 w-32 rounded-md border border-white/10 bg-black shadow-lg z-50">
                        {p.can_edit ? (
                          <button className="w-full text-left px-3 py-2 text-sm hover:bg-white/5" onClick={async (e)=> {
                            e.stopPropagation()
                            const menu = document.getElementById(`gp-menu-${p.id}`); if (menu) menu.style.display = 'none'
                            const next = prompt('Edit post text:', p.content)
                            if (next === null) return
                            const fd = new URLSearchParams({ post_id: String(p.id), content: next })
                            const r = await fetch('/api/group_posts/edit', { method:'POST', credentials:'include', body: fd })
                            const j = await r.json().catch(()=>null)
                            if (j?.success){
                              setPosts(list => list.map(it => it.id === p.id ? ({ ...it, content: next }) : it))
                            } else {
                              alert(j?.error || 'Failed to edit')
                            }
                          }}>Edit</button>
                        ) : null}
                        {p.can_delete ? (
                          <button className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-white/5" onClick={async (e)=> {
                            e.stopPropagation()
                            const menu = document.getElementById(`gp-menu-${p.id}`); if (menu) menu.style.display = 'none'
                            if (!confirm('Delete this post?')) return
                            const fd = new URLSearchParams({ post_id: String(p.id) })
                            const r = await fetch('/api/group_posts/delete', { method:'POST', credentials:'include', body: fd })
                            const j = await r.json().catch(()=>null)
                            if (j?.success){ setPosts(list => list.filter(it => it.id !== p.id)) }
                            else { alert(j?.error || 'Failed to delete') }
                          }}>Delete</button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
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
                  {/* Reactions */}
                  <div className="flex items-center gap-2 text-xs pt-1">
                    {['heart','thumbs-up','thumbs-down'].map((rname) => (
                      <button key={rname} className="px-2 py-1 rounded transition-colors" onClick={async()=>{
                        try{
                          const form = new URLSearchParams({ post_id: String(p.id), reaction: rname })
                          const r = await fetch('/api/group_posts/react', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: form })
                          const j = await r.json().catch(()=>null)
                          if (j?.success){ setPosts(list => list.map(it => it.id===p.id ? ({ ...it, user_reaction: j.user_reaction, reactions: (()=>{ const nr = { ...(it.reactions||{}) }; Object.keys(nr).forEach(k=>{ if(k===rname) return; }); // adjust counts optimistically below
                            const prev = it.user_reaction; const out = { ...(it.reactions||{}) };
                            if (prev){ out[prev] = Math.max(0, (out[prev]||0)-1) }
                            if (j.user_reaction){ out[j.user_reaction] = (out[j.user_reaction]||0)+1 }
                            return out })() }) : it)) }
                          else alert(j?.error || 'Failed')
                        }catch{}
                      }}>
                        <i className={`fa-regular ${rname==='heart'?'fa-heart':(rname==='thumbs-up'?'fa-thumbs-up':'fa-thumbs-down')}`} style={{ color: p.user_reaction===rname ? '#4db6ac' : '#6c757d', WebkitTextStroke: p.user_reaction===rname ? '1px #4db6ac' : undefined }} />
                        <span className="ml-1" style={{ color: p.user_reaction===rname ? '#cfe9e7' : '#9fb0b5' }}>{(p.reactions?.[rname])||0}</span>
                      </button>
                    ))}
                  </div>
                  {/* Replies removed in feed; tap post card to open detail page to reply */}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {/* Bottom navigation bar like community feed (General) */}
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-40 w-[94%] max-w-[1200px] rounded-2xl border border-white/10 bg-black/80 backdrop-blur shadow-lg">
        <div className="h-14 px-6 flex items-center justify-between text-[#cfd8dc]">
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Home" onClick={()=> { try{ (document.scrollingElement || document.documentElement)?.scrollTo({ top: 0, behavior: 'smooth' }) }catch{} }}>
            <i className="fa-solid fa-house" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="Members" onClick={()=> communityMeta?.id ? navigate(`/community/${communityMeta.id}/members`) : navigate(-1)}>
            <i className="fa-solid fa-users" />
          </button>
          <button 
            className={`w-10 h-10 rounded-md bg-[#4db6ac] text-black hover:brightness-110 grid place-items-center`}
            aria-label="New Post" 
            onClick={()=> { navigate(`/compose?group_id=${group_id}`) }}
          >
            <i className="fa-solid fa-plus" />
          </button>
          <button className="relative p-2 rounded-full hover:bg-white/5" aria-label="Announcements" onClick={()=> alert('No announcements for groups yet')}>
            <span className="relative inline-block">
              <i className="fa-solid fa-bullhorn" />
            </span>
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" aria-label="More" onClick={()=> alert('More coming soon') }>
            <i className="fa-solid fa-ellipsis" />
          </button>
        </div>
      </div>
    </div>
  )
}

// no-op
