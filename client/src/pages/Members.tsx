import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

type Member = { username: string; profile_picture?: string | null }

export default function Members(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [members, setMembers] = useState<Member[]>([])
  const [communityName, setCommunityName] = useState<string>('Members')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        // Permissions
        try{
          const fd = new URLSearchParams({ community_id: String(community_id) })
          const perm = await fetch('/get_community_members', { method:'POST', credentials:'include', body: fd })
          const pj = await perm.json()
          if (mounted && pj?.success !== false){
            const role = pj.current_user_role
            const isAdminUser = pj.username === 'admin' || pj.is_app_admin
            const can = isAdminUser || role === 'admin' || role === 'owner'
            setCanManage(!!can)
          }
        }catch{}

        // Members list
        const r = await fetch(`/community/${community_id}/members/list`, { credentials: 'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){
          setMembers(j.members || [])
          setCommunityName(j.community_name || 'Members')
          setError(null)
        } else {
          setError(j?.message || j?.error || 'Error loading members')
        }
      }catch{
        if (mounted) setError('Error loading members')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [community_id])

  async function addMember(){
    const username = prompt('Enter username to add')?.trim()
    if (!username) return
    const fd = new URLSearchParams({ community_id: String(community_id), username })
    const r = await fetch('/add_community_member', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      // reload list
      try{
        const rr = await fetch(`/community/${community_id}/members/list`, { credentials: 'include' })
        const jj = await rr.json()
        if (jj?.success) setMembers(jj.members || [])
      }catch{}
    } else {
      alert(j?.error || 'Unable to add member')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-0 right-0 top-0 h-12 border-b border-white/10 bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> navigate(-1)} aria-label="Back">
          <i className="fa-solid fa-arrow-left" />
        </button>
        <div className="ml-2 font-semibold truncate">{communityName}</div>
        {canManage ? (
          <button className="ml-auto p-2 rounded-full hover:bg-white/5" onClick={addMember} aria-label="Add member">
            <i className="fa-solid fa-user-plus" style={{ color:'#4db6ac' }} />
          </button>
        ) : null}
      </div>
      <div className="max-w-2xl mx-auto pt-14 px-3 pb-6">
        {loading ? (
          <div className="text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <div className="space-y-2">
            {members.length === 0 ? (
              <div className="text-[#9fb0b5]">No members.</div>
            ) : members.map((m, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.03]">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-white/10">
                  {m.profile_picture ? (
                    <img src={(m.profile_picture.startsWith('http') || m.profile_picture.startsWith('/static')) ? m.profile_picture : `/static/${m.profile_picture}`} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-[#6c757d]"><i className="fa-solid fa-user" /></div>
                  )}
                </div>
                <div className="font-medium">{m.username}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

