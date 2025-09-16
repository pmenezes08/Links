import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

export default function PublicProfile(){
  const { username = '' } = useParams()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [profile, setProfile] = useState<any|null>(null)
  const [posts, setPosts] = useState<any[]>([])
  const [communities, setCommunities] = useState<any[]>([])

  useEffect(() => { setTitle('Profile') }, [setTitle])

  useEffect(() => {
    let ok = true
    async function load(){
      setLoading(true)
      setError(null)
      try{
        const r = await fetch(`/api/profile/${encodeURIComponent(username||'')}`)
        const j = await r.json()
        if (!ok) return
        if (j?.success){
          setProfile(j.profile)
          setPosts(j.posts || [])
          setCommunities(j.communities || [])
          const displayName = j.profile?.display_name || j.profile?.username || username
          setTitle(displayName)
        } else {
          setError(j?.error || 'Profile not found')
        }
      }catch{
        if (ok) setError('Failed to load profile')
      }finally{
        if (ok) setLoading(false)
      }
    }
    load()
    return ()=> { ok = false }
  }, [username, setTitle])

  if (loading) return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-xl mx-auto p-3 text-[#9fb0b5]">Loading…</div>
    </div>
  )
  if (error || !profile) return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-xl mx-auto p-3 text-red-400">{error || 'Profile not found'}</div>
    </div>
  )

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-2xl mx-auto px-3 py-4">
        {/* Cover */}
        {profile.cover_photo ? (
          <div className="w-full h-36 rounded-xl overflow-hidden border border-white/10 mb-3">
            <img src={`/${profile.cover_photo}`} alt="Cover" className="w-full h-full object-cover"/>
          </div>
        ) : null}

        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-16 h-16 rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center">
            {profile.profile_picture ? (
              <img src={`/${profile.profile_picture}`} alt={profile.username} className="w-full h-full object-cover"/>
            ) : (
              <i className="fa-solid fa-user text-2xl text-[#9fb0b5]" />
            )}
          </div>
          <div>
            <div className="text-base font-semibold leading-tight">{profile.display_name || profile.username}</div>
            <div className="text-sm text-[#9fb0b5]">@{profile.username}</div>
          </div>
        </div>

        {/* Bio */}
        {profile.bio && (
          <div className="text-sm text-white/90 mb-3 whitespace-pre-wrap">{profile.bio}</div>
        )}

        {/* Links */}
        <div className="flex flex-wrap gap-3 text-sm mb-4">
          {profile.location && (
            <div className="text-[#9fb0b5]"><i className="fa-solid fa-location-dot mr-2"/>{profile.location}</div>
          )}
          {profile.website && (
            <a href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`} target="_blank" rel="noreferrer" className="text-[#4db6ac] hover:underline"><i className="fa-solid fa-link mr-2"/>Website</a>
          )}
          {profile.instagram && (
            <a href={`https://instagram.com/${profile.instagram}`} target="_blank" rel="noreferrer" className="text-[#4db6ac] hover:underline"><i className="fa-brands fa-instagram mr-2"/>Instagram</a>
          )}
          {profile.twitter && (
            <a href={`https://twitter.com/${profile.twitter}`} target="_blank" rel="noreferrer" className="text-[#4db6ac] hover:underline"><i className="fa-brands fa-x-twitter mr-2"/>Twitter</a>
          )}
        </div>

        {/* Communities */}
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Communities</div>
          {communities.length === 0 ? (
            <div className="text-[#9fb0b5] text-sm">No communities</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {communities.map((c:any) => (
                <span key={c.id} className="px-2 py-1 rounded-md border border-white/10 text-xs bg-white/5">{c.name}</span>
              ))}
            </div>
          )}
        </div>

        {/* Posts */}
        <div>
          <div className="text-sm font-semibold mb-2">Recent Posts</div>
          {posts.length === 0 ? (
            <div className="text-[#9fb0b5] text-sm">No posts</div>
          ) : (
            <div className="space-y-2">
              {posts.map((p:any) => (
                <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[13px] text-white/90 whitespace-pre-wrap">{p.content}</div>
                  {p.image_path && (
                    <div className="mt-2 overflow-hidden rounded-lg border border-white/10">
                      <img src={`/${p.image_path}`} alt="post" className="w-full object-cover"/>
                    </div>
                  )}
                  <div className="text-[11px] text-[#9fb0b5] mt-2">{String(p.timestamp || '').replace('T',' ').slice(0,16)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}