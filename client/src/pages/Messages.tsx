import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import Avatar from '../components/Avatar'
import ParentCommunityPicker from '../components/ParentCommunityPicker'
import GroupChatCreator from '../components/GroupChatCreator'
import { readDeviceCache, writeDeviceCache } from '../utils/deviceCache'

type Thread = {
  other_username: string
  display_name: string
  profile_picture_url: string | null
  last_message_text: string | null
  last_activity_time: string | null
  last_sender?: string | null
  unread_count?: number
  is_archived?: boolean
}

type CommunityNode = {
  id: number
  name: string
  members: string[]
  children: CommunityNode[]
}

// Cache keys and settings
const THREADS_CACHE_KEY = 'chat-threads-list'
const COMMUNITIES_CACHE_KEY = 'chat-communities-tree'
const CACHE_VERSION = 'v1'
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// Format last message for preview - handles story replies and regular replies
function formatLastMessagePreview(text: string | null): string {
  if (!text) return 'Say hello'
  
  // Check for story reply format: [STORY_REPLY:id:emoji:mediaPath]\n<message>
  const storyReplyMatch = text.match(/^\[STORY_REPLY:[^\]]+\]\n(.*)$/s)
  if (storyReplyMatch) {
    const actualMessage = storyReplyMatch[1]?.trim()
    return actualMessage ? `Replied to story: ${actualMessage}` : 'Replied to a story'
  }
  
  // Check for regular reply format: [REPLY:sender:snippet]\n<message>
  const replyMatch = text.match(/^\[REPLY:[^\]]+\]\n(.*)$/s)
  if (replyMatch) {
    return replyMatch[1]?.trim() || text
  }
  
  return text
}

