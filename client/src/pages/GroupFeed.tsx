import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { formatSmartTime } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useLogoutRequest } from '../contexts/LogoutPromptContext'
import { renderTextWithLinks, detectLinks, replaceLinkInText } from '../utils/linkUtils'
import { openExternalInApp } from '../utils/openExternalInApp'
import VideoEmbed from '../components/VideoEmbed'
import { extractVideoEmbedFromPost, removeVideoUrlFromText } from '../utils/videoEmbed'

type Reply = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null }
type PollOption = { id: number; text?: string; option_text?: string; votes: number; user_voted?: boolean }
type PostPoll = {
  id: number
  question: string
  is_active?: number
  single_vote?: boolean | number | string
  expires_at?: string | null
  options: PollOption[]
  user_vote?: number | null
  total_votes?: number
}
type Post = { id:number; username:string; content:string; image_path?:string|null; video_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null, replies: Reply[], can_edit?: boolean, can_delete?: boolean, link_urls?: unknown, is_starred?: boolean, is_community_starred?: boolean, can_toggle_community_key?: boolean, poll?: PostPoll | null }

function ManageGroupButton({ groupId, onClose }:{ groupId: string, onClose: ()=>void }){
  const navigate = useNavigate()
  return (
    <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { onClose(); navigate(`/group/${groupId}/edit`) }}>
      Manage Group
    </button>
  )
}

