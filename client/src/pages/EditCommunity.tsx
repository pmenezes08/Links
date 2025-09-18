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
  const [isOwner, setIsOwner] = useState(false)
  const [isChild, setIsChild] = useState(false)
  const [parentOptions, setParentOptions] = useState<Array<{ id:number; name:string; type?:string }>>([])
  const [selectedParentId, setSelectedParentId] = useState<string>('none')
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
        const owner = role === 'owner'
        setAllowed(!!can)
        setIsOwner(!!owner)
        if (!can){ setError('You do not have permission to manage this community.'); setLoading(false); return }
        // Load current community info
        const rc = await fetch(`/api/community_feed/${community_id}`, { credentials:'include' })
        const jc = await rc.json().catch(()=>null)
        if (jc?.success && jc.community){
          setName(jc.community.name || '')
          setType(jc.community.type || 'public')
          const pid = jc.community.parent_community_id
          if (pid){ setIsChild(true); setSelectedParentId(String(pid)) }
        }
        // Load available parents for dropdown
        try{
          const pr = await fetch('/get_available_parent_communities', { credentials:'include' })
          const pj = await pr.json().catch(()=>null)
          if (pj?.success && Array.isArray(pj.communities)) setParentOptions(pj.communities)
        }catch{}
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
    // Parent setting
    fd.append('parent_community_id', isChild && selectedParentId !== 'none' ? selectedParentId : 'none')
    if (imageFile) fd.append('background_file', imageFile)
    const r = await fetch('/update_community', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){
      navigate(`/community_feed_react/${community_id}`)
    } else {
      alert(j?.error || 'Failed to update community')
    }
  }

  async function onDelete(){
    if (!isOwner) return
    if (!window.confirm(`Are you sure you want to delete this community? This action cannot be undone.`)) return
    
    try {
      const fd = new URLSearchParams({ community_id: String(community_id) })
      const r = await fetch('/delete_community', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (j?.success){
        alert('Community deleted successfully')
        navigate('/communities_react')
      } else {
        alert(j?.error || 'Failed to delete community')
      }
    } catch (error) {
      alert('Failed to delete community')
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
        <div className="ml-2 font-semibold">Manage Community</div>
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
            <label className="block text-sm text-[#9fb0b5] mb-1">Hierarchy</label>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="hier" checked={!isChild} onChange={()=> setIsChild(false)} /> Parent community
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="hier" checked={isChild} onChange={()=> setIsChild(true)} /> Child of a parent
              </label>
            </div>
            {isChild && (
              <div className="mt-2">
                <label className="block text-xs text-[#9fb0b5] mb-1">Select parent community</label>
                <select className="w-full rounded-md bg-black border border-white/15 px-3 py-2 text-[16px] focus:border-[#4db6ac] outline-none" value={selectedParentId} onChange={e=> setSelectedParentId(e.target.value)}>
                  <option value="none">None</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={String(p.id)}>{p.name}{p.type?` (${p.type})`:''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm text-[#9fb0b5] mb-1">Community image</label>
            <input type="file" accept="image/*" onChange={e=> setImageFile(e.target.files?.[0]||null)} className="block w-full text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="px-3 py-2 rounded-md border border-white/10 hover:bg-white/5" onClick={()=> navigate(-1)}>Cancel</button>
            <button type="submit" className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110">Save Changes</button>
          </div>
        </form>

        {/* Delete Community Section - Only for owners */}
        {isOwner && (
          <div className="mt-8 pt-6 border-t border-white/10">
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h3>
              <p className="text-sm text-[#9fb0b5] mb-4">
                Deleting this community will permanently remove all posts, messages, and member data. This action cannot be undone.
              </p>
              <button 
                onClick={onDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium transition-colors"
              >
                Delete Community
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}