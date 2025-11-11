import { useEffect, useRef, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'

type Thread = {
  other_username: string
  display_name: string
  profile_picture_url: string | null
  last_message_text: string | null
  last_activity_time: string | null
  last_sender?: string | null
  unread_count?: number
}

export default function Messages(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  // Show current user's name in the top header
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try{
        const r = await fetch('/api/profile_me', { credentials:'include' })
        if (!mounted) return
        if (r.ok){
          const j = await r.json()
          if (j && j.username){ setTitle(j.username) }
        }
      }catch{}
    })()
    return () => { mounted = false }
  }, [setTitle])

  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'chats'|'new'>('chats')
  const [swipeId, setSwipeId] = useState<string|null>(null)
  const [dragX, setDragX] = useState(0)
  const startXRef = useRef(0)
  const draggingIdRef = useRef<string|null>(null)

  function load(silent:boolean=false){
    if (!silent) setLoading(true)
    fetch('/api/chat_threads', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.threads)){
          setThreads(prev => {
            const a = prev
            const b = j.threads as Thread[]
            if (a.length !== b.length) return b
            const changed = a.some((x, idx) => {
              const y = b[idx]
              return !y || x.other_username !== y.other_username || x.last_message_text !== y.last_message_text || x.last_activity_time !== y.last_activity_time || (x.unread_count||0) !== (y.unread_count||0)
            })
            return changed ? b : a
          })
        }
      }).catch(()=>{})
      .finally(()=> { if (!silent) setLoading(false) })
  }

  useEffect(() => {
    load(false)
    const onVis = () => { if (!document.hidden) load(true) }
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(() => load(true), 5000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(t) }
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      {/* Secondary header (match Polls) */}
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-3xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> { if (window.history.length > 1) navigate(-1); else navigate('/home') }} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='chats' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('chats')}>
              <div className="pt-2">Chats</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='chats' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='new' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('new')}>
              <div className="pt-2">New Message</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='new' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto pt-[70px] h-[calc(100vh-70px)] px-1 sm:px-3 pb-2 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' as any }}>
        {activeTab === 'chats' ? (
          <div className="rounded-xl border border-white/10 bg-black divide-y divide-white/10">
            {loading ? (
              <div className="px-4 py-4 text-sm text-[#9fb0b5]">Loading chats...</div>
            ) : threads.length === 0 ? (
              <div className="px-4 py-4 text-sm text-[#9fb0b5]">No chats yet. Start a new one from the New Message tab.</div>
            ) : (
              threads.map((t) => {
              const isDragging = draggingIdRef.current === t.other_username
              const tx = isDragging ? Math.min(0, dragX) : (swipeId === t.other_username ? -72 : 0)
              const transition = isDragging ? 'none' : 'transform 150ms ease-out'
              const showActions = isDragging ? (dragX < -10) : (swipeId === t.other_username)
              return (
                <div key={t.other_username} className="relative w-full overflow-hidden">
                  {/* Actions (revealed on swipe) */}
                  <div className="absolute inset-y-0 right-0 flex items-stretch pr-2" style={{ opacity: showActions ? 1 : 0, pointerEvents: showActions ? 'auto' : 'none', transition: 'opacity 150ms ease-out' }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`Delete chat with ${t.display_name || t.other_username}? This cannot be undone.`)) return
                        const fd = new URLSearchParams({ other_username: t.other_username })
                        fetch('/delete_chat_thread', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                          .then(r=>r.json()).then(j=>{
                            if (j?.success){
                              setThreads(prev => prev.filter(x => x.other_username !== t.other_username))
                              setSwipeId(null)
                              // Immediately refetch to avoid cached reappearance
                              fetch('/api/chat_threads', { credentials:'include' })
                                .then(rr=> rr.json()).then(jj=>{
                                  if (jj?.success && Array.isArray(jj.threads)){
                                    setThreads(jj.threads)
                                  }
                                }).catch(()=>{})
                              try{ (window as any).__header_do_poll && (window as any).__header_do_poll() }catch{}
                            }
                          }).catch(()=>{})
                      }}
                      className="my-1 h-[44px] w-[64px] rounded-md bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center justify-center"
                      aria-label="Delete chat"
                    >
                      <i className="fa-solid fa-trash" />
                    </button>
                  </div>

                  {/* Swipeable content */}
                  <button
                    onClick={() => {
                      setThreads(prev => prev.map(x => x.other_username===t.other_username ? { ...x, unread_count: 0 } : x))
                      try{ (window as any).__header_do_poll && (window as any).__header_do_poll() }catch{}
                      navigate(`/user_chat/chat/${encodeURIComponent(t.other_username)}`)
                    }}
                    onTouchStart={(e) => {
                      startXRef.current = e.touches[0].clientX
                      draggingIdRef.current = t.other_username
                      setDragX(swipeId === t.other_username ? -72 : 0)
                    }}
                    onTouchMove={(e) => {
                      if (draggingIdRef.current !== t.other_username) return
                      const dx = e.touches[0].clientX - startXRef.current
                      setDragX(dx)
                    }}
                    onTouchEnd={() => {
                      if (draggingIdRef.current !== t.other_username) return
                      const shouldOpen = dragX <= -60
                      setSwipeId(shouldOpen ? t.other_username : null)
                      setDragX(0)
                      draggingIdRef.current = null
                    }}
                    onTouchCancel={() => {
                      if (draggingIdRef.current !== t.other_username) return
                      setDragX(0)
                      draggingIdRef.current = null
                    }}
                    className="w-full px-3 py-2 flex items-center gap-3 bg-transparent"
                    style={{ transform: `translateX(${tx}px)`, transition }}
                  >
                    <Avatar username={t.other_username} url={t.profile_picture_url || undefined} size={48} linkToProfile />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between">
                        <div className="font-medium truncate">{t.display_name}</div>
                        {t.last_activity_time && (
                          <div className="ml-3 flex-shrink-0 text-[11px] text-[#9fb0b5]">
                            {new Date(t.last_activity_time).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                      <div className="text-[13px] text-[#9fb0b5] truncate">
                        {t.last_message_text ? t.last_message_text : 'Say hello'}
                      </div>
                    </div>
                    {t.unread_count && t.unread_count > 0 ? (
                      <div className="ml-2 px-2 h-5 rounded-full bg-[#4db6ac] text-black text-[11px] flex items-center justify-center">
                        {t.unread_count > 99 ? '99+' : t.unread_count}
                      </div>
                    ) : null}
                  </button>
                </div>
                )
              })
            )}
          </div>
        ) : (
          <NewMessageInline />
        )}
      </div>
    </div>
  )
}

