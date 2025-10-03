import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export default function OnboardingProfilePicture(){
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const next = useMemo(()=> {
    const n = sp.get('next')
    return n && n.startsWith('/') ? n : '/premium_dashboard'
  }, [sp])

  const [picFile, setPicFile] = useState<File | null>(null)
  const [picPreview, setPicPreview] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(()=>{
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function onFile(e: React.ChangeEvent<HTMLInputElement>){
    setError('')
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null
    setPicFile(f)
    if (f){
      try{ setPicPreview(URL.createObjectURL(f)) }catch{ setPicPreview('') }
    } else {
      setPicPreview('')
    }
  }

  async function onUpload(){
    setError('')
    if (!picFile){ setError('Please choose an image.'); return }
    setUploading(true)
    try{
      const fd = new FormData()
      fd.append('profile_picture', picFile)
      const r = await fetch('/upload_profile_picture', { method:'POST', credentials:'include', body: fd })
      const j = await r.json().catch(()=>null)
      if (r.ok && j?.success){
        navigate(next, { replace: true })
      } else {
        setError(j?.error || 'Failed to upload. Please try again.')
      }
    }catch{
      setError('Network error. Please try again.')
    }finally{
      setUploading(false)
    }
  }

  function onSkip(){ navigate(next, { replace: true }) }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
      <div className="w-[92%] max-w-md rounded-2xl border border-white/10 bg-[#0b0f10] p-5 text-white">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Add a profile picture</div>
          <button className="text-[#9fb0b5] text-2xl" onClick={onSkip}>&times;</button>
        </div>
        <div className="mt-3 text-sm text-[#9fb0b5]">Help people recognize you. You can change this later in your profile.</div>
        <div className="mt-4">
          <input type="file" accept="image/*" onChange={onFile} className="block w-full text-sm text-white/80 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#4db6ac] file:text-black hover:file:brightness-110" />
          {picPreview ? (
            <div className="mt-3 flex items-center justify-center">
              <img src={picPreview} alt="Preview" className="max-h-48 rounded-lg border border-white/10" />
            </div>
          ) : null}
          {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        </div>
        <div className="mt-4 flex gap-2 justify-end">
          <button className="px-4 py-2 rounded-lg border border-white/10 bg-white/[0.04]" onClick={onSkip} disabled={uploading}>Skip for now</button>
          <button className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-semibold" onClick={onUpload} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload & continue'}</button>
        </div>
      </div>
    </div>
  )
}