export default function Messages(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    setTitle('Messages')
    return () => setTitle('')
  }, [setTitle])

  // Load cached threads immediately for instant display
  const [threads, setThreads] = useState<Thread[]>(() => {
    const cached = readDeviceCache<Thread[]>(THREADS_CACHE_KEY, CACHE_VERSION)
    return cached || []
  })
  // Only show loading if no cached data
  const [loading, setLoading] = useState(() => {
    const cached = readDeviceCache<Thread[]>(THREADS_CACHE_KEY, CACHE_VERSION)
    return !cached || cached.length === 0
  })
  const [activeTab, setActiveTab] = useState<'chats'|'new'>('chats')
  const [swipeId, setSwipeId] = useState<string|null>(null)
  const [dragX, setDragX] = useState(0)
  const startXRef = useRef(0)
  const draggingIdRef = useRef<string|null>(null)
  // Load cached communities immediately
  const [communityTree, setCommunityTree] = useState<CommunityNode[]>(() => {
    const cached = readDeviceCache<CommunityNode[]>(COMMUNITIES_CACHE_KEY, CACHE_VERSION)
    return cached || []
  })
  const [communitiesLoading, setCommunitiesLoading] = useState(() => {
    const cached = readDeviceCache<CommunityNode[]>(COMMUNITIES_CACHE_KEY, CACHE_VERSION)
    return !cached
  })
  const [communityFilter, setCommunityFilter] = useState<'all' | number>('all')
  const [subCommunityFilter, setSubCommunityFilter] = useState<number | null>(null)
  const [communityError, setCommunityError] = useState<string | null>(null)
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null)
  
  // Archived chats
  const [showArchived, setShowArchived] = useState(false)
  const [archivedThreads, setArchivedThreads] = useState<Thread[]>([])
  const [archivedLoading, setArchivedLoading] = useState(false)
  
  // Group chats
  type GroupChat = {
    id: number
    name: string
    member_count: number
    last_message: { sender: string; text: string; time: string } | null
    unread_count: number
  }
  const [groupChats, setGroupChats] = useState<GroupChat[]>([])
  const [_groupChatsLoading, setGroupChatsLoading] = useState(false)
  void _groupChatsLoading // Suppress unused warning - reserved for future loading state

  // Fetch threads with caching
  const loadThreads = useCallback((silent: boolean = false) => {
    if (!silent) setLoading(true)
    fetch('/api/chat_threads', { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        if (j?.success && Array.isArray(j.threads)) {
          const newThreads = j.threads as Thread[]
          // Cache the fresh data
          writeDeviceCache(THREADS_CACHE_KEY, newThreads, CACHE_TTL_MS, CACHE_VERSION)
          
          setThreads(prev => {
            const a = prev
            const b = newThreads
            if (a.length !== b.length) return b
            const changed = a.some((x, idx) => {
              const y = b[idx]
              return !y || x.other_username !== y.other_username || x.last_message_text !== y.last_message_text || x.last_activity_time !== y.last_activity_time || (x.unread_count || 0) !== (y.unread_count || 0)
            })
            return changed ? b : a
          })
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [])

  // Load archived threads
  const loadArchivedThreads = useCallback(() => {
    setArchivedLoading(true)
    fetch('/api/archived_chats', { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        if (j?.success && Array.isArray(j.threads)) {
          setArchivedThreads(j.threads)
        }
      })
      .catch(() => {})
      .finally(() => setArchivedLoading(false))
  }, [])

  // Load group chats
  const loadGroupChats = useCallback((silent = false) => {
    if (!silent) setGroupChatsLoading(true)
    fetch('/api/group_chat/list', { credentials: 'include' })
      .then(r => r.json())
      .then(j => {
        if (j?.success && Array.isArray(j.groups)) {
          setGroupChats(j.groups)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!silent) setGroupChatsLoading(false)
      })
  }, [])

  // Archive a chat
  const archiveChat = useCallback((otherUsername: string) => {
    const fd = new URLSearchParams({ other_username: otherUsername })
    fetch('/api/archive_chat', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd })
      .then(r => r.json())
      .then(j => {
        if (j?.success) {
          const archivedThread = threads.find(t => t.other_username === otherUsername)
          if (archivedThread) {
            setArchivedThreads(prev => [{ ...archivedThread, is_archived: true }, ...prev])
          }
          setThreads(prev => prev.filter(t => t.other_username !== otherUsername))
          setSwipeId(null)
          loadThreads(true)
          loadArchivedThreads()
        }
      })
      .catch(() => {})
  }, [threads, loadThreads, loadArchivedThreads])

  // Unarchive a chat
  const unarchiveChat = useCallback((otherUsername: string) => {
    const fd = new URLSearchParams({ other_username: otherUsername })
    fetch('/api/unarchive_chat', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd })
      .then(r => r.json())
      .then(j => {
        if (j?.success) {
          // Remove from archived
          setArchivedThreads(prev => prev.filter(t => t.other_username !== otherUsername))
          setSwipeId(null)
          // Refresh threads
          loadThreads(true)
        }
      })
      .catch(() => {})
  }, [loadThreads])

  useEffect(() => {
    // Fetch fresh data immediately (non-silent to ensure UI updates quickly)
    loadThreads(false)
    loadGroupChats(false)
    
    // Also load archived chats count on mount
    loadArchivedThreads()
    
    // Sync badge when viewing messages list (ensures badge reflects actual unread count)
    const syncBadge = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          await PushNotifications.removeAllDeliveredNotifications()
          console.log('✅ Cleared iOS notifications on messages page')
        } catch (e) {
          console.warn('Could not clear iOS notifications:', e)
        }
      }
      // Sync badge with server
      try {
        const resp = await fetch('/api/notifications/clear-badge', { method: 'POST', credentials: 'include' })
        const result = await resp.json()
        console.log('📛 Badge sync on messages page:', result)
      } catch (e) {
        console.warn('Badge sync failed:', e)
      }
    }
    syncBadge()
    
    const onVis = () => {
      if (!document.hidden) {
        loadThreads(true)
        loadGroupChats(true)
        syncBadge() // Also sync badge when returning to app
      }
    }
    document.addEventListener('visibilitychange', onVis)
    
    // Handle navigation back (popstate fires when user presses back/forward)
    const onPopState = () => {
      console.log('🔙 Detected back navigation, refreshing threads')
      loadThreads(false) // Non-silent refresh on back navigation
      loadGroupChats(false)
    }
    window.addEventListener('popstate', onPopState)
    
    // Poll every 3 seconds for faster updates (was 5s)
    const t = setInterval(() => {
      loadThreads(true)
      loadGroupChats(true)
    }, 3000)
    
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('popstate', onPopState)
      clearInterval(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadThreads, loadArchivedThreads, loadGroupChats, location.key])

  // Function to fetch communities with optional cache-busting
  const fetchCommunitiesData = useCallback(async (forceRefresh = false) => {
    const cacheBuster = forceRefresh ? `_nocache=${Date.now()}` : ''
    const appendParam = (url: string) => forceRefresh ? `${url}?${cacheBuster}` : url
    
    const [membersRes, hierarchyRes] = await Promise.all([
      fetch(appendParam('/get_user_communities_with_members'), { 
        credentials: 'include',
        ...(forceRefresh ? { cache: 'no-store' as const } : {})
      }).then(r => r.json()).catch(() => null),
      fetch(appendParam('/api/user_communities_hierarchical'), { 
        credentials: 'include',
        ...(forceRefresh ? { cache: 'no-store' as const } : {})
      }).then(r => r.json()).catch(() => null),
    ])

    if (membersRes?.success && Array.isArray(membersRes.communities)) {
      const membership = new Map<number, { name: string; members: string[] }>()
      membersRes.communities.forEach((c: any) => {
        const id = Number(c.id)
        const name = String(c.name || '')
        const members = Array.isArray(c.members) ? c.members.map((m: any) => String(m.username || '')).filter(Boolean) : []
        membership.set(id, { name, members })
      })

      const buildNodes = (nodes: any[]): CommunityNode[] =>
        nodes.map((node: any) => {
          const id = Number(node.id)
          const info = membership.get(id) || { name: String(node.name || node.title || ''), members: [] }
          const children = Array.isArray(node.children) ? buildNodes(node.children) : []
          return { id, name: info.name, members: info.members, children }
        })

      let tree: CommunityNode[] = []
      if (hierarchyRes?.success && Array.isArray(hierarchyRes.communities)) {
        tree = buildNodes(hierarchyRes.communities)
      } else {
        tree = Array.from(membership.entries()).map(([id, info]) => ({
          id,
          name: info.name,
          members: info.members,
          children: [],
        }))
      }

      const existingIds = new Set<number>()
      const collectIds = (nodes: CommunityNode[]) => {
        nodes.forEach(node => {
          existingIds.add(node.id)
          if (node.children.length) collectIds(node.children)
        })
      }
      collectIds(tree)

      membership.forEach((info, id) => {
        if (!existingIds.has(id)) {
          tree.push({ id, name: info.name, members: info.members, children: [] })
        }
      })

      return { success: true, tree }
    }
    
    return { success: false, error: membersRes?.error || 'Failed to load communities' }
  }, [])

  // Refresh communities on visibility change (when returning to app)
  useEffect(() => {
    const onVis = async () => {
      if (!document.hidden) {
        // Silently refresh communities when returning to the app
        try {
          const result = await fetchCommunitiesData(true) // Force refresh
          if (result.success && result.tree) {
            writeDeviceCache(COMMUNITIES_CACHE_KEY, result.tree, CACHE_TTL_MS, CACHE_VERSION)
            setCommunityTree(result.tree)
          }
        } catch {
          // Silent fail - keep showing cached data
        }
      }
    }
    document.addEventListener('visibilitychange', onVis)
    
    return () => {
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [fetchCommunitiesData])

  useEffect(() => {
    let cancelled = false
    // Only show loading if no cached data
    const hasCachedCommunities = communityTree.length > 0
    if (!hasCachedCommunities) {
      setCommunitiesLoading(true)
    }
    setCommunityError(null)

    async function fetchCommunities() {
      if (cancelled) return
      try {
        const result = await fetchCommunitiesData(false)
        if (cancelled) return

        if (result.success && result.tree) {
          // Cache the community tree
          writeDeviceCache(COMMUNITIES_CACHE_KEY, result.tree, CACHE_TTL_MS, CACHE_VERSION)
          setCommunityTree(result.tree)
        } else {
          // Only clear if we don't have cached data
          if (!hasCachedCommunities) {
            setCommunityTree([])
          }
          setCommunityError(result.error || 'Failed to load communities')
        }
      } catch {
        if (cancelled) {
          return
        }
        // Only clear if we don't have cached data
        if (!hasCachedCommunities) {
          setCommunityTree([])
        }
        setCommunityError('Failed to load communities')
      } finally {
        if (!cancelled) {
          setCommunitiesLoading(false)
        }
      }
    }

    fetchCommunities()
    return () => { cancelled = true }
  }, [fetchCommunitiesData])

  const nodeById = useMemo(() => {
    const map = new Map<number, CommunityNode>()
    const traverse = (nodes: CommunityNode[]) => {
      nodes.forEach(node => {
        map.set(node.id, node)
        if (node.children.length) traverse(node.children)
      })
    }
    traverse(communityTree)
    return map
  }, [communityTree])

  const parentMap = useMemo(() => {
    const map = new Map<number, number | null>()
    const traverse = (nodes: CommunityNode[], parentId: number | null) => {
      nodes.forEach(node => {
        map.set(node.id, parentId)
        if (node.children.length) traverse(node.children, node.id)
      })
    }
    traverse(communityTree, null)
    return map
  }, [communityTree])

  const isDescendant = useCallback(
    (childId: number, ancestorId: number) => {
      let current: number | null | undefined = childId
      while (current != null) {
        const parentId: number | null = parentMap.get(current) ?? null
        if (parentId === ancestorId) return true
        current = parentId
      }
      return false
    },
    [parentMap],
  )

  useEffect(() => {
    if (communityFilter === 'all') {
      setSubCommunityFilter(null)
      setOpenDropdownId(null)
      return
    }
    if (!nodeById.has(communityFilter)) {
      setCommunityFilter('all')
      setSubCommunityFilter(null)
      setOpenDropdownId(null)
    }
  }, [communityFilter, nodeById])

  useEffect(() => {
    if (communityFilter === 'all') {
      if (subCommunityFilter !== null) setSubCommunityFilter(null)
      return
    }
    const communityId = communityFilter
    if (subCommunityFilter !== null) {
      if (!nodeById.has(subCommunityFilter) || (subCommunityFilter !== communityId && !isDescendant(subCommunityFilter, communityId))) {
        setSubCommunityFilter(null)
      }
    }
  }, [communityFilter, subCommunityFilter, nodeById, isDescendant])

  const collectMembers = useCallback((node: CommunityNode, target: Set<string>) => {
    node.members.forEach(m => target.add(m))
    node.children.forEach(child => collectMembers(child, target))
  }, [])

  const filteredThreads = useMemo(() => {
    if (communityFilter === 'all') return threads
    const communityId = communityFilter
    const communityNode = nodeById.get(communityId)
    if (!communityNode) return threads

    const usernames = new Set<string>()
    if (subCommunityFilter !== null && (subCommunityFilter === communityId || isDescendant(subCommunityFilter, communityId))) {
      const subNode = nodeById.get(subCommunityFilter)
      if (subNode) collectMembers(subNode, usernames)
    } else {
      collectMembers(communityNode, usernames)
    }

    if (usernames.size === 0) return []
    return threads.filter(t => usernames.has(t.other_username))
  }, [threads, communityFilter, subCommunityFilter, nodeById, isDescendant, collectMembers])

  const visibleThreads = filteredThreads

  const activeCommunityId = communityFilter === 'all' ? null : communityFilter
  const selectedCommunityNode = activeCommunityId !== null ? nodeById.get(activeCommunityId) : null
  const selectedSubNode =
    subCommunityFilter !== null &&
    selectedCommunityNode &&
    activeCommunityId !== null &&
    (subCommunityFilter === activeCommunityId || isDescendant(subCommunityFilter, activeCommunityId))
      ? nodeById.get(subCommunityFilter)
      : null

  const filterSummary =
    communityFilter === 'all'
      ? `Showing ${threads.length} chat${threads.length === 1 ? '' : 's'}`
      : selectedSubNode
        ? `Filtered to ${selectedSubNode.name} (${visibleThreads.length} chat${visibleThreads.length === 1 ? '' : 's'})`
        : `Filtered to ${selectedCommunityNode?.name ?? 'community'} (${visibleThreads.length} chat${visibleThreads.length === 1 ? '' : 's'})`

  const renderSubOptions = (nodes: CommunityNode[], depth: number, rootId: number): ReactNode[] =>
    nodes.flatMap(node => {
      const padding = 12 + depth * 12
      const selected = subCommunityFilter === node.id
      const option = (
        <button
          key={`${rootId}-${node.id}`}
          type="button"
          onClick={() => {
            setCommunityFilter(rootId)
            setSubCommunityFilter(node.id)
            setOpenDropdownId(null)
          }}
          className={`flex w-full items-center gap-2 px-3 py-2 text-xs text-white/80 hover:bg-white/10 ${selected ? 'bg-white/10 text-[#4db6ac]' : ''}`}
          style={{ paddingLeft: `${padding}px` }}
        >
          <span className="truncate">{node.name}</span>
        </button>
      )
      if (node.children.length) {
        return [option, ...renderSubOptions(node.children, depth + 1, rootId)]
      }
      return [option]
    })

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Secondary header (match Polls) */}
      <div
        className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))' }}
      >
        <div className="max-w-3xl mx-auto h-full flex items-center gap-2 px-2">
          <button
            className="p-2 rounded-full hover:bg-white/5"
            onClick={() => navigate('/premium_dashboard')}
            aria-label="Back"
          >
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

      <div
        className="app-subnav-offset max-w-3xl mx-auto px-1 sm:px-3 pb-2 overflow-y-auto overscroll-auto"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
        }}
      >
        {activeTab === 'chats' ? (
          <div className="space-y-3">
            <div className="bg-black border border-white/10 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-white/80">Filter by community</div>
                {communitiesLoading ? (
                  <span className="text-xs text-white/50">Loading…</span>
                ) : communityError ? (
                  <span className="text-xs text-red-400">{communityError}</span>
                  ) : communityTree.length === 0 ? (
                    <span className="text-xs text-white/40">No communities available</span>
                ) : (
                    <span className="text-xs text-white/40">{filterSummary}</span>
                )}
                </div>
                <div className="flex gap-2 pb-1 overflow-x-auto overflow-y-visible no-scrollbar whitespace-nowrap">
                <button
                  type="button"
                    onClick={() => {
                      setCommunityFilter('all')
                      setSubCommunityFilter(null)
                      setOpenDropdownId(null)
                    }}
                    className={`px-3 py-1.5 text-xs rounded-full border transition whitespace-nowrap flex-shrink-0 ${
                    communityFilter === 'all'
                      ? 'border-[#4db6ac]/70 bg-[#4db6ac]/20 text-[#4db6ac]'
                      : 'border-white/15 bg-black/60 text-white/70 hover:border-white/25'
                  }`}
                >
                  All
                </button>
                  {communityTree.map(comm => {
                    const selected = communityFilter === comm.id
                    const hasChildren = comm.children.length > 0
                    const open = openDropdownId === comm.id
                    return (
                      <div key={comm.id} className="relative flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setCommunityFilter(comm.id)
                            setSubCommunityFilter(null)
                            setOpenDropdownId(hasChildren ? (open ? null : comm.id) : null)
                          }}
                          className={`px-3 py-1.5 text-xs rounded-full border transition whitespace-nowrap flex items-center gap-1 ${
                            selected
                              ? 'border-[#4db6ac]/70 bg-[#4db6ac]/20 text-[#4db6ac]'
                              : 'border-white/15 bg-black/60 text-white/70 hover:border-white/25'
                          }`}
                          title={comm.members.length ? `${comm.members.length} members` : undefined}
                        >
                          <span className="truncate">{comm.name}</span>
                          {hasChildren ? (
                            <i className={`fa-solid fa-chevron-${selected && open ? 'up' : 'down'} text-[9px]`} />
                          ) : null}
                        </button>
                      </div>
                    )
                  })}
                </div>
            </div>

            {(() => {
              if (openDropdownId !== null) {
                const node = nodeById.get(openDropdownId)
                if (node && node.children.length > 0) {
                  return (
                    <div className="rounded-xl border border-white/10 bg-black p-4 space-y-1">
                      <div className="text-xs text-white/70 mb-2">Filter {node.name}</div>
                      <button
                        type="button"
                        onClick={() => {
                          setCommunityFilter(node.id)
                          setSubCommunityFilter(null)
                          setOpenDropdownId(null)
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-xs text-white/80 hover:bg-white/10 ${subCommunityFilter === null ? 'bg-white/10 text-[#4db6ac]' : ''}`}
                      >
                        <span className="truncate">All {node.name}</span>
                      </button>
                      {renderSubOptions(node.children, 1, node.id)}
                    </div>
                  )
                }
              }
              return (
            <>
            {/* Group Chats Section */}
            {groupChats.length > 0 && communityFilter === 'all' && (
              <div className="rounded-xl border border-white/10 bg-black mb-3">
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                  <i className="fa-solid fa-users text-[#4db6ac] text-sm" />
                  <span className="text-sm font-semibold text-white/80">Group Chats</span>
                  <span className="text-xs text-white/40">({groupChats.length})</span>
                </div>
                <div className="divide-y divide-white/10">
                  {groupChats.map((gc) => (
                    <button
                      key={gc.id}
                      onClick={() => navigate(`/group_chat/${gc.id}`)}
                      className="w-full px-3 py-3 flex items-center gap-3 hover:bg-white/5 text-left"
                    >
                      <div className="w-12 h-12 rounded-full bg-[#4db6ac]/20 flex items-center justify-center flex-shrink-0">
                        <i className="fa-solid fa-users text-[#4db6ac]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="font-medium truncate">{gc.name}</div>
                          {gc.last_message?.time && (
                            <div className="ml-3 flex-shrink-0 text-[11px] text-[#9fb0b5]">
                              {new Date(gc.last_message.time).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        <div className="text-[13px] text-[#9fb0b5] truncate">
                          {gc.last_message ? (
                            <span><span className="font-medium">{gc.last_message.sender}:</span> {gc.last_message.text}</span>
                          ) : (
                            <span>{gc.member_count} members</span>
                          )}
                        </div>
                      </div>
                      {gc.unread_count > 0 && (
                        <div className="ml-2 px-2 h-5 rounded-full bg-[#4db6ac] text-black text-[11px] flex items-center justify-center">
                          {gc.unread_count > 99 ? '99+' : gc.unread_count}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Direct Messages Section */}
            <div className="rounded-xl border border-white/10 bg-black divide-y divide-white/10">
              {groupChats.length > 0 && communityFilter === 'all' && (
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                  <i className="fa-solid fa-user text-[#4db6ac] text-sm" />
                  <span className="text-sm font-semibold text-white/80">Direct Messages</span>
                </div>
              )}
              {loading ? (
                <div className="px-4 py-4 text-sm text-[#9fb0b5]">Loading chats...</div>
              ) : visibleThreads.length === 0 ? (
                <div className="px-4 py-4 text-sm text-[#9fb0b5]">
                  {communityFilter === 'all'
                    ? 'No direct messages yet. Start a new one from the New Message tab.'
                    : 'No chats match this community filter.'}
                </div>
              ) : (
                visibleThreads.map((t) => {
              const isDragging = draggingIdRef.current === t.other_username
              const tx = isDragging ? Math.min(0, dragX) : (swipeId === t.other_username ? -116 : 0)
              const transition = isDragging ? 'none' : 'transform 150ms ease-out'
              const showActions = isDragging ? (dragX < -20) : (swipeId === t.other_username)
              return (
                <div key={t.other_username} className="relative w-full overflow-hidden">
                  {/* Actions (revealed on swipe) */}
                  <div className="absolute inset-y-0 right-0 flex items-stretch gap-1 pr-2" style={{ opacity: showActions ? 1 : 0, pointerEvents: showActions ? 'auto' : 'none', transition: 'opacity 150ms ease-out' }}>
                    <button
                      type="button"
                      onClick={() => archiveChat(t.other_username)}
                      className="my-1 h-[44px] w-[52px] rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 flex items-center justify-center"
                      aria-label="Archive chat"
                    >
                      <i className="fa-solid fa-box-archive" />
                    </button>
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
                              try{
                                const pollFn = (window as any).__header_do_poll
                                if (typeof pollFn === 'function') {
                                  pollFn()
                                }
                              }catch{}
                            }
                          }).catch(()=>{})
                      }}
                      className="my-1 h-[44px] w-[52px] rounded-md bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center justify-center"
                      aria-label="Delete chat"
                    >
                      <i className="fa-solid fa-trash" />
                    </button>
                  </div>

                  {/* Swipeable content */}
                  <button
                    onClick={() => {
                      setThreads(prev => prev.map(x => x.other_username===t.other_username ? { ...x, unread_count: 0 } : x))
                      try{
                        const pollFn = (window as any).__header_do_poll
                        if (typeof pollFn === 'function') {
                          pollFn()
                        }
                      }catch{}
                      navigate(`/user_chat/chat/${encodeURIComponent(t.other_username)}`)
                    }}
                    onTouchStart={(e) => {
                      startXRef.current = e.touches[0].clientX
                      draggingIdRef.current = t.other_username
                      setDragX(swipeId === t.other_username ? -116 : 0)
                    }}
                    onTouchMove={(e) => {
                      if (draggingIdRef.current !== t.other_username) return
                      const dx = e.touches[0].clientX - startXRef.current
                      setDragX(dx)
                    }}
                    onTouchEnd={() => {
                      if (draggingIdRef.current !== t.other_username) return
                      const shouldOpen = dragX <= -80
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
                    <Avatar username={t.other_username} url={t.profile_picture_url || undefined} size={48} linkToProfile displayName={t.display_name} />
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
                        {formatLastMessagePreview(t.last_message_text)}
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
            </>
              )
            })()}
            
            {/* Archived chats section */}
            <div className="mt-6">
              <button
                type="button"
                onClick={() => {
                  if (!showArchived) {
                    loadArchivedThreads()
                  }
                  setShowArchived(!showArchived)
                }}
                className="w-full px-4 py-3 flex items-center justify-between text-left border-t border-white/10"
              >
                <div className="flex items-center gap-2 text-[#9fb0b5]">
                  <i className="fa-solid fa-box-archive text-sm" />
                  <span className="text-sm font-medium">Archived Chats</span>
                  {archivedThreads.length > 0 && (
                    <span className="text-xs text-white/50">({archivedThreads.length})</span>
                  )}
                </div>
                <i className={`fa-solid fa-chevron-${showArchived ? 'up' : 'down'} text-xs text-white/40`} />
              </button>
              
              {showArchived && (
                <div className="border-t border-white/5">
                  {archivedLoading ? (
                    <div className="px-4 py-6 flex items-center justify-center text-[#9fb0b5]">
                      <i className="fa-solid fa-spinner fa-spin mr-2" />
                      Loading archived chats...
                    </div>
                  ) : archivedThreads.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-[#9fb0b5]">
                      No archived chats
                    </div>
                  ) : (
                    archivedThreads.map((t) => {
                      const isDragging = draggingIdRef.current === `archived-${t.other_username}`
                      const tx = isDragging ? Math.min(0, dragX) : (swipeId === `archived-${t.other_username}` ? -60 : 0)
                      const transition = isDragging ? 'none' : 'transform 150ms ease-out'
                      const showActions = isDragging ? (dragX < -20) : (swipeId === `archived-${t.other_username}`)
                      return (
                        <div key={`archived-${t.other_username}`} className="relative w-full overflow-hidden bg-white/5">
                          {/* Unarchive action */}
                          <div className="absolute inset-y-0 right-0 flex items-stretch pr-2" style={{ opacity: showActions ? 1 : 0, pointerEvents: showActions ? 'auto' : 'none', transition: 'opacity 150ms ease-out' }}>
                            <button
                              type="button"
                              onClick={() => unarchiveChat(t.other_username)}
                              className="my-1 h-[44px] w-[52px] rounded-md bg-green-500/20 text-green-300 hover:bg-green-500/30 flex items-center justify-center"
                              aria-label="Unarchive chat"
                            >
                              <i className="fa-solid fa-arrow-up-from-bracket" />
                            </button>
                          </div>

                          <button
                            onClick={() => {
                              navigate(`/user_chat/chat/${encodeURIComponent(t.other_username)}`)
                            }}
                            onTouchStart={(e) => {
                              startXRef.current = e.touches[0].clientX
                              draggingIdRef.current = `archived-${t.other_username}`
                              setDragX(swipeId === `archived-${t.other_username}` ? -60 : 0)
                            }}
                            onTouchMove={(e) => {
                              if (draggingIdRef.current !== `archived-${t.other_username}`) return
                              const dx = e.touches[0].clientX - startXRef.current
                              setDragX(dx)
                            }}
                            onTouchEnd={() => {
                              if (draggingIdRef.current !== `archived-${t.other_username}`) return
                              const shouldOpen = dragX <= -40
                              setSwipeId(shouldOpen ? `archived-${t.other_username}` : null)
                              setDragX(0)
                              draggingIdRef.current = null
                            }}
                            onTouchCancel={() => {
                              if (draggingIdRef.current !== `archived-${t.other_username}`) return
                              setDragX(0)
                              draggingIdRef.current = null
                            }}
                            className="w-full px-3 py-2 flex items-center gap-3 bg-transparent"
                            style={{ transform: `translateX(${tx}px)`, transition }}
                          >
                            <Avatar username={t.other_username} url={t.profile_picture_url || undefined} size={44} displayName={t.display_name} />
                            <div className="flex-1 min-w-0 text-left">
                              <div className="flex items-center justify-between">
                                <div className="font-medium truncate text-white/70">{t.display_name}</div>
                                {t.last_activity_time && (
                                  <div className="ml-3 flex-shrink-0 text-[11px] text-[#9fb0b5]">
                                    {new Date(t.last_activity_time).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                              <div className="text-[13px] text-[#9fb0b5] truncate">
                                {formatLastMessagePreview(t.last_message_text)}
                              </div>
                            </div>
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <NewMessageInline />
        )}
      </div>
    </div>
  )
}

function NewMessageInline(){
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  
  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="rounded-xl border border-white/10 bg-black p-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('direct')}
            className={`flex-1 px-3 py-2 text-sm rounded-lg transition ${
              mode === 'direct'
                ? 'bg-[#4db6ac]/20 border border-[#4db6ac]/50 text-[#4db6ac]'
                : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
            }`}
          >
            <i className="fa-solid fa-user mr-2" />
            Direct Message
          </button>
          <button
            type="button"
            onClick={() => setMode('group')}
            className={`flex-1 px-3 py-2 text-sm rounded-lg transition ${
              mode === 'group'
                ? 'bg-[#4db6ac]/20 border border-[#4db6ac]/50 text-[#4db6ac]'
                : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
            }`}
          >
            <i className="fa-solid fa-users mr-2" />
            Group Chat
          </button>
        </div>
      </div>
      
      {/* Content based on mode */}
      {mode === 'direct' ? (
        <ParentCommunityPicker title="Start a New Message" variant="compact" />
      ) : (
        <GroupChatCreator />
      )}
    </div>
  )
}