function NewMessageInline(){
  type Community = { id:number; name:string }
  type Member = { username:string; profile_picture?:string|null }
  const [communities, setCommunities] = useState<Community[]>([])
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [membersByCommunity, setMembersByCommunity] = useState<Record<number, Member[]>>({})

  useEffect(() => {
    fetch('/get_user_communities', { credentials:'include' })
      .then(r=>r.json()).then(j=>{
        if (j?.success && Array.isArray(j.communities)){
          setCommunities(j.communities.map((c:any)=>({ id:c.id, name:c.name })) as Community[])
        }
      }).catch(()=>{})
  }, [])

  function resolveAvatar(url?:string|null){
    if (!url) return null
    if (url.startsWith('http') || url.startsWith('/static')) return url
    return `/static/${url}`
  }

  function toggleCommunity(comm:Community){
    setExpanded(prev => ({ ...prev, [comm.id]: !prev[comm.id] }))
    if (!membersByCommunity[comm.id]){
      const fd = new URLSearchParams({ community_id: String(comm.id) })
      fetch('/get_community_members', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
        .then(r=>r.json()).then(j=>{
          if (j?.success && Array.isArray(j.members)){
            const list = j.members.map((m:any)=> ({ username: m.username, profile_picture: m.profile_picture ?? null })) as Member[]
            setMembersByCommunity(prev => ({ ...prev, [comm.id]: list }))
          }
        }).catch(()=>{})
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black">
      <div className="p-3 border-b border-white/10 font-semibold text-[15px]">Start a New Message</div>
      <div className="divide-y divide-white/10">
        {communities.map(c => (
          <div key={c.id}>
            <button className="w-full px-3 py-2 text-left hover:bg-white/5 flex items-center justify-between text-[14px]" onClick={()=> toggleCommunity(c)}>
              <span className="font-medium">{c.name}</span>
              <i className={`fa-solid ${expanded[c.id] ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs text-[#9fb0b5]`} />
            </button>
            {expanded[c.id] && (
              <div className="px-3 py-2 space-y-1">
                {(membersByCommunity[c.id]||[]).map((m, idx) => (
                  <a key={idx} className="block px-3 py-2 rounded-md hover:bg-white/5 flex items-center gap-2 text-[14px]" href={`/user_chat/chat/${encodeURIComponent(m.username)}`}>
                    <Avatar username={m.username} url={resolveAvatar(m.profile_picture) || undefined} size={32} linkToProfile />
                    <span className="truncate">{m.username}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}