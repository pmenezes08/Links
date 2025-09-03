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
    // Inject legacy styles for consistency
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/static/styles.css'
    document.head.appendChild(link)
    return () => { document.head.removeChild(link) }
  }, [])

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        // Reuse feed API to get current user meta (avatar/name). Pick any community meta if needed later.
        // If fails, we still render basics.
        try{
          const r = await fetch(`/api/community_feed/0`, { credentials:'include' })
          const j = await r.json()
          if (mounted && j){
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
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> window.location.href = `/user_chat`} aria-label="Messages">
            <i className="fa-solid fa-cloud" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> window.location.href = `/notifications`} aria-label="Notifications">
            <i className="fa-regular fa-bell" />
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

      <div className="max-w-2xl mx-auto pt-16 pb-10 px-3">
        {loading ? (
          <div className="text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <div className="space-y-2">
            {communities.length === 0 ? (
              <div className="text-[#9fb0b5]">You are not a member of any communities.</div>
            ) : communities.map(c => (
              <button key={c.id} className="w-full text-left px-3 py-2 rounded-2xl border border-white/10 bg-white/[0.035] hover:bg-white/[0.06]" onClick={()=> navigate(`/community_feed_react/${c.id}`)}>
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