export default function GroupFeed(){
  const { group_id } = useParams()
  const navigate = useNavigate()
  const mentionToProfile = useCallback((u: string) => { navigate(`/profile/${encodeURIComponent(u)}`) }, [navigate])
  const openExternalArticle = useCallback((url: string) => {
    void openExternalInApp(url)
  }, [])
  const { setTitle } = useHeader()
  const requestLogout = useLogoutRequest()
  const { profile: userProfile } = useUserProfile()
  const userAvatar = useMemo(() => {
    const rawUrl = (userProfile as any)?.profile_picture || null
    if (!rawUrl) return null
    if (rawUrl.startsWith('http') || rawUrl.startsWith('/static')) return rawUrl
    return `/static/${rawUrl}`
  }, [userProfile])
  const currentUsername = (userProfile as any)?.username || ''
  const currentDisplayName = (userProfile as any)?.display_name || currentUsername
  /** Same offset convention as CommunityFeed (iOS legacy 20px, else h-14 body). */
  const feedScrollHeaderBodyPx = useMemo(
    () => (Capacitor.getPlatform() === 'ios' ? 20 : 56),
    [],
  )

  const [menuOpen, setMenuOpen] = useState(false)
  const [groupInfoOpen, setGroupInfoOpen] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [q, setQ] = useState('#')
  const [results, setResults] = useState<Array<{ id: number; username: string; content: string; timestamp: string }>>([])
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [unreadNotifs, setUnreadNotifs] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [groupName, setGroupName] = useState('Group')
  const [communityMeta, setCommunityMeta] = useState<{ id?: number|string, name?: string, type?: string } | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [capabilities, setCapabilities] = useState<{ can_post_announcements?: boolean }>({})
  const [announcementsOpen, setAnnouncementsOpen] = useState(false)
  const [announcements, setAnnouncements] = useState<Array<{ id: number; content: string; created_by: string; created_at: string }>>([])
  const [announcementsLoading, setAnnouncementsLoading] = useState(false)
  const [newAnnouncement, setNewAnnouncement] = useState('')
  const [editingId, setEditingId] = useState<number|null>(null)
  const [editText, setEditText] = useState<string>('')
  const [detectedLinks, setDetectedLinks] = useState<ReturnType<typeof detectLinks>>([])
  const [pollModalPostId, setPollModalPostId] = useState<number | null>(null)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])
  const [pollSingle, setPollSingle] = useState(true)
  const [pollSaving, setPollSaving] = useState(false)

  // More menu + badges
  const [moreOpen, setMoreOpen] = useState(false)
  const [hasUnseenDocs, setHasUnseenDocs] = useState(false)
  const [hasPendingRsvps, setHasPendingRsvps] = useState(false)

  // Members + invite
  type MemberInfo = { username: string; display_name: string; profile_picture?: string | null; status?: string; role?: string }
  const [showMembers, setShowMembers] = useState(false)
  const [groupMembers, setGroupMembers] = useState<MemberInfo[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState('')
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
    let mounted = true
    const poll = async () => {
      if (!mounted) return
      try {
        const m = await fetch('/check_unread_messages', { credentials: 'include' })
        const mj = await m.json().catch(() => null)
        if (mounted && mj && typeof mj.unread_count === 'number') {
          setUnreadMsgs(mj.unread_count)
        }
      } catch {}
      try {
        const n = await fetch('/api/notifications', { credentials: 'include', headers: { 'Accept': 'application/json' } })
        const nj = await n.json().catch(() => null)
        if (mounted && nj?.success && Array.isArray(nj.notifications)) {
          const cnt = nj.notifications.filter((x: any) => x && x.is_read === false && x.type !== 'message' && x.type !== 'reaction').length
          setUnreadNotifs(cnt)
        }
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 10000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const loadFeed = useCallback(async () => {
    if (!group_id) return
    setLoading(true)
    try {
      const feedResp = await fetch(`/api/group_feed?group_id=${group_id}`, { credentials: 'include', headers: { Accept: 'application/json' } })
      const fj = await feedResp.json().catch(() => null)
      if (fj?.success) {
        setGroupName(fj.group?.name || 'Group')
        setCommunityMeta(fj.community || null)
        setPosts(fj.posts || [])
        setCapabilities(fj.capabilities || {})
        setError(null)
      } else {
        setError(fj?.error || 'Failed to load group')
      }
    } catch {
      setError('Failed to load group')
    } finally {
      setLoading(false)
    }
  }, [group_id])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  async function submitGroupPoll() {
    if (!group_id || pollModalPostId == null) return
    const opts = pollOptions.map((s) => s.trim()).filter(Boolean)
    if (!pollQuestion.trim() || opts.length < 2) {
      alert('Add a question and at least two options')
      return
    }
    setPollSaving(true)
    try {
      const gid = parseInt(String(group_id), 10)
      const r = await fetch('/api/group_polls/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          group_id: gid,
          group_post_id: pollModalPostId,
          question: pollQuestion.trim(),
          options: opts,
          single_vote: pollSingle,
        }),
      })
      const j = await r.json().catch(() => null)
      if (!j?.success) {
        alert(j?.error || 'Could not create poll')
        return
      }
      setPollModalPostId(null)
      await loadFeed()
    } finally {
      setPollSaving(false)
    }
  }

  async function runSearch() {
    const term = (q || '').trim().replace(/^#+/, '')
    if (!term || !group_id) {
      setResults([])
      return
    }
    try {
      const r = await fetch(`/api/group_posts_search?group_id=${group_id}&q=${encodeURIComponent(term)}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const j = await r.json().catch(() => null)
      if (j?.success) setResults(j.posts || [])
      else setResults([])
    } catch {
      setResults([])
    }
  }

  function scrollToGroupPost(postId: number) {
    try {
      const el = document.getElementById(`group-post-${postId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setShowSearch(false)
    } catch {}
  }

  const goBackFromGroupFeed = () => {
    const cid = communityMeta?.id
    if (cid) navigate(`/communities?parent_id=${cid}`)
    else navigate('/premium_dashboard')
  }

  const fixedFeedHeader = (
    <div
      className="fixed left-0 right-0 top-0 z-[1000] border-b border-white/10"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: '#000',
      }}
    >
      <div className="h-14 flex items-center gap-2 px-3 max-w-2xl mx-auto w-full">
        <button
          type="button"
          className="flex-shrink-0"
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
        >
          <Avatar username={currentUsername} url={userAvatar || undefined} size={32} />
        </button>
        <button
          type="button"
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
          onClick={goBackFromGroupFeed}
          aria-label="Back"
        >
          <i className="fa-solid fa-arrow-left text-white" />
        </button>
        <button
          type="button"
          className="flex-1 min-w-0 rounded-xl px-2 py-1 text-left transition hover:bg-white/[0.04] focus:outline-none focus:ring-1 focus:ring-[#4db6ac]/50"
          onClick={() => setGroupInfoOpen((o) => !o)}
          aria-expanded={groupInfoOpen}
          aria-label="Group details"
        >
          <div className="font-semibold truncate text-white text-sm">{groupName || 'Group'}</div>
          {communityMeta?.name ? (
            <div className="text-xs text-[#9fb0b5] truncate">{communityMeta.name}</div>
          ) : (
            <div className="text-xs text-[#9fb0b5] truncate">Tap for details</div>
          )}
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Search"
            onClick={() => {
              setShowSearch(true)
              setTimeout(() => {
                try {
                  (document.getElementById('group-feed-hashtag-input') as HTMLInputElement)?.focus()
                } catch {}
              }, 50)
            }}
          >
            <i className="fa-solid fa-magnifying-glass text-white" />
          </button>
          <button
            type="button"
            className="relative p-2 rounded-full hover:bg-white/10 transition-colors"
            onClick={() => navigate('/user_chat')}
            aria-label="Messages"
          >
            <i className="fa-solid fa-comments text-white" />
            {unreadMsgs > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#4db6ac] text-black text-[10px] flex items-center justify-center">
                {unreadMsgs > 99 ? '99+' : unreadMsgs}
              </span>
            )}
          </button>
          <button
            type="button"
            className="relative p-2 rounded-full hover:bg-white/10 transition-colors"
            onClick={() => navigate('/notifications')}
            aria-label="Notifications"
          >
            <i className="fa-regular fa-bell text-white" />
            {unreadNotifs > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#4db6ac] text-black text-[10px] flex items-center justify-center">
                {unreadNotifs > 99 ? '99+' : unreadNotifs}
              </span>
            )}
          </button>
        </div>
      </div>
      {groupInfoOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[1000] cursor-default bg-transparent"
            aria-label="Close group details"
            onClick={() => setGroupInfoOpen(false)}
          />
          <div
            className="fixed left-3 right-3 z-[1002] rounded-3xl border border-[#4db6ac]/25 bg-[#070909]/95 p-4 text-white shadow-2xl shadow-black/70 ring-1 ring-white/[0.04] backdrop-blur-md sm:left-1/2 sm:right-auto sm:w-[420px] sm:-translate-x-1/2"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#4db6ac]/80">Group</div>
                <h2 className="mt-1 text-base font-semibold text-white">{groupName || 'Group'}</h2>
                {communityMeta?.name ? (
                  <div className="text-xs text-[#9fb0b5] mt-1">In {communityMeta.name}</div>
                ) : null}
              </div>
              <button
                type="button"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 hover:border-[#4db6ac]/50 hover:text-[#4db6ac]"
                onClick={() => setGroupInfoOpen(false)}
                aria-label="Close group details"
              >
                <i className="fa-solid fa-xmark text-xs" />
              </button>
            </div>
            <p className="text-sm leading-relaxed text-white/75">
              Posts here are visible to members of this group. Use the back control to return to communities.
            </p>
          </div>
        </>
      )}
    </div>
  )

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

  // Check for pending RSVPs (group-scoped calendar)
  useEffect(() => {
    if (!group_id) return
    let mounted = true
    async function check(){
      try{
        const r = await fetch(`/api/group_calendar/${group_id}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
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
  }, [group_id])

  useEffect(() => {
    if (!announcementsOpen || !group_id) return
    let ok = true
    setAnnouncementsLoading(true)
    ;(async () => {
      try {
        const r = await fetch(`/api/group_announcements/${group_id}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const j = await r.json().catch(() => null)
        if (ok && j?.success) setAnnouncements(j.announcements || [])
      } catch {
        if (ok) setAnnouncements([])
      } finally {
        if (ok) setAnnouncementsLoading(false)
      }
    })()
    return () => {
      ok = false
    }
  }, [announcementsOpen, group_id])

  const submitAnnouncement = async () => {
    const text = newAnnouncement.trim()
    if (!text || !group_id) return
    try {
      const r = await fetch(`/api/group_announcements/${group_id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content: text }),
      })
      const j = await r.json().catch(() => null)
      if (j?.success) {
        setNewAnnouncement('')
        const rr = await fetch(`/api/group_announcements/${group_id}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const jj = await rr.json().catch(() => null)
        if (jj?.success) setAnnouncements(jj.announcements || [])
      } else alert(j?.error || 'Failed to post announcement')
    } catch {
      alert('Failed to post announcement')
    }
  }

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
      const r = await fetch(`/api/group_members/${group_id}`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      const j = await r.json()
      if (j?.success) {
        setGroupMembers(j.members || [])
        setCurrentUserRole(j.current_user_role || '')
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
      const r = await fetch(`/api/group_members/${group_id}/available`, { credentials: 'include', headers: { 'Accept': 'application/json' } })
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

  const burgerMenuOverlay = menuOpen ? (
    <div className="fixed inset-0 z-[1001] flex bg-black/50" onClick={(e) => e.currentTarget === e.target && setMenuOpen(false)} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-[90%] h-full bg-black/95 backdrop-blur border-r border-white/10 p-4 space-y-3 text-white overflow-y-auto overscroll-auto" style={{ paddingTop: '1rem', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center gap-2 pb-2 border-b border-white/10">
          <Avatar username={currentUsername} url={userAvatar || undefined} size={40} />
          <div className="font-medium truncate">{currentDisplayName}</div>
        </div>
        {currentUsername === 'admin' ? (
          <>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/admin_profile_react">Admin Profile</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/admin">Admin Dashboard</a>
          </>
        ) : null}
        <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/premium_dashboard">Dashboard</a>
        <button
          type="button"
          className="block w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-white"
          onClick={() => {
            setMenuOpen(false)
            if (currentUsername) navigate(`/profile/${encodeURIComponent(currentUsername)}`)
            else navigate('/profile')
          }}
        >
          My Profile
        </button>
        <button type="button" className="block w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-white" onClick={() => { setMenuOpen(false); navigate('/followers') }}>Followers</button>
        <button type="button" className="block w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-white" onClick={() => { setMenuOpen(false); navigate('/subscription_plans') }}>Subscriptions</button>
        <button type="button" className="block w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 text-white" onClick={requestLogout}>Logout</button>
        <a className="block px-4 py-3 rounded-xl hover:bg-white/5 text-white" href="/account_settings">Account Settings</a>
      </div>
      <div className="flex-1 h-full" onClick={() => setMenuOpen(false)} />
    </div>
  ) : null

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col pb-safe">
        {fixedFeedHeader}
        {burgerMenuOverlay}
        <div
          className="flex-1 flex items-center justify-center text-[#9fb0b5]"
          style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + ${feedScrollHeaderBodyPx}px)` }}
        >
          Loading…
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col pb-safe">
        {fixedFeedHeader}
        {burgerMenuOverlay}
        <div
          className="flex-1 flex items-center justify-center px-4 text-red-400 text-center"
          style={{ paddingTop: `calc(env(safe-area-inset-top, 0px) + ${feedScrollHeaderBodyPx}px)` }}
        >
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white pb-safe">
      {fixedFeedHeader}
      {burgerMenuOverlay}
      {/* Scrollable content area */}
      <div
        ref={scrollRef}
        className="max-w-2xl mx-auto no-scrollbar pb-24 px-3"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          overflowY: 'auto',
          overscrollBehaviorY: 'auto',
          touchAction: 'pan-y',
          paddingTop: `calc(env(safe-area-inset-top, 0px) + ${feedScrollHeaderBodyPx}px + 8px)`,
        }}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-[#9fb0b5] hover:text-white underline-offset-2 hover:underline"
              onClick={()=> {
                const cid = communityMeta?.id
                if (cid) navigate(`/communities?parent_id=${cid}`)
                else navigate('/premium_dashboard')
              }}
            >
              All communities
            </button>
          </div>
          {posts.length === 0 ? (
            <div className="text-sm text-[#9fb0b5]">No posts yet.</div>
          ) : (
            posts.map(p => (
              <div key={p.id} id={`group-post-${p.id}`} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer" onClick={()=> navigate(`/post/${p.id}`)}>
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                  <Avatar username={p.username} url={p.profile_picture || undefined} size={28} linkToProfile />
                  <div className="font-medium">{p.username}</div>
                  <div className="text-xs text-[#9fb0b5] ml-auto">{formatSmartTime((p as any).display_timestamp || p.timestamp)}</div>
                  <div className="ml-1 flex items-center gap-0.5">
                    <button
                      type="button"
                      className="p-1.5 rounded-full hover:bg-white/10"
                      aria-label={p.is_starred ? 'Remove from your key posts' : 'Add to your key posts'}
                      onClick={async (e) => {
                        e.stopPropagation()
                        try {
                          const fd = new URLSearchParams({ group_id: String(group_id), group_post_id: String(p.id) })
                          const r = await fetch('/api/toggle_group_key_post', { method: 'POST', credentials: 'include', body: fd })
                          const j = await r.json().catch(() => null)
                          if (j?.success) setPosts((list) => list.map((it) => (it.id === p.id ? { ...it, is_starred: !!j.starred } : it)))
                          else alert(j?.error || 'Failed')
                        } catch {}
                      }}
                    >
                      <i
                        className={p.is_starred ? 'fa-solid fa-star' : 'fa-regular fa-star'}
                        style={{ color: p.is_starred ? '#4db6ac' : '#6c757d', fontSize: '0.85rem' }}
                      />
                    </button>
                    {p.can_toggle_community_key ? (
                      <button
                        type="button"
                        className="p-1.5 rounded-full hover:bg-white/10"
                        aria-label={p.is_community_starred ? 'Remove community key post' : 'Pin as community key post'}
                        onClick={async (e) => {
                          e.stopPropagation()
                          try {
                            const fd = new URLSearchParams({ group_id: String(group_id), group_post_id: String(p.id) })
                            const r = await fetch('/api/toggle_group_community_key_post', { method: 'POST', credentials: 'include', body: fd })
                            const j = await r.json().catch(() => null)
                            if (j?.success) {
                              setPosts((list) => list.map((it) => (it.id === p.id ? { ...it, is_community_starred: !!j.starred } : it)))
                            } else alert(j?.error || 'Failed')
                          } catch {}
                        }}
                      >
                        <i
                          className="fa-solid fa-thumbtack"
                          style={{ color: p.is_community_starred ? '#4db6ac' : '#6c757d', fontSize: '0.85rem' }}
                        />
                      </button>
                    ) : null}
                  </div>
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
                      {p.can_edit && !p.poll ? (
                        <button
                          className="ml-2 px-2 py-1 rounded-full text-[#6c757d] hover:text-[#4db6ac]"
                          aria-label="Add poll to post"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPollQuestion('')
                            setPollOptions(['', ''])
                            setPollSingle(true)
                            setPollModalPostId(p.id)
                          }}
                        >
                          <i className="fa-solid fa-chart-bar" />
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
                    (() => {
                      const videoEmbed = extractVideoEmbedFromPost(p.content, p.link_urls)
                      const displayContent = videoEmbed ? removeVideoUrlFromText(p.content, videoEmbed) : p.content
                      return (
                        <>
                          {displayContent.trim() ? (
                            <div className="whitespace-pre-wrap text-[14px] leading-relaxed">
                              {renderTextWithLinks(displayContent, undefined, mentionToProfile, { sourcesSmallLinks: true, onExternalClick: openExternalArticle })}
                            </div>
                          ) : null}
                          {videoEmbed ? <VideoEmbed embed={videoEmbed} /> : null}
                        </>
                      )
                    })()
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
                  {p.video_path ? (
                    <video
                      src={(() => {
                        const vp = String(p.video_path || '').trim()
                        if (!vp) return ''
                        if (vp.startsWith('http') || vp.startsWith('/')) return vp
                        return `/uploads/${vp}`
                      })()}
                      controls
                      className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10"
                    />
                  ) : null}
                  {p.poll ? (
                    <div className="space-y-2 pt-1" onClick={(e)=> e.stopPropagation()}>
                      <div className="flex items-center gap-2 mb-1">
                        <i className="fa-solid fa-chart-bar text-[#4db6ac]" />
                        <div className="font-medium text-sm flex-1">
                          {p.poll.question}
                          {p.poll.expires_at ? (
                            <span className="ml-2 text-[11px] text-[#9fb0b5]">
                              • closes{' '}
                              {(() => {
                                try {
                                  const d = new Date(p.poll.expires_at as string)
                                  if (!isNaN(d.getTime())) return d.toLocaleDateString()
                                } catch { /* noop */ }
                                return String(p.poll.expires_at)
                              })()}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {p.poll.options?.map((option) => {
                          const total = p.poll!.total_votes || 0
                          const percentage = total ? Math.round((option.votes / total) * 100) : 0
                          const isUserVote = option.user_voted || false
                          const isClosed = p.poll!.is_active === 0
                          const isExpiredByTime = (() => {
                            try {
                              const raw = p.poll?.expires_at
                              if (!raw) return false
                              const d = new Date(raw as string)
                              return !isNaN(d.getTime()) && Date.now() >= d.getTime()
                            } catch {
                              return false
                            }
                          })()
                          const isExpired = isClosed || isExpiredByTime
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={isExpired}
                              className={`w-full text-left px-3 py-2 rounded-lg border relative overflow-hidden ${isExpired ? 'opacity-60 cursor-not-allowed' : isUserVote ? 'border-[#4db6ac] bg-[#4db6ac]/10' : 'border-white/10 hover:bg-white/5'}`}
                              onClick={async (e) => {
                                if (isExpired) return
                                e.preventDefault()
                                e.stopPropagation()
                                try {
                                  setPosts((list) =>
                                    list.map((it) => {
                                      if (it.id !== p.id || !it.poll) return it
                                      const poll = it.poll
                                      const clicked = poll.options.find((o) => o.id === option.id)
                                      const hasVoted = clicked?.user_voted || false
                                      const sv = poll.single_vote
                                      const isSingle = !!(sv === true || sv === 1 || sv === '1' || sv === 'true')
                                      const nextOpts = poll.options.map((o) => {
                                        if (o.id === option.id) {
                                          return {
                                            ...o,
                                            votes: hasVoted ? Math.max(0, o.votes - 1) : o.votes + 1,
                                            user_voted: !hasVoted,
                                          }
                                        }
                                        if (isSingle && o.user_voted) {
                                          return { ...o, votes: Math.max(0, o.votes - 1), user_voted: false }
                                        }
                                        return o
                                      })
                                      const newUserVote = isSingle ? (hasVoted ? null : option.id) : poll.user_vote
                                      const totalVotes = nextOpts.reduce((a, b) => a + (b.votes || 0), 0)
                                      return { ...it, poll: { ...poll, options: nextOpts, user_vote: newUserVote, total_votes: totalVotes } }
                                    }),
                                  )
                                  const res = await fetch('/api/group_poll_vote', {
                                    method: 'POST',
                                    credentials: 'include',
                                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                    body: JSON.stringify({ group_poll_id: p.poll!.id, option_id: option.id }),
                                  })
                                  const j = await res.json().catch(() => null)
                                  if (j?.success && Array.isArray(j.poll_results)) {
                                    setPosts((list) =>
                                      list.map((it) => {
                                        if (it.id !== p.id || !it.poll) return it
                                        const rows = j.poll_results as Array<Record<string, unknown>>
                                        const newOpts = it.poll.options.map((o) => {
                                          const row = rows.find((r) => Number(r.id) === o.id) as { votes?: number; user_voted?: boolean } | undefined
                                          return row
                                            ? { ...o, votes: Number(row.votes) || 0, user_voted: !!row.user_voted }
                                            : o
                                        })
                                        const first = rows[0] as { user_vote?: number | null; total_votes?: number } | undefined
                                        const newUserVote =
                                          typeof first?.user_vote !== 'undefined' ? first.user_vote ?? null : it.poll.user_vote
                                        const totalVotes =
                                          typeof first?.total_votes === 'number'
                                            ? first.total_votes
                                            : newOpts.reduce((a, b) => a + (b.votes || 0), 0)
                                        return { ...it, poll: { ...it.poll, options: newOpts, user_vote: newUserVote, total_votes: totalVotes } }
                                      }),
                                    )
                                  }
                                } catch { /* noop */ }
                              }}
                            >
                              <div className="absolute inset-0 bg-[#4db6ac]/20" style={{ width: `${percentage}%`, transition: 'width 0.3s ease' }} />
                              <div className="relative flex items-center justify-between">
                                <span className="text-sm">{option.text || option.option_text}</span>
                                <span className="text-xs text-[#9fb0b5] font-medium">
                                  {option.votes} {percentage > 0 ? `(${percentage}%)` : ''}
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex items-center justify-between text-xs text-[#9fb0b5] pt-1">
                        {(() => {
                          const sv = p.poll?.single_vote
                          const isSingle = !(sv === false || sv === 0 || sv === '0' || sv === 'false')
                          return isSingle ? <span>{p.poll.total_votes || 0} {p.poll.total_votes === 1 ? 'vote' : 'votes'}</span> : <span />
                        })()}
                      </div>
                    </div>
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
            <button className="relative p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="Announcements" onClick={() => setAnnouncementsOpen(true)}>
              <span className="relative inline-block">
                <i className="fa-solid fa-bullhorn text-lg" />
              </span>
            </button>
            <button className="relative p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors" aria-label="More" onClick={()=> setMoreOpen(true)}>
              <span className="relative inline-block">
                <i className="fa-solid fa-ellipsis text-lg" />
                {(hasUnseenDocs || hasPendingRsvps) && (
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
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5 flex items-center justify-end gap-2" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/calendar_react?group_id=${group_id}`) }}>
              Calendar
              {hasPendingRsvps && <span className="w-2 h-2 bg-[#4db6ac] rounded-full" />}
            </button>
            {showTasks && (
              <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/tasks_react?group_id=${group_id}`) }}>Tasks</button>
            )}
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/photos_react?group_id=${group_id}`) }}>Media</button>
            <button className="w-full text-right px-4 py-3 rounded-xl hover:bg-white/5 flex items-center justify-end gap-2" onClick={()=> { setMoreOpen(false); navigate(`/community/${communityId}/useful_links_react?group_id=${group_id}`) }}>
              Useful Links & Docs
              {hasUnseenDocs && <span className="w-2 h-2 bg-[#4db6ac] rounded-full" />}
            </button>
            {group_id && <ManageGroupButton groupId={group_id} onClose={()=> setMoreOpen(false)} />}
          </div>
        </div>
      )}

      {announcementsOpen && (
        <div className="fixed inset-0 z-[120] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={(e) => e.currentTarget === e.target && setAnnouncementsOpen(false)}>
          <div className="w-full max-w-lg max-h-[85vh] rounded-2xl border border-white/10 bg-[#0a0a0a] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h2 className="text-base font-semibold text-white">Announcements</h2>
              <button type="button" className="p-2 rounded-full hover:bg-white/10 text-[#9fb0b5]" aria-label="Close" onClick={() => setAnnouncementsOpen(false)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {announcementsLoading ? (
                <div className="text-sm text-[#9fb0b5]">Loading…</div>
              ) : announcements.length === 0 ? (
                <div className="text-sm text-[#9fb0b5]">No announcements yet.</div>
              ) : (
                announcements.map((a) => (
                  <div key={a.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="text-xs text-[#9fb0b5] mb-1">@{a.created_by} · {formatSmartTime(a.created_at)}</div>
                    <div className="text-sm text-white/90 whitespace-pre-wrap">{a.content}</div>
                  </div>
                ))
              )}
            </div>
            {capabilities.can_post_announcements ? (
              <div className="border-t border-white/10 p-3 space-y-2">
                <textarea
                  className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm text-white placeholder:text-[#6c757d] min-h-[72px] focus:border-teal-400/70 outline-none"
                  placeholder="Post an announcement…"
                  value={newAnnouncement}
                  onChange={(e) => setNewAnnouncement(e.target.value)}
                />
                <button
                  type="button"
                  className="w-full py-2.5 rounded-xl bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110"
                  onClick={() => void submitAnnouncement()}
                >
                  Publish
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Hashtag / text search (group posts) */}
      {showSearch && (
        <div className="fixed inset-0 z-[115] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e) => e.currentTarget === e.target && setShowSearch(false)}>
          <div className="w-[92%] max-w-[560px] rounded-2xl border border-white/10 bg-black p-3">
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-hashtag text-[#4db6ac]" />
              <input
                id="group-feed-hashtag-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="#hashtag or text"
                className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none"
              />
              <button type="button" className="px-3 py-2 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={() => void runSearch()}>
                Search
              </button>
            </div>
            <div className="max-h-[320px] overflow-y-auto space-y-2">
              {results.length === 0 ? (
                <div className="text-[#9fb0b5] text-sm">No results</div>
              ) : (
                results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="w-full text-left rounded-xl border border-white/10 p-2 hover:bg-white/5"
                    onClick={() => scrollToGroupPost(r.id)}
                  >
                    <div className="text-sm text-white/90 truncate">{r.content}</div>
                    <div className="text-xs text-[#9fb0b5]">
                      {r.username} — {formatSmartTime(r.timestamp)}
                    </div>
                  </button>
                ))
              )}
            </div>
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

      {pollModalPostId != null && (
        <div
          className="fixed inset-0 z-[125] bg-black/70 flex items-end sm:items-center justify-center p-3"
          onClick={(e) => e.currentTarget === e.target && setPollModalPostId(null)}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-semibold text-white">Add poll</div>
              <button type="button" className="p-2 rounded-full hover:bg-white/10 text-[#9fb0b5]" aria-label="Close" onClick={()=> setPollModalPostId(null)}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <label className="block text-xs text-[#9fb0b5] mb-1">Question</label>
            <input
              value={pollQuestion}
              onChange={(e)=> setPollQuestion(e.target.value)}
              className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm text-white mb-3"
              placeholder="What do you want to ask?"
            />
            <div className="text-xs text-[#9fb0b5] mb-1">Options (at least 2)</div>
            <div className="space-y-2 mb-3">
              {pollOptions.map((opt, idx) => (
                <input
                  key={idx}
                  value={opt}
                  onChange={(e)=> setPollOptions((prev)=> { const n = [...prev]; n[idx] = e.target.value; return n })}
                  className="w-full rounded-lg bg-black border border-white/10 px-3 py-2 text-sm text-white"
                  placeholder={`Option ${idx + 1}`}
                />
              ))}
            </div>
            {pollOptions.length < 6 && (
              <button
                type="button"
                className="text-xs text-[#4db6ac] mb-3 hover:underline"
                onClick={()=> setPollOptions((prev)=> [...prev, ''])}
              >
                + Add option
              </button>
            )}
            <label className="flex items-center gap-2 text-sm text-white/90 mb-4 cursor-pointer">
              <input type="checkbox" checked={pollSingle} onChange={(e)=> setPollSingle(e.target.checked)} />
              Single choice only
            </label>
            <button
              type="button"
              disabled={pollSaving}
              className="w-full py-2.5 rounded-xl bg-[#4db6ac] text-black text-sm font-medium hover:brightness-110 disabled:opacity-50"
              onClick={()=> void submitGroupPoll()}
            >
              {pollSaving ? 'Saving…' : 'Create poll'}
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
