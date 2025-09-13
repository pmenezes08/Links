import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type Community = { id:number; name:string; type?:string; is_active?:boolean }

export default function Communities(){
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [_data, setData] = useState<{ username:string; current_user_profile_picture?:string|null; community_name?:string }|null>(null)
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [swipedCommunity, setSwipedCommunity] = useState<number|null>(null)
  
  async function createCommunity(){
    try{
      const nameRaw = window.prompt('Community name?')
      const name = (nameRaw || '').trim()
      if (!name) return
      const typeRaw = window.prompt('Type (e.g., community, gym, crossfit)?', 'community')
      const type = (typeRaw || 'community').trim() || 'community'
      const fd = new URLSearchParams({ name, type })
      const r = await fetch('/create_community', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fd,
      })
      const j = await r.json().catch(()=>null)
      if (j?.success) window.location.reload()
      else alert(j?.error || 'Failed to create community')
    }catch{}
  }

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

        const rc = await fetch('/get_user_communities', { credentials:'include' })
        const jc = await rc.json()
        if (!mounted) return
        if (jc?.success){
          setCommunities(jc.communities || [])
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

  useEffect(() => { setTitle('Community Management') }, [setTitle])

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      {/* Global header used from App */}

      {/* Secondary nav like X */}
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex">
          <button type="button" className="flex-1 text-center text-sm font-medium text-[#9fb0b5] hover:text-white/90" onClick={()=> navigate('/home')}>
            <div className="pt-2">Home Timeline</div>
            <div className="h-0.5 bg-transparent rounded-full w-16 mx-auto mt-1" />
          </button>
          <button type="button" className="flex-1 text-center text-sm font-medium text-white/95">
            <div className="pt-2">Community Management</div>
            <div className="h-0.5 bg-[#4db6ac] rounded-full w-16 mx-auto mt-1" />
          </button>
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
            {/* Join new community */}
            <JoinCommunity onJoined={()=>{
              // reload
              window.location.reload()
            }} />
            {/* Divider removed per request */}
            {communities.length === 0 ? (
              <div className="text-[#9fb0b5]">You are not a member of any communities.</div>
            ) : communities.map(c => (
              <CommunityItem 
                key={c.id} 
                community={c} 
                isSwipedOpen={swipedCommunity === c.id}
                onSwipe={(isOpen) => setSwipedCommunity(isOpen ? c.id : null)}
                onEnter={() => {
                  const ua = navigator.userAgent || ''
                  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua) || window.innerWidth < 768
                  if (isMobile) navigate(`/community_feed_react/${c.id}`); else window.location.href = `/community_feed/${c.id}`
                }}
                onLeave={async () => {
                  const fd = new URLSearchParams({ community_id: String(c.id) })
                  const r = await fetch('/leave_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                  const j = await r.json().catch(()=>null)
                  if (j?.success) window.location.reload()
                  else alert(j?.error||'Error leaving community')
                }}
              />
            ))}
          </div>
        )}
      </div>
      {/* Create community action */}
      <button
        aria-label="Create community"
        onClick={createCommunity}
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-[#22d3c7] hover:bg-[#2ee3d7] text-white shadow-lg flex items-center justify-center z-50"
      >
        <i className="fa-solid fa-plus" />
      </button>
    </div>
  )
}

function CommunityItem({ 
  community, 
  isSwipedOpen, 
  onSwipe, 
  onEnter, 
  onLeave 
}: { 
  community: Community
  isSwipedOpen: boolean
  onSwipe: (isOpen: boolean) => void
  onEnter: () => void
  onLeave: () => void
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

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-white/[0.035]">
      {/* Leave button (revealed on swipe) */}
      <div className="absolute inset-y-0 right-0 flex items-center pr-4">
        <button
          className="w-16 h-12 bg-red-500/20 text-red-400 rounded-lg flex items-center justify-center hover:bg-red-500/30 transition-colors"
          onClick={onLeave}
          style={{
            opacity: isSwipedOpen || dragX < -20 ? 1 : 0,
            transform: `translateX(${isSwipedOpen ? '0' : '100%'})`,
            transition: isDragging ? 'none' : 'all 0.2s ease-out'
          }}
        >
          <i className="fa-solid fa-user-minus" />
        </button>
      </div>

      {/* Swipeable community content */}
      <div
        className="w-full px-3 py-3 hover:bg-white/[0.06] flex items-center justify-between cursor-pointer"
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
        <div className="flex-1">
          <div className="font-medium">{community.name}</div>
          <div className="text-xs text-[#9fb0b5]">{community.type || 'Community'}</div>
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

