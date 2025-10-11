import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import MentionTextarea from '../components/MentionTextarea'
import { formatSmartTime } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'

type Reply = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null }
type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null, replies: Reply[] }

export default function GroupFeed(){
  const { group_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [groupName, setGroupName] = useState('Group')
  const [posts, setPosts] = useState<Post[]>([])
  const [composerText, setComposerText] = useState('')
  const [composerFile, setComposerFile] = useState<File|null>(null)
  const [posting, setPosting] = useState(false)

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
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      <div className="h-full max-w-2xl mx-auto overflow-y-auto no-scrollbar pb-28 px-3" style={{ WebkitOverflowScrolling: 'touch' as any }}>
        <div className="space-y-3">
          {/* Back + Title bar */}
          <div className="flex items-center gap-2 pt-3">
            <button className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10" onClick={()=> navigate(-1)}>
              ← Back
            </button>
            <div className="ml-auto font-semibold">{groupName}</div>
          </div>
          {/* Composer */}
          <div className="rounded-2xl border border-white/10 bg-black p-3">
            <MentionTextarea
              value={composerText}
              onChange={setComposerText}
              placeholder="Write a post…"
              className="w-full min-h-[80px] p-2 rounded-xl bg-black border border-white/10 text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
              rows={4}
              perfDegraded={!!composerFile}
            />
            {composerFile ? (
              <div className="mt-2">
                <img src={URL.createObjectURL(composerFile)} alt="preview" className="max-h-48 rounded border border-white/10" />
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between">
              <label className="px-3 py-2 rounded-full hover:bg-white/5 cursor-pointer" aria-label="Add image">
                <i className="fa-regular fa-image" style={{ color: '#4db6ac' }} />
                <input type="file" accept="image/*" onChange={(e)=> setComposerFile(e.target.files?.[0]||null)} style={{ display: 'none' }} />
              </label>
              <button className={`px-4 py-2 rounded-full ${posting ? 'bg-white/20 text-white/60 cursor-not-allowed' : 'bg-[#4db6ac] text-black hover:brightness-110'}`} onClick={async()=>{
                if (!group_id) return
                if (!composerText && !composerFile) return
                if (posting) return
                setPosting(true)
                try{
                  const fd = new FormData()
                  fd.append('group_id', String(group_id))
                  fd.append('content', composerText)
                  if (composerFile) fd.append('image', composerFile)
                  fd.append('dedupe_token', `${Date.now()}_${Math.random().toString(36).slice(2)}`)
                  const r = await fetch('/api/group_posts', { method:'POST', credentials:'include', body: fd })
                  const j = await r.json().catch(()=>null)
                  if (j?.success){ setComposerText(''); setComposerFile(null); await reloadFeed() }
                  else alert(j?.error || 'Failed to post')
                }catch{ alert('Failed to post') } finally { setPosting(false) }
              }} disabled={posting}>
                {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
          {posts.length === 0 ? (
            <div className="text-sm text-[#9fb0b5]">No posts yet.</div>
          ) : (
            posts.map(p => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20">
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
                  {/* Replies */}
                  <div className="mt-2 space-y-2">
                    {p.replies.map(rr => (
                      <div key={rr.id} className="rounded-xl border border-white/10 bg-white/5 p-2">
                        <div className="flex items-center gap-2">
                          <Avatar username={rr.username} url={rr.profile_picture || undefined} size={20} />
                          <div className="text-sm font-medium">{rr.username}</div>
                          <div className="text-[11px] text-[#9fb0b5] ml-auto">{formatSmartTime(rr.timestamp)}</div>
                        </div>
                        <div className="mt-1 text-[14px] whitespace-pre-wrap">{rr.content}</div>
                        {rr.image_path ? (
                          <ImageLoader
                            src={(() => {
                              const ip = String(rr.image_path || '').trim()
                              if (!ip) return ''
                              if (ip.startsWith('http')) return ip
                              if (ip.startsWith('/uploads') || ip.startsWith('/static')) return ip
                              return ip.startsWith('uploads') || ip.startsWith('static') ? `/${ip}` : `/uploads/${ip}`
                            })()}
                            alt="Reply image"
                            className="mt-1 max-h-48 rounded border border-white/10"
                          />
                        ) : null}
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          {['heart','thumbs-up','thumbs-down'].map((rname) => (
                            <button key={rname} className="px-2 py-1 rounded" onClick={async()=>{
                              try{
                                const form = new URLSearchParams({ reply_id: String(rr.id), reaction: rname })
                                const r = await fetch('/api/group_replies/react', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: form })
                                const j = await r.json().catch(()=>null)
                                if (j?.success){ setPosts(list => list.map(it => it.id===p.id ? ({ ...it, replies: it.replies.map(r2 => r2.id===rr.id ? ({ ...r2, user_reaction: j.user_reaction, reactions: (()=>{ const out = { ...(r2.reactions||{}) }; const prev = r2.user_reaction; if (prev){ out[prev] = Math.max(0, (out[prev]||0)-1) } if (j.user_reaction){ out[j.user_reaction] = (out[j.user_reaction]||0)+1 } return out })() }) : r2) }) : it)) }
                                else alert(j?.error || 'Failed')
                              }catch{}
                            }}>
                              <i className={`fa-regular ${rname==='heart'?'fa-heart':(rname==='thumbs-up'?'fa-thumbs-up':'fa-thumbs-down')}`} style={{ color: rr.user_reaction===rname ? '#4db6ac' : '#6c757d', WebkitTextStroke: rr.user_reaction===rname ? '1px #4db6ac' : undefined }} />
                              <span className="ml-1" style={{ color: rr.user_reaction===rname ? '#cfe9e7' : '#9fb0b5' }}>{(rr.reactions?.[rname])||0}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Inline reply composer */}
                  <InlineReply postId={p.id} onPosted={reloadFeed} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function InlineReply({ postId, onPosted }:{ postId:number, onPosted: ()=>Promise<void>|void }){
  const [text, setText] = useState('')
  const [file, setFile] = useState<File|null>(null)
  const [sending, setSending] = useState(false)
  return (
    <div className="mt-2">
      <MentionTextarea
        value={text}
        onChange={setText}
        placeholder="Write a reply…"
        className="w-full min-h-[48px] p-2 rounded-xl bg-black border border-white/10 text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
        rows={3}
        perfDegraded={!!file}
      />
      {file ? <img src={URL.createObjectURL(file)} alt="reply" className="mt-1 max-h-40 rounded border border-white/10" /> : null}
      <div className="mt-1 flex items-center justify-between">
        <label className="px-2 py-1.5 rounded-full hover:bg-white/5 cursor-pointer" aria-label="Add image">
          <i className="fa-regular fa-image" style={{ color:'#4db6ac' }} />
          <input type="file" accept="image/*" onChange={(e)=> setFile(e.target.files?.[0]||null)} style={{ display:'none' }} />
        </label>
        <button className={`px-3 py-1.5 rounded-full ${sending ? 'bg-white/20 text-white/60 cursor-not-allowed' : 'bg-[#4db6ac] text-black hover:brightness-110'}`} onClick={async()=>{
          if (sending) return
          if (!text && !file) return
          setSending(true)
          try{
            const fd = new FormData()
            fd.append('group_post_id', String(postId))
            fd.append('content', text)
            if (file) fd.append('image', file)
            const r = await fetch('/api/group_replies', { method:'POST', credentials:'include', body: fd })
            const j = await r.json().catch(()=>null)
            if (j?.success){ setText(''); setFile(null); await onPosted() }
            else alert(j?.error || 'Failed')
          }catch{ alert('Failed') } finally{ setSending(false) }
        }} disabled={sending}>
          {sending ? 'Replying…' : 'Reply'}
        </button>
      </div>
    </div>
  )
}

async function reloadFeed(){ try{ location.reload() }catch{} }
