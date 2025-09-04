import { useEffect, useState } from 'react'
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

  useEffect(() => { setTitle('Your Communities') }, [setTitle])

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      {/* Global header used from App */}

      {/* Secondary nav like X */}
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
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
      {/* Menu unified via HeaderBar */}

      <div className="max-w-2xl mx-auto pt-[96px] h-[calc(100vh-96px)] pb-10 px-3 overflow-y-auto no-scrollbar">
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
            {communities.length === 0 ? (
              <div className="text-[#9fb0b5]">You are not a member of any communities.</div>
            ) : communities.map(c => (
              <div key={c.id} className="w-full px-3 py-2 rounded-2xl bg-white/[0.035] hover:bg-white/[0.06] flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-[#9fb0b5]">{c.type || 'Community'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 rounded-full border border-[#4db6ac] text-white hover:bg-[#0f1919]" onClick={()=>{
                    const ua = navigator.userAgent || ''
                    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua) || window.innerWidth < 768
                    if (isMobile) navigate(`/community_feed_react/${c.id}`); else window.location.href = `/community_feed/${c.id}`
                  }}>Enter</button>
                  <button className="px-3 py-1.5 rounded-full border border-red-500 text-red-400 hover:bg-red-950/30" onClick={async()=>{
                    const fd = new URLSearchParams({ community_id: String(c.id) })
                    const r = await fetch('/leave_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                    const j = await r.json().catch(()=>null)
                    if (j?.success) window.location.reload()
                    else alert(j?.error||'Error leaving community')
                  }}>Leave</button>
                </div>
              </div>
            ))}
          </div>
        )}
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
        <input value={code} onChange={e=> setCode(e.target.value)} placeholder="Enter join code" className="flex-1 px-3 py-2 rounded-xl bg-black border border-[#666] text-white placeholder-[#888] focus:outline-none" />
        <button className="px-4 py-2 rounded-full border border-[#4db6ac] text-white hover:bg-[#0f1919]" onClick={submit}>Join</button>
      </div>
    </div>
  )
}

