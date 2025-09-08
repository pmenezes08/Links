import { useEffect, useState } from 'react'
import Avatar from '../components/Avatar'

type Profile = {
  username: string
  email?: string
  subscription?: string
  display_name?: string|null
  bio?: string|null
  location?: string|null
  website?: string|null
  instagram?: string|null
  twitter?: string|null
  profile_picture?: string|null
  cover_photo?: string|null
}

export default function Profile(){
  const [data, setData] = useState<Profile|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const r = await fetch('/api/profile_me', { credentials:'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) setData(j.profile)
        else setError(j?.error || 'Error')
      }catch{
        if (mounted) setError('Error')
      } finally { if (mounted) setLoading(false) }
    }
    load()
    return () => { mounted = false }
  }, [])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error || !data) return <div className="p-4 text-red-400">{error||'Error'}</div>

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white overflow-y-auto">
      <div className="max-w-2xl mx-auto p-3 space-y-3">
        {data.cover_photo ? (
          <div className="rounded-xl overflow-hidden border border-white/10">
            <img src={(data.cover_photo!.startsWith('http') || data.cover_photo!.startsWith('/static')) ? data.cover_photo! : `/static/${data.cover_photo}`} alt="" className="w-full h-auto" />
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <Avatar username={data.username} url={data.profile_picture || undefined} size={56} />
          <div>
            <div className="text-lg font-semibold">{data.display_name || data.username}</div>
            <div className="text-sm text-[#9fb0b5]">@{data.username} • {data.subscription||'free'}</div>
          </div>
        </div>
        {data.bio ? (<div className="text-sm whitespace-pre-wrap text-white/90">{data.bio}</div>) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {data.location ? (<div className="text-[#9fb0b5]"><i className="fa-solid fa-location-dot mr-2" />{data.location}</div>) : null}
          {data.website ? (<a className="text-[#9fb0b5] hover:text-teal-300" href={data.website} target="_blank" rel="noreferrer"><i className="fa-solid fa-link mr-2" />{data.website}</a>) : null}
          {data.instagram ? (<a className="text-[#9fb0b5] hover:text-teal-300" href={`https://instagram.com/${data.instagram}`} target="_blank" rel="noreferrer"><i className="fa-brands fa-instagram mr-2" />@{data.instagram}</a>) : null}
          {data.twitter ? (<a className="text-[#9fb0b5] hover:text-teal-300" href={`https://x.com/${data.twitter}`} target="_blank" rel="noreferrer"><i className="fa-brands fa-x-twitter mr-2" />@{data.twitter}</a>) : null}
        </div>
      </div>
    </div>
  )
}

