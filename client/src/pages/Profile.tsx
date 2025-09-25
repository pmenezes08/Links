import React, { useEffect, useState } from 'react'
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
    display_name: '', location: '', is_public: true,
    role: '', company: '', industry: '', linkedin: '',
    age: '', gender: '', country: '', city: '',
    share_community_id: '' as string
  })
  const [communities, setCommunities] = useState<Array<{id:number,name:string,type?:string}>>([])
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

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
            location: j.profile.location || ''
          }))
        }
        else setError(j?.error || 'Error')
      }catch{
        if (mounted) setError('Error')
      } finally { if (mounted) setLoading(false) }
    }
    load()
    // Load user's communities for sharing dropdown
    ;(async () => {
      try{
        const rc = await fetch('/api/user_parent_community', { credentials:'include' })
        const jc = await rc.json().catch(()=>null)
        if (jc?.success && Array.isArray(jc.communities)){
          setCommunities(jc.communities)
        }
      }catch{}
    })()
    return () => { mounted = false }
  }, [])

  function handlePhotoSelect(event: React.ChangeEvent<HTMLInputElement>){
    const file = event.target.files?.[0]
    if (file){
      setSelectedPhoto(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        setPhotoPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  async function handleCameraCapture(){
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      const video = document.createElement('video')
      video.srcObject = stream
      video.play()

      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = 300
      const ctx = canvas.getContext('2d')

      // Wait for video to load
      await new Promise((resolve) => {
        video.onloadeddata = resolve
      })

      ctx?.drawImage(video, 0, 0, 300, 300)
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' })
          setSelectedPhoto(file)
          setPhotoPreview(canvas.toDataURL())
        }
      }, 'image/jpeg', 0.8)

      stream.getTracks().forEach(track => track.stop())
    } catch (error) {
      alert('Camera access denied or not available')
    }
  }

  async function uploadProfilePicture(){
    if (!selectedPhoto) return

    setUploadingPhoto(true)
    try {
      const fd = new FormData()
      fd.append('profile_picture', selectedPhoto)
      const r = await fetch('/upload_profile_picture', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json()
      if (j?.success) {
        setData(d => d ? { ...d, profile_picture: j.profile_picture } : d)
        setShowPhotoModal(false)
        setSelectedPhoto(null)
        setPhotoPreview(null)
      } else {
        alert(j?.error || 'Upload failed')
      }
    } catch (error) {
      alert('Upload failed')
    } finally {
      setUploadingPhoto(false)
    }
  }

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
          <button
            className="relative group cursor-pointer"
            onClick={() => setShowPhotoModal(true)}
            aria-label="Change profile picture"
          >
            <Avatar username={data.username} url={data.profile_picture || undefined} size={56} />
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <i className="fa-solid fa-camera text-white text-lg" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#4db6ac] rounded-full flex items-center justify-center">
              <i className="fa-solid fa-plus text-xs text-white" />
            </div>
          </button>
          <div>
            <div className="text-lg font-semibold">{data.display_name || data.username}</div>
            <div className="text-sm text-[#9fb0b5]">@{data.username} • {data.subscription||'free'}</div>
          </div>
        </div>
        {/* Bio display removed */}
        {/* Public Profile form */}
        <div className="rounded-xl border border-white/10 p-3">
          <div className="font-semibold mb-2">Public Profile</div>
          <form onSubmit={async (e)=>{
            e.preventDefault()
            const fd = new FormData()
            fd.append('display_name', form.display_name)
            fd.append('location', form.location)
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
            </div>
            {/* Bio input removed */}
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
            fd.append('linkedin', form.linkedin)
            if (form.share_community_id) fd.append('share_community_id', form.share_community_id)
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
              <input className="rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" placeholder="LinkedIn" value={form.linkedin} onChange={e=> setForm(f=>({...f, linkedin: e.target.value}))} />
              <label className="text-sm">
                Share Professional Info with Community
                <select className="mt-1 w-full rounded-md bg-black text-white border border-white/10 px-2 py-1.5 text-[16px] outline-none focus:border-[#4db6ac] focus:ring-1 focus:ring-[#4db6ac]" value={form.share_community_id} onChange={e=> setForm(f=>({...f, share_community_id: e.target.value}))}>
                  <option value="">Do not share</option>
                  {communities.map(c => (
                    <option key={c.id} value={String(c.id)}>{c.name}</option>
                  ))}
                </select>
              </label>
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

      {/* Photo Upload Modal */}
      {showPhotoModal && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> e.currentTarget===e.target && setShowPhotoModal(false)}>
          <div className="w-[90%] max-w-md rounded-2xl border border-white/10 bg-black p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold">Change Profile Picture</div>
              <button className="px-2 py-1 rounded-full border border-white/10" onClick={()=> setShowPhotoModal(false)}>✕</button>
            </div>

            {/* Photo Preview */}
            {photoPreview ? (
              <div className="mb-4">
                <div className="relative w-32 h-32 mx-auto mb-2">
                  <img src={photoPreview} alt="Preview" className="w-full h-full rounded-full object-cover border-2 border-white/20" />
                </div>
                <div className="text-center">
                  <button
                    onClick={uploadProfilePicture}
                    disabled={uploadingPhoto}
                    className="px-4 py-2 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110 disabled:opacity-50"
                  >
                    {uploadingPhoto ? 'Uploading...' : 'Update Profile Picture'}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Photo Selection Options */}
            <div className="space-y-3">
              <button
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5"
                onClick={() => fileInputRef.current?.click()}
              >
                <i className="fa-solid fa-file-image text-[#4db6ac]" />
                <span>Choose from gallery</span>
              </button>

              <button
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5"
                onClick={handleCameraCapture}
              >
                <i className="fa-solid fa-camera text-[#4db6ac]" />
                <span>Take photo</span>
              </button>

              <button
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 hover:bg-white/5 text-red-400"
                onClick={() => {
                  setShowPhotoModal(false)
                  setSelectedPhoto(null)
                  setPhotoPreview(null)
                }}
              >
                <i className="fa-solid fa-times" />
                <span>Cancel</span>
              </button>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              className="hidden"
            />
          </div>
        </div>
      )}
    </div>
  )
}

