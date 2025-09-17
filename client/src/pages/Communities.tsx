import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'

type Community = { 
  id: number; 
  name: string; 
  type?: string; 
  is_active?: boolean;
  parent_community_id?: number;
  children?: Community[];
  creator_username?: string;
}

export default function Communities(){
  const navigate = useNavigate()
  const location = useLocation()
  const { setTitle } = useHeader()
  const [_data, setData] = useState<{ username:string; current_user_profile_picture?:string|null; community_name?:string }|null>(null)
  const [communities, setCommunities] = useState<Community[]>([])
  const [parentName, setParentName] = useState<string>('')
  const [parentType, setParentType] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [swipedCommunity, setSwipedCommunity] = useState<number|null>(null)
  const [activeTab, setActiveTab] = useState<'timeline'|'management'|'training'>(() => {
    const qs = new URLSearchParams(location.search)
    return qs.get('parent_id') ? 'timeline' : 'management'
  })
  const showTrainingTab = useMemo(() => {
    const parent = communities && communities.length > 0 ? communities[0] : null
    if (!parent) return false
    const parentTypeLower = ((parent as any).community_type || parent.type || parentType || '').toLowerCase()
    return parentTypeLower === 'gym'
  }, [communities, parentType])
  

  useEffect(() => {
    const link = document.getElementById('legacy-styles') as HTMLLinkElement | null
    if (!link){
      const l = document.createElement('link')
      l.id = 'legacy-styles'
      l.rel = 'stylesheet'
      l.href = '/static/styles.css'
      document.head.appendChild(l)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        // Fetch current user meta from home timeline endpoint
        try{
          const r = await fetch(`/api/home_timeline`, { credentials:'include' })
          const j = await r.json()
          if (mounted && j?.success){
            setData({ username: j.username, current_user_profile_picture: j.current_user_profile_picture })
          }
        }catch{}

        const rc = await fetch('/api/user_communities_hierarchical', { credentials:'include' })
        const jc = await rc.json()
        if (!mounted) return
        if (jc?.success){
          // Optional filtering by parent_id
          const qs = new URLSearchParams(location.search)
          const parentIdParam = qs.get('parent_id')
          const all: Community[] = jc.communities || []
          if (parentIdParam) {
            const pid = Number(parentIdParam)
            const parent = all.find(c => c.id === pid)
            if (parent) {
              const subset: Community[] = [{ ...parent, children: parent.children || [] }]
              setCommunities(subset)
              setParentName(parent.name)
              setParentType(parent.type || '')
            } else {
              setCommunities(all)
              setParentName('')
              try {
                // If navigated without parent_id but only one parent root is in view, capture its type
                const roots = all.filter(c => !c.parent_community_id)
                if (roots.length === 1) setParentType(roots[0].type || '')
                else setParentType('')
              } catch { setParentType('') }
            }
          } else {
            setCommunities(all)
            setParentName('')
            setParentType('')
          }
          setError(null)
        } else {
          setError(jc?.error || 'Error loading communities')
        }
      }catch{
        if (mounted) setError('Error loading communities')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  useEffect(() => { 
    if (parentName) setTitle(`Community: ${parentName}`)
    else setTitle('Community Management')
  }, [setTitle, parentName])

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      {/* Global header used from App */}

      {/* Secondary nav like X */}
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex items-center">
          <button
            type="button"
            className="mr-2 p-2 rounded-full hover:bg-white/5"
            onClick={()=> navigate('/premium_dashboard')}
            aria-label="Back"
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 flex items-center justify-center gap-8 overflow-x-auto no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' as any }}>
            <button 
              type="button" 
              className={`text-sm font-medium ${activeTab==='timeline' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} 
              onClick={()=> {
                const pid = new URLSearchParams(location.search).get('parent_id')
                if (!pid) { navigate('/home'); return }
                setActiveTab('timeline')
                const el = document.getElementById('parent-timeline')
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              <div className="pt-2 whitespace-nowrap text-center">Home Timeline</div>
              <div className={`h-0.5 ${activeTab==='timeline' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
            </button>
            <button 
              type="button" 
              className={`text-sm font-medium ${activeTab==='management' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`}
              onClick={()=> setActiveTab('management')}
            >
              <div className="pt-2 whitespace-nowrap text-center">Community Management</div>
              <div className={`h-0.5 ${activeTab==='management' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
            </button>
            {showTrainingTab && (
              <button 
                type="button" 
                className={`text-sm font-medium ${activeTab==='training' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`}
                onClick={()=> setActiveTab('training')}
              >
                <div className="pt-2 whitespace-nowrap text-center">Your Training</div>
                <div className={`h-0.5 ${activeTab==='training' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Slide-out menu (90% width) same as feed */}
      {/* Menu unified via HeaderBar */}

      <div className="max-w-2xl mx-auto pt-[70px] h-[calc(100vh-70px)] pb-6 px-3 overflow-y-auto no-scrollbar">
        {loading ? (
          <div className="text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <div className="space-y-3">
             {(() => {
               const pid = new URLSearchParams(location.search).get('parent_id')
               if (pid && activeTab === 'timeline') {
                 return (
                   <div id="parent-timeline">
                     <ParentTimeline parentId={Number(pid)} />
                   </div>
                 )
               }
               if (pid && activeTab === 'training' && showTrainingTab) {
                 return (
                   <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                     <button
                       className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black text-sm hover:brightness-110"
                       onClick={()=> {
                         const pid = new URLSearchParams(location.search).get('parent_id')
                         window.location.href = pid ? `/workout_tracking?parent_id=${pid}` : '/workout_tracking'
                       }}
                     >
                       Go to Workout Tracking
                     </button>
                   </div>
                 )
               }
              return (
                <>
                  {!pid && (
                    <JoinCommunity onJoined={()=>{ window.location.reload() }} />
                  )}
                  {communities.length === 0 ? (
                    <div className="text-[#9fb0b5]">You are not a member of any communities.</div>
                  ) : communities.map(c => (
                    <div key={c.id} className="space-y-2">
                      <CommunityItem 
                        community={c} 
                        isSwipedOpen={swipedCommunity === c.id}
                        onSwipe={(isOpen) => setSwipedCommunity(isOpen ? c.id : null)}
                        onEnter={() => {
                          const ua = navigator.userAgent || ''
                          const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua) || window.innerWidth < 768
                          if (isMobile) navigate(`/community_feed_react/${c.id}`); else window.location.href = `/community_feed/${c.id}`
                        }}
                        onDeleteOrLeave={async (asDelete:boolean) => {
                          const fd = new URLSearchParams({ community_id: String(c.id) })
                          const url = asDelete ? '/delete_community' : '/leave_community'
                          const r = await fetch(url, { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                          const j = await r.json().catch(()=>null)
                          if (j?.success) window.location.reload()
                          else alert(j?.error||`Error ${asDelete?'deleting':'leaving'} community`)
                        }}
                        currentUsername={_data?.username || ''}
                      />
                      {c.children && c.children.length > 0 && (
                        <div className="ml-6 space-y-2">
                          {c.children.map(child => (
                            <CommunityItem 
                              key={child.id}
                              community={child} 
                              isSwipedOpen={swipedCommunity === child.id}
                              onSwipe={(isOpen) => setSwipedCommunity(isOpen ? child.id : null)}
                              onEnter={() => {
                                const ua = navigator.userAgent || ''
                                const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua) || window.innerWidth < 768
                                if (isMobile) navigate(`/community_feed_react/${child.id}`); else window.location.href = `/community_feed/${child.id}`
                              }}
                              onDeleteOrLeave={async (asDelete:boolean) => {
                                const fd = new URLSearchParams({ community_id: String(child.id) })
                                const url = asDelete ? '/delete_community' : '/leave_community'
                                const r = await fetch(url, { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                                const j = await r.json().catch(()=>null)
                                if (j?.success) window.location.reload()
                                else alert(j?.error||`Error ${asDelete?'deleting':'leaving'} community`)
                              }}
                              isChild={true}
                              currentUsername={_data?.username || ''}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}

function ParentTimeline({ parentId }:{ parentId:number }){
  const navigate = useNavigate()
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|undefined>()
  useEffect(() => {
    let ok = true
    async function load(){
      setLoading(true)
      try{
        const r = await fetch(`/api/community_group_feed/${parentId}`, { credentials:'include' })
        const j = await r.json()
        if (!ok) return
        if (j?.success) setPosts(j.posts || [])
        else setError(j?.error || 'Error loading timeline')
      }catch{
        if (ok) setError('Error loading timeline')
      }finally{
        if (ok) setLoading(false)
      }
    }
    load()
    return ()=>{ ok = false }
  }, [parentId])

  if (loading) return null
  if (error) return null

  return (
    <div className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/10">
      <div className="text-sm font-semibold mb-2">Home Timeline</div>
      {posts.length === 0 ? (
        <div className="text-[#9fb0b5] text-sm">No posts created in the past 48h</div>
      ) : (
        <div className="space-y-3">
          {posts.map((p:any) => (
            <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.035] shadow-sm shadow-black/20 cursor-pointer"
              onClick={() => navigate(`/post/${p.id}`)}
            >
              <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2" onClick={(e)=> e.stopPropagation()}>
                <Avatar username={p.username || ''} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <div className="font-medium truncate">{p.username}</div>
                    {p.community_name ? (
                      <div className="text-xs text-[#9fb0b5] truncate">in {p.community_name}</div>
                    ) : null}
                  </div>
                </div>
                <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{String(p.created_at || '').slice(0, 10)}</div>
              </div>
              <div className="px-3 py-2 space-y-2">
                <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{p.content}</div>
                {p.image_path ? (
                  <img src={(p.image_path.startsWith('/uploads') || p.image_path.startsWith('/static')) ? p.image_path : `/uploads/${p.image_path}`} alt="" className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10" />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CommunityItem({ 
  community, 
  isSwipedOpen, 
  onSwipe, 
  onEnter, 
  onDeleteOrLeave,
  isChild = false,
  currentUsername
}: { 
  community: Community
  isSwipedOpen: boolean
  onSwipe: (isOpen: boolean) => void
  onEnter: () => void
  onDeleteOrLeave: (asDelete:boolean) => void
  isChild?: boolean
  currentUsername: string
}) {
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX
    setIsDragging(true)
    setDragX(isSwipedOpen ? -80 : 0)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const currentX = e.touches[0].clientX
    const deltaX = currentX - startXRef.current
    const newDragX = Math.min(0, deltaX + (isSwipedOpen ? -80 : 0))
    setDragX(newDragX)
  }

  const handleTouchEnd = () => {
    if (!isDragging) return
    setIsDragging(false)
    
    const shouldOpen = dragX < -40
    onSwipe(shouldOpen)
    setDragX(0)
  }

  const handleClick = () => {
    if (isSwipedOpen) {
      onSwipe(false)
    } else if (Math.abs(dragX) < 10) {
      onEnter()
    }
  }

  const handleLeaveClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm(`Are you sure you want to leave ${community.name}?`)) {
      try {
        await onDeleteOrLeave(false)
      } catch (error) {
        console.error('Error leaving community:', error)
        alert('Failed to leave community. Please try again.')
      }
    }
  }

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm(`Delete "${community.name}"? This cannot be undone.`)){
      try{
        await onDeleteOrLeave(true)
      }catch(err){
        console.error('Error deleting community:', err)
        alert('Failed to delete community. Please try again.')
      }
    }
  }

  return (
    <div 
      className={`relative w-full overflow-hidden rounded-2xl transition-all duration-200 bg-black ${
        isSwipedOpen || dragX < -10 
          ? 'border-2 border-[#4db6ac]' 
          : 'border border-white/10'
      }`}
    >
      {/* Action button (Leave or Delete depending on ownership) */}
      <div className="absolute inset-y-0 right-0 flex items-center">
        {community.creator_username && currentUsername === community.creator_username ? (
          <button
            className="h-full w-20 bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-all duration-200 rounded-r-2xl"
            onClick={handleDeleteClick}
            style={{
              opacity: isSwipedOpen || dragX < -20 ? 1 : 0,
              transform: `translateX(${isSwipedOpen ? '0' : '100%'})`,
              transition: isDragging ? 'none' : 'all 0.2s ease-out'
            }}
          >
            <div className="flex flex-col items-center gap-1">
              <i className="fa-solid fa-trash text-sm" />
              <span className="text-xs font-medium">Delete</span>
            </div>
          </button>
        ) : (
          <button
            className="h-full w-20 bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-all duration-200 rounded-r-2xl"
            onClick={handleLeaveClick}
            style={{
              opacity: isSwipedOpen || dragX < -20 ? 1 : 0,
              transform: `translateX(${isSwipedOpen ? '0' : '100%'})`,
              transition: isDragging ? 'none' : 'all 0.2s ease-out'
            }}
          >
            <div className="flex flex-col items-center gap-1">
              <i className="fa-solid fa-user-minus text-sm" />
              <span className="text-xs font-medium">Leave</span>
            </div>
          </button>
        )}
      </div>

      {/* Swipeable community content */}
      <div
        className={`w-full px-3 py-3 hover:bg-white/[0.03] flex items-center justify-between cursor-pointer bg-black ${isChild ? 'pl-4' : ''}`}
        style={{
          transform: `translateX(${isDragging ? dragX : (isSwipedOpen ? -80 : 0)}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={handleClick}
      >
        <div className="flex-1 flex items-center">
          {isChild && <div className="w-4 h-4 mr-2 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-[#4db6ac]" />
          </div>}
          <div className="flex-1">
            <div className="font-medium text-white">{community.name}</div>
            <div className="text-xs text-[#9fb0b5]">{community.type || 'Community'}</div>
          </div>
        </div>
        <div className="text-[#4db6ac]">
          <i className="fa-solid fa-chevron-right" />
        </div>
      </div>
    </div>
  )
}

function JoinCommunity({ onJoined }:{ onJoined: ()=>void }){
  const [code, setCode] = useState('')
  const submit = async()=>{
    if (!code.trim()) return
    const fd = new URLSearchParams({ community_code: code.trim() })
    const r = await fetch('/join_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success) onJoined()
    else alert(j?.error||'Invalid code')
  }
  return (
    <div className="w-full flex items-center justify-center">
      <div className="w-[80%] max-w-md flex items-center gap-2">
        <input value={code} onChange={e=> setCode(e.target.value)} placeholder="Enter join code" className="flex-1 px-3 py-2 bg-black border border-[#666] text-white placeholder-[#888] focus:outline-none rounded-md" />
        <button aria-label="Join" title="Join" onClick={submit}
          className="w-10 h-10 rounded-full hover:bg-white/5 text-white flex items-center justify-center">
          <i className="fa-solid fa-user-plus" style={{ color: '#22d3c7' }} />
        </button>
      </div>
    </div>
  )
}

