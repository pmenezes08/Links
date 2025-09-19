import { useEffect, useMemo, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'

type PReply = { id:number; post_id:number; username:string; content:string; created_at:string }
type PPost = { id:number; username:string; content:string; created_at:string; replies:PReply[] }

export default function ProductDevelopment(){
  const { setTitle } = useHeader()
  const [tab, setTab] = useState<'updates'|'feedback'>('updates')
  const [posts, setPosts] = useState<PPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [me, setMe] = useState<string>('')
  const [composer, setComposer] = useState('')
  useEffect(()=> setTitle('Product Development'), [setTitle])

  useEffect(()=>{
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const rme = await fetch('/api/home_timeline', { credentials:'include' })
        const jme = await rme.json().catch(()=>null)
        if (jme?.success && jme.username) setMe(jme.username)
      }catch{}
      try{
        const r = await fetch(`/api/product_posts?section=${tab}`, { credentials:'include' })
        const j = await r.json().catch(()=>null)
        if (!mounted) return
        if (j?.success) setPosts(j.posts || [])
        else setError(j?.error||'Error')
      }catch{ if (mounted) setError('Error') }
      finally{ if (mounted) setLoading(false) }
    }
    load()
    return () => { mounted = false }
  }, [tab])

  const canPostUpdates = useMemo(()=> ['admin','Paulo','paulo'].includes((me||'').toLowerCase()), [me])

  async function createPost(){
    if (!composer.trim()) return
    try{
      const fd = new FormData()
      fd.append('section', tab)
      fd.append('content', composer.trim())
      const r = await fetch('/api/product_post', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){ setPosts(p=> [j.post, ...p]); setComposer('') }
      else alert(j?.error || 'Failed')
    }catch{ alert('Network error') }
  }

  async function addReply(postId:number, text:string){
    if (!text.trim()) return
    try{
      const fd = new FormData()
      fd.append('post_id', String(postId))
      fd.append('content', text.trim())
      const r = await fetch('/api/product_reply', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        setPosts(p => p.map(pp => pp.id===postId ? { ...pp, replies: [j.reply, ...pp.replies] } : pp))
      } else alert(j?.error || 'Failed')
    }catch{ alert('Network error') }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="pt-14 max-w-2xl mx-auto px-3">
        <div className="sticky top-14 z-10 bg-black/90 backdrop-blur border-b border-white/10">
          <div className="flex items-center gap-3">
            <button className={`px-3 py-2 ${tab==='updates'?'text-[#4db6ac]':''}`} onClick={()=> setTab('updates')}>Product Updates</button>
            <button className={`px-3 py-2 ${tab==='feedback'?'text-[#4db6ac]':''}`} onClick={()=> setTab('feedback')}>Product Feedback/Requests</button>
          </div>
        </div>

        {/* Composer */}
        <div className="mt-3 rounded-xl border border-white/10 bg-black p-3">
          {tab==='updates' ? (
            canPostUpdates ? (
              <div className="space-y-2">
                <textarea className="w-full rounded-md bg-black border border-white/10 px-2 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" rows={3} value={composer} onChange={(e)=> setComposer(e.target.value)} placeholder="Share an update..." />
                <div className="text-right">
                  <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black" onClick={createPost}>Post Update</button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-[#9fb0b5]">Only Admin or Paulo can post updates here. You can reply to updates below.</div>
            )
          ) : (
            <div className="space-y-2">
              <textarea className="w-full rounded-md bg-black border border-white/10 px-2 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" rows={3} value={composer} onChange={(e)=> setComposer(e.target.value)} placeholder="Share feedback or a request..." />
              <div className="text-right">
                <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black" onClick={createPost}>Post</button>
              </div>
            </div>
          )}
        </div>

        {/* Posts */}
        <div className="mt-3 space-y-3">
          {loading ? (<div className="text-[#9fb0b5]">Loading…</div>) : error ? (<div className="text-red-400">{error}</div>) : (
            posts.length ? posts.map(p => (
              <PostCard key={p.id} post={p} onReply={addReply} />
            )) : (<div className="text-[#9fb0b5] text-sm">No posts yet.</div>)
          )}
        </div>
      </div>
    </div>
  )
}

function PostCard({ post, onReply }:{ post:PPost; onReply:(postId:number, text:string)=>void }){
  const [replyText, setReplyText] = useState('')
  return (
    <div className="rounded-2xl border border-white/10 bg-black">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <div className="font-medium">{post.username}</div>
        <div className="text-xs text-[#9fb0b5] ml-auto">{post.created_at}</div>
      </div>
      <div className="px-3 py-2">
        <div className="whitespace-pre-wrap text-[14px] break-words">{post.content}</div>
      </div>
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2">
          <input className="flex-1 px-3 py-1.5 rounded-full bg-black border border-white/10 text-[14px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={replyText} onChange={(e)=> setReplyText(e.target.value)} placeholder="Reply..." />
          <button className="px-2.5 py-1.5 rounded-full bg-[#4db6ac] text-black border border-[#4db6ac]" onClick={()=> { if (!replyText.trim()) return; onReply(post.id, replyText); setReplyText('') }}>Send</button>
        </div>
        {post.replies?.length ? (
          <div className="mt-2 space-y-2">
            {post.replies.map(r => (
              <div key={r.id} className="px-2 py-1.5 rounded-lg border border-white/10 bg-black/60">
                <div className="text-xs text-[#9fb0b5]">{r.username} • {r.created_at}</div>
                <div className="text-sm whitespace-pre-wrap break-words">{r.content}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

