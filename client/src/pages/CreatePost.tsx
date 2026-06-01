import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'
import { computeKeyboardLift, readCssPxVar } from '../utils/keyboardLift'
import MentionTextarea from '../components/MentionTextarea'
import { useAudioRecorder } from '../components/useAudioRecorder'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { detectLinks, replaceLinkInText, type DetectedLink } from '../utils/linkUtils.tsx'
import { extractUrls, stripExtractedUrlsFromText } from '../components/LinkPreview'
import GifPicker from '../components/GifPicker'
import { NativeActionButton } from '../components/NativeActionButton'
import { NativeIconButton } from '../components/NativeIconButton'
import { clearDeviceCache } from '../utils/deviceCache'
import type { GifSelection } from '../components/GifPicker'
import { gifSelectionToFile } from '../utils/gif'
import { fileIsPdf } from '../services/shareImport'
import { takePendingShareFilesOnce, takePendingShareUrlsOnce, releaseShareHandoffKey, releaseShareUrlHandoffKey } from '../services/shareImportStore'
import { useEntitlementsHandler } from '../contexts/EntitlementsContext'
import { preflightSteveMention } from '../utils/stevePreflight'
import { triggerHaptic } from '../utils/haptics'

export default function CreatePost(){
  const [params, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const communityId = params.get('community_id') || ''
  const groupId = params.get('group_id') || ''
  const fromShareParam = params.get('from_share')
  const [content, setContent] = useState('')
  const MAX_MEDIA = 5
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [mediaLimitMsg, setMediaLimitMsg] = useState('')
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  const [selectedGif, setSelectedGif] = useState<GifSelection | null>(null)
  const [gifFile, setGifFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const entitlementsHandler = useEntitlementsHandler()
  const [mediaCarouselIndex, setMediaCarouselIndex] = useState(0)
  const { recording, preview, start, stop, clearPreview, ensurePreview, level, recordMs } = useAudioRecorder() as any

  const handleMicButton = () => {
    if (recording) {
      void stop().then((p: { blob?: Blob } | null) => {
        if (!p?.blob?.size) {
          alert(t('feed.audio_capture_failed'))
        }
      })
    } else {
      void start()
    }
  }
  const [showPraise, setShowPraise] = useState(false)
  const [detectedLinks, setDetectedLinks] = useState<DetectedLink[]>([])
  /** Shared links (e.g. share extension) — stored separately from caption, not merged into body text. */
  const [pendingShareUrls, setPendingShareUrls] = useState<string[]>([])
  const [renamingLink, setRenamingLink] = useState<DetectedLink | null>(null)
  const [linkDisplayName, setLinkDisplayName] = useState('')
  const tokenRef = useRef<string>(`${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const shareAttachDoneRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement|null>(null)
  const headerOffsetVar = 'var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px)))'
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
  const [groupFeedMeta, setGroupFeedMeta] = useState<{ steve_agent_enabled: boolean; steve_agent_preset: string | null } | null>(null)
  const [askSteveOnPost, setAskSteveOnPost] = useState(false)

  useEffect(() => {
    if (!groupId) {
      setGroupFeedMeta(null)
      setAskSteveOnPost(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/group_feed?group_id=${encodeURIComponent(groupId)}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const j = await r.json().catch(() => null)
        if (!alive || !j?.success || !j.group) return
        setGroupFeedMeta({
          steve_agent_enabled: !!j.group.steve_agent_enabled,
          steve_agent_preset: j.group.steve_agent_preset != null ? String(j.group.steve_agent_preset) : null,
        })
      } catch {
        if (alive) setGroupFeedMeta(null)
      }
    })()
    return () => { alive = false }
  }, [groupId])

  // Generate preview URLs for all media files
  const mediaPreviewUrls = useMemo(() => {
    return mediaFiles.map(file => ({
      url: URL.createObjectURL(file),
      type: file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'image',
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

  const shareHandoffKey =
    fromShareParam === '1' ? `compose:${communityId || groupId || '0'}:from_share` : ''

  useEffect(() => {
    shareAttachDoneRef.current = false
  }, [communityId, groupId])

  useEffect(() => {
    if (fromShareParam !== '1' || !shareHandoffKey) return
    if (shareAttachDoneRef.current) return
    const files = takePendingShareFilesOnce(shareHandoffKey)
    const urls = takePendingShareUrlsOnce(shareHandoffKey)
    if (!files?.length && !urls?.length) return
    shareAttachDoneRef.current = true
    if (files?.length) {
      const forFeed = files.filter(f => !fileIsPdf(f))
      setMediaFiles(prev => [...prev, ...forFeed].slice(0, MAX_MEDIA))
    }
    if (urls?.length) {
      setPendingShareUrls(urls)
    }
    setSearchParams(
      p => {
        const n = new URLSearchParams(p)
        n.delete('from_share')
        return n
      },
      { replace: true }
    )
  }, [fromShareParam, shareHandoffKey, setSearchParams])

  useEffect(() => {
    if (fromShareParam === '1') return
    const hk = `compose:${communityId || groupId || '0'}:from_share`
    releaseShareHandoffKey(hk)
    releaseShareUrlHandoffKey(hk)
  }, [fromShareParam, communityId, groupId])

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
    if (typeof window === 'undefined') return

    const syncSafeBottom = () => {
      const next = readCssPxVar('--sab-px')
      setSafeBottomPx(prev => (Math.abs(prev - next) < 1 ? prev : next))
    }

    syncSafeBottom()
    window.addEventListener('resize', syncSafeBottom)
    window.visualViewport?.addEventListener('resize', syncSafeBottom)

    return () => {
      window.removeEventListener('resize', syncSafeBottom)
      window.visualViewport?.removeEventListener('resize', syncSafeBottom)
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
    if (!navigator.onLine) {
      alert(t('feed.go_back_online'))
      return
    }

    if (submitting) return

    const urlsFromText = extractUrls(content)
    const allLinkUrls = [...new Set([...pendingShareUrls, ...urlsFromText])]
    const captionStripped = stripExtractedUrlsFromText(content, allLinkUrls)
    const groupMerged =
      groupId && pendingShareUrls.length > 0
        ? [pendingShareUrls.join('\n\n'), content].filter(Boolean).join('\n\n')
        : content

    const canPost = groupId
      ? !!(groupMerged.trim() || mediaFiles.length > 0 || gifFile || preview?.blob)
      : !!(captionStripped.trim() || mediaFiles.length > 0 || gifFile || preview?.blob || allLinkUrls.length > 0)

    if (!canPost) {
      alert(t('feed.add_content_before_post'))
      return
    }

    // Show posting state immediately so the tap feels native (before preflight / upload work).
    setSubmitting(true)
    void triggerHaptic('light')

    // If user is still recording, stop and wait briefly for preview to finalize
    if (recording) {
      try {
        await ensurePreview(5000)
      } catch {
        setSubmitting(false)
        alert(t('feed.post_failed'))
        return
      }
    }

    if (communityId && !groupId) {
      const preflight = await preflightSteveMention({
        text: captionStripped,
        communityId,
        entitlementsHandler,
      })
      if (!preflight.ok) {
        if (preflight.error) alert(preflight.error)
        setSubmitting(false)
        return
      }
    }

    // Check if this is from onboarding (first post)
    const isFirstPost = params.get('first_post') === 'true'
    
    try{
      const fd = new FormData()
      if (groupId) {
        fd.append('content', groupMerged)
      } else {
        fd.append('content', captionStripped)
        if (allLinkUrls.length > 0) fd.append('link_urls', JSON.stringify(allLinkUrls))
      }
      
      // Handle GIF (takes priority as single image)
      if (gifFile) {
        fd.append('image', gifFile)
      } else if (mediaFiles.length > 0) {
        const LARGE_VIDEO_THRESHOLD = 25 * 1024 * 1024 // 25MB
        const preUploadedVideoUrls: string[] = []
        let appendedPostAudio = false

        for (const file of mediaFiles) {
          if (file.type.startsWith('audio/')) {
            if (!appendedPostAudio) {
              fd.append('audio', file, file.name || 'audio.m4a')
              appendedPostAudio = true
            }
            continue
          }
          if (file.type.startsWith('video/') && file.size > LARGE_VIDEO_THRESHOLD) {
            // Large video - upload directly to R2 via presigned URL
            try {
              const urlRes = await fetch('/api/post_video_upload_url', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, content_type: file.type || 'video/mp4' }),
              })
              const urlData = await urlRes.json().catch(() => null)
              if (urlData?.success && urlData.upload_url && urlData.public_url) {
                const putOk = await new Promise<boolean>((resolve, reject) => {
                  const xhr = new XMLHttpRequest()
                  xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
                  xhr.onerror = () => reject(new Error('Upload failed'))
                  xhr.ontimeout = () => reject(new Error('Upload timeout'))
                  xhr.open('PUT', urlData.upload_url)
                  xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
                  xhr.timeout = 600000
                  xhr.send(file)
                })
                if (putOk) preUploadedVideoUrls.push(urlData.public_url)
              } else {
                fd.append('videos', file)
              }
            } catch {
              fd.append('videos', file)
            }
          } else if (file.type.startsWith('video/')) {
            fd.append('videos', file)
          } else if (file.type.startsWith('image/')) {
            fd.append('images', file)
          }
        }
        
        if (preUploadedVideoUrls.length > 0) {
          fd.append('video_urls', JSON.stringify(preUploadedVideoUrls))
        }
      }
      
      if (preview?.blob) fd.append('audio', preview.blob, (preview.blob.type.includes('mp4') ? 'audio.mp4' : 'audio.webm'))
      fd.append('dedupe_token', tokenRef.current)
      
      let postResult: { success?: boolean; error?: string } | null = null
      if (groupId){
        fd.append('group_id', groupId)
        if (askSteveOnPost && groupFeedMeta?.steve_agent_enabled && groupFeedMeta?.steve_agent_preset === 'career_expert') {
          fd.append('ask_steve', '1')
        }
        const r = await fetch('/api/group_posts', { method: 'POST', credentials: 'include', body: fd })
        postResult = await r.json().catch(() => null)
      } else {
        if (communityId) fd.append('community_id', communityId)
        const r = await fetch('/post_status', { method: 'POST', credentials: 'include', body: fd })
        postResult = await r.json().catch(() => null)
      }
      
      if (postResult && postResult.success === false) {
        alert(postResult.error || t('feed.create_failed'))
        setSubmitting(false)
        return
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
      setPendingShareUrls([])
      setMediaFiles([])
      setSelectedGif(null)
      setGifFile(null)
      setMediaCarouselIndex(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
      clearPreview()
    }catch{
      setSubmitting(false)
      alert(t('feed.post_failed'))
    }
  }

  const effectiveComposerHeight = Math.max(composerHeight, composerBaseline)
  const liftSource = Math.max(keyboardOffset, viewportLift)
  const keyboardLift = computeKeyboardLift(liftSource)
  const showKeyboard = keyboardLift > 0
  const conversationDynamicHeight = viewportHeight
    ? `calc(${viewportHeight.toFixed(2)}px - ${headerOffsetVar})`
    : conversationMinHeight
  const contentPaddingBottom = showKeyboard
    ? `calc(${effectiveComposerHeight}px + ${keyboardLift}px + 2rem)`
    : `calc(${effectiveComposerHeight}px + ${safeBottomPx}px + 2rem)`
  const contentPaddingTop = 'calc(var(--app-header-offset, calc(56px + var(--sat-px, 0px))) + var(--app-content-gap, 8px))'

  return (
    <>
    <div className="glass-page min-h-screen bg-c-bg-app text-c-text-primary">
      {/* Full-screen loading overlay when submitting */}
      {submitting && (
        <div className="fixed inset-0 z-[200] bg-c-bg-overlay backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-white/20 border-t-cpoint-turquoise rounded-full animate-spin mb-4" />
          <div className="text-white font-medium">{t('feed.posting_overlay')}</div>
          {mediaFiles.length > 0 && (
            <div className="text-white/60 text-sm mt-2">{t('feed.uploading_files', { count: mediaFiles.length })}</div>
          )}
        </div>
      )}
      
      {/* Praise notification */}
      {showPraise && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none">
          <div className="px-6 py-3 rounded-full border border-cpoint-turquoise/40 bg-c-bg-elevated backdrop-blur-sm shadow-lg">
            <div className="text-sm font-medium text-c-text-primary">
              {t('feed.first_post_praise')} <span className="text-cpoint-turquoise">{t('feed.first_post_created')}</span>
            </div>
          </div>
        </div>
      )}
      <div 
        className="fixed left-0 right-0 h-12 border-b border-c-border bg-c-bg-app/90 backdrop-blur flex items-center justify-between px-3 z-50"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 56px)' }}
      >
        <button 
          className="flex items-center gap-2 px-3 py-2 rounded-full text-c-text-primary hover:text-cpoint-turquoise hover:bg-c-hover-bg transition-colors" 
          onClick={() => {
            if (groupId) navigate(`/group_feed_react/${groupId}`)
            else if (communityId) navigate(`/community_feed_react/${communityId}`)
            else navigate(-1)
          }} 
          aria-label={t('common.back')}
        >
          <i className="fa-solid fa-arrow-left" />
          <span className="text-sm font-medium">{t('common.back')}</span>
        </button>
        <span className="text-sm font-semibold text-c-text-primary">{t('feed.create_post_title')}</span>
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
          placeholder={t('feed.create_post_placeholder')}
          className="w-full min-h-[180px] p-3 rounded-xl bg-c-bg-app border border-c-border text-sm focus:outline-none focus:ring-1 focus:ring-cpoint-turquoise"
          rows={8}
        />

        {groupId && groupFeedMeta?.steve_agent_enabled && groupFeedMeta?.steve_agent_preset === 'career_expert' && (
          <label className="flex items-start gap-3 px-1 py-2 rounded-lg border border-c-border bg-c-hover-bg">
            <input
              type="checkbox"
              className="mt-1"
              checked={askSteveOnPost}
              onChange={(e) => setAskSteveOnPost(e.target.checked)}
            />
            <div>
              <div className="text-sm text-c-text-primary font-medium">{t('feed.ask_steve')}</div>
              <div className="text-xs text-c-text-tertiary mt-0.5">
                {t('feed.ask_steve_helper')}
              </div>
            </div>
          </label>
        )}
        
        {/* Detected links */}
        {detectedLinks.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-c-text-tertiary font-medium">{t('feed.detected_links')}</div>
            {detectedLinks.map((link, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 rounded-lg border border-c-border bg-c-hover-bg">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-cpoint-turquoise truncate">{link.displayText}</div>
                  {link.displayText !== link.url && (
                    <div className="text-xs text-c-text-tertiary truncate">{link.url}</div>
                  )}
                </div>
                <button
                  className="px-2 py-1 rounded text-xs border border-cpoint-turquoise/30 text-cpoint-turquoise hover:bg-cpoint-turquoise/10"
                  onClick={() => startRenamingLink(link)}
                >
                  {t('feed.rename')}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Media carousel preview */}
        {mediaPreviewUrls.length > 0 && (
          <div className="mt-3 rounded-xl overflow-hidden border border-c-border bg-black">
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
              ) : mediaPreviewUrls[mediaCarouselIndex]?.type === 'audio' ? (
                <audio src={mediaPreviewUrls[mediaCarouselIndex].url} controls className="w-full max-w-md mx-auto" />
              ) : (
                <img 
                  src={mediaPreviewUrls[mediaCarouselIndex]?.url} 
                  alt={t('feed.preview_alt', { number: mediaCarouselIndex + 1 })} 
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
            <div className="px-3 py-2 flex items-center justify-between bg-c-hover-bg border-t border-c-border">
              <div className="flex items-center gap-2 text-xs text-c-text-secondary">
                <span className="flex items-center gap-1.5 text-[#7fe7df]">
                  <i className={`fa-solid ${
                    mediaPreviewUrls[mediaCarouselIndex]?.type === 'video'
                      ? 'fa-video'
                      : mediaPreviewUrls[mediaCarouselIndex]?.type === 'audio'
                        ? 'fa-music'
                        : 'fa-image'
                  }`} />
                  {mediaPreviewUrls.length}/{MAX_MEDIA}
                </span>
              </div>
              {/* Dot indicators */}
              {mediaPreviewUrls.length > 1 && (
                <div className="flex items-center gap-1.5">
                  {mediaPreviewUrls.map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`w-2 h-2 rounded-full transition-colors ${idx === mediaCarouselIndex ? 'bg-cpoint-turquoise' : 'bg-white/30'}`}
                      onClick={() => setMediaCarouselIndex(idx)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {mediaLimitMsg && (
          <div className="mx-1 mt-2 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
            <i className="fa-solid fa-circle-exclamation" />
            {mediaLimitMsg}
          </div>
        )}

        {selectedGif ? (
          <div className="mt-3 inline-flex items-center gap-3 rounded-xl border border-c-border bg-c-hover-bg p-3">
            <img src={selectedGif.previewUrl} alt={t('feed.selected_gif_alt')} className="w-16 h-16 rounded object-cover" loading="lazy" />
            <div className="flex items-center gap-2 text-xs text-[#7fe7df]">
              <i className="fa-solid fa-images" />
              <span>{t('feed.gif_attached')}</span>
              <button
                onClick={() => { setSelectedGif(null); setGifFile(null) }}
                className="ml-1 text-red-400 hover:text-red-300"
                aria-label={t('feed.remove_gif')}
              >
                <i className="fa-solid fa-times" />
              </button>
            </div>
          </div>
        ) : null}
        {preview ? (
          <div className="mt-3 rounded-xl border border-c-border p-3 bg-white/[0.03] space-y-2">
            <audio controls src={preview.url} className="w-full" playsInline webkit-playsinline="true" />
          </div>
        ) : null}
        {recording && (
          <div className="mt-3 px-3">
            <div className="text-xs text-c-text-tertiary mb-1">{t('feed.recording', { seconds: Math.min(60, Math.round((recordMs||0)/1000)) })}</div>
            <div className="h-2 w-full bg-c-hover-bg rounded overflow-hidden">
              <div className="h-full bg-cpoint-turquoise transition-all" style={{ width: `${Math.min(100, ((recordMs||0)/600) )}%`, opacity: 0.9 }} />
            </div>
            <div className="mt-2 h-8 w-full bg-c-hover-bg rounded flex items-center">
              <div className="h-2 bg-[#7fe7df] rounded transition-all" style={{ width: `${Math.max(6, Math.min(96, level*100))}%`, marginLeft: '2%' }} />
            </div>
          </div>
        )}
        </div>
      </div>
      
      {/* Rename link modal */}
      {renamingLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-c-bg-overlay backdrop-blur-sm">
          <div className="w-[90%] max-w-md rounded-2xl border border-cpoint-turquoise/30 bg-c-bg-elevated p-6 shadow-[0_0_40px_rgba(0,206,200,0.3)]">
            <h3 className="text-lg font-bold text-c-text-primary mb-4">{t('feed.rename_link')}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-c-text-tertiary mb-1 block">{t('feed.original_url')}</label>
                <div className="text-xs text-c-text-secondary truncate p-2 rounded bg-c-hover-bg border border-c-border">
                  {renamingLink.url}
                </div>
              </div>
              <div>
                <label className="text-xs text-c-text-tertiary mb-1 block">{t('feed.display_as')}</label>
                <input
                  type="text"
                  value={linkDisplayName}
                  onChange={(e) => setLinkDisplayName(e.target.value)}
                  className="w-full p-2 rounded bg-c-hover-bg border border-c-border text-sm text-c-text-primary focus:outline-none focus:ring-1 focus:ring-cpoint-turquoise"
                  placeholder={t('feed.display_name_placeholder')}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-c-text-secondary text-sm hover:bg-c-hover-bg"
                onClick={cancelRenaming}
              >
                {t('common.cancel')}
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-lg bg-cpoint-turquoise text-black font-medium hover:brightness-110"
                onClick={saveRenamedLink}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    
    {/* The portaled composer is hidden while the GIF picker is open so the
        glass sheet does not show the composer chrome through it. */}
    {!gifPickerOpen && typeof document !== 'undefined' && createPortal(
    <div 
      ref={composerRef}
      className="fixed left-0 right-0 bg-gradient-to-b from-transparent to-c-bg-app"
      style={{
        bottom: showKeyboard ? `${keyboardLift}px` : 0,
        zIndex: 1000,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: showKeyboard ? '4px' : '8px',
        paddingBottom: showKeyboard ? '4px' : `calc(var(--sab-px, 0px) + 6px)`,
        paddingLeft: 'var(--sal-px, 0px)',
        paddingRight: 'var(--sar-px, 0px)',
        transition: 'transform 140ms ease-out',
        touchAction: 'manipulation',
        pointerEvents: 'auto',
      }}
    >
      <div
        ref={composerCardRef}
        className="relative max-w-2xl w-[calc(100%-24px)] mx-auto rounded-[16px] px-3.5 sm:px-4.5 py-2.5 sm:py-3 bg-c-composer-bg"
      >
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="px-3 py-2 rounded-full hover:bg-c-hover-bg cursor-pointer" aria-label={t('feed.add_photos_videos')}>
              <i className="fa-regular fa-image" style={{ color: '#00CEC8' }} />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                multiple
                onChange={(e)=> {
                  const files = e.target.files
                  if (!files || files.length === 0) return
                  
                  const remaining = MAX_MEDIA - mediaFiles.length
                  if (remaining <= 0) {
                    setMediaLimitMsg(t('feed.max_files', { max: MAX_MEDIA }))
                    setTimeout(() => setMediaLimitMsg(''), 3000)
                    e.target.value = ''
                    return
                  }
                  const newFiles = Array.from(files).slice(0, remaining)
                  if (newFiles.length < files.length) {
                    setMediaLimitMsg(t('feed.max_files_skipped', { max: MAX_MEDIA, count: files.length - newFiles.length }))
                    setTimeout(() => setMediaLimitMsg(''), 3000)
                  }
                  if (newFiles.length > 0) {
                    setMediaFiles(prev => [...prev, ...newFiles].slice(0, MAX_MEDIA))
                    setSelectedGif(null)
                    setGifFile(null)
                  }
                  e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
            </label>
            <NativeIconButton
              preventBlur
              variant="muted"
              className="rounded-full px-3 py-2 h-auto w-auto text-cpoint-turquoise bg-transparent hover:bg-c-hover-bg"
              aria-label={t('feed.add_gif')}
              onClick={() => setGifPickerOpen(true)}
            >
              <i className="fa-solid fa-images" />
            </NativeIconButton>
            <NativeIconButton
              preventBlur
              variant="muted"
              className={`rounded-full px-3 py-2 h-auto w-auto text-cpoint-turquoise bg-transparent hover:bg-c-hover-bg ${recording ? 'brightness-125' : ''}`}
              aria-label={recording ? t('feed.stop_recording') : t('feed.record_audio')}
              onClick={handleMicButton}
            >
              <i className={`fa-solid ${recording ? 'fa-stop' : 'fa-microphone'}`} />
            </NativeIconButton>
            {preview && (
              <NativeIconButton
                preventBlur
                variant="muted"
                className="rounded-full px-3 py-2 h-auto w-auto text-c-text-secondary bg-transparent hover:bg-c-hover-bg"
                onClick={clearPreview}
                aria-label={t('feed.discard_audio')}
              >
                <i className="fa-solid fa-trash" />
              </NativeIconButton>
            )}
          </div>
          <NativeActionButton
            className={`px-4 py-2 rounded-full font-semibold ${submitting ? 'bg-white/20 text-c-text-secondary cursor-not-allowed active:scale-100' : ''}`}
            onClick={submit}
            disabled={submitting || (!content && !hasMediaAttachment && !gifFile && !preview)}
          >
            {submitting ? t('feed.posting') : t('feed.post')}
          </NativeActionButton>
        </div>
      </div>
      <div 
        className="bg-c-bg-app"
        style={{
          height: showKeyboard ? '4px' : 'var(--sab-px, 0px)',
          flexShrink: 0,
        }}
      />
    </div>,
    document.body
    )}

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
          alert(t('feed.gif_attach_failed'))
        } finally {
          setGifPickerOpen(false)
        }
      }}
    />
    </>
  )
}

