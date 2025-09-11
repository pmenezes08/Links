import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

export default function EditCommunity(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [type, setType] = useState('public')
  const [imageFile, setImageFile] = useState<File|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [allowed, setAllowed] = useState(false)
  const formRef = useRef<HTMLFormElement|null>(null)

  useEffect(() => {
    let mounted = true
    async function init(){
      try{
        // Check permissions via members endpoint
        const fd = new URLSearchParams({ community_id: String(community_id) })
        const r = await fetch('/get_community_members', { method:'POST', credentials:'include', body: fd })
        const j = await r.json()
        if (!mounted) return
        const role = j?.current_user_role
        const can = role === 'owner' || role === 'app_admin'
        setAllowed(!!can)
        if (!can){ setError('You do not have permission to edit this community.'); setLoading(false); return }
        // Load current community info
        const rc = await fetch(`/api/community_feed/${community_id}`, { credentials:'include' })
        const jc = await rc.json().catch(()=>null)
        if (jc?.success && jc.community){
          setName(jc.community.name || '')
          setType(jc.community.type || 'public')
        }
        setLoading(false)
      }catch{
        if (mounted){ setError('Failed to load community'); setLoading(false) }
      }
    }
    init()
    return () => { mounted = false }
  }, [community_id])

  async function onSubmit(e: React.FormEvent){
    e.preventDefault()
    if (!allowed) return
    const fd = new FormData()
    fd.append('community_id', String(community_id))
    fd.append('name', name.trim())
    fd.append('type', type)
    if (imageFile) fd.append('background_file', imageFile)
    const r = await fetch('/update_community', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      navigate(`/community_feed_react/${community_id}`)
    } else {
      alert(j?.error || 'Failed to update community')
    }
  }

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>
  if (!allowed) return <div className="p-4 text-[#9fb0b5]">No access.</div>

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-0 right-0 top-0 h-12 border-b border-white/10 bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> navigate(-1)}>
          <i className="fa-solid fa-arrow-left" />
        </button>
        <div className="ml-2 font-semibold">Edit community</div>
      </div>

      <div className="max-w-2xl mx-auto pt-14 px-3 pb-24">
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Community name</label>
            <input className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" value={name} onChange={e=> setName(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Community type</label>
            <select className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" value={type} onChange={e=> setType(e.target.value)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Community image</label>
            <input type="file" accept="image/*" onChange={e=> setImageFile(e.target.files?.[0]||null)} className="block w-full text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-2 rounded-md border border-white/10 hover:bg-white/5" onClick={()=> navigate(-1)}>Cancel</button>
            <button type="submit" className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}