import { useState, useRef, useEffect } from 'react'
import MentionTextarea from '../components/MentionTextarea'
import { useAudioRecorder } from '../components/useAudioRecorder'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { detectLinks, replaceLinkInText, type DetectedLink } from '../utils/linkUtils.tsx'

export default function CreatePost(){
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const communityId = params.get('community_id') || ''
  const groupId = params.get('group_id') || ''
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File|null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { recording, preview, start, stop, clearPreview, ensurePreview, level, recordMs } = useAudioRecorder() as any
  const [showPraise, setShowPraise] = useState(false)
  const [detectedLinks, setDetectedLinks] = useState<DetectedLink[]>([])
  const [renamingLink, setRenamingLink] = useState<DetectedLink | null>(null)
  const [linkDisplayName, setLinkDisplayName] = useState('')
  const tokenRef = useRef<string>(`${Date.now()}_${Math.random().toString(36).slice(2)}`)

  // Detect links when content changes
  useEffect(() => {
    const links = detectLinks(content)
    // Filter out video embed URLs (YouTube, Vimeo, TikTok)
    // Instagram is treated as regular link (can be renamed)
    const nonVideoLinks = links.filter(link => {
      const url = link.url.toLowerCase()
      return !url.includes('youtube.com') && 
             !url.includes('youtu.be') && 
             !url.includes('vimeo.com') &&
             !url.includes('tiktok.com')
    })
    setDetectedLinks(nonVideoLinks)
  }, [content])

  function startRenamingLink(link: DetectedLink) {
    setRenamingLink(link)
    setLinkDisplayName(link.displayText)
  }

  function saveRenamedLink() {
    if (!renamingLink) return
    const newContent = replaceLinkInText(content, renamingLink.url, linkDisplayName)
    setContent(newContent)
    setRenamingLink(null)
    setLinkDisplayName('')
  }

  function cancelRenaming() {
    setRenamingLink(null)
    setLinkDisplayName('')
  }

  async function submit(){
    // If user is still recording, stop and wait briefly for preview to finalize
    if (recording) await ensurePreview(5000)
    if (!content && !file && !preview?.blob) {
      alert('Add text, an image, or finish recording audio before posting')
      return
    }
    if (submitting) return
    setSubmitting(true)
    
    // Check if this is from onboarding (first post)
    const isFirstPost = params.get('first_post') === 'true'
    
    try{
      const fd = new FormData()
      fd.append('content', content)
      if (file) fd.append('image', file)
      if (preview?.blob) fd.append('audio', preview.blob, (preview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm'))
      fd.append('dedupe_token', tokenRef.current)
      if (groupId){
        fd.append('group_id', groupId)
        const r = await fetch('/api/group_posts', { method: 'POST', credentials: 'include', body: fd })
        await r.json().catch(()=>null)
      } else {
        if (communityId) fd.append('community_id', communityId)
        const r = await fetch('/post_status', { method: 'POST', credentials: 'include', body: fd })
        // Try reading JSON when available, otherwise ignore redirects
        await r.json().catch(()=>null)
      }
      
      // Show praise for first post
      if (!groupId && isFirstPost) {
        setShowPraise(true)
        setTimeout(() => {
          setShowPraise(false)
          if (communityId) navigate(`/community_feed_react/${communityId}`)
          else navigate(-1)
        }, 2000)
      } else {
        // Regardless of server response, navigate back to feed to avoid double tap
        if (groupId) navigate(`/group_feed_react/${groupId}`)
        else if (communityId) navigate(`/community_feed_react/${communityId}`)
        else navigate(-1)
      }
    }catch{
      setSubmitting(false)
      alert('Failed to post. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white pb-20">
      {/* Praise notification */}
      {showPraise && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
          <div className="px-6 py-3 rounded-full border border-[#4db6ac]/40 bg-black/90 backdrop-blur-sm shadow-lg">
            <div className="text-sm font-medium text-white">
              Great job! <span className="text-[#4db6ac]">First post created</span> ✨
            </div>
          </div>
        </div>
      )}
      <div className="fixed left-0 right-0 top-14 h-12 border-b border-white/10 bg-black/70 backdrop-blur flex items-center px-3 z-40">
        <button className="px-3 py-2 rounded-full text-[#cfd8dc] hover:text-[#4db6ac]" onClick={()=> communityId ? navigate(`/community_feed_react/${communityId}`) : navigate(-1)} aria-label="Back">
          <i className="fa-solid fa-arrow-left" />
        </button>
      </div>
      <div className="max-w-2xl mx-auto pt-24 px-3">
        <MentionTextarea
          value={content}
          onChange={setContent}
          communityId={communityId ? Number(communityId) : undefined}
          placeholder="What's happening?"
          className="w-full min-h-[180px] p-3 rounded-xl bg-black border border-white/10 text-sm focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
          rows={8}
        />
        
        {/* Detected links */}
        {detectedLinks.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-[#9fb0b5] font-medium">Detected Links:</div>
            {detectedLinks.map((link, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 rounded-lg border border-white/10 bg-white/5">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#4db6ac] truncate">{link.displayText}</div>
                  {link.displayText !== link.url && (
                    <div className="text-xs text-white/50 truncate">{link.url}</div>
                  )}
                </div>
                <button
                  className="px-2 py-1 rounded text-xs border border-[#4db6ac]/30 text-[#4db6ac] hover:bg-[#4db6ac]/10"
                  onClick={() => startRenamingLink(link)}
                >
                  Rename
                </button>
              </div>
            ))}
          </div>
        )}

        {file ? (
          <div className="mt-3 rounded-xl overflow-hidden border border-white/10">
            <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-auto" />
          </div>
        ) : null}
        {preview ? (
          <div className="mt-3 rounded-xl border border-white/10 p-3 bg-white/[0.03]">
            <audio controls src={preview.url} className="w-full" playsInline webkit-playsinline="true" />
          </div>
        ) : null}
        {recording && (
          <div className="mt-3 px-3">
            <div className="text-xs text-[#9fb0b5] mb-1">Recording… {Math.min(60, Math.round((recordMs||0)/1000))}s</div>
            <div className="h-2 w-full bg-white/5 rounded overflow-hidden">
              <div className="h-full bg-[#4db6ac] transition-all" style={{ width: `${Math.min(100, ((recordMs||0)/600) )}%`, opacity: 0.9 }} />
            </div>
            <div className="mt-2 h-8 w-full bg-white/5 rounded flex items-center">
              <div className="h-2 bg-[#7fe7df] rounded transition-all" style={{ width: `${Math.max(6, Math.min(96, level*100))}%`, marginLeft: '2%' }} />
            </div>
          </div>
        )}
      </div>
      
      {/* Rename link modal */}
      {renamingLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <div className="w-[90%] max-w-md rounded-2xl border border-[#4db6ac]/30 bg-[#0b0b0b] p-6 shadow-[0_0_40px_rgba(77,182,172,0.3)]">
            <h3 className="text-lg font-bold text-white mb-4">Rename Link</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#9fb0b5] mb-1 block">Original URL:</label>
                <div className="text-xs text-white/70 truncate p-2 rounded bg-white/5 border border-white/10">
                  {renamingLink.url}
                </div>
              </div>
              <div>
                <label className="text-xs text-[#9fb0b5] mb-1 block">Display as:</label>
                <input
                  type="text"
                  value={linkDisplayName}
                  onChange={(e) => setLinkDisplayName(e.target.value)}
                  className="w-full p-2 rounded bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#4db6ac]"
                  placeholder="Enter display name"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-white/80 text-sm hover:bg-white/5"
                onClick={cancelRenaming}
              >
                Cancel
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-lg bg-[#4db6ac] text-black font-medium hover:brightness-110"
                onClick={saveRenamedLink}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="fixed left-0 right-0 bottom-0 h-16 border-t border-white/10 bg-black/85 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full px-4 flex items-center justify-between gap-3">
          <label className="px-3 py-2 rounded-full hover:bg-white/5 cursor-pointer" aria-label="Add image">
            <i className="fa-regular fa-image" style={{ color: '#4db6ac' }} />
            <input type="file" accept="image/*" onChange={(e)=> setFile(e.target.files?.[0]||null)} style={{ display: 'none' }} />
          </label>
          <button className={`px-3 py-2 rounded-full text-[#4db6ac] hover:bg-white/5 ${recording ? 'brightness-125' : ''}`} aria-label={recording ? "Stop recording" : "Record audio"} onClick={()=> recording ? stop() : start()}>
            <i className={`fa-solid ${recording ? 'fa-stop' : 'fa-microphone'}`} />
          </button>
          {preview && (
            <button className="px-3 py-2 rounded-full text-white/70 hover:bg-white/5" onClick={clearPreview} aria-label="Discard audio">
              <i className="fa-solid fa-trash" />
            </button>
          )}
          <div className="flex-1" />
          <button className={`px-4 py-2 rounded-full ${submitting ? 'bg-white/20 text-white/60 cursor-not-allowed' : 'bg-[#4db6ac] text-black hover:brightness-110'}`} onClick={submit} disabled={submitting || (!content && !file && !preview)}>
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

