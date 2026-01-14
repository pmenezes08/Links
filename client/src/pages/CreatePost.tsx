import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import MentionTextarea from '../components/MentionTextarea'
import { useAudioRecorder } from '../components/useAudioRecorder'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { detectLinks, replaceLinkInText, type DetectedLink } from '../utils/linkUtils.tsx'
import GifPicker from '../components/GifPicker'
import { clearDeviceCache } from '../utils/deviceCache'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'

export default function CreatePost(){
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const communityId = params.get('community_id') || ''
  const groupId = params.get('group_id') || ''
  const [content, setContent] = useState('')
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const [selectedGif, setSelectedGif] = useState<GifSelection | null>(null)
  const [gifFile, setGifFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mediaCarouselIndex, setMediaCarouselIndex] = useState(0)
  const { recording, preview, start, stop, clearPreview, ensurePreview, level, recordMs } = useAudioRecorder() as any
  const [showPraise, setShowPraise] = useState(false)
  const [detectedLinks, setDetectedLinks] = useState<DetectedLink[]>([])
  const [renamingLink, setRenamingLink] = useState<DetectedLink | null>(null)
  const [linkDisplayName, setLinkDisplayName] = useState('')
  const tokenRef = useRef<string>(`${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const headerOffsetVar = 'var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px)))'
  const safeBottom = 'env(safe-area-inset-bottom, 0px)'
  const conversationMinHeight = `calc(100vh - ${headerOffsetVar})`
  const composerBaseline = 140
  const [composerHeight, setComposerHeight] = useState(composerBaseline)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const composerCardRef = useRef<HTMLDivElement | null>(null)
  const keyboardOffsetRef = useRef(0)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [safeBottomPx, setSafeBottomPx] = useState(0)
  const viewportBaseRef = useRef<number | null>(null)
  const [viewportLift, setViewportLift] = useState(0)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)

  // Generate preview URLs for all media files
  const mediaPreviewUrls = useMemo(() => {
    return mediaFiles.map(file => ({
      url: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' : 'image',
      name: file.name
    }))
  }, [mediaFiles])

  const hasMediaAttachment = mediaFiles.length > 0

  // Cleanup preview URLs when component unmounts or files change
  useEffect(() => {
    return () => {
      mediaPreviewUrls.forEach(preview => URL.revokeObjectURL(preview.url))
    }
  }, [mediaPreviewUrls])

  // Reset carousel index when media changes
  useEffect(() => {
    if (mediaCarouselIndex >= mediaFiles.length) {
      setMediaCarouselIndex(Math.max(0, mediaFiles.length - 1))
    }
  }, [mediaFiles.length, mediaCarouselIndex])


  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return
    const node = composerCardRef.current
    if (!node) return

    const updateHeight = () => {
      const height = node.getBoundingClientRect().height
      if (!height) return
      setComposerHeight(prev => (Math.abs(prev - height) < 1 ? prev : height))
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.bottom = '0'
    probe.style.left = '0'
    probe.style.width = '0'
    probe.style.height = 'env(safe-area-inset-bottom, 0px)'
    probe.style.pointerEvents = 'none'
    probe.style.opacity = '0'
    probe.style.zIndex = '-1'
    document.body.appendChild(probe)

    const updateSafeBottom = () => {
      const rect = probe.getBoundingClientRect()
      const next = rect.height || 0
      setSafeBottomPx(prev => (Math.abs(prev - next) < 1 ? prev : next))
    }

    updateSafeBottom()
    window.addEventListener('resize', updateSafeBottom)

    return () => {
      window.removeEventListener('resize', updateSafeBottom)
      probe.remove()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId: number | null = null
    const updateOffset = () => {
      const currentHeight = viewport.height
      setViewportHeight(prev => (Math.abs((prev ?? currentHeight) - currentHeight) < 1 ? prev : currentHeight))
      if (
        viewportBaseRef.current === null ||
        currentHeight > (viewportBaseRef.current ?? currentHeight) - 4
      ) {
        viewportBaseRef.current = currentHeight
      }
      const baseHeight = viewportBaseRef.current ?? currentHeight
      const nextOffset = Math.max(0, baseHeight - currentHeight - viewport.offsetTop)
      setViewportLift(prev => (Math.abs(prev - nextOffset) < 1 ? prev : nextOffset))
      if (Math.abs(keyboardOffsetRef.current - nextOffset) < 1) return
      keyboardOffsetRef.current = nextOffset
      setKeyboardOffset(nextOffset)
    }
    const handleChange = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updateOffset)
    }

    viewport.addEventListener('resize', handleChange)
    viewport.addEventListener('scroll', handleChange)
    handleChange()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', handleChange)
      viewport.removeEventListener('scroll', handleChange)
    }
  }, [])

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const handleShow = (info: KeyboardInfo) => {
      const height = info?.keyboardHeight ?? 0
      if (Math.abs(keyboardOffsetRef.current - height) < 2) return
      keyboardOffsetRef.current = height
      setKeyboardOffset(height)
    }

    const handleHide = () => {
      if (keyboardOffsetRef.current === 0) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
    }

    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => {
      showSub = handle
    })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => {
      hideSub = handle
    })

    return () => {
      showSub?.remove()
      hideSub?.remove()
    }
  }, [])

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
    
    if (!content && mediaFiles.length === 0 && !gifFile && !preview?.blob) {
      alert('Add text, media, or finish recording audio before posting')
      return
    }
    if (submitting) return
    setSubmitting(true)
    
    // Check if this is from onboarding (first post)
    const isFirstPost = params.get('first_post') === 'true'
    
    try{
      const fd = new FormData()
      fd.append('content', content)
      
      // Handle GIF (takes priority as single image)
      if (gifFile) {
        fd.append('image', gifFile)
      } else if (mediaFiles.length > 0) {
        // Append all media files
        mediaFiles.forEach(file => {
          if (file.type.startsWith('video/')) {
            fd.append('videos', file)
          } else {
            fd.append('images', file)
          }
        })
      }
      
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
      
      // Clear the feed cache so the new post shows immediately on return
      if (communityId) {
        clearDeviceCache(`community-feed:${communityId}`)
      }
      if (groupId) {
        clearDeviceCache(`group-feed:${groupId}`)
      }
      
      // Show praise for first post
      if (!groupId && isFirstPost) {
        setShowPraise(true)
        setTimeout(() => {
          setShowPraise(false)
          if (communityId) navigate(`/community_feed_react/${communityId}`, { state: { refresh: Date.now() } })
          else navigate(-1)
        }, 2000)
      } else {
        // Regardless of server response, navigate back to feed to avoid double tap
        // Pass refresh state to trigger feed reload (needed for Capacitor apps where component stays mounted)
        if (groupId) navigate(`/group_feed_react/${groupId}`, { state: { refresh: Date.now() } })
        else if (communityId) navigate(`/community_feed_react/${communityId}`, { state: { refresh: Date.now() } })
        else navigate(-1)
      }
      setContent('')
      setMediaFiles([])
      setSelectedGif(null)
      setGifFile(null)
      setMediaCarouselIndex(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
      clearPreview()
    }catch{
      setSubmitting(false)
      alert('Failed to post. Please try again.')
    }
  }

  const effectiveComposerHeight = Math.max(composerHeight, composerBaseline)
  const liftSource = Math.max(keyboardOffset, viewportLift)
  const keyboardLift = Math.max(0, liftSource - safeBottomPx)
  const showKeyboard = liftSource > 2
  const conversationDynamicHeight = viewportHeight
    ? `calc(${viewportHeight.toFixed(2)}px - ${headerOffsetVar})`
    : conversationMinHeight
  const contentPaddingBottom = `calc(${effectiveComposerHeight}px + ${keyboardLift}px + ${safeBottom} + 2rem)`
  const contentPaddingTop = 'calc(var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))) + var(--app-content-gap, 8px))'

  return (
    <>
    <div className="glass-page text-white">
      {/* Praise notification */}
      {showPraise && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
          <div className="px-6 py-3 rounded-full border border-[#4db6ac]/40 bg-black/90 backdrop-blur-sm shadow-lg">
            <div className="text-sm font-medium text-white">
              Great job! <span className="text-[#4db6ac]">First post created</span> ?
            </div>
          </div>
        </div>
      )}
      <div 
        className="fixed left-0 right-0 h-12 border-b border-white/10 bg-black/90 backdrop-blur flex items-center justify-between px-3 z-50"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
      >
        <button 
          className="flex items-center gap-2 px-3 py-2 rounded-full text-white hover:text-[#4db6ac] hover:bg-white/10 transition-colors" 
          onClick={() => {
            if (groupId) navigate(`/group_feed_react/${groupId}`)
            else if (communityId) navigate(`/community_feed_react/${communityId}`)
            else navigate(-1)
          }} 
          aria-label="Back"
        >
          <i className="fa-solid fa-arrow-left" />
          <span className="text-sm font-medium">Back</span>
        </button>
        <span className="text-sm font-semibold text-white">Create Post</span>
        <div className="w-20" /> {/* Spacer for centering */}
      </div>
      <div className="app-content px-0" style={{ paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom }}>
        <div
          className="max-w-2xl mx-auto flex flex-col gap-4"
          style={{ minHeight: conversationDynamicHeight }}
          data-scroll-region-child="true"
        >
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

        {/* Media carousel preview */}
        {mediaPreviewUrls.length > 0 && (
          <div className="mt-3 rounded-xl overflow-hidden border border-white/10 bg-black">
            {/* Carousel */}
            <div className="relative">
              {/* Current media item */}
              {mediaPreviewUrls[mediaCarouselIndex]?.type === 'video' ? (
                <video
                  src={mediaPreviewUrls[mediaCarouselIndex].url}
                  controls
                  playsInline
                  className="w-full max-h-[360px] bg-black"
                />
              ) : (
                <img 
                  src={mediaPreviewUrls[mediaCarouselIndex]?.url} 
                  alt={`preview ${mediaCarouselIndex + 1}`} 
                  className="w-full max-h-[360px] object-contain bg-black" 
                />
              )}
              
              {/* Navigation arrows for multiple items */}
              {mediaPreviewUrls.length > 1 && (
                <>
                  <button
                    type="button"
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 disabled:opacity-30"
                    onClick={() => setMediaCarouselIndex(i => Math.max(0, i - 1))}
                    disabled={mediaCarouselIndex === 0}
                  >
                    <i className="fa-solid fa-chevron-left text-sm" />
                  </button>
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 disabled:opacity-30"
                    onClick={() => setMediaCarouselIndex(i => Math.min(mediaPreviewUrls.length - 1, i + 1))}
                    disabled={mediaCarouselIndex === mediaPreviewUrls.length - 1}
                  >
                    <i className="fa-solid fa-chevron-right text-sm" />
                  </button>
                </>
              )}
              
              {/* Remove current item button */}
              <button
                type="button"
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-red-400 flex items-center justify-center hover:bg-black/80"
                onClick={() => {
                  setMediaFiles(prev => prev.filter((_, i) => i !== mediaCarouselIndex))
                }}
              >
                <i className="fa-solid fa-times" />
              </button>
            </div>
            
            {/* Carousel indicators and info */}
            <div className="px-3 py-2 flex items-center justify-between bg-white/5 border-t border-white/10">
              <div className="flex items-center gap-2 text-xs text-white/70">
                <span className="flex items-center gap-1.5 text-[#7fe7df]">
                  <i className={`fa-solid ${mediaPreviewUrls[mediaCarouselIndex]?.type === 'video' ? 'fa-video' : 'fa-image'}`} />
                  {mediaPreviewUrls.length} {mediaPreviewUrls.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              {/* Dot indicators */}
              {mediaPreviewUrls.length > 1 && (
                <div className="flex items-center gap-1.5">
                  {mediaPreviewUrls.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`w-2 h-2 rounded-full transition-colors ${idx === mediaCarouselIndex ? 'bg-[#4db6ac]' : 'bg-white/30'}`}
                      onClick={() => setMediaCarouselIndex(idx)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {selectedGif ? (
          <div className="mt-3 inline-flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <img src={selectedGif.previewUrl} alt="Selected GIF" className="w-16 h-16 rounded object-cover" loading="lazy" />
            <div className="flex items-center gap-2 text-xs text-[#7fe7df]">
              <i className="fa-solid fa-images" />
              <span>GIF attached</span>
              <button
                onClick={() => { setSelectedGif(null); setGifFile(null) }}
                className="ml-1 text-red-400 hover:text-red-300"
                aria-label="Remove GIF"
              >
                <i className="fa-solid fa-times" />
              </button>
            </div>
          </div>
        ) : null}
        {preview ? (
          <div className="mt-3 rounded-xl border border-white/10 p-3 bg-white/[0.03] space-y-2">
            <audio controls src={preview.url} className="w-full" playsInline webkit-playsinline="true" />
          </div>
        ) : null}
        {recording && (
          <div className="mt-3 px-3">
            <div className="text-xs text-[#9fb0b5] mb-1">Recording? {Math.min(60, Math.round((recordMs||0)/1000))}s</div>
            <div className="h-2 w-full bg-white/5 rounded overflow-hidden">
              <div className="h-full bg-[#4db6ac] transition-all" style={{ width: `${Math.min(100, ((recordMs||0)/600) )}%`, opacity: 0.9 }} />
            </div>
            <div className="mt-2 h-8 w-full bg-white/5 rounded flex items-center">
              <div className="h-2 bg-[#7fe7df] rounded transition-all" style={{ width: `${Math.max(6, Math.min(96, level*100))}%`, marginLeft: '2%' }} />
            </div>
          </div>
        )}
        </div>
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
    </div>
    
    {/* Floating composer */}
    <div 
      ref={composerRef}
      className="fixed left-0 right-0"
      style={{
        bottom: showKeyboard ? `${keyboardLift}px` : 0,
        zIndex: 1000,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: showKeyboard ? '4px' : '8px',
        paddingBottom: showKeyboard ? '4px' : `calc(env(safe-area-inset-bottom, 0px) + 6px)`,
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
        background: 'linear-gradient(180deg, rgba(3,3,4,0) 0%, rgba(3,3,4,0.65) 30%, rgba(3,3,4,0.9) 65%, #000 90%)',
        transition: 'transform 140ms ease-out',
      }}
    >
      <div
        ref={composerCardRef}
        className="relative max-w-2xl w-[calc(100%-24px)] mx-auto rounded-[16px] px-3.5 sm:px-4.5 py-2.5 sm:py-3"
        style={{ background: '#0a0a0c' }}
      >
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="px-3 py-2 rounded-full hover:bg-white/5 cursor-pointer" aria-label="Add photos/videos">
              <i className="fa-regular fa-image" style={{ color: '#4db6ac' }} />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                multiple
                onChange={(e)=> {
                  const files = e.target.files
                  if (!files || files.length === 0) return
                  
                  // Add new files to existing ones (max 10 items)
                  const newFiles = Array.from(files).slice(0, 10 - mediaFiles.length)
                  if (newFiles.length > 0) {
                    setMediaFiles(prev => [...prev, ...newFiles].slice(0, 10))
                    setSelectedGif(null)
                    setGifFile(null)
                  }
                  e.target.value = '' // Reset input to allow selecting same files again
                }}
                style={{ display: 'none' }}
              />
            </label>
            <button
              className="px-3 py-2 rounded-full text-[#4db6ac] hover:bg-white/5"
              aria-label="Add GIF"
              onClick={()=> setGifPickerOpen(true)}
            >
              <i className="fa-solid fa-images" />
            </button>
            <button className={`px-3 py-2 rounded-full text-[#4db6ac] hover:bg-white/5 ${recording ? 'brightness-125' : ''}`} aria-label={recording ? "Stop recording" : "Record audio"} onClick={()=> recording ? stop() : start()}>
              <i className={`fa-solid ${recording ? 'fa-stop' : 'fa-microphone'}`} />
            </button>
            {preview && (
              <button className="px-3 py-2 rounded-full text-white/70 hover:bg-white/5" onClick={clearPreview} aria-label="Discard audio">
                <i className="fa-solid fa-trash" />
              </button>
            )}
          </div>
          <button className={`px-4 py-2 rounded-full ${submitting ? 'bg-white/20 text-white/60 cursor-not-allowed' : 'bg-[#4db6ac] text-black hover:brightness-110'}`} onClick={submit} disabled={submitting || (!content && !hasMediaAttachment && !gifFile && !preview)}>
            {submitting ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
      <div 
        style={{
          height: showKeyboard ? '4px' : 'env(safe-area-inset-bottom, 0px)',
          background: '#000',
          flexShrink: 0,
        }}
      />
    </div>

    <GifPicker
      isOpen={gifPickerOpen}
      onClose={()=> setGifPickerOpen(false)}
      onSelect={async (gif) => {
        try {
          const converted = await gifSelectionToFile(gif, 'post-gif')
          setSelectedGif(gif)
          setGifFile(converted)
          setMediaFiles([])
          setMediaCarouselIndex(0)
          if (fileInputRef.current) fileInputRef.current.value = ''
        } catch (err) {
          console.error('Failed to prepare GIF for post', err)
          alert('Unable to attach GIF. Please try again.')
        } finally {
          setGifPickerOpen(false)
        }
      }}
    />
    </>
  )
}

