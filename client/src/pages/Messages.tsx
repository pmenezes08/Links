import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { formatChatMessagePreview } from '../utils/chatMessagePreview'
import { useHeader } from '../contexts/HeaderContext'
import { useBadges } from '../contexts/BadgeContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import { NativeListRow } from '../components/NativeListRow'
import { SkeletonList } from '../components/SkeletonRow'
import ParentCommunityPicker from '../components/ParentCommunityPicker'
import GroupChatCreator from '../components/GroupChatCreator'
import { readDeviceCache, writeDeviceCache, clearDeviceCache } from '../utils/deviceCache'
import {
  threadsListCacheKey,
  groupChatsListCacheKey,
  communitiesTreeCacheKey,
  dmConversationOfflineKey,
  chatMessagesDeviceCacheKey,
  chatProfileDeviceCacheKey,
} from '../utils/chatThreadsCache'
import { cacheConversations, getCachedConversations, cacheKeyVal, getCachedKeyVal, clearConversationMessages, deleteCachedConversationRow } from '../utils/offlineDb'
import { mergeGroupChatLists, mergeThreadLists } from '../utils/chatThreadListMerge'
import { triggerHaptic } from '../utils/haptics'
import { useHorizontalSwipeLock } from '../hooks/useHorizontalSwipeLock'

type Thread = {
  other_username: string
  display_name: string
  profile_picture_url: string | null
  last_message_text: string | null
  last_activity_time: string | null
  last_sender?: string | null
  unread_count?: number
  is_archived?: boolean
  muted?: boolean
}

type CommunityNode = {
  id: number
  name: string
  members: string[]
  children: CommunityNode[]
}

// Cache settings (keys are viewer-scoped — see chatThreadsCache.ts)
const CACHE_VERSION = 'v1'
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// Format last message for preview - handles story replies, regular replies, and media labels
function formatLastMessagePreview(text: string | null, t: TFunction): string {
  return formatChatMessagePreview(text, t)
}

