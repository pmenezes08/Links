import { useEffect, useMemo, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'

type PReply = { id:number; post_id:number; username:string; content:string; created_at:string }
type PPost = { id:number; username:string; content:string; created_at:string; replies:PReply[] }

type Poll = { id:number; username:string; question:string; options:string[]; created_at:string, closed?: boolean, allow_multiple?: boolean, option_counts?: number[] }

// Helpers implemented below in component scope

export default function ProductDevelopment(){
  const { setTitle } = useHeader()
  const [tab, setTab] = useState<'updates'|'feedback'|'polls'>('updates')
  const [posts, setPosts] = useState<PPost[]>([])
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [me, setMe] = useState<string>('')
  const [composer, setComposer] = useState('')
  const [pollQ, setPollQ] = useState('')
  const [pollOpts, setPollOpts] = useState<string[]>(['',''])
  const [notifyAll, setNotifyAll] = useState(false)
  const [allowMultiple, setAllowMultiple] = useState(false)
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
        if (tab === 'polls'){
          const rp = await fetch('/api/product_polls', { credentials:'include' })
          const jp = await rp.json().catch(()=>null)
          if (!mounted) return
          if (jp?.success) setPolls(jp.polls||[])
          else setError(jp?.error||'Error')
        } else {
          const r = await fetch(`/api/product_posts?section=${tab}`, { credentials:'include' })
          const j = await r.json().catch(()=>null)
          if (!mounted) return
          if (j?.success) setPosts(j.posts || [])
          else setError(j?.error||'Error')
        }
      }catch{ if (mounted) setError('Error') }
      finally{ if (mounted) setLoading(false) }
    }
    load()
    return () => { mounted = false }
  }, [tab])

  const canPostUpdates = useMemo(()=> ['admin','paulo'].includes((me||'').toLowerCase()), [me])

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

  async function editPost(postId:number, content:string){
    const fd = new FormData()
    fd.append('post_id', String(postId))
    fd.append('content', content)
    const r = await fetch('/api/product_post_edit', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setPosts(ps => ps.map(p => p.id===postId ? { ...p, content } : p)) }
    else alert(j?.error || 'Failed')
  }

  async function deletePost(postId:number){
    if (!confirm('Delete this post?')) return
    const fd = new FormData()
    fd.append('post_id', String(postId))
    const r = await fetch('/api/product_post_delete', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setPosts(ps => ps.filter(p => p.id !== postId)) }
    else alert(j?.error || 'Failed')
  }

  async function editReply(replyId:number, content:string){
    const fd = new FormData()
    fd.append('reply_id', String(replyId))
    fd.append('content', content)
    const r = await fetch('/api/product_reply_edit', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setPosts(ps => ps.map(p => ({ ...p, replies: p.replies.map(r => r.id===replyId ? { ...r, content } : r) }))) }
    else alert(j?.error || 'Failed')
  }

  async function deleteReply(replyId:number){
    if (!confirm('Delete this reply?')) return
    const fd = new FormData()
    fd.append('reply_id', String(replyId))
    const r = await fetch('/api/product_reply_delete', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setPosts(ps => ps.map(p => ({ ...p, replies: p.replies.filter(r => r.id !== replyId) }))) }
    else alert(j?.error || 'Failed')
  }

  async function createPoll(){
    if (!canPostUpdates) { alert('Forbidden'); return }
    const q = pollQ.trim()
    const options = pollOpts.map(o => o.trim()).filter(Boolean)
    if (!q || options.length < 2) { alert('Question and at least 2 options required'); return }
    try{
      const fd = new FormData()
      fd.append('question', q)
      if (notifyAll) fd.append('notify_all', '1')
      if (allowMultiple) fd.append('allow_multiple', '1')
      options.forEach(o => fd.append('options', o))
      const r = await fetch('/api/product_poll', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){ setPolls(p => [j.poll, ...p]); setPollQ(''); setPollOpts(['','']); setNotifyAll(false); setAllowMultiple(false) }
      else alert(j?.error || 'Failed')
    }catch{ alert('Network error') }
  }

  async function votePoll(pollId:number, optionIndex:number){
    try{
      const fd = new FormData()
      fd.append('poll_id', String(pollId))
      fd.append('option_index', String(optionIndex))
      const r = await fetch('/api/product_poll_vote', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        if (Array.isArray(j.option_counts)){
          setPolls(ps => ps.map(p => p.id===pollId ? { ...p, option_counts: j.option_counts } : p))
        }
      } else alert(j?.error || 'Failed')
    }catch{ alert('Network error') }
  }

  async function closePoll(pollId:number){
    try{
      const fd = new FormData()
      fd.append('poll_id', String(pollId))
      const r = await fetch('/api/product_poll_close', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){ setPolls(ps => ps.map(p => p.id===pollId ? { ...p, closed: true } : p)) }
      else alert(j?.error || 'Failed')
    }catch{ alert('Network error') }
  }

  async function deletePoll(pollId:number){
    if (!confirm('Delete this poll?')) return
    try{
      const fd = new FormData()
      fd.append('poll_id', String(pollId))
      const r = await fetch('/api/product_poll_delete', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){ setPolls(ps => ps.filter(p => p.id !== pollId)) }
      else alert(j?.error || 'Failed')
    }catch{ alert('Network error') }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="pt-14 max-w-2xl mx-auto px-3">
        {/* Secondary nav like Messages */}
        <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
          <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
            <div className="flex-1 h-full flex">
              <button type="button" className={`flex-1 text-center text-[13px] font-medium ${tab==='updates' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setTab('updates')}>
                <div className="pt-2">Product Updates</div>
                <div className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${tab==='updates' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
              </button>
              <button type="button" className={`flex-1 text-center text-[13px] font-medium ${tab==='feedback' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setTab('feedback')}>
                <div className="pt-2">Product Feedback/Requests</div>
                <div className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${tab==='feedback' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
              </button>
              <button type="button" className={`flex-1 text-center text-[13px] font-medium ${tab==='polls' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setTab('polls')}>
                <div className="pt-2">Polls</div>
                <div className={`h-0.5 rounded-full w-10 mx-auto mt-1 ${tab==='polls' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
              </button>
            </div>
          </div>
        </div>
        <div className="pt-10" />

        {/* Composer or Poll Creator */}
        <div className="mt-3 rounded-xl border border-white/10 bg-black p-3">
          {tab==='polls' ? (
            <div className="space-y-2">
              {canPostUpdates ? (
                <>
                  <input className="w-full rounded-md bg-black border border-white/10 px-2 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={pollQ} onChange={(e)=> setPollQ(e.target.value)} placeholder="Poll question" />
                  {pollOpts.map((opt, idx) => (
                    <input key={idx} className="w-full rounded-md bg-black border border-white/10 px-2 py-2 text-[14px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={opt} onChange={(e)=> setPollOpts(prev => prev.map((o,i)=> i===idx ? e.target.value : o))} placeholder={`Option ${idx+1}`} />
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <button type="button" className={`px-2 py-1.5 rounded-md text-[12px] border ${notifyAll ? 'bg-[#4db6ac] text-black border-[#4db6ac]' : 'border-white/10 text-[#9fb0b5] hover:text-white/90 hover:border-white/20'}`} onClick={()=> setNotifyAll(v=>!v)}>Notify all members</button>
                    <button type="button" className={`px-2 py-1.5 rounded-md text-[12px] border ${allowMultiple ? 'bg-[#4db6ac] text-black border-[#4db6ac]' : 'border-white/10 text-[#9fb0b5] hover:text-white/90 hover:border-white/20'}`} onClick={()=> setAllowMultiple(v=>!v)}>Allow multiple votes</button>
                    <div className="ml-auto" />
                    <button className="px-2.5 py-1.5 rounded-md bg-[#4db6ac] text-black text-[13px]" onClick={createPoll}>Create Poll</button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-[#9fb0b5]">Only Admin or Paulo can create polls.</div>
              )}
            </div>
          ) : (
            tab==='updates' ? (
              canPostUpdates ? (
                <div className="space-y-2">
                  <textarea className="w-full rounded-md bg-black border border-white/10 px-2 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" rows={3} value={composer} onChange={(e)=> setComposer(e.target.value)} placeholder="Share an update..." />
                  <div className="text-right">
                    <button className="px-2.5 py-1.5 rounded-md bg-[#4db6ac] text-black text-[13px]" onClick={createPost}>Post Update</button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-[#9fb0b5]">Only Admin or Paulo can post updates here. You can reply to updates below.</div>
              )
            ) : (
              <div className="space-y-2">
                <textarea className="w-full rounded-md bg-black border border-white/10 px-2 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" rows={3} value={composer} onChange={(e)=> setComposer(e.target.value)} placeholder="Share feedback or a request..." />
                <div className="text-right">
                  <button className="px-2.5 py-1.5 rounded-md bg-[#4db6ac] text-black text-[13px]" onClick={createPost}>Post</button>
                </div>
              </div>
            )
          )}
        </div>

        {/* Lists */}
        {tab === 'polls' ? (
          <div className="mt-3 space-y-3">
            {loading ? (<div className="text-[#9fb0b5]">Loading…</div>) : error ? (<div className="text-red-400">{error}</div>) : (
              polls.length ? polls.map(p => (
                <PollCard key={p.id} poll={p} onVote={votePoll} isAdmin={canPostUpdates} onClose={closePoll} onDelete={deletePoll} />
              )) : (<div className="text-[#9fb0b5] text-sm">No polls yet.</div>)
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {loading ? (<div className="text-[#9fb0b5]">Loading…</div>) : error ? (<div className="text-red-400">{error}</div>) : (
              posts.length ? posts.map(p => (
                <PostCard key={p.id} post={p} onReply={addReply} onEditPost={editPost} onDeletePost={deletePost} onEditReply={editReply} onDeleteReply={deleteReply} />
              )) : (<div className="text-[#9fb0b5] text-sm">No posts yet.</div>)
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PostCard({ post, onReply, onEditPost, onDeletePost, onEditReply, onDeleteReply }:{ post:PPost; onReply:(postId:number, text:string)=>void; onEditPost:(postId:number, content:string)=>void; onDeletePost:(postId:number)=>void; onEditReply:(replyId:number, content:string)=>void; onDeleteReply:(replyId:number)=>void }){
  const [replyText, setReplyText] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(post.content)
  const [me, setMe] = useState('')
  useEffect(()=>{ (async()=>{ try{ const r = await fetch('/api/home_timeline', { credentials:'include' }); const j = await r.json().catch(()=>null); if (j?.username) setMe(j.username) }catch{} })() }, [])
  const allowEdit = ['admin','paulo'].includes((me||'').toLowerCase())
  return (
    <div className="rounded-2xl border border-white/10 bg-black">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <div className="font-medium">{post.username}</div>
        <div className="text-xs text-[#9fb0b5] ml-auto">{post.created_at}</div>
        {allowEdit ? (
          <>
            <button className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" title="Edit"
              onClick={()=> setIsEditing(v=>!v)}>
              <i className="fa-regular fa-pen-to-square" />
            </button>
            <button className="ml-1 px-2 py-1 rounded-full text-red-300 hover:text-red-400" title="Delete"
              onClick={()=> onDeletePost(post.id)}>
              <i className="fa-regular fa-trash-can" />
            </button>
          </>
        ) : null}
      </div>
      <div className="px-3 py-2">
        {!isEditing ? (
          <div className="whitespace-pre-wrap text-[14px] break-words">{post.content}</div>
        ) : (
          <div className="space-y-2">
            <textarea className="w-full rounded-md bg-black border border-white/10 px-2 py-2 text-[15px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" rows={3} value={editText} onChange={(e)=> setEditText(e.target.value)} />
            <div className="text-right flex gap-2 justify-end">
              <button className="px-2.5 py-1.5 rounded-md border border-white/10 text-[13px]" onClick={()=> { setIsEditing(false); setEditText(post.content) }}>Cancel</button>
              <button className="px-2.5 py-1.5 rounded-md bg-[#4db6ac] text-black text-[13px]" onClick={()=> { setIsEditing(false); onEditPost(post.id, editText) }}>Save</button>
            </div>
          </div>
        )}
      </div>
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2">
          <input className="flex-1 px-3 py-1.5 rounded-full bg-black border border-white/10 text-[14px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={replyText} onChange={(e)=> setReplyText(e.target.value)} placeholder="Reply..." />
          <button className="px-2 py-1.5 rounded-full bg-[#4db6ac] text-black border border-[#4db6ac] text-[13px]" onClick={()=> { if (!replyText.trim()) return; onReply(post.id, replyText); setReplyText('') }}>Send</button>
        </div>
        {post.replies?.length ? (
          <div className="mt-2 space-y-2">
            {post.replies.map(r => (
              <ReplyCard key={r.id} reply={r} onEditReply={onEditReply} onDeleteReply={onDeleteReply} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ReplyCard({ reply, onEditReply, onDeleteReply }:{ reply:PReply; onEditReply:(replyId:number, content:string)=>void; onDeleteReply:(replyId:number)=>void }){
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(reply.content)
  const [me, setMe] = useState('')
  useEffect(()=>{ (async()=>{ try{ const r = await fetch('/api/home_timeline', { credentials:'include' }); const j = await r.json().catch(()=>null); if (j?.username) setMe(j.username) }catch{} })() }, [])
  const allowEdit = ['admin','paulo'].includes((me||'').toLowerCase())
  return (
    <div className="px-2 py-1.5 rounded-lg border border-white/10 bg-black/60">
      <div className="flex items-center gap-2">
        <div className="text-xs text-[#9fb0b5]">{reply.username} • {reply.created_at}</div>
        {allowEdit ? (
          <div className="ml-auto flex items-center gap-1">
            <button className="px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]" title="Edit reply" onClick={()=> setIsEditing(v=>!v)}>
              <i className="fa-regular fa-pen-to-square" />
            </button>
            <button className="px-2 py-1 rounded-full text-red-300 hover:text-red-400" title="Delete reply" onClick={()=> onDeleteReply(reply.id)}>
              <i className="fa-regular fa-trash-can" />
            </button>
          </div>
        ) : null}
      </div>
      {!isEditing ? (
        <div className="text-sm whitespace-pre-wrap break-words">{reply.content}</div>
      ) : (
        <div className="mt-1 space-y-2">
          <textarea className="w-full rounded-md bg-black border border-white/10 px-2 py-2 text-[14px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={editText} onChange={(e)=> setEditText(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <button className="px-2.5 py-1.5 rounded-md border border-white/10 text-[13px]" onClick={()=> { setIsEditing(false); setEditText(reply.content) }}>Cancel</button>
            <button className="px-2.5 py-1.5 rounded-md bg-[#4db6ac] text-black text-[13px]" onClick={()=> { setIsEditing(false); onEditReply(reply.id, editText) }}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

function PollCard({ poll, onVote, isAdmin, onClose, onDelete }:{ poll:Poll; onVote:(pollId:number, optionIndex:number)=>void; isAdmin:boolean; onClose:(pollId:number)=>void; onDelete:(pollId:number)=>void }){
  const hasCounts = Array.isArray(poll.option_counts) && poll.option_counts.length === (poll.options?.length||0)
  return (
    <div className="rounded-2xl border border-white/10 bg-black p-3">
      <div className="flex items-center gap-2">
        <div className="font-medium">{poll.username}</div>
        <div className="text-xs text-[#9fb0b5] ml-auto">{poll.created_at}</div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="text-[15px] whitespace-pre-wrap">{poll.question}</div>
        {poll.closed ? (<span className="ml-auto text-[12px] px-2 py-0.5 rounded-full bg-white/10 text-[#9fb0b5]">Closed</span>) : null}
        {isAdmin ? (
          <div className="ml-auto flex items-center gap-2">
            {!poll.closed ? (<button className="px-2 py-1 text-[12px] rounded-md border border-white/10 hover:bg-white/5" onClick={()=> onClose(poll.id)}>Close</button>) : null}
            <button className="px-2 py-1 text-[12px] rounded-md border border-red-400/30 text-red-300 hover:bg-red-500/10" onClick={()=> onDelete(poll.id)}>Delete</button>
          </div>
        ) : null}
      </div>
      <div className="mt-2 space-y-2">
        {poll.options.map((opt, idx) => (
          <button key={idx} className={`w-full text-left px-3 py-2 rounded-md border border-white/10 ${poll.closed ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white/5'} text-[14px]`} disabled={!!poll.closed} onClick={()=> onVote(poll.id, idx)}>
            <div className="flex items-center">
              <div className="flex-1">{opt}</div>
              {hasCounts ? (<div className="ml-2 text-[12px] text-[#9fb0b5]">{poll.option_counts![idx]}</div>) : null}
            </div>
          </button>
        ))}
        {poll.allow_multiple ? (<div className="text-[12px] text-[#9fb0b5]">Multiple votes allowed</div>) : null}
      </div>
    </div>
  )
}

