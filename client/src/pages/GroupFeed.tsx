import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import CommunityFeed from './CommunityFeed'

export default function GroupFeed(){
  // Reuse CommunityFeed layout and behaviors by temporarily mapping group_id to a derived community context
  // Backend /api/group_feed mirrors community feed structure; we keep UI consistent
  // For now, simply render CommunityFeed-like shell by fetching group and composing similar markup would duplicate code.
  // Shortcut: redirect to a lightweight shell is not ideal; we wrap to preserve header and navigation.
  const { group_id } = useParams()
  const [meta, setMeta] = useState<{ community_id?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ok = true
    async function load(){
      if (!group_id) return
      setLoading(true)
      try{
        const r = await fetch(`/api/group_feed?group_id=${group_id}`, { credentials:'include' })
        const j = await r.json().catch(()=>null)
        if (!ok) return
        if (j?.success){
          // Infer community id by fetching first post or fallback
          // For now, let CommunityFeed read its own community_id from URL if needed
          setMeta({})
        } else setError(j?.error || 'Failed to load group')
      }catch{ if (ok) setError('Failed to load group') }
      finally{ if (ok) setLoading(false) }
    }
    load(); return ()=> { ok = false }
  }, [group_id])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>
  // Render CommunityFeed to keep layout identical; backend should be extended to accept group context later.
  return <CommunityFeed />
}
