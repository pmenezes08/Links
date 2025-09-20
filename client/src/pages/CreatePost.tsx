import { useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export default function CreatePost(){
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const communityId = params.get('community_id') || ''
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File|null>(null)
  const [submitting, setSubmitting] = useState(false)
  const tokenRef = useRef<string>(`${Date.now()}_${Math.random().toString(36).slice(2)}`)

  async function submit(){
    if (!content && !file) return
    if (submitting) return
    setSubmitting(true)
    try{
      const fd = new FormData()
      fd.append('content', content)
      if (communityId) fd.append('community_id', communityId)
      if (file) fd.append('image', file)
      fd.append('dedupe_token', tokenRef.current)
      await fetch('/post_status', { method: 'POST', credentials: 'include', body: fd })
      // Regardless of server response, navigate back to feed to avoid double tap
      if (communityId) navigate(`/community_feed_react/${communityId}`)
      else navigate(-1)
    }catch{
      setSubmitting(false)
      alert('Failed to post. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      <div className="fixed left-0 right-0 top-14 h-12 border-b border-white/10 bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> communityId ? navigate(`/community_feed_react/${communityId}`) : navigate(-1)} aria-label="Back">
          <i className="fa-solid fa-arrow-left" />
        </button>
      </div>
      <div className="max-w-2xl mx-auto pt-24 px-3">
        <textarea className="w-full min-h-[180px] p-3 rounded-xl bg-black border border-white/10 text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]" placeholder="What's happening?" value={content} onChange={(e)=> setContent(e.target.value)} />
        {file ? (
          <div className="mt-3 rounded-xl overflow-hidden border border-white/10">
            <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-auto" />
          </div>
        ) : null}
      </div>
      <div className="fixed left-0 right-0 bottom-0 h-16 border-t border-white/10 bg-black/85 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full px-4 flex items-center justify-between">
          <label className="px-3 py-2 rounded-full hover:bg-white/5 cursor-pointer" aria-label="Add image">
            <i className="fa-regular fa-image" style={{ color: '#4db6ac' }} />
            <input type="file" accept="image/*" onChange={(e)=> setFile(e.target.files?.[0]||null)} style={{ display: 'none' }} />
          </label>
          <button className={`px-4 py-2 rounded-full ${submitting ? 'bg-white/20 text-white/60 cursor-not-allowed' : 'bg-[#4db6ac] text-black hover:brightness-110'}`} onClick={submit} disabled={submitting}>
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

