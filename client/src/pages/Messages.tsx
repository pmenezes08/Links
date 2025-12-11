import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ParentCommunityPicker from '../components/ParentCommunityPicker'
import { readDeviceCache, writeDeviceCache } from '../utils/deviceCache'

type Thread = {
  other_username: string
  display_name: string
  profile_picture_url: string | null
  last_message_text: string | null
  last_activity_time: string | null
  last_sender?: string | null
  unread_count?: number
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

export default function Messages(){
  const { setTitle } = useHeader()
  const navigate = useNavigate()
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

  useEffect(() => {
    // Fetch fresh data (will update cache)
    loadThreads(threads.length > 0) // Silent if we have cached data
    
    const onVis = () => {
      if (!document.hidden) loadThreads(true)
    }
    document.addEventListener('visibilitychange', onVis)
    
    // Poll every 3 seconds for faster updates (was 5s)
    const t = setInterval(() => loadThreads(true), 3000)
    
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(t)
    }
  }, [loadThreads])

  useEffect(() => {
    let cancelled = false
    // Only show loading if no cached data
    const hasCachedCommunities = communityTree.length > 0
    if (!hasCachedCommunities) {
      setCommunitiesLoading(true)
    }
    setCommunityError(null)

    async function fetchCommunities() {
      try {
        const [membersRes, hierarchyRes] = await Promise.all([
          fetch('/get_user_communities_with_members', { credentials: 'include' }).then(r => r.json()).catch(() => null),
          fetch('/api/user_communities_hierarchical', { credentials: 'include' }).then(r => r.json()).catch(() => null),
        ])
        if (cancelled) return

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

          // Cache the community tree
          writeDeviceCache(COMMUNITIES_CACHE_KEY, tree, CACHE_TTL_MS, CACHE_VERSION)
          setCommunityTree(tree)
        } else {
          // Only clear if we don't have cached data
          if (!hasCachedCommunities) {
            setCommunityTree([])
          }
          setCommunityError(membersRes?.error || 'Failed to load communities')
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
  }, [])

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
            <div className="rounded-xl border border-white/10 bg-black divide-y divide-white/10">
              {loading ? (
                <div className="px-4 py-4 text-sm text-[#9fb0b5]">Loading chats...</div>
              ) : visibleThreads.length === 0 ? (
                <div className="px-4 py-4 text-sm text-[#9fb0b5]">
                  {communityFilter === 'all'
                    ? 'No chats yet. Start a new one from the New Message tab.'
                    : 'No chats match this community filter.'}
                </div>
              ) : (
                visibleThreads.map((t) => {
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
                              try{
                                const pollFn = (window as any).__header_do_poll
                                if (typeof pollFn === 'function') {
                                  pollFn()
                                }
                              }catch{}
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
              )
            })()}
          </div>
        ) : (
          <NewMessageInline />
        )}
      </div>
    </div>
  )
}

function NewMessageInline(){
  return <ParentCommunityPicker title="Start a New Message" variant="compact" />
}