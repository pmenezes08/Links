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
  const [form, setForm] = useState({
    display_name: '', bio: '', location: '', website: '', instagram: '', twitter: '', is_public: true,
    role: '', company: '', industry: '', degree: '', school: '', skills: '', linkedin: '', experience: '',
    age: '', gender: '', country: '', city: ''
  })

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const r = await fetch('/api/profile_me', { credentials:'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){
          setData(j.profile)
          setForm(f => ({
            ...f,
            display_name: j.profile.display_name || '',
            bio: j.profile.bio || '',
            location: j.profile.location || '',
            website: j.profile.website || '',
            instagram: j.profile.instagram || '',
            twitter: j.profile.twitter || ''
          }))
        }
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
        {/* Public Profile form */}
        <div className="rounded-xl border border-white/10 p-3">
          <div className="font-semibold mb-2">Public Profile</div>
          <form onSubmit={async (e)=>{
            e.preventDefault()
            const fd = new FormData()
            fd.append('display_name', form.display_name)
            fd.append('bio', form.bio)
            fd.append('location', form.location)
            fd.append('website', form.website)
            fd.append('instagram', form.instagram)
            fd.append('twitter', form.twitter)
            fd.append('is_public', form.is_public ? 'on' : '')
            const r = await fetch('/update_public_profile', { method:'POST', credentials:'include', body: fd })
            const j = await r.json().catch(()=>null)
            if (!j?.success) alert(j?.error || 'Error updating')
          }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">Display Name
                <input className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={form.display_name} onChange={e=> setForm(f=>({...f, display_name: e.target.value}))} />
              </label>
              <label className="text-sm">Location
                <input className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={form.location} onChange={e=> setForm(f=>({...f, location: e.target.value}))} />
              </label>
              <label className="text-sm">Website
                <input className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={form.website} onChange={e=> setForm(f=>({...f, website: e.target.value}))} />
              </label>
              <label className="text-sm">Instagram
                <input className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={form.instagram} onChange={e=> setForm(f=>({...f, instagram: e.target.value}))} />
              </label>
              <label className="text-sm">Twitter
                <input className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={form.twitter} onChange={e=> setForm(f=>({...f, twitter: e.target.value}))} />
              </label>
            </div>
            <label className="block text-sm mt-3">Bio
              <textarea className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" rows={3} value={form.bio} onChange={e=> setForm(f=>({...f, bio: e.target.value}))} />
            </label>
            <label className="inline-flex items-center gap-2 mt-2 text-sm">
              <input type="checkbox" checked={form.is_public} onChange={e=> setForm(f=>({...f, is_public: e.target.checked}))} /> Public
            </label>
            <div className="mt-3">
              <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black">Update Public Profile</button>
              <a className="ml-3 text-sm text-[#9fb0b5] underline" href={`/profile/${data.username}`}>
                View Public Profile
              </a>
            </div>
          </form>
        </div>

        {/* Professional Information */}
        <div className="rounded-xl border border-white/10 p-3">
          <div className="font-semibold mb-2">Professional Information</div>
          <form onSubmit={async (e)=>{
            e.preventDefault()
            const fd = new FormData()
            fd.append('role', form.role)
            fd.append('company', form.company)
            fd.append('industry', form.industry)
            fd.append('degree', form.degree)
            fd.append('school', form.school)
            fd.append('skills', form.skills)
            fd.append('linkedin', form.linkedin)
            fd.append('experience', form.experience)
            const r = await fetch('/update_professional', { method:'POST', credentials:'include', body: fd })
            const j = await r.json().catch(()=>null)
            if (j?.success) {
              alert('Professional information updated successfully!')
            } else {
              alert(j?.error || 'Error updating')
            }
          }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Role" value={form.role} onChange={e=> setForm(f=>({...f, role: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Company" value={form.company} onChange={e=> setForm(f=>({...f, company: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Industry" value={form.industry} onChange={e=> setForm(f=>({...f, industry: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Degree" value={form.degree} onChange={e=> setForm(f=>({...f, degree: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="School" value={form.school} onChange={e=> setForm(f=>({...f, school: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Skills" value={form.skills} onChange={e=> setForm(f=>({...f, skills: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="LinkedIn" value={form.linkedin} onChange={e=> setForm(f=>({...f, linkedin: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Experience" value={form.experience} onChange={e=> setForm(f=>({...f, experience: e.target.value}))} />
            </div>
            <button type="submit" className="mt-3 px-3 py-1.5 rounded-md bg-[#4db6ac] text-black">Save Professional Info</button>
          </form>
        </div>

        {/* Personal Information */}
        <div className="rounded-xl border border-white/10 p-3">
          <div className="font-semibold mb-2">Personal Details</div>
          <form onSubmit={async (e)=>{
            e.preventDefault()
            const fd = new FormData()
            fd.append('age', form.age)
            fd.append('gender', form.gender)
            fd.append('country', form.country)
            fd.append('city', form.city)
            const r = await fetch('/update_personal_info', { method:'POST', credentials:'include', body: fd })
            const j = await r.json().catch(()=>null)
            if (!j?.success) alert(j?.error || 'Error updating')
          }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Age" value={form.age} onChange={e=> setForm(f=>({...f, age: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Gender" value={form.gender} onChange={e=> setForm(f=>({...f, gender: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="Country" value={form.country} onChange={e=> setForm(f=>({...f, country: e.target.value}))} />
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="City" value={form.city} onChange={e=> setForm(f=>({...f, city: e.target.value}))} />
            </div>
            <button className="mt-3 px-3 py-1.5 rounded-md bg-[#4db6ac] text-black">Save Personal Details</button>
          </form>
        </div>
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