export default function Messages(){
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  const { refreshBadges, adjustBadges } = useBadges()
  const { profile } = useUserProfile()
  const me = (profile as { username?: string } | null)?.username
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const sharePick = searchParams.get('share_pick') === '1'
  const shareQuery = sharePick ? '?share=1' : ''
  useEffect(() => {
    setTitle(t('chat.page_title'))
    return () => setTitle('')
  }, [setTitle, t])

  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)

  // Hydrate from viewer-scoped caches only (never show another account's thread list).
  useEffect(() => {
    if (!me) {
      setThreads([])
      setCommunityTree([])
      setLoading(true)
      setCommunitiesLoading(true)
      return
    }
    const tCached = readDeviceCache<Thread[]>(threadsListCacheKey(me), CACHE_VERSION)
    setThreads(tCached || [])
    setLoading(!tCached || tCached.length === 0)

    const cCached = readDeviceCache<CommunityNode[]>(communitiesTreeCacheKey(me), CACHE_VERSION)
    setCommunityTree(cCached || [])
    setCommunitiesLoading(!cCached)

    getCachedConversations(me).then(idbThreads => {
      if (idbThreads?.length) {
        setThreads(prev => {
          if (prev.length > 0) return prev
          return idbThreads as Thread[]
        })
      }
      setLoading(false)
    }).catch(() => setLoading(false))

    getCachedKeyVal<GroupChat[]>(groupChatsListCacheKey(me)).then(cached => {
      if (cached?.length) {
        setGroupChats(prev => prev.length >= cached.length ? prev : cached)
      }
    })
  }, [me])
  const [activeTab, setActiveTab] = useState<'chats'|'new'>('chats')
  const [swipeId, setSwipeId] = useState<string|null>(null)
  const [dragX, setDragX] = useState(0)
  const startXRef = useRef(0)
  const draggingIdRef = useRef<string|null>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const [communityTree, setCommunityTree] = useState<CommunityNode[]>([])
  const [communitiesLoading, setCommunitiesLoading] = useState(true)
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
    creator: string
    last_message: { sender: string; text: string; time: string } | null
    unread_count: number
    muted?: boolean
  }
  const [groupChats, setGroupChats] = useState<GroupChat[]>([])
  const [_groupChatsLoading, setGroupChatsLoading] = useState(false)
  void _groupChatsLoading // Suppress unused warning - reserved for future loading state

  // Group chat swipe state
  const [groupSwipeId, setGroupSwipeId] = useState<number | null>(null)
  const [groupDragX, setGroupDragX] = useState(0)
  const groupStartXRef = useRef(0)
  const groupDraggingIdRef = useRef<number | null>(null)
  
  // Collapse/expand state for sections
  const [groupChatsCollapsed, setGroupChatsCollapsed] = useState(false)
  const [directMessagesCollapsed, setDirectMessagesCollapsed] = useState(false)
  const [chatMoreTarget, setChatMoreTarget] = useState<{ type: 'dm' | 'group'; username?: string; groupId?: number; displayName: string } | null>(null)
  const [groupSearchQuery, setGroupSearchQuery] = useState('')
  const [dmSearchQuery, setDmSearchQuery] = useState('')

  // Fetch threads with caching (per logged-in viewer)
  const loadThreads = useCallback((silent: boolean = false) => {
    if (!me) return
    if (!silent) setLoading(true)
    fetch('/api/chat_threads', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(j => {
        if (j?.success && Array.isArray(j.threads)) {
          const newThreads = j.threads as Thread[]
          writeDeviceCache(threadsListCacheKey(me), newThreads, CACHE_TTL_MS, CACHE_VERSION)
          cacheConversations(me, newThreads)
          setThreads(prev => mergeThreadLists(prev, newThreads))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [me])

  // Load archived threads
  const loadArchivedThreads = useCallback(() => {
    setArchivedLoading(true)
    fetch('/api/archived_chats', { credentials: 'include', headers: { 'Accept': 'application/json' } })
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
    if (!me) return
    if (!silent) setGroupChatsLoading(true)
    fetch('/api/group_chat/list', { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(r => r.json())
      .then(j => {
        if (j?.success && Array.isArray(j.groups)) {
          setGroupChats(prev => mergeGroupChatLists(prev, j.groups))
          cacheKeyVal(groupChatsListCacheKey(me), j.groups)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!silent) setGroupChatsLoading(false)
      })
  }, [me])
  
  // Delete group chat (only creator can delete)
  const deleteGroupChat = useCallback((groupId: number) => {
    if (!confirm(t('chat.delete_group_confirm'))) {
      setGroupSwipeId(null)
      return
    }
    
    fetch(`/api/group_chat/${groupId}/delete`, { 
      method: 'POST', 
      credentials: 'include' 
    })
      .then(r => r.json())
      .then(j => {
        if (j?.success) {
          setGroupChats(prev => prev.filter(g => g.id !== groupId))
          setGroupSwipeId(null)
        } else {
          alert(j?.error || t('chat.failed_delete_group'))
          setGroupSwipeId(null)
        }
      })
      .catch(() => {
        alert(t('chat.failed_delete_group'))
        setGroupSwipeId(null)
      })
  }, [t])

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
    if (!me) return
    loadThreads(false)
    loadGroupChats(false)
    loadArchivedThreads()
    refreshBadges()

    const onVis = () => {
      if (!document.hidden) {
        loadThreads(true)
        loadGroupChats(true)
        refreshBadges()
      }
    }
    document.addEventListener('visibilitychange', onVis)

    const onPopState = () => {
      loadThreads(false)
      loadGroupChats(false)
    }
    window.addEventListener('popstate', onPopState)

    const t = setInterval(() => {
      loadThreads(true)
      loadGroupChats(true)
    }, 3000)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('popstate', onPopState)
      clearInterval(t)
    }
  }, [me, loadThreads, loadArchivedThreads, loadGroupChats, location.key, refreshBadges])

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
        headers: { 'Accept': 'application/json' },
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
    
    return { success: false, error: membersRes?.error || t('chat.failed_load_communities') }
  }, [t])

  // No pull-to-refresh on this page: the inbox already polls every 3s and refreshes
  // on visibility/popstate/navigation, and a pull gesture conflicts with the
  // horizontal swipe-to-reveal rows. See the polling effect + onVis handlers below.

  // Lock horizontal swipe-to-reveal rows to the X axis so a sideways swipe on a
  // DM/group/archived row doesn't scroll the inbox vertically (iOS WKWebView
  // ignores touch-action for this; needs a non-passive preventDefault).
  useHorizontalSwipeLock(listScrollRef)

  // Refresh communities on visibility change (when returning to app)
  useEffect(() => {
    const onVis = async () => {
      if (!document.hidden && me) {
        try {
          const result = await fetchCommunitiesData(true) // Force refresh
          if (result.success && result.tree) {
            writeDeviceCache(communitiesTreeCacheKey(me), result.tree, CACHE_TTL_MS, CACHE_VERSION)
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
  }, [fetchCommunitiesData, me])

  useEffect(() => {
    if (!me) return
    const viewer = me
    let cancelled = false
    const hasCachedCommunities =
      (readDeviceCache<CommunityNode[]>(communitiesTreeCacheKey(viewer), CACHE_VERSION)?.length ?? 0) > 0
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
          writeDeviceCache(communitiesTreeCacheKey(viewer), result.tree, CACHE_TTL_MS, CACHE_VERSION)
          setCommunityTree(result.tree)
        } else {
          if (!hasCachedCommunities) {
            setCommunityTree([])
          }
          setCommunityError(result.error || t('chat.failed_load_communities'))
        }
      } catch {
        if (cancelled) {
          return
        }
        if (!hasCachedCommunities) {
          setCommunityTree([])
        }
        setCommunityError(t('chat.failed_load_communities'))
      } finally {
        if (!cancelled) {
          setCommunitiesLoading(false)
        }
      }
    }

    fetchCommunities()
    return () => { cancelled = true }
  }, [fetchCommunitiesData, me])

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
      ? t('chat.showing_count', { count: threads.length })
      : selectedSubNode
        ? t('chat.filtered_to', { name: selectedSubNode.name, count: visibleThreads.length })
        : t('chat.filtered_to', {
            name: selectedCommunityNode?.name ?? t('chat.filter_community_fallback'),
            count: visibleThreads.length,
          })

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
          className={`flex w-full items-center gap-2 px-3 py-2 text-xs text-c-text-secondary hover:bg-c-hover-bg ${selected ? 'bg-c-active-bg text-cpoint-turquoise' : ''}`}
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
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      {/* Secondary header (match Polls) */}
      <div
        className="fixed left-0 right-0 h-10 bg-c-header-bg backdrop-blur z-40 border-b border-c-border-subtle shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))' }}
      >
        <div className="max-w-3xl mx-auto h-full flex items-center gap-2 px-2">
          <button
            className="p-2 rounded-full hover:bg-c-hover-bg"
            onClick={() => navigate('/premium_dashboard')}
            aria-label={t('common.back')}
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='chats' ? 'text-c-text-primary' : 'text-c-text-tertiary hover:text-c-text-primary'}`} onClick={()=> setActiveTab('chats')}>
              <div className="pt-2">{t('chat.tab_chats')}</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='chats' ? 'bg-cpoint-turquoise' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='new' ? 'text-c-text-primary' : 'text-c-text-tertiary hover:text-c-text-primary'}`} onClick={()=> setActiveTab('new')}>
              <div className="pt-2">{t('chat.tab_new_message')}</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='new' ? 'bg-cpoint-turquoise' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={listScrollRef}
        className="app-subnav-offset max-w-3xl mx-auto px-1 sm:px-3 pb-2 overflow-y-auto overscroll-auto"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
        }}
      >
        {sharePick && (
          <div className="mb-3 px-2 py-2 rounded-xl border border-cpoint-turquoise/40 bg-cpoint-turquoise/10 text-sm text-c-text-primary">
            {t('chat.share_pick_banner')}
          </div>
        )}
        {activeTab === 'chats' ? (
          <div className="space-y-3">
            <div className="bg-c-bg-app border border-c-border rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-c-text-secondary">{t('chat.filter_by_community')}</div>
                {communitiesLoading ? (
                  <span className="text-xs text-c-text-tertiary">{t('common.loading')}</span>
                ) : communityError ? (
                  <span className="text-xs text-red-400">{communityError}</span>
                ) : communityTree.length === 0 ? (
                    <span className="text-xs text-c-text-tertiary">{t('chat.no_communities_available')}</span>
                ) : (
                    <span className="text-xs text-c-text-tertiary">{filterSummary}</span>
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
                      ? 'border-cpoint-turquoise/70 bg-cpoint-turquoise/20 text-cpoint-turquoise'
                      : 'border-c-border bg-c-bg-recessed text-c-text-secondary hover:border-c-border-strong'
                  }`}
                >
                  {t('chat.filter_all')}
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
                              ? 'border-cpoint-turquoise/70 bg-cpoint-turquoise/20 text-cpoint-turquoise'
                              : 'border-c-border bg-c-bg-recessed text-c-text-secondary hover:border-c-border-strong'
                          }`}
                          title={comm.members.length ? t('chat.members_count', { count: comm.members.length }) : undefined}
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
                    <div className="rounded-xl border border-c-border bg-c-bg-app p-4 space-y-1">
                      <div className="text-xs text-c-text-secondary mb-2">{t('chat.filter_node', { name: node.name })}</div>
                      <button
                        type="button"
                        onClick={() => {
                          setCommunityFilter(node.id)
                          setSubCommunityFilter(null)
                          setOpenDropdownId(null)
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-xs text-c-text-secondary hover:bg-c-hover-bg ${subCommunityFilter === null ? 'bg-c-active-bg text-cpoint-turquoise' : ''}`}
                      >
                        <span className="truncate">{t('chat.filter_all_node', { name: node.name })}</span>
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
              <div className="rounded-xl border border-c-border bg-c-bg-app mb-3">
                <button
                  type="button"
                  onClick={() => setGroupChatsCollapsed(!groupChatsCollapsed)}
                  className="w-full px-3 py-2 border-b border-c-border flex items-center justify-between hover:bg-c-hover-bg transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-users text-cpoint-turquoise text-sm" />
                    <span className="text-sm font-semibold text-c-text-secondary">{t('chat.group_chats')}</span>
                    <span className="text-xs text-c-text-tertiary">({groupChats.length})</span>
                    {groupChats.reduce((sum, gc) => sum + gc.unread_count, 0) > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-cpoint-turquoise text-black text-[10px] font-medium">
                        {groupChats.reduce((sum, gc) => sum + gc.unread_count, 0)}
                      </span>
                    )}
                  </div>
                  <i className={`fa-solid fa-chevron-${groupChatsCollapsed ? 'down' : 'up'} text-xs text-c-text-tertiary`} />
                </button>
                {!groupChatsCollapsed && (
                <div className="divide-y divide-c-border">
                  {groupChats.length > 3 && (
                    <div className="px-3 py-2">
                      <div className="relative">
                        <i className="fa-solid fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-c-text-disabled text-xs" />
                        <input
                          type="text"
                          value={groupSearchQuery}
                          onChange={e => setGroupSearchQuery(e.target.value)}
                          placeholder={t('chat.search_groups_placeholder')}
                          className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-c-hover-bg border border-c-border text-sm text-c-text-primary placeholder-c-text-disabled outline-none focus:border-cpoint-turquoise/50"
                        />
                        {groupSearchQuery && (
                          <button type="button" onClick={() => setGroupSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-c-text-disabled hover:text-c-text-tertiary">
                            <i className="fa-solid fa-xmark text-xs" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {groupChats.filter(gc => !groupSearchQuery || gc.name.toLowerCase().includes(groupSearchQuery.toLowerCase())).map((gc) => {
                    const isGDragging = groupDraggingIdRef.current === gc.id
                    const gtx = isGDragging ? Math.min(0, groupDragX) : (groupSwipeId === gc.id ? -120 : 0)
                    const gTransition = isGDragging ? 'none' : 'transform 150ms ease-out'
                    const gShowActions = isGDragging ? (groupDragX < -20) : (groupSwipeId === gc.id)
                    
                    return (
                      <div key={gc.id} data-swipe-row className="relative w-full overflow-hidden">
                        {/* Delete action (revealed on swipe) */}
                        <div
                          className="absolute inset-y-0 right-0 flex items-stretch"
                          style={{
                            opacity: gShowActions ? 1 : 0,
                            pointerEvents: gShowActions ? 'auto' : 'none',
                            transition: 'opacity 150ms ease-out'
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setChatMoreTarget({ type: 'group', groupId: gc.id, displayName: gc.name })}
                            className="h-full w-[60px] min-h-[44px] bg-c-active-bg text-c-text-secondary hover:bg-c-hover-bg flex items-center justify-center"
                            aria-label={t('chat.more_options')}
                          >
                            <i className="fa-solid fa-ellipsis" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteGroupChat(gc.id)}
                            className="h-full w-[60px] min-h-[44px] rounded-r-md bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center justify-center"
                            aria-label={t('chat.delete_group_aria')}
                          >
                            <i className="fa-solid fa-trash text-lg" />
                          </button>
                        </div>
                        
                        {/* Group chat row */}
                        <div
                          className="relative bg-c-bg-app"
                          style={{ transform: `translateX(${gtx}px)`, transition: gTransition, touchAction: 'pan-y' }}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return
                            groupStartXRef.current = e.clientX
                            groupDraggingIdRef.current = gc.id
                            setGroupDragX(0)
                          }}
                          onPointerMove={(e) => {
                            if (groupDraggingIdRef.current !== gc.id) return
                            const dx = e.clientX - groupStartXRef.current
                            setGroupDragX(dx)
                          }}
                          onPointerUp={() => {
                            if (groupDraggingIdRef.current !== gc.id) return
                            if (groupDragX < -40) {
                              setGroupSwipeId(gc.id)
                            } else if (groupDragX > 20) {
                              setGroupSwipeId(null)
                            }
                            groupDraggingIdRef.current = null
                            setGroupDragX(0)
                          }}
                          onPointerCancel={() => {
                            groupDraggingIdRef.current = null
                            setGroupDragX(0)
                          }}
                        >
                          <button
                            onClick={() => {
                              if (groupSwipeId === gc.id) {
                                setGroupSwipeId(null)
                              } else {
                                // Clear unread count locally when opening group chat
                                setGroupChats(prev => prev.map(g => 
                                  g.id === gc.id ? { ...g, unread_count: 0 } : g
                                ))
                                navigate(`/group_chat/${gc.id}${shareQuery}`)
                              }
                            }}
                            className="w-full px-3 py-3 flex items-center gap-3 hover:bg-c-hover-bg text-left"
                          >
                            <div className="w-12 h-12 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
                              <i className="fa-solid fa-users text-cpoint-turquoise" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <div className="font-medium truncate">{gc.name}</div>
                                {gc.last_message?.time && (
                                  <div className="ml-3 flex-shrink-0 text-[11px] text-c-text-tertiary">
                                    {new Date(gc.last_message.time).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                              <div className="text-[13px] text-c-text-tertiary truncate">
                                {gc.last_message ? (
                                  <span><span className="font-medium">{gc.last_message.sender}:</span> {formatLastMessagePreview(gc.last_message.text, t)}</span>
                                ) : (
                                  <span>{t('chat.members_count', { count: gc.member_count })}</span>
                                )}
                              </div>
                            </div>
                            {gc.muted && (
                              <i className="ml-2 fa-solid fa-bell-slash text-c-text-tertiary text-xs" title={t('chat.muted_title')} />
                            )}
                            {gc.unread_count > 0 && (
                              <div className="ml-2 px-2 h-5 rounded-full bg-cpoint-turquoise text-black text-[11px] flex items-center justify-center">
                                {gc.unread_count > 99 ? '99+' : gc.unread_count}
                              </div>
                            )}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                )}
              </div>
            )}
            
            {/* Direct Messages Section */}
            <div className="rounded-xl border border-c-border bg-c-bg-app divide-y divide-c-border">
              {groupChats.length > 0 && communityFilter === 'all' && (
                <button
                  type="button"
                  onClick={() => setDirectMessagesCollapsed(!directMessagesCollapsed)}
                  className="w-full px-3 py-2 border-b border-c-border flex items-center justify-between hover:bg-c-hover-bg transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-user text-cpoint-turquoise text-sm" />
                    <span className="text-sm font-semibold text-c-text-secondary">{t('chat.direct_messages')}</span>
                    {visibleThreads.reduce((sum, t) => sum + (t.unread_count || 0), 0) > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-cpoint-turquoise text-black text-[10px] font-medium">
                        {visibleThreads.reduce((sum, t) => sum + (t.unread_count || 0), 0)}
                      </span>
                    )}
                  </div>
                  <i className={`fa-solid fa-chevron-${directMessagesCollapsed ? 'down' : 'up'} text-xs text-c-text-tertiary`} />
                </button>
              )}
              {!directMessagesCollapsed && (loading && visibleThreads.length === 0 ? (
                <SkeletonList count={4} />
              ) : visibleThreads.length === 0 ? (
                <div className="px-4 py-4 text-sm text-c-text-tertiary">
                  {communityFilter === 'all'
                    ? t('chat.no_dms_yet')
                    : t('chat.no_chats_for_filter')}
                </div>
              ) : (
                <>
                {visibleThreads.length > 3 && (
                  <div className="px-3 py-2">
                    <div className="relative">
                      <i className="fa-solid fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-c-text-disabled text-xs" />
                      <input
                        type="text"
                        value={dmSearchQuery}
                        onChange={e => setDmSearchQuery(e.target.value)}
                        placeholder={t('chat.search_conversations_placeholder')}
                        className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-c-hover-bg border border-c-border text-sm text-c-text-primary placeholder-c-text-disabled outline-none focus:border-cpoint-turquoise/50"
                      />
                      {dmSearchQuery && (
                        <button type="button" onClick={() => setDmSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-c-text-disabled hover:text-c-text-tertiary">
                          <i className="fa-solid fa-xmark text-xs" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {visibleThreads.filter(thread => !dmSearchQuery || (thread.display_name || thread.other_username).toLowerCase().includes(dmSearchQuery.toLowerCase()) || thread.other_username.toLowerCase().includes(dmSearchQuery.toLowerCase())).map((thread) => {
              const isDragging = draggingIdRef.current === thread.other_username
              const tx = isDragging ? Math.min(0, dragX) : (swipeId === thread.other_username ? -120 : 0)
              const transition = isDragging ? 'none' : 'transform 150ms ease-out'
              const showActions = isDragging ? (dragX < -20) : (swipeId === thread.other_username)
              const isMuted = thread.muted === true
              return (
                <div key={thread.other_username} data-swipe-row className="relative w-full overflow-hidden">
                  {/* Actions (revealed on swipe) */}
                  <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ opacity: showActions ? 1 : 0, pointerEvents: showActions ? 'auto' : 'none', transition: 'opacity 150ms ease-out' }}>
                    <button
                      type="button"
                      onClick={() => setChatMoreTarget({ type: 'dm', username: thread.other_username, displayName: thread.display_name || thread.other_username })}
                      className="h-full w-[60px] min-h-[44px] bg-c-active-bg text-c-text-secondary hover:bg-c-hover-bg flex items-center justify-center"
                      aria-label={t('chat.more_options')}
                    >
                      <i className="fa-solid fa-ellipsis" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(t('chat.delete_dm_confirm', { name: thread.display_name || thread.other_username }))) return
                        const fd = new URLSearchParams({ other_username: thread.other_username })
                        fetch('/delete_chat_thread', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                          .then(r=>r.json()).then(j=>{
                            if (j?.success){
                              setThreads(prev => prev.filter(x => x.other_username !== thread.other_username))
                              setSwipeId(null)
                              // Clear local caches for this chat
                              try {
                                import('../utils/deviceCache').then(({ clearDeviceCache }) => {
                                  if (me) {
                                    clearDeviceCache(chatMessagesDeviceCacheKey(me, thread.other_username))
                                    clearDeviceCache(chatProfileDeviceCacheKey(me, thread.other_username))
                                  }
                                })
                              } catch {}
                              // Refetch thread list
                              fetch('/api/chat_threads', { credentials:'include', headers: { 'Accept': 'application/json' } })
                                .then(rr=> rr.json()).then(jj=>{
                                  if (jj?.success && Array.isArray(jj.threads)){
                                    setThreads(jj.threads)
                                  }
                                }).catch(()=>{})
                              refreshBadges()
                            }
                          }).catch(()=>{})
                      }}
                      className="h-full w-[60px] min-h-[44px] rounded-r-md bg-red-500/20 text-red-300 hover:bg-red-500/30 flex items-center justify-center"
                      aria-label={t('chat.delete_chat_aria')}
                    >
                      <i className="fa-solid fa-trash" />
                    </button>
                  </div>

                  {/* Swipeable content */}
                  <NativeListRow
                    onClick={() => {
                      const count = thread.unread_count || 0
                      setThreads(prev => prev.map(x => x.other_username===thread.other_username ? { ...x, unread_count: 0 } : x))
                      if (count > 0) adjustBadges({ msgs: -count })
                      navigate(`/user_chat/chat/${encodeURIComponent(thread.other_username)}${shareQuery}`)
                    }}
                    onTouchStart={(e) => {
                      startXRef.current = e.touches[0].clientX
                      draggingIdRef.current = thread.other_username
                      setDragX(swipeId === thread.other_username ? -120 : 0)
                    }}
                    onTouchMove={(e) => {
                      if (draggingIdRef.current !== thread.other_username) return
                      const dx = e.touches[0].clientX - startXRef.current
                      setDragX(dx)
                    }}
                    onTouchEnd={() => {
                      if (draggingIdRef.current !== thread.other_username) return
                      const shouldOpen = dragX <= -80
                      if (shouldOpen) void triggerHaptic('selection')
                      setSwipeId(shouldOpen ? thread.other_username : null)
                      setDragX(0)
                      draggingIdRef.current = null
                    }}
                    onTouchCancel={() => {
                      if (draggingIdRef.current !== thread.other_username) return
                      setDragX(0)
                      draggingIdRef.current = null
                    }}
                    className="px-3 py-2 gap-3 bg-transparent"
                    style={{ transform: `translateX(${tx}px)`, transition, touchAction: 'pan-y' }}
                  >
                    <Avatar username={thread.other_username} url={thread.profile_picture_url || undefined} size={48} linkToProfile displayName={thread.display_name} loading="eager" />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between">
                        <div className="font-medium truncate">{thread.display_name}</div>
                        {thread.last_activity_time && (
                          <div className="ml-3 flex-shrink-0 text-[11px] text-c-text-tertiary">
                            {new Date(thread.last_activity_time).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                      <div className="text-[13px] text-c-text-tertiary truncate">
                        {formatLastMessagePreview(thread.last_message_text, t)}
                      </div>
                    </div>
                    {isMuted && (
                      <i className="ml-2 fa-solid fa-bell-slash text-c-text-tertiary text-xs" title={t('chat.muted_title')} />
                    )}
                    {thread.unread_count && thread.unread_count > 0 ? (
                      <div className="ml-2 px-2 h-5 rounded-full bg-cpoint-turquoise text-black text-[11px] flex items-center justify-center">
                        {thread.unread_count > 99 ? '99+' : thread.unread_count}
                      </div>
                    ) : null}
                  </NativeListRow>
                </div>
                )
              })
            }
            </>
            ))}
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
                className="w-full px-4 py-3 flex items-center justify-between text-left border-t border-c-border"
              >
                <div className="flex items-center gap-2 text-c-text-tertiary">
                  <i className="fa-solid fa-box-archive text-sm" />
                  <span className="text-sm font-medium">{t('chat.archived_chats')}</span>
                  {archivedThreads.length > 0 && (
                    <span className="text-xs text-c-text-tertiary">({archivedThreads.length})</span>
                  )}
                </div>
                <i className={`fa-solid fa-chevron-${showArchived ? 'up' : 'down'} text-xs text-c-text-tertiary`} />
              </button>
              
              {showArchived && (
                <div className="border-t border-c-border-subtle">
                  {archivedLoading ? (
                    <div className="px-4 py-6 flex items-center justify-center text-c-text-tertiary">
                      <i className="fa-solid fa-spinner fa-spin mr-2" />
                      {t('chat.loading_archived')}
                    </div>
                  ) : archivedThreads.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-c-text-tertiary">
                      {t('chat.no_archived')}
                    </div>
                  ) : (
                    archivedThreads.map((archivedThread) => {
                      const isDragging = draggingIdRef.current === `archived-${archivedThread.other_username}`
                      const tx = isDragging ? Math.min(0, dragX) : (swipeId === `archived-${archivedThread.other_username}` ? -60 : 0)
                      const transition = isDragging ? 'none' : 'transform 150ms ease-out'
                      const showActions = isDragging ? (dragX < -20) : (swipeId === `archived-${archivedThread.other_username}`)
                      return (
                        <div key={`archived-${archivedThread.other_username}`} data-swipe-row className="relative w-full overflow-hidden bg-c-hover-bg">
                          {/* Unarchive action */}
                          <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ opacity: showActions ? 1 : 0, pointerEvents: showActions ? 'auto' : 'none', transition: 'opacity 150ms ease-out' }}>
                            <button
                              type="button"
                              onClick={() => unarchiveChat(archivedThread.other_username)}
                              className="h-full w-[60px] min-h-[44px] rounded-r-md bg-green-500/20 text-green-300 hover:bg-green-500/30 flex items-center justify-center"
                              aria-label={t('chat.unarchive_chat_aria')}
                            >
                              <i className="fa-solid fa-arrow-up-from-bracket" />
                            </button>
                          </div>

                          <button
                            onClick={() => {
                              navigate(`/user_chat/chat/${encodeURIComponent(archivedThread.other_username)}${shareQuery}`)
                            }}
                            onTouchStart={(e) => {
                              startXRef.current = e.touches[0].clientX
                              draggingIdRef.current = `archived-${archivedThread.other_username}`
                              setDragX(swipeId === `archived-${archivedThread.other_username}` ? -60 : 0)
                            }}
                            onTouchMove={(e) => {
                              if (draggingIdRef.current !== `archived-${archivedThread.other_username}`) return
                              const dx = e.touches[0].clientX - startXRef.current
                              setDragX(dx)
                            }}
                            onTouchEnd={() => {
                              if (draggingIdRef.current !== `archived-${archivedThread.other_username}`) return
                              const shouldOpen = dragX <= -40
                              if (shouldOpen) void triggerHaptic('selection')
                              setSwipeId(shouldOpen ? `archived-${archivedThread.other_username}` : null)
                              setDragX(0)
                              draggingIdRef.current = null
                            }}
                            onTouchCancel={() => {
                              if (draggingIdRef.current !== `archived-${archivedThread.other_username}`) return
                              setDragX(0)
                              draggingIdRef.current = null
                            }}
                            className="w-full px-3 py-2 flex items-center gap-3 bg-transparent"
                            style={{ transform: `translateX(${tx}px)`, transition, touchAction: 'pan-y' }}
                          >
                            <Avatar username={archivedThread.other_username} url={archivedThread.profile_picture_url || undefined} size={44} displayName={archivedThread.display_name} loading="eager" />
                            <div className="flex-1 min-w-0 text-left">
                              <div className="flex items-center justify-between">
                                <div className="font-medium truncate text-c-text-secondary">{archivedThread.display_name}</div>
                                {archivedThread.last_activity_time && (
                                  <div className="ml-3 flex-shrink-0 text-[11px] text-c-text-tertiary">
                                    {new Date(archivedThread.last_activity_time).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                              <div className="text-[13px] text-c-text-tertiary truncate">
                                {formatLastMessagePreview(archivedThread.last_message_text, t)}
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
      {chatMoreTarget && (
        <div className="fixed inset-0 bg-c-bg-overlay z-50 flex items-end justify-center" onClick={() => setChatMoreTarget(null)}>
          <div className="w-full max-w-md bg-c-bg-surface border-t border-c-border rounded-t-2xl p-4 pb-8 space-y-1" onClick={e => e.stopPropagation()} style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
            <div className="text-sm text-c-text-tertiary text-center mb-3">{chatMoreTarget.displayName}</div>
            {(() => {
              const isMuted = chatMoreTarget.type === 'dm'
                ? threads.find(t => t.other_username === chatMoreTarget.username)?.muted
                : groupChats.find(g => g.id === chatMoreTarget.groupId)?.muted
              return (
                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary" onClick={async () => {
                  const key = chatMoreTarget.type === 'dm' ? chatMoreTarget.username : undefined
                  const gid = chatMoreTarget.type === 'group' ? chatMoreTarget.groupId : undefined
                  const newMuted = !isMuted
                  await fetch('/api/chat/mute', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ other_username: key, group_id: gid, muted: newMuted }) }).catch(() => {})
                  // Update local state
                  if (chatMoreTarget.type === 'dm') {
                    setThreads(prev => prev.map(t => t.other_username === chatMoreTarget.username ? { ...t, muted: newMuted } : t))
                  } else if (chatMoreTarget.type === 'group') {
                    setGroupChats(prev => prev.map(g => g.id === chatMoreTarget.groupId ? { ...g, muted: newMuted } : g))
                  }
                  setChatMoreTarget(null)
                }}>
                  <i className={`fa-solid ${isMuted ? 'fa-bell' : 'fa-bell-slash'} text-c-text-tertiary w-6 text-center`} />
                  {isMuted ? t('chat.unmute_chat') : t('chat.mute_chat')}
                </button>
              )
            })()}
            {chatMoreTarget.type === 'dm' && (
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary" onClick={() => {
                archiveChat(chatMoreTarget.username!)
                setChatMoreTarget(null)
              }}>
                <i className="fa-solid fa-box-archive text-c-text-tertiary w-6 text-center" />
                {t('chat.archive_chat')}
              </button>
            )}
            {chatMoreTarget.type === 'dm' && (
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary" onClick={async () => {
                const u = chatMoreTarget.username
                await fetch('/api/chat/clear_history', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ other_username: u }) }).catch(() => {})
                setChatMoreTarget(null)
                if (u && me) {
                  clearDeviceCache(chatMessagesDeviceCacheKey(me, u))
                  clearDeviceCache(chatProfileDeviceCacheKey(me, u))
                  clearDeviceCache(threadsListCacheKey(me))
                  void clearConversationMessages(dmConversationOfflineKey(me, u))
                  void deleteCachedConversationRow(me, u)
                  const nowIso = new Date().toISOString()
                  setThreads(prev =>
                    prev.map(t =>
                      t.other_username === u
                        ? { ...t, last_message_text: null, unread_count: 0, last_activity_time: nowIso }
                        : t
                    )
                  )
                }
                loadThreads(true)
              }}>
                <i className="fa-solid fa-broom text-c-text-tertiary w-6 text-center" />
                {t('chat.clear_chat')}
              </button>
            )}
            {chatMoreTarget.type === 'dm' && (
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary" onClick={async () => {
                if (!confirm(t('chat.block_user_confirm', { name: chatMoreTarget.displayName, defaultValue: `Block ${chatMoreTarget.displayName}? They won't be able to message you.` }))) return
                setChatMoreTarget(null)
                const u = chatMoreTarget.username
                await fetch('/api/block_user', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ blocked_username: u }),
                }).catch(() => {})
                if (u) setThreads(prev => prev.filter(x => x.other_username !== u))
              }}>
                <i className="fa-solid fa-ban text-c-text-tertiary w-6 text-center" />
                {t('chat.block_user')}
              </button>
            )}
            {chatMoreTarget.type === 'group' && chatMoreTarget.groupId && (
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary" onClick={async () => {
                await fetch(`/api/group_chat/${chatMoreTarget.groupId}/clear_history`, { method: 'POST', credentials: 'include' }).catch(() => {})
                setChatMoreTarget(null)
                loadGroupChats(true)
              }}>
                <i className="fa-solid fa-broom text-c-text-tertiary w-6 text-center" />
                {t('chat.clear_chat')}
              </button>
            )}
            {chatMoreTarget.type === 'group' && chatMoreTarget.groupId && (
              <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-c-text-primary" onClick={async () => {
                if (!confirm(t('chat.leave_group_confirm', { name: chatMoreTarget.displayName, defaultValue: `Leave "${chatMoreTarget.displayName}"?` }))) return
                setChatMoreTarget(null)
                const fd = new URLSearchParams()
                fd.append('group_id', String(chatMoreTarget.groupId))
                await fetch('/api/groups/leave', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd }).catch(() => {})
                setGroupChats(prev => prev.filter(g => g.id !== chatMoreTarget.groupId))
              }}>
                <i className="fa-solid fa-right-from-bracket text-c-text-tertiary w-6 text-center" />
                {t('chat.leave_group')}
              </button>
            )}
            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-c-hover-bg text-red-400" onClick={() => {
              if (chatMoreTarget.type === 'dm') {
                if (!confirm(t('chat.delete_dm_confirm', { name: chatMoreTarget.displayName }))) return
                setChatMoreTarget(null)
                const u = chatMoreTarget.username!
                const fd = new URLSearchParams({ other_username: u })
                fetch('/delete_chat_thread', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                  .then(r=>r.json()).then(j=>{
                    if (j?.success) {
                      setThreads(prev => prev.filter(x => x.other_username !== u))
                      if (me) {
                        clearDeviceCache(chatMessagesDeviceCacheKey(me, u))
                        clearDeviceCache(chatProfileDeviceCacheKey(me, u))
                        clearDeviceCache(threadsListCacheKey(me))
                        void clearConversationMessages(dmConversationOfflineKey(me, u))
                        void deleteCachedConversationRow(me, u)
                      }
                      refreshBadges()
                    }
                  }).catch(()=>{})
              } else if (chatMoreTarget.type === 'group' && chatMoreTarget.groupId) {
                setChatMoreTarget(null)
                deleteGroupChat(chatMoreTarget.groupId)
              }
            }}>
              <i className="fa-solid fa-trash text-red-400/60 w-6 text-center" />
              {t('chat.delete_chat')}
            </button>
            <button className="w-full text-center py-3 text-c-text-tertiary text-sm" onClick={() => setChatMoreTarget(null)}>{t('chat.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function NewMessageInline(){
  const { t } = useTranslation()
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  
  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="rounded-xl border border-c-border bg-c-bg-app p-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('direct')}
            className={`flex-1 px-3 py-2 text-sm rounded-lg transition ${
              mode === 'direct'
                ? 'bg-cpoint-turquoise/20 border border-cpoint-turquoise/50 text-cpoint-turquoise'
                : 'bg-c-hover-bg border border-c-border text-c-text-secondary hover:bg-c-hover-bg'
            }`}
          >
            <i className="fa-solid fa-user mr-2" />
            {t('chat.direct_message_mode')}
          </button>
          <button
            type="button"
            onClick={() => setMode('group')}
            className={`flex-1 px-3 py-2 text-sm rounded-lg transition ${
              mode === 'group'
                ? 'bg-cpoint-turquoise/20 border border-cpoint-turquoise/50 text-cpoint-turquoise'
                : 'bg-c-hover-bg border border-c-border text-c-text-secondary hover:bg-c-hover-bg'
            }`}
          >
            <i className="fa-solid fa-users mr-2" />
            {t('chat.group_chat_mode')}
          </button>
        </div>
      </div>
      
      {/* Content based on mode */}
      {mode === 'direct' ? (
        <ParentCommunityPicker title={t('chat.start_new_message_picker')} variant="compact" />
      ) : (
        <GroupChatCreator />
      )}
    </div>
  )
}