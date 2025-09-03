import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type Community = { id:number; name:string; type?:string; is_active?:boolean }

export default function Communities(){
  const navigate = useNavigate()
  const [data, setData] = useState<{ username:string; current_user_profile_picture?:string|null; community_name?:string }|null>(null)
  const [communities, setCommunities] = useState<Community[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)

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

  return (
    <div className="h-screen overflow-y-auto no-scrollbar bg-black text-white">
      {/* Header with avatar burger and title */}
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#262f30] bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="mr-3 md:hidden" onClick={() => setMenuOpen(v=>!v)} aria-label="Menu">
          <div className="w-8 h-8 rounded-full bg-white/10 overflow-hidden">
            {data?.current_user_profile_picture ? (
              <img src={(data.current_user_profile_picture.startsWith('http') || data.current_user_profile_picture.startsWith('/static')) ? data.current_user_profile_picture : `/static/${data.current_user_profile_picture}`} alt="" className="w-full h-full object-cover" />
            ) : (<i className="fa-solid fa-user" />)}
          </div>
        </button>
        <div className="font-semibold truncate tracking-[-0.01em] flex-1">Your Communities</div>
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate('/user_chat')} aria-label="Messages">
            <i className="fa-solid fa-cloud" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate('/notifications')} aria-label="Notifications">
            <i className="fa-regular fa-bell" />
          </button>
        </div>
      </div>

      {/* Secondary nav like X */}
      <div className="fixed left-0 right-0 top-14 h-10 border-b border-[#262f30] bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex">
          <button type="button" className="flex-1 text-center text-sm font-medium text-[#9fb0b5] hover:text-white/90" onClick={()=> navigate('/home')}>
            <div className="pt-2">Home timeline</div>
            <div className="h-0.5 bg-transparent rounded-full w-16 mx-auto mt-1" />
          </button>
          <button type="button" className="flex-1 text-center text-sm font-medium text-white/95">
            <div className="pt-2">Communities</div>
            <div className="h-0.5 bg-[#4db6ac] rounded-full w-16 mx-auto mt-1" />
          </button>
        </div>
      </div>

      {/* Slide-out menu (90% width) same as feed */}
      {menuOpen && (
        <div className="fixed inset-0 z-[90] flex bg-black/50" onClick={(e)=> e.currentTarget===e.target && setMenuOpen(false)}>
          <div className="w-[90%] h-full bg-black/95 backdrop-blur border-r border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10">
                {data?.current_user_profile_picture ? (
                  <img src={(data.current_user_profile_picture.startsWith('http') || data.current_user_profile_picture.startsWith('/static')) ? data.current_user_profile_picture : `/static/${data.current_user_profile_picture}`} alt="" className="w-full h-full object-cover" />
                ) : (<i className="fa-solid fa-user" />)}
              </div>
              <div className="font-medium truncate">{data?.username||''}</div>
            </div>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/dashboard">Dashboard</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/profile">Profile</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/user_chat">Messages</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/your_sports">Your Sports</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/logout">Logout</a>
            <a className="block px-4 py-3 rounded-xl hover:bg-white/5" href="/account_settings">Settings</a>
          </div>
          <div className="flex-1 h-full" onClick={()=> setMenuOpen(false)} />
        </div>
      )}

      <div className="max-w-2xl mx-auto pt-28 pb-10 px-3">
        {loading ? (
          <div className="text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <div className="space-y-2">
            {communities.length === 0 ? (
              <div className="text-[#9fb0b5]">You are not a member of any communities.</div>
            ) : communities.map(c => (
              <button key={c.id} type="button" className="w-full text-left px-3 py-2 rounded-2xl bg-white/[0.035] hover:bg-white/[0.06]" onClick={()=> { window.location.href = `/community_feed/${c.id}` }}>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-[#9fb0b5]">{c.type || 'Community'}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

