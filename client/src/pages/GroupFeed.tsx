import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { formatSmartTime } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'
import { renderTextWithLinks, detectLinks, replaceLinkInText } from '../utils/linkUtils'

type Reply = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null }
type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null, replies: Reply[], can_edit?: boolean, can_delete?: boolean }

function ManageGroupButton({ groupId, onClose }:{ groupId: string, onClose: ()=>void }){
  const navigate = useNavigate()
  return (
    <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { onClose(); alert('Group management coming soon') }}>
      Manage Group
    </button>
  )
}

export default function GroupFeed(){
  const { group_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [groupName, setGroupName] = useState('Group')
  const [communityMeta, setCommunityMeta] = useState<{ id?: number|string, name?: string, type?: string } | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [editingId, setEditingId] = useState<number|null>(null)
  const [editText, setEditText] = useState<string>('')
  const [detectedLinks, setDetectedLinks] = useState<ReturnType<typeof detectLinks>>([])

  // More menu + badges
  const [moreOpen, setMoreOpen] = useState(false)
  const [hasUnansweredPolls, setHasUnansweredPolls] = useState(false)
  const [hasUnseenDocs, setHasUnseenDocs] = useState(false)
  const [hasPendingRsvps, setHasPendingRsvps] = useState(false)

  // Members + invite
  type MemberInfo = { username: string; display_name: string; profile_picture?: string | null; status?: string; role?: string }
  const [showMembers, setShowMembers] = useState(false)
  const [groupMembers, setGroupMembers] = useState<MemberInfo[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState('')
  const [groupOwner, setGroupOwner] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [availableMembers, setAvailableMembers] = useState<MemberInfo[]>([])
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSearch, setInviteSearch] = useState('')
  const [selectedInvites, setSelectedInvites] = useState<Set<string>>(new Set())
  const [inviteSending, setInviteSending] = useState(false)

  // Keyboard lift for modals
  const [kbHeight, setKbHeight] = useState(0)
  const kbRef = useRef(0)
  const vvBaseRef = useRef<number | null>(null)

  const communityId = communityMeta?.id ? String(communityMeta.id) : ''
  const communityTypeLower = (communityMeta?.type || '').toLowerCase()
  const communityNameLower = (communityMeta?.name || '').toLowerCase()
  const showTasks = communityTypeLower === 'general' || communityTypeLower.includes('university') || communityNameLower.includes('university')

  useEffect(() => {
    const communityName = communityMeta?.name || ''
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

  // Check for unanswered polls
  useEffect(() => {
    try{
      const hasUnanswered = posts.some((p:any) => p?.poll && (p.poll.user_vote == null))
      setHasUnansweredPolls(hasUnanswered)
    }catch{ setHasUnansweredPolls(false) }
  }, [posts])

  // Check for unseen docs
  useEffect(() => {
    if (!communityId) return
    let mounted = true
    async function check(){
      try{
        const r = await fetch(`/get_links?community_id=${communityId}&group_id=${group_id}`, { credentials: 'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){
          const docs = j.docs || []
          if (docs.length === 0) { setHasUnseenDocs(false); return }
          const key = `docs_last_seen_group_${group_id}`
          const lastSeenStr = localStorage.getItem(key)
          const lastSeen = lastSeenStr ? Date.parse(lastSeenStr) : 0
          setHasUnseenDocs(docs.some((d:any) => Date.parse(d.created_at) > lastSeen))
        }
      }catch{ setHasUnseenDocs(false) }
    }
    check()
    return () => { mounted = false }
  }, [communityId, group_id])

  // Check for pending RSVPs
  useEffect(() => {
    if (!communityId) return
    let mounted = true
    async function check(){
      try{
        const r = await fetch(`/api/calendar_events/${communityId}?group_id=${group_id}`, { credentials: 'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){
          const events = j.events || []
          const now = new Date()
          setHasPendingRsvps(events.some((e:any) => new Date(e.date) >= now && !e.user_rsvp))
        }
      }catch{ setHasPendingRsvps(false) }
    }
    check()
    return () => { mounted = false }
  }, [communityId, group_id])

  // Web visual viewport keyboard detection
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'web') return
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const h = vv.height
      if (vvBaseRef.current === null || h > (vvBaseRef.current ?? h) - 4) vvBaseRef.current = h
      const offset = Math.max(0, (vvBaseRef.current ?? h) - h)
      const val = offset < 50 ? 0 : offset
      if (Math.abs(kbRef.current - val) < 5) return
      kbRef.current = val
      setKbHeight(val)
    }
    vv.addEventListener('resize', onResize)
    onResize()
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  // Native Capacitor keyboard events
  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined
    const onShow = (info: KeyboardInfo) => {
      const h = info?.keyboardHeight ?? 0
      if (h < 60) return
      kbRef.current = h
      setKbHeight(h)
    }
    const onHide = () => { kbRef.current = 0; setKbHeight(0) }
    Keyboard.addListener('keyboardWillShow', onShow).then(s => { showSub = s })
    Keyboard.addListener('keyboardWillHide', onHide).then(s => { hideSub = s })
    return () => { showSub?.remove(); hideSub?.remove() }
  }, [])

  const openMembers = async () => {
    setShowMembers(true)
    setMembersLoading(true)
    try {
      const r = await fetch(`/api/group_members/${group_id}`, { credentials: 'include' })
      const j = await r.json()
      if (j?.success) {
        setGroupMembers(j.members || [])
        setCurrentUserRole(j.current_user_role || '')
        setGroupOwner(j.group_owner || '')
      }
    } catch {}
    setMembersLoading(false)
  }

  const leaveGroup = async () => {
    if (!confirm('Are you sure you want to leave this group?')) return
    try {
      const fd = new URLSearchParams({ group_id: String(group_id) })
      const r = await fetch('/api/groups/leave', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json()
      if (j?.success) { setShowMembers(false); navigate(-1) }
      else alert(j?.error || 'Failed to leave')
    } catch { alert('Failed to leave group') }
  }

  const removeMember = async (target: string) => {
    if (!confirm(`Remove @${target} from this group?`)) return
    try {
      const r = await fetch(`/api/group_members/${group_id}/remove`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: target }),
      })
      const j = await r.json()
      if (j?.success) openMembers()
      else alert(j?.error || 'Failed to remove')
    } catch { alert('Failed to remove member') }
  }

  const toggleAdmin = async (target: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin'
    try {
      const r = await fetch(`/api/group_members/${group_id}/set_role`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: target, role: newRole }),
      })
      const j = await r.json()
      if (j?.success) openMembers()
      else alert(j?.error || 'Failed to update role')
    } catch { alert('Failed to update role') }
  }

  const openInvite = async () => {
    setShowInvite(true)
    setInviteLoading(true)
    setSelectedInvites(new Set())
    setInviteSearch('')
    try {
      const r = await fetch(`/api/group_members/${group_id}/available`, { credentials: 'include' })
      const j = await r.json()
      if (j?.success) setAvailableMembers(j.available || [])
    } catch {}
    setInviteLoading(false)
  }

  const sendInvites = async () => {
    if (selectedInvites.size === 0) return
    setInviteSending(true)
    try {
      const r = await fetch(`/api/group_members/${group_id}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ usernames: Array.from(selectedInvites) }),
      })
      const j = await r.json()
      if (j?.success) {
        setShowInvite(false)
        openMembers()
      }
    } catch {}
    setInviteSending(false)
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>

  return (
    <div className="min-h-screen bg-black text-white pb-safe">
      {/* Scrollable content area */}
      <div
        ref={scrollRef}
        className="max-w-2xl mx-auto no-scrollbar pb-24 px-3"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          overflowY: 'auto',
          overscrollBehaviorY: 'auto',
          touchAction: 'pan-y',
          paddingTop: '12px',
        }}
      >
        <div className="space-y-3">
          {/* Back to communities (parent) */}
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-sm hover:bg-white/10"
              onClick={()=> {
                const cid = communityMeta?.id
                if (cid) navigate(`/communities?parent_id=${cid}`)
                else navigate('/communities')
              }}
            >
              ← Back to Communities
            </button>
          </div>
          {posts.length === 0 ? (
            <div className="text-sm text-[#9fb0b5]">No posts yet.</div>
          ) : (
            posts.map(p => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer" onClick={()=> navigate(`/post/${p.id}`)}>
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                  <Avatar username={p.username} url={p.profile_picture || undefined} size={28} linkToProfile />
                  <div className="font-medium">{p.username}</div>
                  <div className="text-xs text-[#9fb0b5] ml-auto">{formatSmartTime((p as any).display_timestamp || p.timestamp)}</div>
                  {(p.can_edit || p.can_delete) ? (
                    <div className="ml-2 flex items-center gap-1">
                      {p.can_edit ? (
                        <button
                          className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]"
                          aria-label="Edit post"
                          onClick={async (e)=> {
                            e.stopPropagation()
                            setEditingId(p.id)
                            setEditText(p.content)
                            setDetectedLinks(detectLinks(p.content))
                          }}
                        >
                          <i className="fa-regular fa-pen-to-square" />
                        </button>
                      ) : null}
                      {p.can_delete ? (
                        <button
                          className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]"
                          aria-label="Delete post"
                          onClick={async (e)=> {
                            e.stopPropagation()
                            if (!confirm('Delete this post?')) return
                            const fd = new URLSearchParams({ post_id: String(p.id) })
                            const r = await fetch('/api/group_posts/delete', { method:'POST', credentials:'include', body: fd })
                            const j = await r.json().catch(()=>null)
                            if (j?.success){ setPosts(list => list.filter(it => it.id !== p.id)) }
                            else { alert(j?.error || 'Failed to delete') }
                          }}
                        >
                          <i className="fa-regular fa-trash-can" style={{ color: 'inherit' }} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="px-3 py-2 space-y-2" onClick={(e)=> e.stopPropagation()}>
                  {editingId !== p.id ? (
                    <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{renderTextWithLinks(p.content)}</div>
                  ) : (
                    <div className="space-y-2">
                      <textarea className="w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none min-h-[100px]" value={editText} onChange={(e)=> { setEditText(e.target.value); setDetectedLinks(detectLinks(e.target.value)) }} />
                      {detectedLinks.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs text-[#9fb0b5] font-medium">Detected Links:</div>
                          {detectedLinks.map((link, idx) => (
                            <div key={idx} className="flex items-center gap-2 p-2 rounded-lg border border-white/10 bg-white/5">
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-[#4db6ac] truncate">{link.displayText}</div>
                                {link.displayText !== link.url && (
                                  <div className="text-xs text-white/50 truncate">{link.url}</div>
                                )}
                              </div>
                              <button
                                className="px-2 py-1 rounded text-xs border border-[#4db6ac]/30 text-[#4db6ac] hover:bg-[#4db6ac]/10"
                                onClick={()=> {
                                  const newText = prompt('Rename link display text', link.displayText)
                                  if (newText == null) return
                                  const updated = replaceLinkInText(editText, link.url, newText)
                                  setEditText(updated)
                                  setDetectedLinks(detectLinks(updated))
                                }}
                              >
                                Rename
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <button className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm" onClick={()=> { setEditingId(null); setEditText('') }}>Cancel</button>
                        <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={async()=> {
                          const fd = new URLSearchParams({ post_id: String(p.id), content: editText })
                          const r = await fetch('/api/group_posts/edit', { method:'POST', credentials:'include', body: fd })
                          const j = await r.json().catch(()=>null)
                          if (j?.success){ setPosts(list => list.map(it => it.id === p.id ? ({ ...it, content: editText }) : it)); setEditingId(null) }
                          else alert(j?.error || 'Failed to update')
                        }}>Save</button>
                      </div>
                    </div>
                  )}
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
                          if (j?.success){ setPosts(list => list.map(it => it.id===p.id ? ({ ...it, user_reaction: j.user_reaction, reactions: (()=>{
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
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom navigation bar - identical to CommunityFeed */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[100] px-3 sm:px-6"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', touchAction: 'manipulation' }}
      >
        <div className="liquid-glass-surface border border-white/10 rounded-2xl shadow-[0_-10px_40px_rgba(0,0,0,0.45)] max-w-2xl mx-auto mb-2">
          <div className="h-14 px-2 sm:px-6 flex items-center justify-between text-[#cfd8dc]">
            <button className="p-3 rounded-full bg-white/10 transition-colors" aria-label="Home" onClick={()=> scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
              <i className="fa-solid fa-house text-lg text-[#4db6ac]" />
            </button>
            <button className="p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="Members" onClick={openMembers}>
              <i className="fa-solid fa-users text-lg" />
            </button>
            <button
              className="w-10 h-10 rounded-md bg-[#4db6ac] text-black hover:brightness-110 grid place-items-center transition-all"
              aria-label="New Post"
              onClick={()=> navigate(`/compose?group_id=${group_id}`)}
            >
              <i className="fa-solid fa-plus" />
            </button>
            <button className="relative p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="Announcements" onClick={()=> alert('No announcements for groups yet')}>
              <span className="relative inline-block">
                <i className="fa-solid fa-bullhorn text-lg" />
              </span>
            </button>
            <button className="relative p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="More" onClick={()=> setMoreOpen(true)}>
              <span className="relative inline-block">
                <i className="fa-solid fa-ellipsis text-lg" />
                {(hasUnansweredPolls || hasUnseenDocs || hasPendingRsvps) && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#4db6ac] rounded-full" />
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* More bottom sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-[110] bg-black/30 flex items-end justify-end" onClick={(e)=> e.currentTarget===e.target && setMoreOpen(false)}>
          <div className="w-[75%] max-w-sm mr-2 bg-black/95 backdrop-blur border border-white/10 rounded-2xl p-2 space-y-2 transition-transform duration-200 ease-out translate-y-0" style={{ marginBottom: 'calc(70px + env(safe-area-inset-bottom))' }}>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/key_posts?group_id=${group_id}`) }}>
              Key Posts
            </button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5 flex items-center justify-end gap-2" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/polls_react?group_id=${group_id}`) }}>
              Polls
              {hasUnansweredPolls && <span className="w-2 h-2 bg-[#4db6ac] rounded-full" />}
            </button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5 flex items-center justify-end gap-2" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/calendar_react?group_id=${group_id}`) }}>
              Calendar
              {hasPendingRsvps && <span className="w-2 h-2 bg-[#4db6ac] rounded-full" />}
            </button>
            {showTasks && (
              <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/tasks_react?group_id=${group_id}`) }}>Tasks</button>
            )}
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/photos_react?group_id=${group_id}`) }}>Photos</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5 flex items-center justify-end gap-2" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/useful_links_react?group_id=${group_id}`) }}>
              Useful Links & Docs
              {hasUnseenDocs && <span className="w-2 h-2 bg-[#4db6ac] rounded-full" />}
            </button>
            {group_id && <ManageGroupButton groupId={group_id} onClose={()=> setMoreOpen(false)} />}
          </div>
        </div>
      )}

      {/* Members modal */}
      {showMembers && (
        <div className="fixed inset-0 z-[120] bg-black/50 flex items-end justify-center" onClick={(e) => e.currentTarget === e.target && setShowMembers(false)}>
          <div className="w-full max-w-lg bg-black/95 backdrop-blur border border-white/10 rounded-t-2xl p-4 max-h-[75vh] flex flex-col" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-white font-semibold text-base">Group Members</div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setShowMembers(false); openInvite() }} className="px-3 py-1.5 rounded-lg bg-[#4db6ac] text-black text-xs font-medium hover:brightness-110">
                  <i className="fa-solid fa-user-plus mr-1.5" />Add
                </button>
                <button onClick={() => setShowMembers(false)} className="px-2 py-1 rounded-full border border-white/10 text-white/60 text-sm hover:bg-white/5">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {membersLoading ? (
                <div className="text-[#9fb0b5] text-sm py-4 text-center">Loading…</div>
              ) : groupMembers.length === 0 ? (
                <div className="text-[#9fb0b5] text-sm py-4 text-center">No members yet. Invite people to this group!</div>
              ) : groupMembers.map(m => (
                <div key={m.username} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/5">
                  <div className="cursor-pointer" onClick={() => { setShowMembers(false); navigate(`/profile/${m.username}`) }}>
                    <Avatar username={m.username} url={m.profile_picture || undefined} size={36} />
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setShowMembers(false); navigate(`/profile/${m.username}`) }}>
                    <div className="text-sm font-medium text-white truncate flex items-center gap-1.5">
                      {m.display_name || m.username}
                      {m.role === 'owner' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#4db6ac]/20 text-[#4db6ac] font-semibold">Owner</span>}
                      {m.role === 'admin' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white/60 font-semibold">Admin</span>}
                    </div>
                    <div className="text-[11px] text-[#6f7c81]">@{m.username}</div>
                  </div>
                  {/* Actions: owner can set admins + remove; admins can remove non-admins */}
                  {(currentUserRole === 'owner' || currentUserRole === 'admin') && m.role !== 'owner' && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {currentUserRole === 'owner' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleAdmin(m.username, m.role || 'member') }}
                          className="w-7 h-7 rounded-full border border-white/10 flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white/70"
                          title={m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        >
                          <i className={`fa-solid ${m.role === 'admin' ? 'fa-user-shield' : 'fa-shield-halved'} text-[10px]`} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeMember(m.username) }}
                        className="w-7 h-7 rounded-full border border-white/10 flex items-center justify-center text-red-400/50 hover:bg-red-500/10 hover:text-red-400"
                        title="Remove from group"
                      >
                        <i className="fa-solid fa-user-minus text-[10px]" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Leave group button */}
            <button
              onClick={leaveGroup}
              className="mt-3 w-full py-2.5 rounded-lg border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors"
            >
              <i className="fa-solid fa-right-from-bracket mr-2" />Leave Group
            </button>
          </div>
        </div>
      )}

      {/* Invite modal -- fullscreen, lifts above keyboard */}
      {showInvite && (() => {
        const q = inviteSearch.trim().toLowerCase()
        const filteredAvailable = q
          ? availableMembers.filter(m => (m.display_name || '').toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
          : availableMembers
        return (
          <div
            className="fixed inset-0 z-[130] bg-black flex flex-col"
            style={{
              paddingBottom: kbHeight > 0 ? `${kbHeight}px` : 'env(safe-area-inset-bottom, 0px)',
              transition: 'padding-bottom 0.15s ease-out',
            }}
          >
            {/* Safe area top spacer */}
            <div className="flex-shrink-0" style={{ height: 'env(safe-area-inset-top, 0px)' }} />
            {/* Header with close button */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 flex-shrink-0">
              <button
                onClick={() => setShowInvite(false)}
                className="w-9 h-9 rounded-full border border-white/15 flex items-center justify-center text-white/70 hover:bg-white/10 active:bg-white/20 flex-shrink-0"
                style={{ touchAction: 'manipulation' }}
              >
                <i className="fa-solid fa-xmark text-base" />
              </button>
              <div className="text-white font-semibold text-base flex-1">Add Members</div>
            </div>
            {/* Search */}
            <div className="relative px-4 py-3 flex-shrink-0">
              <i className="fa-solid fa-magnifying-glass absolute left-7 top-1/2 -translate-y-1/2 text-xs text-[#6f7c81]" />
              <input
                value={inviteSearch}
                onChange={e => setInviteSearch(e.target.value)}
                placeholder="Search by name…"
                className="w-full rounded-lg border border-white/15 bg-transparent pl-9 pr-3 py-2 text-sm text-white placeholder-[#6f7c81] focus:outline-none focus:border-[#4db6ac]"
                autoFocus
              />
            </div>
            {/* Selected count + add button */}
            {selectedInvites.size > 0 && (
              <div className="flex items-center justify-between px-4 pb-2 flex-shrink-0">
                <span className="text-xs text-[#9fb0b5]">{selectedInvites.size} selected</span>
                <button onClick={sendInvites} disabled={inviteSending} className="px-4 py-1.5 rounded-lg bg-[#4db6ac] text-black text-xs font-medium hover:brightness-110 disabled:opacity-50">
                  {inviteSending ? <i className="fa-solid fa-spinner fa-spin" /> : 'Add to Group'}
                </button>
              </div>
            )}
            {/* Available members list */}
            <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ minHeight: 0 }}>
              {inviteLoading ? (
                <div className="text-[#9fb0b5] text-sm py-4 text-center">Loading…</div>
              ) : filteredAvailable.length === 0 ? (
                <div className="text-[#9fb0b5] text-sm py-4 text-center">{q ? 'No matches found.' : 'All community members are already in this group.'}</div>
              ) : (
                <div className="space-y-1">
                  {filteredAvailable.map(m => {
                    const isSelected = selectedInvites.has(m.username)
                    return (
                      <button
                        key={m.username}
                        className={`w-full flex items-center gap-3 py-2 px-2 rounded-lg transition-colors text-left ${isSelected ? 'bg-[#4db6ac]/15 border border-[#4db6ac]/30' : 'hover:bg-white/5 border border-transparent'}`}
                        onClick={() => setSelectedInvites(prev => {
                          const next = new Set(prev)
                          if (next.has(m.username)) next.delete(m.username)
                          else next.add(m.username)
                          return next
                        })}
                      >
                        <div className="relative">
                          <Avatar username={m.username} url={m.profile_picture || undefined} size={36} />
                          {isSelected && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#4db6ac] rounded-full flex items-center justify-center">
                              <i className="fa-solid fa-check text-[8px] text-black" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{m.display_name || m.username}</div>
                          <div className="text-[11px] text-[#6f7c81]">@{m.username}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
