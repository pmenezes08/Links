import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'

export default function PublicProfile(){
  const { username = '' } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<any>(null)

  useEffect(() => { setTitle(username ? `@${username}` : 'Profile') }, [setTitle, username])

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const r = await fetch(`/api/profile/${encodeURIComponent(username)}`)
        const j = await r.json().catch(()=>null)
        if (!mounted) return
        if (j?.success){
          setProfile(j.profile)
          setError(null)
        } else setError(j?.error || 'Not found')
      }catch{ if (mounted) setError('Error loading') } finally { if (mounted) setLoading(false) }
    }
    if (username) load()
    return () => { mounted = false }
  }, [username])

  if (loading) return <div className="min-h-screen pt-14 bg-black text-white p-3">Loading…</div>
  if (error) return <div className="min-h-screen pt-14 bg-black text-white p-3 text-red-400">{error}</div>
  if (!profile) return <div className="min-h-screen pt-14 bg-black text-white p-3">No profile.</div>

  return (
    <div className="min-h-screen pt-14 bg-black text-white">
      <div className="max-w-2xl mx-auto px-3 py-3">
        <div className="mb-2">
          <button className="p-2 rounded-full hover:bg-white/10" aria-label="Back" onClick={()=> navigate(-1)}>
            <i className="fa-solid fa-arrow-left" />
          </button>
        </div>
        {/* Header */}
        <div className="rounded-2xl border border-white/10 overflow-hidden bg-black">
          {profile.cover_photo ? (
            <div className="h-36 w-full overflow-hidden border-b border-white/10">
              <ImageLoader src={profile.cover_photo.startsWith('http') ? profile.cover_photo : `/uploads/${profile.cover_photo}`} alt="Cover" className="w-full h-full object-cover" />
            </div>
          ) : null}
          <div className="p-3 flex items-center gap-3">
            <Avatar username={profile.username} url={profile.profile_picture || undefined} size={56} />
            <div className="min-w-0">
              <div className="font-semibold text-lg truncate">{profile.display_name || profile.username}</div>
              <div className="text-sm text-[#9fb0b5] truncate">@{profile.username}</div>
            </div>
            <button className="ml-auto px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm" onClick={()=> navigate('/user_chat/new')}>Message</button>
          </div>
        </div>

        {/* Bio */}
        {profile.bio ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black p-3">
            <div className="text-sm whitespace-pre-wrap text-white/90">{profile.bio}</div>
          </div>
        ) : null}

        {/* Location */}
        {profile.location ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black p-3">
            <div className="text-sm text-[#9fb0b5]"><i className="fa-solid fa-location-dot mr-2" />{profile.location}</div>
          </div>
        ) : null}

        {/* Links */}
        {(profile.website || profile.instagram || profile.twitter) ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black p-3 flex flex-wrap gap-3 text-sm">
            {profile.website && <a className="underline text-[#4db6ac]" href={profile.website.startsWith('http')?profile.website:`http://${profile.website}`} target="_blank" rel="noreferrer">Website</a>}
            {profile.instagram && <a className="underline text-[#4db6ac]" href={`https://instagram.com/${profile.instagram}`} target="_blank" rel="noreferrer">Instagram</a>}
            {profile.twitter && <a className="underline text-[#4db6ac]" href={`https://twitter.com/${profile.twitter}`} target="_blank" rel="noreferrer">Twitter</a>}
          </div>
        ) : null}

      </div>
    </div>
  )
}